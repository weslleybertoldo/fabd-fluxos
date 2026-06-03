"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import { notify } from "./notifications";
import type {
  DirectoryRow,
  FlowRow,
  PhaseRow,
  PhaseResponsibleRow,
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
      eq(col: string, val: string):
        & Promise<{ error: { message: string } | null }>
        & {
          eq(col2: string, val2: string): Promise<{
            error: { message: string } | null;
          }>;
        };
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

// Observacao + lembrete da fase. reminderRecurrence null remove o lembrete.
// Zera os marcadores de disparo pra valer o novo horario.
export async function setPhaseNoteReminder(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  note: string | null;
  reminderRecurrence: "once" | "daily" | null;
  reminderAt: string | null;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const rec =
    input.reminderRecurrence === "once" || input.reminderRecurrence === "daily"
      ? input.reminderRecurrence
      : null;
  if (rec && !input.reminderAt) return { ok: false, error: "Informe o horario do lembrete" };
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > 2000) return { ok: false, error: "Observacao muito longa" };

  const { data, error } = await sb
    .from("phases")
    .update({
      note,
      reminder_recurrence: rec,
      reminder_at: rec ? input.reminderAt : null,
      reminder_notified_at: null,
      reminder_last_on: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.phaseId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra editar esta fase" };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`);
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

  // Mobile fields transition: ao concluir, mover phase_field_values com fields
  // mode=mobile pra current_phase_id da PROXIMA fase nao-concluida.
  if (input.completed) {
    const { data: phasesAll } = await supabase
      .from("phases")
      .select("*")
      .eq("flow_id", ctx.flow.id);
    const allPhases = (phasesAll ?? []) as unknown as PhaseRow[];
    let nextPhase: PhaseRow | null = null;
    if (ctx.flow.type === "continuous") {
      const sorted = [...allPhases].sort((a, b) => {
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        if (a.due_date && b.due_date) {
          const cmp = a.due_date.localeCompare(b.due_date);
          if (cmp !== 0) return cmp;
        }
        return a.order_index - b.order_index;
      });
      const idx = sorted.findIndex((p) => p.id === input.phaseId);
      nextPhase = sorted.slice(idx + 1).find((p) => !p.completed_at) ?? null;
    } else {
      const sorted = [...allPhases].sort((a, b) => a.order_index - b.order_index);
      const idx = sorted.findIndex((p) => p.id === input.phaseId);
      nextPhase = sorted.slice(idx + 1).find((p) => !p.completed_at) ?? null;
    }

    if (nextPhase) {
      // Move mobile fields via RPC SECURITY DEFINER: a policy pfv_update exige
      // is_phase_responsible(NEW.current_phase_id) no WITH CHECK, e responsavel
      // da fase concluida normalmente nao eh responsavel da proxima -> RLS
      // bloqueava silently. A RPC valida autorizacao na origem e bypassa RLS.
      type SbRpc = {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: number | null; error: { message: string } | null }>;
      };
      const { error: moveErr } = await (supabase as unknown as SbRpc).rpc(
        "move_mobile_field_values",
        { p_from_phase_id: input.phaseId, p_to_phase_id: nextPhase.id },
      );
      if (moveErr) {
        return {
          ok: false,
          error: `Fase concluida, mas falha ao mover campos mobile: ${moveErr.message}`,
        };
      }
    }
  }

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

/**
 * Persiste ordem manual: recebe IDs de phases na ordem desejada e atualiza
 * order_index sequencial. So aplica em fluxo non_continuous (continuous reordena
 * pela due_date no servidor — UI nao chama isso).
 */
export async function reorderPhases(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseIds: string[];
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  // Atualiza cada phase com seu novo order_index (sequencial 0..N-1)
  for (let i = 0; i < input.phaseIds.length; i++) {
    const id = input.phaseIds[i];
    if (!id) continue;
    const { error } = await sb
      .from("phases")
      .update({ order_index: i, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: `Reorder ${id}: ${error.message}` };
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "flow",
    entityId: ctx.flow.id,
    action: "reorder",
    changes: { after: { phase_ids: input.phaseIds } },
    context: { ...pathContext(ctx) },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

export async function setPhaseResponsibles(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  userIds: string[]; // novo set completo (substitui anterior)
}): Promise<ActionResult> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const ctx = await resolveFlowContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data: phase } = await supabase
    .from("phases")
    .select("id,name,flow_id")
    .eq("id", input.phaseId)
    .maybeSingle();
  const phaseRow = phase as unknown as PhaseRow | null;
  if (!phaseRow) return { ok: false, error: "Fase nao encontrada" };
  if (phaseRow.flow_id !== input.flowId)
    return { ok: false, error: "Fase nao pertence ao fluxo" };

  const { data: existingData } = await supabase
    .from("phase_responsibles")
    .select("user_id")
    .eq("phase_id", input.phaseId);
  const existing = ((existingData ?? []) as unknown as Pick<
    PhaseResponsibleRow,
    "user_id"
  >[]).map((r) => r.user_id);

  const desired = Array.from(new Set(input.userIds.filter(Boolean)));
  const toAdd = desired.filter((u) => !existing.includes(u));
  const toRemove = existing.filter((u) => !desired.includes(u));

  for (const uid of toRemove) {
    const { error } = await sb
      .from("phase_responsibles")
      .delete()
      .eq("phase_id", input.phaseId)
      .eq("user_id", uid);
    if (error) return { ok: false, error: error.message };
  }

  for (const uid of toAdd) {
    const { error } = await sb
      .from("phase_responsibles")
      .insert({
        phase_id: input.phaseId,
        user_id: uid,
        assigned_by: userId,
      })
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await audit({
      workspaceId: ctx.workspace.id,
      entity: "phase",
      entityId: input.phaseId,
      action: "update",
      changes: {
        before: { responsibles: existing },
        after: { responsibles: desired },
      },
      context: {
        ...pathContext(ctx),
        phase_id: input.phaseId,
        phase_name: phaseRow.name,
      },
    });
  }

  for (const uid of toAdd) {
    if (uid === userId) continue;
    await notify({
      targetUserId: uid,
      workspaceId: ctx.workspace.id,
      type: "responsible_assigned",
      title: `Voce foi designado responsavel por uma fase`,
      body: `Fase "${phaseRow.name}" do fluxo ${ctx.flow.name}.`,
      entity: "phase",
      entityId: input.phaseId,
      link: `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
    });
  }

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
