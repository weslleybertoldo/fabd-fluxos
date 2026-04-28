"use client";

import { useEffect, useState, useTransition } from "react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createPhase,
  deletePhase,
  reorderPhases,
  setPhaseCompleted,
  setPhaseResponsibles,
  updatePhase,
} from "@/lib/actions/phases";
import { PhaseAttachments } from "./phase-attachments";
import { PhaseFields } from "./phase-fields";
import { MemberAvatar } from "@/components/member-avatar";
import type {
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

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  currentUserId: string;
  workspaceId: string;
  phases: PhaseRow[];
  attachmentsByPhase: Record<string, PhaseAttachmentRow[]>;
  fieldsByPhase: Record<string, PhaseFieldRow[]>;
  valueByFieldPhase: Record<string, PhaseFieldValueRow>;
  responsiblesByPhase: Record<string, string[]>;
  members: MemberLite[];
}

export function PhasesPanel({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  flowType,
  canEdit,
  currentUserId,
  workspaceId,
  phases: initialPhases,
  attachmentsByPhase,
  fieldsByPhase,
  valueByFieldPhase,
  responsiblesByPhase,
  members,
}: Props) {
  const router = useRouter();
  const [phases, setPhases] = useState<PhaseRow[]>(initialPhases);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PhaseRow | null>(null);
  const [managingResp, setManagingResp] = useState<PhaseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const memberByUserId = new Map(members.map((m) => [m.user_id, m]));

  // Sincroniza quando o servidor manda novas props (apos router.refresh)
  useEffect(() => {
    setPhases(initialPhases);
  }, [initialPhases]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function renderExtras(p: PhaseRow) {
    return (
      <div className="space-y-4">
        <PhaseFields
          workspaceSlug={workspaceSlug}
          directorySlug={directorySlug}
          projectId={projectId}
          flowId={flowId}
          phaseId={p.id}
          canEditFields={canEdit}
          fields={fieldsByPhase[p.id] ?? []}
          valueByFieldPhase={valueByFieldPhase}
        />
        <PhaseAttachments
          workspaceSlug={workspaceSlug}
          directorySlug={directorySlug}
          projectId={projectId}
          flowId={flowId}
          phaseId={p.id}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          canEditPhase={canEdit}
          attachments={attachmentsByPhase[p.id] ?? []}
        />
      </div>
    );
  }

  function refresh() {
    router.refresh();
  }

  function submitCreate(formData: FormData) {
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
        flowId,
        name,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        color: color || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreating(false);
      refresh();
    });
  }

  function submitEdit(phase: PhaseRow, formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const dueDate = (formData.get("due_date") as string) ?? "";
    const color = (formData.get("color") as string) ?? "";
    start(async () => {
      const r = await updatePhase({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        name,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        color: color || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(null);
      refresh();
    });
  }

  function toggleComplete(phase: PhaseRow) {
    setError(null);
    start(async () => {
      const r = await setPhaseCompleted({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        completed: !phase.completed_at,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      refresh();
    });
  }

  function submitResponsibles(phase: PhaseRow, formData: FormData) {
    setError(null);
    const userIds = formData.getAll("responsibleIds").map(String).filter(Boolean);
    start(async () => {
      const r = await setPhaseResponsibles({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        userIds,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setManagingResp(null);
      refresh();
    });
  }

  function remove(phase: PhaseRow) {
    if (
      !confirm(`Excluir a fase "${phase.name}" e tudo dentro dela? Acao irreversivel.`)
    )
      return;
    setError(null);
    start(async () => {
      const r = await deletePhase({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      refresh();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = phases.findIndex((p) => p.id === active.id);
    const newIndex = phases.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(phases, oldIndex, newIndex);
    setPhases(reordered); // optimistic
    start(async () => {
      const r = await reorderPhases({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseIds: reordered.map((p) => p.id),
      });
      if (!r.ok) {
        setError(r.error);
        setPhases(initialPhases); // rollback
        return;
      }
      refresh();
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Fases</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            + Adicionar fase
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {phases.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="font-medium text-slate-700">Nenhuma fase ainda</p>
          <p className="mt-1 text-sm text-slate-500">
            {canEdit
              ? "Clique em '+ Adicionar fase' pra criar a primeira."
              : "Aguardando o admin/diretor criar fases neste fluxo."}
          </p>
        </div>
      ) : flowType === "non_continuous" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={canEdit ? handleDragEnd : undefined}
        >
          <SortableContext
            items={phases.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <ol className="space-y-3">
              {phases.map((p, i) => (
                <SortablePhaseItem
                  key={p.id}
                  phase={p}
                  index={i}
                  flowType={flowType}
                  canEdit={canEdit}
                  pending={pending}
                  onToggle={() => toggleComplete(p)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => remove(p)}
                  onManageResponsibles={() => setManagingResp(p)}
                  responsibleUsers={(responsiblesByPhase[p.id] ?? [])
                    .map((uid) => memberByUserId.get(uid))
                    .filter((m): m is MemberLite => !!m)}
                  extras={renderExtras(p)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      ) : (
        <ContinuousGroupedList
          phases={phases}
          flowType={flowType}
          canEdit={canEdit}
          pending={pending}
          onToggle={toggleComplete}
          onEdit={setEditing}
          onDelete={remove}
          onManageResponsibles={setManagingResp}
          responsiblesByPhase={responsiblesByPhase}
          memberByUserId={memberByUserId}
          renderExtras={renderExtras}
        />
      )}

      {creating ? (
        <PhaseModal
          title="Nova fase"
          submitLabel="Criar fase"
          onSubmit={submitCreate}
          onClose={() => !pending && setCreating(false)}
          pending={pending}
          error={error}
        />
      ) : null}

      {editing ? (
        <PhaseModal
          key={editing.id}
          title="Editar fase"
          submitLabel="Salvar"
          phase={editing}
          onSubmit={(fd) => submitEdit(editing, fd)}
          onClose={() => !pending && setEditing(null)}
          pending={pending}
          error={error}
        />
      ) : null}

      {managingResp ? (
        <PhaseResponsiblesModal
          key={`resp-${managingResp.id}`}
          phase={managingResp}
          members={members}
          currentIds={responsiblesByPhase[managingResp.id] ?? []}
          onSubmit={(fd) => submitResponsibles(managingResp, fd)}
          onClose={() => !pending && setManagingResp(null)}
          pending={pending}
          error={error}
        />
      ) : null}
    </section>
  );
}

function ContinuousGroupedList({
  phases,
  flowType,
  canEdit,
  pending,
  onToggle,
  onEdit,
  onDelete,
  onManageResponsibles,
  responsiblesByPhase,
  memberByUserId,
  renderExtras,
}: {
  phases: PhaseRow[];
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  pending: boolean;
  onToggle: (p: PhaseRow) => void;
  onEdit: (p: PhaseRow) => void;
  onDelete: (p: PhaseRow) => void;
  onManageResponsibles: (p: PhaseRow) => void;
  responsiblesByPhase: Record<string, string[]>;
  memberByUserId: Map<string, MemberLite>;
  renderExtras?: (p: PhaseRow) => React.ReactNode;
}) {
  const respUsers = (p: PhaseRow): MemberLite[] =>
    (responsiblesByPhase[p.id] ?? [])
      .map((uid) => memberByUserId.get(uid))
      .filter((m): m is MemberLite => !!m);
  // Agrupa por dia (YYYY-MM-DD); fases sem data ficam cada uma no proprio grupo
  const groups: PhaseRow[][] = [];
  let lastDay: string | null = null;
  for (const p of phases) {
    const day = p.due_date ? p.due_date.slice(0, 10) : null;
    const last = groups[groups.length - 1];
    if (day && day === lastDay && last) {
      last.push(p);
    } else {
      groups.push([p]);
      lastDay = day;
    }
  }

  // Index continuo (#1, #2, ...) atravessando grupos
  let counter = 0;

  return (
    <ol className="space-y-3">
      {groups.map((group, gi) => {
        const startIdx = counter;
        counter += group.length;
        if (group.length === 1) {
          const single = group[0]!;
          return (
            <li key={`g-${gi}`}>
              <PhaseCard
                phase={single}
                index={startIdx}
                flowType={flowType}
                canEdit={canEdit}
                pending={pending}
                onToggle={() => onToggle(single)}
                onEdit={() => onEdit(single)}
                onDelete={() => onDelete(single)}
                onManageResponsibles={() => onManageResponsibles(single)}
                responsibleUsers={respUsers(single)}
                extras={renderExtras ? renderExtras(single) : null}
              />
            </li>
          );
        }
        return (
          <li key={`g-${gi}`}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((p, j) => (
                <PhaseCard
                  key={p.id}
                  phase={p}
                  index={startIdx + j}
                  flowType={flowType}
                  canEdit={canEdit}
                  pending={pending}
                  onToggle={() => onToggle(p)}
                  onEdit={() => onEdit(p)}
                  onDelete={() => onDelete(p)}
                  onManageResponsibles={() => onManageResponsibles(p)}
                  responsibleUsers={respUsers(p)}
                  extras={renderExtras ? renderExtras(p) : null}
                />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function SortablePhaseItem(props: {
  phase: PhaseRow;
  index: number;
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onManageResponsibles: () => void;
  responsibleUsers: MemberLite[];
  extras?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.phase.id, disabled: !props.canEdit });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li ref={setNodeRef} style={style}>
      <PhaseCard
        {...props}
        dragHandle={
          props.canEdit ? (
            <button
              type="button"
              {...attributes}
              {...listeners}
              aria-label="Mover fase"
              className="grid h-8 w-8 cursor-grab place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5" />
                <circle cx="15" cy="6" r="1.5" />
                <circle cx="9" cy="12" r="1.5" />
                <circle cx="15" cy="12" r="1.5" />
                <circle cx="9" cy="18" r="1.5" />
                <circle cx="15" cy="18" r="1.5" />
              </svg>
            </button>
          ) : null
        }
      />
    </li>
  );
}

function PhaseCard({
  phase,
  index,
  flowType,
  canEdit,
  pending,
  onToggle,
  onEdit,
  onDelete,
  onManageResponsibles,
  responsibleUsers,
  dragHandle,
  extras,
}: {
  phase: PhaseRow;
  index: number;
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onManageResponsibles: () => void;
  responsibleUsers: MemberLite[];
  dragHandle?: React.ReactNode;
  extras?: React.ReactNode;
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
    <div className={`rounded-2xl border p-4 transition ${tone}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {dragHandle}
        <button
          type="button"
          onClick={onToggle}
          disabled={!canEdit || pending}
          aria-label={completed ? "Marcar como nao concluida" : "Marcar como concluida"}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 transition ${
            completed
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
          } disabled:opacity-50`}
        >
          <svg
            width="18"
            height="18"
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

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              #{index + 1}
            </span>
            <h3
              className={`text-base font-semibold ${
                completed ? "text-emerald-900 line-through" : "text-slate-900"
              }`}
            >
              {phase.name}
            </h3>
            {phase.color ? (
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: phase.color }}
                title={phase.color}
              />
            ) : null}
          </div>
          {phase.description ? (
            <p className="text-sm text-slate-600">{phase.description}</p>
          ) : null}
          {phase.due_date ? (
            <p
              className={`text-xs ${
                isOverdue ? "font-semibold text-red-700" : "text-slate-500"
              }`}
            >
              Vencimento: {formatDate(phase.due_date)}
              {isOverdue ? " — vencida" : null}
            </p>
          ) : flowType === "continuous" ? (
            <p className="text-xs italic text-slate-400">Sem data — vai pro fim</p>
          ) : null}

          {responsibleUsers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Responsaveis:
              </span>
              {responsibleUsers.map((u) => (
                <span
                  key={u.user_id}
                  className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                  title={u.google_full_name ?? u.user_id}
                >
                  <MemberAvatar
                    name={u.google_full_name}
                    avatarUrl={u.google_avatar_url}
                    size="sm"
                  />
                  <span className="truncate max-w-[120px]">
                    {u.google_full_name ?? u.user_id.slice(0, 8)}
                  </span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-1">
            <button
              type="button"
              onClick={onManageResponsibles}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Responsaveis
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={pending}
              className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Excluir
            </button>
          </div>
        ) : null}
      </div>

      {extras ? <div className="mt-3 border-t border-slate-200 pt-3">{extras}</div> : null}
    </div>
  );
}

function PhaseModal({
  title,
  submitLabel,
  phase,
  onSubmit,
  onClose,
  pending,
  error,
}: {
  title: string;
  submitLabel: string;
  phase?: PhaseRow;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}) {
  const defaultDate = phase?.due_date
    ? new Date(phase.due_date).toISOString().slice(0, 16)
    : "";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        action={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Nome da fase</span>
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            defaultValue={phase?.name ?? ""}
            placeholder="Ex.: Publicar regulamento"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Descricao <span className="text-slate-400">(opcional)</span>
          </span>
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={phase?.description ?? ""}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Data de vencimento <span className="text-slate-400">(opcional)</span>
          </span>
          <input
            name="due_date"
            type="datetime-local"
            defaultValue={defaultDate}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Cor de destaque <span className="text-slate-400">(opcional)</span>
          </span>
          <input
            name="color"
            type="color"
            defaultValue={phase?.color ?? "#1E3A8A"}
            className="h-9 w-16 cursor-pointer rounded border border-slate-200"
          />
        </label>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? "Salvando..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

function PhaseResponsiblesModal({
  phase,
  members,
  currentIds,
  onSubmit,
  onClose,
  pending,
  error,
}: {
  phase: PhaseRow;
  members: MemberLite[];
  currentIds: string[];
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = new Set(currentIds);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        action={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Responsaveis pela fase
          </h2>
          <p className="text-sm text-slate-500 truncate">{phase.name}</p>
        </header>

        <p className="text-xs text-slate-500">
          Marque os membros que sao responsaveis. Cada um recebe notificacao ao ser adicionado.
        </p>

        {members.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Nenhum membro ativo no workspace.
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {members.map((m) => (
              <label
                key={m.user_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name="responsibleIds"
                  value={m.user_id}
                  defaultChecked={initial.has(m.user_id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <MemberAvatar
                  name={m.google_full_name}
                  avatarUrl={m.google_avatar_url}
                  size="sm"
                />
                <span className="flex-1 text-sm text-slate-800">
                  {m.google_full_name ?? m.user_id}
                </span>
              </label>
            ))}
          </div>
        )}

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {pending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
