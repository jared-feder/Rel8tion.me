alter table public.agent_websites
  add column if not exists about_image_url text,
  add column if not exists gallery_image_urls text[] not null default '{}';

comment on column public.agent_websites.about_image_url is
  'Optional secondary image used in the public agent site about/profile section.';

comment on column public.agent_websites.gallery_image_urls is
  'Optional ordered list of additional homepage/gallery images for the public agent site.';
