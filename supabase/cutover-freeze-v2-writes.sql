-- PREPARED ONLY. DO NOT RUN without explicit cutover approval.
-- Hard server-side write freeze for stale V2 clients. SELECT remains available.
begin;
do $$ begin
  if current_setting('nico_fit.cutover_v2_write_freeze',true) is distinct from 'approved' then
    raise exception 'V2 write freeze is locked';
  end if;
  if current_setting('nico_fit.expected_project_ref',true) is distinct from 'xaklsoqyzwowtjwcpwmb' then
    raise exception 'Unexpected project ref';
  end if;
end $$;

revoke insert,update,delete,truncate on table
  public.readiness,
  public.workouts,
  public.match_reviews,
  public.football_sessions,
  public.workout_sessions,
  public.sync_tombstones
from anon,authenticated;

commit;
