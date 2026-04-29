-- ============================================================================
-- Log de notificacoes por fase pra dedup do cron diario.
-- Evita disparar 'phase_due_soon' ou 'phase_overdue' multiplas vezes pro
-- mesmo user no mesmo dia.
-- ============================================================================

create table if not exists phase_notification_log (
  phase_id uuid references phases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  notification_type text not null check (notification_type in ('phase_due_soon','phase_overdue')),
  notification_day date not null default current_date,
  sent_at timestamptz default now() not null,
  primary key (phase_id, user_id, notification_type, notification_day)
);

create index if not exists idx_pnl_day on phase_notification_log(notification_day);

-- Sem RLS (so service role acessa via cron). Revoke explicito pra anon/authenticated.
alter table phase_notification_log enable row level security;
revoke all on phase_notification_log from anon, authenticated;
