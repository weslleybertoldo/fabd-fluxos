"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import { PhaseFields } from "./phase-fields";
import { PhaseAttachments } from "./phase-attachments";
import { PhaseModal, PhaseResponsiblesModal } from "./phase-edit-modals";
import { createComment, deleteComment } from "@/lib/actions/comments";
import {
  deletePhase,
  setPhaseNoteReminder,
  setPhaseResponsibles,
  updatePhase,
} from "@/lib/actions/phases";
import type {
  FlowCommentRow,
  PhaseAttachmentRow,
  PhaseFieldRow,
  PhaseFieldValueRow,
  PhaseRow,
  WorkspaceMemberRow,
} from "@/lib/types";

type MemberLite = Pick<
  WorkspaceMemberRow,
  "user_id" | "google_full_name" | "google_avatar_url"
>;

type Tab = "overview" | "fields" | "attachments" | "comments";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  workspaceId: string;
  currentUserId: string;
  currentUserRole: string;
  // canEdit: gerencia a fase em si (menu lapis: editar nome/descricao/cor/data,
  // mexer nos responsaveis, excluir). So admin/diretor responsavel projeto/owner
  // do flow.
  canEdit: boolean;
  // canEditContent: preencher campos + anexar arquivos. Cobre canEdit OU ser
  // responsavel da fase. Permite que o responsavel da fase trabalhe nela sem
  // poder mexer em metadados administrativos.
  canEditContent: boolean;
  phase: PhaseRow;
  fields: PhaseFieldRow[];
  valueByFieldPhase: Record<string, PhaseFieldValueRow>;
  attachments: PhaseAttachmentRow[];
  comments: FlowCommentRow[];
  responsibleUsers: MemberLite[];
  responsibleIds: string[];
  members: MemberLite[];
  authors: Record<string, MemberLite>;
  onClose: () => void;
}

export function PhaseDetailModal({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  workspaceId,
  currentUserId,
  currentUserRole,
  canEdit,
  canEditContent,
  phase,
  fields,
  valueByFieldPhase,
  attachments,
  comments,
  responsibleUsers,
  responsibleIds,
  members,
  authors,
  onClose,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [commentText, setCommentText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState<{
    focus?: "name" | "due_date";
  } | null>(null);
  const [editingResp, setEditingResp] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // observacao + lembrete da fase
  const [noteText, setNoteText] = useState(phase.note ?? "");
  const [tagsText, setTagsText] = useState((phase.tags ?? []).join(", "));
  const [remMode, setRemMode] = useState<"none" | "once" | "daily">(
    phase.reminder_recurrence ?? "none",
  );
  const [remDate, setRemDate] = useState(
    phase.reminder_recurrence === "once" && phase.reminder_at
      ? toLocalInput(phase.reminder_at)
      : "",
  );
  const [remTime, setRemTime] = useState(
    phase.reminder_recurrence === "daily" && phase.reminder_at
      ? toTimeInput(phase.reminder_at)
      : "",
  );

  function saveNoteReminder() {
    setError(null);
    let reminderAt: string | null = null;
    if (remMode === "once") {
      if (!remDate) {
        setError("Informe a data/hora do lembrete");
        return;
      }
      reminderAt = new Date(remDate).toISOString();
    } else if (remMode === "daily") {
      if (!remTime) {
        setError("Informe o horario do lembrete");
        return;
      }
      const [h, mi] = remTime.split(":").map(Number);
      const d = new Date();
      d.setHours(h ?? 0, mi ?? 0, 0, 0);
      reminderAt = d.toISOString();
    }
    start(async () => {
      const r = await setPhaseNoteReminder({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        note: noteText,
        tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        reminderRecurrence: remMode === "none" ? null : remMode,
        reminderAt,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const isAdmin = currentUserRole === "admin";
  const canWrite = currentUserRole === "admin" || currentUserRole === "diretor";
  const completed = !!phase.completed_at;
  const isOverdue =
    !completed && phase.due_date && new Date(phase.due_date) < new Date();

  // Fecha menu ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function submitComment() {
    const content = commentText.trim();
    if (!content) return;
    setError(null);
    start(async () => {
      const r = await createComment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        content,
        phaseId: phase.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCommentText("");
      router.refresh();
    });
  }

  function removeComment(commentId: string) {
    if (!confirm("Excluir este comentario?")) return;
    setError(null);
    start(async () => {
      const r = await deleteComment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        commentId,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function submitEdit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const description = (formData.get("description") as string) ?? "";
    const dueDate = (formData.get("due_date") as string) ?? "";
    const color = (formData.get("color") as string) ?? "";
    start(async () => {
      const r = await updatePhase({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        name,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        color: color || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function submitResponsibles(formData: FormData) {
    setError(null);
    const userIds = formData.getAll("responsibleIds").map(String).filter(Boolean);
    start(async () => {
      const r = await setPhaseResponsibles({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
        userIds,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditingResp(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (
      !confirm(`Excluir a fase "${phase.name}" e tudo dentro dela? Acao irreversivel.`)
    )
      return;
    setError(null);
    start(async () => {
      const r = await deletePhase({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId: phase.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 py-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-400">
              Fase
            </p>
            <div className="mt-0.5 flex items-start gap-1.5">
              <h2 className="text-xl font-semibold text-slate-900 break-words">
                {phase.name}
              </h2>
              {phase.color ? (
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: phase.color }}
                  title={phase.color}
                />
              ) : null}
              {canEdit ? (
                <div className="relative shrink-0" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    disabled={pending}
                    aria-label="Opcoes da fase"
                    aria-expanded={menuOpen}
                    className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {menuOpen ? (
                    <div className="absolute left-0 top-full z-10 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditing({ focus: "name" });
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <PencilIcon /> Editar nome / descricao / cor
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setEditingResp(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <UsersIcon /> Responsaveis
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          handleDelete();
                        }}
                        className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                      >
                        <TrashIcon /> Excluir fase
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  completed
                    ? "bg-emerald-100 text-emerald-700"
                    : isOverdue
                      ? "bg-red-100 text-red-700"
                      : "bg-slate-100 text-slate-700"
                }`}
              >
                {completed ? "Concluida" : isOverdue ? "Vencida" : "Em andamento"}
              </span>
              {phase.due_date ? (
                canEdit ? (
                  <button
                    type="button"
                    onClick={() => setEditing({ focus: "due_date" })}
                    disabled={pending}
                    className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline"
                    title="Clique pra mudar"
                  >
                    Vencimento: {formatDate(phase.due_date)}
                  </button>
                ) : (
                  <span className="text-slate-500">
                    Vencimento: {formatDate(phase.due_date)}
                  </span>
                )
              ) : canEdit ? (
                <button
                  type="button"
                  onClick={() => setEditing({ focus: "due_date" })}
                  disabled={pending}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 hover:bg-slate-200"
                >
                  + Definir vencimento
                </button>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 pt-2">
          <TabButton
            active={tab === "overview"}
            onClick={() => setTab("overview")}
            label="Visao geral"
          />
          <TabButton
            active={tab === "fields"}
            onClick={() => setTab("fields")}
            label={`Campos (${fields.length})`}
          />
          <TabButton
            active={tab === "attachments"}
            onClick={() => setTab("attachments")}
            label={`Anexos (${attachments.length})`}
          />
          <TabButton
            active={tab === "comments"}
            onClick={() => setTab("comments")}
            label={`Comentarios (${comments.length})`}
          />
        </nav>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {tab === "overview" ? (
            <div className="space-y-5">
              <section>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-700">Descricao</h3>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditing({ focus: "name" })}
                      disabled={pending}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      {phase.description ? "Editar" : "+ Adicionar"}
                    </button>
                  ) : null}
                </div>
                {phase.description ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                    {phase.description}
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm italic text-slate-400">Sem descricao.</p>
                )}
              </section>

              <section>
                <h3 className="mb-1.5 text-sm font-semibold text-slate-700">
                  Observacao e lembrete
                </h3>
                {canEdit ? (
                  <div className="space-y-2">
                    <textarea
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="Observacao..."
                      disabled={pending}
                      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    />
                    <input
                      type="text"
                      value={tagsText}
                      onChange={(e) => setTagsText(e.target.value)}
                      disabled={pending}
                      placeholder="Tags (ex.: Taskdex) — separadas por virgula"
                      className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    />
                    <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                      {(["none", "once", "daily"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setRemMode(m)}
                          disabled={pending}
                          className={`flex-1 rounded-md px-2 py-1 font-medium transition ${
                            remMode === m
                              ? "bg-slate-900 text-white"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          {m === "none" ? "Sem lembrete" : m === "once" ? "Único" : "Recorrente"}
                        </button>
                      ))}
                    </div>
                    {remMode === "once" ? (
                      <input
                        type="datetime-local"
                        value={remDate}
                        onChange={(e) => setRemDate(e.target.value)}
                        disabled={pending}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      />
                    ) : remMode === "daily" ? (
                      <input
                        type="time"
                        value={remTime}
                        onChange={(e) => setRemTime(e.target.value)}
                        disabled={pending}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={saveNoteReminder}
                      disabled={pending}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {pending ? "..." : "Salvar observacao/lembrete"}
                    </button>
                  </div>
                ) : (
                  <p className="text-sm text-slate-700">
                    {phase.note?.trim() ? phase.note : <span className="italic text-slate-400">Sem observacao.</span>}
                  </p>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-700">Responsaveis</h3>
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditingResp(true)}
                      disabled={pending}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800"
                    >
                      {responsibleUsers.length > 0 ? "Editar" : "+ Adicionar"}
                    </button>
                  ) : null}
                </div>
                {responsibleUsers.length === 0 ? (
                  <p className="mt-1.5 text-sm italic text-slate-400">
                    Nenhum responsavel atribuido.
                  </p>
                ) : (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {responsibleUsers.map((u) => (
                      <li
                        key={u.user_id}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700"
                      >
                        <MemberAvatar
                          name={u.google_full_name}
                          avatarUrl={u.google_avatar_url}
                          size="sm"
                        />
                        <span>{u.google_full_name ?? u.user_id}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="grid gap-3 sm:grid-cols-3">
                <Stat label="Campos" value={fields.length.toString()} />
                <Stat label="Anexos" value={attachments.length.toString()} />
                <Stat label="Comentarios" value={comments.length.toString()} />
              </section>
            </div>
          ) : null}

          {tab === "fields" ? (
            <PhaseFields
              workspaceSlug={workspaceSlug}
              directorySlug={directorySlug}
              projectId={projectId}
              flowId={flowId}
              phaseId={phase.id}
              canEditFields={canEdit}
              fields={fields}
              valueByFieldPhase={valueByFieldPhase}
            />
          ) : null}

          {tab === "attachments" ? (
            <PhaseAttachments
              workspaceSlug={workspaceSlug}
              directorySlug={directorySlug}
              projectId={projectId}
              flowId={flowId}
              phaseId={phase.id}
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              canEditPhase={canEdit}
              canUpload={canEditContent}
              attachments={attachments}
            />
          ) : null}

          {tab === "comments" ? (
            <div className="space-y-4">
              {canWrite ? (
                <div className="space-y-2">
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Escreva um comentario sobre esta fase..."
                    rows={3}
                    maxLength={5000}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={submitComment}
                      disabled={pending || !commentText.trim()}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {pending ? "Enviando..." : "Comentar"}
                    </button>
                  </div>
                </div>
              ) : null}

              {comments.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  Nenhum comentario nesta fase ainda.
                </p>
              ) : (
                <ul className="space-y-3">
                  {comments.map((c) => {
                    const author = authors[c.author_id];
                    const canDelete = c.author_id === currentUserId || isAdmin;
                    return (
                      <li
                        key={c.id}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                      >
                        <div className="flex items-start gap-2">
                          <MemberAvatar
                            name={author?.google_full_name ?? null}
                            avatarUrl={author?.google_avatar_url ?? null}
                            size="sm"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-sm font-medium text-slate-800">
                                {author?.google_full_name ?? "Usuario"}
                              </p>
                              <span className="text-xs text-slate-400">
                                {formatDate(c.created_at)}
                              </span>
                            </div>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                              {linkifyContent(c.content)}
                            </p>
                          </div>
                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() => removeComment(c.id)}
                              disabled={pending}
                              className="rounded-lg p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                              aria-label="Excluir comentario"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                              </svg>
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {editing ? (
        <PhaseModal
          title="Editar fase"
          submitLabel="Salvar"
          phase={phase}
          initialFocus={editing.focus}
          onSubmit={submitEdit}
          onClose={() => !pending && setEditing(null)}
          pending={pending}
          error={error}
        />
      ) : null}

      {editingResp ? (
        <PhaseResponsiblesModal
          phase={phase}
          members={members}
          currentIds={responsibleIds}
          onSubmit={submitResponsibles}
          onClose={() => !pending && setEditingResp(false)}
          pending={pending}
          error={error}
        />
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-medium transition ${
        active
          ? "border-slate-900 text-slate-900"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </svg>
  );
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

function linkifyContent(text: string) {
  // mantem texto puro mas transforma URLs em links
  const parts: (string | { url: string })[] = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push({ url: m[0] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.map((p, i) =>
    typeof p === "string" ? (
      <span key={i}>{p}</span>
    ) : (
      <a
        key={i}
        href={p.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800"
      >
        {p.url}
      </a>
    ),
  );
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function toLocalInput(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
