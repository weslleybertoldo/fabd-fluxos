"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  ProjectRow,
  SimpleListItemRow,
  SimpleListRow,
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

export async function createList(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
}): Promise<ActionResult<{ listId: string }>> {
  const { sb, userId, supabase } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { data: maxData } = await supabase
    .from("simple_lists")
    .select("order_index")
    .eq("project_id", ctx.project.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("simple_lists")
    .insert({
      project_id: ctx.project.id,
      name,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const list = data as unknown as SimpleListRow;
  await audit({
    workspaceId: ctx.workspace.id,
    entity: "list_item",
    entityId: list.id,
    action: "create",
    changes: { after: { name: list.name, kind: "list" } },
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: { listId: list.id } };
}

/**
 * Cria uma lista e, opcionalmente, seus itens iniciais num unico insert em
 * batch — evita o N+1 de chamar addListItem em serie (cada chamada faz
 * roundtrip + revalidatePath). Revalida uma unica vez no fim.
 */
export async function createChecklist(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
  items?: string[];
}): Promise<ActionResult<{ listId: string }>> {
  const { sb, supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };

  const items = (input.items ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (items.some((t) => t.length > 1000)) {
    return { ok: false, error: "Item muito longo (max 1000 caracteres)" };
  }

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { data: maxData } = await supabase
    .from("simple_lists")
    .select("order_index")
    .eq("project_id", ctx.project.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("simple_lists")
    .insert({
      project_id: ctx.project.id,
      name,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const list = data as unknown as SimpleListRow;

  if (items.length) {
    const rows = items.map((text, i) => ({
      list_id: list.id,
      text,
      order_index: i,
      created_by: userId,
    }));
    const batch = supabase.from("simple_list_items") as unknown as {
      insert(v: Record<string, unknown>[]): Promise<{
        error: { message: string } | null;
      }>;
    };
    const { error: itemsErr } = await batch.insert(rows);
    if (itemsErr) {
      return {
        ok: false,
        error: `Checklist criada, mas falhou ao adicionar itens: ${itemsErr.message}`,
      };
    }
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "list_item",
    entityId: list.id,
    action: "create",
    changes: { after: { name: list.name, kind: "list", items: items.length } },
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: { listId: list.id } };
}

export async function deleteList(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  listId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { error } = await sb.from("simple_lists").delete().eq("id", input.listId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "list_item",
    entityId: input.listId,
    action: "delete",
    changes: { before: { kind: "list" } },
    context: ctxAudit(ctx),
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}

export async function addListItem(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  listId: string;
  text: string;
}): Promise<ActionResult<{ itemId: string }>> {
  const { sb, userId, supabase } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const text = input.text.trim();
  if (!text) return { ok: false, error: "Texto vazio" };
  if (text.length > 1000) return { ok: false, error: "Texto muito longo" };

  const { data: maxData } = await supabase
    .from("simple_list_items")
    .select("order_index")
    .eq("list_id", input.listId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("simple_list_items")
    .insert({
      list_id: input.listId,
      text,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const item = data as unknown as SimpleListItemRow;

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: { itemId: item.id } };
}

export async function setListItemCompleted(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  itemId: string;
  completed: boolean;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const newCompletedAt = input.completed ? new Date().toISOString() : null;
  const { error } = await sb
    .from("simple_list_items")
    .update({ completed_at: newCompletedAt, updated_at: new Date().toISOString() })
    .eq("id", input.itemId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}

export async function deleteListItem(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  itemId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const { error } = await sb.from("simple_list_items").delete().eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}
