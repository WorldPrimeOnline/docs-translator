-- Partner activation output: referral link, QR URL, Jira comment tracking
alter table public.partners
  add column if not exists partner_link               text,
  add column if not exists qr_code_url               text,
  add column if not exists activation_comment_added_at timestamptz,
  add column if not exists activation_comment_error   text;

comment on column public.partners.partner_link                is 'Canonical referral URL https://www.wpotranslations.org/ru?ref=CODE';
comment on column public.partners.qr_code_url                is 'QR code endpoint URL https://www.wpotranslations.org/api/partners/qr/CODE';
comment on column public.partners.activation_comment_added_at is 'Timestamp when Jira activation comment was posted';
comment on column public.partners.activation_comment_error    is 'Sanitized error if Jira comment failed (non-fatal)';
