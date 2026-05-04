"use client";

import { useEffect } from "react";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";
import {
  ensureChannel,
  requestNotificationPermission,
  schedulePhaseReminder,
} from "@/lib/local-notifications";

interface Props {
  userId: string;
  workspaceSlug: string;
  workspaceMemberId: string;
  role: "admin" | "diretor" | "membro";
}

interface PhaseRow {
  id: string;
  name: string;
  due_date: string | null;
  completed_at: string | null;
  flow_id: string;
}

interface FlowRow {
  id: string;
  name: string;
  project_id: string;
}

interface ProjectRow {
  id: string;
  name: string;
  directory_id: string;
  responsible_user_id: string | null;
}

interface DirectoryRow {
  id: string;
  slug: string;
}

/**
 * Sincroniza notificacoes locais (Capacitor) com as fases ativas que o
 * user logado tem direito a receber, seguindo a regra:
 *
 * - **Admin**: TODAS as fases do workspace (independente de diretoria/projeto).
 * - **Diretor**: SO fases dos projetos onde ele eh `responsible_user_id`.
 * - **Membro**: fases dos projetos das diretorias liberadas pra ele
 *   (via `member_directory_access`); sem restricao = todas.
 *
 * Web/Desktop: nao faz nada (Capacitor.isNativePlatform retorna false).
 */
export function LocalNotificationsSync({
  userId,
  workspaceSlug,
  workspaceMemberId,
  role,
}: Props) {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await ensureChannel();
        const granted = await requestNotificationPermission();
        if (!granted || cancelled) return;

        const supabase = createSupabaseBrowserClient();

        // Workspace
        const { data: ws } = await supabase
          .from("workspaces")
          .select("id")
          .eq("slug", workspaceSlug)
          .maybeSingle();
        if (!ws || cancelled) return;
        const workspaceId = (ws as { id: string }).id;

        // Diretorias
        const { data: dirs } = await supabase
          .from("directories")
          .select("id, slug")
          .eq("workspace_id", workspaceId);
        const directories = (dirs ?? []) as DirectoryRow[];
        const dirById = new Map(directories.map((d) => [d.id, d]));
        if (cancelled) return;

        // Projects ativos do workspace
        const { data: projs } = await supabase
          .from("projects")
          .select("id, name, directory_id, responsible_user_id")
          .in(
            "directory_id",
            directories.map((d) => d.id),
          )
          .eq("status", "active");
        const projects = (projs ?? []) as ProjectRow[];
        if (cancelled || projects.length === 0) return;

        // Determina quais project_ids o user recebe notif, conforme regra:
        let allowedProjectIds: Set<string>;

        if (role === "admin") {
          // Admin: tudo
          allowedProjectIds = new Set(projects.map((p) => p.id));
        } else if (role === "diretor") {
          // Diretor: so projetos onde eh responsavel
          allowedProjectIds = new Set(
            projects
              .filter((p) => p.responsible_user_id === userId)
              .map((p) => p.id),
          );
        } else {
          // Membro: projetos das diretorias liberadas (ou todas se sem restricao)
          const { data: dirAccess } = await supabase
            .from("member_directory_access")
            .select("directory_id")
            .eq("workspace_member_id", workspaceMemberId);
          const accessRows = (dirAccess ?? []) as Array<{ directory_id: string }>;
          const visibleDirIds = accessRows.length
            ? new Set(accessRows.map((r) => r.directory_id))
            : null; // null = sem restricao = todas

          allowedProjectIds = new Set(
            projects
              .filter(
                (p) =>
                  visibleDirIds === null || visibleDirIds.has(p.directory_id),
              )
              .map((p) => p.id),
          );
        }

        if (cancelled || allowedProjectIds.size === 0) return;

        const projById = new Map(projects.map((p) => [p.id, p]));

        // Flows ativos dos projetos permitidos
        const allowedProjArr = Array.from(allowedProjectIds);
        const { data: flws } = await supabase
          .from("flows")
          .select("id, name, project_id")
          .in("project_id", allowedProjArr)
          .eq("status", "active");
        const flows = (flws ?? []) as FlowRow[];
        const flowById = new Map(flows.map((f) => [f.id, f]));
        if (cancelled || flows.length === 0) return;

        // Fases nao concluidas com due_date
        const { data: phs } = await supabase
          .from("phases")
          .select("id, name, due_date, completed_at, flow_id")
          .in(
            "flow_id",
            flows.map((f) => f.id),
          )
          .is("completed_at", null)
          .not("due_date", "is", null);
        const phases = (phs ?? []) as PhaseRow[];
        if (cancelled) return;

        // Agenda
        for (const p of phases) {
          if (cancelled) break;
          const flow = flowById.get(p.flow_id);
          if (!flow) continue;
          const project = projById.get(flow.project_id);
          if (!project) continue;
          const dir = dirById.get(project.directory_id);
          if (!dir) continue;

          await schedulePhaseReminder(
            {
              id: p.id,
              name: p.name,
              due_date: p.due_date,
              completed_at: p.completed_at,
            },
            {
              flowName: flow.name,
              projectName: project.name,
              workspaceSlug,
              directorySlug: dir.slug,
              projectId: project.id,
              flowId: flow.id,
            },
          );
        }
      } catch (e) {
        console.warn("[local-notif-sync] erro:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, workspaceSlug, workspaceMemberId, role]);

  return null;
}
