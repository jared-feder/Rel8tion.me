-- Smart Sign QR inventory type hardening
-- Printed QR codes are sourced from public.smart_sign_inventory.public_code only.

alter table public.smart_sign_inventory
  add column if not exists inventory_type text;

update public.smart_sign_inventory
set inventory_type = 'smart_sign'
where inventory_type is null
  or trim(inventory_type) = '';

alter table public.smart_sign_inventory
  alter column inventory_type set default 'smart_sign';

do $$
begin
  if exists (
    select 1
    from public.smart_sign_inventory
    where inventory_type not in ('smart_sign', 'event_pass')
  ) then
    raise exception 'public.smart_sign_inventory.inventory_type contains values outside smart_sign/event_pass';
  end if;
end $$;

alter table public.smart_sign_inventory
  alter column inventory_type set not null;

alter table public.smart_sign_inventory
  drop constraint if exists smart_sign_inventory_inventory_type_check;

alter table public.smart_sign_inventory
  add constraint smart_sign_inventory_inventory_type_check
  check (inventory_type in ('smart_sign', 'event_pass'));

comment on column public.smart_sign_inventory.inventory_type is
'Printed QR inventory type. Allowed values: smart_sign, event_pass. public_code is the QR print source of truth.';
