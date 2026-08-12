-- Repair only blank or placeholder open-house agent names when an exact listing ID
-- maps to one unambiguous real name in an existing REL8TION source.
with source_names as (
  select open_house_id as open_house_id, agent_name
  from public.agent_outreach_queue
  where open_house_id is not null
    and nullif(btrim(agent_name), '') is not null
    and lower(btrim(agent_name)) not in ('listing agent', 'agent', 'unknown', 'unknown agent', 'n/a', 'na')
  union all
  select source_listing_id as open_house_id, agent_name
  from public.agent_listing_inventory
  where source_listing_id is not null
    and nullif(btrim(agent_name), '') is not null
    and lower(btrim(agent_name)) not in ('listing agent', 'agent', 'unknown', 'unknown agent', 'n/a', 'na')
),
resolved as (
  select open_house_id, min(agent_name) as agent_name
  from source_names
  group by open_house_id
  having count(distinct lower(btrim(agent_name))) = 1
)
update public.open_houses as oh
set agent = resolved.agent_name,
    updated_at = now()
from resolved
where oh.id = resolved.open_house_id
  and (
    nullif(btrim(oh.agent), '') is null
    or lower(btrim(oh.agent)) in ('listing agent', 'agent', 'unknown', 'unknown agent', 'n/a', 'na')
  );
