"use server";

import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function configureWebPush() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:noreply@fabd.com.br";
  if (!pub || !priv) throw new Error("VAPID keys missing");
  webpush.setVapidDetails(subject, pub, priv);
}

interface SubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Salva subscription deste device pro user logado (idempotente por endpoint). */
export async function savePushSubscription(input: {
  subscription: SubscriptionPayload;
  userAgent?: string | null;
}): Promise<ActionResult> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nao autenticado" };

  const { endpoint, keys } = input.subscription;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return { ok: false, error: "Subscription invalida" };
  }

  // Upsert via delete + insert (PostgREST upsert exige PK conflict, e endpoint eh unique mas
  // queremos atualizar user_id se mudar de user)
  const sb = supabase as unknown as {
    from(t: string): {
      delete(): { eq(c: string, v: string): Promise<{ error: { message: string } | null }> };
      insert(values: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
  await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const { error } = await sb.from("push_subscriptions").insert({
    user_id: user.id,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: input.userAgent ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/** Remove subscription do device atual (chamado quando user clica "Desativar push"). */
export async function deletePushSubscription(input: {
  endpoint: string;
}): Promise<ActionResult> {
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
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", input.endpoint)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Envia push pra todos devices de um user. Usado pelo cron diario e pelo
 * `notify()` server action quando dispara notification in-app.
 *
 * Roda com SERVICE ROLE (bypass RLS) pq pode ser chamada de qualquer action.
 * Pra cada subscription:
 *  - tenta enviar via webpush.sendNotification
 *  - se 404/410 → endpoint morto, deleta da tabela
 *  - se outro erro → loga e segue (nao falha a action principal)
 */
export async function sendPushToUser(input: {
  userId: string;
  payload: { title: string; body?: string; url?: string; tag?: string };
}): Promise<{ sent: number; removed: number; failed: number }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { sent: 0, removed: 0, failed: 0 };

  try {
    configureWebPush();
  } catch {
    return { sent: 0, removed: 0, failed: 0 };
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", input.userId);
  const subs = (data ?? []) as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>;
  if (subs.length === 0) return { sent: 0, removed: 0, failed: 0 };

  const body = JSON.stringify(input.payload);
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
      sent++;
      // Atualiza last_used_at (best-effort)
      await admin
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", sub.id);
    } catch (e: unknown) {
      const err = e as { statusCode?: number; message?: string };
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Endpoint morto: remove
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
        removed++;
      } else {
        failed++;
      }
    }
  }
  return { sent, removed, failed };
}
