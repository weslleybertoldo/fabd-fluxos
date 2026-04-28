"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  FlowRow,
  PhaseAttachmentRow,
  PhaseRow,
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

async function resolvePhaseContext(
  workspaceSlug: string,
  directorySlug: string,
  projectId: string,
  flowId: string,
  phaseId: string,
): Promise<
  | {
      ok: true;
      workspace: WorkspaceRow;
      directory: DirectoryRow;
      project: ProjectRow;
      flow: FlowRow;
      phase: PhaseRow;
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
    .maybeSingle();
  const project = prj as unknown as ProjectRow | null;
  if (!project) return { ok: false, error: "Projeto nao encontrado" };

  const { data: flw } = await supabase
    .from("flows")
    .select("*")
    .eq("id", flowId)
    .maybeSingle();
  const flow = flw as unknown as FlowRow | null;
  if (!flow) return { ok: false, error: "Fluxo nao encontrado" };

  const { data: ph } = await supabase
    .from("phases")
    .select("*")
    .eq("id", phaseId)
    .eq("flow_id", flow.id)
    .maybeSingle();
  const phase = ph as unknown as PhaseRow | null;
  if (!phase) return { ok: false, error: "Fase nao encontrada" };

  return { ok: true, workspace, directory, project, flow, phase };
}

/** Persiste metadado do anexo apos upload bem-sucedido no Storage. */
export async function recordAttachment(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
}): Promise<ActionResult<{ attachmentId: string }>> {
  const { sb, supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const ctx = await resolvePhaseContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
    input.phaseId,
  );
  if (!ctx.ok) return ctx;

  const { data, error } = await sb
    .from("phase_attachments")
    .insert({
      phase_id: ctx.phase.id,
      file_name: input.fileName,
      mime_type: input.mimeType,
      file_size: input.fileSize,
      storage_path: input.storagePath,
      storage_bucket: "attachments",
      uploaded_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) {
    // tentar limpar o arquivo do storage pra evitar orfao
    await supabase.storage.from("attachments").remove([input.storagePath]);
    return { ok: false, error: error.message };
  }
  if (!data) {
    await supabase.storage.from("attachments").remove([input.storagePath]);
    return { ok: false, error: "Sem permissao" };
  }

  const att = data as unknown as PhaseAttachmentRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "attachment",
    entityId: att.id,
    action: "create",
    changes: {
      after: { file_name: att.file_name, file_size: att.file_size, mime: att.mime_type },
    },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: ctx.flow.id,
      flow_name: ctx.flow.name,
      phase_id: ctx.phase.id,
      phase_name: ctx.phase.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: { attachmentId: att.id } };
}

export async function deleteAttachment(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  attachmentId: string;
}): Promise<ActionResult> {
  const { sb, supabase } = await getDb();

  const ctx = await resolvePhaseContext(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
    input.phaseId,
  );
  if (!ctx.ok) return ctx;

  const { data: before } = await supabase
    .from("phase_attachments")
    .select("*")
    .eq("id", input.attachmentId)
    .maybeSingle();
  const att = before as unknown as PhaseAttachmentRow | null;
  if (!att) return { ok: false, error: "Anexo nao encontrado" };

  // 1) deletar registro DB (RLS bloqueia se nao for autor nem editor da fase)
  const { error: delErr } = await sb
    .from("phase_attachments")
    .delete()
    .eq("id", input.attachmentId);
  if (delErr) return { ok: false, error: delErr.message };

  // 2) remover do storage (best-effort)
  await supabase.storage.from(att.storage_bucket).remove([att.storage_path]);

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "attachment",
    entityId: input.attachmentId,
    action: "delete",
    changes: { before: { file_name: att.file_name } },
    context: {
      directory_id: ctx.directory.id,
      directory_slug: ctx.directory.slug,
      directory_name: ctx.directory.name,
      project_id: ctx.project.id,
      project_name: ctx.project.name,
      flow_id: ctx.flow.id,
      flow_name: ctx.flow.name,
      phase_id: ctx.phase.id,
      phase_name: ctx.phase.name,
    },
  });

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}

/** Gera signed URL pra download (1h). */
export async function getAttachmentSignedUrl(input: {
  storagePath: string;
  storageBucket?: string;
}): Promise<ActionResult<{ url: string }>> {
  const { supabase } = await getDb();
  const { data, error } = await supabase.storage
    .from(input.storageBucket ?? "attachments")
    .createSignedUrl(input.storagePath, 3600);
  if (error || !data?.signedUrl) {
    return { ok: false, error: error?.message ?? "Sem permissao" };
  }
  return { ok: true, data: { url: data.signedUrl } };
}
