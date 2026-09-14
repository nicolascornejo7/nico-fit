-- Nico Fit V3 - additive schema only.
-- This file does not rename, mutate, or remove any V2 table.

create schema if not exists nico_fit_v3;

create table if not exists nico_fit_v3.exercise_catalog (
  id uuid primary key,
  owner_user_id uuid references auth.users(id) on delete cascade,
  stable_key text not null check (length(trim(stable_key)) between 1 and 100),
  canonical_name text not null check (length(trim(canonical_name)) between 1 and 200),
  measurement_kind text not null default 'reps'
    check (measurement_kind in ('reps', 'seconds', 'mixed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists nico_fit_v3.workout_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_date date not null,
  label text not null check (length(trim(label)) between 1 and 200),
  status text not null default 'draft' check (status in ('draft', 'completed', 'abandoned')),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  notes text not null default '',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (ended_at is null or started_at is null or ended_at >= started_at),
  check (status <> 'completed' or ended_at is not null)
);

create table if not exists nico_fit_v3.session_exercises (
  id uuid primary key,
  session_id uuid not null references nico_fit_v3.workout_sessions(id) on delete restrict,
  exercise_catalog_id uuid references nico_fit_v3.exercise_catalog(id) on delete set null,
  position integer not null check (position >= 0),
  exercise_name_snapshot text not null check (length(trim(exercise_name_snapshot)) between 1 and 200),
  prescription_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(prescription_snapshot) = 'object'),
  notes text not null default '',
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists nico_fit_v3.exercise_sets (
  id uuid primary key,
  session_exercise_id uuid not null references nico_fit_v3.session_exercises(id) on delete restrict,
  position integer not null check (position >= 0),
  load_kg numeric(8,3) check (load_kg is null or load_kg >= 0),
  reps integer check (reps is null or reps > 0),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  rir numeric(3,1) check (rir is null or rir between 0 and 5),
  is_completed boolean not null default false,
  completed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (num_nonnulls(reps, duration_seconds) <= 1),
  check (not is_completed or reps is not null or duration_seconds is not null),
  check (completed_at is null or is_completed)
);

-- V2 -> V3 traceability. Mapping rows are written by the backfill, not clients.
create table if not exists nico_fit_v3.v2_workout_session_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  v2_session_id bigint not null references public.workout_sessions(id) on delete restrict,
  v3_session_id uuid not null unique references nico_fit_v3.workout_sessions(id) on delete restrict,
  migration_status text not null check (migration_status in ('migrated', 'pending_review', 'skipped', 'failed')),
  migration_note text not null default '',
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  migration_started_at timestamptz not null default now(),
  migration_completed_at timestamptz,
  primary key (user_id, v2_session_id)
);

create table if not exists nico_fit_v3.v2_workout_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  v2_workout_id bigint not null references public.workouts(id) on delete restrict,
  v3_session_exercise_id uuid unique references nico_fit_v3.session_exercises(id) on delete restrict,
  migration_status text not null check (migration_status in ('migrated', 'pending_review', 'skipped', 'failed')),
  migration_note text not null default '',
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  migration_started_at timestamptz not null default now(),
  migration_completed_at timestamptz,
  primary key (user_id, v2_workout_id)
);

create table if not exists nico_fit_v3.v2_set_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  v2_workout_id bigint not null,
  v2_set_index integer not null check (v2_set_index >= 0),
  v3_set_id uuid not null unique references nico_fit_v3.exercise_sets(id) on delete restrict,
  migration_status text not null check (migration_status in ('migrated', 'pending_review', 'skipped', 'failed')),
  migration_note text not null default '',
  source_payload jsonb not null check (jsonb_typeof(source_payload) = 'object'),
  migration_started_at timestamptz not null default now(),
  migration_completed_at timestamptz,
  primary key (user_id, v2_workout_id, v2_set_index),
  foreign key (user_id, v2_workout_id)
    references nico_fit_v3.v2_workout_map(user_id, v2_workout_id) on delete restrict
);

create table if not exists nico_fit_v3.v2_exercise_name_map (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_name text not null check (length(trim(source_name)) between 1 and 200),
  exercise_catalog_id uuid references nico_fit_v3.exercise_catalog(id) on delete restrict,
  measurement_kind text check (measurement_kind in ('reps', 'seconds')),
  review_status text not null default 'pending_review'
    check (review_status in ('approved', 'pending_review', 'rejected')),
  reviewed_at timestamptz,
  notes text not null default '',
  migration_status text not null default 'pending_review'
    check (migration_status in ('migrated', 'pending_review', 'skipped', 'failed')),
  migration_note text not null default '',
  source_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(source_payload) = 'object'),
  migration_started_at timestamptz not null default now(),
  migration_completed_at timestamptz,
  primary key (user_id, source_name)
);

create unique index if not exists exercise_catalog_scope_key_uidx
  on nico_fit_v3.exercise_catalog (
    coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid), stable_key
  );
create index if not exists exercise_catalog_owner_updated_idx
  on nico_fit_v3.exercise_catalog (owner_user_id, updated_at);
create index if not exists workout_sessions_user_date_idx
  on nico_fit_v3.workout_sessions (user_id, session_date desc);
create index if not exists workout_sessions_user_updated_idx
  on nico_fit_v3.workout_sessions (user_id, updated_at);
create index if not exists workout_sessions_active_idx
  on nico_fit_v3.workout_sessions (user_id, session_date desc) where deleted_at is null;
create unique index if not exists session_exercises_active_position_uidx
  on nico_fit_v3.session_exercises (session_id, position) where deleted_at is null;
create index if not exists session_exercises_session_updated_idx
  on nico_fit_v3.session_exercises (session_id, updated_at);
create unique index if not exists exercise_sets_active_position_uidx
  on nico_fit_v3.exercise_sets (session_exercise_id, position) where deleted_at is null;
create index if not exists exercise_sets_exercise_updated_idx
  on nico_fit_v3.exercise_sets (session_exercise_id, updated_at);
create index if not exists v2_session_map_v2_idx
  on nico_fit_v3.v2_workout_session_map (v2_session_id);
create index if not exists v2_workout_map_v2_idx
  on nico_fit_v3.v2_workout_map (v2_workout_id);

create or replace function nico_fit_v3.enforce_version_and_timestamps()
returns trigger
language plpgsql
set search_path = pg_catalog, nico_fit_v3
as $$
begin
  if tg_op = 'INSERT' then
    if new.version <> 1 then
      raise exception using errcode = '23514', message = 'new records must start at version 1';
    end if;
    new.created_at := coalesce(new.created_at, clock_timestamp());
    new.updated_at := new.created_at;
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception using errcode = '55000', message = 'deleted records are immutable';
  end if;
  if new.version <> old.version + 1 then
    raise exception using errcode = '40001', message = 'stale record version';
  end if;
  new.created_at := old.created_at;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function nico_fit_v3.try_jsonb(value text)
returns jsonb
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
begin
  return value::jsonb;
exception when others then
  return null;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['exercise_catalog','workout_sessions','session_exercises','exercise_sets'] loop
    execute format('drop trigger if exists enforce_version_and_timestamps on nico_fit_v3.%I', table_name);
    execute format(
      'create trigger enforce_version_and_timestamps before insert or update on nico_fit_v3.%I for each row execute function nico_fit_v3.enforce_version_and_timestamps()',
      table_name
    );
  end loop;
end;
$$;

alter table nico_fit_v3.exercise_catalog enable row level security;
alter table nico_fit_v3.workout_sessions enable row level security;
alter table nico_fit_v3.session_exercises enable row level security;
alter table nico_fit_v3.exercise_sets enable row level security;
alter table nico_fit_v3.v2_workout_session_map enable row level security;
alter table nico_fit_v3.v2_workout_map enable row level security;
alter table nico_fit_v3.v2_set_map enable row level security;
alter table nico_fit_v3.v2_exercise_name_map enable row level security;

drop policy if exists exercise_catalog_select on nico_fit_v3.exercise_catalog;
create policy exercise_catalog_select on nico_fit_v3.exercise_catalog for select
  using (owner_user_id is null or owner_user_id = auth.uid());
drop policy if exists exercise_catalog_insert on nico_fit_v3.exercise_catalog;
create policy exercise_catalog_insert on nico_fit_v3.exercise_catalog for insert
  with check (owner_user_id = auth.uid());
drop policy if exists exercise_catalog_update on nico_fit_v3.exercise_catalog;
create policy exercise_catalog_update on nico_fit_v3.exercise_catalog for update
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());

drop policy if exists workout_sessions_select on nico_fit_v3.workout_sessions;
create policy workout_sessions_select on nico_fit_v3.workout_sessions for select
  using (user_id = auth.uid());
drop policy if exists workout_sessions_insert on nico_fit_v3.workout_sessions;
create policy workout_sessions_insert on nico_fit_v3.workout_sessions for insert
  with check (user_id = auth.uid());
drop policy if exists workout_sessions_update on nico_fit_v3.workout_sessions;
create policy workout_sessions_update on nico_fit_v3.workout_sessions for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists session_exercises_select on nico_fit_v3.session_exercises;
create policy session_exercises_select on nico_fit_v3.session_exercises for select using (
  exists (select 1 from nico_fit_v3.workout_sessions s where s.id = session_id and s.user_id = auth.uid())
);
drop policy if exists session_exercises_insert on nico_fit_v3.session_exercises;
create policy session_exercises_insert on nico_fit_v3.session_exercises for insert with check (
  exists (select 1 from nico_fit_v3.workout_sessions s where s.id = session_id and s.user_id = auth.uid())
  and (
    exercise_catalog_id is null
    or exists (
      select 1 from nico_fit_v3.exercise_catalog c
      where c.id = exercise_catalog_id
        and c.deleted_at is null
        and (c.owner_user_id is null or c.owner_user_id = auth.uid())
    )
  )
);
drop policy if exists session_exercises_update on nico_fit_v3.session_exercises;
create policy session_exercises_update on nico_fit_v3.session_exercises for update using (
  exists (select 1 from nico_fit_v3.workout_sessions s where s.id = session_id and s.user_id = auth.uid())
) with check (
  exists (select 1 from nico_fit_v3.workout_sessions s where s.id = session_id and s.user_id = auth.uid())
  and (
    exercise_catalog_id is null
    or exists (
      select 1 from nico_fit_v3.exercise_catalog c
      where c.id = exercise_catalog_id
        and c.deleted_at is null
        and (c.owner_user_id is null or c.owner_user_id = auth.uid())
    )
  )
);

drop policy if exists exercise_sets_select on nico_fit_v3.exercise_sets;
create policy exercise_sets_select on nico_fit_v3.exercise_sets for select using (
  exists (
    select 1 from nico_fit_v3.session_exercises e
    join nico_fit_v3.workout_sessions s on s.id = e.session_id
    where e.id = session_exercise_id and s.user_id = auth.uid()
  )
);
drop policy if exists exercise_sets_insert on nico_fit_v3.exercise_sets;
create policy exercise_sets_insert on nico_fit_v3.exercise_sets for insert with check (
  exists (
    select 1 from nico_fit_v3.session_exercises e
    join nico_fit_v3.workout_sessions s on s.id = e.session_id
    where e.id = session_exercise_id and s.user_id = auth.uid()
  )
);
drop policy if exists exercise_sets_update on nico_fit_v3.exercise_sets;
create policy exercise_sets_update on nico_fit_v3.exercise_sets for update using (
  exists (
    select 1 from nico_fit_v3.session_exercises e
    join nico_fit_v3.workout_sessions s on s.id = e.session_id
    where e.id = session_exercise_id and s.user_id = auth.uid()
  )
) with check (
  exists (
    select 1 from nico_fit_v3.session_exercises e
    join nico_fit_v3.workout_sessions s on s.id = e.session_id
    where e.id = session_exercise_id and s.user_id = auth.uid()
  )
);

-- Mapping tables are read-only for clients. Service-role/backfill code writes them.
drop policy if exists v2_session_map_select on nico_fit_v3.v2_workout_session_map;
create policy v2_session_map_select on nico_fit_v3.v2_workout_session_map for select using (user_id = auth.uid());
drop policy if exists v2_workout_map_select on nico_fit_v3.v2_workout_map;
create policy v2_workout_map_select on nico_fit_v3.v2_workout_map for select using (user_id = auth.uid());
drop policy if exists v2_set_map_select on nico_fit_v3.v2_set_map;
create policy v2_set_map_select on nico_fit_v3.v2_set_map for select using (user_id = auth.uid());
drop policy if exists v2_exercise_name_map_select on nico_fit_v3.v2_exercise_name_map;
create policy v2_exercise_name_map_select on nico_fit_v3.v2_exercise_name_map for select using (user_id = auth.uid());

-- V3 stays unavailable to V2 clients. Client grants belong to cutover-v3.sql.
revoke all on schema nico_fit_v3 from public, anon, authenticated;
revoke all on all tables in schema nico_fit_v3 from public, anon, authenticated;
revoke all on all functions in schema nico_fit_v3 from public, anon, authenticated;
grant usage on schema nico_fit_v3 to service_role;
grant all on all tables in schema nico_fit_v3 to service_role;
grant execute on all functions in schema nico_fit_v3 to service_role;
