-- ============================================================================
-- Polimento UX: armazena email do Google no member pra mostrar na UI
-- (auth.users so eh acessivel via service role / SECURITY DEFINER).
-- ============================================================================

alter table workspace_members
  add column if not exists google_email text;

-- Backfill com email do auth.users pra rows existentes
update workspace_members wm
set google_email = u.email
from auth.users u
where wm.user_id = u.id and wm.google_email is null;
