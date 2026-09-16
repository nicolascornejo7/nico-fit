-- Production inventory only. This file must remain SELECT-only.
-- Expected project ref: xaklsoqyzwowtjwcpwmb (gym-futbol).
begin transaction read only;
set local statement_timeout = '30s';

select current_setting('server_version') as postgres_version,
       now() as captured_at,
       to_regnamespace('nico_fit_v3') is not null as v3_schema_exists;

select n.nspname as schema_name,c.relname as table_name,c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where c.relkind='r' and n.nspname in ('public','nico_fit_v3')
order by 1,2;

select table_schema,table_name,ordinal_position,column_name,data_type,is_nullable,
       column_default,is_identity,identity_generation
from information_schema.columns
where table_schema in ('public','nico_fit_v3')
order by table_schema,table_name,ordinal_position;

select schemaname,tablename,indexname,indexdef
from pg_indexes
where schemaname in ('public','nico_fit_v3')
order by schemaname,tablename,indexname;

select schemaname,tablename,policyname,cmd,roles,qual,with_check
from pg_policies
where schemaname in ('public','nico_fit_v3')
order by schemaname,tablename,policyname;

select trigger_schema,event_object_table,trigger_name,event_manipulation,action_timing
from information_schema.triggers
where trigger_schema in ('public','nico_fit_v3')
order by trigger_schema,event_object_table,trigger_name,event_manipulation;

select n.nspname as schema_name,p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','nico_fit_v3')
order by n.nspname,p.proname;

select c.relname as table_name,con.conname as constraint_name,con.contype,
       pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','nico_fit_v3')
order by n.nspname,c.relname,con.conname;

select table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema='public'
  and table_name in ('readiness','workouts','match_reviews','football_sessions','workout_sessions','sync_tombstones')
  and grantee in ('anon','authenticated')
order by table_name,grantee,privilege_type;

select 'auth_users' entity,count(*) records from auth.users
union all select 'readiness',count(*) from public.readiness
union all select 'workouts',count(*) from public.workouts
union all select 'workout_sets',coalesce(sum(jsonb_array_length(sets)),0) from public.workouts where jsonb_typeof(sets)='array'
union all select 'match_reviews',count(*) from public.match_reviews
union all select 'football_sessions',count(*) from public.football_sessions
union all select 'workout_sessions',count(*) from public.workout_sessions
union all select 'sync_tombstones',count(*) from public.sync_tombstones
order by entity;

commit;
