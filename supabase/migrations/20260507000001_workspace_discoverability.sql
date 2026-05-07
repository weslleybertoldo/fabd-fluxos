-- ============================================================================
-- Workspace discoverability: admin pode ocultar da lista publica
-- ============================================================================
-- Coluna is_discoverable controla se o workspace aparece na secao
-- "Workspaces disponiveis" pra quem ainda nao eh membro. Membros ativos/
-- pending/blocked sempre veem o seu proprio workspace, e o senior admin
-- ve todos. Busca por UUID continua achando (admin pode compartilhar UUID
-- pra entrar mesmo se oculto).
-- ============================================================================

alter table workspaces
  add column if not exists is_discoverable boolean not null default true;

-- Drop antes de recriar pq a coluna is_discoverable mudou o return type.
drop function if exists list_discoverable_workspaces();

-- Atualiza RPC: oculta workspaces nao-discoveraveis pra quem nao tem membership.
-- Senior admin ve tudo. Membros (qualquer status) veem o seu workspace mesmo oculto.
create or replace function list_discoverable_workspaces()
returns table (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  is_discoverable boolean,
  member_status text,
  member_role text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_is_senior boolean;
begin
  if v_caller is null then
    raise exception 'Nao autenticado';
  end if;

  v_is_senior := is_senior_admin(v_caller);

  return query
  select
    w.id,
    w.name,
    w.slug,
    w.created_at,
    w.is_discoverable,
    wm.status::text as member_status,
    wm.role::text as member_role
  from workspaces w
  left join workspace_members wm
    on wm.workspace_id = w.id and wm.user_id = v_caller
  where v_is_senior
     or wm.user_id is not null
     or w.is_discoverable
  order by w.created_at asc;
end;
$$;
