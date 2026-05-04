"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type UpdatePayload = { version?: string; url?: string };

type ElectronAPI = {
  onUpdateAvailable?: (cb: (payload: UpdatePayload) => void) => () => void;
};

export function DesktopUpdateToast({ workspaceSlug }: { workspaceSlug: string }) {
  const [info, setInfo] = useState<UpdatePayload | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
    if (!api?.onUpdateAvailable) return;
    const off = api.onUpdateAvailable((payload) => {
      setInfo(payload);
      setDismissed(false);
    });
    return () => {
      try {
        off?.();
      } catch {
        /* noop */
      }
    };
  }, []);

  if (!info || dismissed) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-lg">
      <p className="text-sm font-semibold text-blue-900">
        Nova versao disponivel{info.version ? ` (v${info.version})` : ""}
      </p>
      <p className="mt-1 text-xs text-blue-800">
        Voce pode escolher quando atualizar — nada eh baixado automaticamente.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/app/${workspaceSlug}/configuracoes/atualizacoes`}
          onClick={() => setDismissed(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
        >
          Abrir Configuracoes
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Depois
        </button>
      </div>
    </div>
  );
}
