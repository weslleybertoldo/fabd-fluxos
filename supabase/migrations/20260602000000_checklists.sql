-- Checklists ricas (em fluxo / simples) com secoes + itens.
-- Substitui a UI antiga de simple_lists. Mesma regra de acesso:
-- membro le, admin/diretor edita (admin tudo, diretor o que criou).

create type checklist_kind as enum ('flow', 'simple');

create table checklists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  kind checklist_kind not null default 'simple',
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index idx_checklists_project on checklists(project_id, order_index);

create table checklist_sections (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid references checklists(id) on delete cascade not null,
  title text not null,
  description text,
  order_index int not null default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index idx_checklist_sections_cl on checklist_sections(checklist_id, order_index);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid references checklist_sections(id) on delete cascade not null,
  text text not null,
  completed_at timestamptz,
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index idx_checklist_items_sec on checklist_items(section_id, order_index);

-- triggers updated_at (reusa tg_updated_at do schema inicial)
create trigger trg_checklists_upd before update on checklists
  for each row execute procedure tg_updated_at();
create trigger trg_checklist_sections_upd before update on checklist_sections
  for each row execute procedure tg_updated_at();
create trigger trg_checklist_items_upd before update on checklist_items
  for each row execute procedure tg_updated_at();

-- helpers de resolucao de workspace (espelham workspace_of_list / _list_item)
create or replace function workspace_of_checklist(c_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from checklists c
  join projects p on p.id = c.project_id
  join directories d on d.id = p.directory_id
  where c.id = c_id;
$$;

create or replace function workspace_of_checklist_section(s_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from checklist_sections s
  join checklists c on c.id = s.checklist_id
  join projects p on p.id = c.project_id
  join directories d on d.id = p.directory_id
  where s.id = s_id;
$$;

create or replace function workspace_of_checklist_item(i_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from checklist_items i
  join checklist_sections s on s.id = i.section_id
  join checklists c on c.id = s.checklist_id
  join projects p on p.id = c.project_id
  join directories d on d.id = p.directory_id
  where i.id = i_id;
$$;

alter table checklists enable row level security;
alter table checklist_sections enable row level security;
alter table checklist_items enable row level security;

-- ===== checklists =====
create policy cl_select on checklists for select to authenticated
  using (is_workspace_member(workspace_of_project(project_id)));

create policy cl_insert on checklists for insert to authenticated
  with check (
    is_workspace_member(workspace_of_project(project_id))
    and workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );

create policy cl_update on checklists for update to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

create policy cl_delete on checklists for delete to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

-- ===== checklist_sections =====
create policy cls_select on checklist_sections for select to authenticated
  using (is_workspace_member(workspace_of_checklist(checklist_id)));

create policy cls_insert on checklist_sections for insert to authenticated
  with check (
    is_workspace_member(workspace_of_checklist(checklist_id))
    and workspace_role_of(workspace_of_checklist(checklist_id)) in ('admin','diretor')
  );

create policy cls_update on checklist_sections for update to authenticated
  using (
    is_workspace_member(workspace_of_checklist_section(id))
    and workspace_role_of(workspace_of_checklist_section(id)) in ('admin','diretor')
  )
  with check (
    workspace_role_of(workspace_of_checklist_section(id)) in ('admin','diretor')
  );

create policy cls_delete on checklist_sections for delete to authenticated
  using (
    is_workspace_member(workspace_of_checklist_section(id))
    and workspace_role_of(workspace_of_checklist_section(id)) in ('admin','diretor')
  );

-- ===== checklist_items =====
create policy cli_select on checklist_items for select to authenticated
  using (is_workspace_member(workspace_of_checklist_section(section_id)));

create policy cli_insert on checklist_items for insert to authenticated
  with check (
    is_workspace_member(workspace_of_checklist_section(section_id))
    and workspace_role_of(workspace_of_checklist_section(section_id)) in ('admin','diretor')
  );

create policy cli_update on checklist_items for update to authenticated
  using (
    is_workspace_member(workspace_of_checklist_item(id))
    and workspace_role_of(workspace_of_checklist_item(id)) in ('admin','diretor')
  )
  with check (
    workspace_role_of(workspace_of_checklist_item(id)) in ('admin','diretor')
  );

create policy cli_delete on checklist_items for delete to authenticated
  using (
    is_workspace_member(workspace_of_checklist_item(id))
    and workspace_role_of(workspace_of_checklist_item(id)) in ('admin','diretor')
  );

-- realtime
do $$
begin
  begin alter publication supabase_realtime add table checklists; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table checklist_sections; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table checklist_items; exception when duplicate_object then null; end;
end $$;
