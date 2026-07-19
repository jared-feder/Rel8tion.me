alter table public.rel8tion_chip_inventory
  add column if not exists print_batch_id text,
  add column if not exists printed_at timestamptz;

create index if not exists idx_rel8tion_chip_inventory_print_batch
  on public.rel8tion_chip_inventory(print_batch_id, chip_code)
  where print_batch_id is not null;

comment on column public.rel8tion_chip_inventory.print_batch_id is
  'Admin-generated fulfillment batch that reserved and exported this QR image.';

comment on column public.rel8tion_chip_inventory.printed_at is
  'Timestamp when the QR was reserved and exported for physical production.';
