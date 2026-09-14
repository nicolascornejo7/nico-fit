-- Nico Fit V3 behavioral validation.
-- Run only on a disposable local/staging Supabase database after migration-v3-schema.sql.
-- Every data and permission change is rolled back.

begin;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'v3-test-a@example.invalid'),
  ('20000000-0000-4000-8000-000000000002', 'v3-test-b@example.invalid')
on conflict (id) do nothing;

grant usage on schema nico_fit_v3 to authenticated;
grant select, insert, update on nico_fit_v3.exercise_catalog to authenticated;
grant select, insert, update on nico_fit_v3.workout_sessions to authenticated;
grant select, insert, update on nico_fit_v3.session_exercises to authenticated;
grant select, insert, update on nico_fit_v3.exercise_sets to authenticated;

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'assertion failed: %', message; end if;
end;
$$;

create or replace function pg_temp.assert_raises(statement text, expected_state text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
    raise exception using errcode = 'P0001', message = 'statement did not fail';
  exception when others then
    if sqlstate <> expected_state then
      raise exception 'expected SQLSTATE %, got %: %', expected_state, sqlstate, sqlerrm;
    end if;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

insert into nico_fit_v3.exercise_catalog (
  id, owner_user_id, stable_key, canonical_name, measurement_kind
) values (
  'a0000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'press-banca', 'Press banca', 'reps'
);

-- Multiple sessions on one day are valid because identity is UUID-based.
insert into nico_fit_v3.workout_sessions (
  id, user_id, session_date, label, status, started_at, ended_at
) values
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '2026-09-15', 'Mañana', 'completed', '2026-09-15 09:00Z', '2026-09-15 10:00Z'),
  ('a1000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '2026-09-15', 'Tarde', 'draft', '2026-09-15 18:00Z', null);
select pg_temp.assert_true(
  (select count(*) = 2 from nico_fit_v3.workout_sessions where session_date = '2026-09-15'),
  'multiple sessions on one day'
);

-- Repeating a catalog exercise is valid when occurrence positions differ.
insert into nico_fit_v3.session_exercises (
  id, session_id, exercise_catalog_id, position, exercise_name_snapshot, prescription_snapshot
) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 0, 'Press banca', '{"sets":3,"min":6,"max":10}'),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 1, 'Press banca', '{"sets":2,"min":12,"max":15}');
select pg_temp.assert_true(
  (select count(*) = 2 from nico_fit_v3.session_exercises where exercise_catalog_id = 'a0000000-0000-4000-8000-000000000001'),
  'repeated exercise occurrences'
);

-- Active positions cannot be duplicated.
select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.session_exercises (
    id, session_id, position, exercise_name_snapshot
  ) values (
    'a2000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001', 0, 'Duplicado'
  )
$sql$, '23505');

insert into nico_fit_v3.exercise_sets (
  id, session_exercise_id, position, load_kg, reps, rir, is_completed
) values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', 0, 80, 8, 2, true
);

select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.exercise_sets (
    id, session_exercise_id, position, reps
  ) values (
    'a3000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001', 0, 8
  )
$sql$, '23505');

select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.exercise_sets (
    id, session_exercise_id, position, reps, duration_seconds
  ) values (
    'a3000000-0000-4000-8000-000000000003',
    'a2000000-0000-4000-8000-000000000001', 1, 8, 30
  )
$sql$, '23514');

-- Server trigger accepts exactly +1 and rejects stale versions and jumps.
update nico_fit_v3.workout_sessions
set label = 'Mañana corregida', version = 2
where id = 'a1000000-0000-4000-8000-000000000001';
select pg_temp.assert_raises($sql$
  update nico_fit_v3.workout_sessions
  set label = 'Salto', version = 4
  where id = 'a1000000-0000-4000-8000-000000000001'
$sql$, 'PT409');
select pg_temp.assert_raises($sql$
  update nico_fit_v3.workout_sessions
  set label = 'Obsoleta', version = 2
  where id = 'a1000000-0000-4000-8000-000000000001'
$sql$, 'PT409');

-- Soft-deleted rows remain readable for sync, are excluded by active queries,
-- cannot be resurrected, and cannot be physically deleted by authenticated.
update nico_fit_v3.workout_sessions
set deleted_at = now(), version = 3
where id = 'a1000000-0000-4000-8000-000000000001';
select pg_temp.assert_true(
  (select count(*) = 1 from nico_fit_v3.workout_sessions where id = 'a1000000-0000-4000-8000-000000000001'),
  'tombstone remains visible to owner sync'
);
select pg_temp.assert_true(
  (select count(*) = 0 from nico_fit_v3.workout_sessions where id = 'a1000000-0000-4000-8000-000000000001' and deleted_at is null),
  'active query excludes tombstone'
);
select pg_temp.assert_raises($sql$
  update nico_fit_v3.workout_sessions
  set deleted_at = null, version = 4
  where id = 'a1000000-0000-4000-8000-000000000001'
$sql$, '55000');
select pg_temp.assert_raises($sql$
  delete from nico_fit_v3.workout_sessions
  where id = 'a1000000-0000-4000-8000-000000000001'
$sql$, '42501');

-- User B creates a parent and child that user A must not see or reference.
select set_config('request.jwt.claim.sub', '20000000-0000-4000-8000-000000000002', true);
insert into nico_fit_v3.exercise_catalog (
  id, owner_user_id, stable_key, canonical_name, measurement_kind
) values (
  'b0000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  'private-b', 'Privado B', 'reps'
);
insert into nico_fit_v3.workout_sessions (
  id, user_id, session_date, label
) values (
  'b1000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002', '2026-09-15', 'Usuario B'
);
insert into nico_fit_v3.session_exercises (
  id, session_id, position, exercise_name_snapshot
) values (
  'b2000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001', 0, 'Privado B'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true(
  (select count(*) = 0 from nico_fit_v3.workout_sessions where id = 'b1000000-0000-4000-8000-000000000001'),
  'RLS hides another user session'
);
select pg_temp.assert_true(
  (select count(*) = 0 from nico_fit_v3.session_exercises where id = 'b2000000-0000-4000-8000-000000000001'),
  'RLS hides another user exercise'
);
select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.exercise_sets (
    id, session_exercise_id, position, reps
  ) values (
    'b3000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 0, 8
  )
$sql$, '42501');
select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.session_exercises (
    id, session_id, exercise_catalog_id, position, exercise_name_snapshot
  ) values (
    'a2000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000001', 0, 'Catálogo ajeno'
  )
$sql$, '42501');

-- Referential integrity is tested as the migration owner so RLS cannot mask FK behavior.
reset role;
select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.session_exercises (
    id, session_id, position, exercise_name_snapshot
  ) values (
    'f2000000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 0, 'Huérfano'
  )
$sql$, '23503');
select pg_temp.assert_raises($sql$
  insert into nico_fit_v3.exercise_sets (
    id, session_exercise_id, position, reps
  ) values (
    'f3000000-0000-4000-8000-000000000001',
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 0, 8
  )
$sql$, '23503');

-- Trace tables expose every required audit field.
select pg_temp.assert_true(
  not exists (
    select required.column_name
    from (values
      ('migration_status'), ('migration_note'), ('source_payload'),
      ('migration_started_at'), ('migration_completed_at')
    ) required(column_name)
    where not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'nico_fit_v3'
        and c.table_name = 'v2_workout_map'
        and c.column_name = required.column_name
    )
  ),
  'traceability audit columns'
);

rollback;
