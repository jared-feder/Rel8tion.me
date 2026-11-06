-- Approval-based manual replies and push-only owner review notifications.
alter table public.assistant_workspace_actions
  drop constraint assistant_workspace_actions_status_check,
  add column recipient_phone text,
  add column queue_row_id uuid references public.agent_outreach_queue(id),
  add column contact_profile_uid text,
  add column dispatch_token uuid,
  add column provider_claimed_at timestamptz,
  add column provider_receipt jsonb not null default '{}'::jsonb,
  add constraint assistant_workspace_actions_status_check check(status in ('pending_approval','approved','simulated','dismissed','dispatching','accepted','delivered','failed','blocked','unknown'));

create or replace function public.guard_assistant_workspace_action() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if (to_jsonb(new)-array['status','audit','dispatch_token','provider_claimed_at','provider_receipt']) is distinct from
     (to_jsonb(old)-array['status','audit','dispatch_token','provider_claimed_at','provider_receipt']) then
    raise exception 'Assistant content is immutable; create a fresh draft';
  end if;
  if not ((old.status='pending_approval' and new.status in ('approved','dismissed')) or
          (old.status='approved' and new.status in ('simulated','dismissed','dispatching')) or
          (old.status='dispatching' and new.status in ('dispatching','accepted','delivered','failed','blocked','unknown')) or
          (old.status='unknown' and new.status in ('accepted','delivered','failed')) or
          (old.status='accepted' and new.status in ('delivered','failed'))) then
    raise exception 'Invalid assistant transition';
  end if;
  if old.status='approved' and new.status='dispatching' then
    if new.dispatch_token is null or new.recipient_phone is null or new.recipient_phone !~ '^\+1[0-9]{10}$' or new.provider_claimed_at is not null then
      raise exception 'Dispatch requires a recipient and a fresh lease';
    end if;
  elsif new.dispatch_token is distinct from old.dispatch_token then
    raise exception 'Dispatch lease is immutable';
  end if;
  if new.provider_claimed_at is distinct from old.provider_claimed_at and not
    (old.status='dispatching' and new.status='dispatching' and old.provider_claimed_at is null and new.provider_claimed_at is not null) then
    raise exception 'Provider claim is immutable';
  end if;
  if old.status='dispatching' and new.status='dispatching' and not
    (old.provider_claimed_at is null and new.provider_claimed_at is not null) then
    raise exception 'Provider submission already claimed';
  end if;
  if new.provider_receipt is distinct from old.provider_receipt and new.status not in ('accepted','delivered','failed','blocked','unknown') then
    raise exception 'Provider receipt requires a recorded outcome';
  end if;
  if jsonb_array_length(new.audit)<>jsonb_array_length(old.audit)+1 or
     (new.audit-(jsonb_array_length(new.audit)-1)) is distinct from old.audit then
    raise exception 'Audit must be append-only';
  end if;
  return new;
end $$;

create function public.assistant_verified_direct_contact(p_uid text,p_phone text) returns boolean
language sql stable security invoker set search_path=pg_catalog,public as $$
  select count(*)=1 and bool_and(v.uid::text=p_uid) from public.verified_profiles v
  where v.is_active=true and regexp_replace(regexp_replace(coalesce(v.phone,''),'[^0-9]','','g'),'^1([0-9]{10})$','\1')=
    regexp_replace(regexp_replace(coalesce(p_phone,''),'[^0-9]','','g'),'^1([0-9]{10})$','\1');
$$;
revoke all on function public.assistant_verified_direct_contact(text,text) from public,anon,authenticated;
grant execute on function public.assistant_verified_direct_contact(text,text) to service_role;

create table public.assistant_push_subscriptions(
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check(owner_id='jared'),
  endpoint_hash text not null unique check(length(endpoint_hash)=64),
  subscription jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.assistant_push_events(
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  thread_key text not null,
  created_at timestamptz not null default now()
);
create table public.assistant_push_deliveries(
  event_id uuid not null references public.assistant_push_events(id),
  subscription_id uuid not null references public.assistant_push_subscriptions(id),
  primary key(event_id,subscription_id),
  status text not null default 'pending' check(status in ('pending','sending','submitted','retry','expired','unknown')),
  attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  submitted_at timestamptz
);
alter table public.assistant_push_subscriptions enable row level security;
alter table public.assistant_push_events enable row level security;
alter table public.assistant_push_deliveries enable row level security;
revoke all on public.assistant_push_subscriptions,public.assistant_push_events,public.assistant_push_deliveries from public,anon,authenticated;
grant select, insert, update on public.assistant_push_subscriptions to service_role;
grant select, insert, update on public.assistant_push_events to service_role;
grant select, insert, update on public.assistant_push_deliveries to service_role;
create index assistant_push_event_time on public.assistant_push_events(created_at);

create function public.assistant_enqueue_incoming_review() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare contact_uid text; target_thread text;
begin
  if new.direction is distinct from 'inbound' or new.opt_out is distinct from false or new.to_phone is distinct from '+18448211802' then return new; end if;
  if not (coalesce(new.body,'') ~* '(available|confirm|cancel|reschedul|call me|callback|can you|what time|need your|please review|decision|\?)'
     or upper(trim(coalesce(new.body,''))) in ('Y','YES','N','NO')) then return new; end if;
  contact_uid:=new.raw_payload->>'assistant_profile_uid';
  if contact_uid is not null and public.assistant_verified_direct_contact(contact_uid,new.from_phone) then
    target_thread:='lo:'||contact_uid;
  else
    target_thread:=coalesce(new.queue_row_id::text,new.from_phone_normalized);
  end if;
  insert into public.assistant_push_events(event_key,thread_key)
    values('review:'||coalesce(new.message_sid,new.id::text),target_thread) on conflict(event_key) do nothing;
  return new;
end $$;
revoke all on function public.assistant_enqueue_incoming_review() from public,anon,authenticated;
create trigger assistant_enqueue_incoming_review after insert on public.agent_outreach_replies
for each row execute function public.assistant_enqueue_incoming_review();

create function public.assistant_pending_push_events() returns setof public.assistant_push_events
language sql stable security invoker set search_path=pg_catalog,public as $$
  select e.* from public.assistant_push_events e where e.created_at>now()-interval '24 hours' and exists(
    select 1 from public.assistant_push_subscriptions s where s.active=true and s.owner_id='jared' and s.created_at<=e.created_at
    and not exists(select 1 from public.assistant_push_deliveries d where d.event_id=e.id and d.subscription_id=s.id
      and (d.status not in ('pending','retry') or d.attempts>=5 or d.next_attempt_at>now()))
  ) order by e.created_at asc limit 50;
$$;
revoke all on function public.assistant_pending_push_events() from public,anon,authenticated;
grant execute on function public.assistant_pending_push_events() to service_role;

create function public.assistant_claim_push_delivery(p_event uuid,p_subscription uuid) returns setof public.assistant_push_deliveries
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.assistant_push_events e,public.assistant_push_subscriptions s
    where e.id=p_event and s.id=p_subscription and s.active=true and s.owner_id='jared' and s.created_at<=e.created_at and e.created_at>now()-interval '24 hours') then return; end if;
  insert into public.assistant_push_deliveries(event_id,subscription_id) values(p_event,p_subscription) on conflict do nothing;
  return query update public.assistant_push_deliveries d set status='sending',attempts=d.attempts+1,lease_token=gen_random_uuid(),lease_expires_at=now()+interval '2 minutes'
    where d.event_id=p_event and d.subscription_id=p_subscription and d.status in ('pending','retry') and d.attempts<5
      and (d.next_attempt_at is null or d.next_attempt_at<=now()) returning d.*;
end $$;
revoke all on function public.assistant_claim_push_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assistant_claim_push_delivery(uuid,uuid) to service_role;

-- Reconcile only existing receipts. This function can never submit an SMS.
create function public.assistant_reconcile_receipts() returns integer
language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.assistant_workspace_actions; receipt record; receipt_sid text; provider_status text; next_status text; changed integer:=0;
begin
  for a in select * from public.assistant_workspace_actions
    where status in ('dispatching','unknown','accepted') and created_at>now()-interval '7 days'
    order by created_at desc limit 100
  loop
    select count(distinct l.external_id) as sid_count,min(l.external_id) as sid into receipt
      from public.sms_message_log l where l.provider='twilio' and l.metadata->>'source'='jared-assistant'
      and l.metadata->>'assistant_request_id'=a.id and l.to_phone=a.recipient_phone and l.body=a.body and l.external_id is not null;
    next_status:=null;
    if receipt.sid_count=1 and (a.provider_receipt->>'sid' is null or a.provider_receipt->>'sid'=receipt.sid) then
      select l.external_id,coalesce(l.metadata->>'provider_status',l.status) into receipt_sid,provider_status
        from public.sms_message_log l where l.provider='twilio' and l.metadata->>'source'='jared-assistant'
        and l.metadata->>'assistant_request_id'=a.id and l.to_phone=a.recipient_phone and l.body=a.body and l.external_id is not null
        order by case when coalesce(l.metadata->>'provider_status',l.status) in ('failed','undelivered','canceled') then 0 else 1 end,l.created_at desc limit 1;
      next_status:=case when provider_status in ('failed','undelivered','canceled') then 'failed'
        when provider_status in ('delivered','read') then 'delivered'
        when provider_status in ('accepted','queued','sending','sent') then 'accepted' else null end;
    elsif a.status='dispatching' and (select max((e->>'at')::timestamptz) from jsonb_array_elements(a.audit) e where e->>'event'='send_requested')<now()-interval '2 minutes' then
      next_status:='unknown';
    end if;
    if next_status is not null and next_status<>a.status then
      update public.assistant_workspace_actions set status=next_status,
        provider_receipt=case when next_status='unknown' then jsonb_build_object('reason','Submission outcome unverified; do not resend')
          else jsonb_build_object('sid',receipt_sid,'status',provider_status,'from',a.sender,'to',a.recipient_phone,'reconciled_at',now()) end,
        audit=a.audit||jsonb_build_array(jsonb_build_object('event',next_status,'actor','receipt-reconciliation','at',now()))
        where id=a.id and status=a.status;
      changed:=changed+1;
    end if;
  end loop;
  return changed;
end $$;
revoke all on function public.assistant_reconcile_receipts() from public,anon,authenticated;
grant execute on function public.assistant_reconcile_receipts() to service_role;
