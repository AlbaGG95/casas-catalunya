create table if not exists public.listing_discovery (
  canonical_url text primary key,
  provider text not null,
  province text,
  source_kind text,
  list_text text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  last_planned_at timestamptz,
  last_fetched_at timestamptz,
  fetch_count integer not null default 0,
  state text not null default 'seen',
  last_error text,
  constraint listing_discovery_state_check
    check (state in ('seen','planned','accepted','rejected','error'))
);

alter table public.listing_discovery enable row level security;
revoke all on public.listing_discovery from anon, authenticated;

create index if not exists listing_discovery_provider_idx
  on public.listing_discovery(provider,province,last_seen desc);

create index if not exists listing_discovery_fetch_idx
  on public.listing_discovery(last_fetched_at,last_planned_at);
