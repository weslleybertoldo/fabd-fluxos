"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@fabd-fluxos/db/server";
import { audit } from "./audit";
import type {
  DirectoryRow,
  FieldMode,
  FieldType,
  FlowRow,
  PhaseFieldRow,
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
    upsert(
      values: Record<string, unknown>,
      opts?: { onConflict?: string },
    ): {
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

async function resolvePhase(
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
    .maybeSingle();
  const phase = ph as unknown as PhaseRow | null;
  if (!phase) return { ok: false, error: "Fase nao encontrada" };

  return { ok: true, workspace, directory, project, flow, phase };
}

export async function createPhaseField(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  label: string;
  type: FieldType;
  mode: FieldMode;
  required?: boolean;
}): Promise<ActionResult<{ fieldId: string }>> {
  const { sb, supabase, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const label = input.label.trim();
  if (!label) return { ok: false, error: "Label obrigatorio" };
  if (label.length > 200) return { ok: false, error: "Label muito longo" };

  const ctx = await resolvePhase(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
    input.phaseId,
  );
  if (!ctx.ok) return ctx;

  // pegar order_index proximo
  const { data: maxData } = await supabase
    .from("phase_fields")
    .select("order_index")
    .eq("phase_id", ctx.phase.id)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder =
    ((maxData as unknown as { order_index?: number } | null)?.order_index ?? -1) + 1;

  const { data, error } = await sb
    .from("phase_fields")
    .insert({
      phase_id: ctx.phase.id,
      type: input.type,
      label,
      mode: input.mode,
      order_index: nextOrder,
      required: input.required ?? false,
      created_by: userId,
    })
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Sem permissao pra criar campo" };

  const f = data as unknown as PhaseFieldRow;

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "field",
    entityId: f.id,
    action: "create",
    changes: { after: { label: f.label, type: f.type, mode: f.mode } },
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
  return { ok: true, data: { fieldId: f.id } };
}

export async function deletePhaseField(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  fieldId: string;
}): Promise<ActionResult> {
  const { sb } = await getDb();

  const ctx = await resolvePhase(
    input.workspaceSlug,
    input.directorySlug,
    input.projectId,
    input.flowId,
    input.phaseId,
  );
  if (!ctx.ok) return ctx;

  const { error } = await sb
    .from("phase_fields")
    .delete()
    .eq("id", input.fieldId);
  if (error) return { ok: false, error: error.message };

  await audit({
    workspaceId: ctx.workspace.id,
    entity: "field",
    entityId: input.fieldId,
    action: "delete",
    changes: {},
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

/** Upsert de valor (qualquer membro pode preencher). */
export async function setFieldValue(input: {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string; // current_phase_id (onde o valor vive agora)
  fieldId: string;
  value: {
    text?: string | null;
    bool?: boolean | null;
    number?: number | null;
    date?: string | null;
  };
}): Promise<ActionResult> {
  const { sb, userId } = await getDb();
  if (!userId) return { ok: false, error: "Nao autenticado" };

  const { error } = await sb
    .from("phase_field_values")
    .upsert(
      {
        phase_field_id: input.fieldId,
        current_phase_id: input.phaseId,
        value_text: input.value.text ?? null,
        value_bool: input.value.bool ?? null,
        value_number: input.value.number ?? null,
        value_date: input.value.date ?? null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phase_field_id,current_phase_id" },
    )
    .select()
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  revalidatePath(
    `/app/${input.workspaceSlug}/${input.directorySlug}/${input.projectId}/${input.flowId}`,
  );
  return { ok: true, data: undefined };
}
