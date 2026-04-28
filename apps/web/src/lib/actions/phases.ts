"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  FlowRow,
  PhaseRow,
  ProjectRow,
  WorkspaceRow,
} from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type Sb = {
  from(table: string): {
    select(cols?: string): unknown;
    insert(values: Record<string, unknown>): {
      select(): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        select(): {
          maybeSingle(): Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    delete(): {
      eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
    };
  };
};

async function getDb() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    supabase,
    sb: supabase as unknown as Sb,
    userId: user?.id ?? null,
  };
}

async function resolveFlowContext(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
  flowId: string,
): Promise<
  | {
      ok: true;
      workspace: WorkspaceRow;
      directory: DirectoryRow;
      project: ProjectRow;
      flow: FlowRow;
    }
  | { ok: false; error: string }
> {
  const { supabase } = await getDb();
  const { data: ws } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  const workspace = ws as unknown as WorkspaceRow | null;
  if (!workspace) return { ok: false, error: "Workspace nao encontrado" };

  const { data: dir } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", directorySlug)
    .maybeSingle();
  const directory = dir as unknown as DirectoryRow | null;
  if (!directory) return { ok: false, error: "Diretoria nao encontrada" };

  const { data: prj } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("directory_id", directory.id)
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  const { data: flw } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("project_id", project.id)
    .maybeSingle();
  const flow = flw as unknown as FlowRow | null;
  if (!flow) return { ok: false, error: "Fluxo nao encontrado" };

  return { ok: true, workspace, directory, project, flow };
}

function pathContext(ctx: {
  workspace: WorkspaceRow;
  directory: DirectoryRow;
  project: ProjectRow;
  flow: FlowRow;
}) {
  return {
    directory_id: ctx.directory.id,
    directory_slug: ctx.directory.slug,
    directory_name: ctx.directory.name,
    project_id: ctx.project.id,
    project_name: ctx.project.name,
    flow_id: ctx.flow.id,
    flow_name: ctx.flow.name,
  };
}

export async function createPhase(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  color?: string | null;
}): Promise<ActionResult<{ phaseId: string }>> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo (max 200)" };

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data: maxData } = await supabase
    .from("phases")
    .select("order_index")
    .eq("flow_id", ctx.flow.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("phases")
    .insert({
      flow_id: ctx.flow.id,
      name,
      description: input.description?.trim() || null,
      due_date: input.dueDate || null,
      color: input.color?.trim() || null,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra criar fase" };

  const phase = data as unknown as PhaseRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "phase",
    entityId: phase.id,
    action: "create",
    changes: {
      after: { name: phase.name, due_date: phase.due_date },
    },
    context: { ...pathContext(ctx), phase_id: phase.id, phase_name: phase.name },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: { phaseId: phase.id } };
}

export async function updatePhase(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  name?: string;
  description?: string | null;
  dueDate?: string | null;
  color?: string | null;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("phases")
    .select("*")
    .eq("id", input.phaseId)
    .maybeSingle();
  const beforeRow = before as unknown as PhaseRow | null;
  if (!beforeRow) return { ok: false, error: "Fase nao encontrada" };

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Nome obrigatorio" };
    if (n.length > 200) return { ok: false, error: "Nome muito longo (max 200)" };
    patch.name = n;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.dueDate !== undefined) {
    patch.due_date = input.dueDate || null;
  }
  if (input.color !== undefined) {
    patch.color = input.color?.trim() || null;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from("phases")
    .update(patch)
    .eq("id", input.phaseId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra editar esta fase" };

  const after = data as unknown as PhaseRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "phase",
    entityId: input.phaseId,
    action: "update",
    changes: {
      before: {
        name: beforeRow.name,
        description: beforeRow.description,
        due_date: beforeRow.due_date,
        color: beforeRow.color,
      },
      after: {
        name: after.name,
        description: after.description,
        due_date: after.due_date,
        color: after.color,
      },
    },
    context: { ...pathContext(ctx), phase_id: input.phaseId, phase_name: after.name },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

/** Toggle conclusao da fase. Set completed_at=now() OR null. */
export async function setPhaseCompleted(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  completed: boolean;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("phases")
    .select("*")
    .eq("id", input.phaseId)
    .maybeSingle();
  const beforeRow = before as unknown as PhaseRow | null;
  if (!beforeRow) return { ok: false, error: "Fase nao encontrada" };

  const newCompletedAt = input.completed ? new Date().toISOString() : null;

  const { data, error } = await sb
    .from("phases")
    .update({
      completed_at: newCompletedAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.phaseId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "phase",
    entityId: input.phaseId,
    action: input.completed ? "complete" : "reactivate",
    changes: {
      before: { completed_at: beforeRow.completed_at },
      after: { completed_at: newCompletedAt },
    },
    context: {
      ...pathContext(ctx),
      phase_id: input.phaseId,
      phase_name: beforeRow.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

export async function deletePhase(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("phases")
    .select("*")
    .eq("id", input.phaseId)
    .maybeSingle();
  const beforeRow = before as unknown as PhaseRow | null;
  if (!beforeRow) return { ok: false, error: "Fase nao encontrada" };

  const { error } = await sb.from("phases").delete().eq("id", input.phaseId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "phase",
    entityId: input.phaseId,
    action: "delete",
    changes: { before: { name: beforeRow.name, due_date: beforeRow.due_date } },
    context: {
      ...pathContext(ctx),
      phase_id: input.phaseId,
      phase_name: beforeRow.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}
