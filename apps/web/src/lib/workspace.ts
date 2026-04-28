import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { WorkspaceContext, WorkspaceRow, WorkspaceMemberRow } from "./types";

/**
 * Resolve o contexto do workspace pelo slug e garante que o usuario logado eh
 * member ATIVO. Redireciona pra /app se nao for.
 */
export async function requireWorkspaceMember(slug: string): Promise<WorkspaceContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");

  const { data: ws } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!ws) redirect("/app?error=workspace_not_found");

  const workspace = ws as unknown as WorkspaceRow;

  const { data: m } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();

  const member = m as unknown as WorkspaceMemberRow | null;
  if (!member || member.status !== "active") {
    redirect(`/app?pending=${slug}`);
  }

  return { workspace, member };
}

/** Apenas admin do workspace passa. */
export async function requireWorkspaceAdmin(slug: string): Promise<WorkspaceContext> {
  const ctx = await requireWorkspaceMember(slug);
  if (ctx.member.role !== "admin") {
    redirect(`/app/${slug}?error=forbidden`);
  }
  return ctx;
}
