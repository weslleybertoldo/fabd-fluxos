-- ============================================================================
-- Kanban (estilo Pipefy): quadro com fases (colunas) e cards que andam entre elas.
-- Mora no projeto, ao lado de fluxos e checklists.
-- Spec: docs/specs/2026-09-27-kanban-e-automacoes.md
--
-- Permissoes (espelham fluxos/checklists):
--   ver              -> membro ativo do workspace
--   criar Kanban     -> admin ou diretor
--   editar Kanban, fases e qualquer card -> admin, diretor que criou o Kanban,
--                       diretor responsavel do projeto (can_edit_kanban)
--   mover/editar card -> tambem os responsaveis do card
--   comentar         -> admin, diretor ou responsavel do card
--   excluir Kanban   -> so admin (igual fluxo)
-- ============================================================================

alter type entity_type add value if not exists 'kanban';
alter type entity_type add value if not exists 'kanban_card';

-- ----------------------------------------------------------------------------
-- Tabelas
-- ----------------------------------------------------------------------------
create table if not exists kanbans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  order_index int not null default 0,  -- posicao no board do projeto (espaco de flows/checklists)
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index if not exists idx_kanbans_project on kanbans(project_id, order_index);

create table if not exists kanban_phases (
  id uuid primary key default gen_random_uuid(),
  kanban_id uuid references kanbans(id) on delete cascade not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  position int not null default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  constraint kanban_phases_id_kanban_key unique (id, kanban_id)
);
create index if not exists idx_kanban_phases_kanban on kanban_phases(kanban_id, position);

create table if not exists kanban_cards (
  id uuid primary key default gen_random_uuid(),
  kanban_id uuid references kanbans(id) on delete cascade not null,
  phase_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text check (description is null or char_length(description) <= 5000),
  due_date timestamptz,
  tags text[] not null default '{}',
  position double precision not null default 0,  -- ordem na fase (meio dos vizinhos)
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  -- fase tem que ser do mesmo Kanban; NO ACTION impede apagar fase que ainda tem card
  constraint kanban_cards_phase_fk foreign key (phase_id, kanban_id)
    references kanban_phases(id, kanban_id)
);
create index if not exists idx_kanban_cards_kanban on kanban_cards(kanban_id);
create index if not exists idx_kanban_cards_phase on kanban_cards(phase_id, position);

create table if not exists kanban_card_responsibles (
  card_id uuid references kanban_cards(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  assigned_by uuid references auth.users(id) not null,
  assigned_at timestamptz default now() not null,
  primary key (card_id, user_id)
);
create index if not exists idx_kanban_card_resp_user on kanban_card_responsibles(user_id);

create table if not exists kanban_card_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references kanban_cards(id) on delete cascade not null,
  author_id uuid references auth.users(id) not null,
  content text not null check (char_length(btrim(content)) between 1 and 5000),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);
create index if not exists idx_kanban_card_comments_card on kanban_card_comments(card_id, created_at);

-- ----------------------------------------------------------------------------
-- Triggers: updated_at + colunas de "lugar" imutaveis (nao se move Kanban,
-- fase, card ou comentario pra outro pai pela API)
-- ----------------------------------------------------------------------------
drop trigger if exists trg_kanbans_upd on kanbans;
create trigger trg_kanbans_upd before update on kanbans
  for each row execute procedure tg_updated_at();
drop trigger if exists trg_kanban_phases_upd on kanban_phases;
create trigger trg_kanban_phases_upd before update on kanban_phases
  for each row execute procedure tg_updated_at();
drop trigger if exists trg_kanban_cards_upd on kanban_cards;
create trigger trg_kanban_cards_upd before update on kanban_cards
  for each row execute procedure tg_updated_at();
drop trigger if exists trg_kanban_card_comments_upd on kanban_card_comments;
create trigger trg_kanban_card_comments_upd before update on kanban_card_comments
  for each row execute procedure tg_updated_at();

create or replace function tg_kanbans_keep_parent()
returns trigger language plpgsql as $$
begin
  new.project_id := old.project_id;
  new.created_by := old.created_by;
  return new;
end;
$$;
drop trigger if exists trg_kanbans_keep_parent on kanbans;
create trigger trg_kanbans_keep_parent before update on kanbans
  for each row execute procedure tg_kanbans_keep_parent();

create or replace function tg_kanban_phases_keep_parent()
returns trigger language plpgsql as $$
begin
  new.kanban_id := old.kanban_id;
  return new;
end;
$$;
drop trigger if exists trg_kanban_phases_keep_parent on kanban_phases;
create trigger trg_kanban_phases_keep_parent before update on kanban_phases
  for each row execute procedure tg_kanban_phases_keep_parent();

create or replace function tg_kanban_cards_keep_parent()
returns trigger language plpgsql as $$
begin
  new.kanban_id := old.kanban_id;
  new.created_by := old.created_by;
  return new;
end;
$$;
drop trigger if exists trg_kanban_cards_keep_parent on kanban_cards;
create trigger trg_kanban_cards_keep_parent before update on kanban_cards
  for each row execute procedure tg_kanban_cards_keep_parent();

create or replace function tg_kanban_card_comments_keep_parent()
returns trigger language plpgsql as $$
begin
  new.card_id := old.card_id;
  new.author_id := old.author_id;
  return new;
end;
$$;
drop trigger if exists trg_kanban_card_comments_keep_parent on kanban_card_comments;
create trigger trg_kanban_card_comments_keep_parent before update on kanban_card_comments
  for each row execute procedure tg_kanban_card_comments_keep_parent();

-- ----------------------------------------------------------------------------
-- Helpers de permissao (mesmo estilo de workspace_of_flow / can_edit_flow)
-- ----------------------------------------------------------------------------
create or replace function workspace_of_kanban(k_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id
  from kanbans k
  join projects p on p.id = k.project_id
  join directories d on d.id = p.directory_id
  where k.id = k_id;
$$;

create or replace function kanban_of_card(c_id uuid)
returns uuid language sql stable as $$
  select kanban_id from kanban_cards where id = c_id;
$$;

create or replace function workspace_of_kanban_card(c_id uuid)
returns uuid language sql stable as $$
  select workspace_of_kanban(kanban_id) from kanban_cards where id = c_id;
$$;

-- admin; diretor que criou o Kanban; diretor responsavel do projeto
create or replace function can_edit_kanban(k_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select case
    when is_workspace_admin(workspace_of_kanban(k_id), uid) then true
    when workspace_role_of(workspace_of_kanban(k_id), uid) = 'diretor' and (
      exists(select 1 from kanbans where id = k_id and created_by = uid)
      or exists(
        select 1 from kanbans k
        join projects p on p.id = k.project_id
        where k.id = k_id and p.responsible_user_id = uid
      )
    ) then true
    else false
  end;
$$;

create or replace function is_kanban_card_responsible(c_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select exists(
    select 1 from kanban_card_responsibles
    where card_id = c_id and user_id = uid
  );
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table kanbans enable row level security;
alter table kanban_phases enable row level security;
alter table kanban_cards enable row level security;
alter table kanban_card_responsibles enable row level security;
alter table kanban_card_comments enable row level security;

-- ===== kanbans =====
drop policy if exists kb_select on kanbans;
create policy kb_select on kanbans for select to authenticated
  using (is_workspace_member(workspace_of_project(project_id)));

drop policy if exists kb_insert on kanbans;
create policy kb_insert on kanbans for insert to authenticated
  with check (
    is_workspace_member(workspace_of_project(project_id))
    and workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );

drop policy if exists kb_update on kanbans;
create policy kb_update on kanbans for update to authenticated
  using (can_edit_kanban(id))
  with check (can_edit_kanban(id));

drop policy if exists kb_delete on kanbans;
create policy kb_delete on kanbans for delete to authenticated
  using (is_workspace_admin(workspace_of_kanban(id)));

-- ===== kanban_phases =====
drop policy if exists kbp_select on kanban_phases;
create policy kbp_select on kanban_phases for select to authenticated
  using (is_workspace_member(workspace_of_kanban(kanban_id)));

drop policy if exists kbp_insert on kanban_phases;
create policy kbp_insert on kanban_phases for insert to authenticated
  with check (can_edit_kanban(kanban_id));

drop policy if exists kbp_update on kanban_phases;
create policy kbp_update on kanban_phases for update to authenticated
  using (can_edit_kanban(kanban_id))
  with check (can_edit_kanban(kanban_id));

drop policy if exists kbp_delete on kanban_phases;
create policy kbp_delete on kanban_phases for delete to authenticated
  using (can_edit_kanban(kanban_id));

-- ===== kanban_cards =====
drop policy if exists kbc_select on kanban_cards;
create policy kbc_select on kanban_cards for select to authenticated
  using (is_workspace_member(workspace_of_kanban(kanban_id)));

drop policy if exists kbc_insert on kanban_cards;
create policy kbc_insert on kanban_cards for insert to authenticated
  with check (can_edit_kanban(kanban_id) and created_by = auth.uid());

drop policy if exists kbc_update on kanban_cards;
create policy kbc_update on kanban_cards for update to authenticated
  using (
    can_edit_kanban(kanban_id)
    or (is_kanban_card_responsible(id) and is_workspace_member(workspace_of_kanban(kanban_id)))
  )
  with check (
    can_edit_kanban(kanban_id)
    or (is_kanban_card_responsible(id) and is_workspace_member(workspace_of_kanban(kanban_id)))
  );

drop policy if exists kbc_delete on kanban_cards;
create policy kbc_delete on kanban_cards for delete to authenticated
  using (can_edit_kanban(kanban_id));

-- ===== kanban_card_responsibles =====
drop policy if exists kcr_select on kanban_card_responsibles;
create policy kcr_select on kanban_card_responsibles for select to authenticated
  using (is_workspace_member(workspace_of_kanban_card(card_id)));

drop policy if exists kcr_insert on kanban_card_responsibles;
create policy kcr_insert on kanban_card_responsibles for insert to authenticated
  with check (
    can_edit_kanban(kanban_of_card(card_id))
    and assigned_by = auth.uid()
    and is_workspace_member(workspace_of_kanban_card(card_id), user_id)
  );

drop policy if exists kcr_delete on kanban_card_responsibles;
create policy kcr_delete on kanban_card_responsibles for delete to authenticated
  using (can_edit_kanban(kanban_of_card(card_id)));

-- ===== kanban_card_comments =====
drop policy if exists kcc_select on kanban_card_comments;
create policy kcc_select on kanban_card_comments for select to authenticated
  using (is_workspace_member(workspace_of_kanban_card(card_id)));

drop policy if exists kcc_insert on kanban_card_comments;
create policy kcc_insert on kanban_card_comments for insert to authenticated
  with check (
    is_workspace_member(workspace_of_kanban_card(card_id))
    and (
      workspace_role_of(workspace_of_kanban_card(card_id)) in ('admin','diretor')
      or is_kanban_card_responsible(card_id)
    )
    and author_id = auth.uid()
  );

drop policy if exists kcc_update on kanban_card_comments;
create policy kcc_update on kanban_card_comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists kcc_delete on kanban_card_comments;
create policy kcc_delete on kanban_card_comments for delete to authenticated
  using (author_id = auth.uid() or is_workspace_admin(workspace_of_kanban_card(card_id)));

-- ----------------------------------------------------------------------------
-- Realtime (o quadro atualiza sozinho pra quem esta olhando)
-- ----------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table kanbans; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table kanban_phases; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table kanban_cards; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table kanban_card_responsibles; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table kanban_card_comments; exception when duplicate_object then null; end;
end $$;
