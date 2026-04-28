import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberAvatar } from "@/components/member-avatar";
import { FlowActions } from "./flow-actions";
import type {
  DirectoryRow,
  FlowRow,
  ProjectRow,
  WorkspaceMemberRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function FlowPage({
  params,
}: {
  params: Promise<{
    workspace: string;
    directory: string;
    project: string;
    flow: string;
  }>;
}) {
  const {
    workspace: wsSlug,
    directory: dirSlug,
    project: projectId,
    flow: flowId,
  } = await params;
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

  const { data: flw } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("project_id", project.id)
    .maybeSingle();
  const flow = flw as unknown as FlowRow | null;
  if (!flow) notFound();

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
  const creator = memberByUserId.get(flow.created_by);

  // can_edit_flow: admin OU diretor que criou o flow
  const isAdmin = ctx.member.role === "admin";
  const isOwnerDiretor =
    ctx.member.role === "diretor" && flow.created_by === ctx.member.user_id;
  const canEdit = isAdmin || isOwnerDiretor;
  const canDelete = canEdit;

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
          <span className="mx-2 text-slate-300">/</span>
          <Link
            href={`/app/${ctx.workspace.slug}/${directory.slug}/${project.id}`}
            className="hover:text-slate-900"
          >
            {project.name}
          </Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                {flow.name}
              </h1>
              <Badge
                label={flow.type === "continuous" ? "Continuo" : "Nao continuo"}
                tone="blue"
              />
              {flow.status === "archived" ? (
                <Badge label="Arquivado" tone="slate" />
              ) : flow.status === "completed" ? (
                <Badge label="Concluido" tone="green" />
              ) : null}
            </div>
            {flow.description ? (
              <p className="mt-2 max-w-2xl text-slate-600">{flow.description}</p>
            ) : null}
            {creator ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                <MemberAvatar
                  name={creator.google_full_name}
                  avatarUrl={creator.google_avatar_url}
                  size="sm"
                />
                <span>
                  criado por {creator.google_full_name} em{" "}
                  {new Date(flow.created_at).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
            ) : null}
          </div>
          {canEdit ? (
            <FlowActions
              workspaceSlug={ctx.workspace.slug}
              directorySlug={directory.slug}
              projectId={project.id}
              flow={flow}
              canDelete={canDelete}
            />
          ) : null}
        </div>
      </header>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Fases</h2>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">Fases vem na proxima sub-fase</p>
          <p className="mt-1 text-sm text-slate-500">
            Aqui as fases vao empilhar verticalmente, com checkboxes, comentarios,
            anexos e datas. Fluxo continuo reordena pela data; nao-continuo permite drag.
          </p>
        </div>
      </section>
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
