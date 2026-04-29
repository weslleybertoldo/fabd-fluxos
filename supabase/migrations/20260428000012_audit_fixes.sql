-- ============================================================================
-- Audit fixes 2026-04-28: defense-in-depth em phase_notification_log
-- ============================================================================

-- phase_notification_log tinha RLS habilitado mas ZERO policies (relia em
-- `revoke all from anon, authenticated`). Auditor flagou inconsistencia: outras
-- tabelas tem RLS + policies + grants. Vou adicionar policies negativas
-- explicitas pra ficar claro que so service role acessa.
do $$
begin
  -- DROP qualquer policy existente
  drop policy if exists pnl_select on phase_notification_log;
  drop policy if exists pnl_insert on phase_notification_log;
  drop policy if exists pnl_update on phase_notification_log;
  drop policy if exists pnl_delete on phase_notification_log;
exception when others then null;
end $$;

-- USING (false) bloqueia explicitamente — clareza vs depender so de revoke
create policy pnl_select on phase_notification_log for select to authenticated
  using (false);
create policy pnl_insert on phase_notification_log for insert to authenticated
  with check (false);
create policy pnl_update on phase_notification_log for update to authenticated
  using (false) with check (false);
create policy pnl_delete on phase_notification_log for delete to authenticated
  using (false);

-- comment de documentacao
comment on table phase_notification_log is
  'Log de dedup do cron diario. Apenas service role escreve via /api/cron/notify-due-phases. RLS bloqueia anon/authenticated explicitamente (defense-in-depth alem do revoke).';
