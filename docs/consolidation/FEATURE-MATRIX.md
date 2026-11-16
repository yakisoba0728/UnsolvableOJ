# Feature preservation and coverage

The complete baseline tree is byte-identical to Phase V. This table maps the
preserved product contracts to source and executable evidence; it is not a claim
that every role/state has received manual physical-device or screen-reader review.
Current qualification is determined by the new PR's final exact-source receipt.

| Domain / journey | Preserved contract | Principal validation |
|---|---|---|
| Home, auth and profile | Public shell; session refresh; account settings, withdrawal and privacy | Auth/account/withdrawal API suites; auth/session/browser regressions |
| Problems and authoring | Filters, pagination, published/private ownership, problem editing and immutable versions | Problem API tests; authoring/list/editor browser suites |
| Solve and submissions | Code editor, real compilation/execution, verdict history, generation/lease/XP consistency | Worker unit, native matrix, API, real Redis/BullMQ pipeline and Compose |
| Bookmarks | Private idempotent bookmarks with account cleanup | Bookmark API and browser suites |
| Learning | 7/30/90-day private dashboard, ten-item review queue, distinct eligible solves | Learning dashboard/API/SQL and browser suites |
| Goals | One private 1–1,000-problem goal, KST windows, preserve/restart/remove semantics | Goal API, concurrency/migration, browser and restore tests |
| Community | Posts, answers/comments, ownership, moderation, private saved/follow state | Community API, request ownership and withdrawal races, browser tests |
| Enterprise creation and participation | Examiner/admin ownership, invitations, candidate attempts and content pinning | Enterprise ownership/version/concurrency API and browser suites |
| Enterprise results and CSV | Consistent snapshot, pagination, score/status distributions, scalar allowlist, formula escaping, explicit 5,000-row cap | Results/export/revocation/deep-page API tests and real browser download |
| Vibe | Retained project files and challenge versions, hidden fixtures, bounded execution, gateway and persisted results | Vibe unit/API/native pipeline, TLS and actual Compose browser path |
| Missions, rankings and public users | Visibility and ownership predicates, bounded lists, score/XP consistency | API and route/browser regressions |
| Notifications and email | Owner-scoped reads, active-account/session consent and cleanup | Unit/API/outbox/browser coverage |
| Administrator | Current-role authorization, user/problem management, queue/worker operations and rejudge | Admin/API, queue generation and recovery tests |

## Route inventory

The inherited frontend has thirty page modules and thirty-six top-level route
declarations. Public, authenticated, examiner and administrator journeys share the
shell and error/loading components. The inventory includes Home, auth, problems,
authoring/my problems, solve/view routes, profile, learning, settings, withdrawal,
email actions, rankings/users, community list/create/edit/detail, analysis list/detail,
missions, enterprise list/create/detail/join/attempt/edit/Vibe review, Vibe list/workspace,
submission list/detail, administrator subtree and fallback.

New regression work focuses on preserved form state through routine refresh,
private-state disposal on a new identity, post-authentication actor revocation and
cleanup of malformed executor responses. Existing keyboard, route focus, modal,
responsive, reduced-motion and editor checks continue in the selected browser
projects. Firefox/WebKit are a defined core-flow subset; the whole Chromium suite
must not be reported as running unchanged on all three engines.

## Database preservation

All 31 migrations and their order are inherited unchanged. In particular, immutable
enterprise problem bindings, Vibe versions, incremental problem statistics and
learning goals remain registered. The learning-goal down migration refuses populated
data and non-READ-COMMITTED snapshots rather than destroying retained user evidence.
Real PostgreSQL tests, schema fingerprints, dump/restore and concurrent writer
tests are separate gates from static migration-file preservation.
