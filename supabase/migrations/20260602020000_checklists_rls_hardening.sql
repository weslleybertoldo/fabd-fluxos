-- Hardening RLS de checklists (review Copilot PR #16):
--  - with check em UPDATE valida o FK NOVO (checklist_id/section_id), nao o id antigo
--    -> impede mover secao/item pra outro checklist/workspace.
--  - cli_insert exige created_by = auth.uid() (impede forjar autor).
--  - ownership "diretor so o que criou": secoes/itens respeitam o created_by do
--    checklist pai (admin sempre; diretor so se criou o checklist).

-- created_by do checklist pai a partir de secao/item
create or replace function checklist_creator(c_id uuid)
returns uuid language sql stable as $$
  select created_by from checklists where id = c_id;
$$;

create or replace function checklist_creator_of_section(s_id uuid)
returns uuid language sql stable as $$
  select c.created_by
  from checklist_sections s
  join checklists c on c.id = s.checklist_id
  where s.id = s_id;
$$;

create or replace function checklist_creator_of_item(i_id uuid)
returns uuid language sql stable as $$
  select c.created_by
  from checklist_items i
  join checklist_sections s on s.id = i.section_id
  join checklists c on c.id = s.checklist_id
  where i.id = i_id;
$$;

-- ===== checklist_sections =====
drop policy if exists cls_insert on checklist_sections;
create policy cls_insert on checklist_sections for insert to authenticated
  with check (
    is_workspace_member(workspace_of_checklist(checklist_id))
    and workspace_role_of(workspace_of_checklist(checklist_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist(checklist_id))
      or checklist_creator(checklist_id) = auth.uid()
    )
  );

drop policy if exists cls_update on checklist_sections;
create policy cls_update on checklist_sections for update to authenticated
  using (
    workspace_role_of(workspace_of_checklist(checklist_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist(checklist_id))
      or checklist_creator(checklist_id) = auth.uid()
    )
  )
  with check (
    workspace_role_of(workspace_of_checklist(checklist_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist(checklist_id))
      or checklist_creator(checklist_id) = auth.uid()
    )
  );

drop policy if exists cls_delete on checklist_sections;
create policy cls_delete on checklist_sections for delete to authenticated
  using (
    workspace_role_of(workspace_of_checklist(checklist_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist(checklist_id))
      or checklist_creator(checklist_id) = auth.uid()
    )
  );

-- ===== checklist_items =====
drop policy if exists cli_insert on checklist_items;
create policy cli_insert on checklist_items for insert to authenticated
  with check (
    is_workspace_member(workspace_of_checklist_section(section_id))
    and workspace_role_of(workspace_of_checklist_section(section_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist_section(section_id))
      or checklist_creator_of_section(section_id) = auth.uid()
    )
    and created_by = auth.uid()
  );

drop policy if exists cli_update on checklist_items;
create policy cli_update on checklist_items for update to authenticated
  using (
    workspace_role_of(workspace_of_checklist_item(id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist_item(id))
      or checklist_creator_of_item(id) = auth.uid()
    )
  )
  with check (
    workspace_role_of(workspace_of_checklist_section(section_id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist_section(section_id))
      or checklist_creator_of_section(section_id) = auth.uid()
    )
  );

drop policy if exists cli_delete on checklist_items;
create policy cli_delete on checklist_items for delete to authenticated
  using (
    workspace_role_of(workspace_of_checklist_item(id)) in ('admin','diretor')
    and (
      is_workspace_admin(workspace_of_checklist_item(id))
      or checklist_creator_of_item(id) = auth.uid()
    )
  );
