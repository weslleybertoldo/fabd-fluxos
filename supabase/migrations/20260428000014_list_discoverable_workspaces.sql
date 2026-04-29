-- ============================================================================
-- RPC: list_discoverable_workspaces — lista TODOS workspaces visiveis pra user
-- logado, com info do membership atual (active/pending/blocked/null).
--
-- Bypassa ws_select (que so retorna se for member ou creator) pra permitir
-- que user novo veja TODOS workspaces e peça acesso.
-- ============================================================================

create or replace function list_discoverable_workspaces()
returns table (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  member_status text,
  member_role text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'Nao autenticado';
  end if;

  return query
  select
    w.id,
    w.name,
    w.slug,
    w.created_at,
    wm.status::text as member_status,
    wm.role::text as member_role
  from workspaces w
  left join workspace_members wm
    on wm.workspace_id = w.id and wm.user_id = v_caller
  order by w.created_at asc;
end;
$$;

grant execute on function list_discoverable_workspaces() to authenticated;
