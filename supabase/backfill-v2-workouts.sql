-- Nico Fit V2 -> V3 backfill, stage 2: exercises and sets.
-- Run after backfill-v2-sessions.sql and after reviewing v2_exercise_name_map.

begin;

create temporary table v3_backfill_workout_candidates on commit drop as
with eligible_workouts as (
  select w.*
  from public.workouts w
  where not exists (
    select 1 from public.sync_tombstones t
    where t.user_id = w.user_id
      and (
        (t.entity = 'workouts' and nico_fit_v3.try_jsonb(t.record_key) = jsonb_build_array(w.date::text, w.exercise))
        or (t.entity = '*' and w.updated_at <= t.deleted_at)
      )
  )
), candidates as (
  select
    w.id,
    w.user_id,
    w.date,
    w.day,
    w.exercise,
    w.sets,
    w.updated_at,
    count(sm.v3_session_id) as candidate_count,
    (array_agg(sm.v3_session_id order by v2s.id) filter (where sm.v3_session_id is not null))[1] as v3_session_id
  from eligible_workouts w
  left join public.workout_sessions v2s on v2s.user_id = w.user_id and v2s.date = w.date
  left join nico_fit_v3.v2_workout_session_map sm
    on sm.user_id = v2s.user_id and sm.v2_session_id = v2s.id
  group by w.id, w.user_id, w.date, w.day, w.exercise, w.sets, w.updated_at
)
select
  c.*,
  row_number() over (partition by c.user_id, c.date order by c.id) - 1 as synthetic_position
from candidates c;

insert into nico_fit_v3.session_exercises (
  id, session_id, exercise_catalog_id, position, exercise_name_snapshot,
  prescription_snapshot, notes, version, created_at
)
select
  md5('nico-fit-v3:v2-workout:' || w.id::text)::uuid,
  w.v3_session_id,
  case when nm.review_status = 'approved' then nm.exercise_catalog_id else null end,
  w.synthetic_position,
  w.exercise,
  jsonb_build_object(
    'source', 'v2_backfill',
    'order', 'synthetic_v2_id_order',
    'requires_order_review', true
  ),
  '',
  1,
  coalesce(w.updated_at, now())
from v3_backfill_workout_candidates w
left join nico_fit_v3.v2_exercise_name_map nm
  on nm.user_id = w.user_id and nm.source_name = w.exercise
where w.candidate_count = 1
on conflict (id) do nothing;

insert into nico_fit_v3.v2_workout_map (
  user_id, v2_workout_id, v3_session_exercise_id, migration_status,
  migration_note, source_payload, migration_started_at, migration_completed_at
)
select
  w.user_id,
  w.id,
  case when e.id is not null then e.id else null end,
  case when e.id is not null then 'pending_review' else 'skipped' end,
  case
    when w.candidate_count = 0 then 'No V2 session exists for this user and date.'
    when w.candidate_count > 1 then 'Multiple V2 sessions exist for this user and date; parent was not inferred.'
    else 'Exercise order is synthetic and requires review.'
  end,
  jsonb_build_object(
    'id', w.id,
    'user_id', w.user_id,
    'date', w.date,
    'day', w.day,
    'exercise', w.exercise,
    'sets', w.sets,
    'updated_at', w.updated_at
  ),
  now(),
  case when e.id is not null then null else now() end
from v3_backfill_workout_candidates w
left join nico_fit_v3.session_exercises e
  on e.id = md5('nico-fit-v3:v2-workout:' || w.id::text)::uuid
on conflict (user_id, v2_workout_id) do nothing;

create temporary table v3_backfill_parsed_sets on commit drop as
with source_sets as (
  select
    w.user_id,
    w.id as v2_workout_id,
    wm.v3_session_exercise_id,
    (set_item.ordinality - 1)::integer as set_index,
    case
      when jsonb_typeof(set_item.value) = 'object' then set_item.value
      else jsonb_build_object('raw', set_item.value)
    end as raw_set,
    case when nm.review_status = 'approved' then nm.measurement_kind else null end as measurement_kind
  from public.workouts w
  join nico_fit_v3.v2_workout_map wm
    on wm.user_id = w.user_id
   and wm.v2_workout_id = w.id
   and wm.v3_session_exercise_id is not null
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(w.sets) = 'array' then w.sets else '[]'::jsonb end
  ) with ordinality as set_item(value, ordinality)
  left join nico_fit_v3.v2_exercise_name_map nm
    on nm.user_id = w.user_id and nm.source_name = w.exercise
)
select
  s.*,
  case when s.raw_set->>'kg' ~ '^\d+(\.\d+)?$' then (s.raw_set->>'kg')::numeric else null end as parsed_load,
  case when s.raw_set->>'rir' ~ '^\d+(\.\d+)?$' then (s.raw_set->>'rir')::numeric else null end as parsed_rir,
  case
    when length(s.raw_set->>'reps') <= 9 and s.raw_set->>'reps' ~ '^\d+$'
      then (s.raw_set->>'reps')::integer
    else null
  end as parsed_value
from source_sets s;

insert into nico_fit_v3.exercise_sets (
  id, session_exercise_id, position, load_kg, reps, duration_seconds, rir,
  is_completed, completed_at, version, created_at
)
select
  md5('nico-fit-v3:v2-set:' || s.v2_workout_id::text || ':' || s.set_index::text)::uuid,
  s.v3_session_exercise_id,
  s.set_index,
  case when s.parsed_load between 0 and 99999.999 then s.parsed_load else null end,
  case when s.measurement_kind = 'reps' and s.parsed_value > 0 then s.parsed_value else null end,
  case when s.measurement_kind = 'seconds' and s.parsed_value > 0 then s.parsed_value else null end,
  case when s.parsed_rir between 0 and 5 then s.parsed_rir else null end,
  coalesce((s.raw_set->>'done') = 'true', false)
    and s.parsed_value > 0
    and s.measurement_kind in ('reps', 'seconds'),
  null,
  1,
  now()
from v3_backfill_parsed_sets s
on conflict (id) do nothing;

insert into nico_fit_v3.v2_set_map (
  user_id, v2_workout_id, v2_set_index, v3_set_id, migration_status,
  migration_note, source_payload, migration_started_at, migration_completed_at
)
select
  s.user_id,
  s.v2_workout_id,
  s.set_index,
  md5('nico-fit-v3:v2-set:' || s.v2_workout_id::text || ':' || s.set_index::text)::uuid,
  case when s.measurement_kind is not null and s.parsed_value > 0 then 'migrated' else 'pending_review' end,
  case
    when s.measurement_kind is null then 'reps versus seconds was not approved; typed value remains null.'
    when s.parsed_value is null or s.parsed_value <= 0 then 'V2 value is missing or invalid.'
    else ''
  end,
  s.raw_set,
  now(),
  case when s.measurement_kind is not null and s.parsed_value > 0 then now() else null end
from v3_backfill_parsed_sets s
join nico_fit_v3.exercise_sets v3s
  on v3s.id = md5('nico-fit-v3:v2-set:' || s.v2_workout_id::text || ':' || s.set_index::text)::uuid
on conflict (user_id, v2_workout_id, v2_set_index) do nothing;

commit;
