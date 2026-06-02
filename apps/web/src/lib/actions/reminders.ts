"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  ProjectRow,
  ReminderRow,
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

async function resolveProject(
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
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  return { ok: true, workspace, directory, project };
}

function ctxAudit(ctx: {
  workspace: WorkspaceRow;
  directory: DirectoryRow;
  project: ProjectRow;
}) {
  return {
    directory_id: ctx.directory.id,
    directory_slug: ctx.directory.slug,
    directory_name: ctx.directory.name,
    project_id: ctx.project.id,
    project_name: ctx.project.name,
  };
}

export async function createReminder(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
  description?: string | null;
  dueDate?: string | null;
  recurrence?: "once" | "daily";
}): Promise<ActionResult<{ reminderId: string }>> {
  const { sb, userId, supabase } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };

  const recurrence = input.recurrence === "daily" ? "daily" : "once";
  if (!input.dueDate) {
    return {
      ok: false,
      error: recurrence === "daily" ? "Informe o horario" : "Informe a data/hora",
    };
  }

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { data: maxData } = await supabase
    .from("reminders")
    .select("order_index")
    .eq("project_id", ctx.project.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("reminders")
    .insert({
      project_id: ctx.project.id,
      name,
      description: input.description?.trim() || null,
      due_date: input.dueDate || null,
      recurrence,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const r = data as unknown as ReminderRow;
  await audit({
    workspaceId: ctx.workspace.id,
    entity: "reminder",
    entityId: r.id,
    action: "create",
    changes: { after: { name: r.name, due_date: r.due_date } },
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: { reminderId: r.id } };
}

export async function setReminderCompleted(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  reminderId: string;
  completed: boolean;
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const newCompletedAt = input.completed ? new Date().toISOString() : null;
  const { data, error } = await sb
    .from("reminders")
    .update({ completed_at: newCompletedAt, updated_at: new Date().toISOString() })
    .eq("id", input.reminderId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "reminder",
    entityId: input.reminderId,
    action: input.completed ? "complete" : "reactivate",
    changes: { after: { completed_at: newCompletedAt } },
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}

export async function deleteReminder(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  reminderId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { error } = await sb.from("reminders").delete().eq("id", input.reminderId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "reminder",
    entityId: input.reminderId,
    action: "delete",
    changes: {},
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}
