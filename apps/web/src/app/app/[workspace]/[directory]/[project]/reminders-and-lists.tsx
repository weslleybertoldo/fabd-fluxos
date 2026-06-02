"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createReminder,
  deleteReminder,
  setReminderCompleted,
} from "@/lib/actions/reminders";
import type { ReminderRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  reminders: ReminderRow[];
}

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
  const [mode, setMode] = useState<"once" | "daily">("once");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";

    let dueIso: string | null = null;
    if (mode === "once") {
      const dueDate = (formData.get("due_date") as string) ?? "";
      dueIso = dueDate ? new Date(dueDate).toISOString() : null;
      if (!dueIso) {
        setError("Informe a data e hora");
        return;
      }
    } else {
      // recorrente: so o horario; uso hoje + hora (a data e ignorada no disparo diario)
      const time = (formData.get("time") as string) ?? "";
      if (!time) {
        setError("Informe o horario");
        return;
      }
      const [h, m] = time.split(":").map(Number);
      const d = new Date();
      d.setHours(h ?? 0, m ?? 0, 0, 0);
      dueIso = d.toISOString();
    }

    start(async () => {
      const r = await createReminder({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        dueDate: dueIso,
        recurrence: mode,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdding(false);
      setMode("once");
      router.refresh();
    });
  }

  function toggle(rmd: ReminderRow) {
    setError(null);
    start(async () => {
      const r = await setReminderCompleted({
        workspaceSlug,
        directorySlug,
        projectId,
        reminderId: rmd.id,
        completed: !rmd.completed_at,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(rmd: ReminderRow) {
    if (!confirm(`Excluir lembrete "${rmd.name}"?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteReminder({
        workspaceSlug,
        directorySlug,
        projectId,
        reminderId: rmd.id,
      });
      if (!r.ok) setError(r.error);
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

          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-[11px]">
            {(["once", "daily"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={pending}
                className={[
                  "flex-1 rounded-md px-2 py-1 font-medium transition",
                  mode === m
                    ? "bg-slate-900 text-white"
                    : "text-slate-500 hover:text-slate-900",
                ].join(" ")}
              >
                {m === "once" ? "Único" : "Recorrente"}
              </button>
            ))}
          </div>

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
                <button
                  type="button"
                  onClick={() => remove(r)}
                  disabled={pending}
                  aria-label="Excluir"
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
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
