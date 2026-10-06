alter table public.source_health
  add column if not exists cooldown_until timestamptz,
  add column if not exists last_recovered_at timestamptz,
  add column if not exists recovery_count integer not null default 0;

create index if not exists source_health_recovery_idx
  on public.source_health(status,cooldown_until);
