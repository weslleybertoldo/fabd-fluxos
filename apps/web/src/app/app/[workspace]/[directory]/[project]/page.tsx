import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberAvatar } from "@/components/member-avatar";
import { ProjectActions } from "./project-actions";
import type {
  DirectoryRow,
  ProjectRow,
  WorkspaceMemberRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ workspace: string; directory: string; project: string }>;
}) {
  const { workspace: wsSlug, directory: dirSlug, project: projectId } = await params;
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

  const { data: proj } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("directory_id", directory.id)
    .maybeSingle();
  const project = proj as unknown as ProjectRow | null;
  if (!project) notFound();

  // Members ativos pra picker de responsavel
  const { data: membersData } = await supabase
    .from("workspace_members")
    .select("user_id, google_full_name, google_avatar_url, role, status")
    .eq("workspace_id", ctx.workspace.id)
    .eq("status", "active")
    .order("google_full_name", { ascending: true });
  const allMembers = (membersData ?? []) as unknown as Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url" | "role" | "status"
  >[];
  const memberByUserId = new Map(allMembers.map((m) => [m.user_id, m]));

  const responsible = project.responsible_user_id
    ? memberByUserId.get(project.responsible_user_id)
    : null;
  const creator = memberByUserId.get(project.created_by);

  // Permissoes alinhadas com policies prj_update / prj_delete
  const isAdmin = ctx.member.role === "admin";
  const isOwnerDiretor =
    ctx.member.role === "diretor" && project.created_by === ctx.member.user_id;
  const canEdit = isAdmin || isOwnerDiretor;
  const canDelete = isAdmin;

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-sm text-slate-500">
          <Link href={`/app/${ctx.workspace.slug}`} className="hover:text-slate-900">
            {ctx.workspace.name}
          </Link>
          <span className="mx-2 text-slate-300">/</span>
          <Link
            href={`/app/${ctx.workspace.slug}/${directory.slug}`}
            className="hover:text-slate-900"
          >
            {directory.name}
          </Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {project.name}
              </h1>
              {project.status === "archived" ? (
                <Badge label="Arquivado" tone="slate" />
              ) : project.status === "completed" ? (
                <Badge label="Concluido" tone="green" />
              ) : (
                <Badge label="Ativo" tone="blue" />
              )}
            </div>
            {project.description ? (
              <p className="mt-2 max-w-2xl text-slate-600">{project.description}</p>
            ) : null}
          </div>
          {canEdit ? (
            <ProjectActions
              workspaceSlug={ctx.workspace.slug}
              directorySlug={directory.slug}
              project={project}
              members={allMembers}
              canDelete={canDelete}
            />
          ) : null}
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card title="Responsavel">
          {responsible ? (
            <div className="flex items-center gap-3">
              <MemberAvatar
                name={responsible.google_full_name}
                avatarUrl={responsible.google_avatar_url}
                size="md"
              />
              <div>
                <p className="font-medium text-slate-900">
                  {responsible.google_full_name}
                </p>
                <p className="text-xs text-slate-500">
                  Recebe notificacoes de todas as fases
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">Nenhum responsavel atribuido</p>
          )}
        </Card>
        <Card title="Criado por">
          {creator ? (
            <div className="flex items-center gap-3">
              <MemberAvatar
                name={creator.google_full_name}
                avatarUrl={creator.google_avatar_url}
                size="md"
              />
              <div>
                <p className="font-medium text-slate-900">{creator.google_full_name}</p>
                <p className="text-xs text-slate-500">
                  {new Date(project.created_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm italic text-slate-400">desconhecido</p>
          )}
        </Card>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Fluxos</h2>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">Fluxos vem na Fase 5</p>
          <p className="mt-1 text-sm text-slate-500">
            Aqui voce vai criar fluxos continuos (cronograma) ou nao continuos (sem ordem),
            cada um com fases, comentarios, anexos e responsaveis.
          </p>
        </div>
      </section>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Badge({
  label,
  tone,
}: {
  label: string;
  tone: "slate" | "green" | "blue";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
