"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  available: string[];
  selected: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
  tagColors?: Record<string, string>;
}

/** Dropdown de tags com checkbox. Selecionar marca/desmarca a tag. */
export function TagSelect({ available, selected, onChange, disabled, tagColors = {} }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggle(tag: string) {
    onChange(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-sm text-slate-700 disabled:opacity-50"
      >
        <span className="truncate">
          {selected.length ? selected.join(", ") : "Selecionar tags"}
        </span>
        <span className="shrink-0 text-slate-400">▾</span>
      </button>

      {open ? (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {available.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] italic text-slate-400">
              Nenhuma tag. Crie em Acoes → Gerenciar tags.
            </p>
          ) : (
            available.map((tag) => (
              <label
                key={tag}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(tag)}
                  onChange={() => toggle(tag)}
                  className="h-3.5 w-3.5 accent-slate-900"
                />
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tagColors[tag] ?? "#9333ea" }}
                />
                <span className="truncate text-slate-700">{tag}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
