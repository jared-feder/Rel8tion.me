insert into storage.buckets (
  id,
  name,
  public,
  allowed_mime_types,
  file_size_limit
)
values (
  'agent-website-ai-media-v2',
  'agent-website-ai-media-v2',
  true,
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
  104857600
)
on conflict (id) do update
set
  public = excluded.public,
  allowed_mime_types = excluded.allowed_mime_types,
  file_size_limit = excluded.file_size_limit,
  updated_at = now();
