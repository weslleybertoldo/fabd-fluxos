"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createReminder,
  deleteReminder,
  setReminderCompleted,
  updateReminder,
} from "@/lib/actions/reminders";
import type { ReminderRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  reminders: ReminderRow[];
}

type Mode = "once" | "daily";

export function RemindersAndLists({
  workspaceSlug,
  directorySlug,
  projectId,
  canCreate,
  reminders,
}: Props) {
  return (
    <RemindersBox
      workspaceSlug={workspaceSlug}
      directorySlug={directorySlug}
      projectId={projectId}
      canCreate={canCreate}
      reminders={reminders}
    />
  );
}

// monta o ISO do due_date a partir do modo + inputs (datetime-local ou hora)
function buildDueIso(mode: Mode, dateValue: string, timeValue: string): string | null {
  if (mode === "once") {
    return dateValue ? new Date(dateValue).toISOString() : null;
  }
  if (!timeValue) return null;
  const [h, m] = timeValue.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.toISOString();
}

function RemindersBox({
  workspaceSlug,
  directorySlug,
  projectId,
  canCreate,
  reminders,
}: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  reminders: ReminderRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<Mode>("once");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // edicao inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editMode, setEditMode] = useState<Mode>("once");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");

  // confirmacao de exclusao
  const [deleting, setDeleting] = useState<ReminderRow | null>(null);

  const base = { workspaceSlug, directorySlug, projectId };

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const dueIso = buildDueIso(
      mode,
      (formData.get("due_date") as string) ?? "",
      (formData.get("time") as string) ?? "",
    );
    if (!dueIso) {
      setError(mode === "once" ? "Informe a data e hora" : "Informe o horario");
      return;
    }
    start(async () => {
      const r = await createReminder({ ...base, name, dueDate: dueIso, recurrence: mode });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdding(false);
      setMode("once");
      router.refresh();
    });
  }

  function startEdit(rmd: ReminderRow) {
    setError(null);
    setEditingId(rmd.id);
    setEditName(rmd.name);
    const m: Mode = rmd.recurrence === "daily" ? "daily" : "once";
    setEditMode(m);
    setEditDate(m === "once" && rmd.due_date ? toDatetimeLocal(rmd.due_date) : "");
    setEditTime(m === "daily" && rmd.due_date ? toTimeInput(rmd.due_date) : "");
  }

  function saveEdit() {
    setError(null);
    const dueIso = buildDueIso(editMode, editDate, editTime);
    if (!editName.trim()) {
      setError("Informe o nome");
      return;
    }
    if (!dueIso) {
      setError(editMode === "once" ? "Informe a data e hora" : "Informe o horario");
      return;
    }
    start(async () => {
      const r = await updateReminder({
        ...base,
        reminderId: editingId!,
        name: editName,
        dueDate: dueIso,
        recurrence: editMode,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function toggle(rmd: ReminderRow) {
    setError(null);
    start(async () => {
      const r = await setReminderCompleted({
        ...base,
        reminderId: rmd.id,
        completed: !rmd.completed_at,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function doDelete() {
    if (!deleting) return;
    setError(null);
    const id = deleting.id;
    start(async () => {
      const r = await deleteReminder({ ...base, reminderId: id });
      if (!r.ok) setError(r.error);
      setDeleting(null);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Lembretes
        </h3>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {adding ? "Cancelar" : "+ Lembrete"}
          </button>
        ) : null}
      </header>

      {adding ? (
        <form action={submit} className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3">
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Ex.: Confirmar com a federacao"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            disabled={pending}
          />
          <ModeToggle mode={mode} setMode={setMode} disabled={pending} />
          {mode === "once" ? (
            <input
              name="due_date"
              type="datetime-local"
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              disabled={pending}
            />
          ) : (
            <div className="space-y-1">
              <input
                name="time"
                type="time"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                disabled={pending}
              />
              <p className="text-[10px] text-slate-400">Dispara todos os dias nesse horario.</p>
            </div>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "..." : "Adicionar"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {reminders.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs italic text-slate-400">
          Nenhum lembrete
        </p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => {
            const completed = !!r.completed_at;
            const isDaily = r.recurrence === "daily";
            const isOverdue =
              !completed && !isDaily && r.due_date && new Date(r.due_date) < new Date();
            const tone = completed
              ? "border-emerald-200 bg-emerald-50"
              : isOverdue
                ? "border-red-200 bg-red-50"
                : "border-slate-200 bg-white";

            if (editingId === r.id) {
              return (
                <li key={r.id} className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    maxLength={200}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                    disabled={pending}
                  />
                  <ModeToggle mode={editMode} setMode={setEditMode} disabled={pending} />
                  {editMode === "once" ? (
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                      disabled={pending}
                    />
                  ) : (
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                      disabled={pending}
                    />
                  )}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={saveEdit}
                      disabled={pending}
                      className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {pending ? "..." : "Salvar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={pending}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={r.id}
                className={`flex items-start gap-2 rounded-xl border p-2 ${tone}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  disabled={pending}
                  aria-label={completed ? "Reativar" : "Concluir"}
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition ${
                    completed
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
                  } disabled:opacity-50`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      completed ? "text-emerald-900 line-through" : "text-slate-900"
                    }`}
                  >
                    {r.name}
                  </p>
                  {r.due_date ? (
                    <p
                      className={`text-[10px] ${
                        isOverdue ? "font-semibold text-red-700" : "text-slate-500"
                      }`}
                    >
                      {isDaily
                        ? `Todo dia às ${formatTime(r.due_date)}`
                        : formatDate(r.due_date)}
                      {isOverdue ? " · vencido" : null}
                    </p>
                  ) : null}
                </div>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => startEdit(r)}
                    disabled={pending}
                    aria-label="Editar"
                    className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-50"
                  >
                    ✎
                  </button>
                ) : null}
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setDeleting(r)}
                    disabled={pending}
                    aria-label="Excluir"
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {deleting ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setDeleting(null);
          }}
        >
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Excluir lembrete</h2>
              <p className="mt-1 text-sm text-slate-500">
                Tem certeza que deseja excluir &quot;{deleting.name}&quot;? Esta acao nao pode ser desfeita.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                disabled={pending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={pending}
                className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {pending ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ModeToggle({
  mode,
  setMode,
  disabled,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
      {(["once", "daily"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => setMode(m)}
          disabled={disabled}
          className={[
            "flex-1 rounded-md px-2 py-1 font-medium transition",
            mode === m ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900",
          ].join(" ")}
        >
          {m === "once" ? "Único" : "Recorrente"}
        </button>
      ))}
    </div>
  );
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
