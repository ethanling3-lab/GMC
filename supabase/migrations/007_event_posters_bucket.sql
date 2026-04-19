-- Public Supabase Storage bucket for event poster/hero images.
-- Admins upload via service-role (bypassing storage RLS); the bucket is
-- marked public so the rendered URL works without signed tokens.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-posters',
  'event-posters',
  true,
  15 * 1024 * 1024,                        -- 15 MB cap
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
