create table if not exists public.listing_security_text (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  listing_source_id uuid references public.listing_sources(id) on delete cascade,
  canonical_url text not null unique,
  provider text not null,
  title_text text,
  meta_description text,
  structured_text text,
  body_text text,
  safety_text text not null,
  content_hash text not null,
  extractor_version smallint not null default 1,
  safety_decision text not null default 'REVIEW',
  safety_code text,
  safety_reason text,
  evidence_source text,
  evidence_match text,
  evidence_excerpt text,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint listing_security_text_nonempty check (length(btrim(safety_text)) > 0),
  constraint listing_security_text_size check (length(safety_text) <= 48000),
  constraint listing_security_text_hash_shape check (content_hash ~ '^[0-9a-f]{64}

alter table public.listing_security_text enable row level security;

revoke all on table public.listing_security_text from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_security_text to service_role;

create index if not exists listing_security_text_property_idx
  on public.listing_security_text(property_id,captured_at desc);

create index if not exists listing_security_text_source_idx
  on public.listing_security_text(listing_source_id);
),
  constraint listing_security_text_decision_check check (safety_decision in ('ACCEPT','REVIEW','REJECT')),
  constraint listing_security_text_source_check check (
    evidence_source is null or evidence_source in ('title','meta_description','structured','body','combined')
  ),
  constraint listing_security_text_match_size check (evidence_match is null or length(evidence_match) <= 300),
  constraint listing_security_text_excerpt_size check (evidence_excerpt is null or length(evidence_excerpt) <= 260)
);

alter table public.listing_security_text enable row level security;

revoke all on table public.listing_security_text from public, anon, authenticated;
grant select, insert, update, delete on table public.listing_security_text to service_role;

create index if not exists listing_security_text_property_idx
  on public.listing_security_text(property_id,captured_at desc);

create index if not exists listing_security_text_source_idx
  on public.listing_security_text(listing_source_id);
