"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/member-avatar";
import {
  approveMember,
  blockMember,
  changeMemberRole,
  setMemberDirectoryAccess,
} from "@/lib/actions/members";
import type { WorkspaceRole } from "@fabd-fluxos/db";
import type { DirectoryRow, WorkspaceMemberRow } from "@/lib/types";

const ROLES: WorkspaceRole[] = ["admin", "diretor", "membro"];

interface Props {
  member: WorkspaceMemberRow;
  workspaceId: string;
  mode: "pending" | "active" | "blocked";
  directories?: DirectoryRow[];
  currentAccess?: string[]; // directory_ids ja atribuidos
}

export function MemberRow({
  member,
  workspaceId,
  mode,
  directories = [],
  currentAccess = [],
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [chosenRole, setChosenRole] = useState<WorkspaceRole>(
    mode === "pending" ? "membro" : member.role,
  );
  const [accessOpen, setAccessOpen] = useState(false);

  function call(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error);
    });
  }

  function submitAccess(formData: FormData) {
    const directoryIds = formData
      .getAll("directoryIds")
      .map(String)
      .filter(Boolean);
    setError(null);
    startTransition(async () => {
      const r = await setMemberDirectoryAccess({
        workspaceId,
        workspaceMemberId: member.id,
        directoryIds,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAccessOpen(false);
      router.refresh();
    });
  }

  const isAdminMember = member.role === "admin";
  const accessLabel = isAdminMember
    ? "Todas (admin)"
    : currentAccess.length === 0
      ? "Todas (sem restricao)"
      : `${currentAccess.length} de ${directories.length}`;

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center">
      <div className="flex flex-1 items-center gap-3">
        <MemberAvatar name={member.google_full_name} avatarUrl={member.google_avatar_url} size="md" />
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {member.google_full_name ?? "Sem nome"}
          </p>
          {member.google_email ? (
            <p className="truncate text-xs text-slate-500">{member.google_email}</p>
          ) : null}
          <p className="truncate text-xs text-slate-400">
            {mode === "pending"
              ? "Solicitou acesso"
              : `${member.role} · desde ${new Date(member.approved_at ?? member.created_at).toLocaleDateString("pt-BR")}`}
          </p>
          {mode === "active" && !isAdminMember ? (
            <p className="text-[11px] text-slate-400">Acessos: {accessLabel}</p>
          ) : null}
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
            {!isAdminMember ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setAccessOpen(true)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Acessos
              </button>
            ) : null}
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

      {accessOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setAccessOpen(false);
          }}
        >
          <form
            action={submitAccess}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
          >
            <header className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-900">
                Acessos do membro
              </h2>
              <p className="text-sm text-slate-500">
                {member.google_full_name ?? member.google_email ?? "Membro"}
              </p>
            </header>

            <p className="text-xs text-slate-500">
              Marque as diretorias que este membro pode ver. Sem marcacao =
              acesso a TODAS as diretorias.
            </p>

            {directories.length === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                Nenhuma diretoria cadastrada no workspace.
              </p>
            ) : (
              <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
                {directories.map((d) => (
                  <label
                    key={d.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      name="directoryIds"
                      value={d.id}
                      defaultChecked={currentAccess.includes(d.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span className="flex-1 text-sm text-slate-800">{d.name}</span>
                  </label>
                ))}
              </div>
            )}

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAccessOpen(false)}
                disabled={pending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {pending ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </li>
  );
}
