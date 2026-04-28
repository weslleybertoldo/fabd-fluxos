import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberAvatar } from "@/components/member-avatar";
import { FlowActions } from "./flow-actions";
import { PhasesPanel } from "./phases-panel";
import { CommentsPanel } from "./comments-panel";
import { FlowTagsEditor } from "./flow-tags-editor";
import { RealtimeWatcher } from "@/components/realtime-watcher";
import type {
  DirectoryRow,
  FlowCommentRow,
  FlowRow,
  FlowTagRow,
  PhaseRow,
  ProjectRow,
  TagRow,
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

  // Carregar fases — ordenacao depende do tipo do fluxo:
  //  continuous: por due_date asc (sem data vai pro fim) e order_index como tiebreak
  //  non_continuous: por order_index asc (drag-drop manual)
  const { data: phData } = await supabase
    .from("phases")
    .select("*")
    .eq("flow_id", flow.id)
    .order("order_index", { ascending: true });
  const allPhases = (phData ?? []) as unknown as PhaseRow[];

  const phases =
    flow.type === "continuous"
      ? [...allPhases].sort((a, b) => {
          // sem due_date vai pro fim
          if (a.due_date && !b.due_date) return -1;
          if (!a.due_date && b.due_date) return 1;
          if (a.due_date && b.due_date) {
            const cmp = a.due_date.localeCompare(b.due_date);
            if (cmp !== 0) return cmp;
          }
          return a.order_index - b.order_index;
        })
      : allPhases;

  const completedCount = phases.filter((p) => p.completed_at).length;
  const allComplete = phases.length > 0 && completedCount === phases.length;

  const { data: commentsData } = await supabase
    .from("flow_comments")
    .select("*")
    .eq("flow_id", flow.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const comments = (commentsData ?? []) as unknown as FlowCommentRow[];

  // Tags do workspace + tags atribuidas a este fluxo
  const { data: tagsData } = await supabase
    .from("tags")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("name", { ascending: true });
  const allTags = (tagsData ?? []) as unknown as TagRow[];

  const { data: flowTagsData } = await supabase
    .from("flow_tags")
    .select("*")
    .eq("flow_id", flow.id);
  const flowTagIds = ((flowTagsData ?? []) as unknown as FlowTagRow[]).map(
    (ft) => ft.tag_id,
  );

  // Bulk load attachments de todas as fases deste fluxo
  const phaseIds = phases.map((p) => p.id);
  const { data: attsData } = phaseIds.length
    ? await supabase
        .from("phase_attachments")
        .select("*")
        .in("phase_id", phaseIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
    : { data: [] };
  const attachments = (attsData ?? []) as unknown as Array<
    import("@/lib/types").PhaseAttachmentRow
  >;
  const attachmentsByPhase: Record<string, typeof attachments> = {};
  for (const a of attachments) {
    if (!attachmentsByPhase[a.phase_id]) attachmentsByPhase[a.phase_id] = [];
    attachmentsByPhase[a.phase_id]!.push(a);
  }

  // Bulk load phase_fields + values
  const { data: fieldsData } = phaseIds.length
    ? await supabase
        .from("phase_fields")
        .select("*")
        .in("phase_id", phaseIds)
        .order("order_index", { ascending: true })
    : { data: [] };
  const allFields = (fieldsData ?? []) as unknown as Array<
    import("@/lib/types").PhaseFieldRow
  >;
  const fieldsByPhase: Record<string, typeof allFields> = {};
  for (const f of allFields) {
    if (!fieldsByPhase[f.phase_id]) fieldsByPhase[f.phase_id] = [];
    fieldsByPhase[f.phase_id]!.push(f);
  }

  const fieldIds = allFields.map((f) => f.id);
  const { data: valuesData } = fieldIds.length
    ? await supabase
        .from("phase_field_values")
        .select("*")
        .in("phase_field_id", fieldIds)
    : { data: [] };
  const allValues = (valuesData ?? []) as unknown as Array<
    import("@/lib/types").PhaseFieldValueRow
  >;
  // Mapa: `${field_id}__${phase_id}` → value
  const valueByFieldPhase: Record<
    string,
    import("@/lib/types").PhaseFieldValueRow
  > = {};
  for (const v of allValues) {
    valueByFieldPhase[`${v.phase_field_id}__${v.current_phase_id}`] = v;
  }

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
      <RealtimeWatcher
        channelName={`flow-${flow.id}`}
        subscriptions={[
          { table: "flows", filter: `id=eq.${flow.id}` },
          { table: "phases", filter: `flow_id=eq.${flow.id}` },
          { table: "flow_comments", filter: `flow_id=eq.${flow.id}` },
          { table: "flow_tags", filter: `flow_id=eq.${flow.id}` },
          // attachments/fields/values nao tem coluna flow_id direta — escutamos todos
          // do schema e o RLS filtra. Custo extra eh aceitavel.
          { table: "phase_attachments" },
          { table: "phase_fields" },
          { table: "phase_field_values" },
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
            <div className="mt-3">
              <FlowTagsEditor
                workspaceSlug={ctx.workspace.slug}
                directorySlug={directory.slug}
                projectId={project.id}
                flowId={flow.id}
                canEdit={canEdit}
                allTags={allTags}
                flowTagIds={flowTagIds}
              />
            </div>
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

      {allComplete ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-2xl font-bold text-emerald-700">
            Parabens — fluxo concluido!
          </p>
          <p className="mt-1 text-sm text-emerald-700/80">
            Todas as {phases.length} fases foram marcadas como concluidas.
          </p>
        </section>
      ) : null}

      <PhasesPanel
        workspaceSlug={ctx.workspace.slug}
        directorySlug={directory.slug}
        projectId={project.id}
        flowId={flow.id}
        flowType={flow.type}
        canEdit={canEdit}
        currentUserId={ctx.member.user_id}
        workspaceId={ctx.workspace.id}
        phases={phases}
        attachmentsByPhase={attachmentsByPhase}
        fieldsByPhase={fieldsByPhase}
        valueByFieldPhase={valueByFieldPhase}
      />

      <CommentsPanel
        workspaceSlug={ctx.workspace.slug}
        directorySlug={directory.slug}
        projectId={project.id}
        flowId={flow.id}
        currentUserId={ctx.member.user_id}
        currentUserRole={ctx.member.role}
        comments={comments}
        authors={Object.fromEntries(
          allMembers.map((m) => [m.user_id, m]),
        )}
      />
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
