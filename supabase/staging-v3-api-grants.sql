-- Staging-only grants for testing V3 through PostgREST/supabase-js.
-- These grants are intentionally separate from migration and cutover.

grant usage on schema nico_fit_v3 to authenticated, service_role;
grant select, insert, update on nico_fit_v3.exercise_catalog to authenticated;
grant select, insert, update on nico_fit_v3.workout_sessions to authenticated;
grant select, insert, update on nico_fit_v3.session_exercises to authenticated;
grant select, insert, update on nico_fit_v3.exercise_sets to authenticated;
grant select on nico_fit_v3.v2_workout_session_map to authenticated;
grant select on nico_fit_v3.v2_workout_map to authenticated;
grant select on nico_fit_v3.v2_set_map to authenticated;
grant select on nico_fit_v3.v2_exercise_name_map to authenticated;

revoke all on schema nico_fit_v3 from anon;
revoke all on all tables in schema nico_fit_v3 from anon;

-- The disposable project exposes V3 explicitly without changing production.
alter role authenticator set pgrst.db_schemas = 'public, nico_fit_v3';
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
