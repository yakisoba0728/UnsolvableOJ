# Independent Security and Infrastructure Audit

Reviewer: `/root/security_infra` (independent AI reviewer). Date: 2026-11-16 UTC.

## Disposition and scope

The reviewed backend actor-fencing changes, Vibe executor cleanup, Vibe actor propagation, and consolidation CI selection change **pass this independent source and focused-test review**. The historical-evidence relocation also passes byte-level verification, including preservation of the active image-policy dependency graph. This is permission to integrate those reviewed changes into the consolidation candidate; it is not whole-project acceptance or production deployment approval.

One additional existing staff-grading defect was reproduced and fixed during this audit. Its immutable follow-up `e3190344c897d23938443fe052f790809e7b3776` also **passes independent source and regression review**. The exact new submit/evaluate regression cases fail on the preceding production source, while the corrected actor and cleanup files pass 32/32. All eight new real PostgreSQL Vibe cases remain pending final CI.

This is an ordinary source-backed audit. The coordinator attempted the `codex-security:security-scan` skill, but its required referenced prologue resource was unavailable and the session exposed no required security-workbench/preflight tools. No registered Codex Security scan, completed formal scan phases, external penetration test, or human security approval is claimed.

The reviewer inspected application source and infrastructure directly, rather than treating earlier phase reports as current proof. No product source changes, policy edits, credential changes, production operations, remote branch writes, or external messages were made by this reviewer.

### Immutable review inputs

| Input | Reviewed identity |
|---|---|
| Consolidated source baseline | `c3367954cf55584d3007ebe33c1c13aa9d6eed70` |
| Initial consolidation CI change / worktree base | `b22b31d700ad0852246e9670147cf84d3d3d4e1e` |
| Submission actor fence | `1effe5e18b75a8032190bdb10a1663acd7c9cadd` |
| Shared actor helper and community relationship fence | `c4e17084ca1b33bb13e546ce69695733fb1fd490` |
| Integration-fixture typing correction | `368e5e1ec0871e82a857eb2ba9f64081771ad6c9` |
| Vibe malformed-response cleanup | `cd9e227efe32a740f2bbf07761efe55471c39728` |
| Vibe actual-actor propagation | `8fc306548afd59ce404c00c3c5b12a6b9a67a1f1`, tree `1fbae497c6d6b1bd148d5a14a716fde47f4393b9` |
| Initial independent composed test checkout | `139eefc2e9678a19d06c247763a7a684dc18dd9c`, tree `64cad7fbfaad574a6f4756a6c07c6c4fc9cea111` |
| Staff-target withdrawal fix | `e3190344c897d23938443fe052f790809e7b3776`, tree `6eaa14cd45b542f11243dbb6b8ce5066cdb885c2` |
| Final independent composed test checkout | `e698c00760a5eac26f5736f1ebb5b45fa186a0fd`, tree `83d0fe04c8deef9db1b41295f7d6b0bcd4f7348c` |
| Preserved historical evidence source | `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`, tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` |

The isolated checkout is `/workspace/scratch/c0f7c387c945/oj-security`, branch `internal/consolidation-security`. It has its own dependency installation; it does not share a symlinked `node_modules` with another agent. Author commits were cherry-picked locally for execution, so its commit IDs differ while the reviewed application changes remain the same. The evidence checker was independently reviewed and executed in the coordinator's evolving consolidation checkout, separately from these application tests.

## Application boundary review

### Backend submissions and private community relationships — PASS

The common `lockActiveActor` helper in `Back/src/common/active-actor.ts` locks the actor's account with `FOR NO KEY UPDATE` and checks deletion, suspension, forced-password-change state, and the supplied token version. If the authenticated principal carries a session-family ID, a separate statement checks for a live unrevoked refresh-token family using `clock_timestamp()`. It preserves the established optional version/session compatibility for legacy/internal callers; this is not a claim that arbitrary callers may bypass authentication. HTTP admission remains protected by the JWT strategy and route guards.

The separate live-session statement matters because account-row locking can wait behind logout, revocation, or token rotation. Auth paths inspected in `Back/src/modules/auth/auth.service.ts` take the user lock before refresh-token mutations. The later statement sees a committed revocation or the live successor in the same rotated family. Admin role, suspension, and password-reset paths update token versions. `NO KEY UPDATE` also avoids blocking child foreign-key `KEY SHARE` checks unnecessarily.

`SubmissionsService.submitNew` now applies that check to every role before quota or attempt mutation. Administrators remain exempt from the submission quota, but no longer bypass account/session eligibility. The patch preserves the existing attempt/immutable-version/queue flow and public response contract. `CommunityService.relationship` retains the established post-first lock, then checks the actual follower/saving actor before writing a private relation. Withdrawal does not lock community posts, so this addition does not introduce a post/user reverse-lock cycle in the reviewed paths.

Independent execution passed **18/18 tests across the submission actor and community relationship files**. The regression fixture correction narrows TypeORM query parameters without changing application behavior or weakening a test assertion. The 14 new PostgreSQL/API cases authored with these changes were inspected but not run locally by this reviewer; final CI must execute them.

Source evidence: `Back/src/common/active-actor.ts`; `Back/src/modules/submissions/submissions.service.ts`; `Back/src/modules/community/community.service.ts`; `Back/src/modules/auth/auth.service.ts`; `Back/src/modules/admin/admin.service.ts`; `Back/src/modules/submissions/submissions.actor.spec.ts`; `Back/src/modules/community/community.relationship.spec.ts`; and the two `*-revocation.e2e-spec.ts` files changed by the reviewed commits.

### Vibe cached-artifact cleanup — PASS

`VibeRunner` previously could reject a malformed executor response before retaining safe artifact IDs for cleanup, and string-valued file maps could be treated as character entries. The fix collects safe IDs before reporting malformed result structure, while rejecting invalid maps and IDs. The implementation keeps a maximum of 16 unique safe IDs, a one-megabyte response bound, and one shared five-second cleanup timeout. Cleanup is awaited from `finally`, including protocol-error paths.

The six added regressions cover multiple results, a null result before a valid one, an invalid ID between valid IDs, over-limit IDs, a string file map, and an array file map. This reviewer independently ran the complete cleanup file: **12/12 passed**. The patch does not change verdict calculation, executor authentication, image policy, or transport trust settings.

Source evidence: `Back/src/modules/vibe/vibe.runner.ts` and `Back/src/modules/vibe/vibe.spec.ts` at `cd9e227efe32a740f2bbf07761efe55471c39728`.

### Vibe mutation actor propagation — PASS for the reviewed patch

Every public mutation controller now passes the full authenticated principal rather than reducing it to an owner ID. Start, enterprise start, and edits check that actor in their mutation transaction. Chat, run, submit, and evaluation check the actor before operation admission. Internal `runForOwner` / `evaluateForOwner` paths preserve the distinction between the staff principal performing a grade and the candidate who owns the workspace. All three Enterprise delegations were checked; there is no remaining old-signature production caller.

The reviewed order is account actor, then any standalone/global advisory lock, then enterprise attempt, then workspace. `EnterpriseService.finish` closes its transaction before calling `finalizeExam`; it does not hold the attempt lock while attempting to acquire the actor lock. Withdrawal locks the account before invitation/private-relation changes and does not acquire the Vibe attempt/workspace locks. No introduced cycle was found in these paths. The actor lock establishes admission order; the patch does not promise to cancel an already admitted external operation when withdrawal subsequently occurs.

The positive staff fixture independently asserts that account/version/session checks use the staff ID while every workspace owner query uses the candidate ID. Sixteen negative unit cases cover eight mutation routes for an inactive actor or a revoked session. The combined actor and cleanup run independently passed **29/29 tests**. Five new PostgreSQL/API cases cover queued standalone start, edit, run, enterprise start, and a real account withdrawal; they were reviewed but not executed locally.

Source evidence: `Back/src/modules/vibe/vibe.controller.ts`, `vibe.service.ts`, `vibe.actor.spec.ts`; `Back/src/modules/enterprise/enterprise.service.ts`; `Back/test/vibe-actor-revocation.e2e-spec.ts`; and the updated principal fixture in `Back/test/enterprise-vibe.e2e-spec.ts` at `8fc306548afd59ce404c00c3c5b12a6b9a67a1f1`.

### Additional staff-target withdrawal defect — independently reproduced and fixed; PASS

This is an existing defect found during independent review, not a regression introduced by the actor patch. `EnterpriseService.gradeVibe` explicitly refuses a deleted candidate, and `Back/test/withdrawal-vibe.e2e-spec.ts` defines retained evidence as readable by authorized staff while new grading returns 409 and makes no provider calls. However, `reviewContext` reads `candidate.deletedAt` before Vibe admission. An active staff request can then wait while the candidate withdraws. For a public assessment, the later `canJoinEnterprise` predicate remains true, and fencing only the actual staff actor does not revalidate the target's deletion state.

The accepted follow-up `e3190344c897d23938443fe052f790809e7b3776` acquires distinct staff and target user rows with `ORDER BY id FOR NO KEY UPDATE` before the helper, advisory, parent, and workspace locks. It then validates the actual staff actor/session and rejects a missing or deleted owner with 409 before quota, provider, or workspace mutation. It does not require the candidate's active session, nonsuspended status, or password-change status. Existing admin multi-user locks already use `ORDER BY id`; the other inspected auth, withdrawal, email, bookmark, learning-goal, and enterprise-start paths lock one account before children. No new lock cycle was identified.

Using the exact final regression file, this reviewer replaced only `VibeService` with its immutable `8fc3065` predecessor and independently observed both new submit/evaluate cases fail because finalization resolved. The 18 unrelated cases were deliberately filtered in this negative run. The final source was restored byte-for-byte and its complete actor plus cleanup files passed **32/32** with no skipped cases. The production checkout is clean.

Three additional real PostgreSQL cases were inspected: two queued public-assessment grading races pause actual `AuthService.withdraw` after its user update, observe a real lock wait, and assert retained state plus no provider calls; one positive case permits staff grading despite a nondeleted candidate's suspension, forced-password change, version change, and revoked session. These complement the five actor-revocation DB cases, making **eight new real PostgreSQL Vibe cases awaiting final CI**. They were not executed locally. The author separately reports full lint/type/build and 436/436 units; that is distinct from this reviewer's focused execution.

One separate community question was reported: following a retained post can recreate a follow relationship to a withdrawn author because the fence checks the follower and withdrawal removes both incoming and outgoing follows. The intended target-follow contract has not been established. No vulnerability, blocking defect, or authorized semantics change is asserted from that observation alone; the coordinator explicitly declined a broader change absent a contract.

## Infrastructure and supply-chain boundaries

### CI selection and fail-closed execution

The `b22b31d` change adds the exact consolidation head/main-base pair to both identical full-validation selectors. Positive and negative branch/base cases were added. Existing schedule, manual, full-validation-label, and earlier phase triggers remain. The workflow retains read-only `contents` permission, non-persisted checkout credentials, full-SHA action pins, the existing required-job aggregation, and the ordinary pull-request trust context. No `pull_request_target` execution or failure suppression was introduced.

Independent `node --test scripts/ci-policy.test.mjs scripts/check-executor-compose.test.mjs scripts/compose-vibe-gateway.test.mjs` passed **86/86**, with no skipped or cancelled cases. The suite exercises selection policy, executor topology denials, and real ephemeral certificate/identity fixture checks. It is not a Docker deployment or native sandbox run.

The image scanner/wrapper/applicability sources were also read. Independent `python3 -m unittest discover -s scripts -p 'image_*test.py'` passed **65/65**. Those tests exercise source/image/digest binding, absent or malformed evidence, stale databases, unknown exit codes, raw-result disagreement, policy approval/expiry, and rejection of changed applicability inputs. Their synthetic subprocess/proof envelopes are explicitly test fixtures. Passing them does not generate a fresh vulnerability scan or an actual OCI payload proof.

The separate `verify_image_payload_test.py` suite independently passed **27/27**, bringing this audit's image-related Python executions to **92 tests**. These verify the payload verifier's behavior on its fixtures; they do not establish that the final rebuilt Runtime image matches the 990-file policy.

Source evidence: `.github/workflows/ci.yml`; `scripts/ci-policy.test.mjs`; `scripts/image_audit.py`; `scripts/image_gate.py`; `scripts/image_applicability.py`; their corresponding tests; `scripts/image-audit-tool.json`; and `scripts/image-applicability-policy.json`.

### Image policy remains exact and limited

The Trivy pin remains **0.76.2**, with the existing archive/checksum and executable bindings. The active Runtime policy keeps **177 raw HIGH and 5 raw CRITICAL findings**, raw scanner exit 2, an exact 182-record reviewed component scope, and 990 package-file payload comparisons. Its fixed expiry remains **2026-11-30T00:00:00Z**. This audit did not change or extend that policy, independently refresh its advisory review, or characterize the host kernel as patched.

Only a completed Runtime finding result can reach the applicability path. Scanner execution failures, unsupported/ambiguous results, source or image mismatches, stale vulnerability databases, changed findings or evidence, and expiry remain blocking. Other application-image findings cannot borrow Runtime's review. The required final full run must rebuild and rescan all four images at its actual checked-out source and bind the resulting artifacts independently; historical phase runs are insufficient.

### Deployment and data boundaries inspected

The reviewer inspected `Back/Dockerfile`, `Front/Dockerfile`, `Judge/Dockerfile`, `Judge/runtime/Dockerfile`, their build-context ignore files, root/deployment Compose, dedicated Judge/Vibe Compose overlays, frontend/gateway configuration, backend environment/HTTP/database/Redis settings, and worker/Vibe transport sources.

The ordinary application build contexts exclude local environment files and dependency/build outputs. Production Compose requires supplied secrets and keeps PostgreSQL, Redis, and the executor off public ports. The sandbox remains deliberately privileged and isolated on its private network, with no application data mounts, Docker socket, or application credentials. That is a deployment boundary with a material host dependency, not a claim of complete container isolation. Dedicated worker settings require authenticated HTTPS and Redis TLS with certificate verification; dedicated Vibe requires HTTPS origin validation, CA/client identity files, distinct safe credentials, and checked server identity. Executor gateway method/path/body and credential-routing controls were inspected alongside their denial tests.

Backend database TLS uses certificate verification and prevents URL options from overriding the intended TLS mode. Embedded same-host Redis remains a private data-network configuration, while the dedicated worker path requires TLS. Backend JWT/Judge secret validation intentionally permits documented local CI/development markers for fixture compatibility; production deployment templates supply no populated default credentials. The audit did not treat that documented local path as proof of production credential quality. Frontend proxy configuration rejects the internal Judge route, and the examined standard request paths do not log secret values or submitted source.

Backup behavior was reviewed from source: dump files are written as partial files, renamed only after success, old dumps are deleted after a successful replacement, and freshness is health-checked. This review did not inspect production backups, demonstrate off-host recovery, measure RTO/RPO, or verify operator access and retention controls.

No additional confirmed infrastructure defect required a source change in this pass.

## Secrets and dependency observations

The final local high-confidence pattern scan inspected **1,003 tracked UTF-8 text files / 25,673,046 bytes** at `e698c00760a5eac26f5736f1ebb5b45fa186a0fd` for private-key blocks, GitHub token forms, AWS access-key forms, and OpenAI-style keys. It produced one raw AWS-shaped match inside a base64-encoded WebM data URL in an existing presentation; inspection confirmed that this was encoded media bytes, not a credential literal. **Zero credential findings were validated.** Binary/media decoding and archive contents were excluded; custom-format secrets, historical Git objects, live environment values, and external secret stores were not exhaustively scanned. This is a bounded observation, not a blanket absence-of-secrets certification.

All resolved dependency records checked in the Back, Front, and Judge lockfiles carried integrity metadata and used `registry.npmjs.org`: **471**, **263**, and **29** records respectively. Six fresh `npm audit --json --audit-level=moderate` commands, covering production and complete graphs for all three packages, exited zero and reported **zero findings at every severity**. The raw reports are retained separately. These npm results do not replace OS/image scanning and do not erase the Runtime raw findings.

## Evidence relocation and policy preservation — PASS

The coordinator's manifest relocates 51 bulky historical files from the current tree while preserving their exact original Git objects. This reviewer independently read each original from `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`, recomputed byte counts, SHA256, and Git-blob hashes, and checked equality with the manifest. The total is **13,205,154 bytes** and **66,151 newline-counted text lines**. The checker subsequently gained a per-file comparison of each supplied text-line count with the original bytes; it is no longer only an aggregate consistency check.

The independent policy traversal checked **34 transitive implementation/evidence inputs** and **66 hash bindings**. Every protected input remained byte-identical to the original tree, and none was in the relocation set. This includes the active scanner pin/policy/evaluator/payload verifier; Linux package-file manifest; original and refreshed kernel/CNA reviews; baseline, accepted, and blocked Runtime archives; Phase V security inputs; and the bound repro scripts. The broader image-measurement fixtures used by the existing tests are retained too. This is preservation verification; no new approval of historic vulnerability decisions is implied.

`scripts/check_consolidation_evidence.py --verify-git` independently passed with **51 originals / 13,205,154 bytes / 415 local Markdown targets** at coordinator commit `c58342199c2b592c537ca3802e047b6d6760b87c`. Its denial unit test also passed. The CI step fetches the exact immutable original commit and invokes the checker before backend validation. The checker verifies source tree identity, historical-deletion coverage, manifest uniqueness/path structure, original byte/hash/blob/line-count bindings, and existing local Markdown targets. It does not fetch arbitrary external URLs or prove that all web links render; relocated historical bytes are verified through the manifest rather than external browsing.

Source evidence: `docs/consolidation/archived-evidence.json`; `scripts/check_consolidation_evidence.py`; `scripts/check_consolidation_evidence_test.py`; coordinator `.github/workflows/ci.yml`; and `security-cleanup-independent.json` from this review.

## Independent executions and remaining gates

| Execution by this reviewer | Observed result | Scope limit |
|---|---|---|
| Own Back dependency installation | Success | Dependency install, not application execution |
| Submission/community actor files | 18/18 passed | Unit fixtures; real DB/API pending |
| Vibe cleanup file | 12/12 passed | Mocked executor transport |
| Initial Vibe actor + cleanup files | 29/29 passed | Includes the same 12 cleanup tests; not 41 unique tests |
| Staff-target regressions on previous production source | Both rejection cases failed as expected | 18 unrelated cases intentionally filtered |
| Final Vibe actor + cleanup files | 32/32 passed | Complete focused files; no skips; supersedes earlier 29 |
| CI/executor/gateway Node suites | 86/86 passed | Topology and certificate fixtures, not Docker/native |
| Image audit/gate/applicability Python suites | 65/65 passed | Synthetic gate tests, not new image scans |
| Image payload-verifier Python suite | 27/27 passed | Synthetic payload fixtures, not a final-image proof |
| Evidence checker / denial test | PASS / 1 test passed | Exact preserved bytes and local targets |
| Independent archive/policy traversal | 51 blobs; 34 inputs; 66 bindings matched | Preservation, not refreshed advisory approval |
| Six fresh npm audits | All exit 0; all severities zero | npm graphs only |
| High-confidence text-secret/lockfile scan | Zero validated findings; one encoded-video false positive; all package integrity present | Bounded text-pattern scan |

Local PostgreSQL, Redis, and Docker executables were unavailable in this review environment. This reviewer therefore did not execute the new DB/API races, migrations, native eight-language sandbox, real gateway Compose, multi-API/multi-worker campaign, browser flows, or image builds. No paid AI provider was called. The author-reported 433-unit/full-build result for the initial actor patch is separate from the independent focused executions above.

Final acceptance requires the exact final source/tree and all 12 real CI jobs, including new race cases and current four-image reports. The staff-target fix has the independent PASS recorded above; its real PostgreSQL execution remains required. Production host kernel/cgroup/seccomp/network controls, TLS ingress and certificate provisioning, real credential rotation, external services, and off-host recovery remain external deployment limits.

### Local evidence files

All following files are under `/workspace/scratch/c0f7c387c945/`:

- `security-backend-focused.log`, `security-vibe-cleanup-tests.log`, `security-vibe-actor-tests.log`.
- `security-vibe-staff-target-baseline.log`, `security-vibe-staff-target-tests.log`, and the exact `security-vibe-staff-target-regression.spec.ts` fixture.
- `security-infra-tests.log`, `security-image-gate-tests.log`, `security-image-payload-tests.log`, `security-npm-ci.log`.
- `security-cleanup-independent.json`, `security-secret-lockfile-scan.json`, `security-archive-check.log`.
- `security-audit-{back,front,judge}-{production,all}.json` (six raw npm reports).
- `security-independent-review.json` binds this completed report to source identities, commands, and evidence hashes.

Independent source and focused-regression review is complete for the immutable subjects listed above. This report does not authorize closing the prior phase PRs before the coordinator's final whole-tree acceptance conditions have been met.
