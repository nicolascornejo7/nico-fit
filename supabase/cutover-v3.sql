-- Nico Fit V3 cutover grants.
-- DO NOT RUN while V2 is the active frontend.
-- Run only after a V3-capable client, staging backfill, rollback backup, and API
-- schema exposure have been reviewed together.

begin;

do $$
begin
  if current_setting('nico_fit.allow_v3_cutover', true) is distinct from 'approved' then
    raise exception 'V3 cutover is locked. Set nico_fit.allow_v3_cutover=approved in this transaction after completing the cutover checklist.';
  end if;
end;
$$;

grant usage on schema nico_fit_v3 to authenticated;
grant select, insert, update on nico_fit_v3.exercise_catalog to authenticated;
grant select, insert, update on nico_fit_v3.workout_sessions to authenticated;
grant select, insert, update on nico_fit_v3.session_exercises to authenticated;
grant select, insert, update on nico_fit_v3.exercise_sets to authenticated;
grant select on nico_fit_v3.v2_workout_session_map to authenticated;
grant select on nico_fit_v3.v2_workout_map to authenticated;
grant select on nico_fit_v3.v2_set_map to authenticated;
grant select on nico_fit_v3.v2_exercise_name_map to authenticated;

-- DELETE intentionally remains revoked. deleted_at is the normal tombstone.
commit;
