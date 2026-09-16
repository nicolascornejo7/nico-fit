-- Nico Fit V2 logical recovery export. SELECT-only by design.
-- Run only in gym-futbol production (ref xaklsoqyzwowtjwcpwmb), download the
-- single payload_base64 result as CSV, and keep it encrypted outside Git.
begin transaction read only;
set local statement_timeout = '60s';

with
source_counts as (
  select jsonb_build_object(
    'auth_users',(select count(*) from auth.users),
    'readiness',(select count(*) from public.readiness),
    'workouts',(select count(*) from public.workouts),
    'match_reviews',(select count(*) from public.match_reviews),
    'football_sessions',(select count(*) from public.football_sessions),
    'workout_sessions',(select count(*) from public.workout_sessions),
    'sync_tombstones',(select count(*) from public.sync_tombstones)
  ) value
),
catalog as (
  select jsonb_build_object(
    'columns',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.ordinal_position) from (
      select table_schema,table_name,ordinal_position,column_name,data_type,is_nullable,column_default,is_identity,identity_generation
      from information_schema.columns where table_schema='public' and table_name in
      ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
    ) x),'[]'::jsonb),
    'indexes',coalesce((select jsonb_agg(to_jsonb(x) order by x.tablename,x.indexname) from (
      select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename in
      ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
    ) x),'[]'::jsonb),
    'constraints',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_name,x.constraint_name) from (
      select c.relname table_name,con.conname constraint_name,con.contype,pg_get_constraintdef(con.oid) definition
      from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and con.contype <> 'n' and c.relname in
      ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
    ) x),'[]'::jsonb),
    'policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.tablename,x.policyname) from (
      select tablename,policyname,cmd,roles,qual,with_check from pg_policies where schemaname='public' and tablename in
      ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
    ) x),'[]'::jsonb),
    'rls',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_name) from (
      select c.relname table_name,c.relrowsecurity enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in
      ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
    ) x),'[]'::jsonb)
  ) value
),
payload as (
  select jsonb_build_object(
    'format','nico-fit-v2-logical-backup-v1',
    'source_project_ref','xaklsoqyzwowtjwcpwmb',
    'captured_at',clock_timestamp(),
    'postgres_version',current_setting('server_version'),
    'counts',(select value from source_counts),
    'catalog',(select value from catalog),
    'data',jsonb_build_object(
      -- Passwords and Auth tokens are deliberately excluded. These identity
      -- stubs preserve ownership/FKs; Auth account recovery remains separate.
      'auth_users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email) order by id) from auth.users),'[]'::jsonb),
      'readiness',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.readiness t),'[]'::jsonb),
      'workouts',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.workouts t),'[]'::jsonb),
      'match_reviews',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.match_reviews t),'[]'::jsonb),
      'football_sessions',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.football_sessions t),'[]'::jsonb),
      'workout_sessions',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.workout_sessions t),'[]'::jsonb),
      'sync_tombstones',coalesce((select jsonb_agg(to_jsonb(t) order by id) from public.sync_tombstones t),'[]'::jsonb)
    )
  ) value
)
select encode(convert_to(value::text,'UTF8'),'base64') payload_base64 from payload;

commit;
