import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/actions/push";
import { sendFcmToUser } from "@/lib/actions/fcm";
import { renderNotificationEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fluxos.fabd.com.br";

// Brasil: UTC-3 fixo (sem DST desde 2019).
const BR_TZ = "America/Maceio";

type Milestone = "tomorrow" | "today" | "yesterday";

type PhaseExpanded = {
  id: string;
  name: string;
  due_date: string;
  completed_at: string | null;
  created_at: string;
  flow_id: string;
  flow: {
    id: string;
    name: string;
    created_by: string;
    project: {
      id: string;
      name: string;
      responsible_user_id: string | null;
      directory: { workspace_id: string; slug: string; name: string };
    };
  };
};

/**
 * Cron de notificacao por vencimento de fase.
 *
 * Roda a cada ~10min (GH Actions) e tambem 1x/dia 9h BR (Vercel Cron fallback).
 * Pra cada fase aberta com due_date, calcula 3 milestones em horario BR:
 *   - tomorrow:  09h BR do dia anterior ao due           ("vence amanha")
 *   - today:     hora do due (ou 09h BR se hora == 00h)  ("vence hoje" / "vence agora")
 *   - yesterday: 09h BR do dia seguinte ao due           ("atrasada")
 *
 * Dispara se `now >= milestone` e ainda nao foi enviado
 * (dedup via phase_notification_log com chave (phase, user, type, day)).
 * Sem janela: GH Actions atrasa em horario de pico, entao basta o dedup
 * pra evitar duplicata.
 *
 * Targets (admin/diretor/membro): mesma regra anterior.
 *
 * Protegido por header `Authorization: Bearer ${CRON_SECRET}`.
 */
export async function GET(req: Request) {
  return runJob(req);
}

export async function POST(req: Request) {
  return runJob(req);
}

async function runJob(req: Request) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Missing Supabase env" },
      { status: 500 },
    );
  }

  const supa = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();
  // Janela de busca: T-2d a T+2d capta todas as fases cujos milestones podem
  // estar dentro do WINDOW_MS atual (yesterday milestone fica D+1d das 09h BR).
  const lo = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);
  const hi = new Date(now.getTime() + 2.5 * 24 * 60 * 60 * 1000);

  const { data: phasesRaw, error: phErr } = await supa
    .from("phases")
    .select(
      `
        id,
        name,
        due_date,
        completed_at,
        created_at,
        flow_id,
        flow:flows!inner(
          id,
          name,
          created_by,
          project:projects!inner(
            id,
            name,
            responsible_user_id,
            directory:directories!inner(
              workspace_id,
              slug,
              name
            )
          )
        )
      `,
    )
    .is("completed_at", null)
    .not("due_date", "is", null)
    .gte("due_date", lo.toISOString())
    .lte("due_date", hi.toISOString());

  if (phErr) {
    return NextResponse.json({ error: phErr.message }, { status: 500 });
  }

  const phases = (phasesRaw ?? []) as unknown as PhaseExpanded[];

  // Bulk load phase_responsibles
  const phaseIds = phases.map((p) => p.id);
  const { data: respRaw } = phaseIds.length
    ? await supa
        .from("phase_responsibles")
        .select("phase_id, user_id")
        .in("phase_id", phaseIds)
    : { data: [] };
  const respByPhase = new Map<string, string[]>();
  for (const r of (respRaw ?? []) as unknown as Array<{
    phase_id: string;
    user_id: string;
  }>) {
    if (!respByPhase.has(r.phase_id)) respByPhase.set(r.phase_id, []);
    respByPhase.get(r.phase_id)!.push(r.user_id);
  }

  // Bulk load admins ativos por workspace
  const wsIdsAll = Array.from(
    new Set(phases.map((p) => p.flow.project.directory.workspace_id)),
  );
  const adminsByWs = new Map<string, string[]>();
  if (wsIdsAll.length) {
    const { data: adminsRaw } = await supa
      .from("workspace_members")
      .select("workspace_id, user_id")
      .in("workspace_id", wsIdsAll)
      .eq("status", "active")
      .eq("role", "admin");
    for (const a of (adminsRaw ?? []) as Array<{
      workspace_id: string;
      user_id: string;
    }>) {
      if (!adminsByWs.has(a.workspace_id)) adminsByWs.set(a.workspace_id, []);
      adminsByWs.get(a.workspace_id)!.push(a.user_id);
    }
  }

  // Bulk load workspace slugs
  const wsSlugByID = new Map<string, string>();
  if (wsIdsAll.length) {
    const { data: wsRows } = await supa
      .from("workspaces")
      .select("id, slug")
      .in("id", wsIdsAll);
    for (const w of (wsRows ?? []) as Array<{ id: string; slug: string }>) {
      wsSlugByID.set(w.id, w.slug);
    }
  }

  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedFuture = 0;
  const errors: string[] = [];

  for (const ph of phases) {
    const due = new Date(ph.due_date);
    const milestones = computeMilestones(due);

    const createdAt = new Date(ph.created_at);
    for (const [milestone, mAt] of Object.entries(milestones) as Array<
      [Milestone, Date]
    >) {
      // Sem janela: dispara assim que passar do milestone. Dedup por dia
      // garante 1 envio por (phase, user, type, day) mesmo com runs atrasados.
      if (now.getTime() < mAt.getTime()) {
        skippedFuture++;
        continue;
      }
      // Pula milestone cujo horario eh anterior a criacao da fase.
      // Ex: fase criada hoje 14h c/ vencimento hoje 20h — o milestone
      // "tomorrow" cai ontem 9h, ja passado. Nao spammar com email retroativo.
      if (mAt.getTime() < createdAt.getTime()) {
        skippedFuture++;
        continue;
      }

      const targets = new Set<string>();
      for (const uid of respByPhase.get(ph.id) ?? []) targets.add(uid);
      // Responsavel do flow (criador) recebe de todas as fases do flow
      targets.add(ph.flow.created_by);
      const projResp = ph.flow.project.responsible_user_id;
      if (projResp) targets.add(projResp);
      const wsIdLoop = ph.flow.project.directory.workspace_id;
      for (const adminId of adminsByWs.get(wsIdLoop) ?? [])
        targets.add(adminId);
      if (targets.size === 0) continue;

      const wsId = ph.flow.project.directory.workspace_id;
      const dirSlug = ph.flow.project.directory.slug;
      const projId = ph.flow.project.id;
      const flowId = ph.flow.id;
      const wsSlug = wsSlugByID.get(wsId) ?? null;
      const link = wsSlug
        ? `/app/${wsSlug}/${dirSlug}/${projId}/${flowId}`
        : null;

      const type = milestoneToType(milestone);
      // Dia BR do MILESTONE (nao do due) — dedup correto pra cada disparo
      const day = brYMD(mAt);
      const { title, body } = renderTitleBody(milestone, ph, due);

      for (const uid of targets) {
        // Dedup
        const { data: existing } = await supa
          .from("phase_notification_log")
          .select("phase_id")
          .eq("phase_id", ph.id)
          .eq("user_id", uid)
          .eq("notification_type", type)
          .eq("notification_day", day)
          .maybeSingle();
        if (existing) {
          skippedAlreadySent++;
          continue;
        }

        const { error: nErr } = await supa.from("notifications").insert({
          user_id: uid,
          workspace_id: wsId,
          type,
          title,
          body,
          entity: "phase",
          entity_id: ph.id,
          link,
        });
        if (nErr) {
          errors.push(`${ph.id}/${uid}/${type}: ${nErr.message}`);
          continue;
        }

        const { error: lErr } = await supa
          .from("phase_notification_log")
          .insert({
            phase_id: ph.id,
            user_id: uid,
            notification_type: type,
            notification_day: day,
          });
        if (lErr) {
          // Log nao gravado = dedup quebra = SPAM no proximo run.
          // Loga em errors[] pra ficar visivel no body do response.
          errors.push(`log ${ph.id}/${uid}/${type}: ${lErr.message}`);
        }

        const absoluteLink = link ? `${APP_URL}${link}` : "/app";
        const pushPayload = {
          title,
          body,
          url: absoluteLink,
          tag: `${type}-${ph.id}`,
        };
        try {
          await sendPushToUser({ userId: uid, payload: pushPayload });
        } catch (e) {
          console.error(
            `[cron-notify] web-push failed phase=${ph.id} user=${uid}:`,
            e,
          );
        }
        try {
          await sendFcmToUser({ userId: uid, payload: pushPayload });
        } catch (e) {
          console.error(
            `[cron-notify] fcm failed phase=${ph.id} user=${uid}:`,
            e,
          );
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
            const { data: wsRow } = await supa
              .from("workspaces")
              .select("name")
              .eq("id", wsId)
              .maybeSingle();
            const wsName =
              (wsRow as { name: string } | null)?.name ?? "FABD Fluxos";
            const tpl = renderNotificationEmail({
              recipientName: member.google_full_name,
              title,
              body,
              link: absoluteLink,
              workspaceName: wsName,
            });
            const r = await sendEmail({
              to: member.google_email,
              subject: title,
              html: tpl.html,
              text: tpl.text,
            });
            if (!r.ok) {
              console.error(
                `[cron-notify] email failed user=${uid}: ${r.error}`,
              );
            }
          }
        } catch (e) {
          console.error(
            `[cron-notify] email exception phase=${ph.id} user=${uid}:`,
            e,
          );
        }

        sent++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    phasesScanned: phases.length,
    sent,
    skippedAlreadySent,
    skippedFuture,
    errors,
  });
}

// ---------- helpers de timezone BR ----------

function getBRParts(date: Date): {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
} {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: BR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return {
    y: +get("year"),
    m: +get("month"),
    d: +get("day"),
    h: +get("hour"),
    mi: +get("minute"),
  };
}

/**
 * Constroi um Date que representa "ano-mes-dia HH:MM em BR".
 * Aceita day=0 ou day=32: JS rola pro mes anterior/seguinte automaticamente
 * via `new Date(iso)`.
 */
function atBR(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const pad = (n: number) => n.toString().padStart(2, "0");
  // Brasil = UTC-3 fixo. ISO com offset garante interpretacao correta
  // mesmo se o servidor estiver em outra TZ.
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`;
  return new Date(iso);
}

function brYMD(date: Date): string {
  const p = getBRParts(date);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function computeMilestones(due: Date): Record<Milestone, Date> {
  const dueBR = getBRParts(due);
  // Today: hora do due, fallback 09h se hora 00:00 (sem hora explicita)
  const todayHour = dueBR.h === 0 && dueBR.mi === 0 ? 9 : dueBR.h;
  const todayMinute = dueBR.h === 0 && dueBR.mi === 0 ? 0 : dueBR.mi;
  return {
    tomorrow: atBR(dueBR.y, dueBR.m, dueBR.d - 1, 9, 0),
    today: atBR(dueBR.y, dueBR.m, dueBR.d, todayHour, todayMinute),
    yesterday: atBR(dueBR.y, dueBR.m, dueBR.d + 1, 9, 0),
  };
}

function milestoneToType(m: Milestone): string {
  if (m === "tomorrow") return "phase_due_tomorrow";
  if (m === "today") return "phase_due_today";
  return "phase_overdue_yesterday";
}

function renderTitleBody(
  milestone: Milestone,
  ph: PhaseExpanded,
  due: Date,
): { title: string; body: string } {
  const flow = ph.flow.name;
  const proj = ph.flow.project.name;
  const dir = ph.flow.project.directory.name;
  const path = `${dir}/${proj}/${flow}`;
  const dueFmt = formatDateBR(due);
  if (milestone === "tomorrow") {
    return {
      title: `Fase vence amanhã: "${ph.name}"`,
      body: `Fluxo: ${path} em ${dueFmt}.`,
    };
  }
  if (milestone === "today") {
    return {
      title: `Fase vence hoje: "${ph.name}"`,
      body: `Fluxo: ${path} em ${dueFmt}.`,
    };
  }
  return {
    title: `Fase vencida: "${ph.name}"`,
    body: `Fluxo: ${path} em ${dueFmt}.`,
  };
}

function formatDateBR(d: Date): string {
  const date = d.toLocaleDateString("pt-BR", {
    timeZone: BR_TZ,
    day: "2-digit",
    month: "2-digit",
  });
  const time = d.toLocaleTimeString("pt-BR", {
    timeZone: BR_TZ,
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} às ${time}`;
}
