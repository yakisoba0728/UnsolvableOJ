# Phase III cross-feature security review

Reviewer: `runtime_security_engineer` (AI engineering reviewer; no human approval claim).

**Reviewed source:** `102d1c218fab24571a62618dee33d3d451cfa5f9`  
**Git tree:** `fe0ab0e3ccac59f3583cb493845403c5d1578d39`  
**Method:** Read-only source review of `oj-vibe`. No code or GitHub mutation, new test execution, Docker/native execution, or paid provider call was performed during this review. This file preserves the previously delivered review without expanding its scope.

**No new confirmed P0/P1 integration regression was found in the reviewed scope.** Learning and Vibe were implemented by other agents and were independently reviewed here. The executor changes were authored by this reviewer; their inclusion below is a retained-control inventory, **not an independent approval of the reviewer's own implementation**.

## Actual retained controls

| Area | Control observed in source | Exact repository path |
|---|---|---|
| Learning ownership | `JwtAuthGuard` and the `CurrentUser` ID select the caller. There is no arbitrary-user selector route. | `Back/src/modules/users/users.controller.ts` |
| Learning input bounds | `days` accepts only integer `7`, `30`, or `90`. | `Back/src/modules/users/dto/learning.query.ts` |
| Learning visibility | Caller ID and period are SQL parameters. Only currently `PUBLISHED`, non-private problems and ordinary submissions are included; test runs and enterprise assessment submissions are excluded. | `Back/src/modules/users/learning.service.ts` |
| Learning response | Scalar evidence is aggregated without source code, test input, diagnostics or enterprise data. Review rows are capped at 10 and tags at 20. Bookmark state is scoped to the same caller ID. | `Back/src/modules/users/learning.service.ts` |
| Learning consistency | A single SQL statement provides one snapshot for all panels. A deleted account does not receive a dashboard row. | `Back/src/modules/users/learning.service.ts` |
| Learning UI ownership | The page remounts on account/session identity; content remounts on period changes; obsolete requests are aborted. | `Front/src/App.tsx`, `Front/src/pages/LearningPage.tsx`, `Front/src/hooks.ts` |
| Vibe assessment identity | Canonical content hash, supported format/runner/review versions and challenge identity are checked; inconsistent content fails closed. | `Back/src/modules/vibe/vibe.snapshot.ts` |
| Vibe data integrity | Selection-time version/model binding, version UPDATE refusal, foreign-key restriction on deleting referenced versions, and conservative rollback refusal retain provenance. | `Back/src/database/migrations/1796000000000-vibe-challenge-versions.ts` |
| Vibe access and projection | Candidate ownership/enterprise eligibility and staff owner/admin authority are separate. The server-only snapshot is not spread wholesale into the API response. | `Back/src/modules/vibe/vibe.service.ts` |
| Vibe hidden diagnostics | Hidden-case failure detail is excluded using structural classification rather than a display-name convention. | `Back/src/modules/vibe/vibe.runner.ts` |
| Vibe AI | Stored model/system-prompt identity is used. The 60-second timeout, 8,192 output-token bound, SDK retry count 0 and existing request/concurrency quotas remain. | `Back/src/modules/vibe/vibe.ai.ts`, `Back/src/modules/vibe/vibe.service.ts` |
| Executor transport — retained inventory, not self-approval | Dedicated mode requires an HTTPS API, verified Redis TLS/mTLS and distinct credentials. There is no plaintext fallback or certificate-verification bypass. | `Judge/src/config.ts`, `Judge/src/worker.ts` |
| Executor configuration — retained inventory, not self-approval | UID/GID 1000:1000, read-only root, bounded tmpfs, internal sandbox network, host port/data/namespace exclusion and sandbox environment whitelist remain. | `Judge/deploy/compose.yaml`, `deploy/compose.yaml`, `scripts/check-executor-compose.mjs` |

The existing real-API regression source also contains unauthenticated access,
foreign-user selector, other-account data, private/draft visibility,
test/enterprise exclusion, withdrawn-account and caller-specific bookmark
checks: `Back/test/learning-dashboard.e2e-spec.ts`. This review **read those
tests; it did not rerun them**.

## Supply-chain and image-review implications

Comparison with the Phase II HEAD `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`
showed no change in:

- Any `package-lock.json`.
- Any Dockerfile.
- `Judge/runtime/`.
- `scripts/image-applicability-policy.json`.

The Learning/Vibe implementation therefore did not introduce new locked
dependencies or Runtime package changes. Back, Front and Judge application
contents did change, so fresh images and the exact final source HEAD still need
their own scans and CI. Unchanged Runtime source does not automatically attest
the bytes or findings of a new rebuild.

The retained image-gate meaning is:

- `scripts/image_gate.py` rejects raw scanner errors, end-of-support status and
  inconsistent evidence.
- `scripts/image_applicability.py` checks the current finding cohort, advisory
  fingerprints, file evidence and expiry.
- `scripts/image-applicability-policy.json` retains the expiry **2026-11-30
  00:00 UTC / 09:00 KST**.
- The preceding Runtime raw result of **HIGH 177 / CRITICAL 5** remains a
  separate component-applicability assessment; it must not be restated as zero
  raw vulnerabilities.

## Still-unverified operational boundaries

1. **The execution host and kernel remain unverified.** A privileged go-judge
   process that compromises its host can expose the co-located worker's
   API/Redis identities. Container network separation is not a VM boundary.
2. **Actual dedicated-host separation, firewall/egress rules, Redis ACLs, DNS,
   certificate provisioning and rotation were not performed.** Compose
   preflight validates declared configuration; it does not prove real routing
   or mounted-file readability.
3. **Vibe execution-host separation remains separate.** The dedicated
   algorithm-worker template does not automatically move the API's Vibe
   sandbox path.
4. **Content versioning differs from binary/provider equivalence.** Vibe
   snapshots bind task, files, checks, prompts and a model identifier, but do
   not freeze future runtime/compiler binaries or the provider's internal
   model implementation.
5. **Production migration readiness remains separate.** The migration refuses
   inconsistent historical model policy and provenance-losing rollback; that
   does not establish production data-distribution compatibility, lock
   duration, execution time, backup or recovery readiness.
6. **Learning bounds response size and the time window.** It does not impose a
   small upper bound on the number of submissions inside that window. This
   must not be presented as completed extreme-history/concurrent-load proof.
7. Existing AI quotas and error behavior remain, but new measurements of
   **real paid-provider behavior, cost and prolonged failures** are outside
   this review.

## Document timing and final disposition

`docs/overhaul/PHASE3-SECURITY.md` describes its implementation checkpoint. Its
final statement that Docker/native/image checks await CI is historical after
the coordinator's later PR #74 CI and integration receipt; it should not be
reinterpreted as a current failure. Final reporting should link the actual PR
#74 receipt and the later final-integration validation separately.

This is a cross-feature assessment of source controls and unverified
operational boundaries. PR #75 and final integration CI disposition must use
the coordinator's latest actual run records. This review does not independently
claim those later executions or replace exact-head CI.
