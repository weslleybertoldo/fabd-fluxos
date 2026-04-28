"use client";

import { useState } from "react";
import { MemberAvatar } from "./member-avatar";
import type { WorkspaceMemberRow } from "@/lib/types";

type Option = Pick<WorkspaceMemberRow, "user_id" | "google_full_name" | "google_avatar_url">;

interface MemberPickerProps {
  name: string;
  members: Option[];
  defaultValue?: string | null;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
}

/**
 * Select com avatar + nome dos members ativos pra escolher responsavel.
 * Renderiza um <select> nativo (sem JS extra) — a versao com combobox vai depois.
 */
export function MemberPicker({
  name,
  members,
  defaultValue,
  required,
  allowEmpty = true,
  emptyLabel = "Sem responsavel",
}: MemberPickerProps) {
  const [selected, setSelected] = useState<string>(defaultValue ?? "");
  const current = members.find((m) => m.user_id === selected) ?? null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
        {current ? (
          <MemberAvatar
            name={current.google_full_name}
            avatarUrl={current.google_avatar_url}
            size="sm"
          />
        ) : (
          <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
            ?
          </span>
        )}
        <select
          name={name}
          required={required}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="flex-1 bg-transparent text-sm text-slate-900 outline-none"
        >
          {allowEmpty ? <option value="">{emptyLabel}</option> : null}
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.google_full_name ?? m.user_id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
