import { createSupabaseServerClient } from "@fabd-fluxos/db/server";

export default async function AppHomePage() {
  const supabase = await createSupabaseServerClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Bem-vindo</h1>
        <p className="mt-2 text-slate-600">
          Aguardando aprovacao do administrador para entrar em um workspace.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Seus workspaces</h2>
        {workspaces && workspaces.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {workspaces.map((ws) => {
              const w = ws as { id: string; name: string; slug: string };
              return (
                <li
                  key={w.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div>
                    <p className="font-medium text-slate-900">{w.name}</p>
                    <p className="text-sm text-slate-500">/{w.slug}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
            <p className="text-sm text-slate-600">
              Voce ainda nao foi adicionado a nenhum workspace.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Pedir ao administrador para liberar seu acesso.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
