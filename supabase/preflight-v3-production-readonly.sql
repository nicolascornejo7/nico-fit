-- Non-destructive V2 -> V3 classification. It creates no schema or temp table.
-- Exercise sets marked migrated_candidate still require explicit approval of the
-- stable exercise mapping before the real backfill.
begin transaction read only;
set local statement_timeout = '30s';

with
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
  select w.*,exists(
    select 1 from public.sync_tombstones t
    where t.user_id=w.user_id and (
      (t.entity='workouts' and pg_input_is_valid(t.record_key,'jsonb') and t.record_key::jsonb=jsonb_build_array(w.date::text,w.exercise))
      or (t.entity='*' and w.updated_at<=t.deleted_at)
    )
  ) tombstoned,
  (select count(*) from session_src s where not s.tombstoned and s.user_id=w.user_id and s.date=w.date) session_candidates
  from public.workouts w
),
set_src as (
  select w.id workout_id,w.tombstoned,w.session_candidates,x.value raw_set,
    case
      when lower(w.exercise) in (lower('Plancha / Pallof press'),lower('Copenhagen plank'),lower('Movilidad tobillo/cadera/aductores')) then 'seconds'
      when lower(w.exercise) in (
        lower('Sentadilla o prensa'),lower('Peso muerto rumano'),lower('Press banca'),lower('Dominadas o jalón'),
        lower('Zancada búlgara'),lower('Elevación de gemelos'),lower('Press inclinado con mancuernas'),lower('Remo'),
        lower('Press militar'),lower('Dominadas / jalón'),lower('Curl femoral'),lower('Nordic curl'),lower('Core'),
        lower('Sentadilla ligera'),lower('Peso muerto rumano ligero'),lower('Saltos verticales'),lower('Press banca ligero'),lower('Gemelos')
      ) then 'reps'
      else null
    end measurement_kind
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
  select 'session_exercises',0,
    count(*) filter(where not tombstoned and session_candidates=1),
    count(*) filter(where tombstoned or session_candidates<>1)
  from workout_src
  union all
  select 'exercise_sets',
    count(*) filter(where not tombstoned and session_candidates=1 and measurement_kind is not null and raw_set->>'reps' ~ '^\d+$' and (raw_set->>'reps')::integer>0),
    count(*) filter(where not tombstoned and session_candidates=1 and not(measurement_kind is not null and raw_set->>'reps' ~ '^\d+$' and (raw_set->>'reps')::integer>0)),
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

-- Privacy-safe ambiguity summary. Hashes identify repeat cases without
-- disclosing user IDs, notes, loads, readiness values or raw payloads.
with session_counts as (
  select w.id,w.user_id,w.date,w.exercise,
         (select count(*) from public.workout_sessions s where s.user_id=w.user_id and s.date=w.date) candidates
  from public.workouts w
)
select jsonb_pretty(jsonb_build_object(
  'workouts_without_session',(select count(*) from session_counts where candidates=0),
  'workouts_with_multiple_sessions',(select count(*) from session_counts where candidates>1),
  'draft_sessions',(select count(*) from public.workout_sessions where ended_at is null),
  'malformed_tombstone_keys',(select count(*) from public.sync_tombstones where entity in ('workouts','football','sessions') and not pg_input_is_valid(record_key,'jsonb')),
  'unexpected_tombstone_entities',(select count(*) from public.sync_tombstones where entity not in ('readiness','workouts','matches','football','sessions','*')),
  'source_identity_hashes',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select md5(lower(exercise)) identity_hash,count(*) rows from public.workouts group by md5(lower(exercise)) order by rows desc) x)
)) ambiguity_summary;

commit;
