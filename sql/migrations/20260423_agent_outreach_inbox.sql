update public.agent_outreach_replies
set from_phone_normalized = right(from_phone_normalized, 10)
where length(from_phone_normalized) = 11
  and from_phone_normalized like '1%';

update public.agent_outreach_replies r
set
  queue_row_id = (
    select q.id
    from public.agent_outreach_queue q
    where q.agent_phone_normalized in (
      r.from_phone_normalized,
      case
        when length(r.from_phone_normalized) = 11 and r.from_phone_normalized like '1%'
          then right(r.from_phone_normalized, 10)
        else r.from_phone_normalized
      end
    )
    order by q.last_outreach_at desc nulls last, q.updated_at desc nulls last, q.created_at desc
    limit 1
  ),
  open_house_id = coalesce(
    r.open_house_id,
    (
      select q.open_house_id
      from public.agent_outreach_queue q
      where q.agent_phone_normalized in (
        r.from_phone_normalized,
        case
          when length(r.from_phone_normalized) = 11 and r.from_phone_normalized like '1%'
            then right(r.from_phone_normalized, 10)
          else r.from_phone_normalized
        end
      )
      order by q.last_outreach_at desc nulls last, q.updated_at desc nulls last, q.created_at desc
      limit 1
    )
  )
where r.queue_row_id is null;

create or replace view public.agent_outreach_inbox as
with resolved_replies as (
  select
    r.id as reply_id,
    coalesce(
      r.queue_row_id,
      (
        select q.id
        from public.agent_outreach_queue q
        where q.agent_phone_normalized in (
          r.from_phone_normalized,
          case
            when length(r.from_phone_normalized) = 11 and r.from_phone_normalized like '1%'
              then right(r.from_phone_normalized, 10)
            else r.from_phone_normalized
          end
        )
        order by q.last_outreach_at desc nulls last, q.updated_at desc nulls last, q.created_at desc
        limit 1
      )
    ) as queue_row_id,
    coalesce(
      r.open_house_id,
      (
        select q.open_house_id
        from public.agent_outreach_queue q
        where q.agent_phone_normalized in (
          r.from_phone_normalized,
          case
            when length(r.from_phone_normalized) = 11 and r.from_phone_normalized like '1%'
              then right(r.from_phone_normalized, 10)
            else r.from_phone_normalized
          end
        )
        order by q.last_outreach_at desc nulls last, q.updated_at desc nulls last, q.created_at desc
        limit 1
      )
    ) as open_house_id,
    r.from_phone,
    case
      when length(r.from_phone_normalized) = 11 and r.from_phone_normalized like '1%'
        then right(r.from_phone_normalized, 10)
      else r.from_phone_normalized
    end as from_phone_normalized,
    r.to_phone,
    r.body,
    r.message_sid,
    r.account_sid,
    r.direction,
    r.opt_out,
    r.raw_payload,
    r.received_at,
    r.created_at
  from public.agent_outreach_replies r
),
ranked_replies as (
  select
    rr.*,
    coalesce(rr.queue_row_id::text, rr.from_phone_normalized) as thread_key,
    row_number() over (
      partition by coalesce(rr.queue_row_id::text, rr.from_phone_normalized)
      order by rr.received_at desc, rr.created_at desc, rr.reply_id desc
    ) as reply_rank,
    count(*) over (
      partition by coalesce(rr.queue_row_id::text, rr.from_phone_normalized)
    ) as reply_count,
    max(rr.received_at) over (
      partition by coalesce(rr.queue_row_id::text, rr.from_phone_normalized)
    ) as last_reply_at,
    bool_or(rr.opt_out) over (
      partition by coalesce(rr.queue_row_id::text, rr.from_phone_normalized)
    ) as any_opt_out
  from resolved_replies rr
)
select
  rr.thread_key,
  rr.queue_row_id,
  rr.reply_id as latest_reply_id,
  rr.last_reply_at,
  rr.reply_count,
  rr.body as latest_reply_body,
  rr.opt_out as latest_reply_opt_out,
  rr.any_opt_out,
  rr.from_phone,
  rr.from_phone_normalized,
  rr.to_phone,
  rr.message_sid as latest_message_sid,
  rr.account_sid,
  rr.direction,
  rr.open_house_id,
  q.agent_name,
  q.agent_phone,
  q.agent_phone_normalized,
  q.agent_email,
  q.brokerage,
  q.address,
  q.city,
  q.state,
  q.zip,
  q.open_start,
  q.open_end,
  q.review_status,
  q.initial_send_status,
  q.followup_send_status,
  q.send_mode,
  q.approved_for_send,
  q.initial_sent_at,
  q.followup_sent_at,
  q.last_outreach_at,
  q.selected_sms,
  q.followup_sms
from ranked_replies rr
left join public.agent_outreach_queue q on q.id = rr.queue_row_id
where rr.reply_rank = 1;

grant select on public.agent_outreach_inbox to anon, authenticated, service_role;
