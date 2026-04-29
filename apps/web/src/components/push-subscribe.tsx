"use client";

import { useEffect, useState } from "react";
import {
  deletePushSubscription,
  savePushSubscription,
} from "@/lib/actions/push";

type State = "loading" | "unsupported" | "denied" | "subscribed" | "unsubscribed";

interface Props {
  vapidPublicKey: string;
}

export function PushSubscribeButton({ vapidPublicKey }: Props) {
  const [state, setState] = useState<State>("loading");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    (async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        setState(sub ? "subscribed" : "unsubscribed");
      } catch (e) {
        console.error("SW register failed", e);
        setState("unsupported");
      }
    })();
  }, []);

  async function subscribe() {
    setPending(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "unsubscribed");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError("Subscription invalida");
        return;
      }
      const r = await savePushSubscription({
        subscription: {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
        userAgent: navigator.userAgent,
      });
      if (!r.ok) {
        setError(r.error);
        // best-effort: tenta unsubscribe se DB falhou
        try {
          await sub.unsubscribe();
        } catch {}
        return;
      }
      setState("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao ativar push");
    } finally {
      setPending(false);
    }
  }

  async function unsubscribe() {
    setPending(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await deletePushSubscription({ endpoint: sub.endpoint });
      }
      setState("unsubscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao desativar push");
    } finally {
      setPending(false);
    }
  }

  if (state === "loading") {
    return (
      <span className="text-xs text-slate-400">Verificando push...</span>
    );
  }
  if (state === "unsupported") {
    return (
      <span className="text-xs text-slate-400">
        Este navegador nao suporta push.
      </span>
    );
  }
  if (state === "denied") {
    return (
      <span className="text-xs text-red-600">
        Notificacoes bloqueadas. Libere nas configuracoes do navegador.
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {state === "subscribed" ? (
        <button
          type="button"
          onClick={unsubscribe}
          disabled={pending}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          Push ativado neste device — clique pra desativar
        </button>
      ) : (
        <button
          type="button"
          onClick={subscribe}
          disabled={pending}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {pending ? "Ativando..." : "Ativar notificacoes push"}
        </button>
      )}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : null}
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) out[i] = rawData.charCodeAt(i);
  return out;
}
