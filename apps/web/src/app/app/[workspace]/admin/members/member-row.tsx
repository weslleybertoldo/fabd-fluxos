"use client";

import { useState, useTransition } from "react";
import { MemberAvatar } from "@/components/member-avatar";
import { approveMember, blockMember, changeMemberRole } from "@/lib/actions/members";
import type { WorkspaceRole } from "@fabd-fluxos/db";
import type { WorkspaceMemberRow } from "@/lib/types";

const ROLES: WorkspaceRole[] = ["admin", "diretor", "membro"];

export function MemberRow({
  member,
  workspaceId,
  mode,
}: {
  member: WorkspaceMemberRow;
  workspaceId: string;
  mode: "pending" | "active" | "blocked";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosenRole, setChosenRole] = useState<WorkspaceRole>(
    mode === "pending" ? "membro" : member.role,
  );

  function call(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <MemberAvatar name={member.google_full_name} avatarUrl={member.google_avatar_url} size="md" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {member.google_full_name ?? "Sem nome"}
          </p>
          <p className="truncate text-xs text-slate-500">
            {mode === "pending"
              ? "Solicitou acesso"
              : `${member.role} · desde ${new Date(member.approved_at ?? member.created_at).toLocaleDateString("pt-BR")}`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {mode === "pending" ? (
          <>
            <select
              value={chosenRole}
              onChange={(e) => setChosenRole(e.target.value as WorkspaceRole)}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={() => call(() => approveMember(workspaceId, member.id, chosenRole))}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Aprovar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => call(() => blockMember(workspaceId, member.id))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Recusar
            </button>
          </>
        ) : null}

        {mode === "active" ? (
          <>
            <select
              value={chosenRole}
              onChange={(e) => {
                const r = e.target.value as WorkspaceRole;
                setChosenRole(r);
                call(() => changeMemberRole(workspaceId, member.id, r));
              }}
              disabled={pending}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={pending}
              onClick={() => call(() => blockMember(workspaceId, member.id))}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Bloquear
            </button>
          </>
        ) : null}

        {mode === "blocked" ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => call(() => approveMember(workspaceId, member.id, member.role))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Reativar
          </button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-red-600 sm:basis-full">{error}</p> : null}
    </li>
  );
}
