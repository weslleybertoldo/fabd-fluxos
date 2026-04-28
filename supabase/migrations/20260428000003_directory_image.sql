-- ============================================================================
-- Directory custom images (admin-uploaded logos that replace fallback initials)
-- ============================================================================

alter table directories add column if not exists image_url text;

-- Bucket publico (logos institucionais sem dados sensiveis)
-- Path convention: '{workspace_id}/{directory_id}-{timestamp}.{ext}'
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'directory-images',
  'directory-images',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Helper: extrair workspace_id do path '{ws_id}/...'
create or replace function storage_workspace_from_directory_image_path(name text)
returns uuid language sql immutable as $$
  select case
    when name ~ '^[0-9a-f-]+/' then
      (regexp_match(name, '^([0-9a-f-]+)/'))[1]::uuid
    else null
  end;
$$;

-- SELECT: bucket eh public, mas precisa de policy explicita pro authenticated
-- Anon ja tem acesso por causa de public=true.
create policy "directory-images_select_anyone"
  on storage.objects for select to public
  using (bucket_id = 'directory-images');

-- INSERT: so admin do workspace correspondente
create policy "directory-images_insert_admin"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'directory-images'
    and is_workspace_admin(storage_workspace_from_directory_image_path(name))
    and owner = auth.uid()
  );

-- UPDATE: so admin do workspace correspondente
create policy "directory-images_update_admin"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'directory-images'
    and is_workspace_admin(storage_workspace_from_directory_image_path(name))
  )
  with check (
    bucket_id = 'directory-images'
    and is_workspace_admin(storage_workspace_from_directory_image_path(name))
  );

-- DELETE: so admin do workspace correspondente
create policy "directory-images_delete_admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'directory-images'
    and is_workspace_admin(storage_workspace_from_directory_image_path(name))
  );
