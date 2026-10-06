alter table public.properties drop constraint if exists properties_safety_decision_check;
alter table public.properties
  add constraint properties_safety_decision_check
  check (safety_decision in ('ACCEPT','REVIEW','REJECT'));

alter table public.listing_sources drop constraint if exists listing_sources_safety_decision_check;
alter table public.listing_sources
  add constraint listing_sources_safety_decision_check
  check (safety_decision in ('ACCEPT','REVIEW','REJECT'));
