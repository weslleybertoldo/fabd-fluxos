import Link from "next/link";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Configuracao do workspace</h1>
        <p className="mt-1 text-sm text-slate-600">
          Diretorias, membros e ajustes gerais.
        </p>
      </header>
      <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
        <SubTab href={`/app/${slug}/admin/settings/directories`} label="Diretorias" />
        <SubTab href={`/app/${slug}/admin/settings/members`} label="Membros" />
      </nav>
      {children}
    </div>
  );
}

function SubTab({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex-1 rounded-lg px-3 py-1.5 text-center font-medium text-slate-500 transition hover:text-slate-900"
    >
      {label}
    </Link>
  );
}
