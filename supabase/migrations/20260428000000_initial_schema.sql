-- ============================================================================
-- FABD Fluxos — schema inicial
-- ============================================================================
-- Hierarquia: Workspace > Diretoria > Projeto > Fluxo > Fase
-- Auth: Google OAuth via Supabase
-- Permissões: admin / diretor / membro (RLS strict)
-- Audit log: application-level (helper function)
-- ============================================================================

-- Extensões
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================================
-- Tipos enumerados
-- ============================================================================
create type workspace_role as enum ('admin', 'diretor', 'membro');
create type member_status as enum ('pending', 'active', 'blocked');
create type project_status as enum ('active', 'archived', 'completed');
create type flow_type as enum ('continuous', 'non_continuous');
create type flow_status as enum ('active', 'completed', 'archived');
create type field_type as enum ('text', 'textarea', 'checkbox', 'number', 'date');
create type field_mode as enum ('fixed', 'mobile');  -- mobile passa pra próxima fase ao concluir
create type entity_type as enum (
  'workspace','directory','project','flow','phase','comment',
  'attachment','field','field_value','tag','member','reminder','list_item'
);
create type notification_type as enum (
  'phase_due_soon','phase_overdue','flow_completed','mention',
  'member_request','member_approved','responsible_assigned'
);

-- ============================================================================
-- Workspaces
-- ============================================================================
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role workspace_role not null default 'membro',
  status member_status not null default 'pending',
  -- cache de dados Google pra mostrar foto/nome sem cada lookup
  google_full_name text,
  google_avatar_url text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(workspace_id, user_id)
);

create index idx_members_workspace on workspace_members(workspace_id, status);
create index idx_members_user on workspace_members(user_id);

-- ============================================================================
-- Diretorias (Marketing, Financeira, Técnica, etc — estilo Slack channels)
-- ============================================================================
create table directories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  name text not null,
  slug text not null,
  description text,
  icon text,           -- Iconify name ex 'mdi:bullhorn-outline'
  color text,          -- hex ex '#1E3A8A'
  order_index int not null default 0,
  responsible_user_id uuid references auth.users(id),
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(workspace_id, slug)
);

create index idx_directories_workspace on directories(workspace_id, order_index);

-- ============================================================================
-- Projetos (vivem dentro de uma diretoria)
-- ============================================================================
create table projects (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid references directories(id) on delete cascade not null,
  name text not null,
  description text,
  responsible_user_id uuid references auth.users(id),  -- recebe notif de TODAS as fases
  status project_status not null default 'active',
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  archived_at timestamptz,
  completed_at timestamptz
);

create index idx_projects_directory on projects(directory_id, status, order_index);
create index idx_projects_responsible on projects(responsible_user_id) where status = 'active';

-- ============================================================================
-- Fluxos (vivem dentro de um projeto — projeto pode ter múltiplos fluxos)
-- ============================================================================
create table flows (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  description text,
  type flow_type not null default 'continuous',
  status flow_status not null default 'active',
  order_index int not null default 0,  -- ordem visual lado-a-lado no projeto
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  completed_at timestamptz
);

create index idx_flows_project on flows(project_id, status, order_index);

-- ============================================================================
-- Fases (vivem dentro de um fluxo)
-- ============================================================================
create table phases (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid references flows(id) on delete cascade not null,
  name text not null,
  description text,
  order_index int not null default 0,    -- ordem manual (drag-drop)
  due_date timestamptz,                  -- se setada, tem prioridade na ordenação visual
  completed_at timestamptz,
  color text,                            -- override visual se necessário
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_phases_flow on phases(flow_id, order_index);
create index idx_phases_due on phases(due_date) where completed_at is null;

-- responsáveis por fase (multi)
create table phase_responsibles (
  phase_id uuid references phases(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  assigned_by uuid references auth.users(id) not null,
  assigned_at timestamptz default now() not null,
  primary key (phase_id, user_id)
);

create index idx_phase_resp_user on phase_responsibles(user_id);

-- ============================================================================
-- Campos (textos digitáveis, checkboxes) por fase
-- ============================================================================
create table phase_fields (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid references phases(id) on delete cascade not null,
  type field_type not null,
  label text not null,
  mode field_mode not null default 'fixed',
  order_index int not null default 0,
  required boolean not null default false,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_fields_phase on phase_fields(phase_id, order_index);

create table phase_field_values (
  id uuid primary key default gen_random_uuid(),
  phase_field_id uuid references phase_fields(id) on delete cascade not null,
  -- fase atual onde o valor está. Pra mode=mobile, atualiza ao avançar fase.
  current_phase_id uuid references phases(id) on delete cascade not null,
  value_text text,
  value_bool boolean,
  value_number numeric,
  value_date timestamptz,
  updated_by uuid references auth.users(id) not null,
  updated_at timestamptz default now() not null,
  unique(phase_field_id, current_phase_id)
);

create index idx_field_values_phase on phase_field_values(current_phase_id);

-- ============================================================================
-- Comentários nativos do fluxo (persistem por todas as fases)
-- ============================================================================
create table flow_comments (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid references flows(id) on delete cascade not null,
  author_id uuid references auth.users(id) not null,
  content text not null,                 -- plain text com auto-link (regex front)
  -- contexto opcional: comentário deixado durante uma fase específica
  context_phase_id uuid references phases(id) on delete set null,
  parent_id uuid references flow_comments(id) on delete cascade,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  deleted_at timestamptz
);

create index idx_comments_flow on flow_comments(flow_id, created_at desc) where deleted_at is null;

-- ============================================================================
-- Anexos por fase
-- ============================================================================
create table phase_attachments (
  id uuid primary key default gen_random_uuid(),
  phase_id uuid references phases(id) on delete cascade not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  storage_path text not null,            -- ex 'fabd/flow-{id}/phase-{id}/file.pdf'
  storage_bucket text not null default 'attachments',
  uploaded_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  deleted_at timestamptz
);

create index idx_attachments_phase on phase_attachments(phase_id) where deleted_at is null;

-- ============================================================================
-- Tags (workspace-level, reutilizáveis em fluxos)
-- ============================================================================
create table tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  name text not null,
  color text not null default '#64748B',
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  unique(workspace_id, name)
);

create table flow_tags (
  flow_id uuid references flows(id) on delete cascade not null,
  tag_id uuid references tags(id) on delete cascade not null,
  added_by uuid references auth.users(id) not null,
  added_at timestamptz default now() not null,
  primary key (flow_id, tag_id)
);

-- ============================================================================
-- Audit log — toda mutação relevante
-- ============================================================================
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id) not null,
  entity entity_type not null,
  entity_id uuid not null,
  action text not null,                  -- 'create','update','delete','complete','reorder','attach','assign'
  changes jsonb,                         -- {before:{...}, after:{...}} OU {summary:'...'}
  context jsonb,                         -- ex { flow_id, project_id } pra facilitar query
  created_at timestamptz default now() not null
);

create index idx_audit_workspace_time on audit_log(workspace_id, created_at desc);
create index idx_audit_entity on audit_log(entity, entity_id, created_at desc);
create index idx_audit_user on audit_log(user_id, created_at desc);
-- index funcional pra filtrar por flow_id armazenado em context
create index idx_audit_flow on audit_log((context->>'flow_id')) where context ? 'flow_id';

-- ============================================================================
-- Notificações
-- ============================================================================
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  type notification_type not null,
  title text not null,
  body text,
  entity entity_type,
  entity_id uuid,
  link text,                             -- deep link in-app
  read_at timestamptz,
  created_at timestamptz default now() not null
);

create index idx_notif_user_unread on notifications(user_id, created_at desc) where read_at is null;
create index idx_notif_user_all on notifications(user_id, created_at desc);

-- ============================================================================
-- Lembretes (alternativa simples a fluxo, dentro de projeto)
-- ============================================================================
create table reminders (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  description text,
  due_date timestamptz,
  completed_at timestamptz,
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_reminders_project on reminders(project_id, due_date);

-- ============================================================================
-- Listas simples (alternativa a fluxo) + items
-- ============================================================================
create table simple_lists (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade not null,
  name text not null,
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create table simple_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references simple_lists(id) on delete cascade not null,
  text text not null,
  completed_at timestamptz,
  order_index int not null default 0,
  created_by uuid references auth.users(id) not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index idx_list_items_list on simple_list_items(list_id, order_index);

-- ============================================================================
-- Helpers de permissão (SECURITY DEFINER pra evitar recursão RLS)
-- ============================================================================
create or replace function is_workspace_member(ws_id uuid, uid uuid default auth.uid())
returns boolean
language sql security definer set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id
      and user_id = uid
      and status = 'active'
  );
$$;

create or replace function workspace_role_of(ws_id uuid, uid uuid default auth.uid())
returns workspace_role
language sql security definer set search_path = public
as $$
  select role from workspace_members
  where workspace_id = ws_id
    and user_id = uid
    and status = 'active'
  limit 1;
$$;

create or replace function is_workspace_admin(ws_id uuid, uid uuid default auth.uid())
returns boolean
language sql security definer set search_path = public
as $$
  select workspace_role_of(ws_id, uid) = 'admin';
$$;

-- workspace dono via diretoria/projeto/fluxo/fase (helpers de lookup)
create or replace function workspace_of_directory(d_id uuid)
returns uuid language sql stable as $$
  select workspace_id from directories where id = d_id;
$$;

create or replace function workspace_of_project(p_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id from projects p
  join directories d on d.id = p.directory_id
  where p.id = p_id;
$$;

create or replace function workspace_of_flow(f_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id from flows f
  join projects p on p.id = f.project_id
  join directories d on d.id = p.directory_id
  where f.id = f_id;
$$;

create or replace function workspace_of_phase(ph_id uuid)
returns uuid language sql stable as $$
  select d.workspace_id from phases ph
  join flows f on f.id = ph.flow_id
  join projects p on p.id = f.project_id
  join directories d on d.id = p.directory_id
  where ph.id = ph_id;
$$;

-- diretor pode editar APENAS o que ele criou
create or replace function can_edit_flow(f_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select case
    when is_workspace_admin(workspace_of_flow(f_id), uid) then true
    when workspace_role_of(workspace_of_flow(f_id), uid) = 'diretor'
      and exists(select 1 from flows where id = f_id and created_by = uid) then true
    else false
  end;
$$;

create or replace function can_edit_phase(ph_id uuid, uid uuid default auth.uid())
returns boolean language sql stable as $$
  select can_edit_flow((select flow_id from phases where id = ph_id), uid);
$$;

-- ============================================================================
-- Audit log helper — sempre chamar via aplicação
-- ============================================================================
create or replace function log_audit(
  p_workspace_id uuid,
  p_entity entity_type,
  p_entity_id uuid,
  p_action text,
  p_changes jsonb default null,
  p_context jsonb default null
) returns void
language sql security definer set search_path = public
as $$
  insert into audit_log(workspace_id, user_id, entity, entity_id, action, changes, context)
  values (p_workspace_id, auth.uid(), p_entity, p_entity_id, p_action, p_changes, p_context);
$$;

-- ============================================================================
-- updated_at automático
-- ============================================================================
create or replace function tg_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger trg_workspaces_upd before update on workspaces for each row execute procedure tg_updated_at();
create trigger trg_members_upd before update on workspace_members for each row execute procedure tg_updated_at();
create trigger trg_directories_upd before update on directories for each row execute procedure tg_updated_at();
create trigger trg_projects_upd before update on projects for each row execute procedure tg_updated_at();
create trigger trg_flows_upd before update on flows for each row execute procedure tg_updated_at();
create trigger trg_phases_upd before update on phases for each row execute procedure tg_updated_at();
create trigger trg_fields_upd before update on phase_fields for each row execute procedure tg_updated_at();
create trigger trg_field_values_upd before update on phase_field_values for each row execute procedure tg_updated_at();
create trigger trg_comments_upd before update on flow_comments for each row execute procedure tg_updated_at();
create trigger trg_reminders_upd before update on reminders for each row execute procedure tg_updated_at();
create trigger trg_lists_upd before update on simple_lists for each row execute procedure tg_updated_at();
create trigger trg_list_items_upd before update on simple_list_items for each row execute procedure tg_updated_at();

-- ============================================================================
-- RLS — habilitar tudo
-- ============================================================================
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table directories enable row level security;
alter table projects enable row level security;
alter table flows enable row level security;
alter table phases enable row level security;
alter table phase_responsibles enable row level security;
alter table phase_fields enable row level security;
alter table phase_field_values enable row level security;
alter table flow_comments enable row level security;
alter table phase_attachments enable row level security;
alter table tags enable row level security;
alter table flow_tags enable row level security;
alter table audit_log enable row level security;
alter table notifications enable row level security;
alter table reminders enable row level security;
alter table simple_lists enable row level security;
alter table simple_list_items enable row level security;

-- REVOKE explícito (defesa em camadas — lição de Feedback Supabase REVOKE Grants Defesa em Camadas)
revoke all on workspaces, workspace_members, directories, projects, flows, phases,
  phase_responsibles, phase_fields, phase_field_values, flow_comments, phase_attachments,
  tags, flow_tags, audit_log, notifications, reminders, simple_lists, simple_list_items
  from anon;

-- ============================================================================
-- POLICIES
-- ============================================================================

-- workspaces: vê os que é membro
create policy ws_select on workspaces for select to authenticated
  using (is_workspace_member(id));
create policy ws_insert on workspaces for insert to authenticated
  with check (created_by = auth.uid());
create policy ws_update on workspaces for update to authenticated
  using (is_workspace_admin(id))
  with check (is_workspace_admin(id));
create policy ws_delete on workspaces for delete to authenticated
  using (is_workspace_admin(id));

-- workspace_members
-- usuário sempre vê seu próprio registro (pra saber se foi aprovado)
create policy wm_select_self on workspace_members for select to authenticated
  using (user_id = auth.uid());
-- members ativos veem outros members do mesmo workspace
create policy wm_select_peers on workspace_members for select to authenticated
  using (is_workspace_member(workspace_id));
-- usuário pode criar seu request (pending)
create policy wm_insert_self on workspace_members for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending');
-- admin gerencia members (aprova, muda papel, bloqueia)
create policy wm_update_admin on workspace_members for update to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy wm_delete_admin on workspace_members for delete to authenticated
  using (is_workspace_admin(workspace_id));

-- directories
create policy dir_select on directories for select to authenticated
  using (is_workspace_member(workspace_id));
create policy dir_insert on directories for insert to authenticated
  with check (is_workspace_admin(workspace_id) and created_by = auth.uid());
create policy dir_update on directories for update to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy dir_delete on directories for delete to authenticated
  using (is_workspace_admin(workspace_id));

-- projects
create policy prj_select on projects for select to authenticated
  using (is_workspace_member(workspace_of_directory(directory_id)));
create policy prj_insert on projects for insert to authenticated
  with check (
    is_workspace_member(workspace_of_directory(directory_id))
    and workspace_role_of(workspace_of_directory(directory_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );
create policy prj_update on projects for update to authenticated
  using (
    is_workspace_admin(workspace_of_directory(directory_id))
    or (workspace_role_of(workspace_of_directory(directory_id)) = 'diretor'
        and created_by = auth.uid())
  );
create policy prj_delete on projects for delete to authenticated
  using (is_workspace_admin(workspace_of_directory(directory_id)));

-- flows: diretor edita só os que CRIOU
create policy flw_select on flows for select to authenticated
  using (is_workspace_member(workspace_of_project(project_id)));
create policy flw_insert on flows for insert to authenticated
  with check (
    is_workspace_member(workspace_of_project(project_id))
    and workspace_role_of(workspace_of_project(project_id)) in ('admin','diretor')
    and created_by = auth.uid()
  );
create policy flw_update on flows for update to authenticated
  using (can_edit_flow(id))
  with check (can_edit_flow(id));
create policy flw_delete on flows for delete to authenticated
  using (can_edit_flow(id));

-- phases: editam quem pode editar o flow dono
create policy ph_select on phases for select to authenticated
  using (is_workspace_member(workspace_of_flow(flow_id)));
create policy ph_insert on phases for insert to authenticated
  with check (can_edit_flow(flow_id) and created_by = auth.uid());
create policy ph_update on phases for update to authenticated
  using (can_edit_flow(flow_id))
  with check (can_edit_flow(flow_id));
create policy ph_delete on phases for delete to authenticated
  using (can_edit_flow(flow_id));

-- phase_responsibles
create policy pr_select on phase_responsibles for select to authenticated
  using (is_workspace_member(workspace_of_phase(phase_id)));
create policy pr_insert on phase_responsibles for insert to authenticated
  with check (can_edit_phase(phase_id));
create policy pr_delete on phase_responsibles for delete to authenticated
  using (can_edit_phase(phase_id));

-- phase_fields
create policy pf_select on phase_fields for select to authenticated
  using (is_workspace_member(workspace_of_phase(phase_id)));
create policy pf_insert on phase_fields for insert to authenticated
  with check (can_edit_phase(phase_id) and created_by = auth.uid());
create policy pf_update on phase_fields for update to authenticated
  using (can_edit_phase(phase_id))
  with check (can_edit_phase(phase_id));
create policy pf_delete on phase_fields for delete to authenticated
  using (can_edit_phase(phase_id));

-- phase_field_values: qualquer membro pode preencher (membro também interage)
create policy pfv_select on phase_field_values for select to authenticated
  using (is_workspace_member(workspace_of_phase(current_phase_id)));
create policy pfv_insert on phase_field_values for insert to authenticated
  with check (is_workspace_member(workspace_of_phase(current_phase_id)) and updated_by = auth.uid());
create policy pfv_update on phase_field_values for update to authenticated
  using (is_workspace_member(workspace_of_phase(current_phase_id)))
  with check (updated_by = auth.uid());
create policy pfv_delete on phase_field_values for delete to authenticated
  using (can_edit_phase(current_phase_id));

-- comments: qualquer membro comenta; só autor edita/deleta o seu
create policy cmt_select on flow_comments for select to authenticated
  using (is_workspace_member(workspace_of_flow(flow_id)));
create policy cmt_insert on flow_comments for insert to authenticated
  with check (is_workspace_member(workspace_of_flow(flow_id)) and author_id = auth.uid());
create policy cmt_update_self on flow_comments for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
create policy cmt_delete_self on flow_comments for delete to authenticated
  using (author_id = auth.uid() or is_workspace_admin(workspace_of_flow(flow_id)));

-- attachments
create policy att_select on phase_attachments for select to authenticated
  using (is_workspace_member(workspace_of_phase(phase_id)));
create policy att_insert on phase_attachments for insert to authenticated
  with check (is_workspace_member(workspace_of_phase(phase_id)) and uploaded_by = auth.uid());
create policy att_delete on phase_attachments for delete to authenticated
  using (uploaded_by = auth.uid() or can_edit_phase(phase_id));

-- tags
create policy tag_select on tags for select to authenticated
  using (is_workspace_member(workspace_id));
create policy tag_insert on tags for insert to authenticated
  with check (is_workspace_member(workspace_id) and created_by = auth.uid());
create policy tag_update on tags for update to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));
create policy tag_delete on tags for delete to authenticated
  using (is_workspace_admin(workspace_id));

create policy ftag_select on flow_tags for select to authenticated
  using (is_workspace_member(workspace_of_flow(flow_id)));
create policy ftag_insert on flow_tags for insert to authenticated
  with check (can_edit_flow(flow_id) and added_by = auth.uid());
create policy ftag_delete on flow_tags for delete to authenticated
  using (can_edit_flow(flow_id));

-- audit_log: admin vê tudo do workspace; demais veem entradas relacionadas a recursos que podem ler
-- Pra simplificar: todo membro vê o audit_log do workspace (transparência interna)
create policy audit_select on audit_log for select to authenticated
  using (is_workspace_member(workspace_id));
-- Inserts só via SECURITY DEFINER (log_audit), nunca direto
create policy audit_insert_blocked on audit_log for insert to authenticated
  with check (false);

-- notifications: usuário só vê as suas
create policy notif_select on notifications for select to authenticated
  using (user_id = auth.uid());
create policy notif_update on notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- reminders
create policy rem_select on reminders for select to authenticated
  using (is_workspace_member(workspace_of_project(project_id)));
create policy rem_insert on reminders for insert to authenticated
  with check (is_workspace_member(workspace_of_project(project_id)) and created_by = auth.uid());
create policy rem_update on reminders for update to authenticated
  using (
    is_workspace_admin(workspace_of_project(project_id))
    or created_by = auth.uid()
  );
create policy rem_delete on reminders for delete to authenticated
  using (
    is_workspace_admin(workspace_of_project(project_id))
    or created_by = auth.uid()
  );

-- simple_lists
create policy sl_select on simple_lists for select to authenticated
  using (is_workspace_member(workspace_of_project(project_id)));
create policy sl_insert on simple_lists for insert to authenticated
  with check (is_workspace_member(workspace_of_project(project_id)) and created_by = auth.uid());
create policy sl_update on simple_lists for update to authenticated
  using (
    is_workspace_admin(workspace_of_project(project_id))
    or created_by = auth.uid()
  );
create policy sl_delete on simple_lists for delete to authenticated
  using (
    is_workspace_admin(workspace_of_project(project_id))
    or created_by = auth.uid()
  );

create policy sli_select on simple_list_items for select to authenticated
  using (
    exists(select 1 from simple_lists sl where sl.id = list_id
           and is_workspace_member(workspace_of_project(sl.project_id)))
  );
create policy sli_insert on simple_list_items for insert to authenticated
  with check (
    exists(select 1 from simple_lists sl where sl.id = list_id
           and is_workspace_member(workspace_of_project(sl.project_id)))
    and created_by = auth.uid()
  );
create policy sli_update on simple_list_items for update to authenticated
  using (
    exists(select 1 from simple_lists sl where sl.id = list_id
           and is_workspace_member(workspace_of_project(sl.project_id)))
  );
create policy sli_delete on simple_list_items for delete to authenticated
  using (
    exists(select 1 from simple_lists sl where sl.id = list_id
           and is_workspace_member(workspace_of_project(sl.project_id)))
  );

-- ============================================================================
-- Realtime (habilitar nas tabelas que precisam de live updates)
-- ============================================================================
alter publication supabase_realtime add table phases;
alter publication supabase_realtime add table flows;
alter publication supabase_realtime add table flow_comments;
alter publication supabase_realtime add table phase_field_values;
alter publication supabase_realtime add table audit_log;
alter publication supabase_realtime add table notifications;

-- ============================================================================
-- Storage bucket pra anexos (rodar via Supabase dashboard ou separado)
-- ============================================================================
-- INSERT INTO storage.buckets (id, name, public) VALUES ('attachments', 'attachments', false);
-- policies de storage configuradas no proximo arquivo (storage_policies.sql)

-- ============================================================================
-- Seed inicial — criar workspace FABD + 5 diretorias quando primeiro admin logar
-- (opcional, pode ser feito via app)
-- ============================================================================
-- Não é seed automático: a app vai criar workspace 'FABD' no onboarding do admin
