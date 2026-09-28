import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { getVisibleDirectoryIds } from "@/lib/visibility";
import { loadKanbanBoards } from "@/lib/kanban-data";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import { KanbanBoard } from "./kanban-board";
import { KanbanHeaderActions } from "./kanban-header-actions";
import { KanbanAutomationsPanel } from "./kanban-automations-panel";
import type {
  DirectoryRow,
  KanbanRow,
  ProjectRow,
  TagRow,
  WorkspaceMemberRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function KanbanPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; directory: string; project: string; kanban: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { workspace: wsSlug, directory: dirSlug, project: projectId, kanban: kanbanId } =
    await params;
  const { card: openCardId } = await searchParams;
  const ctx = await requireWorkspaceMember(wsSlug);
  const supabase = await createSupabaseServerClient();

  // Onda 1: diretoria + visibilidade + membros + tags (independentes)
  const [dirRes, visibleIds, membersRes, tagsRes] = await Promise.all([
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
    supabase
      .from("tags")
      .select("*")
      .eq("workspace_id", ctx.workspace.id)
      .order("name", { ascending: true }),
  ]);
  const directory = dirRes.data as unknown as DirectoryRow | null;
  if (!directory) notFound();
  if (visibleIds !== null && !visibleIds.includes(directory.id)) {
    redirect(`/app/${ctx.workspace.slug}?error=forbidden_directory`);
  }

  // Onda 2: projeto + Kanban (Kanban preso ao projeto pelo project_id)
  const [projRes, kbRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("directory_id", directory.id)
      .maybeSingle(),
    supabase
      .from("kanbans")
      .select("*")
      .eq("id", kanbanId)
      .eq("project_id", projectId)
      .maybeSingle(),
  ]);
  const project = projRes.data as unknown as ProjectRow | null;
  const kanban = kbRes.data as unknown as KanbanRow | null;
  if (!project || !kanban) notFound();

  // Ondas 3+: fases, cards, responsaveis, comentarios, automacoes e vinculos
  const [board] = await loadKanbanBoards(supabase, {
    workspace: ctx.workspace,
    visibleIds,
    member: ctx.member,
    project,
    kanbans: [kanban],
  });
  if (!board) notFound();

  const members = (membersRes.data ?? []) as unknown as Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url" | "role" | "status"
  >[];
  const workspaceTags = (tagsRes.data ?? []) as unknown as TagRow[];
  const availableTags = workspaceTags.map((t) => t.name);
  const tagColors: Record<string, string> = Object.fromEntries(
    workspaceTags.map((t) => [t.name, t.color]),
  );

  const projectHref = `/app/${ctx.workspace.slug}/${directory.slug}/${project.id}`;

  return (
    <div className="space-y-6">
      <RealtimeWatcher
        channelName={`kanban-${kanban.id}`}
        subscriptions={[
          { table: "kanbans", filter: `id=eq.${kanban.id}` },
          { table: "kanban_phases", filter: `kanban_id=eq.${kanban.id}` },
          { table: "kanban_cards", filter: `kanban_id=eq.${kanban.id}` },
          { table: "kanban_card_responsibles" },
          { table: "kanban_card_comments" },
          { table: "kanban_automations", filter: `source_kanban_id=eq.${kanban.id}` },
        ]}
      />
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
          <Link href={projectHref} className="hover:text-slate-900">
            {project.name}
          </Link>
        </p>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">{kanban.name}</h1>
              <span className="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-indigo-700">
                Kanban
              </span>
            </div>
            {kanban.description ? (
              <p className="mt-2 max-w-2xl whitespace-pre-line text-slate-600">
                {kanban.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <KanbanAutomationsPanel
              scope={{
                workspaceSlug: ctx.workspace.slug,
                directorySlug: directory.slug,
                projectId: project.id,
                kanbanId: kanban.id,
              }}
              canEdit={board.canEditKanban}
              sourcePhases={board.phases.map((p) => ({ id: p.id, name: p.name }))}
              automations={board.automationViews}
              targets={board.automationTargets}
            />
            {board.canEditKanban || board.canDeleteKanban ? (
              <KanbanHeaderActions
                workspaceSlug={ctx.workspace.slug}
                directorySlug={directory.slug}
                projectId={project.id}
                kanban={kanban}
                canEdit={board.canEditKanban}
                canDelete={board.canDeleteKanban}
              />
            ) : null}
          </div>
        </div>
      </header>

      <KanbanBoard
        workspaceSlug={ctx.workspace.slug}
        directorySlug={directory.slug}
        projectId={project.id}
        kanban={kanban}
        phases={board.phases}
        cards={board.cards}
        responsiblesByCard={board.responsiblesByCard}
        commentsByCard={board.commentsByCard}
        members={members}
        currentUserId={ctx.member.user_id}
        currentUserRole={ctx.member.role}
        canEditKanban={board.canEditKanban}
        availableTags={availableTags}
        tagColors={tagColors}
        initialOpenCardId={openCardId ?? null}
        originByCard={board.originByCard}
        generatedByCard={board.generatedByCard}
      />
    </div>
  );
}
