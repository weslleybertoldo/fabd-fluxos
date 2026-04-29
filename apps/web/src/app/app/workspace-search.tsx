"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { findWorkspaceById, requestMembershipById } from "@/lib/actions/members";

type Found = {
  id: string;
  name: string;
  slug: string;
  member_status: string | null;
  member_role: string | null;
};

export function WorkspaceSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setFound(null);
    const id = query.trim();
    if (!id) return;
    start(async () => {
      const r = await findWorkspaceById(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setFound(r.data);
    });
  }

  function clear() {
    setQuery("");
    setFound(null);
    setError(null);
    setInfo(null);
  }

  function ask() {
    if (!found) return;
    setError(null);
    setInfo(null);
    start(async () => {
      const r = await requestMembershipById(found.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setInfo("Pedido enviado — admin foi notificado. Aguarde aprovacao.");
      router.refresh();
    });
  }

  const status = found?.member_status;
  const canAsk = found && !status; // user nao tem nenhuma row de member ainda

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Buscar workspace por ID
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Cole o UUID do workspace que o admin compartilhou pra entrar nele.
      </p>

      <form onSubmit={search} className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="11111111-1111-1111-1111-fabdfabdfabd"
          className="flex-1 min-w-[280px] rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
        />
        <button
          type="submit"
          disabled={pending || !query.trim()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? "Buscando..." : "Buscar"}
        </button>
        {found || error ? (
          <button
            type="button"
            onClick={clear}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Limpar
          </button>
        ) : null}
      </form>

      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {info ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{info}</p>
      ) : null}

      {found ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-slate-900">{found.name}</h3>
            <p className="mt-0.5 text-xs text-slate-500">/{found.slug}</p>
            {status ? (
              <p className="mt-1 inline-block rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                Voce ja {status === "active" ? "eh membro" : status === "pending" ? "tem pedido pendente" : "esta bloqueado neste workspace"}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            {status === "active" ? (
              <a
                href={`/app/${found.slug}`}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Abrir workspace
              </a>
            ) : canAsk ? (
              <button
                type="button"
                onClick={ask}
                disabled={pending}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {pending ? "Enviando..." : "Pedir acesso"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
