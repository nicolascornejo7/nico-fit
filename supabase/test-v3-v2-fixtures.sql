-- Synthetic V2 data for the isolated V3 dry run.

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dry-run-a@example.invalid'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dry-run-b@example.invalid');

insert into public.workout_sessions
  (id, user_id, date, day, label, started_at, ended_at, duration_minutes, rpe, updated_at)
values
  (101, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-01', 'Martes', 'Normal', '2026-09-01 10:00Z', '2026-09-01 11:00Z', 60, 8, '2026-09-01 11:00Z'),
  (102, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-02', 'Miércoles', 'Doble mañana', '2026-09-02 09:00Z', '2026-09-02 09:40Z', 40, 6, '2026-09-02 09:40Z'),
  (103, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-02', 'Miércoles', 'Doble tarde', '2026-09-02 18:00Z', '2026-09-02 18:45Z', 45, 7, '2026-09-02 18:45Z'),
  (104, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-03', 'Jueves', 'Ejercicio repetido', '2026-09-03 10:00Z', '2026-09-03 11:00Z', 60, 7, '2026-09-03 11:00Z'),
  (105, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-04', 'Viernes', 'Series incompletas', '2026-09-04 10:00Z', '2026-09-04 10:35Z', 35, 5, '2026-09-04 10:35Z'),
  (106, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-06', 'Domingo', 'Sesión eliminada', '2026-09-06 10:00Z', '2026-09-06 10:30Z', 30, 5, '2026-09-06 10:30Z'),
  (107, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-07', 'Lunes', 'Workout eliminado', '2026-09-07 10:00Z', '2026-09-07 10:30Z', 30, 5, '2026-09-07 10:30Z'),
  (108, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-08', 'Martes', 'Métrica ambigua', '2026-09-08 10:00Z', '2026-09-08 10:30Z', 30, 6, '2026-09-08 10:30Z'),
  (109, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-09', 'Miércoles', 'Sesión abierta', '2026-09-09 10:00Z', null, 0, 0, '2026-09-09 10:10Z'),
  (201, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-09-01', 'Martes', 'Usuario B', '2026-09-01 12:00Z', '2026-09-01 13:00Z', 60, 7, '2026-09-01 13:00Z');

insert into public.workouts (id, user_id, date, day, exercise, sets, updated_at) values
  (1001, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-01', 'Martes', 'Press banca', '[{"kg":"80","reps":"8","rir":"2","done":true},{"kg":"80","reps":"8","rir":"2","done":true}]', '2026-09-01 11:00Z'),
  (1002, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-02', 'Miércoles', 'Curl femoral', '[{"kg":"30","reps":"10","rir":"2","done":true}]', '2026-09-02 18:45Z'),
  (1003, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-03', 'Jueves', 'Remo', '[{"kg":"50","reps":"10","rir":"2","done":true}]', '2026-09-03 11:00Z'),
  (1004, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-03', 'Jueves', 'remo', '[{"kg":"40","reps":"12","rir":"3","done":true}]', '2026-09-03 11:00Z'),
  (1005, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-04', 'Viernes', 'Sentadilla', '[{"kg":"70","reps":"5","rir":"3","done":true},{"kg":"70","reps":"","rir":"","done":false}]', '2026-09-04 10:35Z'),
  (1006, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-05', 'Sábado', 'Sin sesión padre', '[{"kg":"10","reps":"10","rir":"2","done":true}]', '2026-09-05 10:00Z'),
  (1007, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-07', 'Lunes', 'Peso muerto', '[{"kg":"100","reps":"5","rir":"2","done":true}]', '2026-09-07 10:30Z'),
  (1008, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-09-08', 'Martes', 'Core ambiguo', '[{"kg":"0","reps":"30","rir":"2","done":true}]', '2026-09-08 10:30Z'),
  (2001, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2026-09-01', 'Martes', 'Press banca', '[{"kg":"60","reps":"8","rir":"2","done":true}]', '2026-09-01 13:00Z');

insert into public.sync_tombstones (user_id, entity, record_key, deleted_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sessions', '["2026-09-06","Sesión eliminada"]', '2026-09-06 12:00Z'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'workouts', '["2026-09-07","Peso muerto"]', '2026-09-07 12:00Z');

insert into nico_fit_v3.exercise_catalog
  (id, owner_user_id, stable_key, canonical_name, measurement_kind)
values
  ('c0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'press-banca', 'Press banca', 'reps'),
  ('c0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'remo', 'Remo', 'reps'),
  ('c0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sentadilla', 'Sentadilla', 'reps'),
  ('c0000000-0000-4000-8000-000000000004', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'press-banca', 'Press banca', 'reps');

insert into nico_fit_v3.v2_exercise_name_map
  (user_id, source_name, exercise_catalog_id, measurement_kind, review_status,
   reviewed_at, migration_status, migration_note, source_payload, migration_completed_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Press banca', 'c0000000-0000-4000-8000-000000000001', 'reps', 'approved', now(), 'migrated', '', '{"fixture":true}', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Remo', 'c0000000-0000-4000-8000-000000000002', 'reps', 'approved', now(), 'migrated', '', '{"fixture":true}', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'remo', 'c0000000-0000-4000-8000-000000000002', 'reps', 'approved', now(), 'migrated', '', '{"fixture":true}', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Sentadilla', 'c0000000-0000-4000-8000-000000000003', 'reps', 'approved', now(), 'migrated', '', '{"fixture":true}', now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Press banca', 'c0000000-0000-4000-8000-000000000004', 'reps', 'approved', now(), 'migrated', '', '{"fixture":true}', now());

commit;
