"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestMembershipById } from "@/lib/actions/members";

export function RequestAccessButton({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function ask() {
    setError(null);
    start(async () => {
      const r = await requestMembershipById(workspaceId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-4 space-y-2">
      <button
        type="button"
        onClick={ask}
        disabled={pending}
        className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Enviando..." : "Solicitar acesso"}
      </button>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
