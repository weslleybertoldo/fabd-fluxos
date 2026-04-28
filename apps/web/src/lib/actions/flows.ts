"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type { FlowRow, ProjectRow, DirectoryRow, WorkspaceRow } from "../types";

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

async function resolveProjectContext(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
): Promise<
  | {
      ok: true;
      workspace: WorkspaceRow;
      directory: DirectoryRow;
      project: ProjectRow;
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

  return { ok: true, workspace, directory, project };
}

export async function createFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
  description?: string | null;
  type?: "continuous" | "non_continuous";
}): Promise<ActionResult<{ flowId: string }>> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo (max 200)" };

  const ctx = await resolveProjectContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
  );
  if (!ctx.ok) return ctx;

  const { data, error } = await sb
    .from("flows")
    .insert({
      project_id: ctx.project.id,
      name,
      description: input.description?.trim() || null,
      type: input.type ?? "continuous",
      status: "active",
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra criar fluxo" };

  const flow = data as unknown as FlowRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "flow",
    entityId: flow.id,
    action: "create",
    changes: { after: { name: flow.name, type: flow.type } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: flow.id,
      flow_name: flow.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: { flowId: flow.id } };
}

export async function updateFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  name?: string;
  description?: string | null;
  type?: "continuous" | "non_continuous";
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveProjectContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("flows")
    .select("*")
    .eq("id", input.flowId)
    .maybeSingle();
  const beforeRow = before as unknown as FlowRow | null;
  if (!beforeRow) return { ok: false, error: "Fluxo nao encontrado" };

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
  if (input.type !== undefined) {
    patch.type = input.type;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from("flows")
    .update(patch)
    .eq("id", input.flowId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra editar este fluxo" };

  const after = data as unknown as FlowRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "flow",
    entityId: input.flowId,
    action: "update",
    changes: {
      before: { name: beforeRow.name, description: beforeRow.description, type: beforeRow.type },
      after: { name: after.name, description: after.description, type: after.type },
    },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: input.flowId,
      flow_name: after.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

async function changeFlowStatus(
  input: {
    workspaceSlug: string;
    directorySlug: string;
    projectId: string;
    flowId: string;
  },
  newStatus: "active" | "archived" | "completed",
  action: "archive" | "complete" | "reactivate",
): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveProjectContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("flows")
    .select("*")
    .eq("id", input.flowId)
    .maybeSingle();
  const beforeRow = before as unknown as FlowRow | null;
  if (!beforeRow) return { ok: false, error: "Fluxo nao encontrado" };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: newStatus,
    updated_at: now,
    completed_at: newStatus === "completed" ? now : null,
  };

  const { data, error } = await sb
    .from("flows")
    .update(patch)
    .eq("id", input.flowId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "flow",
    entityId: input.flowId,
    action,
    changes: { before: { status: beforeRow.status }, after: { status: newStatus } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: input.flowId,
      flow_name: beforeRow.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}

export async function archiveFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
}): Promise<ActionResult> {
  return changeFlowStatus(input, "archived", "archive");
}

export async function completeFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
}): Promise<ActionResult> {
  return changeFlowStatus(input, "completed", "complete");
}

export async function reactivateFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
}): Promise<ActionResult> {
  return changeFlowStatus(input, "active", "reactivate");
}

export async function deleteFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  redirectAfter?: boolean;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveProjectContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("flows")
    .select("*")
    .eq("id", input.flowId)
    .maybeSingle();
  const beforeRow = before as unknown as FlowRow | null;
  if (!beforeRow) return { ok: false, error: "Fluxo nao encontrado" };

  const { error } = await sb.from("flows").delete().eq("id", input.flowId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "flow",
    entityId: input.flowId,
    action: "delete",
    changes: { before: { name: beforeRow.name, status: beforeRow.status } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: input.flowId,
      flow_name: beforeRow.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  if (input.redirectAfter) {
    redirect(
      `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
    );
  }
  return { ok: true, data: undefined };
}
