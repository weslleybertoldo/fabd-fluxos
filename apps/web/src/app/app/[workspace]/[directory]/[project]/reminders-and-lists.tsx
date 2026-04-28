"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createReminder,
  deleteReminder,
  setReminderCompleted,
} from "@/lib/actions/reminders";
import {
  addListItem,
  createList,
  deleteList,
  deleteListItem,
  setListItemCompleted,
} from "@/lib/actions/lists";
import type { ReminderRow, SimpleListItemRow, SimpleListRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  reminders: ReminderRow[];
  lists: SimpleListRow[];
  itemsByList: Record<string, SimpleListItemRow[]>;
}

export function RemindersAndLists({
  workspaceSlug,
  directorySlug,
  projectId,
  canCreate,
  reminders,
  lists,
  itemsByList,
}: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RemindersBox
        workspaceSlug={workspaceSlug}
        directorySlug={directorySlug}
        projectId={projectId}
        canCreate={canCreate}
        reminders={reminders}
      />
      <ListsBox
        workspaceSlug={workspaceSlug}
        directorySlug={directorySlug}
        projectId={projectId}
        canCreate={canCreate}
        lists={lists}
        itemsByList={itemsByList}
      />
    </div>
  );
}

function RemindersBox({
  workspaceSlug,
  directorySlug,
  projectId,
  canCreate,
  reminders,
}: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  reminders: ReminderRow[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const dueDate = (formData.get("due_date") as string) ?? "";
    start(async () => {
      const r = await createReminder({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdding(false);
      router.refresh();
    });
  }

  function toggle(rmd: ReminderRow) {
    setError(null);
    start(async () => {
      const r = await setReminderCompleted({
        workspaceSlug,
        directorySlug,
        projectId,
        reminderId: rmd.id,
        completed: !rmd.completed_at,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  function remove(rmd: ReminderRow) {
    if (!confirm(`Excluir lembrete "${rmd.name}"?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteReminder({
        workspaceSlug,
        directorySlug,
        projectId,
        reminderId: rmd.id,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Lembretes
        </h3>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {adding ? "Cancelar" : "+ Lembrete"}
          </button>
        ) : null}
      </header>

      {adding ? (
        <form action={submit} className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3">
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Ex.: Confirmar com a federacao"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            disabled={pending}
          />
          <input
            name="due_date"
            type="datetime-local"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "..." : "Adicionar"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {reminders.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs italic text-slate-400">
          Nenhum lembrete
        </p>
      ) : (
        <ul className="space-y-2">
          {reminders.map((r) => {
            const completed = !!r.completed_at;
            const isOverdue =
              !completed && r.due_date && new Date(r.due_date) < new Date();
            const tone = completed
              ? "border-emerald-200 bg-emerald-50"
              : isOverdue
                ? "border-red-200 bg-red-50"
                : "border-slate-200 bg-white";
            return (
              <li
                key={r.id}
                className={`flex items-start gap-2 rounded-xl border p-2 ${tone}`}
              >
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  disabled={pending}
                  aria-label={completed ? "Reativar" : "Concluir"}
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 transition ${
                    completed
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
                  } disabled:opacity-50`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm ${
                      completed ? "text-emerald-900 line-through" : "text-slate-900"
                    }`}
                  >
                    {r.name}
                  </p>
                  {r.due_date ? (
                    <p
                      className={`text-[10px] ${
                        isOverdue ? "font-semibold text-red-700" : "text-slate-500"
                      }`}
                    >
                      {formatDate(r.due_date)}
                      {isOverdue ? " · vencido" : null}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  disabled={pending}
                  aria-label="Excluir"
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ListsBox({
  workspaceSlug,
  directorySlug,
  projectId,
  canCreate,
  lists,
  itemsByList,
}: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canCreate: boolean;
  lists: SimpleListRow[];
  itemsByList: Record<string, SimpleListItemRow[]>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    start(async () => {
      const r = await createList({
        workspaceSlug,
        directorySlug,
        projectId,
        name,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdding(false);
      router.refresh();
    });
  }

  function removeList(list: SimpleListRow) {
    if (!confirm(`Excluir lista "${list.name}" e todos os itens?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteList({
        workspaceSlug,
        directorySlug,
        projectId,
        listId: list.id,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Listas de pendencias
        </h3>
        {canCreate ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {adding ? "Cancelar" : "+ Lista"}
          </button>
        ) : null}
      </header>

      {adding ? (
        <form action={submit} className="mb-3 space-y-2 rounded-xl bg-slate-50 p-3">
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            placeholder="Ex.: Pendencias gerais do torneio"
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
            disabled={pending}
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "..." : "Criar lista"}
          </button>
        </form>
      ) : null}

      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {lists.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-center text-xs italic text-slate-400">
          Nenhuma lista
        </p>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => (
            <ListBlock
              key={list.id}
              list={list}
              items={itemsByList[list.id] ?? []}
              workspaceSlug={workspaceSlug}
              directorySlug={directorySlug}
              projectId={projectId}
              onDelete={() => removeList(list)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ListBlock({
  list,
  items,
  workspaceSlug,
  directorySlug,
  projectId,
  onDelete,
}: {
  list: SimpleListRow;
  items: SimpleListItemRow[];
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  onDelete: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const t = text.trim();
    if (!t) return;
    setError(null);
    start(async () => {
      const r = await addListItem({
        workspaceSlug,
        directorySlug,
        projectId,
        listId: list.id,
        text: t,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setText("");
      router.refresh();
    });
  }

  function toggle(item: SimpleListItemRow) {
    setError(null);
    start(async () => {
      const r = await setListItemCompleted({
        workspaceSlug,
        directorySlug,
        projectId,
        itemId: item.id,
        completed: !item.completed_at,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function removeItem(item: SimpleListItemRow) {
    setError(null);
    start(async () => {
      const r = await deleteListItem({
        workspaceSlug,
        directorySlug,
        projectId,
        itemId: item.id,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  const completedCount = items.filter((i) => i.completed_at).length;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-900">{list.name}</h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {completedCount}/{items.length}
          </span>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Excluir lista"
            className="text-[10px] text-red-500 hover:text-red-700"
          >
            ✕ lista
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="mb-2 space-y-1">
        {items.map((item) => {
          const completed = !!item.completed_at;
          return (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggle(item)}
                disabled={pending}
                aria-label={completed ? "Reativar" : "Concluir"}
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border-2 transition ${
                  completed
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
                } disabled:opacity-50`}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </button>
              <span
                className={`flex-1 ${
                  completed ? "text-emerald-800 line-through" : "text-slate-800"
                }`}
              >
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => removeItem(item)}
                disabled={pending}
                aria-label="Excluir item"
                className="text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex gap-1"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder="Adicionar item..."
          className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || !text.trim()}
          className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          +
        </button>
      </form>
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
