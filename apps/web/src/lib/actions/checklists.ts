"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  ChecklistKind,
  ChecklistItemRow,
  ChecklistRow,
  ChecklistSectionRow,
  DirectoryRow,
  ProjectRow,
  WorkspaceRow,
} from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

type SingleInsert = {
  insert(values: Record<string, unknown>): {
    select(): {
      maybeSingle(): Promise<{
        data: Record<string, unknown> | null;
        error: { message: string } | null;
      }>;
    };
  };
};
type BatchInsert = {
  insert(values: Record<string, unknown>[]): Promise<{
    error: { message: string } | null;
  }>;
};
type EqChain = {
  eq(col: string, val: string): EqChain;
  select(): {
    maybeSingle(): Promise<{
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    }>;
  };
};
type SimpleMutate = {
  update(values: Record<string, unknown>): EqChain;
  delete(): {
    eq(col: string, val: string): Promise<{ error: { message: string } | null }>;
  };
};

const MAX_SECTIONS = 50;
const MAX_ITEMS_PER_SECTION = 200;

async function getDb() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

async function resolveProject(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
): Promise<
  | { ok: true; workspace: WorkspaceRow; directory: DirectoryRow; project: ProjectRow }
  | { ok: false; error: string }
> {
  const { supabase } = await getDb();
  const { data: ws } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  const workspace = ws as unknown as WorkspaceRow | null;
  if (!workspace) return { ok: false, error: "Workspace nao encontrado" };

  const { data: dir } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", directorySlug)
    .maybeSingle();
  const directory = dir as unknown as DirectoryRow | null;
  if (!directory) return { ok: false, error: "Diretoria nao encontrada" };

  const { data: prj } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  return { ok: true, workspace, directory, project };
}

function ctxAudit(ctx: {
  directory: DirectoryRow;
  project: ProjectRow;
}) {
  return {
    directory_id: ctx.directory.id,
    directory_slug: ctx.directory.slug,
    directory_name: ctx.directory.name,
    project_id: ctx.project.id,
    project_name: ctx.project.name,
  };
}

function revalidateProject(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
) {
  revalidatePath(`/app/${workspaceSlug}/${directorySlug}/${projectId}`);
}

export type ChecklistSectionInput = {
  title: string;
  description?: string | null;
  items?: string[];
};

/**
 * Cria uma checklist com suas secoes e itens. `kind='simple'` => 1 secao;
 * `kind='flow'` => N secoes. Insere itens em batch por secao (1 revalidate).
 */
export async function createChecklist(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name: string;
  kind: ChecklistKind;
  sections: ChecklistSectionInput[];
}): Promise<ActionResult<{ checklistId: string }>> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo" };

  const kind: ChecklistKind = input.kind === "flow" ? "flow" : "simple";

  const sections = (input.sections ?? [])
    .map((s) => ({
      title: s.title.trim(),
      description: (s.description ?? "").trim() || null,
      items: (s.items ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, MAX_ITEMS_PER_SECTION),
    }))
    .filter((s) => s.title || s.items.length > 0)
    .slice(0, MAX_SECTIONS);

  if (sections.length === 0) {
    return { ok: false, error: "Adicione ao menos uma secao com titulo" };
  }
  for (const s of sections) {
    if (!s.title) return { ok: false, error: "Toda secao precisa de um titulo" };
    if (s.title.length > 200) return { ok: false, error: "Titulo de secao muito longo" };
    if (s.description && s.description.length > 2000) {
      return { ok: false, error: "Descricao de secao muito longa" };
    }
    if (s.items.some((t) => t.length > 1000)) {
      return { ok: false, error: "Item muito longo (max 1000 caracteres)" };
    }
  }

  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  // order_index num espaco compartilhado com flows (board unico) — nasce no fim.
  const [{ data: maxCl }, { data: maxFlow }] = await Promise.all([
    supabase
      .from("checklists")
      .select("order_index")
      .eq("project_id", ctx.project.id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("flows")
      .select("order_index")
      .eq("project_id", ctx.project.id)
      .order("order_index", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const nextOrder =
    Math.max(
      (maxCl as unknown as { order_index?: number } | null)?.order_index ?? -1,
      (maxFlow as unknown as { order_index?: number } | null)?.order_index ?? -1,
    ) + 1;

  const { data: clData, error: clErr } = await (
    supabase.from("checklists") as unknown as SingleInsert
  )
    .insert({
      project_id: ctx.project.id,
      name,
      kind,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (clErr) return { ok: false, error: clErr.message };
  if (!clData) return { ok: false, error: "Sem permissao" };
  const checklist = clData as unknown as ChecklistRow;

  // rollback best-effort: cascade limpa secoes/itens, evita checklist parcial
  const rollback = async () => {
    await (supabase.from("checklists") as unknown as SimpleMutate)
      .delete()
      .eq("id", checklist.id);
  };

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const { data: secData, error: secErr } = await (
      supabase.from("checklist_sections") as unknown as SingleInsert
    )
      .insert({
        checklist_id: checklist.id,
        title: sec.title,
        description: sec.description,
        order_index: i,
      })
      .select()
      .maybeSingle();
    if (secErr) {
      await rollback();
      return { ok: false, error: `Secao "${sec.title}": ${secErr.message}` };
    }
    if (!secData) {
      await rollback();
      return { ok: false, error: "Sem permissao" };
    }
    const section = secData as unknown as ChecklistSectionRow;

    if (sec.items.length) {
      const rows = sec.items.map((text, idx) => ({
        section_id: section.id,
        text,
        order_index: idx,
        created_by: userId,
      }));
      const { error: itemsErr } = await (
        supabase.from("checklist_items") as unknown as BatchInsert
      ).insert(rows);
      if (itemsErr) {
        await rollback();
        return {
          ok: false,
          error: `Falhou ao adicionar itens: ${itemsErr.message}`,
        };
      }
    }
  }

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "list_item",
    entityId: checklist.id,
    action: "create",
    changes: {
      after: { name: checklist.name, kind, sections: sections.length },
    },
    context: ctxAudit(ctx),
  });

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: { checklistId: checklist.id } };
}

/**
 * Reordena o board inteiro (fluxos + checklists na mesma ordem visual).
 * Reescreve order_index sequencial (0..N-1) num espaco compartilhado entre as
 * duas tabelas, na ordem recebida.
 */
type BoardColumn =
  | { type: "flow"; id: string }
  | { type: "stack"; checklistIds: string[] };

/**
 * Reordena o board (colunas horizontais). Cada coluna e um fluxo OU uma pilha de
 * checklists empilhadas. order_index = posicao horizontal da coluna; pras pilhas,
 * stack_id agrupa as checklists e stack_pos ordena verticalmente.
 */
export async function reorderBoard(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  columns: BoardColumn[];
}): Promise<ActionResult> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };
  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;
  if (ctx.project.directory_id !== ctx.directory.id) {
    return { ok: false, error: "Projeto nao pertence a diretoria" };
  }

  for (let i = 0; i < input.columns.length; i++) {
    const col = input.columns[i]!;
    if (col.type === "flow") {
      const { error } = await (supabase.from("flows") as unknown as SimpleMutate)
        .update({ order_index: i })
        .eq("id", col.id)
        .eq("project_id", ctx.project.id)
        .select()
        .maybeSingle();
      if (error) return { ok: false, error: `Reorder ${col.id}: ${error.message}` };
    } else {
      const stackId = col.checklistIds[0];
      for (let j = 0; j < col.checklistIds.length; j++) {
        const { error } = await (supabase.from("checklists") as unknown as SimpleMutate)
          .update({ order_index: i, stack_id: stackId, stack_pos: j })
          .eq("id", col.checklistIds[j]!)
          .eq("project_id", ctx.project.id)
          .select()
          .maybeSingle();
        if (error) return { ok: false, error: `Reorder ${col.checklistIds[j]}: ${error.message}` };
      }
    }
  }

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}

export async function deleteChecklist(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  checklistId: string;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  const ctx = await resolveProject(input.workspaceSlug, input.directorySlug, input.projectId);
  if (!ctx.ok) return ctx;

  const { error } = await (supabase.from("checklists") as unknown as SimpleMutate)
    .delete()
    .eq("id", input.checklistId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "list_item",
    entityId: input.checklistId,
    action: "delete",
    changes: { before: { kind: "checklist" } },
    context: ctxAudit(ctx),
  });

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}

export async function addChecklistSection(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  checklistId: string;
  title: string;
  description?: string | null;
}): Promise<ActionResult<{ sectionId: string }>> {
  const { supabase } = await getDb();
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Titulo obrigatorio" };
  if (title.length > 200) return { ok: false, error: "Titulo muito longo" };
  const description = (input.description ?? "").trim() || null;
  if (description && description.length > 2000) {
    return { ok: false, error: "Descricao muito longa" };
  }

  const { data: maxData } = await supabase
    .from("checklist_sections")
    .select("order_index")
    .eq("checklist_id", input.checklistId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await (
    supabase.from("checklist_sections") as unknown as SingleInsert
  )
    .insert({
      checklist_id: input.checklistId,
      title,
      description,
      order_index: nextOrder,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: { sectionId: (data as unknown as ChecklistSectionRow).id } };
}

export async function deleteChecklistSection(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  sectionId: string;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  const { error } = await (supabase.from("checklist_sections") as unknown as SimpleMutate)
    .delete()
    .eq("id", input.sectionId);
  if (error) return { ok: false, error: error.message };
  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}

export async function addChecklistItem(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  sectionId: string;
  text: string;
}): Promise<ActionResult<{ itemId: string }>> {
  const { supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };
  const text = input.text.trim();
  if (!text) return { ok: false, error: "Texto vazio" };
  if (text.length > 1000) return { ok: false, error: "Texto muito longo" };

  const { data: maxData } = await supabase
    .from("checklist_items")
    .select("order_index")
    .eq("section_id", input.sectionId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await (
    supabase.from("checklist_items") as unknown as SingleInsert
  )
    .insert({
      section_id: input.sectionId,
      text,
      order_index: nextOrder,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: { itemId: (data as unknown as ChecklistItemRow).id } };
}

export async function setChecklistItemCompleted(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  itemId: string;
  completed: boolean;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  const { error } = await (supabase.from("checklist_items") as unknown as SimpleMutate)
    .update({ completed_at: input.completed ? new Date().toISOString() : null })
    .eq("id", input.itemId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}

// Atualiza observacao e/ou config de lembrete de um item. reminderRecurrence
// null remove o lembrete. Zera os marcadores de disparo pra valer o novo horario.
export async function updateChecklistItem(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  itemId: string;
  note: string | null;
  tags?: string[];
  reminderRecurrence: "once" | "daily" | null;
  reminderAt: string | null;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  const rec =
    input.reminderRecurrence === "once" || input.reminderRecurrence === "daily"
      ? input.reminderRecurrence
      : null;
  if (rec && !input.reminderAt) {
    return { ok: false, error: "Informe o horario do lembrete" };
  }
  const note = (input.note ?? "").trim() || null;
  if (note && note.length > 2000) return { ok: false, error: "Observacao muito longa" };
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 20);

  const { error } = await (supabase.from("checklist_items") as unknown as SimpleMutate)
    .update({
      note,
      tags,
      reminder_recurrence: rec,
      reminder_at: rec ? input.reminderAt : null,
      reminder_notified_at: null,
      reminder_last_on: null,
    })
    .eq("id", input.itemId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}

export async function deleteChecklistItem(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  itemId: string;
}): Promise<ActionResult> {
  const { supabase } = await getDb();
  const { error } = await (supabase.from("checklist_items") as unknown as SimpleMutate)
    .delete()
    .eq("id", input.itemId);
  if (error) return { ok: false, error: error.message };
  revalidateProject(input.workspaceSlug, input.directorySlug, input.projectId);
  return { ok: true, data: undefined };
}
