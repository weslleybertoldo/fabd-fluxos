"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPhase,
  deletePhase,
  setPhaseCompleted,
  updatePhase,
} from "@/lib/actions/phases";
import type { PhaseRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  phases: PhaseRow[];
}

export function PhasesPanel({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  flowType,
  canEdit,
  phases,
}: Props) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PhaseRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
      ) : (
        <ol className="space-y-3">
          {phases.map((p, i) => (
            <PhaseCard
              key={p.id}
              phase={p}
              index={i}
              flowType={flowType}
              canEdit={canEdit}
              pending={pending}
              onToggle={() => toggleComplete(p)}
              onEdit={() => setEditing(p)}
              onDelete={() => remove(p)}
            />
          ))}
        </ol>
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
    </section>
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
}: {
  phase: PhaseRow;
  index: number;
  flowType: "continuous" | "non_continuous";
  canEdit: boolean;
  pending: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
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
      className={`flex flex-col gap-3 rounded-2xl border p-4 transition sm:flex-row sm:items-start ${tone}`}
    >
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
          <p className="text-xs text-slate-400 italic">Sem data — vai pro fim</p>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex shrink-0 gap-1">
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
    </li>
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
