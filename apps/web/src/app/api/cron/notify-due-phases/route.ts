import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/actions/push";
import { sendFcmToUser } from "@/lib/actions/fcm";
import { renderNotificationEmail, sendEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://fluxos.fabd.com.br";

/**
 * Cron diario: dispara phase_overdue e phase_due_soon.
 *
 * Protegido por header `Authorization: Bearer ${CRON_SECRET}` que o Vercel
 * Cron envia automaticamente quando esta na lista de crons do vercel.json.
 *
 * Logica:
 *  - phase_overdue: completed_at IS NULL AND due_date < now()
 *  - phase_due_soon: completed_at IS NULL AND due_date BETWEEN now() AND now()+24h
 *
 * Pra cada fase, notifica:
 *  - Todos os user_ids em phase_responsibles
 *  - O responsible_user_id do projeto
 *
 * Dedup via phase_notification_log (PK phase_id+user_id+type+day) — se ja
 * mandou hoje, skip.
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
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 1. Buscar phases candidatas + flow + project + directory + workspace
  const { data: phasesRaw, error: phErr } = await supa
    .from("phases")
    .select(
      `
        id,
        name,
        due_date,
        completed_at,
        flow_id,
        flow:flows!inner(
          id,
          name,
          project:projects!inner(
            id,
            name,
            responsible_user_id,
            directory:directories!inner(
              workspace_id,
              slug
            )
          )
        )
      `,
    )
    .is("completed_at", null)
    .not("due_date", "is", null)
    .lte("due_date", in24h.toISOString());

  if (phErr) {
    return NextResponse.json({ error: phErr.message }, { status: 500 });
  }

  type PhaseExpanded = {
    id: string;
    name: string;
    due_date: string;
    completed_at: string | null;
    flow_id: string;
    flow: {
      id: string;
      name: string;
      project: {
        id: string;
        name: string;
        responsible_user_id: string | null;
        directory: { workspace_id: string; slug: string };
      };
    };
  };

  const phases = (phasesRaw ?? []) as unknown as PhaseExpanded[];

  // 2. Bulk load phase_responsibles dos phaseIds
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

  // 2.5. Bulk load admins ativos por workspace (recebem tudo do workspace).
  // Pre-load aqui ja com todos os ws envolvidos pra evitar N queries.
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

  // 3. Pra cada phase, decidir tipo + targets
  const day = now.toISOString().slice(0, 10);
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Pre-load todos workspace slugs envolvidos (evita N queries no loop)
  const wsIds = Array.from(
    new Set(phases.map((p) => p.flow.project.directory.workspace_id)),
  );
  const wsSlugByID = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await supa
      .from("workspaces")
      .select("id, slug")
      .in("id", wsIds);
    for (const w of (wsRows ?? []) as Array<{ id: string; slug: string }>) {
      wsSlugByID.set(w.id, w.slug);
    }
  }

  for (const ph of phases) {
    const due = new Date(ph.due_date);
    const isOverdue = due < now;
    const type = isOverdue ? "phase_overdue" : "phase_due_soon";

    // Targets seguindo a regra:
    // - Admin do workspace: SEMPRE recebe (tudo do workspace)
    // - Diretor/Membro: SO se eh responsavel da fase (phase_responsibles)
    //   OU responsavel do projeto (projects.responsible_user_id)
    const targets = new Set<string>();
    for (const uid of respByPhase.get(ph.id) ?? []) targets.add(uid);
    const projResp = ph.flow.project.responsible_user_id;
    if (projResp) targets.add(projResp);
    const wsIdLoop = ph.flow.project.directory.workspace_id;
    for (const adminId of adminsByWs.get(wsIdLoop) ?? []) targets.add(adminId);

    if (targets.size === 0) continue;

    const wsId = ph.flow.project.directory.workspace_id;
    const dirSlug = ph.flow.project.directory.slug;
    const projId = ph.flow.project.id;
    const flowId = ph.flow.id;
    const wsSlug = wsSlugByID.get(wsId) ?? null;

    for (const uid of targets) {
      // Dedup: ja enviou esta combinacao hoje?
      const { data: existing } = await supa
        .from("phase_notification_log")
        .select("phase_id")
        .eq("phase_id", ph.id)
        .eq("user_id", uid)
        .eq("notification_type", type)
        .eq("notification_day", day)
        .maybeSingle();
      if (existing) {
        skipped++;
        continue;
      }

      const title = isOverdue
        ? `Fase vencida: "${ph.name}"`
        : `Fase vence em breve: "${ph.name}"`;
      const body = isOverdue
        ? `Venceu em ${formatDate(due)} no fluxo ${ph.flow.name} / ${ph.flow.project.name}.`
        : `Vence em ${formatDate(due)} no fluxo ${ph.flow.name} / ${ph.flow.project.name}.`;
      const link = wsSlug
        ? `/app/${wsSlug}/${dirSlug}/${projId}/${flowId}`
        : null;

      // Insere notification direto (a RPC notify_user nao funciona com service role
      // sem JWT — vamos direto na tabela. Service role bypassa RLS).
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

      // Log dedup
      await supa.from("phase_notification_log").insert({
        phase_id: ph.id,
        user_id: uid,
        notification_type: type,
        notification_day: day,
      });

      // Fanout: Web Push + FCM Android + Email (best-effort, LOGA erros)
      const absoluteLink = link ? `${APP_URL}${link}` : "/app";
      const pushPayload = { title, body, url: absoluteLink, tag: `${type}-${ph.id}` };
      try {
        await sendPushToUser({ userId: uid, payload: pushPayload });
      } catch (e) {
        console.error(`[cron-notify] web-push failed phase=${ph.id} user=${uid}:`, e);
      }
      try {
        await sendFcmToUser({ userId: uid, payload: pushPayload });
      } catch (e) {
        console.error(`[cron-notify] fcm failed phase=${ph.id} user=${uid}:`, e);
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
          const wsName = (wsRow as { name: string } | null)?.name ?? "FABD Fluxos";
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
            console.error(`[cron-notify] email failed user=${uid}: ${r.error}`);
          }
        }
      } catch (e) {
        console.error(`[cron-notify] email exception phase=${ph.id} user=${uid}:`, e);
      }

      sent++;
    }
  }

  return NextResponse.json({
    ok: true,
    phasesScanned: phases.length,
    sent,
    skipped,
    errors,
  });
}

function formatDate(d: Date) {
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
