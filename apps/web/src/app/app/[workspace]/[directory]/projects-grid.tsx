"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderProjects } from "@/lib/actions/projects";
import { MemberAvatar } from "@/components/member-avatar";
import type { ProjectRow, WorkspaceMemberRow } from "@/lib/types";

type MemberLite = Pick<
  WorkspaceMemberRow,
  "user_id" | "google_full_name" | "google_avatar_url" | "role" | "status"
>;

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projects: ProjectRow[];
  membersByUserId: Record<string, MemberLite>;
  overdueByProjectId?: Record<string, number>;
  canReorder: boolean;
}

export function ProjectsGrid({
  workspaceSlug,
  directorySlug,
  projects: initialProjects,
  membersByUserId,
  overdueByProjectId,
  canReorder,
}: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    setProjects(initialProjects);
  }, [initialProjects]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = projects.findIndex((p) => p.id === active.id);
    const newIndex = projects.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(projects, oldIndex, newIndex);
    setProjects(reordered);
    start(async () => {
      const r = await reorderProjects({
        workspaceSlug,
        directorySlug,
        projectIds: reordered.map((p) => p.id),
      });
      if (!r.ok) {
        setError(r.error);
        setProjects(initialProjects);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {canReorder ? (
        <p className="text-xs text-slate-500">
          Arraste pelo cabecalho de cada card pra reordenar os projetos.
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={canReorder ? handleDragEnd : undefined}
      >
        <SortableContext
          items={projects.map((p) => p.id)}
          strategy={rectSortingStrategy}
        >
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <SortableProjectCard
                key={p.id}
                project={p}
                workspaceSlug={workspaceSlug}
                directorySlug={directorySlug}
                membersByUserId={membersByUserId}
                overdueCount={overdueByProjectId?.[p.id] ?? 0}
                canReorder={canReorder}
                pending={pending}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableProjectCard({
  project,
  workspaceSlug,
  directorySlug,
  membersByUserId,
  overdueCount,
  canReorder,
  pending,
}: {
  project: ProjectRow;
  workspaceSlug: string;
  directorySlug: string;
  membersByUserId: Record<string, MemberLite>;
  overdueCount: number;
  canReorder: boolean;
  pending: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id, disabled: !canReorder });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const responsible = project.responsible_user_id
    ? membersByUserId[project.responsible_user_id]
    : null;
  const creator = membersByUserId[project.created_by];

  const overdueLabel =
    overdueCount > 0
      ? `${overdueCount} pendencia${overdueCount > 1 ? "s" : ""} vencida${overdueCount > 1 ? "s" : ""}`
      : null;

  return (
    <li ref={setNodeRef} style={style} className="relative">
      {overdueCount > 0 ? (
        <span
          aria-hidden="true"
          title={overdueLabel ?? undefined}
          className="pointer-events-none absolute -right-1 -top-1 z-10 grid min-h-[20px] min-w-[20px] place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white shadow"
        >
          {overdueCount > 99 ? "99+" : overdueCount}
        </span>
      ) : null}
      <div
        className={`flex h-full flex-col rounded-2xl border border-slate-200 bg-white transition hover:border-slate-300 hover:shadow-md ${
          isDragging ? "ring-2 ring-slate-400" : ""
        }`}
      >
        {canReorder ? (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab rounded-t-2xl border-b border-slate-100 bg-slate-50 py-1.5 text-center text-base text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
            title="Arraste pra reordenar"
          >
            ⋮⋮
          </div>
        ) : null}
        <Link
          href={`/app/${workspaceSlug}/${directorySlug}/${project.id}`}
          className="flex flex-1 flex-col p-5"
          onClick={(e) => {
            // se estiver arrastando, evita navegacao
            if (pending && canReorder) e.preventDefault();
          }}
        >
          {overdueLabel ? <span className="sr-only">{overdueLabel}. </span> : null}
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900">
              {project.name}
            </h3>
            {project.status === "archived" ? (
              <StatusBadge label="Arquivado" tone="slate" />
            ) : project.status === "completed" ? (
              <StatusBadge label="Concluido" tone="green" />
            ) : null}
          </div>
          {project.description ? (
            <p className="mt-1 line-clamp-2 text-sm text-slate-500">
              {project.description}
            </p>
          ) : null}
          <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              {responsible ? (
                <>
                  <MemberAvatar
                    name={responsible.google_full_name}
                    avatarUrl={responsible.google_avatar_url}
                    size="sm"
                  />
                  <span className="line-clamp-1">
                    {responsible.google_full_name}
                  </span>
                </>
              ) : (
                <span className="italic text-slate-400">Sem responsavel</span>
              )}
            </div>
            {creator ? (
              <span className="line-clamp-1 text-right">
                criado por {creator.google_full_name?.split(" ")[0]}
              </span>
            ) : null}
          </div>
        </Link>
      </div>
    </li>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "slate" | "green";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-emerald-100 text-emerald-700",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
