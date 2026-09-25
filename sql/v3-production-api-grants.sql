-- Production API exposure and least-privilege grants for Nico Fit V3.
-- Apply only after every V3 migration and an approved production cutover.
-- Idempotent. No data mutation and no V2 dependency.

begin;

do $$
declare
  required_table text;
begin
  if current_setting('nico_fit.allow_v3_cutover', true) is distinct from 'approved' then
    raise exception 'V3 API grants are locked. Set nico_fit.allow_v3_cutover=approved for the approved cutover session.';
  end if;

  foreach required_table in array array[
    'exercise_catalog','workout_sessions','session_exercises','exercise_sets',
    'v2_workout_session_map','v2_workout_map','v2_set_map','v2_exercise_name_map',
    'daily_readiness','football_sessions','match_reviews',
    'routine_templates','routine_versions','routine_exercises',
    'operational_audit','rollout_config','rollout_config_history'
  ] loop
    if to_regclass(format('nico_fit_v3.%I', required_table)) is null then
      raise exception 'Required V3 table is missing: %', required_table;
    end if;
  end loop;
end;
$$;

-- Keep Supabase defaults and expose V3 through PostgREST.
alter role authenticator set pgrst.db_schemas = 'public, storage, graphql_public, nico_fit_v3';

revoke all on schema nico_fit_v3 from public, anon, authenticated;
revoke all on all tables in schema nico_fit_v3 from public, anon, authenticated;

grant usage on schema nico_fit_v3 to anon, authenticated;

grant select, insert, update on
  nico_fit_v3.exercise_catalog,
  nico_fit_v3.workout_sessions,
  nico_fit_v3.session_exercises,
  nico_fit_v3.exercise_sets,
  nico_fit_v3.daily_readiness,
  nico_fit_v3.football_sessions,
  nico_fit_v3.match_reviews,
  nico_fit_v3.routine_templates,
  nico_fit_v3.routine_versions,
  nico_fit_v3.routine_exercises
to authenticated;

grant select on
  nico_fit_v3.v2_workout_session_map,
  nico_fit_v3.v2_workout_map,
  nico_fit_v3.v2_set_map,
  nico_fit_v3.v2_exercise_name_map
to authenticated;

-- Audit is append-only for clients. Administrative retention functions keep
-- their separate service_role-only grants from the retention migration.
grant select, insert on nico_fit_v3.operational_audit to authenticated;

-- Rollout configuration is the only public V3 table. History is administrative.
grant select on nico_fit_v3.rollout_config to anon, authenticated;
revoke all on nico_fit_v3.rollout_config_history from public, anon, authenticated;

-- DELETE intentionally remains revoked. deleted_at is the normal tombstone.
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

commit;
