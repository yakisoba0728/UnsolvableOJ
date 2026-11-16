# Judge / Vibe consolidation audit

## Scope and exact source

Read-only source audit plus bounded fixes, performed by the Judge/Vibe worker. No GitHub mutation, deployment, paid provider call, production data access, privilege change, native container execution or scanner-policy change was performed.

- Baseline: `c3367954cf55584d3007ebe33c1c13aa9d6eed70`, tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` (exact Phase V tree).
- Authored cleanup commit: `cd9e227efe32a740f2bbf07761efe55471c39728`.
- Authored actor-fence commit: `8fc306548afd59ce404c00c3c5b12a6b9a67a1f1`, tree `1fbae497c6d6b1bd148d5a14a716fde47f4393b9`.
- Authored staff-target withdrawal commit: `e3190344c897d23938443fe052f790809e7b3776`, final tree `6eaa14cd45b542f11243dbb6b8ce5066cdb885c2`.
- The latter tree also includes the Backend agent's three prerequisite commits, locally cherry-picked as `7d117cdf900c40b00f0cfb13a7a6a6a6b9bf7a62`, `0f7e74009eae04c2ba24ef17bef3b5972b3edb4c`, and `f1b2e4f077e1b9e159732b4fb25738e84399dd9f`. These are dependency copies, not new authored Judge findings. Integrate the original Backend SHAs, then only the three authored Judge/Vibe commits in the order listed.
- Independent security reviewer `security_infra` reviewed the first two commits and all changed controller/Enterprise call sites, found no introduced lock-order cycle, and passed 29/29 actor/cleanup tests on composed checkout `139eefc2e9678a19d06c247763a7a684dc18dd9c`. The follow-up `e3190344` also independently passed: 32/32 actor/cleanup tests on composed checkout `e698c00760a5eac26f5736f1ebb5b45fa186a0fd`, with both new target-deletion regressions independently replayed red against prior `8fc3065` production. The parent must still bind final CI to the final consolidated tree. This is worker-independent review, not a claimed human GitHub approval.

## Source coverage and preserved contracts

Reviewed all four production Judge TypeScript modules (`config`, `judge`, `output`, `worker`) and all ten production Vibe modules (`ai`, `catalog`, `controller`, `module`, `prompts`, `runner`, `service`, `snapshot`, `transport`, `types`). Also examined the Judge/runtime Dockerfiles, runtime startup/health/mount policy, Go-package-graph guard, authentication redaction patch, dedicated worker and Vibe Compose templates, TLS mount overlay, gateway allowlist, and associated regression suites. Related reads covered JWT actor derivation, withdrawal/session revocation, enterprise caller/ownership paths and immutable Vibe tests.

Preserved boundaries:

- Generation/attempt fencing, lease heartbeat cancellation, bounded same-attempt result replay, outage release/backoff, Redis-consumer readiness and graceful close behavior remain unchanged.
- All eight language definitions, native CPU/memory/process/output limits, byte-level output equivalence, sample-first original case numbers, hidden diagnostic withholding, and Java heap-OOM versus hard-limit-MLE semantics remain unchanged.
- Vibe snapshot hashes and immutable assessment content, revision and operation-ID fencing, parent-before-workspace ordering, final hidden-check redaction, exact editable file/UTF-8 limits, quota values and AI/provider configuration remain unchanged.
- Dedicated Vibe mTLS, strict hostname verification, origin/method/path checks, 1 MiB request/response bounds, redirect refusal and sanitized transport errors remain unchanged.
- Runtime raw findings and the fixed review expiry `2026-11-30T00:00:00Z` are not modified. This audit does not establish a current image scan, host/kernel security or deployment readiness.

## Confirmed findings and fixes

### JUDGE-VIBE-001 — P2: rejected executor replies bypassed safe artifact cleanup

Before: `VibeRunner.execute` rejected a multi-result payload before collecting its cached artifact IDs; an invalid ID stopped iteration before subsequent valid IDs; an oversized map was rejected before collecting any bounded cleanup entries. A string `fileIds` value was treated by `Object.values` as characters, causing DELETE requests for those characters. Malformed maps and partial/error payloads therefore leaked owned executor files or generated unintended cleanup paths.

Proof: six targeted cases were added against the unchanged runner. All six failed while the six existing boundary tests passed. The cases cover multi-result/error replies, null preceding a valid partial result, an unsafe ID between valid IDs, 17 IDs, string maps and array maps.

Fix: collect only syntactically safe IDs from record-shaped maps before rejecting the execution envelope; continue past invalid values; maintain a maximum of 16 retained IDs. The existing five-second shared cleanup deadline, strict request path validation and awaited transport close remain in place. Overflow is still rejected, and IDs beyond the fixed cleanup budget remain subject to the executor TTL; this does not claim unbounded cleanup of arbitrary malformed responses. No verdict is converted to PASS by this logic.

After: 12/12 targeted tests passed; full Back 398/398 units, lint, types and build passed on the cleanup source. Native behavior must still be exercised by final CI.

### JUDGE-VIBE-002 — P1: a guard-authenticated but revoked actor could initiate new Vibe mutations

Before: candidate methods received only `userId`. Requests waiting behind advisory, exam, workspace or FK locks did not revalidate account deletion/suspension/password version or login-family revocation before creating attempts, changing saved files, consuming quotas or starting executor/provider work. Withdrawal retains the user UUID, so an FK is not an active-account check. Session-only revocation also leaves `token_version` unchanged.

Proof: eight controller mutation actions (`start`, `save`, `undo`, `apply`, `chat`, `run`, `submit`, `evaluate`) were exercised with two stale-actor states. After correcting a SQL mock that initially matched a nested ownership subquery too broadly, all 16 negative assertions failed against the restored original controller/service. The corrected fixture and exact original source were rerun; this original-source check selected only the 16 negative cases, so its excluded positive case is not counted as an executed acceptance test.

Fix: public candidate methods now carry the complete authenticated principal. They use Backend's shared `lockActiveActor` inside the transaction, before advisory/global admission, parent exam and workspace locks. That helper serializes with account/session changes and performs the session-family read in a fresh statement after the user lock. HTTP routes and request bodies are unchanged. Public `run`/`evaluate` delegate to private owner-aware methods; internal/staff finalization carries the actual staff actor separately from the candidate owner. Exactly three EnterpriseService delegate lines were adjusted with the Backend owner's agreement, and the two direct enterprise-test callers now provide their actual candidate principal.

After: 17/17 actor tests passed, including a positive staff-session/owner-preservation and user-before-admission ordering case. The actor-fence composition check passed 433 tests in 33 files, plus lint, typecheck and production build. Five real-PostgreSQL cases were added and compiled: queued standalone start, saved-file edit, session-only run revocation, enterprise workspace start, and a stale admitted actor after actual AuthService withdrawal. These five cases are **NOT_EXECUTED locally** because PostgreSQL/Redis are unavailable and require final CI. Their lock waits use observed `pg_blocking_pids`, with awaited release/cleanup and state/revision/quota/provider side-effect oracles.

The fence protects transaction admission. It does not cancel an executor/provider operation already admitted before revocation. Existing operation-ID fencing continues to govern such completion. Independent review then identified the separate staff-target deletion race below. The coordinator confirmed the existing 409/no-provider contract and requested a bounded follow-up; it is now fixed by the third authored commit.

### JUDGE-VIBE-003 — P1: staff grading could admit new work after the candidate withdrew

Before: `EnterpriseService.gradeVibe` checks `deletedAt` in `reviewContext` before starting Vibe admission. In public assessments the later candidate-ownership query still matches a withdrawn candidate, so staff grading queued behind workspace/advisory locks could run the executor or evaluator after withdrawal committed. This conflicts with the existing withdrawn-candidate 409/no-new-provider-work contract in `withdrawal-vibe.e2e-spec.ts`. It affected both first submission and evaluation retry.

Proof: two new targeted unit cases failed against immutable prior production `8fc3065`; both returned graded reports instead of a 409. The other 18 unit cases were deliberately excluded by the repro name filter, not marked skipped in the acceptance suite. Independent Security reproduced both failures from the prior production composition and saved `security-vibe-staff-target-baseline.log`.

Fix: when staff and candidate differ, acquire both user rows with database `ORDER BY id FOR NO KEY UPDATE` before any individual actor lock, global admission, exam or workspace lock. Authenticate the actual staff account/session with the shared helper, then reject a missing/deleted candidate from the locked rows with the existing 409 message. A nondeleted candidate's suspended status, forced password change, token version and session validity are not substituted for staff authority. Candidate-as-actor paths retain the single-user helper. Sorted dual-user acquisition matches the existing admin multi-user ordering and prevents reciprocal staff/candidate lock inversion.

After: all 20 actor units passed, including positive staff grading with both UUID relative orders and unchanged actual-staff session/owner assertions. Final full Back check passed **436/436 tests in 33 files, lint, typecheck and production build**. Independent Security reviewed the immutable follow-up and real-DB fixtures and found no lock-order, actual-actor or target-eligibility blocker; its 32/32 actor/cleanup tests passed on composed checkout `e698c00760a5eac26f5736f1ebb5b45fa186a0fd`. It replayed the exact final regression fixture against prior `8fc3065` production and confirmed both expected failures.

Three additional real-PostgreSQL tests are authored/typechecked but **NOT_EXECUTED locally**: two public-assessment races pause actual `AuthService.withdraw` after its real uncommitted deletion UPDATE, hold a separate workspace row, launch staff HTTP through the stale review context, observe `pg_blocking_pids`, and await actual withdrawal commit before releasing the workspace. Both submit/retry paths must return 409 with no provider call or state/revision/quota change; retained staff review must remain available. A positive test requires staff grading to succeed when the nondeleted candidate is suspended, must change their password and has revoked sessions. Pending PostgreSQL cases in this worker's actor file now total **eight**.

## Executed checks, failed attempts and evidence

Machine-readable hashes and exact source identity: `judge-evidence-manifest.json` alongside this report. All listed logs are preserved in `/workspace/scratch/c0f7c387c945`.

| Log | Interpretation | Bytes | SHA256 |
|---|---|---:|---|
| `judge-baseline-check.log` | PASS: Judge build and 137 worker/protocol/output/log-redaction tests | 12408 | `c772da9e6b9ce7523df950b0a1be55bd2b009065598505c3483cec0b6a662b90` |
| `judge-python-check.log` | PASS: 5 Python runtime configuration/Go-graph checks | 103 | `43fb5f62fa519671222840aa1de329b3fbbd595dad0e1af62d81cceb9fe21aee` |
| `vibe-cleanup-before.log` | EXPECTED RED: 6 new regressions fail, 6 existing tests pass on unchanged runner | 5230 | `8d9d900082066ed52293e6a31f662ec2be9bd4eefbdaafac0f6ed29cd87cf534` |
| `vibe-cleanup-after.log` | PASS: 12 runner boundary tests | 326 | `05b22dda9c671ad1ad6aede7fc7a3770c3f0bf7147b3787105665ecc0f796072` |
| `vibe-back-check.log` | PASS: Back lint/typecheck/build and 398 unit tests before shared-helper composition | 1080 | `be3f2fed956efd78bf73f8cafde25515c3ef09ba08f492eefaa1e1c11d04a546` |
| `vibe-actor-before.log` | SUPERSEDED UNIT FIXTURE: 16 failures; fixture matched nested FROM users too broadly | 6733 | `69be56b0e28e7d6a5344387c7a1d0a86f4b92a81142d1ebfe2b470b821570da1` |
| `vibe-actor-after.log` | FAILED UNIT FIXTURE: 28 pass / 1 fail; positive staff case exposed broad SQL mock matcher | 1434 | `b7c21be4e8fec72f022ed917e04cb2eb37bea0fe54555ad0cae9a9cc050fe71e` |
| `vibe-final-back-check.log` | FAILED UNIT FIXTURE: 432 pass / 1 fail; same mock issue, corrected without changing production assertions | 2010 | `b0de25f843e3c1367b6272a8a0211de4a6a1771b2ac37fbb80fd41d50d2f09bc` |
| `vibe-actor-before-validated.log` | EXPECTED RED: corrected fixture; 16 negative cases fail against restored original service/controller, 1 positive case excluded by name filter | 98017 | `30c093ba0de5548e1d23903b55c7f259a58758dabe857beaa1a5230c645f4b3a` |
| `vibe-actor-after-validated.log` | PASS: 17 actor tests including positive staff finalization | 325 | `a6f078a250b947691ee3c51c58a1e5b5d2cde9760bbd7574c24f8cb3241f9586` |
| `vibe-final-back-check-accepted.log` | PASS: actor-fence composition Back lint/typecheck/build; 433 tests / 33 files | 1077 | `20aefbb9e16e2d0e1df3d6974babbdd591f4f3029d919a76ae88f26c42644b7b` |
| `vibe-target-before.log` | EXPECTED RED: two staff-target deletion cases fail on 8fc3065 production; 18 other cases excluded by repro filter | 13513 | `ba89d2320c013677bc0e50cc0538161643aa7333905be61ed5fdd29595f7b0e2` |
| `vibe-target-after.log` | PASS: 20 actor tests with target-deletion fence | 330 | `182a20bfb5191e437a5f7f1a8b695009ec5edc99327d36cc5213d7a994b50abb` |
| `vibe-target-back-check.log` | FAILED FIXTURE TYPECHECK: original.call return unknown needed typed PID result; optional-chain fixture warning corrected | 874 | `afcaa09d59c1da6b3e912975406e640d6da5ae236ad6afc4528ea58cbc40b47e` |
| `vibe-target-back-check-accepted.log` | PASS: final composed Back lint/typecheck/build; 436 tests / 33 files | 1078 | `5c8022350a5ebd5ede79b40a24da58a0ad7cdaa13f06d69a16180f8b656a1294` |
| `security-vibe-staff-target-baseline.log` | INDEPENDENT EXPECTED RED: exact final fixture, both target-deletion regressions fail against immutable prior production | 13536 | `3a96ffcf45ffaec4c573ef318d7d4d42c83f60fa09a23649fc782286eaf622ce` |
| `security-vibe-staff-target-tests.log` | INDEPENDENT PASS: 32 actor/cleanup tests on e698c007 composition including all three authored patches | 329 | `8f14f6bfe201abd4edaa3460f28debd79ca881de0b42ecb95238e32f8ccd31be` |

The initial positive-staff failure was in the new mock fixture, not a production exception observed through a real database. The matcher was narrowed, the original-production negative repro was repeated, and the final full suite ran again. No production test assertion was removed, weakened or marked skip. New API test code was typechecked but is not counted as an executed PostgreSQL pass. The final follow-up check also corrected a fixture-only TypeORM generic-result type and optional-chain warning before rerunning the complete check successfully; no acceptance assertion was weakened.

## Remaining gates

- Final consolidated-source/current-main full CI: four actual image builds/scans, native language matrix, real Redis/BullMQ/native pipeline, restored PostgreSQL/API/migrations and three-engine browser/Compose flows.
- Independent review of all three authored commits passed as recorded above. Final composed-source review and CI remain the coordinator's gate; no human GitHub approval is claimed.
- Actual approved host/kernel/network/egress/certificate and production recovery evidence remains external. No local sandbox-security bypass was attempted.
- No measured performance optimization was adopted. This change does not claim throughput, p99 or resource improvements. Artifact cleanup correctness and account/session admission correctness are the outcomes.
