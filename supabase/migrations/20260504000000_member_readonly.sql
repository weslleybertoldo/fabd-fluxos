-- ============================================================================
-- Member 100% read-only
-- ============================================================================
-- Aperta policies WRITE pra excluir role='membro' em pfv/cmt/att/reminders/
-- lists/list_items. Antes: qualquer membro escrevia. Agora: so admin/diretor.
--
-- Membro continua vendo tudo igual diretor (acesso por diretoria via
-- member_directory_access ja existente), mas nao consegue mexer em nada.
-- ============================================================================

-- comments: membro nao comenta mais
drop policy if exists cmt_insert on flow_comments;
create policy cmt_insert on flow_comments for insert to authenticated
  with check (
    is_workspace_member(workspace_of_flow(flow_id))
    and workspace_role_of(workspace_of_flow(flow_id)) in ('admin','diretor')
    and author_id = auth.uid()
  );

-- phase_field_values: membro nao preenche
drop policy if exists pfv_insert on phase_field_values;
create policy pfv_insert on phase_field_values for insert to authenticated
  with check (
    is_workspace_member(workspace_of_phase(current_phase_id))
    and workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
    and updated_by = auth.uid()
  );

drop policy if exists pfv_update on phase_field_values;
create policy pfv_update on phase_field_values for update to authenticated
  using (
    is_workspace_member(workspace_of_phase(current_phase_id))
    and workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
  )
  with check (
    workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
    and updated_by = auth.uid()
  );

-- attachments: membro nao anexa
drop policy if exists att_insert on phase_attachments;
create policy att_insert on phase_attachments for insert to authenticated
  with check (
    is_workspace_member(workspace_of_phase(phase_id))
    and workspace_role_of(workspace_of_phase(phase_id)) in ('admin','diretor')
    and uploaded_by = auth.uid()
  );

-- reminders: membro nao cria nem edita
drop policy if exists rem_insert on reminders;
create policy rem_insert on reminders for insert to authenticated
  with check (
    is_workspace_member(workspace_of_project(project_id))
    and workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );

drop policy if exists rem_update on reminders;
create policy rem_update on reminders for update to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

drop policy if exists rem_delete on reminders;
create policy rem_delete on reminders for delete to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

-- simple_lists: membro nao mexe
drop policy if exists sl_insert on simple_lists;
create policy sl_insert on simple_lists for insert to authenticated
  with check (
    is_workspace_member(workspace_of_project(project_id))
    and workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );

drop policy if exists sl_update on simple_lists;
create policy sl_update on simple_lists for update to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

drop policy if exists sl_delete on simple_lists;
create policy sl_delete on simple_lists for delete to authenticated
  using (
    workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_project(project_id))
      or created_by = auth.uid()
    )
  );

-- simple_list_items: membro nao mexe
create or replace function workspace_of_list(l_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from simple_lists sl
  join projects p on p.id = sl.project_id
  join directories d on d.id = p.directory_id
  where sl.id = l_id;
$$;

create or replace function workspace_of_list_item(li_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from simple_list_items li
  join simple_lists sl on sl.id = li.list_id
  join projects p on p.id = sl.project_id
  join directories d on d.id = p.directory_id
  where li.id = li_id;
$$;

do $$
declare
  pol record;
begin
  for pol in select polname from pg_policy
    where polrelid = 'simple_list_items'::regclass
      and polname like 'sli_%'
      and polname <> 'sli_select'
  loop
    execute format('drop policy if exists %I on simple_list_items', pol.polname);
  end loop;
end$$;

create policy sli_insert on simple_list_items for insert to authenticated
  with check (
    is_workspace_member(workspace_of_list(list_id))
    and workspace_role_of(workspace_of_list(list_id)) in ('admin','diretor')
  );

create policy sli_update on simple_list_items for update to authenticated
  using (
    is_workspace_member(workspace_of_list_item(id))
    and workspace_role_of(workspace_of_list_item(id)) in ('admin','diretor')
  )
  with check (
    workspace_role_of(workspace_of_list_item(id)) in ('admin','diretor')
  );

create policy sli_delete on simple_list_items for delete to authenticated
  using (
    is_workspace_member(workspace_of_list_item(id))
    and workspace_role_of(workspace_of_list_item(id)) in ('admin','diretor')
  );
