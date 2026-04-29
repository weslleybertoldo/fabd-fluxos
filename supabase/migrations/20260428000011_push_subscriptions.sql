-- ============================================================================
-- Web Push subscriptions: 1 user pode ter N (1 por device/browser)
-- Endpoint eh UNIQUE pra dedup quando o mesmo browser re-subscribe
-- ============================================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists idx_psub_user on push_subscriptions(user_id);

alter table push_subscriptions enable row level security;

-- SELECT: o proprio user (pra mostrar quantos devices) ou admin do mesmo workspace (futuro: gerenciar)
create policy psub_select on push_subscriptions for select to authenticated
  using (user_id = auth.uid());

-- INSERT/DELETE: apenas o proprio user (subscribe/unsubscribe do device atual)
create policy psub_insert on push_subscriptions for insert to authenticated
  with check (user_id = auth.uid());

create policy psub_delete on push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
