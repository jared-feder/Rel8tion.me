alter table public.agent_listing_inventory
  add column if not exists outreach_image_url text,
  add column if not exists outreach_image_status text not null default 'pending',
  add column if not exists outreach_image_rendered_at timestamptz,
  add column if not exists outreach_image_attempted_at timestamptz,
  add column if not exists outreach_image_error text;

create index if not exists agent_listing_inventory_outreach_image_queue_idx
  on public.agent_listing_inventory(outreach_image_status, open_start)
  where is_current = true and image_url is not null;

create or replace function public.reset_agent_listing_outreach_image()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.image_url is distinct from old.image_url
    or new.address is distinct from old.address
    or new.open_start is distinct from old.open_start
    or new.open_end is distinct from old.open_end then
    new.outreach_image_url := null;
    new.outreach_image_status := 'pending';
    new.outreach_image_rendered_at := null;
    new.outreach_image_attempted_at := null;
    new.outreach_image_error := null;
  end if;
  return new;
end;
$$;

drop trigger if exists agent_listing_inventory_reset_outreach_image
  on public.agent_listing_inventory;

create trigger agent_listing_inventory_reset_outreach_image
before update of image_url, address, open_start, open_end
on public.agent_listing_inventory
for each row
execute function public.reset_agent_listing_outreach_image();

comment on column public.agent_listing_inventory.outreach_image_url is
  'Property-specific REL8TION outreach image generated for this exact listing inventory row.';

comment on column public.agent_listing_inventory.outreach_image_status is
  'Background render state: pending, rendered, or failed. Changes to listing photo/address/open-house time reset it to pending.';
