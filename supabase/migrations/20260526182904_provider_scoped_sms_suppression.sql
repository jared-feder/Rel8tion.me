alter table public.sms_suppression_list
  drop constraint if exists sms_suppression_list_phone_key;

create unique index if not exists sms_suppression_list_phone_provider_idx
  on public.sms_suppression_list(phone, coalesce(provider, 'global'));
