"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type {
  DirectoryRow,
  FlowRow,
  ProjectRow,
  TagRow,
} from "@/lib/types";

type Tab = "atrasados" | "proximos" | "custom";

interface Props {
  tab: Tab;
  directories: DirectoryRow[];
  projects: ProjectRow[];
  flows: FlowRow[];
  tags: TagRow[];
  selectedDirectories: string[];
  selectedProjects: string[];
  selectedFlows: string[];
  selectedTags: string[];
  status: string;
  dateFrom: string;
  dateTo: string;
}

export function ReportFilters({
  tab,
  directories,
  projects,
  flows,
  tags,
  selectedDirectories,
  selectedProjects,
  selectedFlows,
  selectedTags,
  status,
  dateFrom,
  dateTo,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [dirs, setDirs] = useState<string[]>(selectedDirectories);
  const [projs, setProjs] = useState<string[]>(selectedProjects);
  const [fls, setFls] = useState<string[]>(selectedFlows);
  const [tgs, setTgs] = useState<string[]>(selectedTags);
  const [stat, setStat] = useState<string>(status);
  const [from, setFrom] = useState<string>(dateFrom);
  const [to, setTo] = useState<string>(dateTo);

  function applyFilters() {
    const params = new URLSearchParams(sp.toString());
    params.set("tab", tab);
    if (dirs.length) params.set("directories", dirs.join(","));
    else params.delete("directories");
    if (projs.length) params.set("projects", projs.join(","));
    else params.delete("projects");
    if (fls.length) params.set("flows", fls.join(","));
    else params.delete("flows");
    if (tgs.length) params.set("tags", tgs.join(","));
    else params.delete("tags");
    if (tab === "custom") {
      if (stat && stat !== "all") params.set("status", stat);
      else params.delete("status");
      if (from) params.set("from", from);
      else params.delete("from");
      if (to) params.set("to", to);
      else params.delete("to");
    } else {
      params.delete("status");
      params.delete("from");
      params.delete("to");
    }
    router.push(`?${params.toString()}`);
  }

  function clearFilters() {
    setDirs([]);
    setProjs([]);
    setFls([]);
    setTgs([]);
    setStat("all");
    setFrom("");
    setTo("");
    const params = new URLSearchParams();
    params.set("tab", tab);
    router.push(`?${params.toString()}`);
  }

  // Filtra projetos/fluxos pra só mostrar os que estão dentro das diretorias/projetos selecionados
  const visibleProjects = dirs.length
    ? projects.filter((p) => dirs.includes(p.directory_id))
    : projects;
  const visibleFlows = projs.length
    ? flows.filter((f) => projs.includes(f.project_id))
    : dirs.length
      ? flows.filter((f) => {
          const p = projects.find((pp) => pp.id === f.project_id);
          return p ? dirs.includes(p.directory_id) : false;
        })
      : flows;

  const hasAnyFilter =
    dirs.length > 0 ||
    projs.length > 0 ||
    fls.length > 0 ||
    tgs.length > 0 ||
    (tab === "custom" && (stat !== "all" || from || to));

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MultiSelect
          label="Diretorias"
          options={directories.map((d) => ({ value: d.id, label: d.name }))}
          value={dirs}
          onChange={setDirs}
        />
        <MultiSelect
          label="Projetos"
          options={visibleProjects.map((p) => ({ value: p.id, label: p.name }))}
          value={projs}
          onChange={setProjs}
        />
        <MultiSelect
          label="Fluxos"
          options={visibleFlows.map((f) => ({ value: f.id, label: f.name }))}
          value={fls}
          onChange={setFls}
        />
        <MultiSelect
          label="Tags"
          options={tags.map((t) => ({ value: t.id, label: t.name }))}
          value={tgs}
          onChange={setTgs}
        />
      </div>

      {tab === "custom" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Status</span>
            <select
              value={stat}
              onChange={(e) => setStat(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
            >
              <option value="all">Todos</option>
              <option value="overdue">Vencidas</option>
              <option value="on_track">Em andamento</option>
              <option value="completed">Concluidas</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">De</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Ate</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400"
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
        {hasAnyFilter ? (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Limpar
          </button>
        ) : null}
        <button
          type="button"
          onClick={applyFilters}
          className="rounded-lg bg-slate-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Aplicar filtros
        </button>
      </div>
    </section>
  );
}

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const summary =
    value.length === 0
      ? "Todos"
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? "1 selecionado"
        : `${value.length} selecionados`;

  function toggle(id: string) {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else onChange([...value, id]);
  }

  return (
    <div className="relative space-y-1">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-slate-50"
      >
        <span className="truncate">{summary}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-400">Nada disponivel</p>
          ) : (
            options.map((o) => (
              <label
                key={o.value}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={value.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="h-4 w-4"
                />
                <span className="flex-1 truncate">{o.label}</span>
              </label>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
