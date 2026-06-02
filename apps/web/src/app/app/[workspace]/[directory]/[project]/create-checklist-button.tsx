"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChecklist, type ChecklistSectionInput } from "@/lib/actions/checklists";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}

type Mode = "simple" | "flow";

type SectionDraft = { title: string; description: string; itemsText: string };

const emptySection = (): SectionDraft => ({ title: "", description: "", itemsText: "" });

function toItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export function CreateChecklistButton({
  workspaceSlug,
  directorySlug,
  projectId,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("simple");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // modo simples (uma secao)
  const [simpleTitle, setSimpleTitle] = useState("");
  const [simpleDesc, setSimpleDesc] = useState("");
  const [simpleItems, setSimpleItems] = useState("");

  // modo em fluxo (varias secoes)
  const [flowName, setFlowName] = useState("");
  const [sections, setSections] = useState<SectionDraft[]>([emptySection()]);

  function reset() {
    setMode("simple");
    setSimpleTitle("");
    setSimpleDesc("");
    setSimpleItems("");
    setFlowName("");
    setSections([emptySection()]);
    setError(null);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    reset();
  }

  function submit() {
    setError(null);
    let name: string;
    let kind: Mode;
    let payload: ChecklistSectionInput[];

    if (mode === "simple") {
      name = simpleTitle.trim();
      kind = "simple";
      payload = [
        {
          title: simpleTitle.trim(),
          description: simpleDesc.trim() || null,
          items: toItems(simpleItems),
        },
      ];
    } else {
      name = flowName.trim();
      kind = "flow";
      payload = sections
        .map((s) => ({
          title: s.title.trim(),
          description: s.description.trim() || null,
          items: toItems(s.itemsText),
        }))
        .filter((s) => s.title || (s.items?.length ?? 0) > 0);
    }

    if (!name) {
      setError(mode === "simple" ? "Informe o titulo" : "Informe o nome da checklist");
      return;
    }
    if (payload.length === 0 || payload.some((s) => !s.title)) {
      setError("Toda secao precisa de um titulo");
      return;
    }

    start(async () => {
      const r = await createChecklist({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        kind,
        sections: payload,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
      requestAnimationFrame(() => {
        document.getElementById("listas")?.scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  function updateSection(i: number, patch: Partial<SectionDraft>) {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        + Criar checklist
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
              <h2 className="text-lg font-semibold text-slate-900">Nova checklist</h2>
              <p className="text-sm text-slate-500">
                Escolha o formato: simples (uma lista) ou em fluxo (varias secoes).
              </p>
            </header>

            <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
              {(["simple", "flow"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={[
                    "flex-1 rounded-lg px-3 py-1.5 text-center font-medium transition",
                    mode === m
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-500 hover:text-slate-900",
                  ].join(" ")}
                >
                  {m === "simple" ? "Simples" : "Em fluxo"}
                </button>
              ))}
            </div>

            {mode === "simple" ? (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">Titulo</span>
                  <input
                    type="text"
                    value={simpleTitle}
                    onChange={(e) => setSimpleTitle(e.target.value)}
                    required
                    maxLength={200}
                    placeholder="Ex.: Pendencias do torneio"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    Descricao <span className="text-slate-400">(opcional)</span>
                  </span>
                  <textarea
                    value={simpleDesc}
                    onChange={(e) => setSimpleDesc(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    Itens <span className="text-slate-400">(um por linha)</span>
                  </span>
                  <textarea
                    value={simpleItems}
                    onChange={(e) => setSimpleItems(e.target.value)}
                    rows={5}
                    placeholder={"Confirmar quadras\nConvocar arbitros"}
                    className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-700">
                    Nome da checklist
                  </span>
                  <input
                    type="text"
                    value={flowName}
                    onChange={(e) => setFlowName(e.target.value)}
                    required
                    maxLength={200}
                    placeholder="Ex.: Onboarding da operacao"
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  />
                </label>

                <div className="space-y-3">
                  {sections.map((s, i) => (
                    <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Secao {i + 1}
                        </span>
                        {sections.length > 1 ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSections((prev) => prev.filter((_, idx) => idx !== i))
                            }
                            className="text-[11px] text-red-500 hover:text-red-700"
                          >
                            remover
                          </button>
                        ) : null}
                      </div>
                      <input
                        type="text"
                        value={s.title}
                        onChange={(e) => updateSection(i, { title: e.target.value })}
                        maxLength={200}
                        placeholder="Titulo da secao (ex.: Esta semana)"
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      />
                      <textarea
                        value={s.description}
                        onChange={(e) => updateSection(i, { description: e.target.value })}
                        rows={2}
                        maxLength={2000}
                        placeholder="Descricao (opcional)"
                        className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      />
                      <textarea
                        value={s.itemsText}
                        onChange={(e) => updateSection(i, { itemsText: e.target.value })}
                        rows={4}
                        placeholder="Itens (um por linha)"
                        className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSections((prev) => [...prev, emptySection()])}
                    className="w-full rounded-lg border border-dashed border-slate-300 px-2 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  >
                    + Adicionar secao
                  </button>
                </div>
              </div>
            )}

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
                {pending ? "Criando..." : "Criar checklist"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
