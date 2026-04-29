import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { WorkspaceSearch } from "./workspace-search";
import { RequestAccessButton } from "./request-access-button";
import type { WorkspaceMemberRow, WorkspaceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type WorkspaceCard = WorkspaceRow & {
  member_status: WorkspaceMemberRow["status"] | null;
  member_role: WorkspaceMemberRow["role"] | null;
};

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; error?: string; picker?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/");

  // RPC SECURITY DEFINER lista todos workspaces (bypass ws_select) com
  // status do user atual. Cards renderizam corretamente — membro vai pra
  // ativo, pending fica em "aguardando", desconhecido vira "disponivel".
  const sb = supabase as unknown as {
    rpc(
      fn: string,
      args: Record<string, unknown>,
    ): Promise<{
      data: Array<{
        id: string;
        name: string;
        slug: string;
        created_at: string;
        member_status: string | null;
        member_role: string | null;
      }> | null;
      error: { message: string } | null;
    }>;
  };
  const { data: rpcData } = await sb.rpc("list_discoverable_workspaces", {});
  const cards: WorkspaceCard[] = (rpcData ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    created_at: w.created_at,
    updated_at: w.created_at,
    created_by: "",
    member_status: (w.member_status as WorkspaceMemberRow["status"] | null) ?? null,
    member_role: (w.member_role as WorkspaceMemberRow["role"] | null) ?? null,
  }));

  const active = cards.filter((c) => c.member_status === "active");
  const otherKnown = cards.filter((c) => c.member_status && c.member_status !== "active");
  const discoverable = cards.filter((c) => !c.member_status);

  // Atalho: se o usuario eh membro ativo de exatamente 1 workspace e nao pediu o picker
  // explicitamente (?picker=1) nem caiu aqui por erro, manda direto pras diretorias.
  const onlyActive = active.length === 1 ? active[0] : null;
  const skipPicker =
    onlyActive !== null &&
    !params.picker &&
    !params.error &&
    !params.pending;
  if (skipPicker && onlyActive) {
    redirect(`/app/${onlyActive.slug}`);
  }

  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Seus workspaces</h1>
        <p className="mt-2 text-slate-600">
          Selecione o workspace que voce ja eh membro ou solicite acesso.
        </p>
        {params.error === "forbidden" ? (
          <p className="mt-3 inline-block rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Voce nao tem permissao pra acessar a area solicitada.
          </p>
        ) : null}
        {params.pending ? (
          <p className="mt-3 inline-block rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Sua solicitacao para o workspace <strong>{params.pending}</strong> ainda nao foi aprovada.
          </p>
        ) : null}
      </header>

      <WorkspaceSearch />

      <Section title="Membro ativo">
        {active.length === 0 ? (
          <EmptyState
            title="Nenhum workspace ativo"
            description="Solicite acesso a um workspace abaixo ou peca ao administrador para liberar."
          />
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/app/${w.slug}`}
                  className="block rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-slate-300 hover:shadow-md"
                >
                  <p className="text-xs uppercase tracking-wider text-slate-500">{w.member_role}</p>
                  <h3 className="mt-1 text-lg font-semibold text-slate-900">{w.name}</h3>
                  <p className="mt-1 text-sm text-slate-500">/{w.slug}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {otherKnown.length > 0 ? (
        <Section title="Aguardando aprovacao / bloqueado">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {otherKnown.map((w) => (
              <li
                key={w.id}
                className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6"
              >
                <p className="text-xs uppercase tracking-wider text-slate-500">{w.member_status}</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-700">{w.name}</h3>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {discoverable.length > 0 ? (
        <Section title="Workspaces disponiveis">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {discoverable.map((w) => (
              <li
                key={w.id}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6"
              >
                <h3 className="text-lg font-semibold text-slate-900">{w.name}</h3>
                <p className="mt-1 text-sm text-slate-500">/{w.slug}</p>
                <RequestAccessButton workspaceId={w.id} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}
