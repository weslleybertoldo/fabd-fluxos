import type { AuditLogRow } from "./types";

const ENTITY_PT: Record<string, string> = {
  workspace: "workspace",
  directory: "diretoria",
  project: "projeto",
  flow: "fluxo",
  phase: "fase",
  comment: "comentario",
  attachment: "anexo",
  field: "campo",
  field_value: "valor de campo",
  tag: "tag",
  member: "membro",
  reminder: "lembrete",
  list_item: "item da lista",
};

const ACTION_PT: Record<string, string> = {
  create: "criou",
  update: "atualizou",
  delete: "excluiu",
  archive: "arquivou",
  reactivate: "reativou",
  complete: "concluiu",
  reorder: "reordenou",
  approve: "aprovou",
  block: "bloqueou",
  change_role: "trocou o papel",
  assign: "atribuiu",
  seed: "iniciou o workspace (seed)",
  request: "solicitou acesso",
};

export function translateEntity(e: string): string {
  return ENTITY_PT[e] ?? e;
}

export function translateAction(a: string): string {
  return ACTION_PT[a] ?? a;
}

type AuditContext = Partial<{
  directory_id: string;
  directory_slug: string;
  directory_name: string;
  project_id: string;
  project_name: string;
  flow_id: string;
  flow_name: string;
  phase_id: string;
  phase_name: string;
}>;

/**
 * Constroi o caminho hierarquico tipo "FABD / Marketing / Projeto X / Fluxo Y".
 * Usa o context JSONB salvo no audit + nome da entidade quando aplicavel.
 */
export function buildPath(
  entry: AuditLogRow,
  workspaceName: string,
  fallbacks?: { entityName?: string | null },
): string[] {
  const ctx = (entry.context ?? {}) as AuditContext;
  const parts: string[] = [workspaceName];

  switch (entry.entity) {
    case "workspace":
    case "member":
      // membros sao do workspace direto
      break;
    case "directory":
      parts.push(ctx.directory_name ?? fallbacks?.entityName ?? "(diretoria removida)");
      break;
    case "project":
      if (ctx.directory_name) parts.push(ctx.directory_name);
      parts.push(ctx.project_name ?? fallbacks?.entityName ?? "(projeto removido)");
      break;
    case "flow":
      if (ctx.directory_name) parts.push(ctx.directory_name);
      if (ctx.project_name) parts.push(ctx.project_name);
      parts.push(ctx.flow_name ?? fallbacks?.entityName ?? "(fluxo removido)");
      break;
    case "phase":
      if (ctx.directory_name) parts.push(ctx.directory_name);
      if (ctx.project_name) parts.push(ctx.project_name);
      if (ctx.flow_name) parts.push(ctx.flow_name);
      parts.push(ctx.phase_name ?? fallbacks?.entityName ?? "(fase removida)");
      break;
    default:
      // attachment, comment, field, etc. — apenas entidade pai disponivel via context
      if (ctx.flow_name) parts.push(ctx.flow_name);
      else if (ctx.project_name) parts.push(ctx.project_name);
      else if (ctx.directory_name) parts.push(ctx.directory_name);
  }

  return parts;
}

/**
 * Resumo curto e legivel do que mudou — usa changes.before/after.
 */
export function summarizeChanges(entry: AuditLogRow): string | null {
  const c = entry.changes as { before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  if (!c) return null;
  const before = c.before ?? {};
  const after = c.after ?? {};

  // Caso 1: criacao — descreve campos relevantes do "after"
  if (entry.action === "create" && Object.keys(after).length > 0) {
    const name = (after.name as string) ?? null;
    if (name) return `criou "${name}"`;
    return null;
  }

  // Caso 2: delete — descreve nome do "before"
  if (entry.action === "delete") {
    const name = (before.name as string) ?? null;
    if (name) return `excluiu "${name}"`;
    return null;
  }

  // Caso 3: update — listar mudancas campo a campo
  if (entry.action === "update") {
    const messages: string[] = [];
    const allKeys = Array.from(
      new Set([...Object.keys(before), ...Object.keys(after)]),
    );
    for (const key of allKeys) {
      const a = before[key];
      const b = after[key];
      if (a === b) continue;
      messages.push(formatFieldChange(key, a, b));
    }
    if (messages.length === 0) return null;
    return messages.join("; ");
  }

  // Caso 4: archive/complete/reactivate — already implicit no verbo
  return null;
}

function formatFieldChange(key: string, before: unknown, after: unknown): string {
  const labels: Record<string, string> = {
    name: "nome",
    description: "descricao",
    color: "cor",
    icon: "icone",
    image_url: "imagem",
    type: "tipo",
    status: "status",
    responsible_user_id: "responsavel",
  };
  const label = labels[key] ?? key;

  if (key === "image_url") {
    if (!before && after) return `adicionou imagem`;
    if (before && !after) return `removeu imagem`;
    if (before && after) return `trocou imagem`;
  }
  if (key === "name") {
    return `renomeou "${before ?? ""}" → "${after ?? ""}"`;
  }
  if (key === "description") {
    if (!before && after) return `adicionou descricao`;
    if (before && !after) return `removeu descricao`;
    return `editou descricao`;
  }
  if (key === "color") {
    return `mudou cor pra ${after ?? "padrao"}`;
  }
  if (key === "type") {
    const map: Record<string, string> = {
      continuous: "continuo",
      non_continuous: "nao continuo",
    };
    return `tipo: ${map[String(before)] ?? before} → ${map[String(after)] ?? after}`;
  }
  if (key === "status") {
    return `status: ${before} → ${after}`;
  }
  // generico
  const beforeStr = stringify(before);
  const afterStr = stringify(after);
  return `${label}: ${beforeStr} → ${afterStr}`;
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 40)}…` : v;
  return JSON.stringify(v);
}
