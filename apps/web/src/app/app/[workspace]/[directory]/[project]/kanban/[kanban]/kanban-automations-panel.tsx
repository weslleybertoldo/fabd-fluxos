"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createKanbanAutomation,
  deleteKanbanAutomation,
  setKanbanAutomationActive,
  type KanbanScope,
} from "@/lib/actions/kanbans";
import type { AutomationTarget, AutomationView } from "@/lib/types";

interface Props {
  scope: KanbanScope;
  canEdit: boolean;
  sourcePhases: { id: string; name: string }[];
  automations: AutomationView[];
  targets: AutomationTarget[];
}

function BoltIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

export function KanbanAutomationsPanel({ scope, canEdit, sourcePhases, automations, targets }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourcePhaseId, setSourcePhaseId] = useState("");
  const [targetKanbanId, setTargetKanbanId] = useState("");
  const [targetPhaseId, setTargetPhaseId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const target = targets.find((t) => t.kanbanId === targetKanbanId) ?? null;
  const activeCount = automations.filter((a) => a.active).length;

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function create() {
    if (!sourcePhaseId || !targetKanbanId || !targetPhaseId) {
      setError("Escolha a fase de origem, o Kanban e a fase de destino");
      return;
    }
    act(
      () => createKanbanAutomation({ ...scope, sourcePhaseId, targetKanbanId, targetPhaseId }),
      () => {
        setSourcePhaseId("");
        setTargetKanbanId("");
        setTargetPhaseId("");
      },
    );
  }

  const select =
    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 disabled:opacity-50";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
      >
        <BoltIcon />
        Automações{automations.length ? ` (${activeCount}/${automations.length})` : ""}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Automações do Kanban"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-xl">
            <header className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <span className="text-amber-600">
                    <BoltIcon />
                  </span>
                  Automações
                </h2>
                <p className="text-sm text-slate-500">
                  Quando um card entrar numa fase deste Kanban, um card novo é criado em outro Kanban
                  (igual ao Pipefy).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              >
                ✕
              </button>
            </header>

            {automations.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Nenhuma automação neste Kanban.
              </p>
            ) : (
              <ul className="space-y-2">
                {automations.map((a) => (
                  <li
                    key={a.id}
                    className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                      a.active ? "border-amber-200 bg-amber-50/60" : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <p className={`min-w-0 flex-1 ${a.active ? "text-slate-800" : "text-slate-500"}`}>
                      Quando o card entrar em <strong>{a.sourcePhaseName}</strong> → criar card em{" "}
                      {a.targetHref ? (
                        <Link href={a.targetHref} className="font-semibold underline-offset-2 hover:underline">
                          {a.targetLabel}
                        </Link>
                      ) : (
                        <strong>{a.targetLabel}</strong>
                      )}
                      , fase <strong>{a.targetPhaseName}</strong>
                      {a.active ? null : <span className="ml-1 text-xs">(pausada)</span>}
                    </p>
                    {canEdit ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            act(() =>
                              setKanbanAutomationActive({ ...scope, automationId: a.id, active: !a.active }),
                            )
                          }
                          disabled={pending}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {a.active ? "Pausar" : "Ativar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm("Excluir esta automação?")) return;
                            act(() => deleteKanbanAutomation({ ...scope, automationId: a.id }));
                          }}
                          disabled={pending}
                          className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {canEdit ? (
              <section className="space-y-3 rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Nova automação</h3>
                {targets.length === 0 ? (
                  <p
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                    role="status"
                  >
                    Não existe outro Kanban para receber o card. Crie o Kanban de destino (ex.: no
                    projeto do Marketing) para criar a automação.
                  </p>
                ) : null}
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600">Quando o card entrar na fase</span>
                    <select
                      value={sourcePhaseId}
                      onChange={(e) => setSourcePhaseId(e.target.value)}
                      disabled={pending || targets.length === 0}
                      aria-label="Fase de origem"
                      className={select}
                    >
                      <option value="">Escolha a fase</option>
                      {sourcePhases.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600">Criar card no Kanban</span>
                    <select
                      value={targetKanbanId}
                      onChange={(e) => {
                        setTargetKanbanId(e.target.value);
                        setTargetPhaseId("");
                      }}
                      disabled={pending || targets.length === 0}
                      aria-label="Kanban de destino"
                      className={select}
                    >
                      <option value="">Escolha o Kanban</option>
                      {targets.map((t) => (
                        <option key={t.kanbanId} value={t.kanbanId}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-slate-600">Na fase</span>
                    <select
                      value={targetPhaseId}
                      onChange={(e) => setTargetPhaseId(e.target.value)}
                      disabled={pending || !target}
                      aria-label="Fase de destino"
                      className={select}
                    >
                      <option value="">Escolha a fase</option>
                      {(target?.phases ?? []).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-xs text-slate-500">
                  O card novo leva título, descrição, data e tags do card de origem, e dispara uma vez
                  por card.
                </p>
                <button
                  type="button"
                  onClick={create}
                  disabled={pending || targets.length === 0}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {pending ? "Salvando..." : "Criar automação"}
                </button>
              </section>
            ) : null}

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
