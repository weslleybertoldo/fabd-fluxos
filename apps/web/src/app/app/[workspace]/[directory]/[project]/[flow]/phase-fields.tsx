"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createPhaseField,
  deletePhaseField,
  setFieldValue,
} from "@/lib/actions/phase-fields";
import type {
  FieldMode,
  FieldType,
  PhaseFieldRow,
  PhaseFieldValueRow,
} from "@/lib/types";

interface Props {
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  phaseId: string;
  canEditFields: boolean;
  fields: PhaseFieldRow[];
  valueByFieldPhase: Record<string, PhaseFieldValueRow>;
}

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Texto curto",
  textarea: "Texto longo",
  checkbox: "Checkbox",
  number: "Numero",
  date: "Data",
};

export function PhaseFields({
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  phaseId,
  canEditFields,
  fields,
  valueByFieldPhase,
}: Props) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState(fields.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submitNew(formData: FormData) {
    setError(null);
    const label = (formData.get("label") as string) ?? "";
    const type = ((formData.get("type") as string) ?? "text") as FieldType;
    const mode = ((formData.get("mode") as string) ?? "fixed") as FieldMode;
    start(async () => {
      const r = await createPhaseField({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId,
        label,
        type,
        mode,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setAdding(false);
      setOpen(true);
      router.refresh();
    });
  }

  function removeField(field: PhaseFieldRow) {
    if (!confirm(`Excluir o campo "${field.label}" e todos os valores?`)) return;
    setError(null);
    start(async () => {
      const r = await deletePhaseField({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId,
        fieldId: field.id,
      });
      if (!r.ok) setError(r.error);
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
          {open ? "▼" : "▶"} Campos ({fields.length})
        </button>
        {canEditFields ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            disabled={pending}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {adding ? "Cancelar" : "+ Campo"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>
      ) : null}

      {adding ? (
        <form
          action={submitNew}
          className="space-y-2 rounded-xl border border-slate-200 bg-white p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Nome</span>
              <input
                name="label"
                type="text"
                required
                maxLength={200}
                placeholder="Ex.: Nome do ginasio"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Tipo</span>
              <select
                name="type"
                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
              >
                {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-slate-700">Modo</legend>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="radio" name="mode" value="fixed" defaultChecked />
              <span>
                <strong>Fixo</strong> — fica nesta fase
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="radio" name="mode" value="mobile" />
              <span>
                <strong>Movel</strong> — passa pra proxima fase ao concluir
              </span>
            </label>
          </fieldset>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {pending ? "..." : "Adicionar"}
          </button>
        </form>
      ) : null}

      {open && fields.length > 0 ? (
        <div className="space-y-2">
          {fields.map((field) => {
            const value = valueByFieldPhase[`${field.id}__${phaseId}`];
            return (
              <FieldEditor
                key={field.id}
                field={field}
                value={value}
                phaseId={phaseId}
                workspaceSlug={workspaceSlug}
                directorySlug={directorySlug}
                projectId={projectId}
                flowId={flowId}
                canDelete={canEditFields}
                onDelete={() => removeField(field)}
                pending={pending}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FieldEditor({
  field,
  value,
  phaseId,
  workspaceSlug,
  directorySlug,
  projectId,
  flowId,
  canDelete,
  onDelete,
  pending,
}: {
  field: PhaseFieldRow;
  value: PhaseFieldValueRow | undefined;
  phaseId: string;
  workspaceSlug: string;
  directorySlug: string;
  projectId: string;
  flowId: string;
  canDelete: boolean;
  onDelete: () => void;
  pending: boolean;
}) {
  const [text, setText] = useState(value?.value_text ?? "");
  const [bool, setBool] = useState(value?.value_bool ?? false);
  const [num, setNum] = useState(
    value?.value_number !== null && value?.value_number !== undefined
      ? String(value.value_number)
      : "",
  );
  const [date, setDate] = useState(
    value?.value_date ? new Date(value.value_date).toISOString().slice(0, 10) : "",
  );
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save(payload: Parameters<typeof setFieldValue>[0]["value"]) {
    setErr(null);
    startSave(async () => {
      const r = await setFieldValue({
        workspaceSlug,
        directorySlug,
        projectId,
        flowId,
        phaseId,
        fieldId: field.id,
        value: payload,
      });
      if (!r.ok) setErr(r.error);
    });
  }

  return (
    <div className="rounded-xl bg-slate-50 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <label
          htmlFor={`field-${field.id}`}
          className="text-xs font-medium text-slate-700"
        >
          {field.label}
          {field.required ? <span className="text-red-500"> *</span> : null}
          <span className="ml-1 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-600">
            {field.mode === "mobile" ? "movel" : "fixo"}
          </span>
        </label>
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending || saving}
            className="text-[10px] font-medium text-red-600 hover:text-red-700"
          >
            ✕
          </button>
        ) : null}
      </div>
      <div className="mt-1">
        {field.type === "text" ? (
          <input
            id={`field-${field.id}`}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => save({ text })}
            disabled={saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        ) : field.type === "textarea" ? (
          <textarea
            id={`field-${field.id}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => save({ text })}
            rows={2}
            disabled={saving}
            className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        ) : field.type === "checkbox" ? (
          <label className="flex items-center gap-2 text-xs">
            <input
              id={`field-${field.id}`}
              type="checkbox"
              checked={bool}
              onChange={(e) => {
                setBool(e.target.checked);
                save({ bool: e.target.checked });
              }}
              disabled={saving}
              className="h-4 w-4"
            />
            <span>{bool ? "Marcado" : "Nao marcado"}</span>
          </label>
        ) : field.type === "number" ? (
          <input
            id={`field-${field.id}`}
            type="number"
            value={num}
            onChange={(e) => setNum(e.target.value)}
            onBlur={() =>
              save({ number: num === "" ? null : parseFloat(num) })
            }
            disabled={saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        ) : field.type === "date" ? (
          <input
            id={`field-${field.id}`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            onBlur={() =>
              save({
                date: date ? new Date(date).toISOString() : null,
              })
            }
            disabled={saving}
            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs"
          />
        ) : null}
      </div>
      {err ? (
        <p className="mt-1 text-[10px] text-red-700">{err}</p>
      ) : saving ? (
        <p className="mt-1 text-[10px] text-slate-500">Salvando...</p>
      ) : null}
    </div>
  );
}
