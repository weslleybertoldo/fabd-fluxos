import Link from "next/link";
import { requireWorkspaceMember } from "@/lib/workspace";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { getVisibleDirectoryIds } from "@/lib/visibility";
import { ReportFilters } from "./filters";
import type {
  DirectoryRow,
  FlowRow,
  PhaseRow,
  ProjectRow,
  TagRow,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Tab = "atrasados" | "proximos" | "custom";

interface PhaseRowFull extends PhaseRow {
  flow?: { id: string; name: string; type: string; status: string; project_id: string } | null;
}

interface FlowFull extends FlowRow {
  project?: ProjectRow | null;
  directory?: DirectoryRow | null;
}

export default async function RelatoriosPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspace: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireWorkspaceMember(slug);

  const tab = (sp.tab as Tab) ?? "atrasados";

  // Filtros (multi-select via CSV)
  const directoryFilter = parseCsv(sp.directories);
  const projectFilter = parseCsv(sp.projects);
  const flowFilter = parseCsv(sp.flows);
  const tagFilter = parseCsv(sp.tags);
  const statusFilter = (sp.status as string) ?? "all"; // overdue | on_track | completed | all
  const dateFrom = (sp.from as string) ?? "";
  const dateTo = (sp.to as string) ?? "";

  const supabase = await createSupabaseServerClient();

  const visibleIds = await getVisibleDirectoryIds(
    supabase,
    ctx.member.id,
    ctx.member.role,
  );

  // Bulk dos metadados pra UI dos filtros
  const [directoriesRes, projectsRes, flowsRes, tagsRes, membersRes] =
    await Promise.all([
      supabase
        .from("directories")
        .select("*")
        .eq("workspace_id", ctx.workspace.id)
        .order("order_index"),
      supabase
        .from("projects")
        .select("*, directory:directories!inner(workspace_id)")
        .eq("directory.workspace_id", ctx.workspace.id)
        .order("name"),
      supabase
        .from("flows")
        .select("*, project:projects!inner(directory:directories!inner(workspace_id))")
        .eq("project.directory.workspace_id", ctx.workspace.id)
        .order("name"),
      supabase
        .from("tags")
        .select("*")
        .eq("workspace_id", ctx.workspace.id)
        .order("name"),
      supabase
        .from("workspace_members")
        .select("user_id, google_full_name, google_avatar_url")
        .eq("workspace_id", ctx.workspace.id)
        .eq("status", "active"),
    ]);

  let directories = (directoriesRes.data ?? []) as unknown as DirectoryRow[];
  if (visibleIds !== null) {
    directories = directories.filter((d) => visibleIds.includes(d.id));
  }
  const visibleDirectoryIds = directories.map((d) => d.id);
  let projects = (projectsRes.data ?? []) as unknown as ProjectRow[];
  projects = projects.filter((p) => visibleDirectoryIds.includes(p.directory_id));
  let flows = (flowsRes.data ?? []) as unknown as FlowFull[];
  const visibleProjectIds = projects.map((p) => p.id);
  flows = flows.filter((f) => visibleProjectIds.includes(f.project_id));
  const tags = (tagsRes.data ?? []) as unknown as TagRow[];
  // membersRes carregado no Promise.all (linha 49) caso futuras features precisem;
  // hoje a pagina nao mostra avatar de members na lista — manter sem extrair pra evitar import.
  void membersRes;

  // ---- Query principal de phases ----
  // RLS ja filtra por workspace via workspace_of_phase. Pra filtrar mais
  // precisamos juntar com flow → project → directory. Estrategia:
  //  1. Obter ids de flows que passam nos filtros (directories/projects/flows/tags)
  //  2. Filtrar phases por flow_id IN (ids)

  const flowsByProject = new Map<string, FlowRow[]>();
  for (const f of flows) {
    if (!flowsByProject.has(f.project_id)) flowsByProject.set(f.project_id, []);
    flowsByProject.get(f.project_id)!.push(f);
  }

  const projectsByDirectory = new Map<string, ProjectRow[]>();
  for (const p of projects) {
    if (!projectsByDirectory.has(p.directory_id)) projectsByDirectory.set(p.directory_id, []);
    projectsByDirectory.get(p.directory_id)!.push(p);
  }

  // Tags mapeadas por flow_id
  const { data: flowTagsData } = await supabase
    .from("flow_tags")
    .select("flow_id, tag_id");
  const tagsByFlow = new Map<string, string[]>();
  for (const ft of (flowTagsData ?? []) as unknown as Array<{
    flow_id: string;
    tag_id: string;
  }>) {
    if (!tagsByFlow.has(ft.flow_id)) tagsByFlow.set(ft.flow_id, []);
    tagsByFlow.get(ft.flow_id)!.push(ft.tag_id);
  }

  // Resolve qual conjunto de flow_ids passa nos filtros
  let candidateFlowIds = flows.map((f) => f.id);
  if (flowFilter.length) {
    candidateFlowIds = candidateFlowIds.filter((id) => flowFilter.includes(id));
  }
  if (projectFilter.length) {
    candidateFlowIds = candidateFlowIds.filter((id) => {
      const flow = flows.find((f) => f.id === id);
      return flow ? projectFilter.includes(flow.project_id) : false;
    });
  }
  if (directoryFilter.length) {
    candidateFlowIds = candidateFlowIds.filter((id) => {
      const flow = flows.find((f) => f.id === id);
      if (!flow) return false;
      const proj = projects.find((p) => p.id === flow.project_id);
      return proj ? directoryFilter.includes(proj.directory_id) : false;
    });
  }
  if (tagFilter.length) {
    candidateFlowIds = candidateFlowIds.filter((fid) => {
      const ts = tagsByFlow.get(fid) ?? [];
      return tagFilter.some((t) => ts.includes(t));
    });
  }

  let phasesData: PhaseRowFull[] = [];
  if (candidateFlowIds.length) {
    let q = supabase
      .from("phases")
      .select("*")
      .in("flow_id", candidateFlowIds);

    const now = new Date().toISOString();

    if (tab === "atrasados") {
      q = q.is("completed_at", null).lt("due_date", now);
    } else if (tab === "proximos") {
      q = q.is("completed_at", null).gte("due_date", now);
    } else {
      // custom
      if (statusFilter === "overdue")
        q = q.is("completed_at", null).lt("due_date", now);
      else if (statusFilter === "on_track")
        q = q.is("completed_at", null).gte("due_date", now);
      else if (statusFilter === "completed") q = q.not("completed_at", "is", null);
      // 'all' nao filtra status

      if (dateFrom) q = q.gte("due_date", dateFrom);
      if (dateTo) q = q.lte("due_date", dateTo);
    }

    const sortAsc = tab === "proximos" || tab === "custom";
    q = q.order("due_date", { ascending: sortAsc, nullsFirst: false });

    const res = await q;
    phasesData = (res.data ?? []) as unknown as PhaseRowFull[];
  }

  // Hidrata cada phase com flow/project/directory
  const flowById = new Map(flows.map((f) => [f.id, f]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const directoryById = new Map(directories.map((d) => [d.id, d]));

  const phases = phasesData
    .map((ph) => {
      const flow = flowById.get(ph.flow_id);
      const project = flow ? projectById.get(flow.project_id) : undefined;
      const directory = project ? directoryById.get(project.directory_id) : undefined;
      if (!flow || !project || !directory) return null;
      return { phase: ph, flow, project, directory };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/app/${ctx.workspace.slug}`} className="hover:text-slate-900">
              {ctx.workspace.name}
            </Link>
            <span className="mx-2 text-slate-300">/</span>
            <span className="text-slate-700">Relatorios</span>
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            Relatorios
          </h1>
        </div>
      </header>

      <nav className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-sm">
        <TabLink
          slug={ctx.workspace.slug}
          tab="atrasados"
          active={tab === "atrasados"}
          label="Atrasados"
        />
        <TabLink
          slug={ctx.workspace.slug}
          tab="proximos"
          active={tab === "proximos"}
          label="Proximos"
        />
        <TabLink
          slug={ctx.workspace.slug}
          tab="custom"
          active={tab === "custom"}
          label="Customizado"
        />
      </nav>

      <ReportFilters
        tab={tab}
        directories={directories}
        projects={projects}
        flows={flows}
        tags={tags}
        selectedDirectories={directoryFilter}
        selectedProjects={projectFilter}
        selectedFlows={flowFilter}
        selectedTags={tagFilter}
        status={statusFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
      />

      <section>
        <p className="mb-3 text-sm text-slate-600">
          {phases.length} fase{phases.length === 1 ? "" : "s"} encontrada
          {phases.length === 1 ? "" : "s"}
          {tab === "atrasados" ? " (vencidas e nao concluidas)" : null}
          {tab === "proximos" ? " (em ordem cronologica)" : null}
        </p>

        {phases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
            <p className="font-medium text-slate-700">Nada por aqui</p>
            <p className="mt-1 text-sm text-slate-500">
              {tab === "atrasados"
                ? "Nenhuma fase atrasada com os filtros atuais."
                : tab === "proximos"
                  ? "Nenhuma fase futura com data definida."
                  : "Ajuste os filtros pra ver resultados."}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {phases.map(({ phase, flow, project, directory }) => {
              const isOverdue =
                !phase.completed_at &&
                phase.due_date &&
                new Date(phase.due_date) < new Date();
              const completed = !!phase.completed_at;
              return (
                <li
                  key={phase.id}
                  className="rounded-xl border border-slate-200 bg-white p-3"
                >
                  <Link
                    href={`/app/${ctx.workspace.slug}/${directory.slug}/${project.id}/${flow.id}`}
                    className="flex flex-wrap items-start justify-between gap-3 hover:opacity-80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">
                        <span className="font-medium text-slate-700">
                          {directory.name}
                        </span>
                        <span className="mx-1.5 text-slate-300">/</span>
                        <span>{project.name}</span>
                        <span className="mx-1.5 text-slate-300">/</span>
                        <span>{flow.name}</span>
                      </p>
                      <p
                        className={`mt-0.5 font-semibold ${
                          completed ? "text-emerald-700 line-through" : "text-slate-900"
                        }`}
                      >
                        {phase.name}
                      </p>
                      {phase.description ? (
                        <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">
                          {phase.description}
                        </p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs">
                      {phase.due_date ? (
                        <p
                          className={
                            isOverdue
                              ? "font-semibold text-red-700"
                              : completed
                                ? "text-emerald-700"
                                : "text-slate-600"
                          }
                        >
                          {formatDate(phase.due_date)}
                        </p>
                      ) : (
                        <p className="italic text-slate-400">sem data</p>
                      )}
                      <p
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 ${
                          completed
                            ? "bg-emerald-100 text-emerald-700"
                            : isOverdue
                              ? "bg-red-100 text-red-700"
                              : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {completed ? "Concluida" : isOverdue ? "Vencida" : "Em andamento"}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function TabLink({
  slug,
  tab,
  active,
  label,
}: {
  slug: string;
  tab: Tab;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={`/app/${slug}/relatorios?tab=${tab}`}
      className={`flex-1 rounded-lg px-3 py-1.5 text-center transition ${
        active
          ? "bg-white font-semibold text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </Link>
  );
}

function parseCsv(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split(",").filter(Boolean);
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}
