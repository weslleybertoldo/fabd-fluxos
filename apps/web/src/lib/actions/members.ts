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

/** Busca workspace pelo UUID via RPC SECURITY DEFINER (bypassa RLS pra
 * permitir descoberta por ID). Retorna nome+slug+status do user atual. */
export async function findWorkspaceById(workspaceId: string): Promise<
  | { ok: true; data: {
      id: string;
      name: string;
      slug: string;
      member_status: string | null;
      member_role: string | null;
    } }
  | { ok: false; error: string }
> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  // Validacao basica do UUID antes de chamar RPC
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(workspaceId.trim())) {
    return { ok: false, error: "ID invalido — cole o UUID completo do workspace" };
  }

  const sb = supabase as unknown as {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await sb.rpc("find_workspace_by_id", {
    p_workspace_id: workspaceId.trim(),
  });
  if (error) return { ok: false, error: error.message };

  const rows = data as Array<{
    id: string;
    name: string;
    slug: string;
    member_status: string | null;
    member_role: string | null;
  }> | null;
  const row = rows?.[0];
  if (!row) return { ok: false, error: "Workspace nao encontrado pra este ID" };
  return { ok: true, data: row };
}

/** O usuario logado solicita acesso a um workspace (cria pending). */
export async function requestMembership(slug: string): Promise<ActionResult> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: ws } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!ws) return { ok: false, error: "Workspace nao encontrado" };
  const workspaceId = (ws as { id: string }).id;
  return persistMembershipRequest(workspaceId, slug);
}

/** Variant que recebe o UUID direto — usado quando user descobriu workspace
 *  via find_workspace_by_id (RPC SECURITY DEFINER). RLS de workspaces
 *  bloqueia .select("slug") pra anon-member, entao buscamos slug via RPC. */
export async function requestMembershipById(workspaceId: string): Promise<ActionResult> {
  const found = await findWorkspaceById(workspaceId);
  if (!found.ok) return found;
  // Ja eh member ativo? sem repetir
  if (found.data.member_status === "active") {
    return { ok: false, error: "Voce ja eh membro ativo deste workspace" };
  }
  if (found.data.member_status === "pending") {
    return { ok: false, error: "Solicitacao ja enviada — aguarde aprovacao" };
  }
  if (found.data.member_status === "blocked") {
    return { ok: false, error: "Acesso bloqueado neste workspace" };
  }
  return persistMembershipRequest(found.data.id, found.data.slug);
}

async function persistMembershipRequest(
  workspaceId: string,
  slug: string,
): Promise<ActionResult> {
  const { supabase, sb, userId, userMeta } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

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

const SENIOR_ADMIN_EMAIL = "weslleybertoldo18@gmail.com";

/** Cria um novo workspace + ja vira admin/active member.
 *  Restrito ao senior admin (RLS + RPC fazem dupla checagem). */
export async function createWorkspace(input: {
  name: string;
  slug: string;
}): Promise<{ ok: true; data: { id: string; slug: string } } | { ok: false; error: string }> {
  const { supabase, userId, userMeta } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };
  if ((userMeta.email ?? "").toLowerCase() !== SENIOR_ADMIN_EMAIL) {
    return { ok: false, error: "Apenas o senior admin pode criar workspaces" };
  }

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 80) return { ok: false, error: "Nome muito longo (max 80)" };

  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(slug)) {
    return { ok: false, error: "Slug invalido (use a-z, 0-9, hifen; 2-60 chars)" };
  }

  const sb = supabase as unknown as {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await sb.rpc("create_workspace_as_senior_admin", {
    p_name: name,
    p_slug: slug,
  });
  if (error) return { ok: false, error: error.message };

  const ws = data as { id: string; slug: string } | null;
  if (!ws?.id) return { ok: false, error: "Falha ao criar workspace" };

  revalidatePath("/app");
  return { ok: true, data: { id: ws.id, slug: ws.slug } };
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

/** Admin remove definitivamente um member do workspace.
 * Cascade apaga member_directory_access. Tabelas com FK pra auth.users
 * (responsible_user_id, created_by, etc) NAO sao afetadas.
 * Bloqueios: nao pode deletar a si mesmo nem o ultimo admin do workspace. */
export async function deleteMember(
  workspaceId: string,
  memberId: string,
): Promise<ActionResult> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: target } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("id", memberId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const targetMember = target as unknown as WorkspaceMemberRow | null;
  if (!targetMember) return { ok: false, error: "Member nao encontrado" };

  if (targetMember.user_id === userId) {
    return { ok: false, error: "Nao da pra excluir voce mesmo do workspace" };
  }

  // Garantia: nao deixar o workspace sem admin
  if (targetMember.role === "admin" && targetMember.status === "active") {
    const { count } = await supabase
      .from("workspace_members")
      .select("*", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("role", "admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) {
      return { ok: false, error: "Este e o unico admin ativo — promova outro antes de excluir" };
    }
  }

  const { error } = await sb
    .from("workspace_members")
    .delete()
    .eq("id", memberId)
    .eq("workspace_id", workspaceId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId,
    entity: "member",
    entityId: targetMember.user_id,
    action: "delete",
    changes: {
      before: {
        role: targetMember.role,
        status: targetMember.status,
        member_name: targetMember.google_full_name,
        member_email: targetMember.google_email,
      },
    },
    context: { member_name: targetMember.google_full_name },
  });

  revalidatePath(`/app`);
  return { ok: true };
}

/**
 * Admin define quais diretorias um member pode acessar.
 * Sem nenhuma linha = membro ve TODAS as diretorias do workspace (default).
 * Com 1+ linhas = ve SO essas. Admin sempre ve tudo (gate aplicado em runtime).
 */
export async function setMemberDirectoryAccess(input: {
  workspaceId: string;
  workspaceMemberId: string;
  directoryIds: string[]; // novo set completo (substitui anterior)
}): Promise<ActionResult> {
  const { supabase, sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { data: targetMember } = await supabase
    .from("workspace_members")
    .select("id, user_id, workspace_id, google_full_name")
    .eq("id", input.workspaceMemberId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  const member = targetMember as unknown as
    | { id: string; user_id: string; workspace_id: string; google_full_name: string | null }
    | null;
  if (!member) return { ok: false, error: "Membro nao encontrado neste workspace" };

  const { data: existingData } = await supabase
    .from("member_directory_access")
    .select("directory_id")
    .eq("workspace_member_id", input.workspaceMemberId);
  const existing = ((existingData ?? []) as unknown as { directory_id: string }[]).map(
    (r) => r.directory_id,
  );

  const desired = Array.from(new Set(input.directoryIds.filter(Boolean)));
  const toAdd = desired.filter((d) => !existing.includes(d));
  const toRemove = existing.filter((d) => !desired.includes(d));

  for (const dirId of toRemove) {
    const { error } = await sb
      .from("member_directory_access")
      .delete()
      .eq("workspace_member_id", input.workspaceMemberId)
      .eq("directory_id", dirId);
    if (error) return { ok: false, error: error.message };
  }

  for (const dirId of toAdd) {
    const { error } = await sb
      .from("member_directory_access")
      .insert({
        workspace_member_id: input.workspaceMemberId,
        directory_id: dirId,
        granted_by: userId,
      });
    if (error) return { ok: false, error: error.message };
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await audit({
      workspaceId: input.workspaceId,
      entity: "member",
      entityId: member.user_id,
      action: "update",
      changes: {
        before: { directory_access: existing },
        after: { directory_access: desired },
      },
      context: { member_name: member.google_full_name },
    });
  }

  revalidatePath(`/app`);
  return { ok: true };
}

