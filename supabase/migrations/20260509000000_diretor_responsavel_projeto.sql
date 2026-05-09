-- ============================================================================
-- Permissoes: diretor responsavel pelo projeto + responsavel da fase
-- ============================================================================
-- 1) Diretor que e projects.responsible_user_id pode editar/deletar tudo dentro
--    do projeto (fluxos, fases, fields, etc — cascata via can_edit_flow).
-- 2) Qualquer membro (membro/diretor/admin) listado em phase_responsibles
--    pode editar AQUELA fase: concluir/reabrir, preencher campos e anexar.
--    Nao inclui delete da fase nem mexer em outras fases do flow.
-- ============================================================================

-- Helper: usuario e responsavel pela fase?
create or replace function is_phase_responsible(ph_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select exists(
    select 1 from phase_responsibles
    where phase_id = ph_id and user_id = uid
  );
$$;

-- 1) can_edit_flow: amplia diretor pra incluir responsavel do projeto
create or replace function can_edit_flow(f_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select case
    when is_workspace_admin(workspace_of_flow(f_id), uid) then true
    when workspace_role_of(workspace_of_flow(f_id), uid) = 'diretor' and (
      exists(select 1 from flows where id = f_id and created_by = uid)
      or exists(
        select 1 from flows fl
        join projects p on p.id = fl.project_id
        where fl.id = f_id and p.responsible_user_id = uid
      )
    ) then true
    else false
  end;
$$;

-- 2) ph_update: responsavel da fase pode editar (alem de can_edit_flow)
drop policy if exists ph_update on phases;
create policy ph_update on phases for update to authenticated
  using (can_edit_flow(flow_id) or is_phase_responsible(id))
  with check (can_edit_flow(flow_id) or is_phase_responsible(id));

-- 3) phase_field_values: responsavel da fase pode preencher/atualizar campos
--    (sobrepoe a regra "membro 100% read-only" da migration 20260504000000
--    apenas pra fase em que ele e responsavel)
drop policy if exists pfv_insert on phase_field_values;
create policy pfv_insert on phase_field_values for insert to authenticated
  with check (
    is_workspace_member(workspace_of_phase(current_phase_id))
    and (
      workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
      or is_phase_responsible(current_phase_id)
    )
    and updated_by = auth.uid()
  );

drop policy if exists pfv_update on phase_field_values;
create policy pfv_update on phase_field_values for update to authenticated
  using (
    is_workspace_member(workspace_of_phase(current_phase_id))
    and (
      workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
      or is_phase_responsible(current_phase_id)
    )
  )
  with check (
    (
      workspace_role_of(workspace_of_phase(current_phase_id)) in ('admin','diretor')
      or is_phase_responsible(current_phase_id)
    )
    and updated_by = auth.uid()
  );

-- 4) phase_attachments: responsavel da fase pode anexar
drop policy if exists att_insert on phase_attachments;
create policy att_insert on phase_attachments for insert to authenticated
  with check (
    is_workspace_member(workspace_of_phase(phase_id))
    and (
      workspace_role_of(workspace_of_phase(phase_id)) in ('admin','diretor')
      or is_phase_responsible(phase_id)
    )
    and uploaded_by = auth.uid()
  );

-- 5) projects: diretor responsavel pode editar (prj_delete continua so admin)
drop policy if exists prj_update on projects;
create policy prj_update on projects for update to authenticated
  using (
    is_workspace_admin(workspace_of_directory(directory_id))
    or (
      workspace_role_of(workspace_of_directory(directory_id)) = 'diretor'
      and (created_by = auth.uid() or responsible_user_id = auth.uid())
    )
  );

-- 6) clone_project: ampliar permissao pra responsavel do projeto
create or replace function clone_project(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_orig_project record;
  v_workspace_id uuid;
  v_new_project_id uuid;
  v_new_flow_id uuid;
  v_new_phase_id uuid;
  v_orig_flow record;
  v_orig_phase record;
begin
  if v_caller is null then
    raise exception 'Nao autenticado';
  end if;

  select p.* into v_orig_project from projects p where p.id = p_project_id;
  if v_orig_project.id is null then
    raise exception 'Projeto nao encontrado';
  end if;

  select d.workspace_id into v_workspace_id
  from directories d where d.id = v_orig_project.directory_id;

  -- admin OU diretor que criou OU diretor responsavel
  if not (
    is_workspace_admin(v_workspace_id) OR
    (
      workspace_role_of(v_workspace_id) = 'diretor'
      AND (
        v_orig_project.created_by = v_caller
        OR v_orig_project.responsible_user_id = v_caller
      )
    )
  ) then
    raise exception 'Sem permissao pra clonar este projeto';
  end if;

  insert into projects (directory_id, name, description, status, created_by, responsible_user_id)
  values (
    v_orig_project.directory_id,
    'Cópia ' || v_orig_project.name,
    v_orig_project.description,
    'active',
    v_caller,
    v_orig_project.responsible_user_id
  )
  returning id into v_new_project_id;

  for v_orig_flow in select * from flows where project_id = p_project_id order by order_index loop
    insert into flows (project_id, name, description, type, status, order_index, created_by)
    values (
      v_new_project_id, v_orig_flow.name, v_orig_flow.description,
      v_orig_flow.type, 'active', v_orig_flow.order_index, v_caller
    )
    returning id into v_new_flow_id;

    insert into flow_tags (flow_id, tag_id, added_by)
    select v_new_flow_id, ft.tag_id, v_caller
    from flow_tags ft where ft.flow_id = v_orig_flow.id;

    for v_orig_phase in select * from phases where flow_id = v_orig_flow.id order by order_index loop
      insert into phases (flow_id, name, description, due_date, color, order_index, created_by)
      values (
        v_new_flow_id, v_orig_phase.name, v_orig_phase.description,
        v_orig_phase.due_date, v_orig_phase.color, v_orig_phase.order_index, v_caller
      )
      returning id into v_new_phase_id;

      insert into phase_fields (phase_id, type, label, mode, order_index, required, created_by)
      select v_new_phase_id, pf.type, pf.label, pf.mode, pf.order_index, pf.required, v_caller
      from phase_fields pf where pf.phase_id = v_orig_phase.id;

      insert into phase_responsibles (phase_id, user_id, assigned_by)
      select v_new_phase_id, pr.user_id, v_caller
      from phase_responsibles pr where pr.phase_id = v_orig_phase.id;
    end loop;
  end loop;

  return v_new_project_id;
end;
$$;

-- 7) flow_comments: responsavel da fase pode comentar no fluxo
drop policy if exists cmt_insert on flow_comments;
create policy cmt_insert on flow_comments for insert to authenticated
  with check (
    is_workspace_member(workspace_of_flow(flow_id))
    and (
      workspace_role_of(workspace_of_flow(flow_id)) in ('admin','diretor')
      or exists(
        select 1 from phase_responsibles pr
        join phases ph on ph.id = pr.phase_id
        where ph.flow_id = flow_comments.flow_id
          and pr.user_id = auth.uid()
      )
    )
    and author_id = auth.uid()
  );
