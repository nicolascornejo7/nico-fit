# V3 conflict UI

Branch: `feature/v3-conflict-ui`. No schema change, remote write from UI, production operation or cutover.

## Architecture and public API

`conflict-entry.js` receives the authenticated user from existing coordination and opens the per-user repository. It is gated by `v3.conflicts.enabled=true` and requires the existing explicit local-storage flag. All flags remain off by default; opening the panel never enables training, coach or sync.

`conflict-ui.js` renders safe DOM with local/remote snapshots, explanations, dates, origin, pending count, expandable history, labelled controls and a keyboard-trapped dialog. Mobile columns stack. Refresh is explicit so background synchronization does not replace a decision/note being written.

`V3ConflictService` exposes `list({status:'all'|'open'|'resolution_pending'|'resolved'})`, `count()`, `history()` and `resolve(view,strategy,{note})`. The observability UI can consume this read model without database/store names. Views include current local data, remote known snapshot, available strategies, decisions and resolution-operation states/errors.

The repository applies the decision, archive, record changes, queue insertion and audit in one IndexedDB transaction. The service takes the same Web Lock/persistent lease used by sync. Opening another repository also takes that lock before recovering interrupted operations. Guards on conflict timestamp and local revision reject stale screens. An in-flight operation blocks resolution.

Web Lock holders also take the persistent lease, so a fallback-only instance cannot be bypassed. An expanded test caught and corrected this mixed-lock-backend race during repository opening.

## Resolution protocol

1. Inspect both sides and choose a strategy; nothing runs automatically.
2. Press **Confirmar decisión**. A note is optional.
3. Persist an immutable decision ID, authenticated owner, entity/record ID, strategy, timestamp, local revision, local base version, remote version, both snapshots, metadata and generated operation IDs.
4. Preserve the conflict and its decision history. Related unfinished operations become `superseded`, with archive date and decision reference, rather than being deleted.
5. Upload decisions that require mutations through the existing sync engine. Resolution operations preserve transitions and are not compacted into later edits.
6. Only server acknowledgement changes `resolution_pending` to `resolved` with `confirmed_at`; network errors remain visible and retry the same operation. A newer remote version opens another conflict, preserving earlier audits.

| Strategy | Behavior |
| --- | --- |
| Conservar local | New update/soft-delete with the known remote version as base. Offline pending sync; no silent last-write-wins. |
| Aceptar remoto | Adopt known remote snapshot, including tombstone, and archive unfinished operations. This is a local decision; a future pull can update it further. |
| Mantener ambos | Only football sessions: accept original remote identity and create a separate occurrence with a fresh UUID. Linked reviews are not copied. Never offered for readiness, reviews, sets, exercises, catalog or workout sessions. Workout subtree cloning is deliberately unimplemented. |
| Posponer | Append audit and keep the conflict open. No queued mutation. |

## Safety and restrictions

- Remote tombstones cannot be kept local or copied with “both”. Parent/catalog tombstones or unresolved conflicts block new child resolution mutations; sets also check their session ancestor.
- Accepting a parent tombstone is blocked while descendants have unfinished changes; review children first. No cascade is guessed.
- Replacing data used by an active workout is blocked; keep local or postpone, or finish the local workout before accepting remote. Training is not globally blocked.
- An absent remote snapshot or ambiguous import (`pending_review`) permits postponement only. This panel does not reinterpret changed V2 source data.
- Remote child ownership is checked through locally owned parents; root/catalog remote ownership must match the authenticated user. Supabase RLS remains the remote authority.
- Remote order collisions abort atomically instead of silently reordering other exercises/sets.
- Audit is local, per user, persistent across reload; clearing browser data removes it. No remote audit table is added.
- A snapshot can become stale while offline; the next sync must detect it again. Flags alone do not provide a staging target; existing explicit staging sync configuration is required.

## Verification and remaining gates

Reproduce: `npm run test:v3:conflicts`, `npm test`, `node --check` on JavaScript, `git diff --check`.

Tests use fake-indexeddb plus the real sync engine with a deterministic remote adapter: both sides, all strategies, tombstones, stale revisions, sets/sessions, offline failure/retry, server acknowledgement, renewed version conflict, reload, active-session protection, locking and user isolation. Existing PGlite schema tests remain part of the full suite. No production access is needed.

Final automated result: **148/148** full-suite tests, including **22/22** conflict tests. JavaScript syntax and `git diff --check` pass. DOM tests verify hostile snapshot text remains literal, no resolution occurs before confirmation, counter updates and focus returns on success/error. Existing retry coverage was updated: a 409 conflict requires an explicit decision rather than automatic retry. Stale decisions also check the remote version, even if conflict timestamps share the same millisecond.

Real staging and manual Edge validation were completed on 2026-09-15; see `v3-conflict-ui-validation.md` for scope, evidence and reproduction. GO for commit/merge approval and `v3-observability`. NO-GO for cutover or enabling flags by default. A physical phone and an installed standalone PWA were not tested.
