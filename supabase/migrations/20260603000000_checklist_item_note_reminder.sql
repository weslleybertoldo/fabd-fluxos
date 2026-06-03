-- Observacao (note) + lembrete por item de checklist.
-- reminder_recurrence null = sem lembrete. Notifica o criador do item.
alter table checklist_items
  add column note text,
  add column reminder_recurrence reminder_recurrence,
  add column reminder_at timestamptz,
  add column reminder_notified_at timestamptz,
  add column reminder_last_on date;
