set lock_timeout = '15s';
set statement_timeout = '15min';

create temp table _agent_ranking_name_phone_plan
on commit drop
as
with normalized as (
  select
    ranking.id,
    'import:'
      || btrim(
        regexp_replace(
          regexp_replace(lower(coalesce(ranking.agent_name, '')), '[^a-z0-9 ]+', '', 'g'),
          '\s+',
          ' ',
          'g'
        )
      )
      || '|'
      || case
        when length(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g')) = 11
          and left(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g'), 1) = '1'
          then substring(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g') from 2 for 10)
        when length(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g')) >= 10
          then right(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g'), 10)
        else regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g')
      end as canonical_key,
    coalesce(
      case
        when coalesce(ranking.raw_sources->>'snapshot_at', '') ~ '^\d{4}-\d{2}-\d{2}'
          then (ranking.raw_sources->>'snapshot_at')::timestamptz
      end,
      case
        when coalesce(ranking.raw_sources->>'period_end', '') ~ '^\d{4}-\d{2}-\d{2}'
          then (ranking.raw_sources->>'period_end')::timestamptz
      end,
      case
        when coalesce(ranking.raw_sources->>'period_start', '') ~ '^\d{4}-\d{2}-\d{2}'
          then (ranking.raw_sources->>'period_start')::timestamptz
      end,
      ranking.updated_at,
      ranking.created_at,
      '-infinity'::timestamptz
    ) as snapshot_at,
    ranking.active_listing_count,
    ranking.listings_active_last_12_months,
    ranking.buyside_last_12_months,
    ranking.buyside_last_90_days,
    ranking.listings_days_since_last
  from public.agent_rankings ranking
  where nullif(
      btrim(
        regexp_replace(
          regexp_replace(lower(coalesce(ranking.agent_name, '')), '[^a-z0-9 ]+', '', 'g'),
          '\s+',
          ' ',
          'g'
        )
      ),
      ''
    ) is not null
    and nullif(regexp_replace(coalesce(ranking.phone_normalized, ranking.phone, ''), '\D', '', 'g'), '') is not null
), ranked as (
  select
    normalized.*,
    first_value(id) over (
      partition by canonical_key
      order by
        snapshot_at desc,
        coalesce(active_listing_count, 0) desc,
        coalesce(listings_active_last_12_months, 0) desc,
        coalesce(buyside_last_12_months, 0) desc,
        coalesce(buyside_last_90_days, 0) desc,
        case when coalesce(listings_days_since_last, 0) > 0 then listings_days_since_last else 2147483647 end,
        id
    ) as keeper_id
  from normalized
)
select id, canonical_key, keeper_id, snapshot_at
from ranked;

create temp table _agent_ranking_name_phone_rollup
on commit drop
as
select
  plan.canonical_key,
  plan.keeper_id,
  count(distinct ranking.id)::int as consolidated_row_count,
  (array_agg(ranking.agent_id order by (ranking.agent_id is not null) desc, plan.snapshot_at desc)
    filter (where ranking.agent_id is not null))[1] as agent_id,
  (array_agg(ranking.latest_import_row_id order by plan.snapshot_at desc)
    filter (where ranking.latest_import_row_id is not null))[1] as latest_import_row_id,
  (array_agg(ranking.email order by plan.snapshot_at desc)
    filter (where nullif(btrim(ranking.email), '') is not null))[1] as email,
  max(coalesce(ranking.open_house_count, 0)) as open_house_count,
  max(coalesce(ranking.matched_open_house_count, 0)) as matched_open_house_count,
  max(coalesce(ranking.matched_weekend_open_house_count, 0)) as matched_weekend_open_house_count,
  max(coalesce(ranking.matched_active_listing_count, 0)) as matched_active_listing_count,
  array_remove(array_agg(distinct matched_open_house.id), null) as matched_open_house_ids,
  bool_or(coalesce(ranking.has_open_house_this_weekend, false)) as has_open_house_this_weekend,
  bool_or(coalesce(ranking.has_phone, false) or nullif(ranking.phone_normalized, '') is not null) as has_phone,
  bool_or(coalesce(ranking.has_email, false) or nullif(ranking.email, '') is not null) as has_email,
  max(ranking.last_activity_at) as last_activity_at,
  max(ranking.last_matched_open_house_at) as last_matched_open_house_at,
  (
    jsonb_agg(
      jsonb_build_object(
        'market_area', ranking.market_area,
        'county', ranking.county,
        'primary_county', ranking.primary_county,
        'city', ranking.city,
        'state', ranking.state,
        'zip', ranking.zip,
        'inferred_county', ranking.inferred_county,
        'location_confidence', coalesce(ranking.location_confidence, 0),
        'location_source', ranking.location_source
      )
      order by coalesce(ranking.location_confidence, 0) desc, plan.snapshot_at desc
    ) filter (
      where coalesce(
        ranking.primary_county,
        ranking.county,
        ranking.market_area,
        ranking.city,
        ranking.state,
        ranking.zip,
        ''
      ) <> ''
    )
  )->0 as best_location,
  jsonb_agg(distinct ranking.id) as consolidated_ranking_ids,
  jsonb_agg(distinct ranking.identity_key)
    filter (where ranking.identity_key is not null) as consolidated_identity_keys,
  jsonb_agg(distinct coalesce(
    ranking.raw_sources->>'upload_id',
    ranking.raw_sources->>'source_upload_id'
  )) filter (
    where coalesce(
      ranking.raw_sources->>'upload_id',
      ranking.raw_sources->>'source_upload_id'
    ) is not null
  ) as consolidated_upload_ids,
  jsonb_agg(distinct ranking.brokerage)
    filter (where nullif(btrim(ranking.brokerage), '') is not null) as brokerage_history
from _agent_ranking_name_phone_plan plan
join public.agent_rankings ranking
  on ranking.id = plan.id
left join lateral unnest(coalesce(ranking.matched_open_house_ids, '{}'::text[]))
  as matched_open_house(id) on true
group by plan.canonical_key, plan.keeper_id;

drop trigger if exists set_agent_ranking_identity_key on public.agent_rankings;

drop index if exists public.agent_rankings_identity_uidx;

update public.agent_rankings keeper
set
  identity_key = rollup.canonical_key,
  agent_id = coalesce(keeper.agent_id, rollup.agent_id),
  latest_import_row_id = coalesce(keeper.latest_import_row_id, rollup.latest_import_row_id),
  email = coalesce(nullif(keeper.email, ''), rollup.email),
  market_area = coalesce(nullif(keeper.market_area, ''), rollup.best_location->>'market_area'),
  county = coalesce(nullif(keeper.county, ''), rollup.best_location->>'county'),
  primary_county = coalesce(nullif(keeper.primary_county, ''), rollup.best_location->>'primary_county'),
  city = coalesce(nullif(keeper.city, ''), rollup.best_location->>'city'),
  state = coalesce(nullif(keeper.state, ''), rollup.best_location->>'state'),
  zip = coalesce(nullif(keeper.zip, ''), rollup.best_location->>'zip'),
  inferred_county = coalesce(nullif(keeper.inferred_county, ''), rollup.best_location->>'inferred_county'),
  location_confidence = greatest(
    coalesce(keeper.location_confidence, 0),
    coalesce((rollup.best_location->>'location_confidence')::int, 0)
  ),
  location_source = coalesce(nullif(keeper.location_source, ''), rollup.best_location->>'location_source'),
  open_house_count = rollup.open_house_count,
  matched_open_house_count = rollup.matched_open_house_count,
  matched_weekend_open_house_count = rollup.matched_weekend_open_house_count,
  matched_active_listing_count = rollup.matched_active_listing_count,
  matched_open_house_ids = rollup.matched_open_house_ids,
  has_open_house_this_weekend = rollup.has_open_house_this_weekend,
  has_phone = rollup.has_phone,
  has_email = rollup.has_email,
  last_activity_at = coalesce(rollup.last_activity_at, keeper.last_activity_at),
  last_matched_open_house_at = coalesce(rollup.last_matched_open_house_at, keeper.last_matched_open_house_at),
  raw_sources = coalesce(keeper.raw_sources, '{}'::jsonb) || jsonb_build_object(
    'canonical_identity_key',
    rollup.canonical_key,
    'consolidated_ranking_count',
    rollup.consolidated_row_count,
    'consolidated_ranking_ids',
    coalesce(rollup.consolidated_ranking_ids, '[]'::jsonb),
    'consolidated_identity_keys',
    coalesce(rollup.consolidated_identity_keys, '[]'::jsonb),
    'consolidated_upload_ids',
    coalesce(rollup.consolidated_upload_ids, '[]'::jsonb),
    'brokerage_history',
    coalesce(rollup.brokerage_history, '[]'::jsonb),
    'consolidated_at',
    now(),
    'consolidation_note',
    'Current rankings were consolidated by normalized agent name and canonical phone. Raw ListReports rows remain in agent_production_import_rows.'
  )
from _agent_ranking_name_phone_rollup rollup
where keeper.id = rollup.keeper_id;

delete from public.agent_rankings ranking
using _agent_ranking_name_phone_plan plan
where ranking.id = plan.id
  and plan.id <> plan.keeper_id;

create unique index agent_rankings_identity_uidx
  on public.agent_rankings(identity_key);

create or replace function public.set_agent_ranking_identity_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  agent_name_key text;
  phone_digits text;
begin
  agent_name_key := btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(new.agent_name, '')), '[^a-z0-9 ]+', '', 'g'),
      '\s+',
      ' ',
      'g'
    )
  );
  phone_digits := regexp_replace(coalesce(new.phone_normalized, new.phone, ''), '\D', '', 'g');

  if length(phone_digits) = 11 and left(phone_digits, 1) = '1' then
    phone_digits := substring(phone_digits from 2 for 10);
  elsif length(phone_digits) >= 10 then
    phone_digits := right(phone_digits, 10);
  end if;

  if nullif(agent_name_key, '') is null or nullif(phone_digits, '') is null then
    new.identity_key := null;
  else
    new.identity_key := 'import:' || agent_name_key || '|' || phone_digits;
  end if;

  return new;
end;
$$;

create trigger set_agent_ranking_identity_key
before insert or update of agent_name, phone, phone_normalized, identity_key
on public.agent_rankings
for each row
execute function public.set_agent_ranking_identity_key();

comment on column public.agent_rankings.identity_key is
  'Canonical Agent Ranking identity: import:{normalized_agent_name}|{canonical_phone}. Brokerage and location are intentionally excluded so repeated market reports update one current ranking while raw imports preserve source lineage.';
