"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  KanbanCardRow,
  KanbanPhaseRow,
  KanbanRow,
  ProjectRow,
  WorkspaceRow,
} from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// As tabelas do Kanban nao estao no database.types gerado — client minimo tipado
// na mao (mesmo espirito dos casts `as unknown as` do resto do repo).
type PgError = { message: string; code?: string };
type Rows = { data: Record<string, unknown>[] | null; error: PgError | null; count?: number | null };
type Query = PromiseLike<Rows> & {
  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): Query;
  eq(col: string, val: string | number): Query;
  in(col: string, vals: string[]): Query;
  order(col: string, opts?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: PgError | null }>;
};
type Table = {
  select(cols?: string, opts?: { count?: "exact"; head?: boolean }): Query;
  insert(values: Record<string, unknown> | Record<string, unknown>[]): Query;
  update(values: Record<string, unknown>): Query;
  delete(): Query;
};

const MAX_PHASES = 30;
const MAX_TAGS = 20;
const MAX_RESPONSIBLES = 20;
const POSITION_STEP = 1024;

async function getDb() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const t = (name: string) => (supabase as unknown as { from(t: string): Table }).from(name);
  return { supabase, t, userId: user?.id ?? null };
}

type Db = Awaited<ReturnType<typeof getDb>>;

type ProjectCtx = { workspace: WorkspaceRow; directory: DirectoryRow; project: ProjectRow };
type KanbanCtx = ProjectCtx & { kanban: KanbanRow };

export type KanbanScope = {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  kanbanId: string;
};

async function resolveProject(
  db: Db,
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
): Promise<({ ok: true } & ProjectCtx) | { ok: false; error: string }> {
  const { data: ws } = await db.supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  const workspace = ws as unknown as WorkspaceRow | null;
  if (!workspace) return { ok: false, error: "Workspace nao encontrado" };

  const { data: dir } = await db.supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", directorySlug)
    .maybeSingle();
  const directory = dir as unknown as DirectoryRow | null;
  if (!directory) return { ok: false, error: "Diretoria nao encontrada" };

  const { data: prj } = await db.supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("directory_id", directory.id)
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  return { ok: true, workspace, directory, project };
}

async function resolveKanban(
  db: Db,
  scope: KanbanScope,
): Promise<({ ok: true } & KanbanCtx) | { ok: false; error: string }> {
  const ctx = await resolveProject(db, scope.workspaceSlug, scope.directorySlug, scope.projectId);
  if (!ctx.ok) return ctx;
  const { data } = await db
    .t("kanbans")
    .select("*")
    .eq("id", scope.kanbanId)
    .eq("project_id", ctx.project.id)
    .maybeSingle();
  const kanban = data as unknown as KanbanRow | null;
  if (!kanban) return { ok: false, error: "Kanban nao encontrado" };
  return { ...ctx, kanban };
}

function ctxAudit(ctx: ProjectCtx & { kanban?: KanbanRow }) {
  return {
    directory_id: ctx.directory.id,
    directory_slug: ctx.directory.slug,
    directory_name: ctx.directory.name,
    project_id: ctx.project.id,
    project_name: ctx.project.name,
    ...(ctx.kanban ? { kanban_id: ctx.kanban.id, kanban_name: ctx.kanban.name } : {}),
  };
}

function revalidateKanban(scope: Omit<KanbanScope, "kanbanId"> & { kanbanId?: string }) {
  const base = `/app/${scope.workspaceSlug}/${scope.directorySlug}/${scope.projectId}`;
  revalidatePath(base);
  if (scope.kanbanId) revalidatePath(`${base}/kanban/${scope.kanbanId}`);
}

function cleanTags(tags: string[] | undefined): string[] {
  return Array.from(
    new Set((tags ?? []).map((t) => t.trim()).filter((t) => t && t.length <= 50)),
  ).slice(0, MAX_TAGS);
}

async function loadPhases(db: Db, kanbanId: string): Promise<KanbanPhaseRow[]> {
  const { data } = await db
    .t("kanban_phases")
    .select("*")
    .eq("kanban_id", kanbanId)
    .order("position", { ascending: true });
  return (data ?? []) as unknown as KanbanPhaseRow[];
}

async function loadCard(db: Db, kanbanId: string, cardId: string): Promise<KanbanCardRow | null> {
  const { data } = await db
    .t("kanban_cards")
    .select("*")
    .eq("id", cardId)
    .eq("kanban_id", kanbanId)
    .maybeSingle();
  return data as unknown as KanbanCardRow | null;
}

// Posicao de um card novo no TOPO da fase (igual Pipefy).
async function topPosition(db: Db, phaseId: string): Promise<number> {
  const { data } = await db
    .t("kanban_cards")
    .select("position")
    .eq("phase_id", phaseId)
    .order("position", { ascending: true })
    .limit(1);
  const first = (data ?? [])[0] as { position?: number } | undefined;
  return first?.position !== undefined ? first.position - POSITION_STEP : 0;
}

// ============================================================================
// Kanban
// ============================================================================

export async function createKanban(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
  description?: string | null;
  phases: string[];
}): Promise<ActionResult<{ kanbanId: string }>> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };
  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 2000) {
    return { ok: false, error: "Descricao muito longa" };
  }
  const phases = (input.phases ?? []).map((p) => p.trim()).filter(Boolean);
  if (phases.length === 0) return { ok: false, error: "Adicione ao menos uma fase" };
  if (phases.length > MAX_PHASES) return { ok: false, error: `Maximo de ${MAX_PHASES} fases` };
  if (phases.some((p) => p.length > 100)) return { ok: false, error: "Nome de fase muito longo" };

  const ctx = await resolveProject(db, input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  // order_index no espaco compartilhado do board (fluxos + checklists + kanbans)
  const maxOf = async (table: string) => {
    const { data } = await db
      .t(table)
      .select("order_index")
      .eq("project_id", ctx.project.id)
      .order("order_index", { ascending: false })
      .limit(1);
    return ((data ?? [])[0] as { order_index?: number } | undefined)?.order_index ?? -1;
  };
  const maxes = await Promise.all([maxOf("flows"), maxOf("checklists"), maxOf("kanbans")]);
  const nextOrder = Math.max(...maxes) + 1;

  const { data: kbData, error: kbErr } = await db
    .t("kanbans")
    .insert({
      project_id: ctx.project.id,
      name,
      description,
      order_index: nextOrder,
      created_by: db.userId,
    })
    .select()
    .maybeSingle();
  if (kbErr) return { ok: false, error: kbErr.message };
  if (!kbData) return { ok: false, error: "Sem permissao" };
  const kanban = kbData as unknown as KanbanRow;

  const { error: phErr } = await db
    .t("kanban_phases")
    .insert(phases.map((p, i) => ({ kanban_id: kanban.id, name: p, position: i })));
  if (phErr) {
    // rollback best-effort (so admin exclui Kanban — se falhar, fica sem fases e a
    // pagina do Kanban mostra "+ Nova fase")
    await db.t("kanbans").delete().eq("id", kanban.id);
    return { ok: false, error: `Falhou ao criar as fases: ${phErr.message}` };
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: kanban.id,
    action: "create",
    changes: { after: { name, fases: phases.length } },
    context: ctxAudit({ ...ctx, kanban }),
  });

  revalidateKanban({ ...input, kanbanId: kanban.id });
  return { ok: true, data: { kanbanId: kanban.id } };
}

export async function updateKanban(
  input: KanbanScope & { name: string; description?: string | null },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };
  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 2000) {
    return { ok: false, error: "Descricao muito longa" };
  }

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;

  const { data, error } = await db
    .t("kanbans")
    .update({ name, description })
    .eq("id", ctx.kanban.id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "update",
    changes: {
      before: { name: ctx.kanban.name, description: ctx.kanban.description },
      after: { name, description },
    },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function deleteKanban(input: KanbanScope): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;

  const { data, error } = await db.t("kanbans").delete().eq("id", ctx.kanban.id).select();
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Sem permissao (so admin exclui Kanban)" };
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "delete",
    changes: { before: { name: ctx.kanban.name } },
    context: ctxAudit(ctx),
  });

  revalidateKanban({ ...input, kanbanId: undefined });
  return { ok: true, data: undefined };
}

// ============================================================================
// Fases (colunas)
// ============================================================================

export async function addKanbanPhase(
  input: KanbanScope & { name: string },
): Promise<ActionResult<{ phaseId: string }>> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome da fase obrigatorio" };
  if (name.length > 100) return { ok: false, error: "Nome da fase muito longo" };

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;

  const phases = await loadPhases(db, ctx.kanban.id);
  if (phases.length >= MAX_PHASES) return { ok: false, error: `Maximo de ${MAX_PHASES} fases` };
  const nextPos = phases.length ? Math.max(...phases.map((p) => p.position)) + 1 : 0;

  const { data, error } = await db
    .t("kanban_phases")
    .insert({ kanban_id: ctx.kanban.id, name, position: nextPos })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "update",
    changes: { after: { fase_nova: name } },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: { phaseId: (data as unknown as KanbanPhaseRow).id } };
}

export async function renameKanbanPhase(
  input: KanbanScope & { phaseId: string; name: string },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome da fase obrigatorio" };
  if (name.length > 100) return { ok: false, error: "Nome da fase muito longo" };

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const phase = (await loadPhases(db, ctx.kanban.id)).find((p) => p.id === input.phaseId);
  if (!phase) return { ok: false, error: "Fase nao encontrada" };
  if (phase.name === name) return { ok: true, data: undefined };

  const { data, error } = await db
    .t("kanban_phases")
    .update({ name })
    .eq("id", phase.id)
    .eq("kanban_id", ctx.kanban.id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "update",
    changes: { before: { fase: phase.name }, after: { fase: name } },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function moveKanbanPhase(
  input: KanbanScope & { phaseId: string; direction: "left" | "right" },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;

  const phases = await loadPhases(db, ctx.kanban.id);
  const idx = phases.findIndex((p) => p.id === input.phaseId);
  if (idx < 0) return { ok: false, error: "Fase nao encontrada" };
  const target = input.direction === "left" ? idx - 1 : idx + 1;
  if (target < 0 || target >= phases.length) return { ok: true, data: undefined };

  const next = [...phases];
  [next[idx], next[target]] = [next[target]!, next[idx]!];
  for (let i = 0; i < next.length; i++) {
    const p = next[i]!;
    if (p.position === i) continue;
    const { data, error } = await db
      .t("kanban_phases")
      .update({ position: i })
      .eq("id", p.id)
      .eq("kanban_id", ctx.kanban.id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Sem permissao" };
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "reorder",
    changes: {
      before: { fases: phases.map((p) => p.name).join(" > ") },
      after: { fases: next.map((p) => p.name).join(" > ") },
    },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function deleteKanbanPhase(
  input: KanbanScope & { phaseId: string },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;

  const phases = await loadPhases(db, ctx.kanban.id);
  const phase = phases.find((p) => p.id === input.phaseId);
  if (!phase) return { ok: false, error: "Fase nao encontrada" };
  if (phases.length <= 1) return { ok: false, error: "O Kanban precisa de pelo menos uma fase" };

  const { count } = await db
    .t("kanban_cards")
    .select("id", { count: "exact", head: true })
    .eq("phase_id", phase.id);
  if ((count ?? 0) > 0) {
    return { ok: false, error: "Mova os cards desta fase antes de excluir" };
  }

  const { data, error } = await db
    .t("kanban_phases")
    .delete()
    .eq("id", phase.id)
    .eq("kanban_id", ctx.kanban.id)
    .select();
  if (error) {
    if (error.code === "23503") {
      return { ok: false, error: "Mova os cards desta fase antes de excluir" };
    }
    return { ok: false, error: error.message };
  }
  if (!data || data.length === 0) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban",
    entityId: ctx.kanban.id,
    action: "update",
    changes: { before: { fase_excluida: phase.name } },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

// ============================================================================
// Cards
// ============================================================================

export async function createKanbanCard(
  input: KanbanScope & { title: string },
): Promise<ActionResult<{ cardId: string }>> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Titulo obrigatorio" };
  if (title.length > 300) return { ok: false, error: "Titulo muito longo" };

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const first = (await loadPhases(db, ctx.kanban.id))[0];
  if (!first) return { ok: false, error: "Crie uma fase antes de adicionar cards" };

  const { data, error } = await db
    .t("kanban_cards")
    .insert({
      kanban_id: ctx.kanban.id,
      phase_id: first.id,
      title,
      position: await topPosition(db, first.id),
      created_by: db.userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };
  const card = data as unknown as KanbanCardRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban_card",
    entityId: card.id,
    action: "create",
    changes: { after: { name: title, phase: first.name } },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: { cardId: card.id } };
}

export async function updateKanbanCard(
  input: KanbanScope & {
    cardId: string;
    title: string;
    description: string | null;
    dueDate: string | null;
    tags: string[];
  },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Titulo obrigatorio" };
  if (title.length > 300) return { ok: false, error: "Titulo muito longo" };
  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 5000) {
    return { ok: false, error: "Descricao muito longa" };
  }
  let dueDate: string | null = null;
  if (input.dueDate) {
    const ts = Date.parse(input.dueDate);
    if (Number.isNaN(ts)) return { ok: false, error: "Data invalida" };
    dueDate = new Date(ts).toISOString();
  }
  const tags = cleanTags(input.tags);

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const before = await loadCard(db, ctx.kanban.id, input.cardId);
  if (!before) return { ok: false, error: "Card nao encontrado" };

  const { data, error } = await db
    .t("kanban_cards")
    .update({ title, description, due_date: dueDate, tags })
    .eq("id", before.id)
    .eq("kanban_id", ctx.kanban.id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban_card",
    entityId: before.id,
    action: "update",
    changes: {
      before: {
        title: before.title,
        description: before.description,
        due_date: before.due_date,
        tags: before.tags,
      },
      after: { title, description, due_date: dueDate, tags },
    },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function moveKanbanCard(
  input: KanbanScope & { cardId: string; phaseId: string; position: number },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  if (!Number.isFinite(input.position)) return { ok: false, error: "Posicao invalida" };

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const phases = await loadPhases(db, ctx.kanban.id);
  const target = phases.find((p) => p.id === input.phaseId);
  if (!target) return { ok: false, error: "Fase nao encontrada" };
  const card = await loadCard(db, ctx.kanban.id, input.cardId);
  if (!card) return { ok: false, error: "Card nao encontrado" };

  const { data, error } = await db
    .t("kanban_cards")
    .update({ phase_id: target.id, position: input.position })
    .eq("id", card.id)
    .eq("kanban_id", ctx.kanban.id)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  if (card.phase_id !== target.id) {
    const from = phases.find((p) => p.id === card.phase_id);
    await audit({
      workspaceId: ctx.workspace.id,
      entity: "kanban_card",
      entityId: card.id,
      action: "move",
      changes: {
        before: { name: card.title, phase: from?.name ?? null },
        after: { name: card.title, phase: target.name },
      },
      context: ctxAudit(ctx),
    });
  }

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function deleteKanbanCard(
  input: KanbanScope & { cardId: string },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const card = await loadCard(db, ctx.kanban.id, input.cardId);
  if (!card) return { ok: false, error: "Card nao encontrado" };

  const { data, error } = await db
    .t("kanban_cards")
    .delete()
    .eq("id", card.id)
    .eq("kanban_id", ctx.kanban.id)
    .select();
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "kanban_card",
    entityId: card.id,
    action: "delete",
    changes: { before: { name: card.title } },
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

export async function setKanbanCardResponsibles(
  input: KanbanScope & { cardId: string; userIds: string[] },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const wanted = Array.from(new Set(input.userIds.filter(Boolean)));
  if (wanted.length > MAX_RESPONSIBLES) {
    return { ok: false, error: `Maximo de ${MAX_RESPONSIBLES} responsaveis` };
  }

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const card = await loadCard(db, ctx.kanban.id, input.cardId);
  if (!card) return { ok: false, error: "Card nao encontrado" };

  const { data: curData } = await db
    .t("kanban_card_responsibles")
    .select("user_id")
    .eq("card_id", card.id);
  const current = ((curData ?? []) as { user_id: string }[]).map((r) => r.user_id);
  const toAdd = wanted.filter((u) => !current.includes(u));
  const toRemove = current.filter((u) => !wanted.includes(u));

  if (toAdd.length) {
    const { error } = await db
      .t("kanban_card_responsibles")
      .insert(toAdd.map((u) => ({ card_id: card.id, user_id: u, assigned_by: db.userId })));
    if (error) return { ok: false, error: error.message };
  }
  if (toRemove.length) {
    const { data, error } = await db
      .t("kanban_card_responsibles")
      .delete()
      .eq("card_id", card.id)
      .in("user_id", toRemove)
      .select();
    if (error) return { ok: false, error: error.message };
    if ((data ?? []).length !== toRemove.length) return { ok: false, error: "Sem permissao" };
  }

  if (toAdd.length || toRemove.length) {
    await audit({
      workspaceId: ctx.workspace.id,
      entity: "kanban_card",
      entityId: card.id,
      action: "assign",
      changes: {
        before: { responsaveis: current.length },
        after: { responsaveis: wanted.length },
      },
      context: ctxAudit(ctx),
    });
  }

  revalidateKanban(input);
  return { ok: true, data: undefined };
}

// ============================================================================
// Comentarios do card
// ============================================================================

export async function addKanbanCardComment(
  input: KanbanScope & { cardId: string; content: string },
): Promise<ActionResult<{ commentId: string }>> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const content = input.content.trim();
  if (!content) return { ok: false, error: "Comentario vazio" };
  if (content.length > 5000) return { ok: false, error: "Comentario muito longo" };

  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const card = await loadCard(db, ctx.kanban.id, input.cardId);
  if (!card) return { ok: false, error: "Card nao encontrado" };

  const { data, error } = await db
    .t("kanban_card_comments")
    .insert({ card_id: card.id, author_id: db.userId, content })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };
  const commentId = (data as { id: string }).id;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "comment",
    entityId: commentId,
    action: "create",
    changes: { after: { content_preview: content.slice(0, 80) } },
    context: { ...ctxAudit(ctx), card_id: card.id, card_title: card.title },
  });

  revalidateKanban(input);
  return { ok: true, data: { commentId } };
}

export async function deleteKanbanCardComment(
  input: KanbanScope & { commentId: string },
): Promise<ActionResult> {
  const db = await getDb();
  if (!db.userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveKanban(db, input);
  if (!ctx.ok) return ctx;
  const { data: cmt } = await db
    .t("kanban_card_comments")
    .select("card_id")
    .eq("id", input.commentId)
    .maybeSingle();
  const cardId = (cmt as { card_id?: string } | null)?.card_id;
  if (!cardId || !(await loadCard(db, ctx.kanban.id, cardId))) {
    return { ok: false, error: "Comentario nao encontrado" };
  }

  const { data, error } = await db
    .t("kanban_card_comments")
    .delete()
    .eq("id", input.commentId)
    .select();
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "comment",
    entityId: input.commentId,
    action: "delete",
    changes: {},
    context: ctxAudit(ctx),
  });

  revalidateKanban(input);
  return { ok: true, data: undefined };
}
