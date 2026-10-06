create or replace function public.quarantine_stale_properties()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update public.properties
  set status='quarantine',
      quarantine_reason='stale_not_revalidated_4d',
      last_checked=now()
  where status in ('candidate','verified')
    and greatest(
      coalesce(last_revalidation_at,'epoch'::timestamptz),
      coalesce(last_seen,'epoch'::timestamptz)
    ) < now() - interval '4 days';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.quarantine_stale_properties() from public;
