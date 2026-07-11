alter table public.agent_outreach_queue
  add column if not exists outreach_code text;

create unique index if not exists agent_outreach_queue_outreach_code_key
  on public.agent_outreach_queue(outreach_code)
  where outreach_code is not null;

create or replace function public.generate_agent_outreach_code()
returns text
language plpgsql
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    exit when not exists (
      select 1
      from public.agent_outreach_queue
      where outreach_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

create or replace function public.set_agent_outreach_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.outreach_code is null or btrim(new.outreach_code) = '' then
    new.outreach_code := public.generate_agent_outreach_code();
  else
    new.outreach_code := lower(regexp_replace(btrim(new.outreach_code), '[^a-zA-Z0-9_-]', '', 'g'));

    if length(new.outreach_code) < 6 or length(new.outreach_code) > 8 then
      raise exception 'outreach_code must be 6-8 URL-safe characters';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_agent_outreach_code on public.agent_outreach_queue;

create trigger set_agent_outreach_code
before insert on public.agent_outreach_queue
for each row
execute function public.set_agent_outreach_code();

do $$
declare
  outreach_row record;
begin
  for outreach_row in
    select id
    from public.agent_outreach_queue
    where outreach_code is null or btrim(outreach_code) = ''
  loop
    update public.agent_outreach_queue
    set outreach_code = public.generate_agent_outreach_code()
    where id = outreach_row.id
      and (outreach_code is null or btrim(outreach_code) = '');
  end loop;
end;
$$;
