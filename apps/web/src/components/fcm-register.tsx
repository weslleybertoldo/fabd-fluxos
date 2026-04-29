"use client";

import { useEffect, useRef } from "react";
import { saveFcmToken } from "@/lib/actions/fcm";

/**
 * Registra device FCM token no Capacitor Android. Em web/desktop nao faz nada.
 *
 * Usa import dinamico de `@capacitor/core` + `@capacitor/push-notifications` pra
 * evitar bundle desses modulos no web (so existem em Capacitor runtime).
 */
export function FcmRegister() {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    if (typeof window === "undefined") return;

    (async () => {
      try {
        // Capacitor expoe `Capacitor` global em runtime nativo
        const cap = (window as unknown as {
          Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
        }).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        const platform = cap.getPlatform?.();
        if (platform !== "android" && platform !== "ios") return;

        // Carrega plugin so quando estamos em Capacitor (evita bundle web)
        const mod = await import(
          /* webpackIgnore: true */ "@capacitor/push-notifications"
        ).catch(() => null);
        if (!mod) return;
        const { PushNotifications } = mod as typeof import("@capacitor/push-notifications");

        const perm = await PushNotifications.checkPermissions();
        let granted = perm.receive === "granted";
        if (!granted) {
          const req = await PushNotifications.requestPermissions();
          granted = req.receive === "granted";
        }
        if (!granted) return;

        await PushNotifications.register();

        PushNotifications.addListener("registration", async (token) => {
          await saveFcmToken({
            token: token.value,
            platform: platform as "android" | "ios",
            appVersion: null,
          });
        });

        PushNotifications.addListener("registrationError", (err) => {
          console.error("[fcm] registration error:", err);
        });

        PushNotifications.addListener(
          "pushNotificationActionPerformed",
          (action) => {
            const url = action.notification.data?.url as string | undefined;
            if (url && url.startsWith("/")) {
              window.location.href = url;
            }
          },
        );

        registered.current = true;
      } catch (e) {
        console.error("[fcm] init error:", e);
      }
    })();
  }, []);

  return null;
}
