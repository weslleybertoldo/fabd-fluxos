"use server";

import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type { EntityType } from "@fabd-fluxos/db";

type AuditPayload = {
  workspaceId: string;
  entity: EntityType;
  entityId: string;
  action: string;
  changes?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
};

/**
 * Registra entrada em audit_log via RPC log_audit (SECURITY DEFINER).
 * Falhar aqui nao deve quebrar a operacao principal — log de erro e segue.
 */
export async function audit(payload: AuditPayload): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    // O cliente tipado pelo Database stub esta restrito; cast pra unknown rpc
    // ate gerarmos os tipos reais via supabase CLI (script db:gen-types).
    const { error } = await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>)("log_audit", {
      p_workspace_id: payload.workspaceId,
      p_entity: payload.entity,
      p_entity_id: payload.entityId,
      p_action: payload.action,
      p_changes: payload.changes ?? null,
      p_context: payload.context ?? null,
    });
    if (error) console.error("[audit] erro:", error.message);
  } catch (e) {
    console.error("[audit] excecao:", e);
  }
}
