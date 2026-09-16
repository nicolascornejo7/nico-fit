-- Non-destructive V2 -> V3 classification. It creates no schema or temp table.
-- Exercise sets marked migrated_candidate still require explicit approval of the
-- stable exercise mapping before the real backfill.
begin transaction read only;
set local statement_timeout = '30s';

with
approved_mappings(
  v2_workout_id,v2_session_id,expected_date,expected_day,expected_exercise,
  expected_updated_at,expected_sets_md5,expected_session_day,expected_session_label,
  expected_session_updated_at,expected_session_ended_at,canonical_key,measurement_kind,
  prescribed_position,mapping_version
) as (values
  (60,1,'2026-09-15'::date,'Martes','Sentadilla o prensa','2026-09-16T00:17:37.045+00:00'::timestamptz,'1f1196e5560ec89ba1539820488de06d','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'sentadilla-prensa','reps',0,1),
  (10,1,'2026-09-15'::date,'Martes','Press banca','2026-09-16T00:17:37.045+00:00'::timestamptz,'70ecd5551ea751c444b1e82212305679','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'press-banca','reps',2,1),
  (1,1,'2026-09-15'::date,'Martes','Elevación de gemelos','2026-09-16T00:17:37.045+00:00'::timestamptz,'a167bafef46d8d106dce6d31fb08c366','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'elevacion-gemelos','reps',5,1),
  (35,1,'2026-09-15'::date,'Martes','Plancha / Pallof press','2026-09-16T00:17:37.045+00:00'::timestamptz,'ae115e64793aa7ab57eff1c3d40aebd7','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'plancha-pallof','seconds',6,1)
),
session_src as (
  select s.*,exists(
    select 1 from public.sync_tombstones t
    where t.user_id=s.user_id and (
      (t.entity='sessions' and pg_input_is_valid(t.record_key,'jsonb') and t.record_key::jsonb=jsonb_build_array(s.date::text,s.label))
      or (t.entity='*' and s.updated_at<=t.deleted_at)
    )
  ) tombstoned
  from public.workout_sessions s
),
workout_src as (
  select w.*,am.canonical_key approved_canonical_key,
  am.measurement_kind approved_measurement_kind,
  am.prescribed_position approved_prescribed_position,
  am.mapping_version approved_mapping_version,
  (
    am.v2_workout_id is not null
    and w.date=am.expected_date and w.day=am.expected_day
    and w.exercise=am.expected_exercise and w.updated_at=am.expected_updated_at
    and md5(w.sets::text)=am.expected_sets_md5
    and exists(select 1 from session_src s where s.id=am.v2_session_id and not s.tombstoned and s.user_id=w.user_id and s.date=w.date
      and s.day=am.expected_session_day and s.label=am.expected_session_label and s.updated_at=am.expected_session_updated_at and s.ended_at=am.expected_session_ended_at)
  ) approved_mapping_valid,
  exists(
    select 1 from public.sync_tombstones t
    where t.user_id=w.user_id and (
      (t.entity='workouts' and pg_input_is_valid(t.record_key,'jsonb') and t.record_key::jsonb=jsonb_build_array(w.date::text,w.exercise))
      or (t.entity='*' and w.updated_at<=t.deleted_at)
    )
  ) tombstoned,
  (select count(*) from session_src s where not s.tombstoned and s.user_id=w.user_id and s.date=w.date) session_candidates
  from public.workouts w
  left join approved_mappings am on am.v2_workout_id=w.id
),
set_src as (
  select w.id workout_id,w.tombstoned,w.session_candidates,x.value raw_set,
    w.approved_mapping_valid,
    case when w.approved_mapping_valid then w.approved_measurement_kind else null end measurement_kind
  from workout_src w
  cross join lateral jsonb_array_elements(case when jsonb_typeof(w.sets)='array' then w.sets else '[]'::jsonb end) x(value)
),
readiness_src as (
  select r.*,exists(select 1 from public.sync_tombstones t where t.user_id=r.user_id and ((t.entity='readiness' and t.record_key=r.date::text) or (t.entity='*' and r.updated_at<=t.deleted_at))) tombstoned
  from public.readiness r
),
football_src as (
  select f.*,exists(select 1 from public.sync_tombstones t where t.user_id=f.user_id and ((t.entity='football' and pg_input_is_valid(t.record_key,'jsonb') and t.record_key::jsonb=jsonb_build_array(f.date::text,f.session_type)) or (t.entity='*' and f.updated_at<=t.deleted_at))) tombstoned
  from public.football_sessions f
),
match_src as (
  select m.*,exists(select 1 from public.sync_tombstones t where t.user_id=m.user_id and ((t.entity='matches' and t.record_key=m.date::text) or (t.entity='*' and m.updated_at<=t.deleted_at))) tombstoned
  from public.match_reviews m
),
classifications as (
  select 'workout_sessions' entity,
    count(*) filter(where not tombstoned and ended_at is not null) migrated,
    count(*) filter(where not tombstoned and ended_at is null) pending_review,
    count(*) filter(where tombstoned) skipped
  from session_src
  union all
  select 'session_exercises',
    count(*) filter(where not tombstoned and session_candidates=1 and approved_mapping_valid),
    count(*) filter(where not tombstoned and session_candidates=1 and not approved_mapping_valid),
    count(*) filter(where tombstoned or session_candidates<>1)
  from workout_src
  union all
  select 'exercise_sets',
    count(*) filter(where not tombstoned and session_candidates=1 and approved_mapping_valid and measurement_kind is not null and raw_set->>'reps' ~ '^\d+$' and (raw_set->>'reps')::integer>0),
    count(*) filter(where not tombstoned and session_candidates=1 and not(approved_mapping_valid and measurement_kind is not null and raw_set->>'reps' ~ '^\d+$' and (raw_set->>'reps')::integer>0)),
    count(*) filter(where tombstoned or session_candidates<>1)
  from set_src
  union all
  select 'daily_readiness',count(*) filter(where not tombstoned),0,count(*) filter(where tombstoned) from readiness_src
  union all
  select 'football_sessions',
    count(*) filter(where not tombstoned and session_type in ('Partido','Amistoso','Práctica amistosa F11','Entrenamiento equipo','Entrenamiento con el equipo')),
    count(*) filter(where not tombstoned and session_type not in ('Partido','Amistoso','Práctica amistosa F11','Entrenamiento equipo','Entrenamiento con el equipo')),
    count(*) filter(where tombstoned)
  from football_src
  union all
  select 'match_reviews',0,count(*) filter(where not tombstoned),count(*) filter(where tombstoned) from match_src
)
select * from classifications order by entity;

-- Privacy-safe ambiguity summary. IDs are the explicitly reviewed source PKs;
-- hashes identify other repeat cases without
-- disclosing user IDs, notes, loads, readiness values or raw payloads.
with approved_mappings(v2_workout_id,v2_session_id,expected_date,expected_day,expected_exercise,expected_updated_at,expected_sets_md5,expected_session_day,expected_session_label,expected_session_updated_at,expected_session_ended_at,canonical_key,measurement_kind,prescribed_position,mapping_version) as (values
  (60,1,'2026-09-15'::date,'Martes','Sentadilla o prensa','2026-09-16T00:17:37.045+00:00'::timestamptz,'1f1196e5560ec89ba1539820488de06d','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'sentadilla-prensa','reps',0,1),
  (10,1,'2026-09-15'::date,'Martes','Press banca','2026-09-16T00:17:37.045+00:00'::timestamptz,'70ecd5551ea751c444b1e82212305679','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'press-banca','reps',2,1),
  (1,1,'2026-09-15'::date,'Martes','Elevación de gemelos','2026-09-16T00:17:37.045+00:00'::timestamptz,'a167bafef46d8d106dce6d31fb08c366','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'elevacion-gemelos','reps',5,1),
  (35,1,'2026-09-15'::date,'Martes','Plancha / Pallof press','2026-09-16T00:17:37.045+00:00'::timestamptz,'ae115e64793aa7ab57eff1c3d40aebd7','Martes','Fuerza principal','2026-09-16T00:17:37.045+00:00'::timestamptz,'2026-09-16T00:17:21.136+00:00'::timestamptz,'plancha-pallof','seconds',6,1)
), session_counts as (
  select w.id,w.user_id,w.date,w.day,w.exercise,w.sets,w.updated_at,
         (select count(*) from public.workout_sessions s where s.user_id=w.user_id and s.date=w.date) candidates
  from public.workouts w
), mapping_status as (
  select s.id,
    (a.v2_workout_id is not null and s.date=a.expected_date and s.day=a.expected_day and s.exercise=a.expected_exercise
      and s.updated_at=a.expected_updated_at and md5(s.sets::text)=a.expected_sets_md5 and s.candidates=1
      and exists(select 1 from public.workout_sessions ws where ws.id=a.v2_session_id and ws.user_id=s.user_id and ws.date=s.date
        and ws.day=a.expected_session_day and ws.label=a.expected_session_label and ws.updated_at=a.expected_session_updated_at and ws.ended_at=a.expected_session_ended_at)) valid
  from session_counts s left join approved_mappings a on a.v2_workout_id=s.id
)
select jsonb_pretty(jsonb_build_object(
  'workouts_without_session',(select count(*) from session_counts where candidates=0),
  'workouts_with_multiple_sessions',(select count(*) from session_counts where candidates>1),
  'draft_sessions',(select count(*) from public.workout_sessions where ended_at is null),
  'malformed_tombstone_keys',(select count(*) from public.sync_tombstones where entity in ('workouts','football','sessions') and not pg_input_is_valid(record_key,'jsonb')),
  'unexpected_tombstone_entities',(select count(*) from public.sync_tombstones where entity not in ('readiness','workouts','matches','football','sessions','*')),
  'approved_mapping_valid',(select count(*) from mapping_status where valid),
  'approved_mapping_pending_review',(select count(*) from mapping_status where not valid),
  'approved_mapping_ids',(select coalesce(jsonb_agg(id order by id) filter(where valid),'[]'::jsonb) from mapping_status),
  'source_identity_hashes',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select md5(lower(exercise)) identity_hash,count(*) rows from public.workouts group by md5(lower(exercise)) order by rows desc) x)
)) ambiguity_summary;

commit;
