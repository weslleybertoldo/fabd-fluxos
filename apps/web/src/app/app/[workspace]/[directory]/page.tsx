import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { DirectoryRow, ProjectRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DirectoryPage({
  params,
}: {
  params: Promise<{ workspace: string; directory: string }>;
}) {
  const { workspace: wsSlug, directory: dirSlug } = await params;
  const ctx = await requireWorkspaceMember(wsSlug);

  const supabase = await createSupabaseServerClient();

  const { data: dir } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .eq("slug", dirSlug)
    .maybeSingle();
  const directory = dir as unknown as DirectoryRow | null;
  if (!directory) notFound();

  const { data: projs } = await supabase
    .from("projects")
    .select("*")
    .eq("directory_id", directory.id)
    .order("order_index", { ascending: true });
  const projects = (projs ?? []) as unknown as ProjectRow[];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">
          <Link href={`/app/${ctx.workspace.slug}`} className="hover:text-slate-900">
            {ctx.workspace.name}
          </Link>
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{directory.name}</h1>
        <p className="mt-2 text-slate-600">
          Projetos da diretoria {directory.name}.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">Nenhum projeto ainda</p>
          <p className="mt-1 text-sm text-slate-500">
            {ctx.member.role === "membro"
              ? "Aguardando o admin ou diretor criar o primeiro projeto."
              : "Use o botao abaixo para criar o primeiro projeto (em breve)."}
          </p>
          {ctx.member.role !== "membro" ? (
            <button
              type="button"
              disabled
              className="mt-6 rounded-xl bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              Criar projeto (Fase 4)
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="rounded-2xl border border-slate-200 bg-white p-6"
            >
              <h3 className="text-lg font-semibold text-slate-900">{p.name}</h3>
              {p.description ? (
                <p className="mt-1 text-sm text-slate-500">{p.description}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
