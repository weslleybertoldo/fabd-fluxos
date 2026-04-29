-- ============================================================================
-- Acessos por diretoria pra members + flag show_reports em diretorias
-- ============================================================================

-- 1) Tabela de acesso granular: membro X diretoria
create table if not exists member_directory_access (
  workspace_member_id uuid references workspace_members(id) on delete cascade not null,
  directory_id uuid references directories(id) on delete cascade not null,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) not null,
  primary key (workspace_member_id, directory_id)
);

create index if not exists idx_mda_member on member_directory_access(workspace_member_id);
create index if not exists idx_mda_directory on member_directory_access(directory_id);

alter table member_directory_access enable row level security;

-- SELECT: o proprio member (suas linhas) OU admin do workspace
create policy mda_select on member_directory_access for select to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.id = member_directory_access.workspace_member_id
        and (wm.user_id = auth.uid() or is_workspace_admin(wm.workspace_id))
    )
  );

-- INSERT: so admin do workspace do member
create policy mda_insert on member_directory_access for insert to authenticated
  with check (
    exists (
      select 1 from workspace_members wm
      where wm.id = member_directory_access.workspace_member_id
        and is_workspace_admin(wm.workspace_id)
    )
  );

-- DELETE: so admin
create policy mda_delete on member_directory_access for delete to authenticated
  using (
    exists (
      select 1 from workspace_members wm
      where wm.id = member_directory_access.workspace_member_id
        and is_workspace_admin(wm.workspace_id)
    )
  );

-- 2) Flag show_reports em diretorias (default true pra nao quebrar nada)
alter table directories
  add column if not exists show_reports boolean not null default true;

-- 3) Adicionar member_directory_access na publication realtime
do $$
begin
  begin
    alter publication supabase_realtime add table member_directory_access;
  exception when duplicate_object then null;
  end;
end $$;
