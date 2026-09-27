"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createKanban } from "@/lib/actions/kanbans";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}

type PhaseDraft = { id: string; name: string };

const DEFAULT_PHASES = ["A fazer", "Fazendo", "Concluído"];

export function CreateKanbanButton({ workspaceSlug, directorySlug, projectId }: Props) {
  const router = useRouter();
  const seqRef = useRef(0);
  const draft = (name: string): PhaseDraft => ({ id: `p${seqRef.current++}`, name });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phases, setPhases] = useState<PhaseDraft[]>(() => DEFAULT_PHASES.map(draft));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function reset() {
    setName("");
    setDescription("");
    setPhases(DEFAULT_PHASES.map(draft));
    setError(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function submit() {
    setError(null);
    const phaseNames = phases.map((p) => p.name.trim()).filter(Boolean);
    if (!name.trim()) {
      setError("Informe o nome do Kanban");
      return;
    }
    if (phaseNames.length === 0) {
      setError("Adicione ao menos uma fase");
      return;
    }
    start(async () => {
      const r = await createKanban({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        description: description.trim() || null,
        phases: phaseNames,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      reset();
      router.push(`/app/${workspaceSlug}/${directorySlug}/${projectId}/kanban/${r.data.kanbanId}`);
    });
  }

  function movePhase(i: number, dir: -1 | 1) {
    setPhases((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        + Criar Kanban
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <header>
              <h2 className="text-lg font-semibold text-slate-900">Novo Kanban</h2>
              <p className="text-sm text-slate-500">
                Cards andam entre as fases, igual no Pipefy. A última fase é a de concluído.
              </p>
            </header>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
                placeholder="Ex.: Artes e divulgação"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">
                Descrição <span className="text-slate-400">(opcional)</span>
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>

            <div className="space-y-2">
              <span className="text-sm font-medium text-slate-700">Fases</span>
              {phases.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs font-semibold text-slate-400">{i + 1}</span>
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) =>
                      setPhases((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)),
                      )
                    }
                    maxLength={100}
                    placeholder="Nome da fase"
                    aria-label={`Fase ${i + 1}`}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => movePhase(i, -1)}
                    disabled={i === 0}
                    aria-label="Subir fase"
                    className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePhase(i, 1)}
                    disabled={i === phases.length - 1}
                    aria-label="Descer fase"
                    className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhases((prev) => prev.filter((x) => x.id !== p.id))}
                    disabled={phases.length <= 1}
                    aria-label="Remover fase"
                    className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-red-500 hover:bg-red-50 disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              ))}
              {phases.length < 30 ? (
                <button
                  type="button"
                  onClick={() => setPhases((prev) => [...prev, draft("")])}
                  className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                >
                  + Adicionar fase
                </button>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {pending ? "Criando..." : "Criar Kanban"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
