-- RPC pra agregar fases vencidas (completed_at IS NULL AND due_date < now()) por projeto
-- direto no banco, evitando trazer 1 row por fase pro app + agregar em JS.
-- SECURITY INVOKER: respeita RLS de flows/phases do caller.

create or replace function count_overdue_phases_per_project(p_project_ids uuid[])
returns table (
  project_id uuid,
  overdue_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select f.project_id, count(*)::bigint as overdue_count
  from phases p
  join flows f on f.id = p.flow_id
  where f.project_id = any(p_project_ids)
    and p.completed_at is null
    and p.due_date is not null
    and p.due_date < now()
  group by f.project_id;
$$;

grant execute on function count_overdue_phases_per_project(uuid[]) to authenticated;
