"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { WorkspaceRole } from "@fabd-fluxos/db";
import { audit } from "./audit";
import { notify } from "./notifications";
import type { WorkspaceMemberRow } from "../types";

type ActionResult = { ok: true } | { ok: false; error: string };

// O cliente gerado por @supabase/supabase-js v2.47 tem 4 generics que ainda nao
// batem 100% com Database<...> + ssr. Fazemos cast unico aqui pra desbloquear
// type-check do build sem perder a seguranca de runtime (RLS continua aplicando).
// TODO: remover este cast quando atualizarmos pra versao do client que aceita
// `Database` como generic unico.
type Sb = {
  from(table: string): {
    select(cols?: string): unknown;
    insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    update(values: Record<string, unknown>): {
      eq(col: string, val: string): {
        eq(col: string, val: string): {
          select(): {
            maybeSingle(): Promise<{
              data: WorkspaceMemberRow | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  };
};

async function getDb(): Promise<{
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  sb: Sb;
  userId: string | null;
  userMeta: { fullName: string | null; avatar: string | null; email: string | null };
}> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    supabase,
    sb: supabase as unknown as Sb,
    userId: user?.id ?? null,
    userMeta: {
      fullName:
        (user?.user_metadata?.full_name as string | undefined) ??
        (user?.user_metadata?.name as string | undefined) ??
        user?.email ??
        null,
      avatar:
        (user?.user_metadata?.avatar_url as string | undefined) ??
        (user?.user_metadata?.picture as string | undefined) ??
        null,
      email: user?.email ?? null,
    },
  };
}

/** O usuario logado solicita acesso a um workspace (cria pending). */
export async function requestMembership(slug: string): Promise<ActionResult> {
  const { supabase, sb, userId, userMeta } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };
  const workspaceId = (ws as { id: string }).id;

  const { error } = await sb.from("workspace_members").insert({
    workspace_id: workspaceId,
    user_id: userId,
    role: "membro",
    status: "pending",
    google_full_name: userMeta.fullName,
    google_avatar_url: userMeta.avatar,
    google_email: userMeta.email,
  });
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId,
    entity: "member",
    entityId: userId,
    action: "request",
    changes: { summary: `${userMeta.fullName ?? userId} solicitou acesso` },
    context: { workspace_slug: slug },
  });

  // Notifica todos os admins do workspace pra liberar
  const { data: admins } = await supabase
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "admin")
    .eq("status", "active");
  const adminIds = ((admins ?? []) as unknown as { user_id: string }[]).map(
    (a) => a.user_id,
  );
  for (const adminId of adminIds) {
    await notify({
      targetUserId: adminId,
      workspaceId,
      type: "member_request",
      title: `Novo pedido de acesso`,
      body: `${userMeta.fullName ?? "Alguem"} solicitou acesso ao workspace.`,
      entity: "member",
      entityId: userId,
      link: `/app/${slug}/admin/settings/members`,
    });
  }

  revalidatePath("/app");
  return { ok: true };
}

/** Admin aprova um membro pending — define role e status=active. */
export async function approveMember(
  workspaceId: string,
  memberId: string,
  role: WorkspaceRole,
): Promise<ActionResult> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: before } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  const beforeMember = before as unknown as WorkspaceMemberRow | null;
  if (!beforeMember) return { ok: false, error: "Member nao encontrado" };

  const { data: updated, error } = await sb
    .from("workspace_members")
    .update({
      role,
      status: "active",
      approved_by: userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Sem permissao ou member nao existe" };

  await audit({
    workspaceId,
    entity: "member",
    entityId: updated.user_id,
    action: "approve",
    changes: {
      before: { role: beforeMember.role, status: beforeMember.status },
      after: { role: updated.role, status: updated.status },
    },
    context: { member_name: updated.google_full_name },
  });

  // Notifica o user aprovado
  const { data: ws } = await supabase
    .from("workspaces")
    .select("slug, name")
    .eq("id", workspaceId)
    .maybeSingle();
  const wsRow = ws as unknown as { slug: string; name: string } | null;
  await notify({
    targetUserId: updated.user_id,
    workspaceId,
    type: "member_approved",
    title: `Acesso liberado em ${wsRow?.name ?? "workspace"}`,
    body: `Voce agora tem o papel "${updated.role}".`,
    entity: "workspace",
    entityId: workspaceId,
    link: wsRow?.slug ? `/app/${wsRow.slug}` : null,
  });

  revalidatePath(`/app`);
  return { ok: true };
}

/** Admin troca a role de um member ativo. */
export async function changeMemberRole(
  workspaceId: string,
  memberId: string,
  newRole: WorkspaceRole,
): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const { data: before } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  const beforeMember = before as unknown as WorkspaceMemberRow | null;
  if (!beforeMember) return { ok: false, error: "Member nao encontrado" };

  const { data: updated, error } = await sb
    .from("workspace_members")
    .update({ role: newRole })
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId,
    entity: "member",
    entityId: updated.user_id,
    action: "change_role",
    changes: { before: { role: beforeMember.role }, after: { role: updated.role } },
    context: { member_name: updated.google_full_name },
  });

  revalidatePath(`/app/${workspaceId}/admin/members`);
  return { ok: true };
}

/** Admin bloqueia um member (status=blocked). */
export async function blockMember(
  workspaceId: string,
  memberId: string,
): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const { data: before } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("id", memberId)
    .maybeSingle();
  const beforeMember = before as unknown as WorkspaceMemberRow | null;
  if (!beforeMember) return { ok: false, error: "Member nao encontrado" };

  const { data: updated, error } = await sb
    .from("workspace_members")
    .update({ status: "blocked" })
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId,
    entity: "member",
    entityId: updated.user_id,
    action: "block",
    changes: {
      before: { status: beforeMember.status },
      after: { status: updated.status },
    },
    context: { member_name: updated.google_full_name },
  });

  revalidatePath(`/app`);
  return { ok: true };
}
