import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/workspace";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceMember(slug);

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
        {ctx.member.role === "admin" ? (
          <div className="ml-auto flex gap-2">
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
          </div>
        ) : null}
      </nav>
      {children}
    </div>
  );
}
