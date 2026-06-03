"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderBoard } from "@/lib/actions/checklists";
import { createPhase, setPhaseCompleted } from "@/lib/actions/phases";
import { PhaseDetailModal } from "./[flow]/phase-detail-modal";
import { PhaseModal } from "./[flow]/phase-edit-modals";
import { ChecklistColumn } from "./checklist-column";
import type {
  ChecklistItemRow,
  ChecklistRow,
  ChecklistSectionRow,
  FlowCommentRow,
  FlowRow,
  PhaseAttachmentRow,
  PhaseFieldRow,
  PhaseFieldValueRow,
  PhaseRow,
  WorkspaceMemberRow,
} from "@/lib/types";

type MemberLite = Pick<
  WorkspaceMemberRow,
  "user_id" | "google_full_name" | "google_avatar_url"
>;

// Coluna do board: um fluxo OU uma pilha de checklists (mesma stack_id).
type Column =
  | { kind: "flow"; id: string; order: number; createdAt: string; flow: FlowRow }
  | { kind: "stack"; id: string; order: number; createdAt: string; checklists: ChecklistRow[] };

const colDndId = (c: Column) => `${c.kind}:${c.id}`;

// Agrupa checklists por stack_id (pilhas), ordena verticalmente por stack_pos, e
// mistura com os fluxos numa ordem horizontal por order_index.
function buildColumns(flows: FlowRow[], checklists: ChecklistRow[]): Column[] {
  const groups = new Map<string, ChecklistRow[]>();
  for (const c of checklists) {
    const key = c.stack_id ?? c.id;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }
  const cols: Column[] = [
    ...flows.map((f) => ({
      kind: "flow" as const,
      id: f.id,
      order: f.order_index,
      createdAt: f.created_at,
      flow: f,
    })),
    ...Array.from(groups.entries()).map(([key, list]) => {
      const sorted = [...list].sort(
        (a, b) => a.stack_pos - b.stack_pos || a.created_at.localeCompare(b.created_at),
      );
      return {
        kind: "stack" as const,
        id: key,
        order: Math.min(...sorted.map((c) => c.order_index)),
        createdAt: sorted[0]!.created_at,
        checklists: sorted,
      };
    }),
  ];
  const rank = (k: Column["kind"]) => (k === "flow" ? 0 : 1);
  cols.sort(
    (a, b) => a.order - b.order || rank(a.kind) - rank(b.kind) || a.createdAt.localeCompare(b.createdAt),
  );
  return cols;
}

function columnsToPayload(cols: Column[]) {
  return cols.map((c) =>
    c.kind === "flow"
      ? { type: "flow" as const, id: c.id }
      : { type: "stack" as const, checklistIds: c.checklists.map((x) => x.id) },
  );
}

interface Props {
  id?: string;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  projectResponsibleUserId: string | null;
  workspaceId: string;
  currentUserId: string;
  currentUserRole: string;
  flows: FlowRow[];
  phasesByFlow: Record<string, PhaseRow[]>;
  fieldsByPhase: Record<string, PhaseFieldRow[]>;
  valueByFieldPhase: Record<string, PhaseFieldValueRow>;
  attachmentsByPhase: Record<string, PhaseAttachmentRow[]>;
  commentsByPhase: Record<string, FlowCommentRow[]>;
  responsiblesByPhase: Record<string, string[]>;
  members: MemberLite[];
  checklists?: ChecklistRow[];
  sectionsByChecklist?: Record<string, ChecklistSectionRow[]>;
  itemsBySection?: Record<string, ChecklistItemRow[]>;
  canEditChecklist?: boolean;
  availableTags?: string[];
  tagColors?: Record<string, string>;
}

export function FlowsBoard({
  id,
  workspaceSlug,
  directorySlug,
  projectId,
  projectResponsibleUserId,
  workspaceId,
  currentUserId,
  currentUserRole,
  flows: initialFlows,
  phasesByFlow,
  fieldsByPhase,
  valueByFieldPhase,
  attachmentsByPhase,
  commentsByPhase,
  responsiblesByPhase,
  members,
  checklists = [],
  sectionsByChecklist = {},
  itemsBySection = {},
  canEditChecklist = false,
  availableTags = [],
  tagColors = {},
}: Props) {
  const router = useRouter();
  const [cols, setCols] = useState<Column[]>(() => buildColumns(initialFlows, checklists));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [openDetail, setOpenDetail] = useState<{ phase: PhaseRow; flow: FlowRow } | null>(null);
  const [creatingFor, setCreatingFor] = useState<FlowRow | null>(null);

  const memberByUserId = new Map(members.map((m) => [m.user_id, m]));
  const authorsMap = Object.fromEntries(members.map((m) => [m.user_id, m]));

  useEffect(() => {
    setCols(buildColumns(initialFlows, checklists));
  }, [initialFlows, checklists]);

  function persist(next: Column[]) {
    setCols(next);
    start(async () => {
      const r = await reorderBoard({
        workspaceSlug,
        directorySlug,
        projectId,
        columns: columnsToPayload(next),
      });
      if (!r.ok) {
        setError(r.error);
        setCols(buildColumns(initialFlows, checklists));
        return;
      }
      router.refresh();
    });
  }

  // Desempilha uma checklist: vira sua propria pilha no fim do board.
  function unstack(checklist: ChecklistRow) {
    const next: Column[] = [];
    for (const c of cols) {
      if (c.kind === "stack") {
        const rest = c.checklists.filter((x) => x.id !== checklist.id);
        if (rest.length) next.push({ ...c, checklists: rest });
      } else {
        next.push(c);
      }
    }
    next.push({
      kind: "stack",
      id: checklist.id,
      order: next.length,
      createdAt: checklist.created_at,
      checklists: [checklist],
    });
    persist(next);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const isAdmin = currentUserRole === "admin";

  function canEditFlow(flow: FlowRow): boolean {
    if (isAdmin) return true;
    if (currentUserRole === "diretor") {
      if (flow.created_by === currentUserId) return true;
      if (projectResponsibleUserId === currentUserId) return true;
    }
    return false;
  }

  // Editar/concluir uma fase especifica: vale canEditFlow OU ser responsavel da fase
  function canEditPhase(flow: FlowRow, phase: PhaseRow): boolean {
    if (canEditFlow(flow)) return true;
    return responsiblesByPhase[phase.id]?.includes(currentUserId) ?? false;
  }

  // Pra reordenar o board (fluxos + checklists): so admin. Diretor nao reordena.
  const canReorder = isAdmin;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const a = cols.find((c) => colDndId(c) === active.id);
    const o = cols.find((c) => colDndId(c) === over.id);
    if (!a || !o) return;

    // soltar uma pilha de checklist sobre outra pilha => empilha (merge)
    if (a.kind === "stack" && o.kind === "stack") {
      const merged: Column = { ...o, checklists: [...o.checklists, ...a.checklists] };
      const next = cols.filter((c) => c !== a).map((c) => (c === o ? merged : c));
      persist(next);
      return;
    }

    // caso contrario: reordena as colunas horizontalmente
    const oldIndex = cols.indexOf(a);
    const newIndex = cols.indexOf(o);
    persist(arrayMove(cols, oldIndex, newIndex));
  }

  function submitCreatePhase(flow: FlowRow, formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const dueDate = (formData.get("due_date") as string) ?? "";
    const color = (formData.get("color") as string) ?? "";
    start(async () => {
      const r = await createPhase({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId: flow.id,
        name,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        color: color || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreatingFor(null);
      router.refresh();
    });
  }

  function togglePhase(flow: FlowRow, phase: PhaseRow) {
    if (!canEditPhase(flow, phase)) return;
    setError(null);
    start(async () => {
      const r = await setPhaseCompleted({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId: flow.id,
        phaseId: phase.id,
        completed: !phase.completed_at,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div id={id} className="space-y-3 scroll-mt-4">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {canReorder ? (
        <p className="text-xs text-slate-500">
          Arraste pelo cabecalho pra reordenar. Solte uma checklist sobre outra pra
          empilhar (uma abaixo da outra).
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={canReorder ? handleDragEnd : undefined}
      >
        <div className="-mx-2 flex items-start gap-3 overflow-x-auto px-2 pb-3">
          <SortableContext items={cols.map(colDndId)} strategy={horizontalListSortingStrategy}>
            {cols.map((c) =>
              c.kind === "flow" ? (
                <SortableFlowColumn
                  key={colDndId(c)}
                  flow={c.flow}
                  phases={phasesByFlow[c.id] ?? []}
                  workspaceSlug={workspaceSlug}
                  directorySlug={directorySlug}
                  projectId={projectId}
                  canEdit={canEditFlow(c.flow)}
                  canTogglePhase={(p) => canEditPhase(c.flow, p)}
                  canReorder={canReorder}
                  pending={pending}
                  onTogglePhase={(p) => togglePhase(c.flow, p)}
                  onOpenPhase={(p) => setOpenDetail({ phase: p, flow: c.flow })}
                  onAddPhase={() => setCreatingFor(c.flow)}
                  tagColors={tagColors}
                />
              ) : (
                <SortableStackColumn
                  key={colDndId(c)}
                  stackId={c.id}
                  checklists={c.checklists}
                  sectionsByChecklist={sectionsByChecklist}
                  itemsBySection={itemsBySection}
                  workspaceSlug={workspaceSlug}
                  directorySlug={directorySlug}
                  projectId={projectId}
                  canEditChecklist={canEditChecklist}
                  isAdmin={isAdmin}
                  currentUserId={currentUserId}
                  canReorder={canReorder}
                  pending={pending}
                  onUnstack={unstack}
                  availableTags={availableTags}
                  tagColors={tagColors}
                />
              ),
            )}
          </SortableContext>
        </div>
      </DndContext>

      {openDetail ? (
        <PhaseDetailModal
          key={`detail-${openDetail.phase.id}`}
          workspaceSlug={workspaceSlug}
          directorySlug={directorySlug}
          projectId={projectId}
          flowId={openDetail.flow.id}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          canEdit={canEditFlow(openDetail.flow)}
          canEditContent={canEditPhase(openDetail.flow, openDetail.phase)}
          phase={openDetail.phase}
          fields={fieldsByPhase[openDetail.phase.id] ?? []}
          valueByFieldPhase={valueByFieldPhase}
          attachments={attachmentsByPhase[openDetail.phase.id] ?? []}
          comments={commentsByPhase[openDetail.phase.id] ?? []}
          responsibleUsers={(responsiblesByPhase[openDetail.phase.id] ?? [])
            .map((uid) => memberByUserId.get(uid))
            .filter((m): m is MemberLite => !!m)}
          responsibleIds={responsiblesByPhase[openDetail.phase.id] ?? []}
          members={members}
          authors={authorsMap}
          availableTags={availableTags}
          tagColors={tagColors}
          onClose={() => setOpenDetail(null)}
        />
      ) : null}

      {creatingFor ? (
        <PhaseModal
          key={`create-${creatingFor.id}`}
          title={`Nova fase em "${creatingFor.name}"`}
          submitLabel="Criar fase"
          onSubmit={(fd) => submitCreatePhase(creatingFor, fd)}
          onClose={() => !pending && setCreatingFor(null)}
          pending={pending}
          error={error}
        />
      ) : null}
    </div>
  );
}

function SortableStackColumn(props: {
  stackId: string;
  checklists: ChecklistRow[];
  sectionsByChecklist: Record<string, ChecklistSectionRow[]>;
  itemsBySection: Record<string, ChecklistItemRow[]>;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canEditChecklist: boolean;
  isAdmin: boolean;
  currentUserId: string;
  canReorder: boolean;
  pending: boolean;
  onUnstack: (cl: ChecklistRow) => void;
  availableTags: string[];
  tagColors: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `stack:${props.stackId}`, disabled: !props.canReorder || props.pending });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const dragHandle = {
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: listeners as unknown as Record<string, unknown> | undefined,
  };
  const stacked = props.checklists.length > 1;
  return (
    <div ref={setNodeRef} style={style} className="flex w-80 shrink-0 flex-col gap-2">
      {props.checklists.map((cl) => (
        <ChecklistColumn
          key={cl.id}
          checklist={cl}
          sections={props.sectionsByChecklist[cl.id] ?? []}
          itemsBySection={props.itemsBySection}
          workspaceSlug={props.workspaceSlug}
          directorySlug={props.directorySlug}
          projectId={props.projectId}
          canEdit={
            props.canEditChecklist && (props.isAdmin || cl.created_by === props.currentUserId)
          }
          canReorder={props.canReorder}
          dragHandle={dragHandle}
          onUnstack={stacked && props.canReorder ? () => props.onUnstack(cl) : undefined}
          availableTags={props.availableTags}
          tagColors={props.tagColors}
        />
      ))}
    </div>
  );
}

function SortableFlowColumn(props: {
  flow: FlowRow;
  phases: PhaseRow[];
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canEdit: boolean;
  canTogglePhase: (phase: PhaseRow) => boolean;
  canReorder: boolean;
  pending: boolean;
  onTogglePhase: (phase: PhaseRow) => void;
  onOpenPhase: (phase: PhaseRow) => void;
  onAddPhase: () => void;
  tagColors: Record<string, string>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: `flow:${props.flow.id}`, disabled: !props.canReorder || props.pending });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex w-80 shrink-0 flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"
    >
      <FlowColumnHeader
        flow={props.flow}
        workspaceSlug={props.workspaceSlug}
        directorySlug={props.directorySlug}
        projectId={props.projectId}
        canReorder={props.canReorder}
        canEdit={props.canEdit}
        pending={props.pending}
        drag={{ attributes, listeners }}
        onAddPhase={props.onAddPhase}
      />
      <FlowColumnBody
        phases={props.phases}
        canTogglePhase={props.canTogglePhase}
        pending={props.pending}
        flowType={props.flow.type}
        onTogglePhase={props.onTogglePhase}
        onOpenPhase={props.onOpenPhase}
        tagColors={props.tagColors}
      />
    </div>
  );
}

type DragHandleProps = {
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
};

function FlowColumnHeader({
  flow,
  workspaceSlug,
  directorySlug,
  projectId,
  canReorder,
  canEdit,
  pending,
  drag,
  onAddPhase,
}: {
  flow: FlowRow;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canReorder: boolean;
  canEdit: boolean;
  pending: boolean;
  drag: DragHandleProps;
  onAddPhase: () => void;
}) {
  const href = `/app/${workspaceSlug}/${directorySlug}/${projectId}/${flow.id}`;
  return (
    <header
      className={`flex items-start gap-2 rounded-xl bg-white p-3 ${
        canReorder ? "cursor-grab active:cursor-grabbing" : ""
      }`}
      {...(canReorder ? drag.attributes : {})}
      {...(canReorder && drag.listeners ? drag.listeners : {})}
    >
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="line-clamp-2 text-sm font-semibold text-slate-900 hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {flow.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-600">
            {flow.type === "continuous" ? "Continuo" : "Nao continuo"}
          </span>
          {flow.status === "archived" ? (
            <Badge label="Arquivado" tone="slate" />
          ) : flow.status === "completed" ? (
            <Badge label="Concluido" tone="green" />
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={onAddPhase}
          onPointerDown={(e) => e.stopPropagation()}
          disabled={pending}
          aria-label="Adicionar fase"
          title="Adicionar fase"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      ) : null}
      {canReorder ? (
        <span className="shrink-0 text-slate-300" aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </span>
      ) : null}
    </header>
  );
}

function FlowColumnBody({
  phases,
  canTogglePhase,
  pending,
  flowType,
  onTogglePhase,
  onOpenPhase,
  tagColors,
}: {
  phases: PhaseRow[];
  canTogglePhase: (phase: PhaseRow) => boolean;
  pending: boolean;
  flowType: "continuous" | "non_continuous";
  onTogglePhase: (phase: PhaseRow) => void;
  onOpenPhase: (phase: PhaseRow) => void;
  tagColors: Record<string, string>;
}) {
  if (phases.length === 0) {
    return (
      <p className="rounded-xl bg-white px-3 py-4 text-center text-xs italic text-slate-400">
        Sem fases ainda
      </p>
    );
  }
  const completedCount = phases.filter((p) => p.completed_at).length;
  const allComplete = completedCount === phases.length;
  return (
    <>
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span>
          {completedCount}/{phases.length} concluidas
        </span>
        {allComplete ? (
          <span className="font-semibold text-emerald-600">Tudo pronto!</span>
        ) : null}
      </div>
      <ol className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto pr-1">
        {phases.map((p, i) => (
          <PhaseMiniCard
            key={p.id}
            phase={p}
            index={i}
            canEdit={canTogglePhase(p)}
            pending={pending}
            flowType={flowType}
            onToggle={() => onTogglePhase(p)}
            onOpen={() => onOpenPhase(p)}
            tagColors={tagColors}
          />
        ))}
      </ol>
    </>
  );
}

function PhaseMiniCard({
  phase,
  index,
  canEdit,
  pending,
  flowType,
  onToggle,
  onOpen,
  tagColors,
}: {
  phase: PhaseRow;
  index: number;
  canEdit: boolean;
  pending: boolean;
  flowType: "continuous" | "non_continuous";
  onToggle: () => void;
  onOpen: () => void;
  tagColors: Record<string, string>;
}) {
  const completed = !!phase.completed_at;
  const isOverdue =
    !completed && phase.due_date && new Date(phase.due_date) < new Date();
  const tone = completed
    ? "border-emerald-200 bg-emerald-50"
    : isOverdue
      ? "border-red-200 bg-red-50"
      : "border-slate-200 bg-white";
  return (
    <li
      className={`flex items-start gap-2 rounded-xl border p-2 ${tone}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!canEdit || pending}
        aria-label={completed ? "Marcar como nao concluida" : "Marcar como concluida"}
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition ${
          completed
            ? "border-emerald-500 bg-emerald-500 text-white"
            : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
        } disabled:opacity-50`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-baseline gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            #{index + 1}
          </span>
          <p
            className={`truncate text-sm font-medium hover:text-blue-700 hover:underline ${
              completed ? "text-emerald-900 line-through" : "text-slate-900"
            }`}
          >
            {phase.name}
          </p>
        </div>
        {phase.due_date ? (
          <p
            className={`text-[10px] ${
              isOverdue ? "font-semibold text-red-700" : "text-slate-500"
            }`}
          >
            {formatShortDate(phase.due_date)}
            {isOverdue ? " · vencida" : null}
          </p>
        ) : flowType === "continuous" ? (
          <p className="text-[10px] italic text-slate-400">Sem data</p>
        ) : null}
      </button>
      {phase.description && phase.description.trim() ? (
        <span title="Tem descricao" className="shrink-0 font-bold text-amber-500">
          !
        </span>
      ) : null}
      {(phase.tags?.length ?? 0) > 0 ? (
        <span
          title={`Tags: ${phase.tags.join(", ")}`}
          className="mt-0.5 inline-block h-4 w-1.5 shrink-0 rounded-sm"
          style={{ backgroundColor: tagColors[phase.tags[0]!] ?? "#9333ea" }}
        />
      ) : null}
      {phase.reminder_recurrence ? (
        <span title="Tem lembrete" className="shrink-0 text-[11px] text-slate-400">
          🔔
        </span>
      ) : null}
    </li>
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
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
    blue: "bg-blue-100 text-blue-700",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {label}
    </span>
  );
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}
