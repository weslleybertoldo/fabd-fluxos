-- Observacao (note) + lembrete por fase de fluxo (igual aos itens de checklist).
-- reminder_recurrence null = sem lembrete. Notifica o criador da fase.
alter table phases
  add column note text,
  add column reminder_recurrence reminder_recurrence,
  add column reminder_at timestamptz,
  add column reminder_notified_at timestamptz,
  add column reminder_last_on date;
