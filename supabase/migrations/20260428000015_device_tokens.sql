-- ============================================================================
-- FCM device tokens: 1 user pode ter N (1 por device Android/iOS).
-- Token eh UNIQUE pra dedup quando o mesmo device re-registra.
-- ============================================================================

create table if not exists device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  token text not null unique,
  platform text not null check (platform in ('android','ios')),
  app_version text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create index if not exists idx_dtok_user on device_tokens(user_id);

alter table device_tokens enable row level security;

-- SELECT: o proprio user
create policy dtok_select on device_tokens for select to authenticated
  using (user_id = auth.uid());

-- INSERT/DELETE: apenas o proprio user (registra/desregistra device atual)
create policy dtok_insert on device_tokens for insert to authenticated
  with check (user_id = auth.uid());

create policy dtok_delete on device_tokens for delete to authenticated
  using (user_id = auth.uid());

-- UPDATE bloqueado pra authenticated (token eh imutavel — substitui via delete+insert).
-- Service role atualiza last_used_at sem RLS.
