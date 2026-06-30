alter table public.agent_rankings
  add column if not exists identity_key text;

with normalized as (
  select
    id,
    nullif(
      btrim(regexp_replace(regexp_replace(lower(coalesce(agent_name, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')),
      ''
    ) as agent_name_key,
    btrim(regexp_replace(regexp_replace(lower(coalesce(brokerage, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) as brokerage_key,
    case
      when length(regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g')) = 11
        and left(regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g'), 1) = '1'
        then substring(regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g') from 2 for 10)
      when length(regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g')) >= 10
        then right(regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g'), 10)
      else regexp_replace(coalesce(phone_normalized, phone, ''), '\D', '', 'g')
    end as phone_key,
    btrim(regexp_replace(regexp_replace(lower(coalesce(primary_county, county, market_area, city, state, '')), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g')) as location_key
  from public.agent_rankings
)
update public.agent_rankings target
set identity_key = case
  when normalized.agent_name_key is not null and nullif(normalized.phone_key, '') is not null
    then 'import:'
      || normalized.agent_name_key
      || '|'
      || coalesce(normalized.brokerage_key, '')
      || '|'
      || normalized.phone_key
      || '|'
      || coalesce(normalized.location_key, '')
  else null
end
from normalized
where target.id = normalized.id
  and (target.identity_key is null or target.identity_key = '');

drop index if exists public.agent_rankings_identity_uidx;

create unique index agent_rankings_identity_uidx
  on public.agent_rankings(identity_key);

comment on column public.agent_rankings.identity_key is
  'Stable Agent Ranking import identity: import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}|{normalized_county_or_market}. Phone alone must not be unique identity.';
