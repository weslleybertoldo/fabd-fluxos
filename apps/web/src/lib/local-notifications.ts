/**
 * Helpers de Local Notifications (Capacitor) — pattern inspirado em
 * NutriTrack `src/lib/habitReminders.ts`.
 *
 * Local notifications sao agendadas pelo proprio app no SO Android
 * (ou iOS). Sem servidor, sem Firebase, sem internet — funciona offline.
 *
 * Casos de uso no fabd-fluxos:
 * - Lembrete de fase com `due_date` (ex: 1 dia antes as 9h, e no dia
 *   do vencimento as 9h se ainda nao concluida).
 *
 * Web/Desktop: nao faz nada (browser/Electron usam Web Push).
 */

const CHANNEL_ID = "phase_reminders";

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

function isNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return cap?.isNativePlatform?.() ?? false;
}

async function importPlugin() {
  if (!isNative()) return null;
  const mod = await import(
    /* webpackIgnore: true */ "@capacitor/local-notifications"
  ).catch(() => null);
  if (!mod) return null;
  return (mod as typeof import("@capacitor/local-notifications")).LocalNotifications;
}

/** Pede permissao se ainda nao concedida. Retorna true se concedida. */
export async function requestNotificationPermission(): Promise<boolean> {
  const LN = await importPlugin();
  if (!LN) return false;
  try {
    let perm = await LN.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
      perm = await LN.requestPermissions();
    }
    return perm.display === "granted";
  } catch (e) {
    console.warn("[local-notifications] permission error:", e);
    return false;
  }
}

/** Cria canal Android pra notificacoes de fase. Idempotente. */
export async function ensureChannel(): Promise<void> {
  const LN = await importPlugin();
  if (!LN) return;
  try {
    await LN.createChannel({
      id: CHANNEL_ID,
      name: "Lembretes de fases",
      description: "Avisos de fases proximas do vencimento ou vencidas",
      importance: 4, // HIGH
      sound: "default",
      vibration: true,
    });
  } catch (e) {
    console.warn("[local-notifications] channel create error:", e);
  }
}

/**
 * Gera um ID numerico estavel a partir de um UUID (8 chars hex → int).
 * Usado pra cancelar/atualizar notificacao do mesmo phase_id sem duplicar.
 */
function notificationIdFromUuid(uuid: string): number {
  const hex = uuid.replace(/-/g, "").slice(0, 8);
  return (parseInt(hex, 16) % 2_000_000_000) + 1;
}

interface PhaseLike {
  id: string;
  name: string;
  due_date: string | null;
  completed_at: string | null;
}

interface ContextLike {
  flowName: string;
  projectName: string;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
}

/**
 * Agenda 3 notificacoes locais pra fase as 9h:
 * - 1 dia antes do vencimento ("vence amanha")
 * - No dia do vencimento ("vence hoje")
 * - 1 dia depois do vencimento ("atrasou")
 *
 * Se a data ja passou, soh nao agenda os horarios passados (os futuros
 * continuam validos). Cancela qualquer notificacao anterior do mesmo phase_id.
 */
export async function schedulePhaseReminder(
  phase: PhaseLike,
  ctx: ContextLike,
): Promise<void> {
  const LN = await importPlugin();
  if (!LN) return;
  if (!phase.due_date || phase.completed_at) {
    await cancelPhaseReminder(phase.id);
    return;
  }

  const granted = await requestNotificationPermission();
  if (!granted) return;
  await ensureChannel();

  const due = new Date(`${phase.due_date}T09:00:00`);
  const dayBefore = new Date(due);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const dayAfter = new Date(due);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const baseId = notificationIdFromUuid(phase.id);
  const idDayBefore = baseId;
  const idDueDay = baseId + 1;
  const idDayAfter = baseId + 2;

  // Cancela anteriores
  try {
    await LN.cancel({
      notifications: [{ id: idDayBefore }, { id: idDueDay }, { id: idDayAfter }],
    });
  } catch {
    /* noop */
  }

  const now = new Date();
  const url = `/app/${ctx.workspaceSlug}/${ctx.directorySlug}/${ctx.projectId}/${ctx.flowId}`;
  const subtitle = `${ctx.flowName} • ${ctx.projectName}`;

  const notifications: Array<{
    id: number;
    title: string;
    body: string;
    schedule: { at: Date };
    channelId: string;
    autoCancel: boolean;
    extra: Record<string, unknown>;
  }> = [];

  if (dayBefore > now) {
    notifications.push({
      id: idDayBefore,
      title: "Fase vence amanhã",
      body: `${phase.name} (${subtitle}) vence amanhã.`,
      schedule: { at: dayBefore },
      channelId: CHANNEL_ID,
      autoCancel: true,
      extra: { phaseId: phase.id, url },
    });
  }

  if (due > now) {
    notifications.push({
      id: idDueDay,
      title: "Fase vence hoje",
      body: `${phase.name} (${subtitle}) vence hoje.`,
      schedule: { at: due },
      channelId: CHANNEL_ID,
      autoCancel: true,
      extra: { phaseId: phase.id, url },
    });
  }

  if (dayAfter > now) {
    notifications.push({
      id: idDayAfter,
      title: "Fase atrasada",
      body: `${phase.name} (${subtitle}) venceu ontem e ainda nao foi concluida.`,
      schedule: { at: dayAfter },
      channelId: CHANNEL_ID,
      autoCancel: true,
      extra: { phaseId: phase.id, url },
    });
  }

  if (notifications.length === 0) return;

  try {
    await LN.schedule({ notifications });
  } catch (e) {
    console.warn("[local-notifications] schedule error:", e);
  }
}

/** Cancela todas as 3 notificacoes (day-before, due-day, day-after) de uma fase. */
export async function cancelPhaseReminder(phaseId: string): Promise<void> {
  const LN = await importPlugin();
  if (!LN) return;
  const baseId = notificationIdFromUuid(phaseId);
  try {
    await LN.cancel({
      notifications: [
        { id: baseId },
        { id: baseId + 1 },
        { id: baseId + 2 },
      ],
    });
  } catch {
    /* noop */
  }
}

/**
 * Sincroniza notificacoes locais com uma lista de fases ativas.
 * Agenda pra cada fase com due_date futuro nao concluida; cancela
 * qualquer outra agendada que nao esta na lista.
 */
export async function syncPhaseReminders(
  phases: Array<PhaseLike & { ctx: ContextLike }>,
): Promise<void> {
  if (!isNative()) return;
  for (const p of phases) {
    await schedulePhaseReminder(p, p.ctx);
  }
}
