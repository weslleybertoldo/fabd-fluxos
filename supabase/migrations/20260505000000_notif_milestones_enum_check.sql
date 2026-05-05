-- Adiciona os 3 milestones novos do cron notify-due-phases:
--   phase_due_tomorrow      (1 dia antes do vencimento — disparo as 9h BR)
--   phase_due_today         (no dia — hora do due ou 9h BR se 00:00)
--   phase_overdue_yesterday (1 dia depois — disparo as 9h BR)
--
-- Aplicado em prod via Management API em 05/05/2026 (apos descobrir que o
-- enum `notification_type` e o CHECK constraint do log estavam restritos
-- aos 2 tipos antigos — causou silent fail no log dedup, gerando duplicatas).

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'phase_due_tomorrow';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'phase_due_today';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'phase_overdue_yesterday';

ALTER TABLE phase_notification_log
  DROP CONSTRAINT IF EXISTS phase_notification_log_notification_type_check;
ALTER TABLE phase_notification_log
  ADD CONSTRAINT phase_notification_log_notification_type_check
  CHECK (notification_type IN (
    'phase_due_soon',
    'phase_overdue',
    'phase_due_tomorrow',
    'phase_due_today',
    'phase_overdue_yesterday'
  ));
