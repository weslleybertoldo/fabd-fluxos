-- ============================================================================
-- RPC: find_workspace_by_id — permite user logado descobrir workspace pelo
-- UUID e ja ver o status de membership atual (active/pending/blocked/null)
-- pra decidir se pode entrar ou se precisa pedir acesso.
--
-- SECURITY DEFINER bypassa a RLS de `workspaces` (que limita SELECT a
-- members + creator). Sem isso, user novo veria 0 rows e nao conseguiria
-- pedir acesso a workspace que nao conhece.
-- ============================================================================

create or replace function find_workspace_by_id(p_workspace_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
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
    wm.status::text as member_status,
    wm.role::text as member_role
  from workspaces w
  left join workspace_members wm
    on wm.workspace_id = w.id and wm.user_id = v_caller
  where w.id = p_workspace_id;
end;
$$;

grant execute on function find_workspace_by_id(uuid) to authenticated;
