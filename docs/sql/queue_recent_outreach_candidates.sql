create or replace function public.queue_recent_outreach_candidates()
returns void
language sql
security definer
as $function$
  select public.queue_outreach_candidate(id)
  from public.open_houses
  where coalesce(trim(agent), '') <> ''
    and coalesce(trim(agent_phone), '') <> ''
    and coalesce(trim(address), '') <> ''
    and open_start is not null
    and coalesce(trim(image), '') <> ''
    and open_start >= now()
    and open_start <= now() + interval '21 days';
$function$;
