# Backend/DB consolidation audit

Baseline: `a687887068baf6d793cb752468ec336619610d1e` (exact Phase V tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813`).
Worktree: `oj-back`, branch `internal/consolidation-back`.
Review type: implementation audit by the Backend/DB agent. This is not independent approval of my own patches.

## Confirmed defects and changes

### BACK-001 — P1: a previously authenticated submission could survive account/session revocation

`SubmissionsService.submitNew` previously locked non-admin users only to serialize pending-submission quotas, never checked their current account state after the wait, and exempted administrators from the lock. The HTTP JWT check therefore did not fence an already admitted request when suspension, password/token-version change, withdrawal, or session-only logout committed before submission insertion. Both ordinary and enterprise routes shared the path.

The change revalidates the account under `FOR NO KEY UPDATE` for every role, rejects deleted/suspended/temporary-password/stale-token actors, and checks a supplied session family in a fresh statement after the account lock. A new statement matters: a refresh successor or a logout may have committed while the lock statement waited. Current family validity is tested with wall-clock expiry. Existing optional session fields remain compatible with legacy/internal callers. Ordinary-user quota limits and admin quota exemption remain unchanged. Saving still precedes queue insertion, with the existing queue-failure generation fence retained.

The deterministic focused unit baseline produced **8 failures / 4 passes**. After the fix all 12 cases pass, including live USER/ADMIN cases and both routes. An initial mock matched an enterprise eligibility subquery as a direct user lookup; that test fixture was corrected before the canonical baseline was measured. No application assertions were weakened.

New API coverage in `Back/test/submission-actor-revocation.e2e-spec.ts`: eight HTTP account/session revocation races, two stale-actor requests after actual AuthService withdrawal, one administrator demotion case, and one real refresh-successor race. Controlled races observe actual PostgreSQL lock waits rather than sleeping for a guessed duration. The real-DB suite was authored but could not be executed by this worker locally; it requires coordinator CI.

### BACK-002 — P2: private community relationship rows could be recreated after withdrawal

`CommunityService.relationship` previously waited on a post row and inserted saved/follow rows without revalidating the actor. Actual withdrawal erases these private rows but keeps the user UUID for authored content, so a request admitted before withdrawal could recreate the erased data afterward.

The change reuses a small shared `lockActiveActor` helper after the existing post lock and before any relationship mutation. This preserves the post-first relationship order. Withdrawal does not acquire post locks. `NO KEY UPDATE` remains compatible with foreign-key `KEY SHARE` checks. The helper is used only for the two confirmed paths; this is not a claim that every admitted-request revocation race in the repository has been eliminated.

The deterministic focused unit baseline produced **4 failures / 2 passes**. Added two PostgreSQL tests start with an existing saved/follow row, block the next HTTP request at the post lock, commit actual withdrawal, release the lock, and require HTTP 401 plus zero recreated rows.

## Source audit coverage and retained contracts

Reviewed the principal implementation and relevant test/migration contracts for:

- Authentication: registration/login/refresh, family revocation, user-first lock order, withdrawal tombstones, JWT strategy, and admin role/suspension/password changes.
- Submissions: public/author access, enterprise attempt eligibility, immutable problem snapshots, pending quotas, queue generation fences, source/detail privacy, rejudge policy, and callback reconciliation/XP.
- Enterprise: owner/admin gates, verified-email invite predicate, binding/version preservation, same-snapshot result detail and totals, bounded CSV exports, CSV formula literalization, and candidate score visibility.
- Problems/bookmarks: draft/public/private publication checks, author management, version writes, bookmark cleanup fences, list filters and cursor bounds.
- User learning: calendar goals, rolling-window dashboard projections, KST boundary SQL, private-data predicates, ranking/profile projections, and goal rollback refusal.
- Community/email/missions/notifications: post/comment ownership and moderation, parameterized SQL selection, saved/follow cleanup, email active/session rechecks and outbox consent, mission serialization, notification ownership.
- Migrations: immutable enterprise bindings, problem bookmarks, incremental statistics writer barrier and down path, account withdrawal protection, and populated-goal/stale-isolation rollback refusal.
- Common pagination/query bounds and HTTP validation/body limits.

The audit did not modify migrations, business scoring, verdicts, version bindings, CSV schemas, queue recovery, or application route contracts. Private problems are prevented from publication by management APIs; a hypothetical database row with both private=true and PUBLISHED was not reported as an externally reproduced vulnerability. Existing SQL values are parameterized; dynamic identifiers inspected are fixed internal choices. No measured optimization was adopted and no speedup is claimed. The extra session check is correctness work; production latency/lock throughput require actual workload measurement.

## Validation and exact-source caveats

- `npm ci --prefix Back`: PASS, independent local install (no cross-worktree node_modules symlink).
- First submission commit full `npm run check --prefix Back`: PASS, lint/typecheck, **404 unit tests / 31 files**, build.
- Final shared-helper/community source full check: PASS, lint/typecheck, **410 unit tests / 32 files**, build. The later refresh-successor API fixture edit was separately linted and typechecked; its first check caught TypeORM parameters as `any[] | ObjectLiteral`, fixed with `Array.isArray`, and the final lint/typecheck passed. Production/unit sources were unchanged by this test-only correction.
- Local PostgreSQL/Redis executables were absent. New real-DB tests are not represented as locally passed.
- Runtime/native pipeline, Docker, source-bound final CI, and independent review remain coordinator gates.

Raw scratch logs: `backend-npm-ci.log`, `backend-actor-before.log`, `backend-check.log`, `backend-relationship-before.log`, `backend-check-final.log`. Preserve before-fix failures along with passing checks in the final evidence archive.

## Integration commits (in order)

1. `1effe5e18b75a8032190bdb10a1663acd7c9cadd` — submission fence + 12 units + initial 11 API cases.
2. `c4e17084ca1b33bb13e546ce69695733fb1fd490` — shared helper + relationship fence + 6 units + 2 API cases + refresh-successor API case.
3. `368e5e1ec0871e82a857eb2ba9f64081771ad6c9` — TypeORM parameter narrowing correction in the refresh fixture.

Net new meaningful coverage: **18 unit cases** and **14 API/PostgreSQL cases**. No assertions removed/relaxed, no skip/retry additions, no schema/CI gate change.
