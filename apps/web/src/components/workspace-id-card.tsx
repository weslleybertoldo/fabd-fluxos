"use client";

import { useState } from "react";

interface Props {
  workspaceId: string;
  workspaceName: string;
}

/**
 * Card que exibe o UUID do workspace e botao "Copiar". Admin compartilha
 * com membros novos pra eles entrarem via /app → busca por ID.
 */
export function WorkspaceIdCard({ workspaceId, workspaceName }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(workspaceId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — em browsers sem clipboard a UI ainda mostra o ID
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900">
            ID do workspace pra compartilhar
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            Mande este UUID pra qualquer pessoa que voce quer convidar. Ela
            cola em <code className="rounded bg-white px-1 py-0.5 text-[11px] text-slate-700">/app</code> &gt; &quot;Buscar workspace por ID&quot; e pede acesso.
          </p>
          <code className="mt-2 inline-block rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-sm text-slate-800 break-all">
            {workspaceId}
          </code>
        </div>
        <button
          type="button"
          onClick={copy}
          className={`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition ${
            copied
              ? "bg-emerald-600 text-white"
              : "bg-slate-900 text-white hover:bg-slate-800"
          }`}
          aria-label={`Copiar ID do workspace ${workspaceName}`}
        >
          {copied ? "Copiado!" : "Copiar ID"}
        </button>
      </div>
    </section>
  );
}
