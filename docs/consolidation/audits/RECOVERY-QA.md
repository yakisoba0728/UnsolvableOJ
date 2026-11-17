# Independent recovery QA

Scope: live read-only recovery and verification of historical Phase V evidence. This is **not** final consolidation acceptance and executes no application tests.

## Live baseline

| Ref | Observed exact SHA | State |
|---|---|---|
| main | 6176015b63a1615cc2269172f246725ef08abab3 | unchanged |
| PR63 / overhaul/integration | 3bcba380f92bd2da8973e6c88c00cd14b03be08e | open, non-draft, unmerged; base main |
| PR86 / overhaul4/integration | d0159b1f844bf0608415dded9e84af566c8e2041 | open, non-draft, unmerged; base overhaul/integration |
| PR92 / overhaul5/integration | e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5 | open, non-draft, unmerged; base overhaul4/integration |
| overhaul5/final-receipts | 752fbdb68f6216ccd85003c77e71d1429689c015 | evidence-only archive |

Search returns only PR63/86/92 as open and no consolidation PR or branch. Formal GitHub review lists on all three PRs are empty; recorded historical independent reviews are AI engineering comments and committed receipts, not human GitHub approvals. Do not claim protected branch configuration without a fresh branch/ruleset API read: this agent did not retrieve those endpoints.

GitHub compare main…PhaseV reports ahead116/behind0, merge base main6176015. Its changed-file list returns300 records, so it cannot establish full preservation; coordinator must use Git objects for complete inventory.

Latest checkpoint URLs:
- https://github.com/yakisoba0728/UnsolvableOJ/pull/63#issuecomment-6912127737
- https://github.com/yakisoba0728/UnsolvableOJ/pull/86#issuecomment-6914629778
- https://github.com/yakisoba0728/UnsolvableOJ/pull/92#issuecomment-6924097627
- https://github.com/yakisoba0728/UnsolvableOJ/issues/72#issuecomment-6924128046
- https://github.com/yakisoba0728/UnsolvableOJ/issues/87#issuecomment-6924127595

The checklist in Issue72/87 original bodies is historical. Latest comments complete the historical work. Their stacked manual order is superseded only once the new main-based PR passes its own full validation; old PRs must remain open until replacement is proven.

## Historical run/evidence rechecked

Run43913852145 remains completed/success, all12 jobs success. Actual required step metadata includes four real image builds/scans; Backend/API; native/pipeline/Compose; Chromium/WebKit/Firefox. Only conditional failure diagnostics and duplicate frontend build are skipped.

Re-downloaded all12 decoded GitHub job logs. Every byte matches the archive ZIP exactly (1,595,099 bytes total). Eleven checkout jobs contain actual checkout70307b3d3c7c9591ee3822e4b5ab903d3527f1b1; the aggregate job has no checkout. Test summaries re-observed: Backend392, PostgreSQL/API261, Judge137 +Python5, native90, pipeline36, Compose4. Browser summaries403+402+87+87=979 entries;85 browser-free units are included, leaving894 browser executions.

Rehashed all268 files in archive retained-files.json:27,411,431bytes, zero hash/size failures. All15 retained original final-run ZIP digests and byte lengths match current live GitHub artifact metadata. Five Docker build-record artifacts are additionally returned by the API and are not part of the15 retained test/scan ZIP claim. Full check details are in recovery-verification.json; raw snapshots are alongside it.

Historical raw Runtime counts in this final run: UNKNOWN1/LOW363/MEDIUM560/HIGH177/CRITICAL5 (the earlier Phase II/III MEDIUM561 is a different checkpoint). Reviewed182 high/critical applicability records and990 payload files do not mean patched findings. Exact expiry remains2026-11-30T00:00:00Z; current scan drift must block, not silently reuse the receipt.

## CI and cleanup constraints

New consolidation head is not explicitly in the current FULL branch selector. Apply full-validation label or explicit consolidation/main selector and test it. Preserve12-job coverage for every final exact-source push; ordinary docs-only selection can otherwise skip required final scope. Source changes in the whole initial diff will select full but this is not a durable policy guarantee.

Do not remove these policy evidence inputs:
- `docs/overhaul/phase5/evidence/security/kernel-header-applicability.json`
- `docs/overhaul/phase5/evidence/security/kernel-header-review.json`
- `docs/overhaul/evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json`
- `docs/overhaul/phase5/evidence/security/blocked-runtime.zip`
- `docs/overhaul/evidence/phase2-trivy-fingerprint-binding.json`
- `docs/overhaul/phase5/evidence/security/inherited-policy.json` (historicalPolicyPath)
- `docs/overhaul/measurements/phase2-image-remediation/before-{back,front,judge,runtime}.zip` (image-gate regression fixtures)
- `docs/overhaul/repro/kernel-header-applicability.py` and `phase3-refetch-cna-independent.py` (reproduction/policy provenance)
- Current scripts/image_gate.py, image_applicability.py, verify_image_payload.py and associated tests/policy JSON; inspect complete repository references before cleanup.

Preserve historical adverse evidence: failed43884655462 (Runtime drift),43897227270 (invalid workflow/zero jobs),43898203434 (17 Git-provenance failures), and corrections. Preserve source-pinned original records rather than rewriting them as current checks.

## Remaining limits

No final consolidation CI or independent acceptance yet. Operational host/kernel/network/certificates, production migration/restore/RTO/RPO, field Web Vitals, physical-device/screen-reader coverage remain external. Longer-editor/Java-signal work is deferred; paid provider quality and license grant remain owner decisions. No new confirmed code defect is asserted by this recovery pass.

No source edits, GitHub mutations, branch changes, deployments or paid resources were performed by this agent.
