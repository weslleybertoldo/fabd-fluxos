"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import { notify } from "./notifications";
import type { ProjectRow, DirectoryRow, WorkspaceRow } from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Mesmo cast pragmatico usado em members.ts pra desbloquear tipagem v2.47.
type Sb = {
  from(table: string): {
    select(cols?: string): unknown;
    insert(values: Record<string, unknown>): {
      select(): {
        maybeSingle(): Promise<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
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
};

async function getDb() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return {
    supabase,
    sb: supabase as unknown as Sb,
    userId: user?.id ?? null,
  };
}

async function resolveDirectoryContext(
  workspaceSlug: string,
  directorySlug: string,
): Promise<
  | {
      ok: true;
      workspace: WorkspaceRow;
      directory: DirectoryRow;
    }
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

  return { ok: true, workspace, directory };
}

/** admin/diretor cria projeto na diretoria. */
export async function createProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  name: string;
  description?: string | null;
  responsibleUserId?: string | null;
}): Promise<ActionResult<{ projectId: string }>> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Nome obrigatorio" };
  if (name.length > 200) return { ok: false, error: "Nome muito longo (max 200)" };

  const ctx = await resolveDirectoryContext(input.workspaceSlug, input.directorySlug);
  if (!ctx.ok) return ctx;

  const { data, error } = await sb
    .from("projects")
    .insert({
      directory_id: ctx.directory.id,
      name,
      description: input.description?.trim() || null,
      responsible_user_id: input.responsibleUserId || null,
      status: "active",
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra criar projeto" };

  const project = data as unknown as ProjectRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "project",
    entityId: project.id,
    action: "create",
    changes: { after: { name: project.name, description: project.description } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: project.id,
      project_name: project.name,
    },
  });

  // Notifica responsavel se foi atribuido alguem
  if (project.responsible_user_id && project.responsible_user_id !== userId) {
    await notify({
      targetUserId: project.responsible_user_id,
      workspaceId: ctx.workspace.id,
      type: "responsible_assigned",
      title: `Voce foi designado como responsavel`,
      body: `Projeto "${project.name}" em ${ctx.directory.name}.`,
      entity: "project",
      entityId: project.id,
      link: `/app/${input.workspaceSlug}/${input.directorySlug}/${project.id}`,
    });
  }

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  return { ok: true, data: { projectId: project.id } };
}

/** Edita campos basicos do projeto (admin OU diretor que criou). */
export async function updateProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  name?: string;
  description?: string | null;
  responsibleUserId?: string | null;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveDirectoryContext(input.workspaceSlug, input.directorySlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("projects")
    .select("*")
    .eq("id", input.projectId)
    .maybeSingle();
  const beforeRow = before as unknown as ProjectRow | null;
  if (!beforeRow) return { ok: false, error: "Projeto nao encontrado" };

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Nome obrigatorio" };
    if (n.length > 200) return { ok: false, error: "Nome muito longo (max 200)" };
    patch.name = n;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.responsibleUserId !== undefined) {
    patch.responsible_user_id = input.responsibleUserId || null;
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await sb
    .from("projects")
    .update(patch)
    .eq("id", input.projectId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra editar este projeto" };

  const after = data as unknown as ProjectRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "project",
    entityId: input.projectId,
    action: "update",
    changes: {
      before: {
        name: beforeRow.name,
        description: beforeRow.description,
        responsible_user_id: beforeRow.responsible_user_id,
      },
      after: {
        name: after.name,
        description: after.description,
        responsible_user_id: after.responsible_user_id,
      },
    },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: input.projectId,
      project_name: after.name,
    },
  });

  // Notifica novo responsavel se mudou
  if (
    input.responsibleUserId !== undefined &&
    input.responsibleUserId !== beforeRow.responsible_user_id &&
    input.responsibleUserId
  ) {
    await notify({
      targetUserId: input.responsibleUserId,
      workspaceId: ctx.workspace.id,
      type: "responsible_assigned",
      title: `Voce foi designado como responsavel`,
      body: `Projeto "${after.name}" em ${ctx.directory.name}.`,
      entity: "project",
      entityId: input.projectId,
      link: `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`,
    });
  }

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}`);
  return { ok: true, data: undefined };
}

async function changeStatus(
  input: {
    workspaceSlug: string;
    directorySlug: string;
    projectId: string;
  },
  newStatus: "active" | "archived" | "completed",
  action: "archive" | "complete" | "reactivate",
): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveDirectoryContext(input.workspaceSlug, input.directorySlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("projects")
    .select("*")
    .eq("id", input.projectId)
    .maybeSingle();
  const beforeRow = before as unknown as ProjectRow | null;
  if (!beforeRow) return { ok: false, error: "Projeto nao encontrado" };

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: newStatus,
    updated_at: now,
  };
  patch.archived_at = newStatus === "archived" ? now : null;
  patch.completed_at = newStatus === "completed" ? now : null;

  const { data, error } = await sb
    .from("projects")
    .update(patch)
    .eq("id", input.projectId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "project",
    entityId: input.projectId,
    action,
    changes: { before: { status: beforeRow.status }, after: { status: newStatus } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: input.projectId,
      project_name: beforeRow.name,
    },
  });

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  return { ok: true, data: undefined };
}

export async function archiveProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}): Promise<ActionResult> {
  return changeStatus(input, "archived", "archive");
}

export async function completeProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}): Promise<ActionResult> {
  return changeStatus(input, "completed", "complete");
}

export async function reactivateProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}): Promise<ActionResult> {
  return changeStatus(input, "active", "reactivate");
}

/**
 * Clona projeto via RPC SECURITY DEFINER. Copia projeto + flows + phases +
 * phase_fields (estrutura, sem values) + phase_responsibles + flow_tags.
 * NAO copia: comments, attachments, phase_field_values, reminders, simple_lists.
 * Novo projeto recebe nome "Cópia <nome original>" e status=active.
 */
export async function cloneProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
}): Promise<ActionResult<{ newProjectId: string }>> {
  const { supabase } = await getDb();

  const ctx = await resolveDirectoryContext(input.workspaceSlug, input.directorySlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("projects")
    .select("name")
    .eq("id", input.projectId)
    .maybeSingle();
  const beforeRow = before as unknown as { name: string } | null;
  if (!beforeRow) return { ok: false, error: "Projeto nao encontrado" };

  const { data, error } = await (
    supabase as unknown as {
      rpc(
        fn: string,
        args: Record<string, unknown>,
      ): Promise<{ data: string | null; error: { message: string } | null }>;
    }
  ).rpc("clone_project", { p_project_id: input.projectId });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Falha ao clonar projeto" };

  const newProjectId = data;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "project",
    entityId: newProjectId,
    action: "create",
    changes: {
      after: { cloned_from: input.projectId, name: `Cópia ${beforeRow.name}` },
    },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: newProjectId,
      project_name: `Cópia ${beforeRow.name}`,
      cloned_from_project_id: input.projectId,
    },
  });

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  return { ok: true, data: { newProjectId } };
}

/** Deletar = só admin. RLS bloqueia diretor. */
export async function deleteProject(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  redirectAfter?: boolean;
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const ctx = await resolveDirectoryContext(input.workspaceSlug, input.directorySlug);
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("projects")
    .select("*")
    .eq("id", input.projectId)
    .maybeSingle();
  const beforeRow = before as unknown as ProjectRow | null;
  if (!beforeRow) return { ok: false, error: "Projeto nao encontrado" };

  const { error } = await sb.from("projects").delete().eq("id", input.projectId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "project",
    entityId: input.projectId,
    action: "delete",
    changes: { before: { name: beforeRow.name, status: beforeRow.status } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: input.projectId,
      project_name: beforeRow.name,
    },
  });

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  if (input.redirectAfter) {
    redirect(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  }
  return { ok: true, data: undefined };
}

/**
 * Reordena projetos dentro de uma diretoria. Apenas admin reordena
 * (mesma regra de `reorderFlows` — diretor so reordena se for criador
 * de TODOS, caso raro; simplificacao = admin only).
 */
export async function reorderProjects(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectIds: string[];
}): Promise<ActionResult> {
  const { supabase, sb } = await getDb();

  const { data: ws } = await supabase
    .from("workspaces")
    .select("*")
    .eq("slug", input.workspaceSlug)
    .maybeSingle();
  const workspace = ws as unknown as WorkspaceRow | null;
  if (!workspace) return { ok: false, error: "Workspace nao encontrado" };

  const { data: dir } = await supabase
    .from("directories")
    .select("*")
    .eq("workspace_id", workspace.id)
    .eq("slug", input.directorySlug)
    .maybeSingle();
  const directory = dir as unknown as DirectoryRow | null;
  if (!directory) return { ok: false, error: "Diretoria nao encontrada" };

  // Valida ownership: todos projectIds devem pertencer a essa diretoria
  const { data: existingData } = await supabase
    .from("projects")
    .select("id")
    .eq("directory_id", directory.id)
    .in("id", input.projectIds);
  const existingIds = new Set(
    ((existingData ?? []) as Array<{ id: string }>).map((r) => r.id),
  );
  for (const id of input.projectIds) {
    if (!existingIds.has(id)) {
      return { ok: false, error: `Projeto ${id} nao pertence a essa diretoria` };
    }
  }

  for (let i = 0; i < input.projectIds.length; i++) {
    const id = input.projectIds[i];
    if (!id) continue;
    const { error } = await sb
      .from("projects")
      .update({ order_index: i, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (error) return { ok: false, error: `Reorder ${id}: ${error.message}` };
  }

  await audit({
    workspaceId: workspace.id,
    entity: "directory",
    entityId: directory.id,
    action: "reorder",
    changes: { after: { project_ids: input.projectIds } },
    context: {
      directory_id: directory.id,
      directory_slug: directory.slug,
      directory_name: directory.name,
    },
  });

  revalidatePath(`/app/${input.workspaceSlug}/${input.directorySlug}`);
  return { ok: true, data: undefined };
}
