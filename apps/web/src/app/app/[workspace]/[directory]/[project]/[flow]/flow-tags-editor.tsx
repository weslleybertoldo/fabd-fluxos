"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTagToFlow,
  createTag,
  removeTagFromFlow,
} from "@/lib/actions/tags";
import type { TagRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  canEdit: boolean;
  allTags: TagRow[];
  flowTagIds: string[];
}

const TAG_COLORS = [
  "#64748B",
  "#1E3A8A",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#7C3AED",
  "#0EA5E9",
];

export function FlowTagsEditor({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  canEdit,
  allTags,
  flowTagIds,
}: Props) {
  const router = useRouter();
  const [openPicker, setOpenPicker] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(TAG_COLORS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const flowTags = flowTagIds
    .map((id) => allTags.find((t) => t.id === id))
    .filter((t): t is TagRow => Boolean(t));
  const availableTags = allTags.filter((t) => !flowTagIds.includes(t.id));

  function add(tag: TagRow) {
    setError(null);
    start(async () => {
      const r = await addTagToFlow({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        tagId: tag.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpenPicker(false);
      router.refresh();
    });
  }

  function remove(tag: TagRow) {
    setError(null);
    start(async () => {
      const r = await removeTagFromFlow({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        tagId: tag.id,
      });
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  function submitCreate() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    start(async () => {
      const r = await createTag({
        workspaceSlug,
        name,
        color: newColor,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // adicionar a tag recem criada ao flow
      const r2 = await addTagToFlow({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        tagId: r.data.tagId,
      });
      if (!r2.ok) {
        setError(r2.error);
      }
      setNewName("");
      setCreating(false);
      setOpenPicker(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {flowTags.length === 0 ? (
          <span className="text-xs italic text-slate-400">Sem tags</span>
        ) : (
          flowTags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-white"
              style={{ backgroundColor: t.color }}
            >
              {t.name}
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => remove(t)}
                  disabled={pending}
                  aria-label={`Remover tag ${t.name}`}
                  className="ml-0.5 text-white/80 hover:text-white"
                >
                  ✕
                </button>
              ) : null}
            </span>
          ))
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setOpenPicker((v) => !v)}
            disabled={pending}
            className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
          >
            {openPicker ? "Fechar" : "+ Tag"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {openPicker && canEdit ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {availableTags.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Existentes
              </p>
              <div className="flex flex-wrap gap-1">
                {availableTags.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => add(t)}
                    disabled={pending}
                    className="rounded-full px-2 py-0.5 text-[11px] font-medium text-white opacity-80 hover:opacity-100 disabled:opacity-50"
                    style={{ backgroundColor: t.color }}
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {creating ? (
            <div className="space-y-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={60}
                placeholder="Nome da tag"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
                disabled={pending}
                autoFocus
              />
              <div className="flex flex-wrap gap-1">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    aria-label={c}
                    className="h-5 w-5 rounded-full border-2"
                    style={{
                      backgroundColor: c,
                      borderColor: newColor === c ? "#0f172a" : "transparent",
                    }}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={submitCreate}
                  disabled={pending || !newName.trim()}
                  className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Criar e adicionar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-xs font-medium text-slate-600 hover:text-slate-900"
            >
              + Criar nova tag
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
