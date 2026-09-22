-- Additive migration for an existing V3 schema. No V2 tables or flags are touched.
alter table nico_fit_v3.workout_sessions
  add column if not exists session_type text not null default 'routine';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'nico_fit_v3.workout_sessions'::regclass
      and conname = 'workout_sessions_session_type_check'
  ) then
    alter table nico_fit_v3.workout_sessions
      add constraint workout_sessions_session_type_check
      check (session_type in ('routine', 'free_workout'));
  end if;
end;
$$;
