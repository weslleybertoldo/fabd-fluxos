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
} from "@/lib/actions/checklists";
import type {
  ChecklistItemRow,
  ChecklistRow,
  ChecklistSectionRow,
} from "@/lib/types";

interface Props {
  checklist: ChecklistRow;
  sections: ChecklistSectionRow[];
  itemsBySection: Record<string, ChecklistItemRow[]>;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canEdit: boolean;
}

export function ChecklistColumn({
  checklist,
  sections,
  itemsBySection,
  workspaceSlug,
  directorySlug,
  projectId,
  canEdit,
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
    <div className="flex w-80 shrink-0 flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
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
        {canEdit ? (
          <button
            type="button"
            onClick={removeChecklist}
            disabled={pending}
            aria-label="Excluir checklist"
            className="shrink-0 text-[10px] text-red-500 hover:text-red-700 disabled:opacity-50"
          >
            ✕
          </button>
        ) : null}
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
}: {
  section: ChecklistSectionRow;
  items: ChecklistItemRow[];
  canEdit: boolean;
  canDeleteSection: boolean;
  base: { workspaceSlug: string; directorySlug: string; projectId: string };
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

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
          return (
            <li key={item.id} className="flex items-start gap-2 text-xs">
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
              <span
                className={`flex-1 ${
                  completed ? "text-emerald-800 line-through" : "text-slate-800"
                }`}
              >
                {item.text}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  disabled={pending}
                  aria-label="Excluir item"
                  className="text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  ✕
                </button>
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
