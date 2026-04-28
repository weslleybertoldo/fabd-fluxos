"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@fabd-fluxos/db/browser";
import {
  deleteAttachment,
  getAttachmentSignedUrl,
  recordAttachment,
} from "@/lib/actions/attachments";
import type { PhaseAttachmentRow } from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  workspaceId: string;
  currentUserId: string;
  canEditPhase: boolean;
  attachments: PhaseAttachmentRow[];
}

export function PhaseAttachments({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  phaseId,
  workspaceId,
  currentUserId,
  canEditPhase,
  attachments,
}: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(attachments.length > 0);

  async function handleUpload(file: File) {
    setError(null);
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 80);
      const path = `workspace-${workspaceId}/flow-${flowId}/phase-${phaseId}/${Date.now()}-${safeName}`;
      const supabase = createSupabaseBrowserClient();
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          upsert: false,
        });
      if (upErr) {
        setError(`Upload falhou: ${upErr.message}`);
        return;
      }
      const r = await recordAttachment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId,
        fileName: file.name.slice(0, 200),
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        storagePath: path,
      });
      if (!r.ok) {
        setError(`Banco rejeitou: ${r.error}`);
        // a action ja tentou remover do storage
        return;
      }
      setOpen(true);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function openAttachment(att: PhaseAttachmentRow) {
    setError(null);
    const r = await getAttachmentSignedUrl({
      storagePath: att.storage_path,
      storageBucket: att.storage_bucket,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  }

  function remove(att: PhaseAttachmentRow) {
    if (!confirm(`Excluir o anexo "${att.file_name}"?`)) return;
    setError(null);
    start(async () => {
      const r = await deleteAttachment({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId,
        attachmentId: att.id,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs font-medium text-slate-600 hover:text-slate-900"
        >
          {open ? "▼" : "▶"} Anexos ({attachments.length})
        </button>

        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || pending}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? "Enviando..." : "+ Anexar"}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {open && attachments.length > 0 ? (
        <ul className="space-y-1">
          {attachments.map((a) => {
            const canDelete =
              a.uploaded_by === currentUserId || canEditPhase;
            return (
              <li
                key={a.id}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs"
              >
                <span className="text-slate-400" aria-hidden>
                  📎
                </span>
                <button
                  type="button"
                  onClick={() => openAttachment(a)}
                  className="min-w-0 flex-1 truncate text-left text-slate-800 hover:text-slate-900 hover:underline"
                  title={a.file_name}
                >
                  {a.file_name}
                </button>
                <span className="shrink-0 text-slate-500">
                  {formatBytes(a.file_size)}
                </span>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => remove(a)}
                    disabled={pending}
                    className="shrink-0 text-red-600 hover:text-red-700 disabled:opacity-50"
                    aria-label="Excluir anexo"
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}
