"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type { DirectoryRow, WorkspaceRow } from "../types";

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

async function resolveWorkspace(
  workspaceSlug: string,
): Promise<{ ok: true; workspace: WorkspaceRow } | { ok: false; error: string }> {
  const { supabase } = await getDb();
  const { data: ws } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  const workspace = ws as unknown as WorkspaceRow | null;
  if (!workspace) return { ok: false, error: "Workspace nao encontrado" };
  return { ok: true, workspace };
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function createDirectory(input: {
  workspaceSlug: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
}): Promise<ActionResult<{ directoryId: string; slug: string }>> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 100) return { ok: false, error: "Nome muito longo (max 100)" };

  const ctx = await resolveWorkspace(input.workspaceSlug);
  if (!ctx.ok) return ctx;

  const baseSlug = slugify(name) || `dir-${Date.now()}`;
  let candidate = baseSlug;
  for (let i = 2; i <= 50; i++) {
    const { data: existing } = await supabase
      .from("directories")
      .select("id")
      .eq("workspace_id", ctx.workspace.id)
      .eq("slug", candidate)
      .maybeSingle();
    if (!existing) break;
    candidate = `${baseSlug}-${i}`;
  }

  const { data: maxData } = await supabase
    .from("directories")
    .select("order_index")
    .eq("workspace_id", ctx.workspace.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("directories")
    .insert({
      workspace_id: ctx.workspace.id,
      name,
      slug: candidate,
      description: input.description?.trim() || null,
      icon: input.icon?.trim() || null,
      color: input.color?.trim() || "#1E3A8A",
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra criar diretoria" };

  const dir = data as unknown as DirectoryRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "directory",
    entityId: dir.id,
    action: "create",
    changes: {
      after: { name: dir.name, slug: dir.slug, icon: dir.icon, color: dir.color },
    },
    context: { directory_name: dir.name },
  });

  revalidatePath(`/app/${input.workspaceSlug}`);
  revalidatePath(`/app/${input.workspaceSlug}/admin/settings`);
  return { ok: true, data: { directoryId: dir.id, slug: dir.slug } };
}

export async function updateDirectory(input: {
  workspaceSlug: string;
  directorySlug: string;
  name?: string;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  imageUrl?: string | null;
  showReports?: boolean;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveWorkspace(input.workspaceSlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .eq("slug", input.directorySlug)
    .maybeSingle();
  const beforeRow = before as unknown as DirectoryRow | null;
  if (!beforeRow) return { ok: false, error: "Diretoria nao encontrada" };

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Nome obrigatorio" };
    if (n.length > 100) return { ok: false, error: "Nome muito longo (max 100)" };
    patch.name = n;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.icon !== undefined) {
    patch.icon = input.icon?.trim() || null;
  }
  if (input.color !== undefined) {
    patch.color = input.color?.trim() || "#1E3A8A";
  }
  if (input.imageUrl !== undefined) {
    patch.image_url = input.imageUrl;
  }
  if (input.showReports !== undefined) {
    patch.show_reports = input.showReports;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from("directories")
    .update(patch)
    .eq("id", beforeRow.id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra editar diretoria" };

  const after = data as unknown as DirectoryRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "directory",
    entityId: beforeRow.id,
    action: "update",
    changes: {
      before: {
        name: beforeRow.name,
        icon: beforeRow.icon,
        color: beforeRow.color,
        image_url: beforeRow.image_url,
        show_reports: beforeRow.show_reports,
      },
      after: {
        name: after.name,
        icon: after.icon,
        color: after.color,
        image_url: after.image_url,
        show_reports: after.show_reports,
      },
    },
    context: {
      directory_id: beforeRow.id,
      directory_slug: beforeRow.slug,
      directory_name: after.name,
    },
  });

  revalidatePath(`/app/${input.workspaceSlug}`);
  revalidatePath(`/app/${input.workspaceSlug}/admin/settings`);
  return { ok: true, data: undefined };
}

export async function deleteDirectory(input: {
  workspaceSlug: string;
  directorySlug: string;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveWorkspace(input.workspaceSlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .eq("slug", input.directorySlug)
    .maybeSingle();
  const beforeRow = before as unknown as DirectoryRow | null;
  if (!beforeRow) return { ok: false, error: "Diretoria nao encontrada" };

  const { error } = await sb.from("directories").delete().eq("id", beforeRow.id);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "directory",
    entityId: beforeRow.id,
    action: "delete",
    changes: { before: { name: beforeRow.name, slug: beforeRow.slug } },
    context: { directory_name: beforeRow.name },
  });

  revalidatePath(`/app/${input.workspaceSlug}`);
  revalidatePath(`/app/${input.workspaceSlug}/admin/settings`);
  return { ok: true, data: undefined };
}

/**
 * Persiste ordem manual das diretorias: recebe IDs ordenados e atualiza order_index.
 * So admin do workspace (RLS dir_update).
 */
export async function reorderDirectories(input: {
  workspaceSlug: string;
  directoryIds: string[];
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveWorkspace(input.workspaceSlug);
  if (!ctx.ok) return ctx;

  for (let i = 0; i < input.directoryIds.length; i++) {
    const id = input.directoryIds[i];
    if (!id) continue;
    const { error } = await sb
      .from("directories")
      .update({ order_index: i, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: `Reorder ${id}: ${error.message}` };
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "workspace",
    entityId: ctx.workspace.id,
    action: "reorder",
    changes: { after: { directory_ids: input.directoryIds } },
    context: { directory_count: input.directoryIds.length },
  });

  revalidatePath(`/app/${input.workspaceSlug}`);
  revalidatePath(`/app/${input.workspaceSlug}/admin/settings/directories`);
  return { ok: true, data: undefined };
}

/**
 * Persiste a image_url depois do upload client direto no Storage.
 * Recebe a URL publica que o client obteve via getPublicUrl().
 */
export async function setDirectoryImageUrl(input: {
  workspaceSlug: string;
  directorySlug: string;
  imageUrl: string | null;
}): Promise<ActionResult> {
  return updateDirectory({
    workspaceSlug: input.workspaceSlug,
    directorySlug: input.directorySlug,
    imageUrl: input.imageUrl,
  });
}
