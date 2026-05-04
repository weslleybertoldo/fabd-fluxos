"use client";

import { useEffect } from "react";
import {
  ensureChannel,
  requestNotificationPermission,
} from "@/lib/local-notifications";

/**
 * Pede permissao de notificacoes e cria o canal Android logo na abertura
 * do app — antes mesmo de o user logar. Montado no RootLayout pra rodar
 * no carregamento inicial.
 *
 * Web/Desktop: noop (Capacitor.isNativePlatform retorna false em ambos).
 * Android/iOS: dispara o popup nativo na primeira execucao depois da
 * instalacao. Se o user permitir, todas as notificacoes locais (lembrete
 * de fase) ja podem ser agendadas pelo `<LocalNotificationsSync>` quando
 * ele entrar em um workspace.
 */
export function NativeNotificationsBootstrap() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureChannel();
        if (cancelled) return;
        await requestNotificationPermission();
      } catch (e) {
        console.warn("[notifs-bootstrap] init falhou:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
