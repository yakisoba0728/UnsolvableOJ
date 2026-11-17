# Phase V remaining external gates

## Scope of the handoff

Code integration readiness and operational deployment readiness are separate decisions. The final PR's immutable acceptance comment binds the actual source, current base, Actions checkout, Git tree, complete CI run and independent review. This file identifies work that those code and disposable-CI results cannot establish. It does not authorize a production operation.

The local and CI work used synthetic accounts, generated disposable database/project names, bounded execution and explicit cleanup. No production database, Redis instance, volume, key, certificate, host or paid provider was used. Existing PRs #63 and #86 remain subject to the owner's manual merge order.

## Accepted disposable CI checkpoint — PR91

[Run 43905864054, attempt 1](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054)
completed all twelve required jobs. The
[independent PR91 acceptance](evidence/reviews/backend-pr91-independent-review.json)
binds source `281d0f1a30cd772cf7417e3affb8c98be252f405`, checkout
`9aa843fad33b30270ab346bc62c4865c17697ff3` and tested base
`e8b08d6ab86181859d9491d15d1881a6b10262eb`. Integration merge
`a6588f7bedc87228c11852d8664fe20ec6b3ece3` retains the same complete tree,
`0f191c89a17b984cae8706cb02137ab0e4e2c3a4`.

Actual schema-2 Docker dump/restore and the bounded two-API native pipeline are
now **CI_VERIFIED and INTEGRATED**, with original reports and independent
receipts linked in [RELIABILITY.md](RELIABILITY.md), [DATABASE.md](DATABASE.md)
and [MULTI-API.md](MULTI-API.md). Earlier author checkpoints that awaited those
runs remain historical; they are not current unexecuted gates. The raw dump and
databases were not retained: the restore report retains archive size/hash,
table fingerprints and stage evidence. This accepted code/CI checkpoint does
not satisfy the production requirements below or pre-approve the later final
documentation/source commit.

## Disposition table

| Item | Disposition | Established evidence and remaining requirement |
|---|---|---|
| Dedicated execution host, kernel and VM isolation | **BLOCKED_EXTERNAL_ENVIRONMENT** | Repository/native tests exercise the existing isolated CI executor. Header-package applicability does not establish the host kernel's patch state. An approved dedicated environment must supply host/version inventory, supported patch evidence, isolation configuration and operational checks. No escape or host-privilege experiment was performed. |
| Deployed gateway, private networks, firewall and egress | **BLOCKED_EXTERNAL_ENVIRONMENT** | The Phase V fixture exercises actual nginx/mTLS/native transport inside its own disposable Compose project. It shares the already existing CI native executor and is not an independent production host or proof of production firewall/egress enforcement. Review actual deployed topology and negative network paths before release. |
| Operational certificate and credential rotation | **BLOCKED_EXTERNAL_ENVIRONMENT** | Fresh one-day fixture identities, hostname verification, missing-client/wrong-bearer rejection and exact service mounts test the contract. Real issuer ownership, issuance/renewal, revocation, overlap windows, secret distribution and expiry alerting require the authorized operator environment. |
| Production migrations and rollback | **BLOCKED_EXTERNAL_ENVIRONMENT** | PR91 actually passed the five migration-guard regressions, complete migration regression and [schema-2 dump/restore](evidence/backend-run-43905864054/phase4-restore.json): 31 migrations, 37 table fingerprints, the writer barrier, populated refusal, restored writes and cleanup. The learning-goal downgrade requires an active READ COMMITTED transaction, locks the table and refuses saved goals. Only the existing down() changes; up() and the 31-migration registration remain unchanged. Production data size, lock waits, active writers and retained evidence must still be assessed under the release runbook. Do not bypass refusal with an old binary or delete saved rows to force rollback. |
| Production backups, retention and RTO/RPO | **BLOCKED_EXTERNAL_ENVIRONMENT** | The accepted schema-2 synthetic archive/restore passed exact table/schema/ledger comparisons and owned cleanup; [independent checks](evidence/backend-run-43905864054/backend-independent-checks.json) bind the actual source and artifact. The 270,084-byte archive was used transiently and not retained. Its size/hash and finite synthetic-fixture timings are not operational RTO/RPO, offsite durability or retention proof. Approved production-like data, storage, writer discipline, restore access and retention ownership remain necessary. |
| Monitoring ownership, alert delivery and offsite recovery | **BLOCKED_EXTERNAL_ENVIRONMENT** | Assign on-call ownership, demonstrate delivery of backup-age and service alerts, and verify a decryptable offsite restore. The runbook specifies26-hour local and30-hour offsite backup-age alert conditions. This repository does not install an offsite-transfer service or alert-delivery system; documentation is not operational proof. |
| Sustained capacity and larger mixed-load qualification | **BLOCKED_EXTERNAL_ENVIRONMENT** | PR91's [actual two-API/eight-job run](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/docs/overhaul/phase5/evidence/backend-run-43905864054/phase5-multi-api.json) passed shared admission, native verdict, fencing/persistence and cleanup checks; its [independent acceptance](evidence/reviews/multi-api-pr91-actual-acceptance.json) preserves the one-host/two-worker scope. Earlier one-API campaigns retain their distinct protocols. These finite samples do not establish a maximum throughput, long-tail distribution, independent fault domain or saturation limit. A larger campaign needs approved dedicated resources, workload mix, stop thresholds and an operating budget; no shared runner was deliberately saturated. |
| Longer controlled editor sessions | **DEFERRED_NONBLOCKING** | The finite Chromium protocol records supported browser heap/EventTiming samples and real editor invariants with a mocked backend. It is a short lab observation. Hours-long editing and retained-object/leak investigations remain unmeasured. |
| Population field performance and user/device telemetry | **BLOCKED_EXTERNAL_ENVIRONMENT** | Field INP/LCP/CLS, real users and device variation require approved deployed telemetry and an actual population. Lab browser and mocked-backend observations do not establish those results. |
| Manual assistive-technology and physical-device validation | **BLOCKED_EXTERNAL_ENVIRONMENT** | Automated keyboard, focus, responsive/light/dark and browser-engine cases cover their exact tested paths. No manual screen-reader session, physical-phone campaign or complete WCAG certification was performed. The operator/product owner must arrange that distinct acceptance work. |
| Java hard-limit MLE and a complete signal taxonomy | **DEFERRED_NONBLOCKING** | The 72-cell native matrix preserves observed verdicts. Java's single over-allocation probe raises an explicitly checked Java heap OOM and remains RE before hard cgroup pressure; Python/JavaScript syntax cases remain RE. No arbitrary signal/RE was renamed MLE. A separate bounded protocol is needed to claim Java hard-limit MLE or every possible language/signal combination. |
| Paid provider behavior and quality | **OWNER_DECISION_REQUIRED** | The real browser fixture forces provider configuration empty; code grading and persisted unavailable-evaluation behavior are tested. Pipeline doubles cover the approved deterministic contract. No paid provider execution, model quality, external availability or spend was validated. |
| Repository license | **OWNER_DECISION_REQUIRED** | Dependency license metadata is inventory evidence, not a license grant for this repository. The copyright owner must select and authorize any repository license. No license was invented or applied. |
| Runtime review expiry or later evidence drift | **DEFERRED_NONBLOCKING while the exact review is valid; CI/integration and deployment blocking on expiry/drift** | Raw HIGH177/CRITICAL5 remain. The fixed expiry is **2026-11-30T00:00:00Z**. Any newly blocking finding, reviewed advisory change, mismatched payload/evidence or expiry must fail the strict gate. A later supported patch or new independently reviewed exact proposal is required; this phase grants no automatic renewal. |

## Release evidence required from the operator

Use [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md) for concrete preflight, writer drain, archive verification, isolated restore, migration ordering, rollback refusal, restart, certificate/secret rotation, monitoring and stop/go conditions. The runbook explicitly identifies manual drain/reconciliation and operational mechanisms that the repository does not automate.

Before deployment, the owner must verify that the chosen code source still has current full CI and an unexpired applicable Runtime decision. Recheck the live PR stack and merge **#63 → #86 → the Phase V final PR** in the documented order when their bases are unchanged. The Phase V coordinator only merged accepted feature PRs into `overhaul5/integration`; it did not merge this stack into `main` or authorize deployment.

Missing operational evidence must remain visible. A current-source test pass does not convert these items into production readiness, a vulnerability count of zero, a field-performance result or an unlimited-scale claim.
