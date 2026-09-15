# Conflict UI validation — 2026-09-15

Branch `feature/v3-conflict-ui`. No commit/merge/push/deploy/cutover. No production requests, schema changes, V2 form changes or default flag activation.

## Real Supabase staging

Command: `npm run test:v3:conflicts:staging` (equivalent to `node --env-file=.env.v3-staging.local scripts/v3-conflicts-staging.mjs`). Credentials are read privately from the ignored env file; never commit that file. The runner checks the exact project ref `tmydirzzlmlmtjgwqcgh`, URL and publishable/anon key before creating clients. No service role is used.

Final run ID: `d4522e86-2a56-43ab-ac12-7e754fece56f`. Machine-readable report: `.tmp/v3-conflicts-staging-result.json` (ignored local artifact).

| Check | Result |
| --- | --- |
| Two Auth users, anon rejection | PASS; different authenticated identities; anon `42501`. |
| Real obsolete version | PASS; SQL `PT409`, HTTP 409; local pending mutation retained as conflict. |
| Accept remote | PASS; known remote values adopted; unfinished local operations archived; audit retained; two subsequent syncs did not reopen it. |
| Keep local and offline/reconnect | PASS; fresh operation ID, base remote version 2; simulated pull outage leaves decision pending; real reconnect writes version 3 and marks audit server-confirmed; repeated syncs stayed resolved. |
| Remote tombstone vs local update | PASS; keep-local/both unavailable; attempted keep-local rejected; accepting remote preserves tombstone locally and remotely. |
| Keep both football occurrence | PASS; original adopts remote RPE 9, new client UUID uploads local RPE 5; confirmation closes original conflict; repeated sync does not reopen it. No linked reviews copied. |
| Both prohibited on readiness/sets/workout sessions | PASS against real staged records/conflicts; strategy absent and API rejects it. |
| RLS and ownership | PASS; B cannot read/update A's row or insert as A (`42501`); B can write its own row; A's records/audits are absent from B's local DB. |
| Concurrent engines, shared queue | PASS; first engine uses real Web Locks plus persistent lease, held during pull; fallback-only second engine returns `locked`; one queued insert uploads exactly once (version 1); second push count after release is zero. |

The runner groups these assertions into **8 passing integration steps**. Remote Auth/PostgREST/RLS are real. IndexedDB in this command is fake-indexeddb using the actual repository; browser-native IndexedDB is checked separately below. Synthetic future dates and UUIDs prevent using real user workouts. Test records are retained in disposable staging; no physical cleanup is performed.

## Manual Edge / local PWA behavior

Command: `npm run serve:v3:conflicts:manual`; open `http://127.0.0.1:41741` in Edge. The server binds loopback, explicitly denies the V2 app/sync/store and sensitive files, and serves a fixture that imports the real conflict modules. It creates only synthetic local records, enables storage/conflict flags explicitly on this isolated origin, and never creates a Supabase client. Training/sync/coach flags are not enabled.

| Check | Observed result |
| --- | --- |
| Mouse opening/closing | PASS; panel and details open/close; closing panel returns focus to entry button. |
| Keyboard | PASS; Tab reaches controls, Enter expands/collapses details and confirms, Escape closes panel. Shift+Tab from Close goes to last visible summary; Tab returns to Close. |
| Initial and post-decision focus | PASS; initial focus Close; successful decision returns focus to its summary; rejected active-session replacement returns focus to enabled confirmation button. |
| ARIA | PASS; dialog role, `aria-modal=true`, named panel; background `inert`; labelled select/textarea; `role=status` counters/messages; expanded/collapsed state exposed by native details. No screen-reader hardware validation claimed. |
| 390 px mobile frame | PASS; native responsive media query stacks local/remote columns. Measured panel width/scrollWidth both 375 px (remaining viewport after scrollbar), column left positions identical and tops different. Close button height 44 px; all panel buttons have 44 px minimum. |
| Confirmation and counter | PASS; selecting strategy alone does nothing; clicking confirmation accepts readiness and immediately changes 2 open/1 resolved to 1 open/2 resolved. |
| Other drafts | PASS; a note written in the gym conflict remains unchanged when readiness resolves; counter updates do not rerender other details. Explicit list refresh intentionally rebuilds them. |
| Active workout | PASS; accepting remote session snapshot is rejected with Spanish explanation; local session is retained and postponement works. |
| Literal dynamic data | PASS; synthetic `<img ...>` text appears in snapshot as literal text, never as an element. |
| Native IndexedDB across reload | PASS; resolved records, remaining active session and audit restored. |
| Two Edge tabs with native IndexedDB | PASS; first takes Web Lock plus lease; second fallback-only attempt shows `locked`; after first releases, second can execute. |
| Offline local PWA cache | PASS; local test service worker installed and precached fixture/modules. Server was stopped; reload reopened panel with preserved counter. Postponing gym conflict offline saved an audit with user/entity/strategy/versions/timestamp/note; explicit refresh read it back while server remained stopped. |

PWA testing uses a **synthetic local service worker and manifest**, avoiding loading V2 production coordination. It verifies offline module/UI/storage behavior in Edge, not installation of the real app into a standalone OS window. No physical mobile device or standalone PWA was installed/tested. Two fixture pages are test-owned; no existing user tabs were modified.

## Findings corrected

- Counter and status formerly remained stale until list refresh: now updated after explicit decision without replacing other drafts.
- Closed `details` descendants can report a non-null offsetParent in Edge: focus trap explicitly excludes hidden descendants and includes the summary.
- Disabling confirmation temporarily moved focus outside the dialog: success focuses summary, failure re-enables/focuses confirmation. Active-session rejection is translated for presentation.
- Native unstyled buttons were too small on mobile: panel buttons use ghost styling with a 44 px minimum target.
- Timestamp-only optimistic guard could miss remote change in the same millisecond: explicit remote-version guard added with deterministic regression test.
- Offline pull rejects the sync promise by the existing engine contract; integration test now expects that rejection and verifies pending persistence/reconnect. No sync-engine behavior was altered for this contract.

## Staging vs local and remaining risk

- Version conflict/resolution/tombstone/ownership behavior matches local tests; staging additionally proves HTTP 409 and real RLS. No semantic discrepancy was observed in these cases.
- PostgreSQL supplies authoritative versions, update timestamps and calculated football load; local provisional fields must not be used as server confirmation.
- Browser layout/focus behavior exposed bugs that fake DOM tests did not originally catch; regression assertions were expanded and manual checks repeated.
- Staging runner uses simulated storage/network outage; Edge uses real storage and an actually stopped local origin. Browser-to-Supabase end-to-end in a single installed PWA is not claimed.
- Audit remains local/per-user: clearing browser data removes it. It is not a remote audit ledger.
- “Both” remains restricted to independent football occurrence; changing this scope needs explicit subtree/identity semantics.
- Lease suspension beyond TTL and long multi-device contention merit stress tests before enabling V3 broadly. Correct-version checks remain the final server guard.
- Future observability should surface pull-phase promise errors and resolution-operation errors/confirmation distinctly.

Final automated suite **148/148**, including **22 conflict tests**. JavaScript syntax and `git diff --check` pass. **GO for commit/merge approval and `v3-observability`; NO-GO for production cutover/default activation.**

## Required before production (user-approved follow-up gates)

- Remote audit ledger for resolution decisions.
- Installed standalone PWA validation.
- Prolonged validation on a physical device.
- Prolonged browser/device suspension and multi-instance contention validation.

These remain pending after the approved local commit/merge. The next branch is `feature/v3-observability`; this approval does not authorize deploy or cutover.
