create table if not exists public.rel8tion_runtime_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.rel8tion_runtime_settings enable row level security;

create or replace function public.set_rel8tion_runtime_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_rel8tion_runtime_settings_updated_at on public.rel8tion_runtime_settings;
create trigger set_rel8tion_runtime_settings_updated_at
before update on public.rel8tion_runtime_settings
for each row
execute function public.set_rel8tion_runtime_settings_updated_at();

insert into public.rel8tion_runtime_settings (key, value, updated_by)
values ('outreach_operator_mode', '{"mode":"live"}'::jsonb, 'migration')
on conflict (key) do nothing;
