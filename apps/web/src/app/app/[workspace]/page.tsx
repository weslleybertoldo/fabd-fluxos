import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { getVisibleDirectoryIds } from "@/lib/visibility";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import { DirectoryIcon } from "@/components/directory-icon";
import { directoryInitials } from "@/lib/directory";
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
  const visibleIds = await getVisibleDirectoryIds(
    supabase,
    ctx.member.id,
    ctx.member.role,
  );
  let dirsQuery = supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("order_index", { ascending: true });
  if (visibleIds !== null && visibleIds.length === 0) {
    // Caso impossivel (helper nunca retorna [] — null OU lista nao-vazia),
    // mas defensivo: se vier vazio, mostra nada
    dirsQuery = dirsQuery.in("id", ["__none__"]);
  } else if (visibleIds !== null) {
    dirsQuery = dirsQuery.in("id", visibleIds);
  }
  const { data: dirs } = await dirsQuery;
  const directories = (dirs ?? []) as unknown as DirectoryRow[];

  return (
    <div className="space-y-6">
      <RealtimeWatcher
        channelName={`workspace-${ctx.workspace.id}`}
        subscriptions={[
          { table: "directories", filter: `workspace_id=eq.${ctx.workspace.id}` },
        ]}
      />
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
  return (
    <DirectoryIcon
      icon={directory.icon}
      imageUrl={directory.image_url}
      initials={directoryInitials(directory.name) || "FF"}
      bg={directory.color ?? "#1E3A8A"}
      alt={directory.name}
      sizePx={56}
    />
  );
}
