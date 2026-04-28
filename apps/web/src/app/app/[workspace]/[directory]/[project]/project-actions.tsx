"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberPicker } from "@/components/member-picker";
import {
  archiveProject,
  completeProject,
  deleteProject,
  reactivateProject,
  updateProject,
} from "@/lib/actions/projects";
import type { ProjectRow, WorkspaceMemberRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  project: ProjectRow;
  members: Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url"
  >[];
  canDelete: boolean;
}

export function ProjectActions({
  workspaceSlug,
  directorySlug,
  project,
  members,
  canDelete,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function runStatus(action: "archive" | "complete" | "reactivate" | "delete") {
    setError(null);
    const labels = {
      archive: "Arquivar este projeto?",
      complete: "Marcar como concluido? Todos os fluxos ficam congelados.",
      reactivate: "Reativar este projeto?",
      delete: "Excluir este projeto e TODOS os seus fluxos? Acao irreversivel.",
    };
    if (!confirm(labels[action])) return;
    start(async () => {
      const fns = {
        archive: archiveProject,
        complete: completeProject,
        reactivate: reactivateProject,
        delete: () =>
          deleteProject({
            workspaceSlug,
            directorySlug,
            projectId: project.id,
            redirectAfter: true,
          }),
      };
      const result = await fns[action]({
        workspaceSlug,
        directorySlug,
        projectId: project.id,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function submitEdit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const responsibleUserId = (formData.get("responsibleUserId") as string) ?? "";
    start(async () => {
      const result = await updateProject({
        workspaceSlug,
        directorySlug,
        projectId: project.id,
        name,
        description: description || null,
        responsibleUserId: responsibleUserId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Editar
        </button>
        {project.status === "active" ? (
          <>
            <button
              type="button"
              onClick={() => runStatus("complete")}
              disabled={pending}
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
            >
              Concluir
            </button>
            <button
              type="button"
              onClick={() => runStatus("archive")}
              disabled={pending}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              Arquivar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => runStatus("reactivate")}
            disabled={pending}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
          >
            Reativar
          </button>
        )}
        {canDelete ? (
          <button
            type="button"
            onClick={() => runStatus("delete")}
            disabled={pending}
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            Excluir
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setEditing(false);
          }}
        >
          <form
            action={submitEdit}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <header>
              <h2 className="text-lg font-semibold text-slate-900">Editar projeto</h2>
            </header>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Nome</span>
              <input
                name="name"
                type="text"
                required
                maxLength={200}
                defaultValue={project.name}
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
                defaultValue={project.description ?? ""}
                className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
            </label>

            <div className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Responsavel</span>
              <MemberPicker
                name="responsibleUserId"
                members={members}
                defaultValue={project.responsible_user_id}
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
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
                {pending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
