"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberPicker } from "@/components/member-picker";
import { createProject } from "@/lib/actions/projects";
import type { WorkspaceMemberRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  members: Pick<WorkspaceMemberRow, "user_id" | "google_full_name" | "google_avatar_url">[];
  defaultResponsibleId?: string | null;
}

export function CreateProjectButton({
  workspaceSlug,
  directorySlug,
  members,
  defaultResponsibleId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const responsibleUserId = (formData.get("responsibleUserId") as string) ?? "";
    start(async () => {
      const result = await createProject({
        workspaceSlug,
        directorySlug,
        name,
        description: description || null,
        responsibleUserId: responsibleUserId || null,
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
        + Criar projeto
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
              <h2 className="text-lg font-semibold text-slate-900">Novo projeto</h2>
              <p className="text-sm text-slate-500">
                Crie um projeto dentro desta diretoria. Voce pode adicionar fluxos depois.
              </p>
            </header>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome do projeto</span>
              <input
                name="name"
                type="text"
                required
                maxLength={200}
                placeholder="Ex.: 1a Etapa Campeonato Alagoano"
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

            <div className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Responsavel</span>
              <p className="text-xs text-slate-500">
                Quem fica responsavel pelo projeto recebe notificacoes de todas as fases.
              </p>
              <MemberPicker
                name="responsibleUserId"
                members={members}
                defaultValue={defaultResponsibleId ?? null}
              />
            </div>

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
                {pending ? "Criando..." : "Criar projeto"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
