"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import {
  createComment,
  deleteComment,
  updateComment,
} from "@/lib/actions/comments";
import type { FlowCommentRow, WorkspaceMemberRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  currentUserId: string;
  currentUserRole: string;
  comments: FlowCommentRow[];
  authors: Record<
    string,
    Pick<WorkspaceMemberRow, "user_id" | "google_full_name" | "google_avatar_url">
  >;
}

export function CommentsPanel({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  currentUserId,
  currentUserRole,
  comments,
  authors,
}: Props) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isAdmin = currentUserRole === "admin";
  const canWrite = currentUserRole === "admin" || currentUserRole === "diretor";

  function refresh() {
    router.refresh();
  }

  function submit() {
    const content = text.trim();
    if (!content) return;
    setError(null);
    start(async () => {
      const r = await createComment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        content,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setText("");
      refresh();
    });
  }

  function startEdit(c: FlowCommentRow) {
    setEditingId(c.id);
    setEditText(c.content);
    setError(null);
  }

  function saveEdit() {
    if (!editingId) return;
    const content = editText.trim();
    if (!content) return;
    setError(null);
    start(async () => {
      const r = await updateComment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        commentId: editingId,
        content,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditingId(null);
      setEditText("");
      refresh();
    });
  }

  function remove(c: FlowCommentRow) {
    if (!confirm("Excluir este comentario?")) return;
    setError(null);
    start(async () => {
      const r = await deleteComment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        commentId: c.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      refresh();
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Comentarios do fluxo</h2>

      {canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex gap-2"
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="Comentario visivel em todas as fases do fluxo..."
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending || !text.trim()}
            className="self-stretch rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "..." : "Enviar"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {comments.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Nenhum comentario ainda. Seja o primeiro a comentar.
        </p>
      ) : (
        <ol className="space-y-3">
          {comments.map((c) => {
            const author = authors[c.author_id];
            const canEditOwn = c.author_id === currentUserId;
            const canDelete = canEditOwn || isAdmin;
            const isEditing = editingId === c.id;
            return (
              <li
                key={c.id}
                className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-4"
              >
                <MemberAvatar
                  name={author?.google_full_name}
                  avatarUrl={author?.google_avatar_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      {author?.google_full_name ?? "Usuario"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(c.created_at)}
                      {c.updated_at !== c.created_at ? " (editado)" : ""}
                    </p>
                  </div>

                  {isEditing ? (
                    <div className="mt-2 space-y-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        maxLength={5000}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
                        disabled={pending}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          disabled={pending || !editText.trim()}
                          className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditText("");
                          }}
                          disabled={pending}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
                        {renderWithLinks(c.content)}
                      </p>
                      {canEditOwn || canDelete ? (
                        <div className="mt-2 flex gap-2">
                          {canEditOwn ? (
                            <button
                              type="button"
                              onClick={() => startEdit(c)}
                              disabled={pending}
                              className="text-xs font-medium text-slate-500 hover:text-slate-900"
                            >
                              Editar
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              onClick={() => remove(c)}
                              disabled={pending}
                              className="text-xs font-medium text-red-600 hover:text-red-700"
                            >
                              Excluir
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Auto-link em URLs http/https. Resto fica plain text. */
function renderWithLinks(text: string): React.ReactNode {
  const regex = /(https?:\/\/[^\s]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    parts.push(
      <a
        key={key++}
        href={match[0]}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline hover:text-blue-800"
      >
        {match[0]}
      </a>,
    );
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts;
}
