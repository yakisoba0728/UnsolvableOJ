# API behavior and compatibility changes

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.
Scope: reviewed backend, security, database, frontend and Judge workstreams. This is a contract note, not a declaration that every branch is integrated or every environment gate passed. Follow [PROGRESS.md](PROGRESS.md) and [TESTING.md](TESTING.md) for that status.

The baseline [API inventory](API.md) and [INVENTORY.json](INVENTORY.json) list **112 method/path combinations** under `/api/v1`. The reviewed changes do not add, remove or rename one of those routes, add a required request field, rename a response field, or change a language/verdict enum. Existing per-case diagnostics are strengthened; they are not a new endpoint or response format. The service topology remains in [ARCHITECTURE.md](ARCHITECTURE.md).

Clients that already satisfy the documented access and timing rules retain their public payload shapes. Some requests previously accepted at an invalid state boundary are now denied, and deployment configurations that depend on internal redirects or anonymous sandbox access must be corrected before rollout.

## Change summary

| Area | Unchanged public shape | New or strengthened behavior |
|---|---|---|
| Enterprise invitations | Existing invitation inputs, join/attempt/workspace routes and account verification flow | Email-only invitations require verified mailbox ownership. Explicit username invitations, owner policy and non-invite-only tests retain their existing rules. |
| Optional authentication | Existing public problem/community routes | A user awaiting temporary-password replacement receives anonymous visibility on optional-auth routes. |
| Enterprise algorithm submission | Existing request DTO and accepted submission response | Quota/attempt locking and fresh eligibility checks occur inside the insert transaction, using the effective deadline after lock waits. |
| Enterprise workspace creation | Existing start/resume endpoint and workspace response | New workspace eligibility is checked after the parent lock using database wall-clock time. |
| Judge callback and submission details | Existing `debugOutputs`, `testResults`, verdict and metrics fields | Sample membership comes from the immutable submitted version; invalid per-case indices are rejected and non-public diagnostics are filtered before storage. |
| Notification frontend | Existing list/count/read/read-all endpoints | Stale requests are discarded, account state is isolated, duplicate pages are deduplicated and mutations trigger authoritative reconciliation. |
| Enterprise/community reads | Existing result and profile payloads | Result assembly uses indexed in-memory lookup; reverse relationship indexes improve existing SQL. |
| Internal worker/sandbox HTTP | Existing credentials, headers and paths | Worker API requests reject redirects; execution readiness verifies anonymous access is denied. |
| Output judging | Same languages, output limits and verdict policy | Byte comparison uses constant auxiliary memory while preserving existing whitespace/binary semantics. |

## Enterprise email identity

The shared `canJoinEnterprise` predicate now requires `users.email_verified_at IS NOT NULL` when access is based on an address in `invite_emails`. Email invitations remain stored as email addresses. Explicit usernames continue to resolve to user IDs through the existing invitation handling; the patch does not convert email entries into permanent user-ID grants.

This shared rule affects candidate join information, attempt access and enterprise-linked workspace access, and is now also used inside enterprise algorithm submission acceptance. Relevant existing routes include:

- `GET /api/v1/enterprise/join/:code`
- `POST /api/v1/enterprise/join/:code/start`
- `GET /api/v1/enterprise/attempts/:id`
- `POST /api/v1/enterprise/attempts/:id/finish`
- `POST /api/v1/enterprise/attempts/:id/vibe/:challengeId`
- `POST /api/v1/enterprise/attempts/:attemptId/problems/:problemId/submissions`
- Candidate operations on enterprise-linked `/api/v1/vibe/attempts/:id` resources, which use the same ownership predicate.

An email-only invitee must use the existing `POST /api/v1/email/verification/request` and `POST /api/v1/email/verification/confirm` flow. If verification delivery is unavailable, an organizer can invite a known account by explicit username. The assessment form now explains this requirement. The server retains generic not-found responses for inaccessible tests/attempts rather than revealing invitation membership. Existing owner/admin review authorization and score-release policy are not broadened.

This is an intentional access-policy tightening. Merely claiming an address on an account no longer establishes email-invitation eligibility, including for later candidate requests on an existing attempt. No email column or verification endpoint was added: the underlying verification state already existed.

Sources: `enterprise-access.ts`, `EnterpriseService`, `VibeService`, reviewed `SubmissionsService`, and `Front/src/pages/EnterpriseFormPage.tsx`; regression evidence in `Back/test/security-boundaries.e2e-spec.ts`.

## Optional authentication and temporary passwords

`OptionalJwtAuthGuard` now omits the principal when `mustChangePassword` is true. The request remains a public request; it does not gain the account's administrator/author visibility while the password change is pending. Missing/invalid credentials still behave anonymously, and healthy authenticated users retain their existing visibility.

The affected optional-auth route set is:

| Method | Path |
|---|---|
| GET | `/api/v1/problems` |
| GET | `/api/v1/community/posts` |
| GET | `/api/v1/community/posts/:id` |
| GET | `/api/v1/community/posts/:id/author-stats` |
| GET | `/api/v1/community/posts/:id/comments` |
| POST | `/api/v1/community/posts/:id/view` |

An anonymous visibility decision may return public content or the route's existing not-found response for content the anonymous viewer cannot see. This patch does not introduce a new error envelope. Strict `JwtAuthGuard` keeps its existing HTTP 403 password-change requirement and explicit account-settings exceptions; the client should continue directing affected users to the existing password replacement flow.

Sources: `optional-jwt-auth.guard.ts`, existing controller decorators and `jwt-auth.guard.ts`; regression evidence in `optional-jwt-auth.guard.spec.ts` and `Back/test/optional-auth-visibility.e2e-spec.ts`.

## Transactional enterprise submission and workspace acceptance

### Algorithm submissions

`POST /api/v1/enterprise/attempts/:attemptId/problems/:problemId/submissions` still accepts the existing language/source DTO and returns HTTP **202** for an accepted submission. The new acceptance sequence is:

1. Begin the insert transaction and, for non-admin users, serialize the existing queue quota on the user row with `FOR NO KEY UPDATE`.
2. Lock the owned enterprise attempt separately.
3. Read current attempt/test/task eligibility in a fresh statement, applying the shared invitation predicate and `LEAST(attempt.deadline_at, test.ends_at) > clock_timestamp()`.
4. Save the submission with the selected problem version and attempt binding; enqueue its generation-specific Judge job after commit.

The existing public errors remain HTTP **404** when the owned eligible attempt/task cannot be resolved, **403** when the resolved attempt is finished or past its effective deadline, and **429** for the existing submission quota. Request validation and strict-auth errors remain unchanged. Rejected eligibility checks do not persist a new submission or register its queue job.

The user lock still serializes quota checks. `FOR NO KEY UPDATE` permits concurrent FK key-share checks and removes the reproduced lock cycle with workspace creation; it does not remove quota enforcement. The attempt lock orders submission acceptance against finishing. The checked time is after lock waits, not the transaction-start time. This adds a database round trip for enterprise acceptance; no request-throughput gain is claimed for this correctness change.

The submission's selected version remains stable for its own judging. The assessment's entire task set is **not** newly frozen at a publication/start version; that separate data-model work is deferred in [DATA-MODEL.md](DATA-MODEL.md).

### Vibe workspaces

`POST /api/v1/enterprise/attempts/:id/vibe/:challengeId` keeps its start/resume response shape. It obtains the parent attempt lock before reading the effective deadline with `clock_timestamp()`. A new workspace cannot be created merely because its transaction began before the deadline while it was still waiting for the lock. A closed attempt without an existing workspace yields the existing HTTP **409** conflict; an inaccessible attempt/task yields the existing **404** response. An already existing eligible workspace retains the prior resume behavior.

These changes address the reproduced submission/finish, deadline-wait and FK lock-compatibility cases. They do not introduce global serializable isolation or claim that every assessment administration interleaving has been modeled.

Sources: reviewed `submissions.service.ts` and `vibe.service.ts`; regression evidence in `submissions.enterprise.spec.ts`, `Back/test/enterprise-submission-concurrency.e2e-spec.ts` and `Back/test/enterprise-vibe.e2e-spec.ts`.

## Internal Judge results and owner-visible diagnostics

`PATCH /api/v1/internal/judge/submissions/:id/result` keeps its existing authenticated internal contract, including generation/attempt fencing and the optional `debugOutputs` / `testResults` arrays. For a newly recorded result containing details, the API now resolves the immutable snapshot referenced by that submission rather than trusting a callback's sample designation or the current editable problem.

| Detail | Persistence behavior |
|---|---|
| `testResults[].testCase` | Must identify a case in the submitted snapshot and must not repeat within the result array; otherwise HTTP **400**. Existing DTO and aggregate count checks also remain. |
| `testResults[].isSample` | Stored value is derived from the snapshot. The existing field remains in the callback DTO and owner response. |
| `debugOutputs` | Only the first diagnostic entry for a known sample case is retained. Non-sample, unknown and duplicate output entries are omitted. |
| Missing immutable version when details are present | HTTP **404**; the new result is not persisted without its visibility source. |
| Callback omits per-case details | Legacy callback support remains; no additional snapshot lookup is needed for this case. |
| Valid partial result array | Remains allowed for executions that stop before all cases complete. |

Existing final-result idempotency and stale-attempt conflict handling remain in place. The normal worker already limited sample diagnostics; this adds API-side validation at the authenticated worker boundary. It does not make an arbitrary privileged worker trustworthy or add a public callback route.

The owner detail response, including `GET /api/v1/submissions/:id`, keeps its existing fields and now reflects the filtered stored details. The internal result acknowledgement is not expanded to return all owner diagnostics. Existing rows are not rewritten, and no historical data remediation is claimed.

Sources: `JudgeService.recordJudgeResult`, unchanged result DTOs, snapshot lookup and submission response mapping; regression evidence in `judge-boundaries.spec.ts` and `Back/test/security-boundaries.e2e-spec.ts`.

## Frontend behavior using existing APIs

The notification UI continues using `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `PUT /api/v1/notifications/:id/read` and `PUT /api/v1/notifications/read-all`. It now cancels obsolete requests, isolates state across session identity changes, prevents overlapping next-page loads and deduplicates notifications when offset pages shift.

Read mutations invalidate stale list/count requests. After all pending mutations settle, including partial failures, the component refreshes the authoritative list when open or unread count when closed. A delayed read/list response cannot be accepted merely because it completed later. Failed loads/read operations are surfaced, and the existing list can be retried. No pagination parameter, read-state field, websocket endpoint or notification service API was added.

Optional monitoring now loads its SDK only when configured and permitted. Privacy checks run again after asynchronous loading and before reporting, including on email action pages. Session replay/performance tracing are not enabled by this change; a failed optional SDK download does not block application startup. This concerns frontend loading and external telemetry handling, not the platform REST contract.

Sources: reviewed `NotificationBell.tsx`, `SiteHeader.tsx`, `monitoringClient.ts` and `monitoringSdk.ts`; frontend regressions and privacy tests are listed in [FRONTEND.md](FRONTEND.md). Browser/CI execution status remains in the coordinator's verification record.

## Read performance without response changes

Enterprise Vibe score assembly for the existing results/attempt views indexes rows by attempt and challenge once. Candidate/task ordering, absent/working/pending/complete states, score calculation and payload fields are preserved. The SQL result size and all-candidate export behavior are unchanged; this is not a new paginated results API.

The existing saved/voted profile queries behind `GET /api/v1/community/posts/mine` benefit from two user-first relationship indexes. Filters, visibility and ordered response payloads are unchanged. Both optimizations have output-equivalence evidence and bounded benchmark results in [DATABASE.md](DATABASE.md). They are not claims about every API's p95/p99 or overall Judge throughput.

## Worker and execution service compatibility

Worker calls to the existing internal API now use redirect rejection. `API_BASE_URL` must resolve directly to the canonical API location; a deployment that relies on an HTTP redirect is no longer accepted by these requests. Header names, credentials, claim/heartbeat/release/result paths, generation and attempt IDs remain unchanged.

Both Judge and Vibe execution readiness now require authenticated `/file` access to succeed and anonymous access to return **401 or 403** before running submitted code. These are calls to the execution service, not new `/api/v1` endpoints. A sandbox that serves the protected file endpoint anonymously fails readiness despite having a token configured in the client. Readiness mocks and source review do not establish actual cgroup, seccomp or network isolation; native runtime checks remain separate evidence.

The new output comparator preserves trailing ASCII-whitespace-per-line and trailing-blank-line rules, significant leading/interior bytes and binary comparison. No language is removed and no verdict rule is intentionally changed. Allocation/CPU improvements and equivalence tests are documented in [JUDGE.md](JUDGE.md).

Sources: reviewed `Judge/src/worker.ts`, `Judge/src/judge.ts`, `Judge/src/output.ts` and `Back/src/modules/vibe/vibe.runner.ts`; real loopback HTTP, comparator and runner regression tests.

## Rollout and verification boundary

There is no public API version bump or client payload migration. Compatibility work consists of communicating verified-email invitation requirements, retaining the temporary-password flow, configuring canonical internal URLs and enforcing sandbox authentication. The only schema migration is the additive index migration described in [DATA-MODEL.md](DATA-MODEL.md).

Component reports record executed regression evidence; combined integration and native/browser CI are independent merge gates. These documents do not authorize production deployment, claim a completed historical data repair, or turn a pending external validation into a pass.
