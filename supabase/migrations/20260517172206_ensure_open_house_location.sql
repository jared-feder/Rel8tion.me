-- Keep open_houses.location in sync with lat/lng so geolocation RPCs can
-- reliably rank nearby open houses even when importers only write coordinates.

create or replace function public.set_open_house_location_from_lat_lng()
returns trigger
language plpgsql
as $$
begin
  if new.lat is not null
    and new.lng is not null
    and new.lat between -90 and 90
    and new.lng between -180 and 180
  then
    new.location := ST_SetSRID(ST_MakePoint(new.lng, new.lat), 4326)::geography;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_open_houses_set_location_from_lat_lng on public.open_houses;

create trigger trg_open_houses_set_location_from_lat_lng
before insert or update on public.open_houses
for each row
execute function public.set_open_house_location_from_lat_lng();

update public.open_houses
set location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
where lat is not null
  and lng is not null
  and lat between -90 and 90
  and lng between -180 and 180
  and (
    location is null
    or ST_Distance(location, ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) > 1
  );

comment on function public.set_open_house_location_from_lat_lng() is
  'Trigger helper that derives open_houses.location geography from valid lat/lng coordinates.';
