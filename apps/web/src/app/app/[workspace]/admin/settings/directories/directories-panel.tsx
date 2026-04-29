"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";
import { DirectoryIcon, directoryInitials } from "@/components/directory-icon";
import {
  createDirectory,
  deleteDirectory,
  reorderDirectories,
  setDirectoryImageUrl,
  updateDirectory,
} from "@/lib/actions/directories";
import type { DirectoryRow } from "@/lib/types";

const DEFAULT_COLORS = [
  "#1E3A8A", // azul (FABD primary)
  "#C41E2A", // vermelho FABD secondary
  "#10B981", // verde
  "#F59E0B", // amber
  "#7C3AED", // purple
  "#0EA5E9", // sky
  "#EF4444", // red
  "#475569", // slate
];

interface Props {
  workspaceId: string;
  workspaceSlug: string;
  directories: DirectoryRow[];
}

export function DirectoriesPanel({
  workspaceId,
  workspaceSlug,
  directories: initialDirectories,
}: Props) {
  const router = useRouter();
  const [directories, setDirectories] = useState<DirectoryRow[]>(initialDirectories);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DirectoryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    setDirectories(initialDirectories);
  }, [initialDirectories]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function refresh() {
    router.refresh();
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = directories.findIndex((d) => d.id === active.id);
    const newIndex = directories.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(directories, oldIndex, newIndex);
    setDirectories(reordered); // optimistic
    start(async () => {
      const r = await reorderDirectories({
        workspaceSlug,
        directoryIds: reordered.map((d) => d.id),
      });
      if (!r.ok) {
        setError(r.error);
        setDirectories(initialDirectories); // rollback
        return;
      }
      refresh();
    });
  }

  function submitCreate(formData: FormData) {
    setError(null);
    const name = (formData.get("name") as string) ?? "";
    const color = (formData.get("color") as string) ?? "#1E3A8A";
    const description = (formData.get("description") as string) ?? "";
    start(async () => {
      const r = await createDirectory({
        workspaceSlug,
        name,
        color,
        description: description || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setCreating(false);
      refresh();
    });
  }

  function submitDelete(directory: DirectoryRow) {
    if (
      !confirm(
        `Excluir "${directory.name}" e TUDO dentro (projetos, fluxos, fases)? Acao irreversivel.`,
      )
    )
      return;
    setError(null);
    start(async () => {
      const r = await deleteDirectory({
        workspaceSlug,
        directorySlug: directory.slug,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      refresh();
    });
  }

  return (
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
        >
          + Adicionar diretoria
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <p className="text-xs text-slate-500">
        Arraste pelo icone <span className="inline-block align-middle">⋮⋮</span>{" "}
        pra reordenar — a ordem e refletida nos cards do workspace.
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={directories.map((d) => d.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul className="space-y-2">
            {directories.map((d) => (
              <SortableDirectoryRow
                key={d.id}
                directory={d}
                pending={pending}
                onEdit={() => setEditing(d)}
                onDelete={() => submitDelete(d)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {creating ? (
        <Modal onClose={() => !pending && setCreating(false)}>
          <form action={submitCreate} className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Nova diretoria</h2>

            <Field label="Nome">
              <input
                name="name"
                type="text"
                required
                maxLength={100}
                placeholder="Ex.: Diretoria de Eventos"
                className={InputCls}
              />
            </Field>

            <Field label="Descricao (opcional)">
              <textarea
                name="description"
                rows={2}
                maxLength={500}
                className={`${InputCls} resize-none`}
              />
            </Field>

            <Field label="Cor de destaque">
              <ColorPicker name="color" defaultValue="#1E3A8A" />
            </Field>

            {error ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
            ) : null}

            <ModalFooter
              onCancel={() => setCreating(false)}
              pending={pending}
              submitLabel="Criar diretoria"
            />
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <EditModal
          key={editing.id}
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          directory={editing}
          onClose={() => setEditing(null)}
          onChanged={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

const InputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-400 focus:ring-1 focus:ring-slate-300";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function ColorPicker({
  name,
  defaultValue,
}: {
  name: string;
  defaultValue: string;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-2">
        {DEFAULT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setValue(c)}
            className="h-8 w-8 rounded-full border-2 transition"
            style={{
              backgroundColor: c,
              borderColor: value === c ? "#0f172a" : "transparent",
            }}
          />
        ))}
        <input
          type="color"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-slate-200"
        />
      </div>
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  onCancel,
  pending,
  submitLabel,
}: {
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={pending}
        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {pending ? "Salvando..." : submitLabel}
      </button>
    </div>
  );
}

function SortableDirectoryRow({
  directory,
  pending,
  onEdit,
  onDelete,
}: {
  directory: DirectoryRow;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: directory.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Mover diretoria"
        className="grid h-9 w-9 cursor-grab place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>
      <DirectoryThumb directory={directory} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-slate-900">{directory.name}</p>
        <p className="truncate text-xs text-slate-500">/{directory.slug}</p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Excluir
        </button>
      </div>
    </li>
  );
}

function DirectoryThumb({ directory }: { directory: DirectoryRow }) {
  return (
    <DirectoryIcon
      icon={directory.icon}
      imageUrl={directory.image_url}
      initials={directoryInitials(directory.name)}
      bg={directory.color ?? "#1E3A8A"}
      alt={directory.name}
      sizePx={48}
    />
  );
}

function EditModal({
  workspaceId,
  workspaceSlug,
  directory,
  onClose,
  onChanged,
}: {
  workspaceId: string;
  workspaceSlug: string;
  directory: DirectoryRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(directory.name);
  const [description, setDescription] = useState(directory.description ?? "");
  const [color, setColor] = useState(directory.color ?? "#1E3A8A");
  const [imageUrl, setImageUrl] = useState<string | null>(directory.image_url);
  const [icon, setIcon] = useState<string>(directory.icon ?? "");
  const [showReports, setShowReports] = useState<boolean>(directory.show_reports);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${workspaceId}/${directory.id}-${Date.now()}.${ext}`;
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from("directory-images")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) {
        setError(`Upload falhou: ${upErr.message}`);
        return;
      }
      const { data: pub } = supabase.storage
        .from("directory-images")
        .getPublicUrl(path);
      const newUrl = pub.publicUrl;
      // persistir no banco imediatamente
      const r = await setDirectoryImageUrl({
        workspaceSlug,
        directorySlug: directory.slug,
        imageUrl: newUrl,
      });
      if (!r.ok) {
        setError(`Banco rejeitou: ${r.error}`);
        return;
      }
      setImageUrl(newUrl);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveImage() {
    if (!imageUrl) return;
    setError(null);
    setUploading(true);
    start(async () => {
      const r = await setDirectoryImageUrl({
        workspaceSlug,
        directorySlug: directory.slug,
        imageUrl: null,
      });
      setUploading(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setImageUrl(null);
    });
  }

  function submitMeta() {
    setError(null);
    start(async () => {
      const r = await updateDirectory({
        workspaceSlug,
        directorySlug: directory.slug,
        name,
        description: description || null,
        color,
        icon: icon.trim() || null,
        showReports,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <Modal onClose={() => !pending && !uploading && onClose()}>
      <h2 className="text-lg font-semibold text-slate-900">Editar diretoria</h2>

      <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <DirectoryIcon
          icon={icon.trim() || null}
          imageUrl={imageUrl}
          initials={directoryInitials(name)}
          bg={color}
          alt={directory.name}
          sizePx={80}
        />
        <div className="flex flex-1 flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || pending}
            className="rounded-xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {uploading ? "Enviando..." : imageUrl ? "Trocar imagem" : "Enviar imagem"}
          </button>
          {imageUrl ? (
            <button
              type="button"
              onClick={handleRemoveImage}
              disabled={uploading || pending}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Remover imagem (volta pras iniciais)
            </button>
          ) : null}
          <p className="text-[11px] text-slate-500">
            JPG/PNG/WEBP/SVG até 5MB. Aparece no card da diretoria.
          </p>
        </div>
      </div>

      <Field label="Nome">
        <input
          type="text"
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={InputCls}
        />
      </Field>

      <Field label="Descricao (opcional)">
        <textarea
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${InputCls} resize-none`}
        />
      </Field>

      <Field label="Cor de destaque">
        <div className="flex flex-wrap gap-2">
          {DEFAULT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              className="h-8 w-8 rounded-full border-2 transition"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "#0f172a" : "transparent",
              }}
            />
          ))}
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-slate-200"
          />
        </div>
      </Field>

      <Field label="Icone (Iconify, opcional)">
        <div className="space-y-1.5">
          <input
            type="text"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="ex: mdi:trophy-outline · mdi:scale-balance · mdi:wallet · lucide:briefcase"
            className={InputCls}
          />
          <p className="text-[11px] text-slate-500">
            Use a sintaxe Iconify (`set:icon`). Catalogo:{" "}
            <a
              href="https://icones.js.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline"
            >
              icones.js.org
            </a>
            . Vazio = mostra iniciais do nome.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[
              "mdi:trophy-outline",
              "mdi:scale-balance",
              "mdi:wallet-outline",
              "mdi:briefcase-outline",
              "mdi:bullhorn-outline",
              "mdi:earth",
              "mdi:home-outline",
              "mdi:account-group-outline",
            ].map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => setIcon(sug)}
                className={`rounded-md border px-2 py-1 text-[11px] transition ${
                  icon === sug
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {sug}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <input
          type="checkbox"
          checked={showReports}
          onChange={(e) => setShowReports(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300"
        />
        <div className="flex-1">
          <span className="text-sm font-medium text-slate-800">
            Mostrar Relatorios nesta diretoria
          </span>
          <p className="text-xs text-slate-500">
            Quando desativado, o botao &quot;Relatorios&quot; some dos projetos desta diretoria.
          </p>
        </div>
      </label>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          disabled={pending || uploading}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Fechar
        </button>
        <button
          type="button"
          onClick={submitMeta}
          disabled={pending || uploading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {pending ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
