# V3 migration dry run

## Scope and isolation

This dry run executes only against an in-memory PostgreSQL database provided by PGlite. It does not read Supabase credentials, connect to a remote host, execute the cutover script, or modify the V2 frontend.

The workstation did not have Supabase CLI, Docker, Podman, PostgreSQL, or `psql` available. Supabase CLI local development requires a Docker-compatible runtime, so the reproducible fallback uses PGlite, a PostgreSQL build for WebAssembly that runs inside Node.js without a database service.

## Reproduction

```powershell
npm install
npm run test:v3:dry-run
```

The runner creates a fresh database on every invocation and performs this sequence:

1. Create test-only Supabase-compatible roles, `auth.uid()`, and minimal V2 tables.
2. Apply `migration-v3-schema.sql`.
3. Execute `test-v3-schema.sql`.
4. Interpret and execute the directives in `test-v3-idempotency.psql`, applying the migration twice in a second disposable database and rolling the transaction back.
5. Load synthetic V2 fixtures and the reviewed exercise mappings.
6. Run both backfills and assert row counts, mapping states, repeated exercises, ambiguous records, incomplete sets, and tombstones.
7. Run both backfills again and compare all V2 and V3 counts.
8. Re-run RLS, version conflict, soft-delete, resurrection, uniqueness, and referential integrity tests.
9. Run `rollback-v3-schema.sql`, assert that V2 counts are unchanged, recreate V3, and execute its schema tests again.

## Synthetic dataset and results

The fixture contains two users, one normal session, two sessions on one date, two occurrences of the same stable exercise in one session, an incomplete set, an exercise with an ambiguous measurement, a session tombstone, a workout tombstone, an open session, and a workout without a parent session.

| Object | Before backfill | After first run | After second run |
| --- | ---: | ---: | ---: |
| V2 sessions | 10 | 10 | 10 |
| V2 workouts | 9 | 9 | 9 |
| V2 tombstones | 2 | 2 | 2 |
| V3 sessions | 0 | 9 | 9 |
| V3 session exercises | 0 | 6 | 6 |
| V3 sets | 0 | 8 | 8 |
| Session mappings | 0 | 9 | 9 |
| Workout mappings | 0 | 8 | 8 |
| Set mappings | 0 | 8 | 8 |

Mapping classifications after the first run:

| Mapping | `migrated` | `pending_review` | `skipped` |
| --- | ---: | ---: | ---: |
| Sessions | 8 | 1 | 0 |
| Workouts | 0 | 6 | 2 |
| Sets | 6 | 2 | 0 |

The open session remains `pending_review`. The workout on a date with multiple possible parent sessions and the workout without a parent are `skipped`. The incomplete and ambiguous sets remain reviewable without invented values. Both V2 tombstones prevent their corresponding records from being imported.

## Defects found and corrected

1. `backfill-v2-sessions.sql` originally inserted sessions and joined the target table for mapping inside the same data-modifying CTE statement. PostgreSQL statement snapshots do not expose those newly inserted rows through a new scan of the target table, so zero session mappings were created. The session insert and mapping insert are now separate idempotent statements in one transaction.
2. `backfill-v2-workouts.sql` could evaluate `is_completed` to `NULL` when the measurement type or parsed value was ambiguous. The complete predicate is now coalesced as a whole to `false`, preserving the row as `pending_review`.

## Verified behavior

- Schema migration re-execution: passed.
- Multiple sessions per date and repeated exercises: passed.
- RLS isolation for two users, including child ownership through the parent session: passed.
- Exact `version + 1` updates: passed; stale versions and jumps rejected.
- Soft delete: passed; updates after deletion, resurrection, and authenticated physical deletion rejected.
- Active-position uniqueness and referential integrity: passed.
- Backfill re-execution: passed with identical counts and no duplicates.
- Rollback: passed; V3 schema removed and all 10 sessions, 9 workouts, and 2 V2 tombstones remained.
- V3 recreation and full schema test after rollback: passed.

## Remaining risks

- PGlite runs the PostgreSQL engine but does not reproduce the full Supabase local stack, PostgREST, GoTrue, connection pooling, or production extensions. A later staging run with Supabase CLI or a disposable Supabase project is still required before production.
- The bootstrap tables model the V2 columns consumed by the backfills. Production column types, constraints, and exceptional payloads must be compared against an export before staging migration.
- Multiple V2 sessions on one date cannot be assigned automatically to a date-only V2 workout. Those mappings intentionally remain `skipped`.
- Exercise order from V2 is synthetic and every migrated workout remains `pending_review` until that order is approved.
- Ambiguous repetitions versus seconds and invalid or missing set values remain `pending_review` and require human classification.
