import type { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import type {
  AutomationTarget,
  AutomationView,
  DirectoryRow,
  KanbanAutomationRow,
  KanbanAutomationRunRow,
  KanbanCardCommentRow,
  KanbanCardLink,
  KanbanCardResponsibleRow,
  KanbanCardRow,
  KanbanPhaseRow,
  KanbanRow,
  ProjectRow,
} from "./types";

type ServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** Tudo que um Kanban completo precisa pra renderizar (quadro + automacoes + botoes). */
export type KanbanBoardData = {
  kanban: KanbanRow;
  phases: KanbanPhaseRow[];
  cards: KanbanCardRow[];
  responsiblesByCard: Record<string, string[]>;
  commentsByCard: Record<string, KanbanCardCommentRow[]>;
  originByCard: Record<string, KanbanCardLink | null>;
  generatedByCard: Record<string, KanbanCardLink[]>;
  automationViews: AutomationView[];
  automationTargets: AutomationTarget[];
  canEditKanban: boolean;
  canDeleteKanban: boolean;
};

/**
 * Carrega os Kanbans de um projeto prontos pro <KanbanBoard> — usado na pagina do
 * Kanban (1) e na pagina do projeto (todos). As consultas sao em lote pra N Kanbans;
 * o mapa do workspace (destinos das automacoes, "Veio de" / "Gerou") sai uma vez so.
 */
export async function loadKanbanBoards(
  supabase: ServerClient,
  opts: {
    workspace: { id: string; slug: string };
    visibleIds: string[] | null;
    member: { role: string; user_id: string };
    project: Pick<ProjectRow, "responsible_user_id">;
    kanbans: KanbanRow[];
  },
): Promise<KanbanBoardData[]> {
  const { workspace, visibleIds, member, project, kanbans } = opts;
  if (kanbans.length === 0) return [];
  const kanbanIds = kanbans.map((k) => k.id);

  // Onda 1: fases, cards e regras dos Kanbans + diretorias do workspace
  const [phasesRes, cardsRes, automationsRes, allDirsRes] = await Promise.all([
    supabase
      .from("kanban_phases")
      .select("*")
      .in("kanban_id", kanbanIds)
      .order("position", { ascending: true }),
    supabase
      .from("kanban_cards")
      .select("*")
      .in("kanban_id", kanbanIds)
      .order("position", { ascending: true }),
    supabase
      .from("kanban_automations")
      .select("*")
      .in("source_kanban_id", kanbanIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("directories")
      .select("id, name, slug, order_index")
      .eq("workspace_id", workspace.id)
      .order("order_index", { ascending: true }),
  ]);
  const phases = (phasesRes.data ?? []) as unknown as KanbanPhaseRow[];
  const cards = (cardsRes.data ?? []) as unknown as KanbanCardRow[];
  const automations = (automationsRes.data ?? []) as unknown as KanbanAutomationRow[];
  const allDirs = (allDirsRes.data ?? []) as unknown as Pick<
    DirectoryRow,
    "id" | "name" | "slug" | "order_index"
  >[];

  // Onda 2: responsaveis, comentarios e disparos dos cards + projetos do workspace
  const cardIds = cards.map((c) => c.id);
  const [respRes, commentsRes, runsRes, allProjRes] = await Promise.all([
    cardIds.length
      ? supabase.from("kanban_card_responsibles").select("*").in("card_id", cardIds)
      : Promise.resolve({ data: [] }),
    cardIds.length
      ? supabase
          .from("kanban_card_comments")
          .select("*")
          .in("card_id", cardIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    cardIds.length
      ? supabase.from("kanban_automation_runs").select("*").in("source_card_id", cardIds)
      : Promise.resolve({ data: [] }),
    allDirs.length
      ? supabase
          .from("projects")
          .select("id, name, directory_id, status")
          .in(
            "directory_id",
            allDirs.map((d) => d.id),
          )
      : Promise.resolve({ data: [] }),
  ]);
  const runs = (runsRes.data ?? []) as unknown as KanbanAutomationRunRow[];
  const allProjects = (allProjRes.data ?? []) as unknown as Pick<
    ProjectRow,
    "id" | "name" | "directory_id" | "status"
  >[];

  // Onda 3: Kanbans do workspace (destinos e vinculos)
  const { data: allKbData } = allProjects.length
    ? await supabase
        .from("kanbans")
        .select("id, name, project_id")
        .in(
          "project_id",
          allProjects.map((p) => p.id),
        )
    : { data: [] };
  const allKanbans = (allKbData ?? []) as unknown as Pick<KanbanRow, "id" | "name" | "project_id">[];

  // Onda 4: fases de todos os Kanbans do workspace + cards ligados por automacao
  const linkedIds = Array.from(
    new Set([
      ...runs.map((r) => r.created_card_id).filter((x): x is string => !!x),
      ...cards.map((c) => c.source_card_id).filter((x): x is string => !!x),
    ]),
  );
  const [allPhasesRes, linkedRes] = await Promise.all([
    allKanbans.length
      ? supabase
          .from("kanban_phases")
          .select("id, name, kanban_id, position")
          .in(
            "kanban_id",
            allKanbans.map((k) => k.id),
          )
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] }),
    linkedIds.length
      ? supabase.from("kanban_cards").select("id, title, kanban_id, phase_id").in("id", linkedIds)
      : Promise.resolve({ data: [] }),
  ]);
  const allPhases = (allPhasesRes.data ?? []) as unknown as Pick<
    KanbanPhaseRow,
    "id" | "name" | "kanban_id" | "position"
  >[];
  const linkedCards = (linkedRes.data ?? []) as unknown as Pick<
    KanbanCardRow,
    "id" | "title" | "kanban_id" | "phase_id"
  >[];

  const dirById = new Map(allDirs.map((d) => [d.id, d]));
  const projById = new Map(allProjects.map((p) => [p.id, p]));
  const kbById = new Map(allKanbans.map((k) => [k.id, k]));
  const phaseById = new Map(allPhases.map((p) => [p.id, p]));
  const phasesByKanban = new Map<string, { id: string; name: string }[]>();
  for (const ph of allPhases) {
    const list = phasesByKanban.get(ph.kanban_id) ?? [];
    list.push({ id: ph.id, name: ph.name });
    phasesByKanban.set(ph.kanban_id, list);
  }
  function kanbanPath(kbId: string) {
    const k = kbById.get(kbId);
    const p = k ? projById.get(k.project_id) : undefined;
    const d = p ? dirById.get(p.directory_id) : undefined;
    if (!k || !p || !d) return null;
    return {
      label: `${d.name} › ${p.name} › ${k.name}`,
      href: `/app/${workspace.slug}/${d.slug}/${p.id}/kanban/${k.id}`,
      directoryId: d.id,
      projectActive: p.status === "active",
    };
  }
  function cardLink(card: Pick<KanbanCardRow, "id" | "title" | "kanban_id" | "phase_id">): KanbanCardLink {
    const path = kanbanPath(card.kanban_id);
    const phaseName = phaseById.get(card.phase_id)?.name;
    return {
      cardId: card.id,
      title: card.title,
      where: `${path?.label ?? "Kanban"}${phaseName ? ` · fase ${phaseName}` : ""}`,
      href: path ? `${path.href}?card=${card.id}` : null,
    };
  }

  // Mapas por card (cada quadro recebe so os dos cards dele)
  const kanbanOfCard = new Map(cards.map((c) => [c.id, c.kanban_id]));
  const responsiblesByCard: Record<string, string[]> = {};
  for (const r of (respRes.data ?? []) as unknown as KanbanCardResponsibleRow[]) {
    (responsiblesByCard[r.card_id] ??= []).push(r.user_id);
  }
  const commentsByCard: Record<string, KanbanCardCommentRow[]> = {};
  for (const c of (commentsRes.data ?? []) as unknown as KanbanCardCommentRow[]) {
    (commentsByCard[c.card_id] ??= []).push(c);
  }
  const linkedById = new Map(linkedCards.map((c) => [c.id, c]));
  const originByCard: Record<string, KanbanCardLink | null> = {};
  for (const c of cards) {
    if (!c.created_by_automation_id && !c.source_card_id) continue;
    const src = c.source_card_id ? linkedById.get(c.source_card_id) : undefined;
    originByCard[c.id] = src ? cardLink(src) : null;
  }
  const generatedByCard: Record<string, KanbanCardLink[]> = {};
  for (const r of runs) {
    const created = r.created_card_id ? linkedById.get(r.created_card_id) : undefined;
    if (created) (generatedByCard[r.source_card_id] ??= []).push(cardLink(created));
  }
  function pick<T>(map: Record<string, T>, kanbanId: string): Record<string, T> {
    return Object.fromEntries(
      Object.entries(map).filter(([cardId]) => kanbanOfCard.get(cardId) === kanbanId),
    );
  }

  // Permissoes alinhadas com can_edit_kanban / kb_delete
  const isAdmin = member.role === "admin";
  const isDiretor = member.role === "diretor";
  const isProjectResponsible = project.responsible_user_id === member.user_id;

  return kanbans.map((kanban) => {
    const kbPhases = phases.filter((p) => p.kanban_id === kanban.id);
    const automationViews: AutomationView[] = automations
      .filter((a) => a.source_kanban_id === kanban.id)
      .map((a) => {
        const path = kanbanPath(a.target_kanban_id);
        return {
          id: a.id,
          active: a.active,
          sourcePhaseName: kbPhases.find((p) => p.id === a.source_phase_id)?.name ?? "?",
          targetLabel: path?.label ?? "Kanban",
          targetPhaseName: phaseById.get(a.target_phase_id)?.name ?? "?",
          targetHref: path?.href ?? null,
        };
      });
    // Destinos: outros Kanbans do workspace, em projeto ativo, nas diretorias visiveis
    const automationTargets: AutomationTarget[] = allKanbans
      .filter((k) => k.id !== kanban.id)
      .map((k) => ({ k, path: kanbanPath(k.id) }))
      .filter(
        ({ path }) =>
          !!path &&
          path.projectActive &&
          (visibleIds === null || visibleIds.includes(path.directoryId)),
      )
      .map(({ k, path }) => ({
        kanbanId: k.id,
        label: path!.label,
        phases: phasesByKanban.get(k.id) ?? [],
      }))
      .filter((t) => t.phases.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

    return {
      kanban,
      phases: kbPhases,
      cards: cards.filter((c) => c.kanban_id === kanban.id),
      responsiblesByCard: pick(responsiblesByCard, kanban.id),
      commentsByCard: pick(commentsByCard, kanban.id),
      originByCard: pick(originByCard, kanban.id),
      generatedByCard: pick(generatedByCard, kanban.id),
      automationViews,
      automationTargets,
      canEditKanban:
        isAdmin || (isDiretor && (kanban.created_by === member.user_id || isProjectResponsible)),
      canDeleteKanban: isAdmin,
    };
  });
}
