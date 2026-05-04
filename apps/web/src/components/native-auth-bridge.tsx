"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";
import { closeNativeBrowser, isNativePlatform } from "@/lib/native";

/**
 * Listener de deep link `fabd-fluxos://auth/callback?code=...` no APK Android.
 *
 * Fluxo:
 * 1. Login button: chama signInWithOAuth com redirectTo=fabd-fluxos://auth/callback
 *    e skipBrowserRedirect=true. Recebe URL do Google.
 * 2. Login button: abre URL via @capacitor/browser (Custom Tab nativa).
 * 3. User loga no Google. Google redireciona pro Supabase callback.
 * 4. Supabase redireciona pra fabd-fluxos://auth/callback?code=XXX.
 * 5. Android dispara intent VIEW pro nosso scheme; MainActivity (singleTask)
 *    captura via Capacitor App plugin, dispara `appUrlOpen` event.
 * 6. Aqui escutamos esse event, fechamos o Browser, trocamos code por session,
 *    e mandamos router.push pra /app.
 *
 * Tem que ser montado em rota raiz publica (RootLayout) pra estar ativo
 * quando o app abre via deep link.
 */
export function NativeAuthBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativePlatform()) return;

    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("appUrlOpen", async (event) => {
          const url = event.url ?? "";
          if (!url.startsWith("fabd-fluxos://")) return;
          await closeNativeBrowser();
          try {
            const parsed = new URL(url);
            const code = parsed.searchParams.get("code");
            // Hash fragment (PKCE flow): #access_token=... ou #error=...
            const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : "";
            if (code) {
              const supabase = createSupabaseBrowserClient();
              const { error } = await supabase.auth.exchangeCodeForSession(code);
              if (error) {
                console.error("[auth-bridge] exchangeCodeForSession:", error);
                return;
              }
              router.replace("/app");
              router.refresh();
            } else if (hash) {
              const params = new URLSearchParams(hash);
              const access_token = params.get("access_token");
              const refresh_token = params.get("refresh_token");
              if (access_token && refresh_token) {
                const supabase = createSupabaseBrowserClient();
                const { error } = await supabase.auth.setSession({
                  access_token,
                  refresh_token,
                });
                if (error) {
                  console.error("[auth-bridge] setSession:", error);
                  return;
                }
                router.replace("/app");
                router.refresh();
              }
            }
          } catch (err) {
            console.error("[auth-bridge] parse url falhou:", err);
          }
        });
        cleanup = () => {
          handle.remove().catch(() => {});
        };
      } catch (err) {
        console.error("[auth-bridge] init falhou:", err);
      }
    })();

    return () => {
      cleanup?.();
    };
  }, [router]);

  return null;
}
