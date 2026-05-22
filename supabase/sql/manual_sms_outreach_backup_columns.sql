alter table public.agent_outreach_queue add column if not exists manual_sms_sent boolean not null default false;
alter table public.agent_outreach_queue add column if not exists manual_sms_skipped boolean not null default false;
alter table public.agent_outreach_queue add column if not exists manual_sms_sent_at timestamptz;
alter table public.agent_outreach_queue add column if not exists last_outreach_at timestamptz;
alter table public.agent_outreach_queue add column if not exists channel text;
