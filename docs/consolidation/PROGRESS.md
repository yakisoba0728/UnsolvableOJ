# Final consolidation progress

This is the canonical restart checkpoint for the final `main`-based consolidation.
It supersedes historical phase instructions only for this consolidation effort.
Code disposition: **IN_PROGRESS**. Deployment: **BLOCKED_EXTERNAL_ENVIRONMENT**.

## Recovery and source preservation

- G0 **PASS**: live repository and PR metadata read; no prior consolidation PR existed.
- `main`: `6176015b63a1615cc2269172f246725ef08abab3`.
- Original PRs #63, #86 and #92 are open and unmerged. Keep them open until their replacement passes full CI and independent review.
- Original Phase V source: `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`.
- G1 **PASS**: all original ancestry checks passed, 116 commits ahead / 0 behind main. Squash source commit `c3367954cf55584d3007ebe33c1c13aa9d6eed70` has exactly the original complete tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` and parent main. No file, mode, migration or test omission can exist between identical complete Git trees.
- Dedicated branch: `consolidation/unsolvableoj-final-overhaul`. Only the coordinator publishes this branch.
- Historical final evidence archive: `752fbdb68f6216ccd85003c77e71d1429689c015` on `overhaul5/final-receipts`.
- Independent recovery rechecked all 268 retained-file hashes/lengths (27,411,431 bytes), all 12 job logs (1,595,099 bytes), and 15 retained artifact ZIP digests. Zero mismatches. Historical results do not qualify the new source.

## Active work

| Gate | State | Work remaining |
|---|---|---|
| G2 audit | IN_PROGRESS | Frontend, Backend/DB and Judge/Vibe isolated reviewers; infrastructure/security and measurement review follow within the three-worker limit |
| G3 fixes | IN_PROGRESS | Reproduce source-backed ownership/revocation/cleanup defects, implement focused fixes and verify regressions |
| G4 evidence | IN_PROGRESS | Canonical documents; preserve immutable original bytes before any selective raw-data removal; keep policy-bound inputs and reproduction scripts |
| G5 validation | PENDING | New exact-source 12-job full CI, all real image/native/database/browser executions and independent assessment |
| G6 final PR | PENDING | One final open/unmerged PR against main; close superseded originals only after qualification |

## Confirmed CI correction

The full-validation expression had no explicit final-consolidation branch policy.
A regression fixture for this branch targeting main failed before the change.
Both the image and suite selectors now always request full validation for this exact
branch/main pair, including documentation-only updates. Other branches retain their
existing policy. All original required jobs, failure gates, scan policy and expiry
remain in force.

## Resume rules

Read this document and the final PR's latest acceptance comment, then fetch live
main, branch and run state. Do not reset an existing branch or reuse historical CI
as final acceptance. If an execution is running, retain its run ID and exact source.
No main push/merge, deployment, production data operation, force push or paid
resource is authorized. Fixed Runtime review expiry: `2026-11-30T00:00:00Z`.
