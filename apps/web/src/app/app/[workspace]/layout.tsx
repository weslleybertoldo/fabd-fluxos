import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { NotificationsBell } from "@/components/notifications-bell";
import type { NotificationRow } from "@/lib/types";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceMember(slug);

  // Carregar notificacoes do user neste workspace pra bell icon
  const supabase = await createSupabaseServerClient();
  const { data: notifData } = await supabase
    .from("notifications")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .eq("user_id", ctx.member.user_id)
    .order("created_at", { ascending: false })
    .limit(30);
  const notifications = (notifData ?? []) as unknown as NotificationRow[];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const isAdmin = ctx.member.role === "admin";

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap items-center gap-3 border-b border-slate-200 pb-4">
        <Link
          href={`/app/${ctx.workspace.slug}`}
          className="text-sm font-semibold text-slate-900"
        >
          {ctx.workspace.name}
        </Link>
        <Link
          href="/app?picker=1"
          className="text-xs text-slate-500 hover:text-slate-900"
        >
          (trocar workspace)
        </Link>
        <div className="ml-auto flex items-center gap-2">
          {isAdmin ? (
            <>
              <Link
                href={`/app/${ctx.workspace.slug}/admin/settings`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Configuracao
              </Link>
              <Link
                href={`/app/${ctx.workspace.slug}/admin/audit`}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Historico
              </Link>
            </>
          ) : null}
          <NotificationsBell
            workspaceSlug={ctx.workspace.slug}
            initialUnreadCount={unreadCount}
            initialNotifications={notifications}
          />
        </div>
      </nav>
      {children}
    </div>
  );
}
