-- Additive, append-only metadata audit. No V2 table or cutover change.
begin;
create table if not exists nico_fit_v3.operational_audit (
 event_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete restrict,
 event_type text not null check(event_type in ('conflict_resolution','sync_failure')),
 entity text check(entity in ('workout_sessions','session_exercises','exercise_sets','exercise_catalog','daily_readiness','football_sessions','match_reviews','routine_templates','routine_versions','routine_exercises')),
 entity_id uuid,
 strategy text check(strategy in ('accept_remote','keep_local','keep_both','defer')),
 check(strategy is distinct from 'keep_both' or entity='football_sessions'),
 local_revision integer check(local_revision>0),
 local_remote_version bigint check(local_remote_version>0),
 remote_version bigint check(remote_version>0),
 occurred_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 error_kind text check(error_kind in ('auth','transient','conflict','permanent')),
 error_code text check(error_code in ('PT409','55000','42501','23505','23514','PGRST301','NETWORK_ERROR','REMOTE_ROW_MISSING')),
 check((event_type='conflict_resolution' and entity is not null and entity_id is not null and strategy is not null) or (event_type='sync_failure' and entity is null and entity_id is null and strategy is null and error_kind is not null))
);
create index if not exists operational_audit_user_time_idx on nico_fit_v3.operational_audit(user_id,received_at,event_id);
create or replace function nico_fit_v3.audit_append_only() returns trigger language plpgsql set search_path=pg_catalog as $$
begin
 if tg_op<>'INSERT' then raise exception using errcode='55000',message='audit events are append-only'; end if;
 new.received_at=clock_timestamp();return new;
end $$;
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='nico_fit_v3.operational_audit'::regclass and tgname='audit_append_only') then
 create trigger audit_append_only before insert or update or delete on nico_fit_v3.operational_audit for each row execute function nico_fit_v3.audit_append_only();end if;
 if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename='operational_audit' and policyname='audit_read_own') then
 create policy audit_read_own on nico_fit_v3.operational_audit for select to authenticated using(user_id=auth.uid());end if;
 if not exists(select 1 from pg_policies where schemaname='nico_fit_v3' and tablename='operational_audit' and policyname='audit_append_own') then
 create policy audit_append_own on nico_fit_v3.operational_audit for insert to authenticated with check(user_id=auth.uid());end if;
end $$;
alter table nico_fit_v3.operational_audit enable row level security;
revoke all on nico_fit_v3.operational_audit from public,anon,authenticated;
grant usage on schema nico_fit_v3 to authenticated;
grant select,insert on nico_fit_v3.operational_audit to authenticated;
revoke all on function nico_fit_v3.audit_append_only() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
