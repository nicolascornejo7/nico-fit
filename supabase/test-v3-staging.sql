-- Assertions for the disposable Supabase staging project.

do $$
declare
  actual integer;
begin
  select count(*) into actual
  from nico_fit_v3.workout_sessions s
  join nico_fit_v3.v2_workout_session_map m on m.v3_session_id = s.id;
  if actual <> 9 then raise exception 'expected 9 V3 sessions, got %', actual; end if;

  select count(*) into actual
  from nico_fit_v3.session_exercises e
  join nico_fit_v3.v2_workout_map m on m.v3_session_exercise_id = e.id;
  if actual <> 6 then raise exception 'expected 6 V3 exercises, got %', actual; end if;

  select count(*) into actual
  from nico_fit_v3.exercise_sets s
  join nico_fit_v3.v2_set_map m on m.v3_set_id = s.id;
  if actual <> 8 then raise exception 'expected 8 V3 sets, got %', actual; end if;

  select count(*) into actual from nico_fit_v3.v2_workout_session_map;
  if actual <> 9 then raise exception 'expected 9 session mappings, got %', actual; end if;

  select count(*) into actual from nico_fit_v3.v2_workout_map;
  if actual <> 8 then raise exception 'expected 8 workout mappings, got %', actual; end if;

  select count(*) into actual from nico_fit_v3.v2_set_map;
  if actual <> 8 then raise exception 'expected 8 set mappings, got %', actual; end if;

  select count(*) into actual
  from nico_fit_v3.session_exercises
  where session_id = md5('nico-fit-v3:v2-session:104')::uuid
    and exercise_catalog_id = 'c0000000-0000-4000-8000-000000000002';
  if actual <> 2 then raise exception 'repeated exercise was not preserved'; end if;

  select count(*) into actual
  from nico_fit_v3.v2_workout_map
  where v2_workout_id = 1002 and migration_status = 'skipped';
  if actual <> 1 then raise exception 'ambiguous parent was inferred'; end if;

  select count(*) into actual
  from nico_fit_v3.v2_workout_session_map
  where v2_session_id = 106;
  if actual <> 0 then raise exception 'session tombstone was ignored'; end if;

  select count(*) into actual
  from nico_fit_v3.v2_workout_map
  where v2_workout_id = 1007;
  if actual <> 0 then raise exception 'workout tombstone was ignored'; end if;
end;
$$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

do $$
begin
  if exists (
    select 1 from nico_fit_v3.workout_sessions
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  ) then raise exception 'RLS exposed user B to user A'; end if;
end;
$$;

insert into nico_fit_v3.workout_sessions (
  id, user_id, session_date, label, version
) values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date, 'Version staging', 1
);

update nico_fit_v3.workout_sessions
set label = 'Version 2', version = 2
where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

do $$
begin
  begin
    update nico_fit_v3.workout_sessions
    set label = 'Version jump', version = 4
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    raise exception 'version jump was accepted';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    update nico_fit_v3.workout_sessions
    set label = 'Stale version', version = 2
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    raise exception 'stale version was accepted';
  exception when sqlstate 'PT409' then null;
  end;
end;
$$;

update nico_fit_v3.workout_sessions
set deleted_at = now(), version = 3
where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

do $$
begin
  begin
    update nico_fit_v3.workout_sessions
    set deleted_at = null, version = 4
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    raise exception 'soft-deleted session was resurrected';
  exception when object_not_in_prerequisite_state then null;
  end;
end;
$$;

rollback;

select jsonb_build_object(
  'sessions', (select count(*) from nico_fit_v3.workout_sessions s join nico_fit_v3.v2_workout_session_map m on m.v3_session_id = s.id),
  'session_exercises', (select count(*) from nico_fit_v3.session_exercises e join nico_fit_v3.v2_workout_map m on m.v3_session_exercise_id = e.id),
  'sets', (select count(*) from nico_fit_v3.exercise_sets s join nico_fit_v3.v2_set_map m on m.v3_set_id = s.id),
  'session_mappings', (select count(*) from nico_fit_v3.v2_workout_session_map),
  'workout_mappings', (select count(*) from nico_fit_v3.v2_workout_map),
  'set_mappings', (select count(*) from nico_fit_v3.v2_set_map)
) as staging_result;
