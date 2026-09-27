-- ============================================================================
-- Automacao entre Kanbans (estilo Pipefy):
--   "quando o card ENTRAR na fase X (Kanban A) -> criar card na fase Z do Kanban Y"
-- Entrar = movido pra X ou criado direto em X (inclusive por outra automacao).
-- Dispara 1x por card por automacao; encadeamento ate 3 saltos (protege laco).
-- Spec: docs/specs/2026-09-27-kanban-e-automacoes.md §3
-- ============================================================================

create table if not exists kanban_automations (
  id uuid primary key default gen_random_uuid(),
  source_kanban_id uuid references kanbans(id) on delete cascade not null,
  source_phase_id uuid not null,
  target_kanban_id uuid references kanbans(id) on delete cascade not null,
  target_phase_id uuid not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- fases presas aos respectivos Kanbans; excluir a fase remove a regra
  constraint kanban_automations_source_phase_fk foreign key (source_phase_id, source_kanban_id)
    references kanban_phases(id, kanban_id) on delete cascade,
  constraint kanban_automations_target_phase_fk foreign key (target_phase_id, target_kanban_id)
    references kanban_phases(id, kanban_id) on delete cascade,
  constraint kanban_automations_not_self check (source_kanban_id <> target_kanban_id),
  constraint kanban_automations_unique unique (source_phase_id, target_phase_id)
);
create index if not exists idx_kanban_automations_source_phase
  on kanban_automations(source_phase_id) where active;
create index if not exists idx_kanban_automations_source_kanban on kanban_automations(source_kanban_id);
create index if not exists idx_kanban_automations_target_kanban on kanban_automations(target_kanban_id);

-- "ja disparou pra este card" (idempotencia)
create table if not exists kanban_automation_runs (
  automation_id uuid references kanban_automations(id) on delete cascade not null,
  source_card_id uuid references kanban_cards(id) on delete cascade not null,
  created_card_id uuid references kanban_cards(id) on delete set null,
  created_at timestamptz default now() not null,
  primary key (automation_id, source_card_id)
);
create index if not exists idx_kanban_automation_runs_source on kanban_automation_runs(source_card_id);
create index if not exists idx_kanban_automation_runs_created on kanban_automation_runs(created_card_id);

-- vinculo do card criado com a origem
alter table kanban_cards
  add column if not exists source_card_id uuid references kanban_cards(id) on delete set null;
alter table kanban_cards
  add column if not exists created_by_automation_id uuid references kanban_automations(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Integridade
-- ----------------------------------------------------------------------------
drop trigger if exists trg_kanban_automations_upd on kanban_automations;
create trigger trg_kanban_automations_upd before update on kanban_automations
  for each row execute procedure tg_updated_at();

-- origem e destino no MESMO workspace; na edicao so muda o "active"
create or replace function tg_kanban_automations_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.source_kanban_id := old.source_kanban_id;
    new.source_phase_id := old.source_phase_id;
    new.target_kanban_id := old.target_kanban_id;
    new.target_phase_id := old.target_phase_id;
    new.created_by := old.created_by;
    return new;
  end if;
  if workspace_of_kanban(new.source_kanban_id) is null
     or workspace_of_kanban(new.source_kanban_id) is distinct from workspace_of_kanban(new.target_kanban_id) then
    raise exception 'O Kanban de destino precisa ser do mesmo workspace' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_kanban_automations_guard on kanban_automations;
create trigger trg_kanban_automations_guard before insert or update on kanban_automations
  for each row execute procedure tg_kanban_automations_guard();

-- vinculo de automacao nao e editavel pela API (so pode virar null, que e o que o
-- "on delete set null" das FKs faz)
create or replace function tg_kanban_cards_keep_parent()
returns trigger language plpgsql as $$
begin
  new.kanban_id := old.kanban_id;
  new.created_by := old.created_by;
  if new.source_card_id is not null then
    new.source_card_id := old.source_card_id;
  end if;
  if new.created_by_automation_id is not null then
    new.created_by_automation_id := old.created_by_automation_id;
  end if;
  return new;
end;
$$;

-- card criado a mao nao nasce "de automacao"
drop policy if exists kbc_insert on kanban_cards;
create policy kbc_insert on kanban_cards for insert to authenticated
  with check (
    can_edit_kanban(kanban_id)
    and created_by = auth.uid()
    and source_card_id is null
    and created_by_automation_id is null
  );

-- ----------------------------------------------------------------------------
-- Disparo
-- ----------------------------------------------------------------------------
create or replace function tg_kanban_card_automations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a record;
  v_new_id uuid;
  v_pos double precision;
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_ctx jsonb;
begin
  if tg_op = 'UPDATE' and new.phase_id is not distinct from old.phase_id then
    return null;
  end if;
  -- encadeamento A -> B -> C vale ate 3 saltos; passou disso para (laco A -> B -> A)
  if pg_trigger_depth() > 3 then
    return null;
  end if;

  for a in
    select au.id, au.target_kanban_id, au.target_phase_id, tp.name as target_phase_name
    from kanban_automations au
    join kanban_phases tp on tp.id = au.target_phase_id
    where au.source_phase_id = new.phase_id
      and au.active
    order by au.created_at
  loop
    insert into kanban_automation_runs (automation_id, source_card_id)
    values (a.id, new.id)
    on conflict do nothing;
    if not found then
      continue;  -- ja disparou pra este card: sair e voltar nao duplica
    end if;

    select coalesce(min(position), 0) - 1024 into v_pos
    from kanban_cards
    where phase_id = a.target_phase_id;

    insert into kanban_cards (
      kanban_id, phase_id, title, description, due_date, tags, position,
      created_by, source_card_id, created_by_automation_id
    ) values (
      a.target_kanban_id, a.target_phase_id, new.title, new.description, new.due_date, new.tags,
      v_pos, coalesce(v_uid, new.created_by), new.id, a.id
    )
    returning id into v_new_id;

    update kanban_automation_runs
    set created_card_id = v_new_id
    where automation_id = a.id and source_card_id = new.id;

    -- auditoria do card criado (audit_log.user_id e obrigatorio)
    if v_uid is not null then
      select d.workspace_id,
             jsonb_build_object(
               'directory_id', d.id, 'directory_slug', d.slug, 'directory_name', d.name,
               'project_id', p.id, 'project_name', p.name,
               'kanban_id', k.id, 'kanban_name', k.name,
               'automation_id', a.id, 'source_card_id', new.id)
        into v_ws, v_ctx
      from kanbans k
      join projects p on p.id = k.project_id
      join directories d on d.id = p.directory_id
      where k.id = a.target_kanban_id;

      insert into audit_log (workspace_id, user_id, entity, entity_id, action, changes, context)
      values (
        v_ws, v_uid, 'kanban_card', v_new_id, 'create',
        jsonb_build_object('after', jsonb_build_object(
          'name', new.title, 'phase', a.target_phase_name, 'automacao', true)),
        v_ctx
      );
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function tg_kanban_card_automations() from public, anon, authenticated;

drop trigger if exists trg_kanban_cards_automations on kanban_cards;
create trigger trg_kanban_cards_automations
  after insert or update of phase_id on kanban_cards
  for each row execute function tg_kanban_card_automations();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table kanban_automations enable row level security;
alter table kanban_automation_runs enable row level security;

drop policy if exists ka_select on kanban_automations;
create policy ka_select on kanban_automations for select to authenticated
  using (is_workspace_member(workspace_of_kanban(source_kanban_id)));

drop policy if exists ka_insert on kanban_automations;
create policy ka_insert on kanban_automations for insert to authenticated
  with check (can_edit_kanban(source_kanban_id) and created_by = auth.uid());

drop policy if exists ka_update on kanban_automations;
create policy ka_update on kanban_automations for update to authenticated
  using (can_edit_kanban(source_kanban_id))
  with check (can_edit_kanban(source_kanban_id));

drop policy if exists ka_delete on kanban_automations;
create policy ka_delete on kanban_automations for delete to authenticated
  using (can_edit_kanban(source_kanban_id));

-- runs: so leitura (quem escreve e o trigger SECURITY DEFINER)
drop policy if exists kar_select on kanban_automation_runs;
create policy kar_select on kanban_automation_runs for select to authenticated
  using (is_workspace_member(workspace_of_kanban_card(source_card_id)));

do $$
begin
  begin alter publication supabase_realtime add table kanban_automations; exception when duplicate_object then null; end;
end $$;
