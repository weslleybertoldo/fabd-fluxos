"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteKanban, updateKanban } from "@/lib/actions/kanbans";
import type { KanbanRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  kanban: KanbanRow;
  canEdit: boolean;
  canDelete: boolean;
}

export function KanbanHeaderActions({
  workspaceSlug,
  directorySlug,
  projectId,
  kanban,
  canEdit,
  canDelete,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(kanban.name);
  const [description, setDescription] = useState(kanban.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const scope = { workspaceSlug, directorySlug, projectId, kanbanId: kanban.id };

  function openEdit() {
    setName(kanban.name);
    setDescription(kanban.description ?? "");
    setError(null);
    setEditing(true);
  }

  function save() {
    setError(null);
    start(async () => {
      const r = await updateKanban({ ...scope, name, description: description.trim() || null });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Excluir o Kanban "${kanban.name}" com todos os cards? Nao da pra desfazer.`)) {
      return;
    }
    setError(null);
    start(async () => {
      const r = await deleteKanban(scope);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/app/${workspaceSlug}/${directorySlug}/${projectId}`);
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <button
            type="button"
            onClick={openEdit}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Editar
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            Excluir
          </button>
        ) : null}
      </div>
      {error && !editing ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setEditing(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-slate-900">Editar Kanban</h2>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
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
                rows={3}
                maxLength={2000}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>
            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
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
      ) : null}
    </div>
  );
}
