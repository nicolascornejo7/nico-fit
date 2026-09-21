-- Additive rollout control. Apply to staging first; production requires separate approval.
begin;
create schema if not exists nico_fit_v3;
create table if not exists nico_fit_v3.rollout_config (
 singleton_id boolean primary key default true check (singleton_id),
 config_version bigint not null default 1 check (config_version>0),
 minimum_client_version text not null default 'nico-fit-v18' check (minimum_client_version ~ '^nico-fit-v[0-9]+$'),
 maintenance_mode boolean not null default false,
 v3_enabled boolean not null default false,
 v3_storage_enabled boolean not null default false,
 v3_signals_enabled boolean not null default false,
 v3_routines_enabled boolean not null default false,
 v3_training_enabled boolean not null default false,
 v3_sync_enabled boolean not null default false,
 v3_conflicts_enabled boolean not null default false,
 v3_observability_enabled boolean not null default false,
 v3_coach_enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid null
);
insert into nico_fit_v3.rollout_config(singleton_id) values(true) on conflict do nothing;

create table if not exists nico_fit_v3.rollout_config_history (
 config_version bigint primary key,
 changed_at timestamptz not null default clock_timestamp(),
 changed_by uuid null,
 config jsonb not null
);
insert into nico_fit_v3.rollout_config_history(config_version,changed_at,changed_by,config)
select config_version,updated_at,updated_by,to_jsonb(c) from nico_fit_v3.rollout_config c on conflict do nothing;

create or replace function nico_fit_v3.rollout_config_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='Rollout config cannot be deleted'; end if;
 if tg_op='UPDATE' and new.config_version<>old.config_version+1 then
  raise exception using errcode='PT409',message='Rollout config version must advance by one';
 end if;
 if tg_op='INSERT' and new.singleton_id is distinct from true then
  raise exception using errcode='23514',message='Rollout config is a singleton';
 end if;
 new.updated_at=clock_timestamp();new.updated_by=auth.uid();
 -- INSERT ... ON CONFLICT DO NOTHING still fires BEFORE INSERT triggers.
 -- The initial history row is seeded separately above; only actual updates are audited here.
 if tg_op='UPDATE' then
  insert into nico_fit_v3.rollout_config_history(config_version,changed_at,changed_by,config)
  values(new.config_version,new.updated_at,new.updated_by,to_jsonb(new));
 end if;
 return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='nico_fit_v3.rollout_config'::regclass and tgname='rollout_config_guard') then
  create trigger rollout_config_guard before insert or update or delete on nico_fit_v3.rollout_config
  for each row execute function nico_fit_v3.rollout_config_guard();
 end if;
end $$;
alter table nico_fit_v3.rollout_config enable row level security;
alter table nico_fit_v3.rollout_config_history enable row level security;
do $$ begin
 if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename='rollout_config' and policyname='rollout_config_public_read') then
  create policy rollout_config_public_read on nico_fit_v3.rollout_config for select to anon,authenticated using(true);
 end if;
end $$;
revoke all on nico_fit_v3.rollout_config,nico_fit_v3.rollout_config_history from public,anon,authenticated;
grant usage on schema nico_fit_v3 to anon,authenticated;
grant select on nico_fit_v3.rollout_config to anon,authenticated;
revoke all on function nico_fit_v3.rollout_config_guard() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
