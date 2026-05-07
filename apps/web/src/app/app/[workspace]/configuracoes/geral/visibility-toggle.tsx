"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWorkspaceDiscoverable } from "@/lib/actions/members";

export function WorkspaceVisibilityToggle({
  workspaceId,
  initialIsDiscoverable,
}: {
  workspaceId: string;
  initialIsDiscoverable: boolean;
}) {
  const router = useRouter();
  const [isDiscoverable, setIsDiscoverable] = useState(initialIsDiscoverable);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !isDiscoverable;
    setError(null);
    setInfo(null);
    start(async () => {
      const r = await setWorkspaceDiscoverable({
        workspaceId,
        isDiscoverable: next,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setIsDiscoverable(next);
      setInfo(
        next
          ? "Workspace visivel na lista publica"
          : "Workspace ocultado da lista publica",
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={isDiscoverable}
          onClick={toggle}
          disabled={pending}
          className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition disabled:opacity-60 ${
            isDiscoverable ? "bg-emerald-600" : "bg-slate-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
              isDiscoverable ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-900">
            {isDiscoverable ? "Visivel na lista publica" : "Oculto da lista publica"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {isDiscoverable
              ? "Aparece em 'Workspaces disponiveis' pra quem ainda nao eh membro. Qualquer pessoa pode pedir acesso."
              : "So aparece pra quem ja eh membro (ativo, pendente ou bloqueado). Pra entrar, precisa do UUID compartilhado."}
          </p>
        </div>
      </label>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {info ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>
      ) : null}
    </div>
  );
}
