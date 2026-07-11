alter table public.agent_website_ai_media
  drop constraint if exists agent_website_ai_media_media_type_check;

alter table public.agent_website_ai_media
  add constraint agent_website_ai_media_media_type_check
  check (media_type in ('staging_image', 'social_video', 'agent_headshot'));
