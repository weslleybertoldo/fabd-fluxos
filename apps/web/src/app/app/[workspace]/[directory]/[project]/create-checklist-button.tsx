"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChecklist } from "@/lib/actions/lists";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}

export function CreateChecklistButton({
  workspaceSlug,
  directorySlug,
  projectId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(null);
    const name = ((formData.get("name") as string) ?? "").trim();
    const itemsRaw = (formData.get("items") as string) ?? "";
    const items = itemsRaw
      .split("\n")
      .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 100);

    start(async () => {
      const created = await createChecklist({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        items,
      });
      if (!created.ok) {
        // Mantem o modal aberto exibindo o erro (nao perde o que o user digitou).
        setError(created.error);
        return;
      }

      setOpen(false);
      router.refresh();
      // rola ate a secao de listas onde a checklist aparece
      requestAnimationFrame(() => {
        document.getElementById("listas")?.scrollIntoView({ behavior: "smooth" });
      });
    });
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
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
        >
          <form
            action={submit}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <header>
              <h2 className="text-lg font-semibold text-slate-900">Nova checklist</h2>
              <p className="text-sm text-slate-500">
                Uma lista de pendencias com itens que voce marca conforme conclui.
              </p>
            </header>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome da checklist</span>
              <input
                name="name"
                type="text"
                required
                maxLength={200}
                placeholder="Ex.: Pendencias do torneio"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">
                Itens <span className="text-slate-400">(opcional, um por linha)</span>
              </span>
              <textarea
                name="items"
                rows={6}
                placeholder={"Confirmar quadras\nConvocar arbitros\nFechar inscricoes"}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
              <span className="text-xs text-slate-400">
                Voce tambem pode adicionar mais itens depois, direto na checklist.
              </span>
            </label>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
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
