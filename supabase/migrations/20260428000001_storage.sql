-- ============================================================================
-- Storage bucket "attachments" (privado, signed URLs)
-- ============================================================================

-- Cria bucket privado se nao existe
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  52428800,  -- 50 MB por arquivo
  array[
    'image/jpeg','image/png','image/heic','image/webp','image/gif',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel','application/msword','application/vnd.ms-powerpoint',
    'audio/mpeg','audio/wav','audio/webm','audio/ogg','audio/mp4',
    'video/mp4','video/webm','video/quicktime',
    'text/plain','text/csv'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Policies de storage.objects pro bucket 'attachments'
-- path convention: 'workspace-{wsid}/flow-{flowid}/phase-{phaseid}/{filename}'

-- helper pra extrair workspace_id do path
create or replace function storage_workspace_from_path(name text)
returns uuid language sql immutable as $$
  select case
    when name ~ '^workspace-[0-9a-f-]+/' then
      (regexp_match(name, '^workspace-([0-9a-f-]+)/'))[1]::uuid
    else null
  end;
$$;

-- Membro do workspace pode ler
create policy "attachments_read_workspace_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and is_workspace_member(storage_workspace_from_path(name))
  );

-- Membro pode inserir (upload) — app valida path antes
create policy "attachments_insert_workspace_member"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and is_workspace_member(storage_workspace_from_path(name))
    and owner = auth.uid()
  );

-- Quem subiu pode deletar; admin do workspace tambem
create policy "attachments_delete_owner_or_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (
      owner = auth.uid()
      or is_workspace_admin(storage_workspace_from_path(name))
    )
  );

-- Update raramente necessario (rename); permitir owner
create policy "attachments_update_owner"
  on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid())
  with check (bucket_id = 'attachments' and owner = auth.uid());
