import Link from "next/link";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { requestMembership } from "@/lib/actions/members";
import type { WorkspaceMemberRow, WorkspaceRow } from "@/lib/types";

export const dynamic = "force-dynamic";

type WorkspaceCard = WorkspaceRow & {
  member_status: WorkspaceMemberRow["status"] | null;
  member_role: WorkspaceMemberRow["role"] | null;
};

export default async function AppHomePage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("*")
    .order("created_at", { ascending: true });
  const wsRows = (workspaces ?? []) as unknown as WorkspaceRow[];

  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id;

  const { data: members } = userId
    ? await supabase
        .from("workspace_members")
        .select("workspace_id, status, role")
        .eq("user_id", userId)
    : { data: [] };
  const myMembers = (members ?? []) as unknown as Array<
    Pick<WorkspaceMemberRow, "workspace_id" | "status" | "role">
  >;

  const cards: WorkspaceCard[] = wsRows.map((w) => {
    const m = myMembers.find((x) => x.workspace_id === w.id);
    return { ...w, member_status: m?.status ?? null, member_role: m?.role ?? null };
  });

  const active = cards.filter((c) => c.member_status === "active");
  const otherKnown = cards.filter((c) => c.member_status && c.member_status !== "active");
  const discoverable = cards.filter((c) => !c.member_status);

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
                <form
                  action={async () => {
                    "use server";
                    await requestMembership(w.slug);
                  }}
                  className="mt-4"
                >
                  <button
                    type="submit"
                    className="w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                  >
                    Solicitar acesso
                  </button>
                </form>
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
