-- ============================================================================
-- RPC: clone_project — duplica projeto + flows + phases + fields + responsibles + tags
-- Nao copia: comments, attachments, phase_field_values, reminders, simple_lists, items
-- ============================================================================

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

  -- Validar permissao: admin do workspace OU diretor que criou o projeto
  if not (
    is_workspace_admin(v_workspace_id) OR
    (workspace_role_of(v_workspace_id) = 'diretor' AND v_orig_project.created_by = v_caller)
  ) then
    raise exception 'Sem permissao pra clonar este projeto';
  end if;

  -- 1. Cria projeto novo (sempre status=active mesmo se original era archived/completed)
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

  -- 2. Pra cada flow do projeto original
  for v_orig_flow in select * from flows where project_id = p_project_id order by order_index loop
    insert into flows (project_id, name, description, type, status, order_index, created_by)
    values (
      v_new_project_id,
      v_orig_flow.name,
      v_orig_flow.description,
      v_orig_flow.type,
      'active',
      v_orig_flow.order_index,
      v_caller
    )
    returning id into v_new_flow_id;

    -- 2a. Copia tags do flow
    insert into flow_tags (flow_id, tag_id, added_by)
    select v_new_flow_id, ft.tag_id, v_caller
    from flow_tags ft where ft.flow_id = v_orig_flow.id;

    -- 2b. Copia phases
    for v_orig_phase in select * from phases where flow_id = v_orig_flow.id order by order_index loop
      insert into phases (flow_id, name, description, due_date, color, order_index, created_by)
      values (
        v_new_flow_id,
        v_orig_phase.name,
        v_orig_phase.description,
        v_orig_phase.due_date,
        v_orig_phase.color,
        v_orig_phase.order_index,
        v_caller
      )
      returning id into v_new_phase_id;

      -- 2c. Copia phase_fields (estrutura, sem values)
      insert into phase_fields (phase_id, type, label, mode, order_index, required, created_by)
      select v_new_phase_id, pf.type, pf.label, pf.mode, pf.order_index, pf.required, v_caller
      from phase_fields pf where pf.phase_id = v_orig_phase.id;

      -- 2d. Copia phase_responsibles
      insert into phase_responsibles (phase_id, user_id, assigned_by)
      select v_new_phase_id, pr.user_id, v_caller
      from phase_responsibles pr where pr.phase_id = v_orig_phase.id;
    end loop;
  end loop;

  return v_new_project_id;
end;
$$;

grant execute on function clone_project(uuid) to authenticated;
