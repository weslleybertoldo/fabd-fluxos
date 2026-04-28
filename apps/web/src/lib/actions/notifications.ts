"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { EntityType } from "@fabd-fluxos/db";
import type { NotificationRow, NotificationType } from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type Sb = {
  from(table: string): {
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        is(col: string, val: null): Promise<{ error: { message: string } | null }>;
      };
    };
  };
  rpc(name: string, args: Record<string, unknown>): Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
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

/**
 * Helper interno chamado por outras actions pra criar uma notificacao
 * para outro usuario do workspace.
 * Não falha a operacao chamadora se a notificacao falhar.
 */
export async function notify(input: {
  targetUserId: string;
  workspaceId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entity?: EntityType | null;
  entityId?: string | null;
  link?: string | null;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const { error } = await sb.rpc("notify_user", {
    p_target_user_id: input.targetUserId,
    p_workspace_id: input.workspaceId,
    p_type: input.type,
    p_title: input.title,
    p_body: input.body ?? null,
    p_entity: input.entity ?? null,
    p_entity_id: input.entityId ?? null,
    p_link: input.link ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function getMyNotifications(input: {
  workspaceSlug: string;
  limit?: number;
  unreadOnly?: boolean;
}): Promise<ActionResult<{ notifications: NotificationRow[]; unreadCount: number }>> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", input.workspaceSlug)
    .maybeSingle();
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };
  const workspaceId = (ws as unknown as { id: string }).id;

  // Lista
  let q = supabase
    .from("notifications")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 30);
  if (input.unreadOnly) q = q.is("read_at", null);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };

  const notifications = (data ?? []) as unknown as NotificationRow[];

  // Contagem unread total
  const { count } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("read_at", null);

  return {
    ok: true,
    data: { notifications, unreadCount: count ?? 0 },
  };
}

export async function markNotificationRead(input: {
  workspaceSlug: string;
  notificationId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();
  const { error } = await sb
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", input.notificationId)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/${input.workspaceSlug}`, "layout");
  return { ok: true, data: undefined };
}

export async function markAllNotificationsRead(input: {
  workspaceSlug: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", input.workspaceSlug)
    .maybeSingle();
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };
  const workspaceId = (ws as unknown as { id: string }).id;

  // multi-eq sem o tipo Sb minimal — usar supabase direto
  type SbUpdate = {
    from: (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string,
        ) => {
          eq: (
            c: string,
            v: string,
          ) => {
            is: (c: string, v: null) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
  };
  const { error } = await (supabase as unknown as SbUpdate)
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/app/${input.workspaceSlug}`, "layout");
  return { ok: true, data: undefined };
}
