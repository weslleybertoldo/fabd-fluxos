-- ============================================================================
-- Senior admin: so weslleybertoldo18@gmail.com pode criar workspaces
-- ============================================================================
-- Antes: ws_insert permitia QUALQUER authenticated criar workspace (created_by = auth.uid()).
-- Agora: so o senior admin (email fixo) cria. Demais users entram via "pedir
-- acesso" (workspace_search + RequestAccess). Cria tambem RPC SECURITY DEFINER
-- que cria workspace + admin member em uma transacao atomica.
-- ============================================================================

-- Helper: identifica o senior admin pelo email do JWT.
create or replace function is_senior_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users
    where id = uid
      and lower(email) = 'weslleybertoldo18@gmail.com'
  );
$$;

revoke all on function is_senior_admin(uuid) from public;
grant execute on function is_senior_admin(uuid) to authenticated, anon;

-- Aperta ws_insert: agora exige senior admin.
drop policy if exists ws_insert on workspaces;
create policy ws_insert on workspaces for insert to authenticated
  with check (created_by = auth.uid() and is_senior_admin(auth.uid()));

-- RPC pra criar workspace + virar admin member em uma transacao.
-- SECURITY DEFINER pra rodar como dono e bypass RLS na criacao do member
-- (a policy wm_insert_self exige status='pending', e queremos active+admin).
create or replace function create_workspace_as_senior_admin(
  p_name text,
  p_slug text
)
returns workspaces
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := trim(p_name);
  v_slug text := lower(trim(p_slug));
  v_ws workspaces;
  v_full_name text;
  v_avatar text;
begin
  if v_uid is null then
    raise exception 'Nao autenticado' using errcode = '28000';
  end if;

  if not is_senior_admin(v_uid) then
    raise exception 'Apenas o senior admin pode criar workspaces' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) = 0 then
    raise exception 'Nome obrigatorio' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'Nome muito longo (max 80)' using errcode = '22023';
  end if;

  if v_slug is null or length(v_slug) = 0 then
    raise exception 'Slug obrigatorio' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$' then
    raise exception 'Slug invalido (use a-z, 0-9, hifen; 2-60 chars)' using errcode = '22023';
  end if;

  if exists (select 1 from workspaces where slug = v_slug) then
    raise exception 'Slug ja em uso' using errcode = '23505';
  end if;

  insert into workspaces (name, slug, created_by)
  values (v_name, v_slug, v_uid)
  returning * into v_ws;

  -- Pega metadados Google do criador pra cache do member
  select raw_user_meta_data->>'full_name', raw_user_meta_data->>'avatar_url'
    into v_full_name, v_avatar
  from auth.users
  where id = v_uid;

  insert into workspace_members
    (workspace_id, user_id, role, status, approved_by, approved_at,
     google_full_name, google_avatar_url)
  values
    (v_ws.id, v_uid, 'admin', 'active', v_uid, now(),
     coalesce(v_full_name, ''), coalesce(v_avatar, ''));

  insert into audit_log (workspace_id, user_id, entity, entity_id, action, changes)
  values (v_ws.id, v_uid, 'workspace', v_ws.id, 'create',
          jsonb_build_object('name', v_name, 'slug', v_slug));

  return v_ws;
end;
$$;

revoke all on function create_workspace_as_senior_admin(text, text) from public;
grant execute on function create_workspace_as_senior_admin(text, text) to authenticated;
