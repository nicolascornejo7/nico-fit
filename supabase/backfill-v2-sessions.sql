-- Nico Fit V2 -> V3 backfill, stage 1: workout sessions.
-- Requires migration-v3-schema.sql. Run on staging and review mappings first.

begin;

with eligible_sessions as (
  select s.*
  from public.workout_sessions s
  where not exists (
    select 1 from public.sync_tombstones t
    where t.user_id = s.user_id
      and (
        (t.entity = 'sessions' and nico_fit_v3.try_jsonb(t.record_key) = jsonb_build_array(s.date::text, s.label))
        or (t.entity = '*' and s.updated_at <= t.deleted_at)
      )
  )
)
insert into nico_fit_v3.workout_sessions (
  id, user_id, session_date, label, status, started_at, ended_at,
  duration_seconds, rpe, notes, version, created_at
)
select
  md5('nico-fit-v3:v2-session:' || s.id::text)::uuid,
  s.user_id,
  s.date,
  s.label,
  case when s.ended_at is not null then 'completed' else 'draft' end,
  s.started_at,
  s.ended_at,
  case when s.duration_minutes > 0 then s.duration_minutes * 60 else null end,
  case when s.rpe between 1 and 10 then s.rpe else null end,
  coalesce(s.notes, ''),
  1,
  coalesce(s.started_at, s.updated_at, now())
from eligible_sessions s
on conflict (id) do nothing;

-- Use a new statement snapshot so the mapping can see sessions inserted above.
with eligible_sessions as (
  select s.*
  from public.workout_sessions s
  where not exists (
    select 1 from public.sync_tombstones t
    where t.user_id = s.user_id
      and (
        (t.entity = 'sessions' and nico_fit_v3.try_jsonb(t.record_key) = jsonb_build_array(s.date::text, s.label))
        or (t.entity = '*' and s.updated_at <= t.deleted_at)
      )
  )
)
insert into nico_fit_v3.v2_workout_session_map (
  user_id, v2_session_id, v3_session_id, migration_status, migration_note,
  source_payload, migration_started_at, migration_completed_at
)
select
  s.user_id,
  s.id,
  md5('nico-fit-v3:v2-session:' || s.id::text)::uuid,
  case when s.ended_at is not null then 'migrated' else 'pending_review' end,
  case when s.ended_at is not null then '' else 'V2 session has no ended_at; imported as draft.' end,
  to_jsonb(s),
  now(),
  case when s.ended_at is not null then now() else null end
from eligible_sessions s
join nico_fit_v3.workout_sessions v3
  on v3.id = md5('nico-fit-v3:v2-session:' || s.id::text)::uuid
on conflict (user_id, v2_session_id) do nothing;

commit;
