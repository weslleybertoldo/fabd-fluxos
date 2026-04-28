"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  FlowCommentRow,
  FlowRow,
  ProjectRow,
  WorkspaceRow,
} from "../types";

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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

async function resolveFlow(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
  flowId: string,
): Promise<
  | {
      ok: true;
      workspace: WorkspaceRow;
      directory: DirectoryRow;
      project: ProjectRow;
      flow: FlowRow;
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

  const { data: prj } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("directory_id", directory.id)
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  const { data: flw } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .eq("project_id", project.id)
    .maybeSingle();
  const flow = flw as unknown as FlowRow | null;
  if (!flow) return { ok: false, error: "Fluxo nao encontrado" };

  return { ok: true, workspace, directory, project, flow };
}

function pathContext(ctx: {
  workspace: WorkspaceRow;
  directory: DirectoryRow;
  project: ProjectRow;
  flow: FlowRow;
}) {
  return {
    directory_id: ctx.directory.id,
    directory_slug: ctx.directory.slug,
    directory_name: ctx.directory.name,
    project_id: ctx.project.id,
    project_name: ctx.project.name,
    flow_id: ctx.flow.id,
    flow_name: ctx.flow.name,
  };
}

export async function createComment(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  content: string;
  contextPhaseId?: string | null;
}): Promise<ActionResult<{ commentId: string }>> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const content = input.content.trim();
  if (!content) return { ok: false, error: "Comentario vazio" };
  if (content.length > 5000) return { ok: false, error: "Comentario muito longo" };

  const ctx = await resolveFlow(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const { data, error } = await sb
    .from("flow_comments")
    .insert({
      flow_id: ctx.flow.id,
      author_id: userId,
      content,
      context_phase_id: input.contextPhaseId || null,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao" };

  const c = data as unknown as FlowCommentRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "comment",
    entityId: c.id,
    action: "create",
    changes: { after: { content_preview: content.slice(0, 80) } },
    context: { ...pathContext(ctx) },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: { commentId: c.id } };
}

export async function updateComment(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  commentId: string;
  content: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveFlow(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  const content = input.content.trim();
  if (!content) return { ok: false, error: "Comentario vazio" };
  if (content.length > 5000) return { ok: false, error: "Comentario muito longo" };

  const { data, error } = await sb
    .from("flow_comments")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", input.commentId)
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao (so o autor edita)" };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "comment",
    entityId: input.commentId,
    action: "update",
    changes: { after: { content_preview: content.slice(0, 80) } },
    context: { ...pathContext(ctx) },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

export async function deleteComment(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  commentId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolveFlow(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
  );
  if (!ctx.ok) return ctx;

  // Hard delete — policy cmt_delete_self permite autor OU admin do workspace.
  // Audit_log preserva o registro mesmo apos o delete.
  const { error } = await sb
    .from("flow_comments")
    .delete()
    .eq("id", input.commentId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "comment",
    entityId: input.commentId,
    action: "delete",
    changes: {},
    context: { ...pathContext(ctx) },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}
