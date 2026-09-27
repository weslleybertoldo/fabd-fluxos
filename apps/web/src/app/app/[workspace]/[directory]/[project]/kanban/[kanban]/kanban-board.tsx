"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MemberAvatar } from "@/components/member-avatar";
import {
  addKanbanPhase,
  createKanbanCard,
  deleteKanbanPhase,
  moveKanbanCard,
  moveKanbanPhase,
  renameKanbanPhase,
} from "@/lib/actions/kanbans";
import { KanbanCardModal } from "./kanban-card-modal";
import type {
  KanbanCardCommentRow,
  KanbanCardLink,
  KanbanCardRow,
  KanbanPhaseRow,
  KanbanRow,
  WorkspaceMemberRow,
} from "@/lib/types";

type MemberLite = Pick<WorkspaceMemberRow, "user_id" | "google_full_name" | "google_avatar_url">;
type Items = Record<string, KanbanCardRow[]>; // phaseId -> cards em ordem

const STEP = 1024;
const PHASE_PREFIX = "phase:";

function buildItems(phases: KanbanPhaseRow[], cards: KanbanCardRow[]): Items {
  const items: Items = Object.fromEntries(phases.map((p) => [p.id, [] as KanbanCardRow[]]));
  for (const c of [...cards].sort((a, b) => a.position - b.position)) {
    (items[c.phase_id] ??= []).push(c);
  }
  return items;
}

// `list` = cards da fase destino SEM o card movido; `index` = onde ele entra.
function positionAt(list: KanbanCardRow[], index: number): number {
  const prev = list[index - 1];
  const next = list[index];
  if (!prev && !next) return 0;
  if (!prev) return next!.position - STEP;
  if (!next) return prev.position + STEP;
  return (prev.position + next.position) / 2;
}

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  kanban: KanbanRow;
  phases: KanbanPhaseRow[];
  cards: KanbanCardRow[];
  responsiblesByCard: Record<string, string[]>;
  commentsByCard: Record<string, KanbanCardCommentRow[]>;
  members: MemberLite[];
  currentUserId: string;
  currentUserRole: string;
  canEditKanban: boolean;
  availableTags: string[];
  tagColors: Record<string, string>;
  initialOpenCardId: string | null;
  originByCard?: Record<string, KanbanCardLink | null>;
  generatedByCard?: Record<string, KanbanCardLink[]>;
}

export function KanbanBoard({
  workspaceSlug,
  directorySlug,
  projectId,
  kanban,
  phases,
  cards,
  responsiblesByCard,
  commentsByCard,
  members,
  currentUserId,
  currentUserRole,
  canEditKanban,
  availableTags,
  tagColors,
  initialOpenCardId,
  originByCard = {},
  generatedByCard = {},
}: Props) {
  const router = useRouter();
  const scope = { workspaceSlug, directorySlug, projectId, kanbanId: kanban.id };
  const [items, setItems] = useState<Items>(() => buildItems(phases, cards));
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(() =>
    initialOpenCardId && cards.some((c) => c.id === initialOpenCardId) ? initialOpenCardId : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dragOrigin = useRef<{ phaseId: string; index: number; snapshot: Items } | null>(null);

  // Realtime / router.refresh trazem props novas: servidor e a verdade.
  // (Sem KeyboardSensor: o Enter no card abre o modal; mover pelo teclado = campo "Fase" do modal.)
  useEffect(() => {
    setItems(buildItems(phases, cards));
  }, [phases, cards]);

  const memberById = new Map(members.map((m) => [m.user_id, m]));
  const lastPhaseId = phases.length > 1 ? phases[phases.length - 1]!.id : null;
  const isAdmin = currentUserRole === "admin";

  function isResponsible(cardId: string) {
    return (responsiblesByCard[cardId] ?? []).includes(currentUserId);
  }
  function canEditCard(card: KanbanCardRow) {
    return canEditKanban || isResponsible(card.id);
  }
  function canComment(card: KanbanCardRow) {
    return isAdmin || currentUserRole === "diretor" || isResponsible(card.id);
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function findContainer(id: string): string | undefined {
    if (id.startsWith(PHASE_PREFIX)) return id.slice(PHASE_PREFIX.length);
    return Object.keys(items).find((phaseId) => items[phaseId]!.some((c) => c.id === id));
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    start(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error);
        setItems(buildItems(phases, cards));
        return;
      }
      router.refresh();
    });
  }

  function handleDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const phaseId = findContainer(id);
    if (!phaseId) return;
    dragOrigin.current = {
      phaseId,
      index: items[phaseId]!.findIndex((c) => c.id === id),
      snapshot: items,
    };
    setActiveCardId(id);
  }

  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const from = findContainer(activeId);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const fromItems = prev[from] ?? [];
      const toItems = prev[to] ?? [];
      const card = fromItems.find((c) => c.id === activeId);
      if (!card) return prev;
      let index = toItems.length;
      if (!overId.startsWith(PHASE_PREFIX)) {
        const overIndex = toItems.findIndex((c) => c.id === overId);
        const translated = active.rect.current.translated;
        const below = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        if (overIndex >= 0) index = overIndex + (below ? 1 : 0);
      }
      return {
        ...prev,
        [from]: fromItems.filter((c) => c.id !== activeId),
        [to]: [...toItems.slice(0, index), { ...card, phase_id: to }, ...toItems.slice(index)],
      };
    });
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const cardId = String(active.id);
    const origin = dragOrigin.current;
    dragOrigin.current = null;
    setActiveCardId(null);
    const phaseId = findContainer(cardId);
    if (!over || !phaseId || !origin) {
      if (origin) setItems(origin.snapshot);
      return;
    }

    let list = items[phaseId] ?? [];
    let index = list.findIndex((c) => c.id === cardId);
    const overId = String(over.id);
    if (!overId.startsWith(PHASE_PREFIX) && findContainer(overId) === phaseId) {
      const overIndex = list.findIndex((c) => c.id === overId);
      if (overIndex >= 0 && overIndex !== index) {
        list = arrayMove(list, index, overIndex);
        index = overIndex;
      }
    }
    if (origin.phaseId === phaseId && origin.index === index) {
      setItems(origin.snapshot);
      return;
    }

    const position = positionAt(
      list.filter((c) => c.id !== cardId),
      index,
    );
    setItems((prev) => ({
      ...prev,
      [phaseId]: list.map((c) => (c.id === cardId ? { ...c, phase_id: phaseId, position } : c)),
    }));
    run(() => moveKanbanCard({ ...scope, cardId, phaseId, position }));
  }

  // Mover pelo modal (celular): vai pro topo da fase escolhida.
  function moveCardTo(card: KanbanCardRow, phaseId: string) {
    if (card.phase_id === phaseId) return;
    const target = (items[phaseId] ?? []).filter((c) => c.id !== card.id);
    run(() => moveKanbanCard({ ...scope, cardId: card.id, phaseId, position: positionAt(target, 0) }));
  }

  const activeCard = activeCardId
    ? Object.values(items)
        .flat()
        .find((c) => c.id === activeCardId) ?? null
    : null;
  const openCard = openCardId
    ? Object.values(items)
        .flat()
        .find((c) => c.id === openCardId) ?? null
    : null;

  function closeCard() {
    setOpenCardId(null);
    if (initialOpenCardId && window.location.search.includes("card=")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {phases.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
          Este Kanban ainda não tem fases.
        </p>
      ) : null}

      <DndContext
        id={`kanban-dnd-${kanban.id}`}
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          if (dragOrigin.current) setItems(dragOrigin.current.snapshot);
          dragOrigin.current = null;
          setActiveCardId(null);
        }}
      >
        <div className="-mx-2 flex items-start gap-3 overflow-x-auto px-2 pb-4">
          {phases.map((phase, i) => (
            <PhaseColumn
              key={phase.id}
              phase={phase}
              index={i}
              total={phases.length}
              isDone={phase.id === lastPhaseId}
              isFirst={i === 0}
              cards={items[phase.id] ?? []}
              canEditKanban={canEditKanban}
              canMoveCard={(c) => canEditCard(c) && !pending}
              pending={pending}
              memberById={memberById}
              responsiblesByCard={responsiblesByCard}
              commentsByCard={commentsByCard}
              tagColors={tagColors}
              onOpenCard={(c) => setOpenCardId(c.id)}
              onRename={(name) => run(() => renameKanbanPhase({ ...scope, phaseId: phase.id, name }))}
              onMove={(direction) =>
                run(() => moveKanbanPhase({ ...scope, phaseId: phase.id, direction }))
              }
              onDelete={() => {
                if (!window.confirm(`Excluir a fase "${phase.name}"?`)) return;
                run(() => deleteKanbanPhase({ ...scope, phaseId: phase.id }));
              }}
              onCreateCard={(title) => run(() => createKanbanCard({ ...scope, title }))}
            />
          ))}
          {canEditKanban ? (
            <NewPhaseColumn
              pending={pending}
              onCreate={(name) => run(() => addKanbanPhase({ ...scope, name }))}
            />
          ) : null}
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="w-72 rotate-2 shadow-xl">
              <CardFace
                card={activeCard}
                isDone={activeCard.phase_id === lastPhaseId}
                memberById={memberById}
                responsibleIds={responsiblesByCard[activeCard.id] ?? []}
                commentCount={(commentsByCard[activeCard.id] ?? []).length}
                tagColors={tagColors}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {openCard ? (
        <KanbanCardModal
          key={openCard.id}
          scope={scope}
          card={openCard}
          phases={phases}
          isDone={openCard.phase_id === lastPhaseId}
          members={members}
          responsibleIds={responsiblesByCard[openCard.id] ?? []}
          comments={commentsByCard[openCard.id] ?? []}
          canEditKanban={canEditKanban}
          canEditCard={canEditCard(openCard)}
          canComment={canComment(openCard)}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          availableTags={availableTags}
          tagColors={tagColors}
          pending={pending}
          origin={openCard.id in originByCard ? (originByCard[openCard.id] ?? null) : undefined}
          generated={generatedByCard[openCard.id] ?? []}
          onMove={(phaseId) => moveCardTo(openCard, phaseId)}
          onClose={closeCard}
        />
      ) : null}
    </div>
  );
}

function PhaseColumn(props: {
  phase: KanbanPhaseRow;
  index: number;
  total: number;
  isDone: boolean;
  isFirst: boolean;
  cards: KanbanCardRow[];
  canEditKanban: boolean;
  canMoveCard: (c: KanbanCardRow) => boolean;
  pending: boolean;
  memberById: Map<string, MemberLite>;
  responsiblesByCard: Record<string, string[]>;
  commentsByCard: Record<string, KanbanCardCommentRow[]>;
  tagColors: Record<string, string>;
  onOpenCard: (c: KanbanCardRow) => void;
  onRename: (name: string) => void;
  onMove: (direction: "left" | "right") => void;
  onDelete: () => void;
  onCreateCard: (title: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${PHASE_PREFIX}${props.phase.id}` });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(props.phase.name);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  return (
    <section
      aria-label={`Fase ${props.phase.name}`}
      className={`flex w-72 shrink-0 flex-col gap-2 rounded-2xl border p-3 ${
        props.isDone ? "border-emerald-200 bg-emerald-50/70" : "border-slate-200 bg-slate-50"
      }`}
    >
      <header className="flex items-start gap-2">
        {renaming ? (
          <form
            className="flex min-w-0 flex-1 gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== props.phase.name) props.onRename(name);
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              aria-label="Nome da fase"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setRenaming(false);
                  setName(props.phase.name);
                }
              }}
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
            >
              OK
            </button>
          </form>
        ) : (
          <div className="min-w-0 flex-1">
            <h3
              className={`flex items-center gap-1.5 text-sm font-semibold ${
                props.isDone ? "text-emerald-800" : "text-slate-900"
              }`}
            >
              {props.isDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
              <span className="truncate">{props.phase.name}</span>
              <span
                className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  props.isDone ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                }`}
              >
                {props.cards.length}
              </span>
            </h3>
          </div>
        )}
        {props.canEditKanban && !renaming ? (
          <PhaseMenu
            canLeft={props.index > 0}
            canRight={props.index < props.total - 1}
            canDelete={props.total > 1}
            pending={props.pending}
            onRename={() => {
              setName(props.phase.name);
              setRenaming(true);
            }}
            onMove={props.onMove}
            onDelete={props.onDelete}
          />
        ) : null}
      </header>

      {props.isFirst && props.canEditKanban ? (
        adding ? (
          <form
            className="space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              props.onCreateCard(title);
              setTitle("");
            }}
          >
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              rows={2}
              autoFocus
              placeholder="Título do card"
              aria-label="Título do novo card"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
                if (e.key === "Escape") {
                  setAdding(false);
                  setTitle("");
                }
              }}
              className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={props.pending || !title.trim()}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Adicionar
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setTitle("");
                }}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
          >
            + Novo card
          </button>
        )
      ) : null}

      <SortableContext items={props.cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <ol
          ref={setNodeRef}
          className={`flex min-h-16 flex-col gap-2 rounded-xl transition ${
            isOver ? "bg-slate-200/60" : ""
          }`}
        >
          {props.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              disabled={!props.canMoveCard(card)}
              isDone={props.isDone}
              memberById={props.memberById}
              responsibleIds={props.responsiblesByCard[card.id] ?? []}
              commentCount={(props.commentsByCard[card.id] ?? []).length}
              tagColors={props.tagColors}
              onOpen={() => props.onOpenCard(card)}
            />
          ))}
          {props.cards.length === 0 ? (
            <li className="rounded-xl px-3 py-4 text-center text-xs italic text-slate-400">
              Sem cards
            </li>
          ) : null}
        </ol>
      </SortableContext>
    </section>
  );
}

function PhaseMenu(props: {
  canLeft: boolean;
  canRight: boolean;
  canDelete: boolean;
  pending: boolean;
  onRename: () => void;
  onMove: (direction: "left" | "right") => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const item =
    "block w-full rounded-lg px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-40";
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={props.pending}
        aria-label="Opções da fase"
        className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-900 disabled:opacity-50"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            className={item}
            onClick={() => {
              setOpen(false);
              props.onRename();
            }}
          >
            Renomear
          </button>
          <button
            type="button"
            className={item}
            disabled={!props.canLeft}
            onClick={() => {
              setOpen(false);
              props.onMove("left");
            }}
          >
            ← Mover pra esquerda
          </button>
          <button
            type="button"
            className={item}
            disabled={!props.canRight}
            onClick={() => {
              setOpen(false);
              props.onMove("right");
            }}
          >
            Mover pra direita →
          </button>
          <button
            type="button"
            className={`${item} text-red-600 hover:bg-red-50`}
            disabled={!props.canDelete}
            onClick={() => {
              setOpen(false);
              props.onDelete();
            }}
          >
            Excluir fase
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NewPhaseColumn({ pending, onCreate }: { pending: boolean; onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-72 shrink-0 rounded-2xl border border-dashed border-slate-300 bg-white/60 px-3 py-3 text-left text-sm font-medium text-slate-600 hover:border-slate-400 hover:text-slate-900"
      >
        + Nova fase
      </button>
    );
  }
  return (
    <form
      className="w-72 shrink-0 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onCreate(name);
        setName("");
        setOpen(false);
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={100}
        autoFocus
        placeholder="Nome da fase"
        aria-label="Nome da nova fase"
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          Criar fase
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}

function SortableCard(props: {
  card: KanbanCardRow;
  disabled: boolean;
  isDone: boolean;
  memberById: Map<string, MemberLite>;
  responsibleIds: string[];
  commentCount: number;
  tagColors: Record<string, string>;
  onOpen: () => void;
}) {
  // So os listeners de ponteiro/toque no <li>: o clique e o teclado ficam no <button>
  // de dentro (sem role="button" aninhado; mover pelo teclado = campo "Fase" do modal).
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.card.id,
    disabled: props.disabled,
  });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: "manipulation",
      }}
      {...(props.disabled ? {} : listeners)}
      data-card-id={props.card.id}
      className={props.disabled ? "" : "cursor-grab active:cursor-grabbing"}
    >
      <button type="button" onClick={props.onOpen} className="block w-full text-left">
        <CardFace
          card={props.card}
          isDone={props.isDone}
          memberById={props.memberById}
          responsibleIds={props.responsibleIds}
          commentCount={props.commentCount}
          tagColors={props.tagColors}
        />
      </button>
    </li>
  );
}

function CardFace(props: {
  card: KanbanCardRow;
  isDone: boolean;
  memberById: Map<string, MemberLite>;
  responsibleIds: string[];
  commentCount: number;
  tagColors: Record<string, string>;
}) {
  const { card } = props;
  const overdue = !props.isDone && !!card.due_date && new Date(card.due_date) < new Date();
  const people = props.responsibleIds
    .map((id) => props.memberById.get(id))
    .filter((m): m is MemberLite => !!m);
  return (
    <div
      className={`space-y-2 rounded-xl border p-3 shadow-sm transition hover:shadow ${
        props.isDone
          ? "border-emerald-200 bg-white"
          : overdue
            ? "border-red-200 bg-red-50"
            : "border-slate-200 bg-white"
      }`}
    >
      {card.created_by_automation_id ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-800">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
          Automação
        </span>
      ) : null}
      {card.tags.length ? (
        <div className="flex flex-wrap gap-1" title={`Tags: ${card.tags.join(", ")}`}>
          {card.tags.map((t) => (
            <span
              key={t}
              className="inline-block h-1.5 w-8 rounded-full"
              style={{ backgroundColor: props.tagColors[t] ?? "#9333ea" }}
            />
          ))}
        </div>
      ) : null}
      <p
        className={`line-clamp-3 text-sm font-medium ${
          props.isDone ? "text-emerald-900" : "text-slate-900"
        }`}
      >
        {props.isDone ? <span className="mr-1 text-emerald-600">✓</span> : null}
        {card.title}
      </p>
      {card.due_date || card.description || props.commentCount || people.length ? (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {card.due_date ? (
            <span className={overdue ? "font-semibold text-red-700" : ""}>
              {formatShortDate(card.due_date)}
              {overdue ? " · vencido" : ""}
            </span>
          ) : null}
          {card.description ? (
            <span title="Tem descrição" className="font-bold text-amber-500">
              !
            </span>
          ) : null}
          {props.commentCount ? (
            <span title="Comentários" className="inline-flex items-center gap-0.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              {props.commentCount}
            </span>
          ) : null}
          {people.length ? (
            <span className="ml-auto flex -space-x-1.5">
              {people.slice(0, 3).map((m) => (
                <MemberAvatar
                  key={m.user_id}
                  name={m.google_full_name}
                  avatarUrl={m.google_avatar_url}
                  size="sm"
                  className="ring-2 ring-white"
                />
              ))}
              {people.length > 3 ? (
                <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
                  +{people.length - 3}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}
