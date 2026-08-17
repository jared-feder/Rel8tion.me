create or replace function public.rel8tion_normalize_brokerage(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(value, '')), '&', ' and ', 'g'),
      '\m(real[[:space:]]+estate|llc|inc|incorporated|corp|corporation|company|co|brokerage|realty)\M',
      ' ',
      'g'
    ),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
$$;

create or replace function public.rel8tion_normalize_phone(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when length(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')) = 11
      and regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') like '1%'
      then substring(regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') from 2)
    else regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g')
  end;
$$;

create or replace function public.enforce_event_pass_host_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_role text := coalesce(auth.role(), '');
  key_row public.keys%rowtype;
  agent_row public.agents%rowtype;
  house_row public.open_houses%rowtype;
  listing_row public.listing_agents%rowtype;
  host_phone text;
  host_email text;
  host_name text;
  host_brokerage text;
  supporting boolean := coalesce((new.setup_context ->> 'supporting_listing_agent')::boolean, false);
  exact_match boolean := false;
  brokerage_match boolean := false;
  authorization_basis text;
begin
  if new.activation_method not in ('event_pass_keychain', 'sponsored_event_pass') then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.host_agent_slug is not distinct from old.host_agent_slug
    and new.open_house_source_id is not distinct from old.open_house_source_id
    and new.activation_uid_primary is not distinct from old.activation_uid_primary
    and new.activation_method is not distinct from old.activation_method then
    return new;
  end if;

  if new.activation_method = 'sponsored_event_pass' then
    if request_role <> 'service_role' then
      raise exception using
        errcode = '42501',
        message = 'Sponsored Event Pass activation must use the REL8TION server authorization route.';
    end if;
    if coalesce(new.setup_context ->> 'host_authorization_basis', '') not in ('listing_agent', 'same_brokerage_substitute') then
      raise exception using
        errcode = '42501',
        message = 'Sponsored Event Pass host authorization is missing.';
    end if;
    return new;
  end if;

  if new.open_house_source_id is null or btrim(new.open_house_source_id) = '' then
    raise exception using
      errcode = '42501',
      message = 'A verified open-house listing is required for Event Pass activation.';
  end if;

  select * into key_row
  from public.keys
  where uid = new.activation_uid_primary
    and claimed is true
    and agent_slug is not null
  limit 1;

  if key_row.id is null then
    raise exception using
      errcode = '42501',
      message = 'A claimed agent keychain is required for Event Pass activation.';
  end if;
  if new.host_agent_slug is distinct from key_row.agent_slug then
    raise exception using
      errcode = '42501',
      message = 'The Event Pass host must match the claimed agent keychain.';
  end if;

  select * into agent_row from public.agents where slug = key_row.agent_slug limit 1;
  if agent_row.id is null then
    raise exception using
      errcode = '42501',
      message = 'The claimed keychain is not connected to an agent profile.';
  end if;

  select * into house_row from public.open_houses where id = new.open_house_source_id limit 1;
  if house_row.id is null then
    raise exception using
      errcode = '42501',
      message = 'The selected open house is not in the verified listing feed.';
  end if;

  host_phone := public.rel8tion_normalize_phone(coalesce(agent_row.phone_normalized, agent_row.phone));
  host_email := lower(btrim(coalesce(agent_row.email, '')));
  host_name := lower(btrim(regexp_replace(coalesce(agent_row.name, ''), '[^a-zA-Z0-9]+', ' ', 'g')));
  host_brokerage := public.rel8tion_normalize_brokerage(agent_row.brokerage);

  select la.* into listing_row
  from public.listing_agents la
  where la.open_house_id = house_row.id
    and (
      (length(host_phone) = 10 and public.rel8tion_normalize_phone(coalesce(la.phone_normalized, la.phone)) = host_phone)
      or (host_email <> '' and lower(btrim(coalesce(la.email, ''))) = host_email)
      or (
        length(host_name) >= 5
        and lower(btrim(regexp_replace(coalesce(la.name, ''), '[^a-zA-Z0-9]+', ' ', 'g'))) = host_name
        and length(host_brokerage) >= 4
        and public.rel8tion_normalize_brokerage(coalesce(la.brokerage, house_row.brokerage)) = host_brokerage
      )
    )
  order by la.is_primary desc nulls last, la.created_at asc
  limit 1;

  exact_match := listing_row.id is not null
    or (length(host_phone) = 10 and public.rel8tion_normalize_phone(house_row.agent_phone) = host_phone)
    or (host_email <> '' and lower(btrim(coalesce(house_row.agent_email, ''))) = host_email)
    or (
      length(host_name) >= 5
      and lower(btrim(regexp_replace(coalesce(house_row.agent, ''), '[^a-zA-Z0-9]+', ' ', 'g'))) = host_name
      and length(host_brokerage) >= 4
      and public.rel8tion_normalize_brokerage(house_row.brokerage) = host_brokerage
    );

  brokerage_match := length(host_brokerage) >= 4 and (
    public.rel8tion_normalize_brokerage(house_row.brokerage) = host_brokerage
    or exists (
      select 1 from public.listing_agents la
      where la.open_house_id = house_row.id
        and public.rel8tion_normalize_brokerage(la.brokerage) = host_brokerage
    )
  );

  if exact_match then
    authorization_basis := 'listing_agent';
    supporting := false;
  elsif supporting and brokerage_match then
    authorization_basis := 'same_brokerage_substitute';
    select la.* into listing_row
    from public.listing_agents la
    where la.open_house_id = house_row.id
    order by la.is_primary desc nulls last, la.created_at asc
    limit 1;
  else
    raise exception using
      errcode = '42501',
      message = 'This Event Pass can only be activated by the listing agent or a verified same-brokerage substitute.';
  end if;

  new.setup_context := coalesce(new.setup_context, '{}'::jsonb) || jsonb_build_object(
    'supporting_listing_agent', supporting,
    'host_authorization_basis', authorization_basis,
    'host_authorization_verified_at', now(),
    'listing_agent_id', listing_row.id,
    'listing_agent_name', coalesce(listing_row.name, house_row.agent, ''),
    'listing_agent_brokerage', coalesce(listing_row.brokerage, house_row.brokerage, '')
  );
  return new;
end;
$$;

drop trigger if exists trg_enforce_event_pass_host_authorization on public.open_house_events;
create trigger trg_enforce_event_pass_host_authorization
before insert or update of host_agent_slug, open_house_source_id, activation_uid_primary, activation_method
on public.open_house_events
for each row execute function public.enforce_event_pass_host_authorization();

revoke execute on function public.enforce_event_pass_host_authorization() from public, anon, authenticated;
revoke execute on function public.rel8tion_normalize_brokerage(text) from public, anon, authenticated;
revoke execute on function public.rel8tion_normalize_phone(text) from public, anon, authenticated;

comment on function public.enforce_event_pass_host_authorization() is
  'Prevents Event Pass activation unless the claimed host matches the listing agent or is a confirmed same-brokerage substitute. Sponsored passes must use the service-role server route.';
