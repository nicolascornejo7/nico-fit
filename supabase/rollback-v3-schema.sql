-- Nico Fit V3 rollback while V2 remains the active source of truth.
-- Export V3 first if any client has started writing data that does not exist in V2.

begin;
drop schema if exists nico_fit_v3 cascade;
commit;
