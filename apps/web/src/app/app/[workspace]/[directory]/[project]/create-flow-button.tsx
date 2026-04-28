"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createFlow } from "@/lib/actions/flows";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}

export function CreateFlowButton({ workspaceSlug, directorySlug, projectId }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const type = (formData.get("type") as string) ?? "continuous";
    start(async () => {
      const result = await createFlow({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        description: description || null,
        type: type === "non_continuous" ? "non_continuous" : "continuous",
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
      >
        + Criar fluxo
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
              <h2 className="text-lg font-semibold text-slate-900">Novo fluxo</h2>
              <p className="text-sm text-slate-500">
                Fluxo eh um conjunto de fases que voce conclui para entregar o projeto.
              </p>
            </header>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome do fluxo</span>
              <input
                name="name"
                type="text"
                required
                maxLength={200}
                placeholder="Ex.: Pre e pos torneio"
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
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Tipo</legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                <input
                  type="radio"
                  name="type"
                  value="continuous"
                  defaultChecked
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="block font-medium text-slate-900">Continuo</span>
                  <span className="text-slate-500">
                    Segue cronograma. Fases reordenam pela data mais proxima.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                <input type="radio" name="type" value="non_continuous" className="mt-0.5" />
                <span className="text-sm">
                  <span className="block font-medium text-slate-900">Nao continuo</span>
                  <span className="text-slate-500">
                    Pendencias sem ordem fixa. Voce arrasta pra reordenar.
                  </span>
                </span>
              </label>
            </fieldset>

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
                {pending ? "Criando..." : "Criar fluxo"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
