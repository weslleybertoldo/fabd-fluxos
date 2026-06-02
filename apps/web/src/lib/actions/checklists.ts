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
type SimpleMutate = {
  update(values: Record<string, unknown>): {
    eq(col: string, val: string): {
      select(): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
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

  const { data: maxData } = await supabase
    .from("checklists")
    .select("order_index")
    .eq("project_id", ctx.project.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

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
    if (secErr) return { ok: false, error: `Secao "${sec.title}": ${secErr.message}` };
    if (!secData) return { ok: false, error: "Sem permissao" };
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
        return {
          ok: false,
          error: `Checklist criada, mas falhou ao adicionar itens: ${itemsErr.message}`,
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
