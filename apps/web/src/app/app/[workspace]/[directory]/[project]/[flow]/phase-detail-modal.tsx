"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import { PhaseFields } from "./phase-fields";
import { PhaseAttachments } from "./phase-attachments";
import { createComment, deleteComment } from "@/lib/actions/comments";
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
  canEdit: boolean;
  phase: PhaseRow;
  fields: PhaseFieldRow[];
  valueByFieldPhase: Record<string, PhaseFieldValueRow>;
  attachments: PhaseAttachmentRow[];
  comments: FlowCommentRow[];
  responsibleUsers: MemberLite[];
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
  phase,
  fields,
  valueByFieldPhase,
  attachments,
  comments,
  responsibleUsers,
  authors,
  onClose,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [commentText, setCommentText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isAdmin = currentUserRole === "admin";
  const canWrite = currentUserRole === "admin" || currentUserRole === "diretor";
  const completed = !!phase.completed_at;
  const isOverdue =
    !completed && phase.due_date && new Date(phase.due_date) < new Date();

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
            <h2 className="mt-0.5 truncate text-xl font-semibold text-slate-900">
              {phase.name}
            </h2>
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
                <span className="text-slate-500">
                  Vencimento: {formatDate(phase.due_date)}
                </span>
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
              {phase.description ? (
                <section>
                  <h3 className="text-sm font-semibold text-slate-700">Descricao</h3>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-700">
                    {phase.description}
                  </p>
                </section>
              ) : (
                <p className="text-sm italic text-slate-400">Sem descricao.</p>
              )}

              <section>
                <h3 className="text-sm font-semibold text-slate-700">Responsaveis</h3>
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
