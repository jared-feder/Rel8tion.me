set lock_timeout = '15s';
set statement_timeout = '15min';

create temp table _trusted_agent_ranking_uploads
on commit drop
as
select id
from public.agent_production_uploads
where (
    nullif(btrim(lower(coalesce(source_name, ''))), '') is null
    or lower(btrim(source_name)) = 'listreports'
  )
  and coalesce(raw_metadata->'mapping', '{}'::jsonb) ?& array[
    'agent_name',
    'brokerage',
    'phone',
    'active_listing_count',
    'listings_days_since_last',
    'listings_active_last_12_months',
    'buyside_last_90_days',
    'buyside_last_12_months'
  ]
  and not (
    coalesce(raw_metadata->'mapping', '{}'::jsonb) ?| array[
      'production_volume',
      'transaction_count',
      'sold_listing_count',
      'average_price'
    ]
  );

create temp table _agent_ranking_consolidation_plan
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
      || btrim(
        regexp_replace(
          regexp_replace(lower(coalesce(ranking.brokerage, '')), '[^a-z0-9 ]+', '', 'g'),
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
    ranking.agent_rank_score,
    ranking.opportunity_gap_score,
    ranking.matched_weekend_open_house_count,
    ranking.matched_open_house_count,
    ranking.active_listing_count,
    ranking.listings_active_last_12_months,
    ranking.buyside_last_12_months,
    ranking.production_volume,
    ranking.transaction_count,
    ranking.raw_sources,
    ranking.updated_at
  from public.agent_rankings ranking
  join _trusted_agent_ranking_uploads trusted_upload
    on trusted_upload.id::text = coalesce(
      ranking.raw_sources->>'upload_id',
      ranking.raw_sources->>'source_upload_id'
    )
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
        coalesce(agent_rank_score, 0) desc,
        coalesce(opportunity_gap_score, 0) desc,
        coalesce(matched_weekend_open_house_count, 0) desc,
        coalesce(matched_open_house_count, 0) desc,
        coalesce(active_listing_count, 0) desc,
        coalesce(listings_active_last_12_months, 0) desc,
        coalesce(buyside_last_12_months, 0) desc,
        coalesce(production_volume, 0) desc,
        coalesce(transaction_count, 0) desc,
        coalesce((raw_sources->>'match_confidence')::numeric, 0) desc,
        updated_at desc nulls last,
        id
    ) as keeper_id
  from normalized
)
select id, canonical_key, keeper_id
from ranked;

create temp table _agent_ranking_rollup
on commit drop
as
select
  plan.canonical_key,
  plan.keeper_id,
  count(distinct ranking.id)::int as consolidated_row_count,
  (array_agg(ranking.agent_id order by ranking.updated_at desc nulls last)
    filter (where ranking.agent_id is not null))[1] as agent_id,
  (array_agg(ranking.latest_import_row_id order by ranking.created_at desc nulls last)
    filter (where ranking.latest_import_row_id is not null))[1] as latest_import_row_id,
  (array_agg(ranking.email order by ranking.updated_at desc nulls last)
    filter (where nullif(btrim(ranking.email), '') is not null))[1] as email,
  max(coalesce(ranking.active_listing_count, 0)) as active_listing_count,
  max(coalesce(ranking.sold_listing_count, 0)) as sold_listing_count,
  min(ranking.listings_days_since_last)
    filter (where ranking.listings_days_since_last > 0) as listings_days_since_last,
  max(coalesce(ranking.listings_active_last_12_months, 0)) as listings_active_last_12_months,
  max(coalesce(ranking.buyside_last_90_days, 0)) as buyside_last_90_days,
  max(coalesce(ranking.buyside_last_12_months, 0)) as buyside_last_12_months,
  max(coalesce(ranking.open_house_count, 0)) as open_house_count,
  max(coalesce(ranking.matched_open_house_count, 0)) as matched_open_house_count,
  max(coalesce(ranking.matched_weekend_open_house_count, 0)) as matched_weekend_open_house_count,
  max(coalesce(ranking.matched_active_listing_count, 0)) as matched_active_listing_count,
  array_remove(array_agg(distinct matched_open_house.id), null) as matched_open_house_ids,
  bool_or(coalesce(ranking.has_open_house_this_weekend, false)) as has_open_house_this_weekend,
  bool_or(coalesce(ranking.has_phone, false) or nullif(ranking.phone_normalized, '') is not null) as has_phone,
  bool_or(coalesce(ranking.has_email, false) or nullif(ranking.email, '') is not null) as has_email,
  max(coalesce(ranking.location_confidence, 0)) as location_confidence,
  max(ranking.last_activity_at) as last_activity_at,
  max(ranking.last_matched_open_house_at) as last_matched_open_house_at,
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
  jsonb_agg(distinct concat_ws(
    ' / ',
    nullif(coalesce(ranking.primary_county, ranking.county, ''), ''),
    nullif(ranking.market_area, ''),
    nullif(concat_ws(', ', nullif(ranking.city, ''), nullif(ranking.state, '')), '')
  )) filter (
    where coalesce(
      ranking.primary_county,
      ranking.county,
      ranking.market_area,
      ranking.city,
      ranking.state,
      ''
    ) <> ''
  ) as consolidated_locations
from _agent_ranking_consolidation_plan plan
join public.agent_rankings ranking
  on ranking.id = plan.id
left join lateral unnest(coalesce(ranking.matched_open_house_ids, '{}'::text[]))
  as matched_open_house(id) on true
group by plan.canonical_key, plan.keeper_id;

drop index if exists public.agent_rankings_identity_uidx;

update public.agent_rankings keeper
set
  identity_key = rollup.canonical_key,
  agent_id = coalesce(keeper.agent_id, rollup.agent_id),
  latest_import_row_id = coalesce(rollup.latest_import_row_id, keeper.latest_import_row_id),
  email = coalesce(nullif(keeper.email, ''), rollup.email),
  active_listing_count = rollup.active_listing_count,
  sold_listing_count = rollup.sold_listing_count,
  listings_days_since_last = coalesce(rollup.listings_days_since_last, 0),
  listings_active_last_12_months = rollup.listings_active_last_12_months,
  buyside_last_90_days = rollup.buyside_last_90_days,
  buyside_last_12_months = rollup.buyside_last_12_months,
  open_house_count = rollup.open_house_count,
  matched_open_house_count = rollup.matched_open_house_count,
  matched_weekend_open_house_count = rollup.matched_weekend_open_house_count,
  matched_active_listing_count = rollup.matched_active_listing_count,
  matched_open_house_ids = rollup.matched_open_house_ids,
  has_open_house_this_weekend = rollup.has_open_house_this_weekend,
  has_phone = rollup.has_phone,
  has_email = rollup.has_email,
  location_confidence = greatest(coalesce(keeper.location_confidence, 0), rollup.location_confidence),
  last_activity_at = coalesce(rollup.last_activity_at, keeper.last_activity_at),
  last_matched_open_house_at = coalesce(
    rollup.last_matched_open_house_at,
    keeper.last_matched_open_house_at
  ),
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
    'consolidated_locations',
    coalesce(rollup.consolidated_locations, '[]'::jsonb),
    'consolidated_at',
    now(),
    'consolidation_note',
    'Derived ranking rows were consolidated by normalized agent name, brokerage, and phone. Raw import rows remain in agent_production_import_rows.'
  )
from _agent_ranking_rollup rollup
where keeper.id = rollup.keeper_id;

delete from public.agent_rankings ranking
where not exists (
  select 1
  from _agent_ranking_consolidation_plan plan
  where plan.id = ranking.id
    and plan.keeper_id = ranking.id
);

create unique index agent_rankings_identity_uidx
  on public.agent_rankings(identity_key);

create or replace function public.set_agent_ranking_identity_key()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  agent_name_key text;
  brokerage_key text;
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
  brokerage_key := btrim(
    regexp_replace(
      regexp_replace(lower(coalesce(new.brokerage, '')), '[^a-z0-9 ]+', '', 'g'),
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
    new.identity_key := 'import:'
      || agent_name_key
      || '|'
      || brokerage_key
      || '|'
      || phone_digits;
  end if;

  return new;
end;
$$;

drop trigger if exists set_agent_ranking_identity_key on public.agent_rankings;

create trigger set_agent_ranking_identity_key
before insert or update of agent_name, brokerage, phone, phone_normalized, identity_key
on public.agent_rankings
for each row
execute function public.set_agent_ranking_identity_key();

comment on column public.agent_rankings.identity_key is
  'Canonical Agent Ranking identity: import:{normalized_agent_name}|{normalized_brokerage}|{normalized_phone}. Location is intentionally excluded so repeated county and market reports upsert one current ranking.';
