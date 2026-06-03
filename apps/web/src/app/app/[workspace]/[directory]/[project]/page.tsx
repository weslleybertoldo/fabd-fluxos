import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { getVisibleDirectoryIds } from "@/lib/visibility";
import { MemberAvatar } from "@/components/member-avatar";
import { ProjectActions } from "./project-actions";
import { CreateFlowButton } from "./create-flow-button";
import { CreateChecklistButton } from "./create-checklist-button";
import { FlowsBoard } from "./flows-board";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import type {
  DirectoryRow,
  FlowCommentRow,
  FlowRow,
  PhaseAttachmentRow,
  PhaseFieldRow,
  PhaseFieldValueRow,
  PhaseResponsibleRow,
  PhaseRow,
  ProjectRow,
  TagRow,
  ChecklistRow,
  ChecklistSectionRow,
  ChecklistItemRow,
  WorkspaceMemberRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const FLOW_STATUS_LABELS: Record<string, string> = {
  active: "Ativos",
  archived: "Arquivados",
  completed: "Concluidos",
};

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string; directory: string; project: string }>;
  searchParams: Promise<{ flowStatus?: string }>;
}) {
  const { workspace: wsSlug, directory: dirSlug, project: projectId } = await params;
  const { flowStatus: flowStatusParam } = await searchParams;
  const ctx = await requireWorkspaceMember(wsSlug);

  const supabase = await createSupabaseServerClient();

  // Onda 1 (paralelo): directory + visibleIds + members — todas independentes
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

  // Onda 2: project (depende de directory.id)
  const { data: proj } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("directory_id", directory.id)
    .maybeSingle();
  const project = proj as unknown as ProjectRow | null;
  if (!project) notFound();

  const allMembers = (membersRes.data ?? []) as unknown as Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url" | "role" | "status"
  >[];
  const memberByUserId = new Map(allMembers.map((m) => [m.user_id, m]));

  // Tags do workspace (geridas no menu Acoes; selecionadas em itens/fases)
  const tagsRes = await supabase
    .from("tags")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("name", { ascending: true });
  const workspaceTags = (tagsRes.data ?? []) as unknown as TagRow[];
  const availableTags = workspaceTags.map((t) => t.name);
  const tagColors: Record<string, string> = Object.fromEntries(
    workspaceTags.map((t) => [t.name, t.color]),
  );

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
  // flw_insert exige admin ou diretor (no proprio workspace) — alinha com policy
  const canCreateFlow =
    project.status === "active" &&
    (ctx.member.role === "admin" || ctx.member.role === "diretor");

  // Carregar fluxos do projeto pelo status pedido (default = active)
  const flowStatus =
    flowStatusParam === "archived" || flowStatusParam === "completed"
      ? flowStatusParam
      : "active";

  // Onda 3 (paralelo): flows + checklists — todas dependem so de project.id
  const [flowsRes, checklistsRes] = await Promise.all([
    supabase
      .from("flows")
      .select("*")
      .eq("project_id", project.id)
      .eq("status", flowStatus)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("checklists")
      .select("*")
      .eq("project_id", project.id)
      .order("order_index", { ascending: true })
      .order("created_at", { ascending: false }),
  ]);
  const flows = (flowsRes.data ?? []) as unknown as FlowRow[];
  const checklists = (checklistsRes.data ?? []) as unknown as ChecklistRow[];

  // Onda 4 (paralelo): phases (flowIds) + checklist_sections (checklistIds)
  const flowIds = flows.map((f) => f.id);
  const checklistIds = checklists.map((c) => c.id);
  const [phasesRes, sectionsRes] = await Promise.all([
    flowIds.length
      ? supabase
          .from("phases")
          .select("*")
          .in("flow_id", flowIds)
          .order("order_index", { ascending: true })
      : Promise.resolve({ data: [] }),
    checklistIds.length
      ? supabase
          .from("checklist_sections")
          .select("*")
          .in("checklist_id", checklistIds)
          .order("order_index", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  const allPhases = (phasesRes.data ?? []) as unknown as PhaseRow[];
  const sections = (sectionsRes.data ?? []) as unknown as ChecklistSectionRow[];

  // Onda 4.1: checklist_items (sectionIds)
  const sectionIds = sections.map((s) => s.id);
  const itemsRes = sectionIds.length
    ? await supabase
        .from("checklist_items")
        .select("*")
        .in("section_id", sectionIds)
        .order("order_index", { ascending: true })
    : { data: [] };
  const checklistItems = (itemsRes.data ?? []) as unknown as ChecklistItemRow[];

  const sectionsByChecklist: Record<string, ChecklistSectionRow[]> = {};
  for (const s of sections) {
    (sectionsByChecklist[s.checklist_id] ??= []).push(s);
  }
  const itemsBySection: Record<string, ChecklistItemRow[]> = {};
  for (const it of checklistItems) {
    (itemsBySection[it.section_id] ??= []).push(it);
  }

  // Bulk loads pra alimentar o PhaseDetailModal (clique em mini-fase do board)
  const allPhaseIds = allPhases.map((p) => p.id);

  const [
    attsRes,
    fieldsRes,
    respRes,
    commentsRes,
  ] = await Promise.all([
    allPhaseIds.length
      ? supabase
          .from("phase_attachments")
          .select("*")
          .in("phase_id", allPhaseIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    allPhaseIds.length
      ? supabase
          .from("phase_fields")
          .select("*")
          .in("phase_id", allPhaseIds)
          .order("order_index", { ascending: true })
      : Promise.resolve({ data: [] }),
    allPhaseIds.length
      ? supabase
          .from("phase_responsibles")
          .select("phase_id, user_id, assigned_by, assigned_at")
          .in("phase_id", allPhaseIds)
      : Promise.resolve({ data: [] }),
    flowIds.length
      ? supabase
          .from("flow_comments")
          .select("*")
          .in("flow_id", flowIds)
          .not("phase_id", "is", null)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const attachments = (attsRes.data ?? []) as unknown as PhaseAttachmentRow[];
  const attachmentsByPhase: Record<string, PhaseAttachmentRow[]> = {};
  for (const a of attachments) {
    if (!attachmentsByPhase[a.phase_id]) attachmentsByPhase[a.phase_id] = [];
    attachmentsByPhase[a.phase_id]!.push(a);
  }

  const fields = (fieldsRes.data ?? []) as unknown as PhaseFieldRow[];
  const fieldsByPhase: Record<string, PhaseFieldRow[]> = {};
  for (const f of fields) {
    if (!fieldsByPhase[f.phase_id]) fieldsByPhase[f.phase_id] = [];
    fieldsByPhase[f.phase_id]!.push(f);
  }

  // Carregar values pelos field_ids
  const fieldIds = fields.map((f) => f.id);
  const { data: valuesData } = fieldIds.length
    ? await supabase
        .from("phase_field_values")
        .select("*")
        .in("phase_field_id", fieldIds)
    : { data: [] };
  const values = (valuesData ?? []) as unknown as PhaseFieldValueRow[];
  const valueByFieldPhase: Record<string, PhaseFieldValueRow> = {};
  for (const v of values) {
    valueByFieldPhase[`${v.phase_field_id}__${v.current_phase_id}`] = v;
  }

  const responsibles = (respRes.data ?? []) as unknown as PhaseResponsibleRow[];
  const responsiblesByPhase: Record<string, string[]> = {};
  for (const r of responsibles) {
    if (!responsiblesByPhase[r.phase_id]) responsiblesByPhase[r.phase_id] = [];
    responsiblesByPhase[r.phase_id]!.push(r.user_id);
  }

  const phaseComments = (commentsRes.data ?? []) as unknown as FlowCommentRow[];
  const commentsByPhase: Record<string, FlowCommentRow[]> = {};
  for (const c of phaseComments) {
    if (c.phase_id) {
      if (!commentsByPhase[c.phase_id]) commentsByPhase[c.phase_id] = [];
      commentsByPhase[c.phase_id]!.push(c);
    }
  }

  // Agrupar phases por flow_id, aplicando a regra de ordenacao do tipo do flow
  const phasesByFlow = new Map<string, PhaseRow[]>();
  for (const f of flows) {
    const list = allPhases.filter((p) => p.flow_id === f.id);
    if (f.type === "continuous") {
      list.sort((a, b) => {
        if (a.due_date && !b.due_date) return -1;
        if (!a.due_date && b.due_date) return 1;
        if (a.due_date && b.due_date) {
          const cmp = a.due_date.localeCompare(b.due_date);
          if (cmp !== 0) return cmp;
        }
        return a.order_index - b.order_index;
      });
    }
    phasesByFlow.set(f.id, list);
  }

  return (
    <div className="space-y-8">
      <RealtimeWatcher
        channelName={`project-${project.id}`}
        subscriptions={[
          { table: "projects", filter: `id=eq.${project.id}` },
          { table: "flows", filter: `project_id=eq.${project.id}` },
          { table: "reminders", filter: `project_id=eq.${project.id}` },
          { table: "checklists", filter: `project_id=eq.${project.id}` },
          // phases/sections/items sem coluna project_id direta — RLS filtra
          { table: "phases" },
          { table: "checklist_sections" },
          { table: "checklist_items" },
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
              tags={workspaceTags}
              canManageTags={
                project.status === "active" &&
                (ctx.member.role === "admin" || ctx.member.role === "diretor")
              }
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

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Fluxos</h2>
          <div className="flex flex-wrap items-center gap-2">
            {directory.show_reports ? (
              <Link
                href={`/app/${ctx.workspace.slug}/relatorios`}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                Relatorios
              </Link>
            ) : null}
            {canCreateFlow ? (
              <>
                <CreateChecklistButton
                  workspaceSlug={ctx.workspace.slug}
                  directorySlug={directory.slug}
                  projectId={project.id}
                />
                <CreateFlowButton
                  workspaceSlug={ctx.workspace.slug}
                  directorySlug={directory.slug}
                  projectId={project.id}
                />
              </>
            ) : null}
          </div>
        </div>

        <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
          {(["active", "archived", "completed"] as const).map((s) => {
            const isActive = s === flowStatus;
            const base = `/app/${ctx.workspace.slug}/${directory.slug}/${project.id}`;
            const href = s === "active" ? base : `${base}?flowStatus=${s}`;
            return (
              <Link
                key={s}
                href={href}
                className={[
                  "flex-1 rounded-lg px-3 py-1.5 text-center font-medium transition",
                  isActive
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900",
                ].join(" ")}
              >
                {FLOW_STATUS_LABELS[s]}
              </Link>
            );
          })}
        </nav>

        {flows.length === 0 && checklists.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <p className="font-medium text-slate-700">
              {flowStatus === "active"
                ? "Nenhum fluxo ativo"
                : flowStatus === "archived"
                  ? "Nenhum fluxo arquivado"
                  : "Nenhum fluxo concluido"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {!canCreateFlow && flowStatus === "active"
                ? "Aguardando admin ou diretor criar o primeiro fluxo."
                : flowStatus === "active"
                  ? "Use os botoes 'Criar fluxo' ou 'Criar checklist' acima pra comecar."
                  : null}
            </p>
          </div>
        ) : (
          <FlowsBoard
            id="listas"
            workspaceSlug={ctx.workspace.slug}
            directorySlug={directory.slug}
            projectId={project.id}
            projectResponsibleUserId={project.responsible_user_id}
            workspaceId={ctx.workspace.id}
            currentUserId={ctx.member.user_id}
            currentUserRole={ctx.member.role}
            flows={flows}
            phasesByFlow={Object.fromEntries(phasesByFlow)}
            fieldsByPhase={fieldsByPhase}
            valueByFieldPhase={valueByFieldPhase}
            attachmentsByPhase={attachmentsByPhase}
            commentsByPhase={commentsByPhase}
            responsiblesByPhase={responsiblesByPhase}
            members={allMembers}
            checklists={checklists}
            sectionsByChecklist={sectionsByChecklist}
            itemsBySection={itemsBySection}
            canEditChecklist={
              project.status === "active" &&
              (ctx.member.role === "admin" || ctx.member.role === "diretor")
            }
            availableTags={availableTags}
            tagColors={tagColors}
          />
        )}
      </section>

      {/* Secao "Lembretes" standalone removida da UI — lembretes agora sao por
          item de checklist. Os reminders existentes continuam disparando pelo cron. */}
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
