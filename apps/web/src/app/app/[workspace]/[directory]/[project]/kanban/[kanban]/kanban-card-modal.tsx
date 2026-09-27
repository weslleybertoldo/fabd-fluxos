"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import { TagSelect } from "@/components/tag-select";
import {
  addKanbanCardComment,
  deleteKanbanCard,
  deleteKanbanCardComment,
  setKanbanCardResponsibles,
  updateKanbanCard,
  type KanbanScope,
} from "@/lib/actions/kanbans";
import type {
  KanbanCardCommentRow,
  KanbanCardRow,
  KanbanPhaseRow,
  WorkspaceMemberRow,
} from "@/lib/types";

type MemberLite = Pick<WorkspaceMemberRow, "user_id" | "google_full_name" | "google_avatar_url">;

interface Props {
  scope: KanbanScope;
  card: KanbanCardRow;
  phases: KanbanPhaseRow[];
  isDone: boolean;
  members: MemberLite[];
  responsibleIds: string[];
  comments: KanbanCardCommentRow[];
  canEditKanban: boolean;
  canEditCard: boolean;
  canComment: boolean;
  currentUserId: string;
  isAdmin: boolean;
  availableTags: string[];
  tagColors: Record<string, string>;
  pending: boolean;
  onMove: (phaseId: string) => void;
  onClose: () => void;
}

// datetime-local espera "YYYY-MM-DDTHH:mm" no fuso local
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function KanbanCardModal({
  scope,
  card,
  phases,
  isDone,
  members,
  responsibleIds,
  comments,
  canEditKanban,
  canEditCard,
  canComment,
  currentUserId,
  isAdmin,
  availableTags,
  tagColors,
  pending: boardPending,
  onMove,
  onClose,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [due, setDue] = useState(toLocalInput(card.due_date));
  const [tags, setTags] = useState<string[]>(card.tags ?? []);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const busy = pending || saving || boardPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const responsibles = responsibleIds
    .map((id) => memberById.get(id))
    .filter((m): m is MemberLite => !!m);
  const candidates = members.filter((m) => !responsibleIds.includes(m.user_id));
  const creator = memberById.get(card.created_by);

  const dirty =
    title.trim() !== card.title ||
    (description.trim() || null) !== (card.description ?? null) ||
    due !== toLocalInput(card.due_date) ||
    tags.join("|") !== (card.tags ?? []).join("|");

  function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(r.error);
        return;
      }
      after?.();
      router.refresh();
    });
  }

  function save() {
    setError(null);
    setSaved(false);
    startSave(async () => {
      const r = await updateKanbanCard({
        ...scope,
        cardId: card.id,
        title,
        description: description.trim() || null,
        dueDate: due ? new Date(due).toISOString() : null,
        tags,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  function setPeople(next: string[]) {
    act(() => setKanbanCardResponsibles({ ...scope, cardId: card.id, userIds: next }));
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-900/40 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Card ${card.title}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl space-y-5 rounded-2xl bg-white p-6 shadow-xl">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            {canEditCard ? (
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={300}
                aria-label="Título do card"
                className="w-full rounded-lg border border-transparent px-1 py-0.5 text-xl font-semibold text-slate-900 hover:border-slate-200 focus:border-slate-300 focus:outline-none"
              />
            ) : (
              <h2 className="text-xl font-semibold text-slate-900">{card.title}</h2>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-slate-500">Fase</span>
              {canEditCard ? (
                <select
                  value={card.phase_id}
                  onChange={(e) => onMove(e.target.value)}
                  disabled={busy}
                  aria-label="Fase do card"
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800"
                >
                  {phases.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-slate-800">
                  {phases.find((p) => p.id === card.phase_id)?.name ?? "—"}
                </span>
              )}
              {isDone ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  ✓ Concluído
                </span>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            ✕
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5 sm:col-span-2">
            <span className="text-sm font-medium text-slate-700">Descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              readOnly={!canEditCard}
              rows={4}
              maxLength={5000}
              placeholder={canEditCard ? "Detalhes do card" : "Sem descrição"}
              className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300 read-only:bg-slate-50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Vencimento</span>
            <input
              type="datetime-local"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              readOnly={!canEditCard}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm read-only:bg-slate-50"
            />
          </label>
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-slate-700">Tags</span>
            <TagSelect
              available={availableTags}
              selected={tags}
              onChange={setTags}
              disabled={!canEditCard}
              tagColors={tagColors}
            />
          </div>
        </div>

        {canEditCard ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty || !title.trim()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
            {saved && !dirty ? <span className="text-sm text-emerald-600">Salvo</span> : null}
          </div>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Responsáveis</h3>
          {responsibles.length === 0 ? (
            <p className="text-sm italic text-slate-400">Ninguém atribuído</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {responsibles.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-2 text-sm"
                >
                  <MemberAvatar name={m.google_full_name} avatarUrl={m.google_avatar_url} size="sm" />
                  <span className="text-slate-800">{m.google_full_name ?? "Membro"}</span>
                  {canEditKanban ? (
                    <button
                      type="button"
                      onClick={() => setPeople(responsibleIds.filter((id) => id !== m.user_id))}
                      disabled={busy}
                      aria-label={`Remover ${m.google_full_name ?? "responsável"}`}
                      className="text-slate-400 hover:text-red-600 disabled:opacity-50"
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canEditKanban && candidates.length ? (
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) setPeople([...responsibleIds, e.target.value]);
              }}
              disabled={busy}
              aria-label="Adicionar responsável"
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700"
            >
              <option value="">+ Adicionar responsável</option>
              {candidates.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.google_full_name ?? m.user_id}
                </option>
              ))}
            </select>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Comentários {comments.length ? `(${comments.length})` : ""}
          </h3>
          {comments.length === 0 ? (
            <p className="text-sm italic text-slate-400">Nenhum comentário ainda</p>
          ) : (
            <ul className="space-y-3">
              {comments.map((c) => {
                const author = memberById.get(c.author_id);
                const canDelete = c.author_id === currentUserId || isAdmin;
                return (
                  <li key={c.id} className="flex gap-3">
                    <MemberAvatar
                      name={author?.google_full_name}
                      avatarUrl={author?.google_avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          {author?.google_full_name ?? "Membro"}
                        </span>
                        <span>{formatDateTime(c.created_at)}</span>
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (!window.confirm("Excluir este comentário?")) return;
                              act(() => deleteKanbanCardComment({ ...scope, commentId: c.id }));
                            }}
                            disabled={busy}
                            className="ml-auto text-slate-400 hover:text-red-600 disabled:opacity-50"
                          >
                            excluir
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1 whitespace-pre-line break-words text-sm text-slate-800">
                        {c.content}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {canComment ? (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                act(
                  () => addKanbanCardComment({ ...scope, cardId: card.id, content: comment }),
                  () => setComment(""),
                );
              }}
            >
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={5000}
                placeholder="Escreva um comentário"
                aria-label="Novo comentário"
                className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
              />
              <button
                type="submit"
                disabled={busy || !comment.trim()}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Comentar
              </button>
            </form>
          ) : null}
        </section>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-500">
          <span>
            Criado por {creator?.google_full_name ?? "alguém"} em {formatDateTime(card.created_at)}
          </span>
          {canEditKanban ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm(`Excluir o card "${card.title}"?`)) return;
                act(() => deleteKanbanCard({ ...scope, cardId: card.id }), onClose);
              }}
              disabled={busy}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              Excluir card
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
