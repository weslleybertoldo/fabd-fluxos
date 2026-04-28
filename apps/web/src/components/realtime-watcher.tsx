"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";

export interface RealtimeSubscription {
  table: string;
  /** Filtro PostgREST tipo "flow_id=eq.uuid" — evita receber eventos irrelevantes. */
  filter?: string;
}

interface Props {
  /** Nome unico do canal pra esta page (evita colisao se ha multiplas subscribes). */
  channelName: string;
  subscriptions: RealtimeSubscription[];
  /** Tempo entre o evento receber e o refresh disparar — debounce pra batch updates. */
  debounceMs?: number;
}

/**
 * Monta um channel Supabase Realtime e dispara `router.refresh()` ao receber
 * qualquer evento (INSERT/UPDATE/DELETE) nas tabelas+filtros listados.
 *
 * Last-write-wins: o servidor sempre tem o ground truth — ao chegar evento,
 * apenas re-puxamos os dados via RSC. RLS aplica automaticamente nos eventos
 * (so chega o que o user pode ler).
 */
export function RealtimeWatcher({
  channelName,
  subscriptions,
  debounceMs = 600,
}: Props) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pulse, setPulse] = useState<number>(0);

  // Stringify das subscriptions pra dependency estavel
  const key = JSON.stringify(subscriptions);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase.channel(channelName);

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setPulse((p) => p + 1); // visual hint
        router.refresh();
      }, debounceMs);
    }

    for (const sub of subscriptions) {
      channel.on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        {
          event: "*",
          schema: "public",
          table: sub.table,
          ...(sub.filter ? { filter: sub.filter } : {}),
        },
        () => scheduleRefresh(),
      );
    }

    channel.subscribe();

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, key, debounceMs]);

  // Hint visual discreto: ponto que pulsa quando recebe evento
  return pulse > 0 ? (
    <div
      key={pulse}
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
      aria-live="polite"
      style={{ animation: "fade-out 2s ease-out forwards" }}
    >
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
      Atualizado
      <style jsx>{`
        @keyframes fade-out {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          15% {
            opacity: 1;
            transform: translateY(0);
          }
          70% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
      `}</style>
    </div>
  ) : null;
}
