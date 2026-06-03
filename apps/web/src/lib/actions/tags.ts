"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type { TagRow, WorkspaceRow } from "../types";

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
    delete(): {
      eq(col: string, val: string): {
        eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
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

async function resolveWorkspace(slug: string) {
  const { supabase } = await getDb();
  const { data } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return data as unknown as WorkspaceRow | null;
}

/** Cria tag nova no workspace (qualquer membro pode criar). */
export async function createTag(input: {
  workspaceSlug: string;
  name: string;
  color?: string | null;
}): Promise<ActionResult<{ tagId: string }>> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 60) return { ok: false, error: "Nome muito longo (max 60)" };

  const ws = await resolveWorkspace(input.workspaceSlug);
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };

  const { data, error } = await sb
    .from("tags")
    .insert({
      workspace_id: ws.id,
      name,
      color: input.color?.trim() || "#64748B",
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const tag = data as unknown as TagRow;

  await audit({
    workspaceId: ws.id,
    entity: "tag",
    entityId: tag.id,
    action: "create",
    changes: { after: { name: tag.name, color: tag.color } },
    context: {},
  });

  revalidatePath(`/app/${input.workspaceSlug}`, "layout");
  return { ok: true, data: { tagId: tag.id } };
}

/** Exclui uma tag do workspace (admin/diretor). Remove tambem de flow_tags via cascade. */
export async function deleteTag(input: {
  workspaceSlug: string;
  tagId: string;
}): Promise<ActionResult> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };
  const ws = await resolveWorkspace(input.workspaceSlug);
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };

  const { error } = await sb.from("tags").delete().eq("id", input.tagId).eq("workspace_id", ws.id);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ws.id,
    entity: "tag",
    entityId: input.tagId,
    action: "delete",
    changes: {},
    context: {},
  });

  revalidatePath(`/app/${input.workspaceSlug}`, "layout");
  return { ok: true, data: undefined };
}

/** Atribui tag existente a um fluxo. */
export async function addTagToFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  tagId: string;
}): Promise<ActionResult> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { error } = await sb
    .from("flow_tags")
    .insert({
      flow_id: input.flowId,
      tag_id: input.tagId,
      added_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}

/** Remove tag de um fluxo. */
export async function removeTagFromFlow(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  tagId: string;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  // delete com 2 eq's encadeados nao tem tipo no Sb minimal; uso supabase direto
  const { error } = await (supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (
          c: string,
          v: string,
        ) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
      };
    };
  })
    .from("flow_tags")
    .delete()
    .eq("flow_id", input.flowId)
    .eq("tag_id", input.tagId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
  );
  return { ok: true, data: undefined };
}
