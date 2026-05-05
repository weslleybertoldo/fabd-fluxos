"use client";

import { MemberAvatar } from "@/components/member-avatar";
import type { PhaseRow, WorkspaceMemberRow } from "@/lib/types";

type MemberLite = Pick<
  WorkspaceMemberRow,
  "user_id" | "google_full_name" | "google_avatar_url"
>;

export function PhaseModal({
  title,
  submitLabel,
  phase,
  onSubmit,
  onClose,
  pending,
  error,
  initialFocus,
}: {
  title: string;
  submitLabel: string;
  phase?: PhaseRow;
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
  initialFocus?: "name" | "due_date";
}) {
  const defaultDate = phase?.due_date
    ? toLocalInput(phase.due_date)
    : "";
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        action={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">Nome da fase</span>
          <input
            name="name"
            type="text"
            required
            maxLength={200}
            defaultValue={phase?.name ?? ""}
            placeholder="Ex.: Publicar regulamento"
            autoFocus={initialFocus !== "due_date"}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Descricao <span className="text-slate-400">(opcional)</span>
          </span>
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={phase?.description ?? ""}
            className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Data de vencimento <span className="text-slate-400">(opcional)</span>
          </span>
          <input
            name="due_date"
            type="datetime-local"
            defaultValue={defaultDate}
            autoFocus={initialFocus === "due_date"}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-700">
            Cor de destaque <span className="text-slate-400">(opcional)</span>
          </span>
          <input
            name="color"
            type="color"
            defaultValue={phase?.color ?? "#1E3A8A"}
            className="h-9 w-16 cursor-pointer rounded border border-slate-200"
          />
        </label>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
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
            {pending ? "Salvando..." : submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

export function PhaseResponsiblesModal({
  phase,
  members,
  currentIds,
  onSubmit,
  onClose,
  pending,
  error,
}: {
  phase: PhaseRow;
  members: MemberLite[];
  currentIds: string[];
  onSubmit: (formData: FormData) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = new Set(currentIds);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        action={onSubmit}
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-slate-900">
            Responsaveis pela fase
          </h2>
          <p className="text-sm text-slate-500 truncate">{phase.name}</p>
        </header>

        <p className="text-xs text-slate-500">
          Marque os membros que sao responsaveis. Cada um recebe notificacao ao ser adicionado.
        </p>

        {members.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            Nenhum membro ativo no workspace.
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {members.map((m) => (
              <label
                key={m.user_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  name="responsibleIds"
                  value={m.user_id}
                  defaultChecked={initial.has(m.user_id)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <MemberAvatar
                  name={m.google_full_name}
                  avatarUrl={m.google_avatar_url}
                  size="sm"
                />
                <span className="flex-1 text-sm text-slate-800">
                  {m.google_full_name ?? m.user_id}
                </span>
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
            onClick={onClose}
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
  );
}

// datetime-local espera "YYYY-MM-DDTHH:mm" no fuso local; ISO em UTC quebra o
// preenchimento quando o cliente nao esta em UTC.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
