"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";
import { isNativePlatform, openExternalUrl } from "@/lib/native";

export function LoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const native = isNativePlatform();
      // Native (APK): redireciona pra deep link `fabd-fluxos://auth/callback`
      // que o AndroidManifest captura. O Browser nativo (Custom Tab) abre o
      // OAuth do Google, e ao terminar o app eh reaberto via deep link.
      // Web/Desktop: redireciona pra rota Next normal `/auth/callback`.
      const redirectTo = native
        ? "fabd-fluxos://auth/callback"
        : `${window.location.origin}/auth/callback`;
      const { data, error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: { access_type: "offline", prompt: "consent" },
          skipBrowserRedirect: native, // no native, abrimos manualmente em Custom Tab
        },
      });
      if (authError) throw authError;
      if (native && data?.url) {
        await openExternalUrl(data.url);
        // o flow continua no listener de deep link (NativeAuthBridge)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado ao iniciar login");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={handleLogin}
        disabled={loading}
        className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-6 font-semibold text-slate-900 shadow-lg transition hover:bg-slate-100 disabled:opacity-60"
      >
        {loading ? (
          <span className="size-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" />
        ) : (
          <GoogleIcon className="size-5" />
        )}
        <span>{loading ? "Redirecionando..." : "Entrar com Google"}</span>
      </button>
      {error ? <p className="text-sm text-red-200">{error}</p> : null}
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.5 29.6 4.5 24 4.5 16.3 4.5 9.6 8.9 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 43.5c5.5 0 10.4-2.1 14.1-5.4l-6.5-5.5c-2 1.4-4.6 2.4-7.6 2.4-5.2 0-9.6-3.3-11.2-8L6.2 32C9.4 38 16.2 43.5 24 43.5z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.7 2.1-2.1 3.9-3.8 5.1l6.5 5.5c-.5.5 6-4.4 6-13.6 0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}
