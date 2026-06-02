-- Lembretes recorrentes: "once" dispara 1x no due_date; "daily" dispara todo
-- dia no horario do due_date (parte de hora). Notifica apenas o criador.

create type reminder_recurrence as enum ('once', 'daily');

-- notificacao de lembrete (cron notify-reminders)
alter type notification_type add value if not exists 'reminder';

alter table reminders
  add column recurrence reminder_recurrence not null default 'once',
  add column notified_at timestamptz,      -- once: timestamp do disparo (null = ainda nao disparou)
  add column last_notified_on date;        -- daily: ultimo dia (BR) em que disparou
