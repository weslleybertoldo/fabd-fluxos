import Link from "next/link";
import { requireWorkspaceAdmin } from "@/lib/workspace";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  await requireWorkspaceAdmin(slug);

  return (
    <div className="space-y-6">
      <nav className="flex gap-2 border-b border-slate-200 pb-3">
        <AdminTab href={`/app/${slug}/admin/members`} label="Membros" />
        <AdminTab href={`/app/${slug}/admin/audit`} label="Historico de acoes" />
      </nav>
      {children}
    </div>
  );
}

function AdminTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
    >
      {label}
    </Link>
  );
}
