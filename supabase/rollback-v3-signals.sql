-- ISOLATED/STAGING ONLY. Export V3 signals first; this destroys these new tables.
-- Does not remove training V3 or modify any V2 table. Flags must be off first.
begin;
drop table if exists nico_fit_v3.match_reviews;
drop table if exists nico_fit_v3.football_sessions;
drop table if exists nico_fit_v3.daily_readiness;
drop function if exists nico_fit_v3.signals_identity_guard();
notify pgrst,'reload schema';
commit;
