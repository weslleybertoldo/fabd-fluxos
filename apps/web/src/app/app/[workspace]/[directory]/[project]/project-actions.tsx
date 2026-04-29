"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberPicker } from "@/components/member-picker";
import {
  archiveProject,
  cloneProject,
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

type Modal = "edit" | "responsible" | null;

export function ProjectActions({
  workspaceSlug,
  directorySlug,
  project,
  members,
  canDelete,
}: Props) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  function runStatus(action: "archive" | "complete" | "reactivate" | "delete") {
    setError(null);
    setMenuOpen(false);
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
      setModal(null);
      router.refresh();
    });
  }

  function runClone() {
    setError(null);
    setMenuOpen(false);
    if (!confirm(`Criar uma copia deste projeto? Sera criado um novo "Cópia ${project.name}" com todos os fluxos, fases, campos e responsaveis.`))
      return;
    start(async () => {
      const r = await cloneProject({
        workspaceSlug,
        directorySlug,
        projectId: project.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // Redireciona pra nova copia
      router.push(`/app/${workspaceSlug}/${directorySlug}/${r.data.newProjectId}`);
    });
  }

  function submitResponsible(formData: FormData) {
    setError(null);
    const responsibleUserId = (formData.get("responsibleUserId") as string) ?? "";
    start(async () => {
      const result = await updateProject({
        workspaceSlug,
        directorySlug,
        projectId: project.id,
        responsibleUserId: responsibleUserId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setModal(null);
      router.refresh();
    });
  }

  const isActive = project.status === "active";

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={pending}
          aria-label="Acoes do projeto"
          aria-expanded={menuOpen}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
          </svg>
          Acoes
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
          >
            <MenuItem
              label="Editar"
              onClick={() => {
                setMenuOpen(false);
                setModal("edit");
              }}
            />
            <MenuItem
              label="Alterar responsavel"
              onClick={() => {
                setMenuOpen(false);
                setModal("responsible");
              }}
            />
            <MenuItem
              label="Criar copia"
              onClick={runClone}
            />
            <div className="my-1 h-px bg-slate-100" />
            {isActive ? (
              <>
                <MenuItem
                  label="Concluir"
                  tone="emerald"
                  onClick={() => runStatus("complete")}
                />
                <MenuItem
                  label="Arquivar"
                  onClick={() => runStatus("archive")}
                />
              </>
            ) : (
              <MenuItem
                label="Reativar"
                tone="blue"
                onClick={() => runStatus("reactivate")}
              />
            )}
            {canDelete ? (
              <>
                <div className="my-1 h-px bg-slate-100" />
                <MenuItem
                  label="Excluir"
                  tone="red"
                  onClick={() => runStatus("delete")}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {modal === "edit" ? (
        <ModalShell title="Editar projeto" onClose={() => setModal(null)} pending={pending}>
          <form action={submitEdit} className="space-y-4">
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

            <ModalActions onCancel={() => setModal(null)} pending={pending} />
          </form>
        </ModalShell>
      ) : null}

      {modal === "responsible" ? (
        <ModalShell
          title="Alterar responsavel"
          onClose={() => setModal(null)}
          pending={pending}
        >
          <form action={submitResponsible} className="space-y-4">
            <p className="text-sm text-slate-600">
              Selecione um membro ou escolha &quot;Sem responsavel&quot; pra remover.
            </p>
            <div className="space-y-1.5">
              <span className="text-sm font-medium text-slate-700">Responsavel</span>
              <MemberPicker
                name="responsibleUserId"
                members={members}
                defaultValue={project.responsible_user_id}
                emptyLabel="Sem responsavel"
              />
            </div>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <ModalActions onCancel={() => setModal(null)} pending={pending} />
          </form>
        </ModalShell>
      ) : null}
    </>
  );
}

function MenuItem({
  label,
  onClick,
  tone,
}: {
  label: string;
  onClick: () => void;
  tone?: "emerald" | "blue" | "red";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-700 hover:bg-emerald-50"
      : tone === "blue"
        ? "text-blue-700 hover:bg-blue-50"
        : tone === "red"
          ? "text-red-700 hover:bg-red-50"
          : "text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-medium ${toneClass}`}
    >
      {label}
    </button>
  );
}

function ModalShell({
  title,
  onClose,
  pending,
  children,
}: {
  title: string;
  onClose: () => void;
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <header>
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        </header>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onCancel,
  pending,
}: {
  onCancel: () => void;
  pending: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
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
  );
}
