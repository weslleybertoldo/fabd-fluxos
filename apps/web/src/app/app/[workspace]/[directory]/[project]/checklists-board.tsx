"use client";

import { useEffect, useState, useTransition } from "react";
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
import { reorderChecklists } from "@/lib/actions/checklists";
import { ChecklistColumn } from "./checklist-column";
import type { ChecklistItemRow, ChecklistRow, ChecklistSectionRow } from "@/lib/types";

interface Props {
  id?: string;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  checklists: ChecklistRow[];
  sectionsByChecklist: Record<string, ChecklistSectionRow[]>;
  itemsBySection: Record<string, ChecklistItemRow[]>;
  canEdit: boolean; // base: projeto ativo && admin/diretor
  isAdmin: boolean;
  currentUserId: string;
}

export function ChecklistsBoard({
  id,
  workspaceSlug,
  directorySlug,
  projectId,
  checklists,
  sectionsByChecklist,
  itemsBySection,
  canEdit,
  isAdmin,
  currentUserId,
}: Props) {
  const router = useRouter();
  const [list, setList] = useState<ChecklistRow[]>(checklists);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const canReorder = canEdit;

  useEffect(() => {
    setList(checklists);
  }, [checklists]);

  if (checklists.length === 0) return null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = list.findIndex((c) => c.id === active.id);
    const newIndex = list.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(list, oldIndex, newIndex);
    setList(reordered);
    start(async () => {
      const r = await reorderChecklists({
        workspaceSlug,
        directorySlug,
        projectId,
        checklistIds: reordered.map((c) => c.id),
      });
      if (!r.ok) {
        setError(r.error);
        setList(checklists);
        return;
      }
      router.refresh();
    });
  }

  return (
    <section id={id} className="space-y-3 scroll-mt-4">
      <h2 className="text-lg font-semibold text-slate-900">Checklists</h2>
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}
      {canReorder ? (
        <p className="text-xs text-slate-500">
          Arraste pelo cabecalho pra reordenar (pode empilhar uma abaixo da outra).
        </p>
      ) : null}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={canReorder ? handleDragEnd : undefined}
      >
        <SortableContext items={list.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((cl) => (
              <SortableChecklistCell
                key={cl.id}
                checklist={cl}
                sections={sectionsByChecklist[cl.id] ?? []}
                itemsBySection={itemsBySection}
                workspaceSlug={workspaceSlug}
                directorySlug={directorySlug}
                projectId={projectId}
                canEdit={canEdit && (isAdmin || cl.created_by === currentUserId)}
                canReorder={canReorder}
                pending={pending}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}

function SortableChecklistCell(props: {
  checklist: ChecklistRow;
  sections: ChecklistSectionRow[];
  itemsBySection: Record<string, ChecklistItemRow[]>;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  canEdit: boolean;
  canReorder: boolean;
  pending: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.checklist.id, disabled: !props.canReorder || props.pending });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <ChecklistColumn
      checklist={props.checklist}
      sections={props.sections}
      itemsBySection={props.itemsBySection}
      workspaceSlug={props.workspaceSlug}
      directorySlug={props.directorySlug}
      projectId={props.projectId}
      canEdit={props.canEdit}
      canReorder={props.canReorder}
      dragRef={setNodeRef}
      dragStyle={style}
      dragHandle={{
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown> | undefined,
      }}
    />
  );
}
