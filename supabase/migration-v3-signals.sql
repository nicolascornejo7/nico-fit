-- ADDITIVE extension. Apply only in isolated/staging after migration-v3-schema.sql.
-- No V2 modifications, grants/cutover, or automatic backfill.
begin;
create table if not exists nico_fit_v3.daily_readiness (
  id uuid primary key, user_id uuid not null references auth.users(id),
  local_date date not null, sleep smallint not null check(sleep between 1 and 5),
  energy smallint not null check(energy between 1 and 5), freshness smallint not null check(freshness between 1 and 5),
  pain smallint not null check(pain between 0 and 10), pain_area text not null default '' check(length(pain_area)<=200),
  notes text not null default '' check(length(notes)<=4000),
  migration_status text check(migration_status in ('migrated','pending_review','skipped')), migration_note text, source_payload jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz, version bigint not null default 1 check(version>0), unique(user_id,local_date)
);
create table if not exists nico_fit_v3.football_sessions (
  id uuid primary key, user_id uuid not null references auth.users(id), local_date date not null,
  session_type text not null check(session_type in ('training','friendly','match')),
  duration_minutes numeric not null check(duration_minutes between 1 and 600 and duration_minutes*10=trunc(duration_minutes*10)),
  rpe numeric not null check(rpe between 1 and 10 and rpe*10=trunc(rpe*10)),
  minutes_played integer check(minutes_played between 0 and 600 and minutes_played<=duration_minutes),
  calculated_load numeric generated always as (duration_minutes*rpe) stored,
  notes text not null default '' check(length(notes)<=4000),
  migration_status text check(migration_status in ('migrated','pending_review','skipped')), migration_note text, source_payload jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz, version bigint not null default 1 check(version>0), unique(id,user_id)
);
create table if not exists nico_fit_v3.match_reviews (
  id uuid primary key, user_id uuid not null references auth.users(id), local_date date not null,
  football_session_id uuid, energy smallint not null check(energy between 1 and 5),
  legs smallint not null check(legs between 1 and 5), performance smallint not null check(performance between 1 and 5),
  rpe numeric check(rpe between 1 and 10 and rpe*10=trunc(rpe*10)), minutes_played integer check(minutes_played between 0 and 600),
  notes text not null default '' check(length(notes)<=4000),
  migration_status text check(migration_status in ('migrated','pending_review','skipped')), migration_note text, source_payload jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz, version bigint not null default 1 check(version>0),
  foreign key(football_session_id,user_id) references nico_fit_v3.football_sessions(id,user_id)
);
create or replace function nico_fit_v3.signals_identity_guard() returns trigger language plpgsql
set search_path=pg_catalog,nico_fit_v3 as $$
begin
  if tg_op='UPDATE' and (new.id<>old.id or new.user_id<>old.user_id or new.local_date<>old.local_date) then
    raise exception using errcode='23514',message='signal identity and date are immutable';
  end if;
  if tg_table_name='match_reviews' then
   if new.football_session_id is not null and new.deleted_at is null then
    if not exists(select 1 from nico_fit_v3.football_sessions f where f.id=new.football_session_id and f.user_id=new.user_id and f.local_date=new.local_date and f.session_type='match' and f.deleted_at is null) then
      raise exception using errcode='23514',message='review requires live owned same-date match';
    end if;
   end if;
  end if;
  if tg_table_name='football_sessions' then
    if new.session_type<>'match' and new.deleted_at is null and exists(select 1 from nico_fit_v3.match_reviews r where r.football_session_id=new.id and r.user_id=new.user_id and r.deleted_at is null) then
      raise exception using errcode='23514',message='match with reviews cannot change type';
    end if;
  end if;
  return new;
end $$;
alter table nico_fit_v3.daily_readiness enable row level security;
alter table nico_fit_v3.football_sessions enable row level security;
alter table nico_fit_v3.match_reviews enable row level security;
do $$ declare name text; begin
  foreach name in array array['daily_readiness','football_sessions','match_reviews'] loop
    if not exists(select 1 from pg_trigger where tgrelid=format('nico_fit_v3.%I',name)::regclass and tgname='enforce_version_and_timestamps') then
    execute format('create trigger enforce_version_and_timestamps before insert or update on nico_fit_v3.%I for each row execute function nico_fit_v3.enforce_version_and_timestamps()',name);
    end if;
    if not exists(select 1 from pg_trigger where tgrelid=format('nico_fit_v3.%I',name)::regclass and tgname='signals_identity_guard') then
    execute format('create trigger signals_identity_guard before insert or update on nico_fit_v3.%I for each row execute function nico_fit_v3.signals_identity_guard()',name);
    end if;
    if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename=name and policyname='signals_select') then
    execute format('create policy signals_select on nico_fit_v3.%I for select using (user_id=auth.uid())',name);
    end if;
    if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename=name and policyname='signals_insert') then
    execute format('create policy signals_insert on nico_fit_v3.%I for insert with check(user_id=auth.uid())',name);
    end if;
    if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename=name and policyname='signals_update') then
    execute format('create policy signals_update on nico_fit_v3.%I for update using(user_id=auth.uid()) with check(user_id=auth.uid())',name);
    end if;
    execute format('create index if not exists %I on nico_fit_v3.%I(user_id,updated_at,id)',name||'_sync_idx',name);
    execute format('create index if not exists %I on nico_fit_v3.%I(user_id,local_date)',name||'_date_idx',name);
    execute format('revoke all on nico_fit_v3.%I from public,anon,authenticated',name);
    execute format('grant all on nico_fit_v3.%I to service_role',name);
  end loop;
end $$;
create index if not exists match_reviews_parent_idx on nico_fit_v3.match_reviews(football_session_id,user_id);
revoke all on function nico_fit_v3.signals_identity_guard() from public,anon,authenticated;
commit;
