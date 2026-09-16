-- Strategy B only: run on a disposable recovery target after recreating Auth.
-- Required settings: nico_fit.dr_target_ref, nico_fit.dr_old_user_id,
-- nico_fit.dr_new_user_id. Protected refs are rejected.
begin;
do $$
declare target_ref text:=current_setting('nico_fit.dr_target_ref',true);
begin
  if target_ref is null or target_ref in ('xaklsoqyzwowtjwcpwmb','tmydirzzlmlmtjgwqcgh') then
    raise exception 'Protected or missing disaster-recovery target ref';
  end if;
end $$;

update public.readiness set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;
update public.workouts set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;
update public.match_reviews set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;
update public.football_sessions set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;
update public.workout_sessions set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;
update public.sync_tombstones set user_id=current_setting('nico_fit.dr_new_user_id')::uuid where user_id=current_setting('nico_fit.dr_old_user_id')::uuid;

do $$
declare old_id uuid:=current_setting('nico_fit.dr_old_user_id')::uuid;
begin
  if exists(select 1 from public.readiness where user_id=old_id)
    or exists(select 1 from public.workouts where user_id=old_id)
    or exists(select 1 from public.match_reviews where user_id=old_id)
    or exists(select 1 from public.football_sessions where user_id=old_id)
    or exists(select 1 from public.workout_sessions where user_id=old_id)
    or exists(select 1 from public.sync_tombstones where user_id=old_id) then
    raise exception 'Ownership remap incomplete';
  end if;
end $$;
commit;
