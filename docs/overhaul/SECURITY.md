# Security boundary audit

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.
This document records confirmed changes and their limits. It contains no production credentials or operational attack instructions.

## Scope inspected

- JWT validation, session-family revocation, suspension/deletion checks, forced password-change guards, role guards, and admin role mutation checks.
- Enterprise owner/candidate access, explicit username versus email invitations, and project-workspace eligibility.
- Submission ownership, immutable problem versions, worker credentials and generation fencing, sample diagnostics, and per-case metadata.
- Vibe execution readiness, output handling, bounded editable paths, model-output validation, revision/operation fencing, and request quotas.
- Email token hashing, encrypted delivery payloads, verification ownership, expiry, consent and outbox leases.
- Community role checks, parameterized search/sort construction, hidden-content access, and notification ownership.

These are source-level boundary reviews with focused regression tests. They are not a claim that all attacks, all runtime dependencies, or production infrastructure have been exhaustively tested.

## Findings

| ID | Severity | Boundary | Change | Verification |
|---|---|---|---|---|
| SEC-001 | P1 | Enterprise email invitations need verified mailbox ownership | Shared invitation predicate requires `email_verified_at` for email-based access; owner, explicit username, and public-test access retain their behavior. | Real PostgreSQL/API regression, including the actual verification-confirm endpoint; final result below. |
| SEC-002 | P2 | Per-case callback details should not define their own visibility | API derives sample labels from the submitted immutable version; drops non-sample/unknown/duplicate debug outputs; rejects duplicate/out-of-version result indices. | Targeted service and HTTP/database regressions; final result below. |
| SEC-003 | P2 | Vibe readiness should verify that authentication is enforced | Authenticated file-list access must succeed and an anonymous request must be denied before compilation starts. | Mocked transport regression fails before the fix and passes after it. Real native sandbox validation remains a CI gate. |
| SEC-004 | P2 | Temporary-password accounts must not obtain privileged visibility through optional authentication | Optional authentication treats accounts awaiting password replacement as anonymous; the strict guard retains its existing enforcement. | Dedicated guard units and real HTTP tests cover privileged, author, anonymous, public, and strict-route behavior. |

SEC-002 is defense in depth for an internal authenticated worker boundary. The normal worker already filters non-sample diagnostics. This audit did not demonstrate an external unauthenticated route to arbitrary Judge callbacks, and this fix does not make a compromised privileged worker trustworthy.

## Behavior and compatibility

- Email-only invitees must complete the existing mailbox-verification flow. When outbound verification has not been configured, organizers can invite a known account by its explicit username. An unverified claimed email is not an identity proof.
- Email invitations remain stored as email addresses, not converted into unconditional user-ID invitations. Existing username invitations remain stable across username changes as before.
- Unknown or ineligible candidates continue to receive the existing generic not-found response; test metadata is not disclosed to explain invite membership.
- There is no schema or route change. The internal result API retains its existing shape and legacy callbacks without per-case details. Incomplete, valid per-case results remain accepted for executions that stop early.
- Result validation uses the saved `problem_version`; later problem edits cannot make an old private case public. If details arrive without that immutable version, the API fails closed.
- Previously persisted rows are not rewritten. The ordinary baseline worker already filters sample diagnostics; incident-specific historical data remediation is outside this change.
- Users required to replace a temporary password retain access to public content, with anonymous visibility, until replacement. Healthy accounts retain their normal visibility. Strict authentication and the explicit account-settings exception are unchanged.

## Verification record

- Before production changes: targeted security suites executed 12 tests, with 6 failures and 6 passes. Failures cover diagnostic filtering, snapshot-derived labels, duplicate/out-of-version indices, missing immutable version, and anonymous sandbox access.
- After changes: targeted service/runner/lifecycle suites passed 47/47.
- Full local backend lint, type check, unit tests and build: 283 tests in 19 files passed after using independent dependency installations.
- The first local full-check attempt exposed a TypeScript declaration portability error caused by cross-worktree node_modules symlinks. Only those symlinks were removed and each worktree received `npm ci`; no production typings or compiler checks were weakened.
- Native PostgreSQL 17.11 + Redis 8.10.3: the focused HTTP/database file produced 3 failures / 1 pass at the baseline, then all 163 API integration tests in 25 files passed with the fixes (73.32 seconds). The focused cases exercise unverified/verified email access, explicit usernames, verification rechecks, and stored/owner-visible diagnostic filtering across problem edits.
- The first HTTP replay exposed an incorrect new test assumption: worker result responses intentionally omit detailed output. Assertions were moved to the owner-detail response and stored row, and both baseline and the full fixed API suite were rerun. No application response shape or existing assertion was weakened.
- Final lint/type recheck passed after the HTTP test correction. All services used task-owned data directories and loopback TCP; the runner created and dropped disposable integration databases and stopped its own services.

The separate optional-authentication follow-up reproduced 3 failures / 2 passes in the new unit file and 2 failures / 2 passes in the new HTTP file before the guard change. After the fix, the full backend lint/type/unit/build command passed, including 288 unit tests in 20 files. A first full API replay overlapped a separate build in the same checkout; rebuilding deleted compiled CLI imports while eight seed tests were running. That orchestration failure was preserved in the evidence. The sequential API replay then passed all 167 tests in 26 files (80.30 seconds) without weakening tests or changing application behavior.

Run `npm run check --prefix Back` for static/unit/build checks. For database tests, use the repository's disposable database runner: `npm run test:e2e --prefix Back`. Run build-consuming checks sequentially within one checkout. The new focused files are `Back/test/security-boundaries.e2e-spec.ts` and `Back/test/optional-auth-visibility.e2e-spec.ts`. Test data and delivery tokens are synthetic; no message is sent to an external mailbox.

## Residual validation and deployment considerations

- Real cgroup/seccomp/network containment and eight-language execution require the dedicated native CI runner. Mocked readiness tests cannot establish those runtime properties.
- Judge and sandbox tokens still authorize sensitive internal services and require private networking, restricted credentials, and operator-managed rotation.
- AI scoring remains model-generated feedback with bounded schema and evidence identifiers. This review does not establish resistance to every prompt-injection attempt or replace human review for consequential decisions.
- Shared-host privileged sandbox deployment, off-host backup/restoration, and production ingress/TLS validation remain separate infrastructure gates.
- No production database, queue, host, key, or deployment was modified during this work.

## Performance impact

Callbacks with per-case details perform an indexed immutable-version lookup before storing the result. Callbacks without details retain their prior lookup behavior. No API-latency or throughput improvement is claimed for this security change; full system load measurement remains an integration/performance task.
