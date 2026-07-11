alter table public.agent_outreach_queue
  add column if not exists report_note text,
  add column if not exists report_note_updated_at timestamptz;

comment on column public.agent_outreach_queue.report_note is
  'Admin-entered note that should appear in REL8TION COMMAND open house reports, used for missing/manual reply context.';
