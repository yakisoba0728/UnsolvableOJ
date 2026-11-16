# Backend audit and correctness work

Baseline: `6176015b63a1615cc2269172f246725ef08abab3` (`main`, checked 2026-11-16).
Work branch: `overhaul/backend-correctness`.

## Scope examined

Read backend HTTP setup, guards and authentication/session lifecycle; admin account operations; problem lifecycle and immutable versions; submissions, queue registration, result recording and XP reconciliation; enterprise tests and candidate attempts; Vibe workspaces and evaluation lifecycle; community ownership/moderation; notifications; email verification/outbox; missions and user ranking services. Inspected associated DTOs, schema migrations, tests and integration runner. This is a source review, not a claim that every runtime path has been exercised.

| Domain | Main behavior and state | Existing verification |
| --- | --- | --- |
| Auth/accounts | Password hashing, rotating token families, session revocation, account withdrawal and forced password changes | Unit tests; account, auth, refresh and withdrawal DB suites |
| Admin | Roles, suspension, password resets, audit trail and queue/worker status | Unit and DB suites |
| Problems | Author ownership, draft/public/private policy, immutable grading snapshots, filtering/facets and statistics | Unit, DTO, import and DB suites |
| Submissions/Judge API | Quota, version binding, BullMQ generation, leases, result fencing, rejudge and XP evidence | Unit, DB and actual judge pipeline suites |
| Enterprise | Owner-only management/results, invitation matching, candidate deadlines and isolated submissions | Enterprise and Vibe DB suites |
| Vibe | Revision fencing, bounded AI calls, sandbox runs, submitted reports and staff review | Runner unit and DB suites; external integrations mocked in DB tests |
| Community | Posts, comments, votes, saved/followed content, moderation and notifications | DB suites |
| Email | Explicit consent, verification, encrypted outbox, leases and provider idempotency | DB suite with mocked provider |
| Learning | XP, missions, badges, profile and rankings | Policy unit and DB suites |

## Findings and changes

### BE-01 — P1: enterprise submission eligibility was not atomic

The original implementation resolved attempt eligibility before opening the submission transaction. A concurrent state transition could invalidate that decision before the write. The insertion path also did not apply the shared invitation predicate or the earlier test-end deadline.

Implemented: the insertion transaction takes the candidate quota lock and then the attempt lock, checks current eligibility using a fresh statement and `clock_timestamp()`, and saves the accepted version in the same transaction. Queue registration remains after commit. No API or schema contract changed. Attempts rejected by the transaction leave no queued submission.

Status: `REPRODUCED → IMPLEMENTED → TESTED` (local unit and actual PostgreSQL/HTTP integration tests); independent review and integration pending.

## Executed verification

Environment: Linux x86_64, Node.js 24.22.1, npm 11.9.0, PostgreSQL 17.11 and Redis 8.10.3. Dependencies installed from the lockfile via `npm ci --no-audit --no-fund`. PostgreSQL and Redis were started in a dedicated process lifetime with the tests; the project runner created and dropped its own randomly named test database. External AI/email credentials were unset.

| Command | Baseline | Changed code |
| --- | --- | --- |
| `npm run check` in `Back/` | Passed lint, typecheck, 18 unit files / 275 tests, build | Passed lint, typecheck, 19 unit files / 279 tests, build |
| `npx vitest run src/modules/submissions/submissions.enterprise.spec.ts` | Three regression failures, one positive control passed | Four tests passed |
| `npm run test:e2e` | Full baseline suite not rerun in this workstream | **25 files / 166 tests passed**, 79.16 seconds |
| Selected PostgreSQL regression replay on baseline | **3/3 selected tests failed** for the expected correctness failures; 8 unrelated tests intentionally filtered out | The same three cases passed in the complete suite |

Added six PostgreSQL/HTTP integration cases for transactional eligibility, lock contention, effective deadlines invitation consistency and foreign-key lock compatibility in `test/enterprise-submission-concurrency.e2e-spec.ts`. These six cases passed as part of the complete backend integration suite. The Vibe lock/deadline case also passed. The same service versions were used for a separate baseline replay of selected new regressions: it accepted a request after a concurrent finish, returned HTTP 500 from a PostgreSQL deadlock (`40P01`), and created a workspace after the effective deadline. All three behaviors are rejected or complete correctly on the changed branch. Initial setup required replacing a symlinked dependency tree because TypeScript declaration emission rejected its external type paths; no application compiler settings were weakened.

## Follow-up checks

- Independently review email invitation identity assurance; current matching uses an account email without requiring mailbox verification.
- Independently review the worker/API boundary for diagnostic membership against immutable sample testcases.
- Measure enterprise result lookup cost before changing it; the current Vibe score grouping repeatedly scans a row array.
- The complete backend DB/HTTP suite passed locally. Execute migration round-trip and actual judge pipeline suites in CI, then independently review and validate the combined integration branch.

### BE-02 — P1: workspace creation used transaction-start time after lock contention

Workspace creation now acquires the enterprise attempt lock before reading current eligibility, and uses PostgreSQL `clock_timestamp()` to evaluate the effective deadline. The existing workspace resume behavior remains intact. Added a database regression that advances the deadline while the candidate transaction waits for the attempt row. Local static/unit checks and the actual PostgreSQL lock/deadline regression passed; independent review and integration are pending.

### BE-03 — P2: quota lock could conflict with workspace foreign-key checks

The per-user submission quota lock now uses `FOR NO KEY UPDATE`. It still serializes concurrent quota checks, while allowing another transaction's foreign-key `KEY SHARE` lock. A database regression holds an attempt row, starts a concurrent submission and inserts a linked workspace in the first transaction to verify both operations finish without a lock cycle.

## Compatibility and cost

No API path, response schema or migration changed. An ineligible enterprise submission is rejected before persistence or queue registration. Acquiring and separately validating the attempt adds one database round trip to enterprise submission creation, in exchange for a clear transaction boundary. No throughput or latency improvement is claimed. The quota lock change retains serialization and avoids unnecessarily blocking foreign-key checks.
