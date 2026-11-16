# Phase IV — private calendar learning goals

This adds one persisted personal goal to the existing learning dashboard. It
reuses current submission evidence and public-problem visibility. Bookmarks,
the rolling 7/30/90-day dashboard and its unfinished-problem suggestions remain
existing capabilities, not newly delivered features.

## Contract

| Endpoint | Behavior |
| --- | --- |
| `GET /users/me/learning-goal` | The authenticated account's goal and server-derived progress, or `goal: null` |
| `PUT /users/me/learning-goal` | JSON integer `targetProblems` 1–1000 and `days` 7, 30 or 90; different settings start a new goal today |
| `POST /users/me/learning-goal/reset` | Restart the existing target/duration from today; 404 if no goal exists |
| `DELETE /users/me/learning-goal` | Remove the setting idempotently; submission history is retained |

Every successful response has `timeZone: Asia/Seoul`, `generatedAt` and `goal`.
An existing goal contains target/duration, inclusive `startDate`/`endDate`,
`startsAt`, exclusive `endsAt`, `solvedProblems`, derived `status` and `updatedAt`.
No problem IDs, code, fixtures, enterprise data or account identifiers are returned.

The start is midnight of the creation/reset date in Korea, including solves
earlier that day. The end is midnight after the last day. This fixed period is
independent of the dashboard's selected rolling period. An identical PUT keeps
the original date and timestamp, including for expired goals. Resetting again
on the same Korean calendar day is also idempotent. A reset is not a promise
to zero progress: today's qualifying solves remain included, as stated in the UI.

Progress counts distinct currently public, published problems with at least one
current ACCEPTED ordinary submission created inside the period and no later than
the database statement time. Test runs, enterprise attempts, other users, private
and unpublished problems are excluded. Repeating an accepted submission does not
increase progress. Previously solved problems count if solved again in this
period; this is a practice target, not a first-ever-solve counter. Visibility
changes and rejudging can reduce progress. `COMPLETED` takes precedence when the
current count meets the target, otherwise the exclusive deadline determines
`EXPIRED` versus `ACTIVE`. No permanent award, XP or completion ledger is added.

## Persistence, privacy and concurrency

Migration `1796200000000` creates `learning_goals`, keyed by user ID, with target
and duration checks and a cascading user FK. It adds no progress counters or
scheduled jobs. All writes lock the account before the goal and recheck deleted,
suspended, temporary-password and token-version state. This matches withdrawal's
lock order, serializes simultaneous creates/updates/removals and prevents an
already-authenticated request from recreating a withdrawn account's goal.
Withdrawal explicitly deletes goals in its existing transaction, because users
are soft deleted. Physical account deletion is also covered by the FK.

The new table and ordered registration are reversible. Down removes goal settings
only; it does not remove submissions, solve evidence, users or other Phase III
tables. Applying/down/reapplying on production has not been authorized or performed.

The read uses one SQL statement and the existing user/time submission index.
The response is constant-sized, but aggregation still processes the matching
history within at most 90 days. No sustained-capacity or constant-CPU claim is made.

## UI and acceptance evidence

The panel supports create/change, manual refresh, explicit restart and confirmed
removal. Native labelled number/select controls, textual counts, native progress,
keyboard dialogs and wrapping layouts support narrow screens. It retains drafts
on token rotation and discards private state on account/login changes. Aborted or
obsolete reads/writes cannot replace a new identity's data. A failed mutation is
treated as uncertain until an authoritative read recovers current state.

- Unit cases cover strict DTO bounds and the stale inactive-account write fence.
- Real PostgreSQL/API cases cover privacy, repeated and concurrent writes, distinct
  solves, exclusion rules, current verdict/visibility, exact Korean boundaries,
  explicit reset, withdrawal race and isolated migration rollback/reapply.
- Browser cases cover the complete goal interaction, reload, fixed versus rolling
  periods, invalid fields, keyboard/cancel behavior, lost-response recovery,
  read failure, late account reads/writes, token rotation, statuses and
  320/375/1440-pixel layouts.
- The existing real Compose judge flow calls `exerciseLearningGoals` after its
  two actual judged submissions. It verifies persisted creation, reload, target
  update, completed state, same-day restart and deletion against the real API and
  database, retaining the one distinct ordinary solve and both submissions. This
  reuses its existing learner and does not bypass registration admission limits.

Local checks on the feature source passed 341 backend units (14 added), backend
lint, TypeScript and compilation, the frontend production build and all browser
test types. Backend compilation used `--preserveSymlinks` solely because local
locked dependencies are shared through a filesystem symlink. A targeted local
Chromium run could not launch: the environment rejected its process-singleton
socket with `Operation not permitted`, before any application assertions. The
13 new browser cases, 14 existing learning cases, eight real PostgreSQL/API cases
and live Compose extension still require actual CI execution; they are not
represented as locally passed.

The coordinator records actual executions, independent review and exact-source CI
separately. A test file's existence is not a test execution receipt.
