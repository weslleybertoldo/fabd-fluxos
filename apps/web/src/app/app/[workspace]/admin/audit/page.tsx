import { requireWorkspaceAdmin } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberAvatar } from "@/components/member-avatar";
import type { AuditLogRow, WorkspaceMemberRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AuditPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceAdmin(slug);

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("audit_log")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const entries = (rows ?? []) as unknown as AuditLogRow[];

  const userIds = Array.from(new Set(entries.map((e) => e.user_id)));
  const { data: memRows } = userIds.length
    ? await supabase
        .from("workspace_members")
        .select("user_id, google_full_name, google_avatar_url")
        .eq("workspace_id", ctx.workspace.id)
        .in("user_id", userIds)
    : { data: [] };
  const members = (memRows ?? []) as unknown as Pick<
    WorkspaceMemberRow,
    "user_id" | "google_full_name" | "google_avatar_url"
  >[];
  const memberByUser = new Map(members.map((m) => [m.user_id, m]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Historico de acoes</h1>
        <p className="mt-1 text-slate-600">
          Toda mudanca relevante feita neste workspace fica registrada aqui.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
          Nenhuma acao registrada ainda.
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((e) => {
            const author = memberByUser.get(e.user_id);
            const summary = describeAuditEntry(e);
            return (
              <li
                key={e.id}
                className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <MemberAvatar
                  name={author?.google_full_name}
                  avatarUrl={author?.google_avatar_url}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-900">
                    <strong>{author?.google_full_name ?? "Usuario"}</strong> {summary}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDate(e.created_at)} · <code className="rounded bg-slate-100 px-1 py-0.5">{e.entity}</code> · <code className="rounded bg-slate-100 px-1 py-0.5">{e.action}</code>
                  </p>
                  {e.changes ? (
                    <pre className="mt-2 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                      {JSON.stringify(e.changes, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function describeAuditEntry(entry: AuditLogRow): string {
  const map: Record<string, string> = {
    create: "criou",
    update: "atualizou",
    delete: "removeu",
    complete: "concluiu",
    reorder: "reordenou",
    approve: "aprovou",
    block: "bloqueou",
    change_role: "trocou o papel de",
    assign: "atribuiu",
    seed: "iniciou o workspace (seed)",
    request: "solicitou acesso",
  };
  const verb = map[entry.action] ?? entry.action;
  return `${verb} ${entry.entity}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
