alter table public.agent_websites
  add column if not exists license_number text,
  add column if not exists rel8tion_agent_id text;

create index if not exists idx_agent_websites_rel8tion_agent_id
  on public.agent_websites(rel8tion_agent_id);
