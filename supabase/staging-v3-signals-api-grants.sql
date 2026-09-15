-- STAGING ONLY, after migration-v3-signals.sql. Never a production cutover.
begin;
grant usage on schema nico_fit_v3 to authenticated;
grant select,insert,update on nico_fit_v3.daily_readiness,nico_fit_v3.football_sessions,nico_fit_v3.match_reviews to authenticated;
revoke all on nico_fit_v3.daily_readiness,nico_fit_v3.football_sessions,nico_fit_v3.match_reviews from anon;
notify pgrst,'reload schema';
commit;
