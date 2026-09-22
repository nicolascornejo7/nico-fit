-- Additive V3-only policy. It never schedules a purge and grants no purge capability to clients.
begin;

create or replace function nico_fit_v3.audit_append_only() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'INSERT' then
    new.received_at = clock_timestamp();
    return new;
  end if;

  if tg_op = 'DELETE'
     and current_setting('nico_fit.audit_purge', true) = 'authorized' then
    return old;
  end if;

  raise exception using errcode = '55000', message = 'audit events are append-only; use the privileged retention procedure';
end;
$$;

create or replace function nico_fit_v3.audit_retention_preview(
  p_as_of timestamptz default clock_timestamp()
) returns table(category text, retention_days integer, eligible_count bigint)
language sql
security definer
set search_path = pg_catalog, nico_fit_v3
as $$
  with policy(category, retention_days) as (
    values
      ('conflict_resolution', 730),
      ('sync_failure:transient', 30),
      ('sync_failure:auth', 90),
      ('sync_failure:conflict', 365),
      ('sync_failure:permanent', 365)
  ), classified as (
    select case
      when event_type = 'conflict_resolution' then 'conflict_resolution'
      else 'sync_failure:' || error_kind
    end as category, received_at
    from nico_fit_v3.operational_audit
  )
  select policy.category, policy.retention_days, count(classified.category)::bigint
  from policy
  left join classified
    on classified.category = policy.category
   and classified.received_at < p_as_of - make_interval(days => policy.retention_days)
  group by policy.category, policy.retention_days
  order by policy.category;
$$;

create or replace function nico_fit_v3.purge_operational_audit(
  p_mode text,
  p_user_id uuid default null,
  p_confirm_account_deletion boolean default false,
  p_as_of timestamptz default clock_timestamp()
) returns table(category text, purged_count bigint)
language plpgsql
security definer
set search_path = pg_catalog, nico_fit_v3
as $$
begin
  if p_mode not in ('retention', 'account_deletion') then
    raise exception using errcode = '22023', message = 'p_mode must be retention or account_deletion';
  end if;
  if p_as_of > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = '22023', message = 'p_as_of cannot be in the future';
  end if;
  if p_mode = 'retention' and p_user_id is not null then
    raise exception using errcode = '22023', message = 'retention purge cannot target a single account';
  end if;
  if p_mode = 'account_deletion' and (p_user_id is null or not p_confirm_account_deletion) then
    raise exception using errcode = '22023', message = 'account deletion requires user id and explicit confirmation';
  end if;

  perform set_config('nico_fit.audit_purge', 'authorized', true);

  if p_mode = 'retention' then
    return query
      with deleted as (
        delete from nico_fit_v3.operational_audit
        where (event_type = 'conflict_resolution' and received_at < p_as_of - interval '730 days')
           or (event_type = 'sync_failure' and error_kind = 'transient' and received_at < p_as_of - interval '30 days')
           or (event_type = 'sync_failure' and error_kind = 'auth' and received_at < p_as_of - interval '90 days')
           or (event_type = 'sync_failure' and error_kind in ('conflict', 'permanent') and received_at < p_as_of - interval '365 days')
        returning event_type, error_kind
      )
      select case when event_type = 'conflict_resolution' then 'conflict_resolution'
                  else 'sync_failure:' || error_kind end,
             count(*)::bigint
      from deleted
      group by 1
      order by 1;
  else
    return query
      with deleted as (
        delete from nico_fit_v3.operational_audit
        where user_id = p_user_id
        returning event_type, error_kind
      )
      select case when event_type = 'conflict_resolution' then 'conflict_resolution'
                  else 'sync_failure:' || error_kind end,
             count(*)::bigint
      from deleted
      group by 1
      order by 1;
  end if;
end;
$$;

alter table nico_fit_v3.operational_audit enable row level security;
revoke delete, update on nico_fit_v3.operational_audit from public, anon, authenticated;
revoke all on function nico_fit_v3.audit_retention_preview(timestamptz) from public, anon, authenticated;
revoke all on function nico_fit_v3.purge_operational_audit(text, uuid, boolean, timestamptz) from public, anon, authenticated;
grant execute on function nico_fit_v3.audit_retention_preview(timestamptz) to service_role;
grant execute on function nico_fit_v3.purge_operational_audit(text, uuid, boolean, timestamptz) to service_role;
notify pgrst, 'reload schema';
commit;