-- Backward-compatible cutover entry point.
-- psql resolves \ir relative to this file, independent of the caller's cwd.
-- The canonical, guarded and idempotent grants live in one production artifact.
\ir ../sql/v3-production-api-grants.sql
