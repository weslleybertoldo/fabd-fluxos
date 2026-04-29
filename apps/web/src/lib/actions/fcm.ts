"use server";

import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { createClient } from "@supabase/supabase-js";
import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

let _adminApp: App | null = null;

/**
 * Inicializa Firebase Admin SDK uma unica vez por instancia. Usa
 * FIREBASE_SERVICE_ACCOUNT (env var com o JSON inline OU base64) pra autenticar.
 *
 * Sem essa env var, retorna null e os hooks de notify/cron logam mas nao falham.
 */
function getAdminApp(): App | null {
  if (_adminApp) return _adminApp;
  const apps = getApps();
  if (apps.length > 0) {
    _adminApp = apps[0]!;
    return _adminApp;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const decoded = raw.trim().startsWith("{")
      ? raw
      : Buffer.from(raw, "base64").toString("utf-8");
    const sa = JSON.parse(decoded) as {
      project_id: string;
      client_email: string;
      private_key: string;
    };
    _adminApp = initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key.replace(/\\n/g, "\n"),
      }),
    });
    return _adminApp;
  } catch (e) {
    console.error("[fcm] Failed to init Firebase Admin:", e);
    return null;
  }
}

/**
 * Salva FCM token do device atual. Chamado pelo client component
 * <FcmRegister> apos registro do plugin Capacitor.
 */
export async function saveFcmToken(input: {
  token: string;
  platform: "android" | "ios";
  appVersion?: string | null;
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nao autenticado" };

  const { token, platform } = input;
  if (!token || !platform) return { ok: false, error: "Token/platform invalidos" };

  const sb = supabase as unknown as {
    from(t: string): {
      delete(): { eq(c: string, v: string): Promise<{ error: { message: string } | null }> };
      insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
  // Upsert via delete + insert (token eh UNIQUE; queremos atualizar user_id se mudou)
  await sb.from("device_tokens").delete().eq("token", token);
  const { error } = await sb.from("device_tokens").insert({
    user_id: user.id,
    token,
    platform,
    app_version: input.appVersion ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function deleteFcmToken(input: { token: string }): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nao autenticado" };

  const sb = supabase as unknown as {
    from(t: string): {
      delete(): {
        eq(c: string, v: string): {
          eq(c2: string, v2: string): Promise<{ error: { message: string } | null }>;
        };
      };
    };
  };
  const { error } = await sb
    .from("device_tokens")
    .delete()
    .eq("token", input.token)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Envia push FCM pra todos devices Android/iOS do user. Best-effort.
 * Tokens invalidos (UnregisteredError) sao removidos da DB.
 */
export async function sendFcmToUser(input: {
  userId: string;
  payload: { title: string; body?: string; url?: string; tag?: string };
}): Promise<{ sent: number; removed: number; failed: number }> {
  const adminApp = getAdminApp();
  if (!adminApp) return { sent: 0, removed: 0, failed: 0 };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { sent: 0, removed: 0, failed: 0 };

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await admin
    .from("device_tokens")
    .select("id, token, platform")
    .eq("user_id", input.userId);
  const tokens = (data ?? []) as Array<{
    id: string;
    token: string;
    platform: "android" | "ios";
  }>;
  if (tokens.length === 0) return { sent: 0, removed: 0, failed: 0 };

  const messaging = getMessaging(adminApp);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const t of tokens) {
    try {
      await messaging.send({
        token: t.token,
        notification: {
          title: input.payload.title,
          body: input.payload.body ?? "",
        },
        data: {
          url: input.payload.url ?? "/app",
          tag: input.payload.tag ?? "fabd-fluxos",
        },
        android: {
          priority: "high",
          notification: { sound: "default", channelId: "fabd-fluxos" },
        },
      });
      sent++;
      await admin
        .from("device_tokens")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", t.id);
    } catch (e: unknown) {
      const err = e as { code?: string; errorInfo?: { code?: string } };
      const code = err.errorInfo?.code ?? err.code ?? "";
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      ) {
        await admin.from("device_tokens").delete().eq("id", t.id);
        removed++;
      } else {
        console.error(`[fcm] send failed user=${input.userId} token=${t.id}:`, e);
        failed++;
      }
    }
  }
  return { sent, removed, failed };
}
