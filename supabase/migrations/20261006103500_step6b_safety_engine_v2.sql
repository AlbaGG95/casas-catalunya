alter table public.properties
  add column if not exists safety_decision text not null default 'REVIEW',
  add column if not exists safety_reason text,
  add column if not exists safety_code text;

alter table public.properties drop constraint if exists properties_safety_decision_check;
alter table public.properties
  add constraint properties_safety_decision_check
  check (safety_decision in ('ACCEPT','REVIEW'));

alter table public.listing_sources
  add column if not exists safety_decision text not null default 'REVIEW',
  add column if not exists safety_reason text,
  add column if not exists safety_code text;

alter table public.listing_sources drop constraint if exists listing_sources_safety_decision_check;
alter table public.listing_sources
  add constraint listing_sources_safety_decision_check
  check (safety_decision in ('ACCEPT','REVIEW'));

update public.properties
set safety_decision='REVIEW',
    safety_reason='pre-v2 catalogue awaiting reclassification',
    safety_code='legacy_unclassified'
where status in ('candidate','verified');

create index if not exists properties_safety_decision_idx
  on public.properties(status,safety_decision,price,score desc);
