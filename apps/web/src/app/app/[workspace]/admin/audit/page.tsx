import { requireWorkspaceAdmin } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberAvatar } from "@/components/member-avatar";
import {
  buildPath,
  summarizeChanges,
  translateAction,
  translateEntity,
} from "@/lib/audit-format";
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

  // Lookups pra resolver fallbacks (nome de entidades existentes)
  const directoryIds = new Set<string>();
  const projectIds = new Set<string>();
  const flowIds = new Set<string>();
  const phaseIds = new Set<string>();
  for (const e of entries) {
    if (e.entity === "directory") directoryIds.add(e.entity_id);
    if (e.entity === "project") projectIds.add(e.entity_id);
    if (e.entity === "flow") flowIds.add(e.entity_id);
    if (e.entity === "phase") phaseIds.add(e.entity_id);
  }
  const dirsResp = directoryIds.size
    ? await supabase
        .from("directories")
        .select("id, name")
        .in("id", Array.from(directoryIds))
    : { data: [] };
  const prjsResp = projectIds.size
    ? await supabase
        .from("projects")
        .select("id, name")
        .in("id", Array.from(projectIds))
    : { data: [] };
  const flwsResp = flowIds.size
    ? await supabase.from("flows").select("id, name").in("id", Array.from(flowIds))
    : { data: [] };
  const phsResp = phaseIds.size
    ? await supabase.from("phases").select("id, name").in("id", Array.from(phaseIds))
    : { data: [] };

  const nameById = new Map<string, string>();
  for (const r of (dirsResp.data ?? []) as { id: string; name: string }[])
    nameById.set(r.id, r.name);
  for (const r of (prjsResp.data ?? []) as { id: string; name: string }[])
    nameById.set(r.id, r.name);
  for (const r of (flwsResp.data ?? []) as { id: string; name: string }[])
    nameById.set(r.id, r.name);
  for (const r of (phsResp.data ?? []) as { id: string; name: string }[])
    nameById.set(r.id, r.name);

  // Members pra mostrar foto+nome do autor
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
            const path = buildPath(e, ctx.workspace.name, {
              entityName: nameById.get(e.entity_id) ?? null,
            });
            const summary = summarizeChanges(e);
            const verb = translateAction(e.action);
            const entityPt = translateEntity(e.entity);

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
                    <strong>{author?.google_full_name ?? "Usuario"}</strong>{" "}
                    <span className="text-slate-600">
                      {verb} {entityPt}
                    </span>
                  </p>
                  <p className="mt-1 truncate text-xs font-medium text-slate-700">
                    {path.map((p, i) => (
                      <span key={i}>
                        {i > 0 ? <span className="mx-1.5 text-slate-300">/</span> : null}
                        <span>{p}</span>
                      </span>
                    ))}
                  </p>
                  {summary ? (
                    <p className="mt-1 text-sm text-slate-700">{summary}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {formatDate(e.created_at)}{" "}
                    <span className="mx-1 text-slate-300">·</span>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {entityPt}
                    </code>{" "}
                    <span className="text-slate-300">·</span>{" "}
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {verb}
                    </code>
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
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
