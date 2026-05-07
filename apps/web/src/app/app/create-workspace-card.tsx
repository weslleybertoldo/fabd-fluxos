"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWorkspace } from "@/lib/actions/members";

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function CreateWorkspaceCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onName(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  function reset() {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setError(null);
    setOpen(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const cleanName = name.trim();
    const cleanSlug = slug.trim().toLowerCase();
    if (!cleanName) {
      setError("Nome obrigatorio");
      return;
    }
    if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(cleanSlug)) {
      setError("Slug invalido (use a-z, 0-9, hifen; 2-60 chars)");
      return;
    }
    start(async () => {
      const r = await createWorkspace({ name: cleanName, slug: cleanSlug });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/app/${r.data.slug}`);
    });
  }

  if (!open) {
    return (
      <section className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700">
              Criar workspace
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Voce eh senior admin — pode criar novos workspaces aqui.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Novo workspace
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-300 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700">
        Criar workspace
      </h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-600">Nome</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Ex: Federacao XYZ"
            maxLength={80}
            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600">
            Slug (URL)
          </label>
          <div className="mt-1 flex items-center rounded-xl border border-slate-200 bg-white focus-within:border-slate-400 focus-within:ring-1 focus-within:ring-slate-300">
            <span className="select-none px-3 text-sm text-slate-400">/app/</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              placeholder="federacao-xyz"
              maxLength={60}
              className="flex-1 bg-transparent py-2 pr-3 font-mono text-sm outline-none"
            />
          </div>
        </div>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending || !name.trim() || !slug.trim()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? "Criando..." : "Criar"}
          </button>
          <button
            type="button"
            onClick={reset}
            disabled={pending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      </form>
    </section>
  );
}
