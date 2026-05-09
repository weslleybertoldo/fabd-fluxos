-- ============================================================================
-- Defense-in-depth: revoke EXECUTE from public/anon em funcoes SECURITY DEFINER
-- ============================================================================
-- Postgres concede EXECUTE pra `public` por padrao em funcoes recem-criadas, e
-- todas as funcoes abaixo foram criadas SEM `revoke ... from public`. Em pratica
-- nao tinha exposicao real porque cada funcao valida `auth.uid()` ou faz join
-- com `workspace_members`/`auth.users` (anon nao tem sessao -> retorna null).
-- Mas defesa em camadas pede revoke explicito + grant explicito.
-- Mesmo padrao da migration 20260508000001_count_overdue_phases_revoke_public.sql
-- ============================================================================

-- 1) Helpers de RLS (initial_schema)
revoke execute on function is_workspace_member(uuid, uuid) from public, anon;
grant execute on function is_workspace_member(uuid, uuid) to authenticated;

revoke execute on function workspace_role_of(uuid, uuid) from public, anon;
grant execute on function workspace_role_of(uuid, uuid) to authenticated;

revoke execute on function is_workspace_admin(uuid, uuid) from public, anon;
grant execute on function is_workspace_admin(uuid, uuid) to authenticated;

revoke execute on function log_audit(uuid, entity_type, uuid, text, jsonb, jsonb) from public, anon;
grant execute on function log_audit(uuid, entity_type, uuid, text, jsonb, jsonb) to authenticated;

-- 2) notify_user (notifications) — ja tinha grant authenticated, falta revoke
revoke execute on function notify_user(uuid, uuid, notification_type, text, text, entity_type, uuid, text) from public, anon;
grant execute on function notify_user(uuid, uuid, notification_type, text, text, entity_type, uuid, text) to authenticated;

-- 3) clone_project — ja tinha grant authenticated, falta revoke
revoke execute on function clone_project(uuid) from public, anon;
grant execute on function clone_project(uuid) to authenticated;

-- 4) find_workspace_by_id — ja tinha grant authenticated, falta revoke
revoke execute on function find_workspace_by_id(uuid) from public, anon;
grant execute on function find_workspace_by_id(uuid) to authenticated;

-- 5) list_discoverable_workspaces — ja tinha grant authenticated, falta revoke
revoke execute on function list_discoverable_workspaces() from public, anon;
grant execute on function list_discoverable_workspaces() to authenticated;

-- service_role bypassa GRANTs de funcao via BYPASSRLS, entao crons que usam
-- SUPABASE_SERVICE_ROLE_KEY (notify-due-phases) continuam executando essas
-- funcoes sem precisar de grant explicito. Helpers `workspace_of_*` (stable,
-- nao security definer) nao precisam de revoke porque rodam com permissoes
-- do caller -> RLS das tabelas underlying ja protege.
