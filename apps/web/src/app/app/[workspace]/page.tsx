import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { DirectoryRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceMember(slug);

  const supabase = await createSupabaseServerClient();
  const { data: dirs } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("order_index", { ascending: true });
  const directories = (dirs ?? []) as unknown as DirectoryRow[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{ctx.workspace.name}</h1>
        <p className="mt-2 text-slate-600">
          Selecione uma diretoria para ver projetos e fluxos.
        </p>
      </header>

      {directories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">Nenhuma diretoria criada</p>
          <p className="mt-1 text-sm text-slate-500">
            {ctx.member.role === "admin"
              ? "Crie a primeira diretoria pra organizar os projetos."
              : "Aguardando o administrador criar diretorias."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {directories.map((d) => (
            <li key={d.id}>
              <Link
                href={`/app/${ctx.workspace.slug}/${d.slug}`}
                className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-slate-300 hover:shadow-md"
              >
                <DirectoryThumb directory={d} />

                <h3 className="mt-4 text-lg font-semibold text-slate-900">{d.name}</h3>
                {d.description ? (
                  <p className="mt-1 text-sm text-slate-500">{d.description}</p>
                ) : null}
                <span className="mt-auto pt-4 text-xs uppercase tracking-wider text-slate-400">
                  Abrir
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectoryThumb({ directory }: { directory: DirectoryRow }) {
  const initials = directory.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const bg = directory.color ?? "#1E3A8A";
  return (
    <div
      className="grid size-14 place-items-center overflow-hidden rounded-2xl text-base font-bold text-white"
      style={{ backgroundColor: bg }}
    >
      {directory.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={directory.image_url}
          alt={directory.name}
          className="h-full w-full object-cover"
        />
      ) : (
        initials || "FF"
      )}
    </div>
  );
}
