import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/actions/push";
import { sendFcmToUser } from "@/lib/actions/fcm";
import { renderNotificationEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fluxos.fabd.com.br";
const BR_TZ = "America/Maceio";

/**
 * Cron de lembretes. Roda a cada ~5min (cron-job.org) / ~10min (GH Actions).
 * Cobre dois tipos, notificando APENAS o criador via push + FCM + e-mail + in-app:
 *   - reminders standalone (tabela reminders)
 *   - lembretes por item de checklist (checklist_items.reminder_*)
 * once: dispara 1x em now>=horario. daily: todo dia no horario BR. Lock
 * idempotente (marca antes de notificar) evita duplicar em runs concorrentes.
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
  const todayBR = brYMD(now);
  const errors: string[] = [];
  let sent = 0;
  let skipped = 0;

  // cache de workspace (slug + name) pra link/email
  const wsCache = new Map<string, { slug: string; name: string }>();
  async function ws(wsId: string) {
    if (wsCache.has(wsId)) return wsCache.get(wsId)!;
    const { data } = await supa.from("workspaces").select("slug, name").eq("id", wsId).maybeSingle();
    const v = {
      slug: (data as { slug?: string } | null)?.slug ?? "",
      name: (data as { name?: string } | null)?.name ?? "FABD Fluxos",
    };
    wsCache.set(wsId, v);
    return v;
  }

  // elegibilidade por horario (once/daily) dado o horario-alvo e marcadores
  function eligible(
    recurrence: "once" | "daily",
    dueIso: string,
    notifiedAt: string | null,
    lastOn: string | null,
  ): boolean {
    const due = new Date(dueIso);
    if (recurrence === "once") {
      return !notifiedAt && now.getTime() >= due.getTime();
    }
    const p = getBRParts(due);
    const fireAt = atBR(
      Number(todayBR.slice(0, 4)),
      Number(todayBR.slice(5, 7)),
      Number(todayBR.slice(8, 10)),
      p.h,
      p.mi,
    );
    return now.getTime() >= fireAt.getTime() && lastOn !== todayBR;
  }

  // lock idempotente: marca o disparo condicional; retorna true se ganhou (1 linha)
  async function lock(
    table: string,
    id: string,
    recurrence: "once" | "daily",
    cols: { notifiedAt: string; lastOn: string },
  ): Promise<boolean> {
    const q =
      recurrence === "once"
        ? supa.from(table).update({ [cols.notifiedAt]: now.toISOString() }).eq("id", id).is(cols.notifiedAt, null)
        : supa
            .from(table)
            .update({ [cols.lastOn]: todayBR })
            .eq("id", id)
            .or(`${cols.lastOn}.is.null,${cols.lastOn}.neq.${todayBR}`);
    const { data, error } = await q.select("id");
    if (error) {
      errors.push(`lock ${table}/${id}: ${error.message}`);
      return false;
    }
    return !!data && (data as unknown[]).length > 0;
  }

  async function revertLock(
    table: string,
    id: string,
    recurrence: "once" | "daily",
    cols: { notifiedAt: string; lastOn: string },
    prevLastOn: string | null,
  ) {
    const patch =
      recurrence === "once" ? { [cols.notifiedAt]: null } : { [cols.lastOn]: prevLastOn };
    await supa.from(table).update(patch).eq("id", id);
  }

  // entrega a notificacao ao criador (in-app + push + fcm + email)
  async function deliver(uid: string, wsId: string, title: string, body: string, link: string | null) {
    const { error: nErr } = await supa.from("notifications").insert({
      user_id: uid,
      workspace_id: wsId,
      type: "reminder",
      title,
      body,
      entity: "reminder",
      link,
    });
    if (nErr) throw new Error(nErr.message);

    const absoluteLink = link ? `${APP_URL}${link}` : "/app";
    const payload = { title, body, url: absoluteLink, tag: `reminder-${uid}-${title}` };
    try {
      await sendPushToUser({ userId: uid, payload });
    } catch (e) {
      console.error("[cron-reminders] push fail:", e);
    }
    try {
      await sendFcmToUser({ userId: uid, payload });
    } catch (e) {
      console.error("[cron-reminders] fcm fail:", e);
    }
    try {
      const { data: m } = await supa
        .from("workspace_members")
        .select("google_email, google_full_name")
        .eq("workspace_id", wsId)
        .eq("user_id", uid)
        .maybeSingle();
      const member = m as { google_email: string | null; google_full_name: string | null } | null;
      if (member?.google_email) {
        const w = await ws(wsId);
        const tpl = renderNotificationEmail({
          recipientName: member.google_full_name,
          title,
          body,
          link: absoluteLink,
          workspaceName: w.name,
        });
        const er = await sendEmail({ to: member.google_email, subject: title, html: tpl.html, text: tpl.text });
        if (!er.ok) console.error(`[cron-reminders] email fail: ${er.error}`);
      }
    } catch (e) {
      console.error("[cron-reminders] email exception:", e);
    }
  }

  // ===== 1) reminders standalone =====
  const { data: remRaw, error: remErr } = await supa
    .from("reminders")
    .select(
      `id, name, description, due_date, recurrence, notified_at, last_notified_on, created_by,
       project:projects!inner(id, name, directory:directories!inner(workspace_id, slug))`,
    )
    .is("completed_at", null)
    .not("due_date", "is", null);
  if (remErr) return NextResponse.json({ error: remErr.message }, { status: 500 });

  for (const r of (remRaw ?? []) as unknown as ReminderExpanded[]) {
    if (!eligible(r.recurrence, r.due_date, r.notified_at, r.last_notified_on)) {
      skipped++;
      continue;
    }
    const cols = { notifiedAt: "notified_at", lastOn: "last_notified_on" };
    if (!(await lock("reminders", r.id, r.recurrence, cols))) {
      skipped++;
      continue;
    }
    const wsId = r.project.directory.workspace_id;
    const w = await ws(wsId);
    const link = w.slug ? `/app/${w.slug}/${r.project.directory.slug}/${r.project.id}` : null;
    const title = `Lembrete: ${r.name}`;
    const body =
      (r.description ? `${r.description} · ` : "") +
      `Projeto: ${r.project.name}` +
      (r.recurrence === "daily" ? " (diário)" : "");
    try {
      await deliver(r.created_by, wsId, title, body, link);
      sent++;
    } catch (e) {
      await revertLock("reminders", r.id, r.recurrence, cols, r.last_notified_on);
      errors.push(`${r.id}: ${(e as Error).message}`);
    }
  }

  // ===== 2) lembretes por item de checklist =====
  const { data: itemRaw, error: itemErr } = await supa
    .from("checklist_items")
    .select(
      `id, text, reminder_recurrence, reminder_at, reminder_notified_at, reminder_last_on, created_by,
       section:checklist_sections!inner(
         checklist:checklists!inner(
           name, project:projects!inner(id, name, directory:directories!inner(workspace_id, slug))
         )
       )`,
    )
    .is("completed_at", null)
    .not("reminder_recurrence", "is", null)
    .not("reminder_at", "is", null);
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });

  for (const it of (itemRaw ?? []) as unknown as ChecklistItemExpanded[]) {
    const rec = it.reminder_recurrence;
    if (!rec || !it.reminder_at) {
      skipped++;
      continue;
    }
    if (!eligible(rec, it.reminder_at, it.reminder_notified_at, it.reminder_last_on)) {
      skipped++;
      continue;
    }
    const cols = { notifiedAt: "reminder_notified_at", lastOn: "reminder_last_on" };
    if (!(await lock("checklist_items", it.id, rec, cols))) {
      skipped++;
      continue;
    }
    const proj = it.section.checklist.project;
    const wsId = proj.directory.workspace_id;
    const w = await ws(wsId);
    const link = w.slug ? `/app/${w.slug}/${proj.directory.slug}/${proj.id}` : null;
    const title = `Lembrete: ${it.text}`;
    const body =
      `Checklist "${it.section.checklist.name}" · Projeto: ${proj.name}` +
      (rec === "daily" ? " (diário)" : "");
    try {
      await deliver(it.created_by, wsId, title, body, link);
      sent++;
    } catch (e) {
      await revertLock("checklist_items", it.id, rec, cols, it.reminder_last_on);
      errors.push(`item ${it.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({ ok: true, sent, skipped, errors });
}

type ReminderExpanded = {
  id: string;
  name: string;
  description: string | null;
  due_date: string;
  recurrence: "once" | "daily";
  notified_at: string | null;
  last_notified_on: string | null;
  created_by: string;
  project: { id: string; name: string; directory: { workspace_id: string; slug: string } };
};

type ChecklistItemExpanded = {
  id: string;
  text: string;
  reminder_recurrence: "once" | "daily" | null;
  reminder_at: string | null;
  reminder_notified_at: string | null;
  reminder_last_on: string | null;
  created_by: string;
  section: {
    checklist: {
      name: string;
      project: { id: string; name: string; directory: { workspace_id: string; slug: string } };
    };
  };
};

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
