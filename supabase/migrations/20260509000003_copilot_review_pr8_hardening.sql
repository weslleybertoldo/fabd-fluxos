-- ============================================================================
-- Hotfix Copilot review PR #8: 3 fixes de RLS conforme decisao "delete so admin"
-- ============================================================================
-- Copilot apontou 3 problemas de over-permission criados pela migration
-- 20260509000000_diretor_responsavel_projeto.sql:
--
-- 1) DELETE em flows/phases/phase_responsibles/phase_fields/phase_field_values
--    usa `can_edit_flow`/`can_edit_phase` no `using` -> apos a migration
--    ampliar `can_edit_flow` pra diretor responsavel projeto, esse role passou
--    a poder DELETAR esses recursos. Decisao do user: delete so admin.
--
-- 2) `ph_update` usa `can_edit_flow OR is_phase_responsible` -> responsavel
--    da fase pode UPDATE qualquer coluna (name, due_date, order_index, etc).
--    Regra desejada: responsavel so pode mudar `completed_at` (concluir/reabrir).
--    Solucao: trigger BEFORE UPDATE que reverte colunas indevidas pra OLD
--    quando user nao tem `can_edit_flow` mas tem `is_phase_responsible`.
--
-- 3) `setPhaseCompleted` faz UPDATE phase_field_values SET current_phase_id =
--    nextPhase.id pra mover mobile fields. `pfv_update` exige
--    `is_phase_responsible(NEW.current_phase_id)` no WITH CHECK -> responsavel
--    da fase concluida nao eh responsavel da proxima -> RLS bloqueia silently.
--    Solucao: RPC SECURITY DEFINER `move_mobile_field_values` que valida
--    autorizacao na origem (caller pode editar a fase concluida) e bypassa
--    RLS pra fazer o move.
-- ============================================================================

-- 1) DELETE policies: voltar pra admin only ----------------------------------

drop policy if exists flw_delete on flows;
create policy flw_delete on flows for delete to authenticated
  using (is_workspace_admin(workspace_of_flow(id)));

drop policy if exists ph_delete on phases;
create policy ph_delete on phases for delete to authenticated
  using (is_workspace_admin(workspace_of_phase(id)));

drop policy if exists pr_delete on phase_responsibles;
create policy pr_delete on phase_responsibles for delete to authenticated
  using (is_workspace_admin(workspace_of_phase(phase_id)));

drop policy if exists pf_delete on phase_fields;
create policy pf_delete on phase_fields for delete to authenticated
  using (is_workspace_admin(workspace_of_phase(phase_id)));

drop policy if exists pfv_delete on phase_field_values;
create policy pfv_delete on phase_field_values for delete to authenticated
  using (is_workspace_admin(workspace_of_phase(current_phase_id)));

-- phase_attachments: storage policy ja era owner_or_admin (storage.sql),
-- e aqui no banco a tabela tambem precisa restringir:
drop policy if exists att_delete on phase_attachments;
create policy att_delete on phase_attachments for delete to authenticated
  using (
    is_workspace_admin(workspace_of_phase(phase_id))
    or uploaded_by = auth.uid()
  );

-- 2) ph_update: trigger restringe colunas pra responsavel da fase ------------

-- Helper que retorna true se user tem permissao gerencial (admin/diretor
-- responsavel projeto/owner do flow) — equivalente a `can_edit_flow`.
-- Mantido aqui pra clareza do trigger, ja existe como `can_edit_flow`.

create or replace function phases_responsavel_only_completed_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  -- Se user tem permissao gerencial, deixa passar tudo
  if can_edit_flow(NEW.flow_id, v_caller) then
    return NEW;
  end if;

  -- Se chegou aqui, so passou a policy ph_update via is_phase_responsible.
  -- Restringe NEW pra mudar APENAS completed_at + updated_at.
  -- Reverte qualquer outra coluna pra OLD.
  NEW.flow_id := OLD.flow_id;
  NEW.name := OLD.name;
  NEW.description := OLD.description;
  NEW.due_date := OLD.due_date;
  NEW.color := OLD.color;
  NEW.order_index := OLD.order_index;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  -- completed_at e updated_at podem mudar.
  return NEW;
end;
$$;

drop trigger if exists phases_responsavel_only_completed_at_trg on phases;
create trigger phases_responsavel_only_completed_at_trg
  before update on phases
  for each row
  execute function phases_responsavel_only_completed_at();

revoke execute on function phases_responsavel_only_completed_at() from public, anon;
-- Trigger functions sao executadas pelo Postgres, nao chamadas direto.
-- Grant authenticated nao eh estritamente necessario mas evita surpresa.
grant execute on function phases_responsavel_only_completed_at() to authenticated, service_role;

-- 3) RPC pra mover mobile field values (bypassa pfv_update RLS) --------------

create or replace function move_mobile_field_values(
  p_from_phase_id uuid,
  p_to_phase_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_flow_id uuid;
  v_to_flow_id uuid;
  v_count int;
begin
  if v_caller is null then
    raise exception 'Nao autenticado';
  end if;

  -- Origem e destino tem que ser do mesmo flow (sanity check)
  select flow_id into v_flow_id from phases where id = p_from_phase_id;
  select flow_id into v_to_flow_id from phases where id = p_to_phase_id;
  if v_flow_id is null or v_to_flow_id is null then
    raise exception 'Fase de origem ou destino nao encontrada';
  end if;
  if v_flow_id <> v_to_flow_id then
    raise exception 'Fases pertencem a flows diferentes';
  end if;

  -- Caller precisa poder editar a fase de origem (gerencial OU responsavel
  -- da fase de origem que esta concluindo).
  if not (
    can_edit_flow(v_flow_id, v_caller)
    or is_phase_responsible(p_from_phase_id, v_caller)
  ) then
    raise exception 'Sem permissao pra mover mobile fields desta fase';
  end if;

  -- Move so mobile fields (filtrado pelo phase_field_id que esta em
  -- phase_fields com mode=mobile)
  with moved as (
    update phase_field_values pfv
    set current_phase_id = p_to_phase_id,
        updated_at = now()
    where pfv.current_phase_id = p_from_phase_id
      and pfv.phase_field_id in (
        select id from phase_fields where mode = 'mobile'
      )
    returning 1
  )
  select count(*) into v_count from moved;

  return v_count;
end;
$$;

revoke execute on function move_mobile_field_values(uuid, uuid) from public, anon;
grant execute on function move_mobile_field_values(uuid, uuid) to authenticated, service_role;

comment on function move_mobile_field_values(uuid, uuid) is
  'Move phase_field_values com mode=mobile da fase concluida pra proxima fase nao-concluida. Bypassa pfv_update RLS (que exigiria is_phase_responsible da fase destino). Caller autorizado = admin/diretor projeto/owner flow OU responsavel da fase de origem.';
