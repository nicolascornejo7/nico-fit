-- STAGING ONLY, separate from schema creation. No production/cutover.
begin;
grant usage on schema nico_fit_v3 to authenticated;
grant select,insert,update on nico_fit_v3.routine_templates,nico_fit_v3.routine_versions,nico_fit_v3.routine_exercises to authenticated;
revoke delete on nico_fit_v3.routine_templates,nico_fit_v3.routine_versions,nico_fit_v3.routine_exercises from authenticated;
notify pgrst,'reload schema';
commit;
