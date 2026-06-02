import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/actions/push";
import { sendFcmToUser } from "@/lib/actions/fcm";
import { renderNotificationEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fluxos.fabd.com.br";
const BR_TZ = "America/Maceio";

type ReminderExpanded = {
  id: string;
  name: string;
  description: string | null;
  due_date: string;
  recurrence: "once" | "daily";
  notified_at: string | null;
  last_notified_on: string | null;
  created_by: string;
  project: {
    id: string;
    name: string;
    directory: { workspace_id: string; slug: string };
  };
};

/**
 * Cron de notificacao de lembretes (reminders).
 * Roda a cada ~10min (GH Actions). Notifica APENAS o criador do lembrete via
 * push + FCM + e-mail + notificacao in-app.
 *  - recurrence='once':  dispara 1x quando now >= due_date (dedup via notified_at).
 *  - recurrence='daily': dispara todo dia no horario (hora:min) do due_date, em
 *    horario BR (dedup via last_notified_on = dia BR ja disparado).
 * Protegido por header Authorization: Bearer ${CRON_SECRET}.
 */
export async function GET(req: Request) {
  return runJob(req);
}
export async function POST(req: Request) {
  return runJob(req);
}

async function runJob(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }
  const supa = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();

  const { data: remindersRaw, error: remErr } = await supa
    .from("reminders")
    .select(
      `
        id, name, description, due_date, recurrence, notified_at, last_notified_on, created_by,
        project:projects!inner(
          id, name,
          directory:directories!inner(workspace_id, slug)
        )
      `,
    )
    .is("completed_at", null)
    .not("due_date", "is", null);
  if (remErr) {
    return NextResponse.json({ error: remErr.message }, { status: 500 });
  }
  const reminders = (remindersRaw ?? []) as unknown as ReminderExpanded[];

  // workspace slugs (pro link)
  const wsIds = Array.from(
    new Set(reminders.map((r) => r.project.directory.workspace_id)),
  );
  const wsSlugById = new Map<string, string>();
  const wsNameById = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await supa
      .from("workspaces")
      .select("id, slug, name")
      .in("id", wsIds);
    for (const w of (wsRows ?? []) as Array<{ id: string; slug: string; name: string }>) {
      wsSlugById.set(w.id, w.slug);
      wsNameById.set(w.id, w.name);
    }
  }

  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];
  const todayBR = brYMD(now);

  for (const r of reminders) {
    const due = new Date(r.due_date);
    let shouldFire = false;
    let patch: Record<string, unknown> = {};

    if (r.recurrence === "once") {
      if (!r.notified_at && now.getTime() >= due.getTime()) {
        shouldFire = true;
        patch = { notified_at: now.toISOString() };
      }
    } else {
      // daily: horario de hoje em BR usando a hora/min do due_date
      const p = getBRParts(due);
      const fireAt = atBR(
        Number(todayBR.slice(0, 4)),
        Number(todayBR.slice(5, 7)),
        Number(todayBR.slice(8, 10)),
        p.h,
        p.mi,
      );
      if (
        now.getTime() >= fireAt.getTime() &&
        r.last_notified_on !== todayBR
      ) {
        shouldFire = true;
        patch = { last_notified_on: todayBR };
      }
    }

    if (!shouldFire) {
      skipped++;
      continue;
    }

    const wsId = r.project.directory.workspace_id;
    const wsSlug = wsSlugById.get(wsId) ?? null;
    const link = wsSlug
      ? `/app/${wsSlug}/${r.project.directory.slug}/${r.project.id}`
      : null;
    const title = `Lembrete: ${r.name}`;
    const body =
      (r.description ? `${r.description} · ` : "") +
      `Projeto: ${r.project.name}` +
      (r.recurrence === "daily" ? " (diario)" : "");

    const uid = r.created_by;
    const { error: nErr } = await supa.from("notifications").insert({
      user_id: uid,
      workspace_id: wsId,
      type: "reminder",
      title,
      body,
      entity: "reminder",
      entity_id: r.id,
      link,
    });
    if (nErr) {
      errors.push(`${r.id}: ${nErr.message}`);
      continue;
    }

    // marca como disparado (idempotencia) antes dos canais externos
    const { error: uErr } = await supa.from("reminders").update(patch).eq("id", r.id);
    if (uErr) errors.push(`update ${r.id}: ${uErr.message}`);

    const absoluteLink = link ? `${APP_URL}${link}` : "/app";
    const payload = { title, body, url: absoluteLink, tag: `reminder-${r.id}` };
    try {
      await sendPushToUser({ userId: uid, payload });
    } catch (e) {
      console.error(`[cron-reminders] push fail ${r.id}:`, e);
    }
    try {
      await sendFcmToUser({ userId: uid, payload });
    } catch (e) {
      console.error(`[cron-reminders] fcm fail ${r.id}:`, e);
    }
    try {
      const { data: memberRow } = await supa
        .from("workspace_members")
        .select("google_email, google_full_name")
        .eq("workspace_id", wsId)
        .eq("user_id", uid)
        .maybeSingle();
      const member = memberRow as
        | { google_email: string | null; google_full_name: string | null }
        | null;
      if (member?.google_email) {
        const tpl = renderNotificationEmail({
          recipientName: member.google_full_name,
          title,
          body,
          link: absoluteLink,
          workspaceName: wsNameById.get(wsId) ?? "FABD Fluxos",
        });
        const er = await sendEmail({
          to: member.google_email,
          subject: title,
          html: tpl.html,
          text: tpl.text,
        });
        if (!er.ok) console.error(`[cron-reminders] email fail ${r.id}: ${er.error}`);
      }
    } catch (e) {
      console.error(`[cron-reminders] email exception ${r.id}:`, e);
    }

    sent++;
  }

  return NextResponse.json({
    ok: true,
    remindersScanned: reminders.length,
    sent,
    skipped,
    errors,
  });
}

// ---------- helpers BR (UTC-3 fixo) ----------
function getBRParts(date: Date): { h: number; mi: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BR_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { h: +get("hour"), mi: +get("minute") };
}

// Date.UTC faz rollover correto; BR = UTC-3, entao soma 3h pra obter UTC.
function atBR(year: number, month: number, day: number, hour: number, minute: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0));
}

function brYMD(date: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
