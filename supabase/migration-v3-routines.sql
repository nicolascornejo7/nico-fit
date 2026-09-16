-- Additive schema only. Do not execute in production or enable cutover.
begin;
create table if not exists nico_fit_v3.routine_templates (
 id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
 stable_key text not null check(length(stable_key) between 1 and 200),
 name text not null check(length(btrim(name)) between 1 and 200),
 is_active boolean not null default true, derived_from_routine_id uuid,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 unique(id,user_id),unique(user_id,stable_key),
 foreign key(derived_from_routine_id,user_id) references nico_fit_v3.routine_templates(id,user_id) on delete restrict
);
create table if not exists nico_fit_v3.routine_versions (
 id uuid primary key,user_id uuid not null,
 routine_id uuid not null,version_number integer not null check(version_number>0),
 name_snapshot text not null check(length(btrim(name_snapshot)) between 1 and 200),day_index smallint check(day_index between 0 and 6),
 prescription_snapshot jsonb not null,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 unique(id,user_id),unique(routine_id,version_number),unique(id,user_id,routine_id,version_number),
 foreign key(routine_id,user_id) references nico_fit_v3.routine_templates(id,user_id) on delete restrict,
 check(jsonb_typeof(prescription_snapshot)='object'),
 check((prescription_snapshot->>'routine_id'=routine_id::text and prescription_snapshot->>'routine_version_id'=id::text and prescription_snapshot->>'routine_version'=version_number::text) is true),
 check((jsonb_typeof(prescription_snapshot->'exercises')='array' and jsonb_array_length(prescription_snapshot->'exercises') between 1 and 100) is true)
);
create table if not exists nico_fit_v3.routine_exercises (
 id uuid primary key,user_id uuid not null,routine_version_id uuid not null,
 exercise_catalog_id uuid not null references nico_fit_v3.exercise_catalog(id) on delete restrict,
 position integer not null check(position>=0),exercise_name_snapshot text not null check(length(btrim(exercise_name_snapshot)) between 1 and 200),
 prescription_snapshot jsonb not null check(jsonb_typeof(prescription_snapshot)='object'),
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),deleted_at timestamptz,
 foreign key(routine_version_id,user_id) references nico_fit_v3.routine_versions(id,user_id) on delete restrict,
 unique(routine_version_id,position)
);
alter table nico_fit_v3.workout_sessions add column if not exists routine_id uuid;
alter table nico_fit_v3.workout_sessions add column if not exists routine_version integer;
alter table nico_fit_v3.workout_sessions add column if not exists routine_version_id uuid;
alter table nico_fit_v3.workout_sessions add column if not exists routine_snapshot jsonb;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='nico_fit_v3.workout_sessions'::regclass and conname='session_routine_identity') then
 alter table nico_fit_v3.workout_sessions add constraint session_routine_identity check(
 (routine_id is null and routine_version is null and routine_version_id is null and routine_snapshot is null) or
 (routine_id is not null and routine_version is not null and routine_version>0 and routine_version_id is not null and routine_snapshot is not null));end if;
 if not exists(select 1 from pg_constraint where conrelid='nico_fit_v3.workout_sessions'::regclass and conname='session_routine_version_fk') then
 alter table nico_fit_v3.workout_sessions add constraint session_routine_version_fk foreign key(routine_version_id,user_id,routine_id,routine_version) references nico_fit_v3.routine_versions(id,user_id,routine_id,version_number) on delete restrict;end if;
end $$;

create or replace function nico_fit_v3.routine_identity_guard() returns trigger language plpgsql set search_path=pg_catalog,nico_fit_v3 as $$
declare expected jsonb; item jsonb; idx integer:=0; ids text[]:=array[]::text[];
begin
 if tg_op='UPDATE' then
  if new.id<>old.id or new.user_id<>old.user_id then raise exception using errcode='23514',message='routine ownership and identity are immutable';end if;
  if tg_table_name='routine_templates' then
   if new.stable_key<>old.stable_key or new.derived_from_routine_id is distinct from old.derived_from_routine_id then raise exception using errcode='23514',message='template identity is immutable';end if;
  elsif (to_jsonb(new)-array['version','updated_at','deleted_at']) is distinct from (to_jsonb(old)-array['version','updated_at','deleted_at']) then
   raise exception using errcode='PT409',message='published prescription is immutable; create a new routine version';
  end if;
 end if;
 if tg_table_name='routine_versions' then
  if not exists(select 1 from nico_fit_v3.routine_templates t where t.id=new.routine_id and t.user_id=new.user_id and t.deleted_at is null) then raise exception using errcode='23514',message='routine parent unavailable';end if;
  if new.prescription_snapshot->>'name' is distinct from new.name_snapshot or (new.prescription_snapshot->>'day_index') is distinct from new.day_index::text then raise exception using errcode='23514',message='routine snapshot identity mismatch';end if;
  if jsonb_typeof(new.prescription_snapshot->'exercises') is distinct from 'array' then raise exception using errcode='23514',message='missing exercise snapshot';end if;
  for item in select value from jsonb_array_elements(new.prescription_snapshot->'exercises') loop
   if (item->>'position')::integer is distinct from idx or item->>'id'=any(ids) or item->>'id' is null or item->>'exercise_catalog_id' is null or length(btrim(coalesce(item->>'exercise_name_snapshot','')))=0 or jsonb_typeof(item->'prescription_snapshot') is distinct from 'object' then raise exception using errcode='23514',message='invalid snapshot occurrence';end if;
   perform (item->>'id')::uuid,(item->>'exercise_catalog_id')::uuid;
   if not exists(select 1 from nico_fit_v3.exercise_catalog c where c.id=(item->>'exercise_catalog_id')::uuid and c.deleted_at is null and (c.owner_user_id is null or c.owner_user_id=new.user_id) and (c.measurement_kind='mixed' or c.measurement_kind=item->'prescription_snapshot'->>'measurement_kind')) then raise exception using errcode='23514',message='catalog ownership or measurement mismatch';end if;
   if not (item->'prescription_snapshot' ?& array['measurement_kind','sets','min','max','target_rir','rest','step','notes']) or not ((item->'prescription_snapshot'->>'measurement_kind' in ('reps','seconds')) and (item->'prescription_snapshot'->>'sets')::integer between 1 and 100 and (item->'prescription_snapshot'->>'min')::integer>=1 and (item->'prescription_snapshot'->>'max')::integer>=(item->'prescription_snapshot'->>'min')::integer) is true then raise exception using errcode='23514',message='invalid prescription';end if;
   if (item->'prescription_snapshot'->>'target_rir')::numeric not between 0 and 5 or (item->'prescription_snapshot'->>'rest')::integer not between 0 and 3600 or (item->'prescription_snapshot'->>'step')::numeric not between 0 and 100 then raise exception using errcode='23514',message='invalid target/rest/increment';end if;
   ids:=array_append(ids,item->>'id');idx:=idx+1;
  end loop;
 elsif tg_table_name='routine_exercises' then
  select s.value into expected from nico_fit_v3.routine_versions v cross join lateral jsonb_array_elements(v.prescription_snapshot->'exercises') s(value) where v.id=new.routine_version_id and v.user_id=new.user_id and v.deleted_at is null and s.value->>'id'=new.id::text;
  if expected is null or expected->>'exercise_catalog_id'<>new.exercise_catalog_id::text or (expected->>'position')::integer<>new.position or expected->>'exercise_name_snapshot'<>new.exercise_name_snapshot or expected->'prescription_snapshot'<>new.prescription_snapshot then raise exception using errcode='23514',message='exercise must match complete version snapshot';end if;
 end if;
 return new;
end $$;
create or replace function nico_fit_v3.session_routine_guard() returns trigger language plpgsql set search_path=pg_catalog,nico_fit_v3 as $$
declare expected jsonb;
begin
 if tg_op='UPDATE' and (new.routine_id is distinct from old.routine_id or new.routine_version is distinct from old.routine_version or new.routine_version_id is distinct from old.routine_version_id or new.routine_snapshot is distinct from old.routine_snapshot) then raise exception using errcode='PT409',message='historical routine reference is immutable';end if;
 if tg_op='INSERT' and new.routine_id is not null then
  select v.prescription_snapshot into expected from nico_fit_v3.routine_versions v join nico_fit_v3.routine_templates t on t.id=v.routine_id and t.user_id=v.user_id where v.id=new.routine_version_id and v.user_id=new.user_id and v.routine_id=new.routine_id and v.version_number=new.routine_version and v.deleted_at is null and t.deleted_at is null and t.is_active;
  if expected is null or expected<>new.routine_snapshot then raise exception using errcode='23514',message='session must preserve concrete published snapshot';end if;
 end if;
 return new;
end $$;
do $$ declare tab text;begin
 foreach tab in array array['routine_templates','routine_versions','routine_exercises'] loop
  execute format('drop trigger if exists enforce_version_and_timestamps on nico_fit_v3.%I',tab);
  execute format('create trigger enforce_version_and_timestamps before insert or update on nico_fit_v3.%I for each row execute function nico_fit_v3.enforce_version_and_timestamps()',tab);
  execute format('drop trigger if exists routine_identity_guard on nico_fit_v3.%I',tab);
  execute format('create trigger routine_identity_guard before insert or update on nico_fit_v3.%I for each row execute function nico_fit_v3.routine_identity_guard()',tab);
  execute format('alter table nico_fit_v3.%I enable row level security',tab);
  execute format('drop policy if exists routines_read_own on nico_fit_v3.%I',tab);
  execute format('create policy routines_read_own on nico_fit_v3.%I for select to authenticated using(user_id=auth.uid())',tab);
  execute format('drop policy if exists routines_insert_own on nico_fit_v3.%I',tab);
  execute format('create policy routines_insert_own on nico_fit_v3.%I for insert to authenticated with check(user_id=auth.uid())',tab);
  execute format('drop policy if exists routines_update_own on nico_fit_v3.%I',tab);
  execute format('create policy routines_update_own on nico_fit_v3.%I for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid())',tab);
  execute format('create index if not exists %I on nico_fit_v3.%I(user_id,updated_at,id)',tab||'_sync_idx',tab);
  execute format('revoke all on nico_fit_v3.%I from public,anon,authenticated',tab);
 end loop;
 if to_regclass('nico_fit_v3.operational_audit') is not null then
 alter table nico_fit_v3.operational_audit drop constraint if exists operational_audit_entity_check;
 alter table nico_fit_v3.operational_audit add constraint operational_audit_entity_check check(entity in ('workout_sessions','session_exercises','exercise_sets','exercise_catalog','daily_readiness','football_sessions','match_reviews','routine_templates','routine_versions','routine_exercises'));
 end if;
end $$;
drop trigger if exists session_routine_guard on nico_fit_v3.workout_sessions;
create trigger session_routine_guard before insert or update on nico_fit_v3.workout_sessions for each row execute function nico_fit_v3.session_routine_guard();
create index if not exists sessions_routine_idx on nico_fit_v3.workout_sessions(user_id,routine_id,routine_version);
revoke all on function nico_fit_v3.routine_identity_guard(),nico_fit_v3.session_routine_guard() from public,anon,authenticated;
commit;
