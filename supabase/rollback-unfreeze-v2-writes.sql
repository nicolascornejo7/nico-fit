-- PREPARED ONLY. Restores the observed 2026-09-16 V2 table grants.
-- Run only as part of an approved rollback while V2 remains authoritative.
begin;
do $$ begin
  if current_setting('nico_fit.rollback_v2_write_freeze',true) is distinct from 'approved' then
    raise exception 'V2 write unfreeze is locked';
  end if;
  if current_setting('nico_fit.expected_project_ref',true) is distinct from 'xaklsoqyzwowtjwcpwmb' then
    raise exception 'Unexpected project ref';
  end if;
end $$;

grant insert,update,delete,truncate on table
  public.readiness,
  public.workouts,
  public.match_reviews,
  public.football_sessions,
  public.workout_sessions,
  public.sync_tombstones
to anon,authenticated;

commit;
