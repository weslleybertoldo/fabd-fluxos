"use client";

import { useEffect, useState } from "react";
import { saveFcmToken } from "@/lib/actions/fcm";

type Status =
  | { kind: "loading" }
  | { kind: "not-native"; platform: string }
  | { kind: "no-plugin" }
  | { kind: "perm-denied"; receive: string }
  | { kind: "registering" }
  | { kind: "registered"; token: string }
  | { kind: "register-error"; message: string }
  | { kind: "save-error"; message: string };

/**
 * Diagnostico de FCM Android: mostra estado atual da permissao + token,
 * com botao de retry. Permite debugar quando device_tokens fica vazio
 * mesmo apos login no APK.
 */
export function FcmStatus() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    (async () => {
      try {
        const cap = (window as unknown as {
          Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
        }).Capacitor;

        if (!cap?.isNativePlatform?.()) {
          if (!cancelled) {
            setStatus({ kind: "not-native", platform: "web" });
          }
          return;
        }

        const platform = cap.getPlatform?.() ?? "unknown";
        if (platform !== "android" && platform !== "ios") {
          if (!cancelled) setStatus({ kind: "not-native", platform });
          return;
        }

        const mod = await import(
          /* webpackIgnore: true */ "@capacitor/push-notifications"
        ).catch((err) => {
          console.error("[fcm-status] import falhou:", err);
          return null;
        });
        if (!mod) {
          if (!cancelled) setStatus({ kind: "no-plugin" });
          return;
        }
        const { PushNotifications } = mod as typeof import("@capacitor/push-notifications");

        const perm = await PushNotifications.checkPermissions();
        let granted = perm.receive === "granted";
        if (!granted) {
          if (!cancelled) setStatus({ kind: "registering" });
          const req = await PushNotifications.requestPermissions();
          granted = req.receive === "granted";
          if (!granted) {
            if (!cancelled) setStatus({ kind: "perm-denied", receive: req.receive });
            return;
          }
        }

        if (!cancelled) setStatus({ kind: "registering" });

        // Promise wrapper pros eventos do Capacitor
        const tokenPromise = new Promise<string>((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("Timeout esperando token (15s)"));
          }, 15_000);

          PushNotifications.addListener("registration", (token) => {
            clearTimeout(timeoutId);
            resolve(token.value);
          });
          PushNotifications.addListener("registrationError", (err) => {
            clearTimeout(timeoutId);
            reject(new Error(JSON.stringify(err)));
          });
        });

        await PushNotifications.register();
        const tokenValue = await tokenPromise;
        if (cancelled) return;

        const r = await saveFcmToken({
          token: tokenValue,
          platform: platform as "android" | "ios",
          appVersion: null,
        });

        if (!r.ok) {
          if (!cancelled) setStatus({ kind: "save-error", message: r.error });
          return;
        }

        if (!cancelled) setStatus({ kind: "registered", token: tokenValue });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[fcm-status] erro:", e);
        if (!cancelled) setStatus({ kind: "register-error", message: msg });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [retry]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-sm font-semibold text-slate-900">
        Status de notificações push
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Diagnóstico do FCM no Android. Em web/desktop não se aplica.
      </p>
      <div className="mt-3 text-sm">
        {renderStatus(status)}
      </div>
      <button
        type="button"
        onClick={() => setRetry((r) => r + 1)}
        className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Tentar de novo
      </button>
    </div>
  );
}

function renderStatus(s: Status) {
  switch (s.kind) {
    case "loading":
      return (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
          Carregando…
        </p>
      );
    case "not-native":
      return (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
          Não está no app nativo (plataforma: <code>{s.platform}</code>). FCM
          push só funciona dentro do APK Android.
        </p>
      );
    case "no-plugin":
      return (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          Plugin <code>@capacitor/push-notifications</code> não disponível. Esse
          APK pode estar desatualizado — instale a versão mais recente.
        </p>
      );
    case "perm-denied":
      return (
        <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
          <p className="font-semibold">Permissão de notificação negada.</p>
          <p className="mt-1 text-xs">
            Status atual: <code>{s.receive}</code>. Vá em{" "}
            <strong>Configurações Android → Apps → FABD Fluxos → Notificações</strong>{" "}
            e ative.
          </p>
        </div>
      );
    case "registering":
      return (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-700">
          Registrando token Firebase… (até 15 s)
        </p>
      );
    case "registered":
      return (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          <p className="font-semibold">✓ Token registrado e salvo no servidor.</p>
          <p className="mt-1 break-all text-[10px] text-emerald-700">
            Token: <code>{s.token.slice(0, 24)}…{s.token.slice(-8)}</code>
          </p>
        </div>
      );
    case "register-error":
      return (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          <p className="font-semibold">Erro ao registrar:</p>
          <p className="mt-1 break-all text-xs">{s.message}</p>
        </div>
      );
    case "save-error":
      return (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">
          <p className="font-semibold">Token gerado mas falhou ao salvar:</p>
          <p className="mt-1 break-all text-xs">{s.message}</p>
        </div>
      );
  }
}
