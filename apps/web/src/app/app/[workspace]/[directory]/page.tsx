import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { getVisibleDirectoryIds } from "@/lib/visibility";
import { CreateProjectButton } from "./create-project-button";
import { ProjectsGrid } from "./projects-grid";
import type {
  DirectoryRow,
  ProjectRow,
  WorkspaceMemberRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  active: "Ativos",
  archived: "Arquivados",
  completed: "Concluidos",
};

export default async function DirectoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; directory: string }>;
  searchParams: Promise<{ status?: string; error?: string }>;
}) {
  const { workspace: wsSlug, directory: dirSlug } = await params;
  const { status: statusParam, error: errorParam } = await searchParams;
  const ctx = await requireWorkspaceMember(wsSlug);

  const supabase = await createSupabaseServerClient();

  // Onda 1: dir + visibleIds + members em paralelo
  const [dirRes, visibleIds, membersRes] = await Promise.all([
    supabase
      .from("directories")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .eq("slug", dirSlug)
      .maybeSingle(),
    getVisibleDirectoryIds(supabase, ctx.member.id, ctx.member.role),
    supabase
      .from("workspace_members")
      .select("user_id, google_full_name, google_avatar_url, role, status")
      .eq("workspace_id", ctx.workspace.id)
      .eq("status", "active")
      .order("google_full_name", { ascending: true }),
  ]);
  const directory = dirRes.data as unknown as DirectoryRow | null;
  if (!directory) notFound();

  if (visibleIds !== null && !visibleIds.includes(directory.id)) {
    redirect(`/app/${ctx.workspace.slug}?error=forbidden_directory`);
  }

  const status =
    statusParam === "archived" || statusParam === "completed"
      ? statusParam
      : "active";

  const { data: projs } = await supabase
    .from("projects")
    .select("*")
    .eq("directory_id", directory.id)
    .eq("status", status)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: false });
  const projects = (projs ?? []) as unknown as ProjectRow[];

  const allMembers = (membersRes.data ?? []) as unknown as Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url" | "role" | "status"
  >[];

  // Lookup rapido por user_id pra mostrar nome/foto do responsavel
  const memberByUserId = new Map(allMembers.map((m) => [m.user_id, m]));

  const canCreate = ctx.member.role === "admin" || ctx.member.role === "diretor";

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-slate-500">
          <Link href={`/app/${ctx.workspace.slug}`} className="hover:text-slate-900">
            {ctx.workspace.name}
          </Link>
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {directory.name}
            </h1>
            {directory.description ? (
              <p className="mt-1 text-slate-600">{directory.description}</p>
            ) : null}
          </div>
          {canCreate ? (
            <CreateProjectButton
              workspaceSlug={ctx.workspace.slug}
              directorySlug={directory.slug}
              members={allMembers}
              defaultResponsibleId={ctx.member.user_id}
            />
          ) : null}
        </div>
      </header>

      {errorParam === "forbidden" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          Voce nao tem permissao pra essa acao.
        </p>
      ) : null}

      <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
        {(["active", "archived", "completed"] as const).map((s) => {
          const isActive = s === status;
          return (
            <Link
              key={s}
              href={`/app/${ctx.workspace.slug}/${directory.slug}${s === "active" ? "" : `?status=${s}`}`}
              className={[
                "flex-1 rounded-lg px-3 py-1.5 text-center font-medium transition",
                isActive
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900",
              ].join(" ")}
            >
              {STATUS_LABELS[s]}
            </Link>
          );
        })}
      </nav>

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">
            {status === "active"
              ? "Nenhum projeto ativo"
              : status === "archived"
                ? "Nenhum projeto arquivado"
                : "Nenhum projeto concluido"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {!canCreate && status === "active"
              ? "Aguardando o admin ou diretor criar o primeiro projeto."
              : status === "active"
                ? "Use o botao 'Criar projeto' acima pra comecar."
                : null}
          </p>
        </div>
      ) : (
        <ProjectsGrid
          workspaceSlug={ctx.workspace.slug}
          directorySlug={directory.slug}
          projects={projects}
          membersByUserId={Object.fromEntries(memberByUserId)}
          canReorder={ctx.member.role === "admin" && status === "active"}
        />
      )}
    </div>
  );
}

