"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addChecklistItem,
  addChecklistSection,
  deleteChecklist,
  deleteChecklistItem,
  deleteChecklistSection,
  setChecklistItemCompleted,
  updateChecklistItem,
} from "@/lib/actions/checklists";
import type {
  ChecklistItemRow,
  ChecklistRow,
  ChecklistSectionRow,
} from "@/lib/types";

type DragHandle = {
  attributes?: Record<string, unknown>;
  listeners?: Record<string, unknown>;
};

interface Props {
  checklist: ChecklistRow;
  sections: ChecklistSectionRow[];
  itemsBySection: Record<string, ChecklistItemRow[]>;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canEdit: boolean;
  canReorder?: boolean;
  dragRef?: (el: HTMLElement | null) => void;
  dragStyle?: React.CSSProperties;
  dragHandle?: DragHandle;
  onUnstack?: () => void;
  availableTags?: string[];
}

export function ChecklistColumn({
  checklist,
  sections,
  itemsBySection,
  workspaceSlug,
  directorySlug,
  projectId,
  canEdit,
  canReorder = false,
  dragRef,
  dragStyle,
  dragHandle,
  onUnstack,
  availableTags = [],
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [pending, start] = useTransition();

  const base = { workspaceSlug, directorySlug, projectId };

  const totalItems = sections.reduce(
    (n, s) => n + (itemsBySection[s.id]?.length ?? 0),
    0,
  );
  const doneItems = sections.reduce(
    (n, s) => n + (itemsBySection[s.id]?.filter((i) => i.completed_at).length ?? 0),
    0,
  );

  function removeChecklist() {
    if (!confirm(`Excluir checklist "${checklist.name}" inteira?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteChecklist({ ...base, checklistId: checklist.id });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function addSection(formData: FormData) {
    const title = ((formData.get("title") as string) ?? "").trim();
    const description = ((formData.get("description") as string) ?? "").trim();
    if (!title) return;
    setError(null);
    start(async () => {
      const r = await addChecklistSection({
        ...base,
        checklistId: checklist.id,
        title,
        description: description || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAddingSection(false);
      router.refresh();
    });
  }

  return (
    <div
      ref={dragRef}
      style={dragStyle}
      className="flex w-full flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"
    >
      <div
        className={`flex items-start justify-between gap-2 rounded-xl ${
          canReorder ? "cursor-grab active:cursor-grabbing" : ""
        }`}
        {...(canReorder && dragHandle?.attributes ? dragHandle.attributes : {})}
        {...(canReorder && dragHandle?.listeners ? dragHandle.listeners : {})}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">
              {checklist.name}
            </h3>
            <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
              {checklist.kind === "flow" ? "fluxo" : "simples"}
            </span>
          </div>
          <span className="text-[10px] text-slate-500">
            {doneItems}/{totalItems} itens
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {onUnstack ? (
            <button
              type="button"
              onClick={onUnstack}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={pending}
              title="Desempilhar (coluna propria)"
              aria-label="Desempilhar"
              className="text-[11px] text-slate-400 hover:text-slate-700 disabled:opacity-50"
            >
              ⤧
            </button>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              onClick={removeChecklist}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={pending}
              aria-label="Excluir checklist"
              className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-50"
            >
              ✕
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        {sections.map((section) => (
          <SectionBlock
            key={section.id}
            section={section}
            items={itemsBySection[section.id] ?? []}
            canEdit={canEdit}
            canDeleteSection={canEdit && checklist.kind === "flow"}
            base={base}
            availableTags={availableTags}
          />
        ))}
      </div>

      {canEdit && checklist.kind === "flow" ? (
        addingSection ? (
          <form action={addSection} className="space-y-2 rounded-xl bg-white p-2">
            <input
              name="title"
              type="text"
              required
              maxLength={200}
              placeholder="Titulo da secao"
              className="w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
              disabled={pending}
            />
            <textarea
              name="description"
              rows={2}
              maxLength={2000}
              placeholder="Descricao (opcional)"
              className="w-full resize-none rounded-lg border border-slate-200 px-2 py-1 text-xs"
              disabled={pending}
            />
            <div className="flex gap-1">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pending ? "..." : "Adicionar secao"}
              </button>
              <button
                type="button"
                onClick={() => setAddingSection(false)}
                disabled={pending}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-white hover:text-slate-900"
          >
            + Adicionar secao
          </button>
        )
      ) : null}
    </div>
  );
}

function SectionBlock({
  section,
  items,
  canEdit,
  canDeleteSection,
  base,
  availableTags,
}: {
  section: ChecklistSectionRow;
  items: ChecklistItemRow[];
  canEdit: boolean;
  canDeleteSection: boolean;
  base: { workspaceSlug: string; directorySlug: string; projectId: string };
  availableTags: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // painel de observacao + lembrete (aberto ao clicar no nome do item)
  const [panelId, setPanelId] = useState<string | null>(null);
  const [pNote, setPNote] = useState("");
  const [pTags, setPTags] = useState("");
  const [pMode, setPMode] = useState<"none" | "once" | "daily">("none");
  const [pDate, setPDate] = useState("");
  const [pTime, setPTime] = useState("");

  function openPanel(item: ChecklistItemRow) {
    if (panelId === item.id) {
      setPanelId(null);
      return;
    }
    setError(null);
    setPanelId(item.id);
    setPNote(item.note ?? "");
    setPTags((item.tags ?? []).join(", "));
    const m = item.reminder_recurrence ?? "none";
    setPMode(m);
    setPDate(m === "once" && item.reminder_at ? toDatetimeLocal(item.reminder_at) : "");
    setPTime(m === "daily" && item.reminder_at ? toTimeInput(item.reminder_at) : "");
  }

  function savePanel(item: ChecklistItemRow) {
    setError(null);
    let reminderAt: string | null = null;
    if (pMode === "once") {
      if (!pDate) {
        setError("Informe a data/hora do lembrete");
        return;
      }
      reminderAt = new Date(pDate).toISOString();
    } else if (pMode === "daily") {
      if (!pTime) {
        setError("Informe o horario do lembrete");
        return;
      }
      const [h, mi] = pTime.split(":").map(Number);
      const d = new Date();
      d.setHours(h ?? 0, mi ?? 0, 0, 0);
      reminderAt = d.toISOString();
    }
    start(async () => {
      const r = await updateChecklistItem({
        ...base,
        itemId: item.id,
        note: pNote,
        tags: pTags.split(",").map((t) => t.trim()).filter(Boolean),
        reminderRecurrence: pMode === "none" ? null : pMode,
        reminderAt,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPanelId(null);
      router.refresh();
    });
  }

  function addItem() {
    const t = text.trim();
    if (!t) return;
    setError(null);
    start(async () => {
      const r = await addChecklistItem({ ...base, sectionId: section.id, text: t });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setText("");
      router.refresh();
    });
  }

  function toggle(item: ChecklistItemRow) {
    setError(null);
    start(async () => {
      const r = await setChecklistItemCompleted({
        ...base,
        itemId: item.id,
        completed: !item.completed_at,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function removeItem(item: ChecklistItemRow) {
    setError(null);
    start(async () => {
      const r = await deleteChecklistItem({ ...base, itemId: item.id });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function removeSection() {
    if (!confirm(`Excluir secao "${section.title}" e seus itens?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteChecklistSection({ ...base, sectionId: section.id });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          {section.title}
        </h4>
        {canDeleteSection ? (
          <button
            type="button"
            onClick={removeSection}
            disabled={pending}
            aria-label="Excluir secao"
            className="shrink-0 text-[10px] text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            ✕ secao
          </button>
        ) : null}
      </div>

      {section.description ? (
        <p className="mb-2 text-[11px] text-slate-500">{section.description}</p>
      ) : null}

      {error ? (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {error}
        </p>
      ) : null}

      <ul className="mb-1 space-y-1">
        {items.map((item) => {
          const completed = !!item.completed_at;
          const hasNote = !!(item.note && item.note.trim());
          const hasTags = (item.tags?.length ?? 0) > 0;
          const hasReminder = !!item.reminder_recurrence;
          const open = panelId === item.id;
          return (
            <li key={item.id}>
              <div className="group flex items-start gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => toggle(item)}
                  disabled={pending || !canEdit}
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
                <button
                  type="button"
                  onClick={() => openPanel(item)}
                  className={`flex-1 text-left ${
                    completed ? "text-emerald-800 line-through" : "text-slate-800"
                  } hover:text-slate-950`}
                >
                  {item.text}
                </button>
                {hasNote ? (
                  <span title="Tem observacao" className="shrink-0 font-bold text-amber-500">
                    !
                  </span>
                ) : null}
                {hasTags ? (
                  <span
                    title={`Tags: ${item.tags.join(", ")}`}
                    className="shrink-0 font-bold text-purple-600"
                  >
                    |
                  </span>
                ) : null}
                {hasReminder ? (
                  <span title="Tem lembrete" className="shrink-0 text-slate-400">
                    🔔
                  </span>
                ) : null}
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => removeItem(item)}
                    disabled={pending}
                    aria-label="Excluir item"
                    className="shrink-0 text-red-500 opacity-0 transition hover:text-red-700 group-hover:opacity-100 disabled:opacity-50"
                  >
                    ✕
                  </button>
                ) : null}
              </div>

              {open ? (
                <div
                  className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
                  role="dialog"
                  aria-modal="true"
                  onClick={(e) => {
                    if (e.target === e.currentTarget && !pending) setPanelId(null);
                  }}
                >
                  <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-xl">
                    <header className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{item.text}</h3>
                      <button
                        type="button"
                        onClick={() => setPanelId(null)}
                        disabled={pending}
                        aria-label="Fechar"
                        className="text-slate-400 hover:text-slate-700"
                      >
                        ✕
                      </button>
                    </header>

                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-600">Observacao</span>
                      <textarea
                        value={pNote}
                        onChange={(e) => setPNote(e.target.value)}
                        rows={3}
                        maxLength={2000}
                        placeholder="Observacao..."
                        disabled={!canEdit || pending}
                        className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      />
                    </label>

                    <div className="space-y-1">
                      <span className="text-xs font-medium text-slate-600">Tags</span>
                      {availableTags.length === 0 ? (
                        <p className="text-[11px] italic text-slate-400">
                          Nenhuma tag criada. Crie em Acoes → Gerenciar tags.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {availableTags.map((tag) => {
                            const sel = pTags
                              .split(",")
                              .map((t) => t.trim())
                              .includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                disabled={!canEdit || pending}
                                onClick={() => {
                                  const cur = pTags.split(",").map((t) => t.trim()).filter(Boolean);
                                  const next = sel ? cur.filter((t) => t !== tag) : [...cur, tag];
                                  setPTags(next.join(", "));
                                }}
                                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                                  sel
                                    ? "border-purple-600 bg-purple-600 text-white"
                                    : "border-slate-200 bg-white text-slate-600 hover:border-purple-300"
                                } disabled:opacity-50`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs font-medium text-slate-600">Lembrete</span>
                      <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
                        {(["none", "once", "daily"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPMode(m)}
                            disabled={!canEdit || pending}
                            className={`flex-1 rounded-md px-2 py-1 font-medium transition ${
                              pMode === m ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-900"
                            }`}
                          >
                            {m === "none" ? "Sem lembrete" : m === "once" ? "Único" : "Recorrente"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {pMode === "once" ? (
                      <input
                        type="datetime-local"
                        value={pDate}
                        onChange={(e) => setPDate(e.target.value)}
                        disabled={!canEdit || pending}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      />
                    ) : pMode === "daily" ? (
                      <input
                        type="time"
                        value={pTime}
                        onChange={(e) => setPTime(e.target.value)}
                        disabled={!canEdit || pending}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                      />
                    ) : null}

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPanelId(null)}
                        disabled={pending}
                        className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Fechar
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => savePanel(item)}
                          disabled={pending}
                          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                        >
                          {pending ? "Salvando..." : "Salvar"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canEdit ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addItem();
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
      ) : null}
    </div>
  );
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function toTimeInput(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
