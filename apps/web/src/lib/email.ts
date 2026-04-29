/**
 * Helper Resend pra enviar emails transacionais.
 * Roda server-only — nao use em client component.
 *
 * Sandbox mode: usa onboarding@resend.dev (so envia pra emails verificados
 * na conta Resend ate validar dominio fabd.com.br via SPF/DKIM/DMARC).
 */

const FROM = process.env.RESEND_FROM || "FABD Fluxos <onboarding@resend.dev>";

export interface EmailPayload {
  to: string;
  subject: string;
  /** HTML do corpo. Use formatacao simples (h1, p, a). */
  html: string;
  /** Versao texto-puro pra clientes que nao renderizam HTML. */
  text?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<{
  ok: boolean;
  error?: string;
  id?: string;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY missing" };

  const body = JSON.stringify({
    from: FROM,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
  });

  try {
    // Forca UTF-8 explicito (TextEncoder) — bug ja capturado em Site FABD com acentos
    const encoded = new TextEncoder().encode(body);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: encoded,
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `Resend ${res.status}: ${txt}` };
    }
    const data = (await res.json()) as { id?: string };
    return { ok: true, id: data.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro desconhecido" };
  }
}

/**
 * Template padrao pra notif. Recebe os mesmos campos que vao pra
 * notifications.title/body + link absoluto.
 */
export function renderNotificationEmail(input: {
  recipientName: string | null;
  title: string;
  body?: string | null;
  link?: string | null;
  workspaceName: string;
}): { html: string; text: string } {
  const greeting = input.recipientName ? `Ola ${input.recipientName},` : "Ola,";
  const linkHtml = input.link
    ? `<p style="margin: 16px 0;"><a href="${input.link}" style="display: inline-block; background: #1E3A8A; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Abrir no FABD Fluxos</a></p>`
    : "";
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><title>${escapeHtml(input.title)}</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; background: #f1f5f9; padding: 24px; margin: 0;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <p style="color: #64748b; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">${escapeHtml(input.workspaceName)}</p>
    <h1 style="color: #0f172a; font-size: 20px; margin: 0 0 16px;">${escapeHtml(input.title)}</h1>
    <p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">${greeting}</p>
    ${input.body ? `<p style="color: #334155; font-size: 14px; line-height: 1.6; margin: 0 0 12px;">${escapeHtml(input.body)}</p>` : ""}
    ${linkHtml}
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
    <p style="color: #94a3b8; font-size: 11px; line-height: 1.5; margin: 0;">
      Voce recebeu este email porque participa do workspace ${escapeHtml(input.workspaceName)} no FABD Fluxos.
      <br>Pra desativar emails, acesse <a href="https://fluxos.fabd.com.br/app" style="color: #475569;">suas notificacoes</a>.
    </p>
  </div>
</body>
</html>`;
  const text = [
    greeting,
    "",
    input.title,
    input.body ?? "",
    "",
    input.link ? `Abrir: ${input.link}` : "",
    "",
    `— FABD Fluxos · ${input.workspaceName}`,
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
