-- Additive repair for installations created with the original shared signals
-- trigger. It replaces only the trigger function; tables, triggers and data are
-- preserved. Safe to execute repeatedly after migration-v3-signals.sql.
begin;

do $$
begin
  if to_regnamespace('nico_fit_v3') is null
    or to_regclass('nico_fit_v3.daily_readiness') is null
    or to_regclass('nico_fit_v3.football_sessions') is null
    or to_regclass('nico_fit_v3.match_reviews') is null then
    raise exception 'V3 signals schema must exist before applying the identity guard repair';
  end if;
end;
$$;

create or replace function nico_fit_v3.signals_identity_guard() returns trigger language plpgsql
set search_path=pg_catalog,nico_fit_v3 as $$
declare
  row_data jsonb := to_jsonb(new);
  old_data jsonb;
  row_id uuid;
  row_user_id uuid;
  row_local_date date;
  linked_football_session_id uuid;
begin
  row_id := (row_data->>'id')::uuid;
  row_user_id := (row_data->>'user_id')::uuid;
  row_local_date := (row_data->>'local_date')::date;
  if tg_op='UPDATE' then
    old_data := to_jsonb(old);
    if row_id is distinct from (old_data->>'id')::uuid
      or row_user_id is distinct from (old_data->>'user_id')::uuid
      or row_local_date is distinct from (old_data->>'local_date')::date then
      raise exception using errcode='23514',message='signal identity and date are immutable';
    end if;
  end if;
  if tg_table_name='match_reviews' then
    linked_football_session_id := nullif(row_data->>'football_session_id','')::uuid;
    if linked_football_session_id is not null and nullif(row_data->>'deleted_at','') is null then
      if not exists(
        select 1 from nico_fit_v3.football_sessions f
        where f.id=linked_football_session_id
          and f.user_id=row_user_id
          and f.local_date=row_local_date
          and f.session_type='match'
          and f.deleted_at is null
      ) then
        raise exception using errcode='23514',message='review requires live owned same-date match';
      end if;
    end if;
  end if;
  if tg_table_name='football_sessions' then
    if row_data->>'session_type'<>'match'
      and nullif(row_data->>'deleted_at','') is null
      and exists(
        select 1 from nico_fit_v3.match_reviews r
        where r.football_session_id=row_id
          and r.user_id=row_user_id
          and r.deleted_at is null
      ) then
      raise exception using errcode='23514',message='match with reviews cannot change type';
    end if;
  end if;
  return new;
end $$;

revoke all on function nico_fit_v3.signals_identity_guard() from public,anon,authenticated;

commit;
