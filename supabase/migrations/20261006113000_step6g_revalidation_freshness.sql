alter table public.listing_sources
  add column if not exists revalidation_failures integer not null default 0,
  add column if not exists last_revalidation_status text,
  add column if not exists last_revalidation_at timestamptz;

alter table public.listing_sources drop constraint if exists listing_sources_revalidation_status_check;
alter table public.listing_sources
  add constraint listing_sources_revalidation_status_check
  check (last_revalidation_status is null or last_revalidation_status in ('ok','rejected','unavailable','error'));

alter table public.properties
  add column if not exists last_revalidation_at timestamptz;

create index if not exists listing_sources_revalidation_due_idx
  on public.listing_sources(active,last_revalidation_at,last_checked);

create index if not exists properties_revalidation_idx
  on public.properties(status,last_revalidation_at,last_seen);
