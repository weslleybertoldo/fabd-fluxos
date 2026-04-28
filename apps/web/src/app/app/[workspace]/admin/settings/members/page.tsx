import { requireWorkspaceAdmin } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { MemberRow } from "./member-row";
import type { WorkspaceMemberRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MembersPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const ctx = await requireWorkspaceAdmin(slug);

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("workspace_members")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: true });
  const members = (rows ?? []) as unknown as WorkspaceMemberRow[];

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const blocked = members.filter((m) => m.status === "blocked");

  return (
    <div className="space-y-8 pt-2">
      <p className="text-sm text-slate-600">
        Aprove novos membros, ajuste papel ou bloqueie acessos.
      </p>

      <Section title={`Pendentes (${pending.length})`} emptyMessage="Nenhum pedido aguardando">
        {pending.map((m) => (
          <MemberRow key={m.id} member={m} workspaceId={ctx.workspace.id} mode="pending" />
        ))}
      </Section>

      <Section title={`Ativos (${active.length})`} emptyMessage="Nenhum membro ativo">
        {active.map((m) => (
          <MemberRow key={m.id} member={m} workspaceId={ctx.workspace.id} mode="active" />
        ))}
      </Section>

      {blocked.length > 0 ? (
        <Section title={`Bloqueados (${blocked.length})`} emptyMessage="">
          {blocked.map((m) => (
            <MemberRow key={m.id} member={m} workspaceId={ctx.workspace.id} mode="blocked" />
          ))}
        </Section>
      ) : null}
    </div>
  );
}

function Section({
  title,
  children,
  emptyMessage,
}: {
  title: string;
  children: React.ReactNode;
  emptyMessage: string;
}) {
  const arr = Array.isArray(children) ? children : [children];
  const isEmpty = arr.filter(Boolean).length === 0;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      {isEmpty ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        <ul className="space-y-2">{children}</ul>
      )}
    </section>
  );
}
