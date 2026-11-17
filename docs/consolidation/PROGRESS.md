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

## Source checkpoint before final CI

| Gate | State | Work remaining |
|---|---|---|
| G2 audit | COMPLETE, final-source QA pending | Six actual domain roles; source-backed findings and review boundaries in the audit records |
| G3 fixes | COMPLETE locally, real integration gates pending | Submission/community/Vibe actor admission, staff-target withdrawal, malformed-response cleanup, community/Settings/Vibe screen ownership; separate source/regression reviews passed |
| G4 evidence | SOURCE COMPLETE, final-run retention pending | Ten canonical documents, provenance, verified51-file relocation, policy-bound inputs and reproduction scripts retained; new run archive follows after execution |
| G5 validation | PENDING | New exact-source 12-job full CI, all real image/native/database/browser executions and independent assessment |
| G6 final PR | PENDING | One final open/unmerged PR against main; close superseded originals only after qualification |

The final source document deliberately does not predict its own CI result. The
post-run PR receipt and evidence-only archive supply G5/G6 disposition without
changing the already tested release HEAD. Any later code/document change on this
branch must receive a new complete run before acceptance.

## Completed independent patch checks

- Backend shared actor fencing: Security independently passed18 focused units;
  real PostgreSQL regressions remain mandatory in the final run.
- Vibe cleanup, principal admission and staff-target withdrawal: Security passed
  the final32 actor/cleanup units and independently replayed both target-deletion
  failures against the preceding source. Author's full Back check passed436 tests
  across33 files, lint, types and production build.
- Community/Settings: Performance independently reviewed the original Front
  changes and passed12 actual-component DOM cases. The final composed Front
  passed18 DOM cases across community, Settings and Vibe.
- Vibe start completion: coordinator independently read the immutable patch and
  passed all6 DOM cases. The first invocation used a wrong isolated dependency
  directory and failed before assertions; that log is retained, not counted as a
  product failure or hidden retry.
- Native Chromium could not start under local socket policy. No sandbox bypass
  was used. Browser discovery, jsdom and type checks are not browser execution.
- Controlled final Front subtree `df7596ff304e82efb122e7dbfa0c34f105bb9fcd`:
  total emitted JavaScript gzip grows197 bytes; no runtime speedup is claimed.

See [audit records](audits/README.md) and [PERFORMANCE.md](PERFORMANCE.md).

## First full-run failure and reviewed correction

Run43982539575 tested source9823070e8dfbf978b6e40394aaaa78ca09a909d5 through
checkoutb3e3bc385aae450cf388826466bc4371ca8bbaf4, tree1000f9a3b0b58ec342d19a4a5717aea8b3b0d81e.
Ten jobs succeeded, Runtime failed on exact advisory drift, and CI required failed.
Actual results included436 Back units,283 real PostgreSQL/API cases,137 Judge
units plus5 Python tests,90 native assertions including72 language/scenario cells,
36 pipeline tests,4 Compose browser tests and1,039 Playwright entries. These are
component observations from a failed qualification run, not final acceptance.

Thirteen existing Runtime records changed reference metadata; three also changed
Rocky vendor severity. The unchanged gate blocked all182 findings atomically.
The [new finite evidence proposal](evidence/runtime-revalidation/README.md) preserved
the failed artifact and prior policy. Its author independently collected current
primary data; separate QA and coordinator reviews then [approved its exact content](evidence/runtime-revalidation/ACTIVATION.md)
at immutable remote proposal05e98f7fb25a8eba7ff233872007387fa6a272b0.
All182 CNA bytes/maps, cohort IDs,990-file manifest and fixed expiry remain unchanged.
Fresh full CI on the resulting final source remains G5; original PRs stay open
until the final post-run receipt qualifies their replacement.

## Confirmed CI correction

The full-validation expression had no explicit final-consolidation branch policy.
A regression fixture for this branch targeting main failed before the change.
Both the image and suite selectors now always request full validation for this exact
branch/main pair, including documentation-only updates. Other branches retain their
existing policy. All original required jobs, failure gates, scan policy and expiry
remain in force.

## Archive path accounting correction

The new advisory evidence exposed a Git similarity heuristic: a deleted historical
receipt and a new proposed evaluation were classified as a rename. The checker now
uses `--no-renames` when enumerating historical deletions. A real temporary-Git
regression demonstrates that both the archived path and an undeclared deletion
remain visible even when normal Git detection reports R100. The original 51-file
manifest and all byte, hash, tree and link assertions are unchanged.

[Independent QA approved the immutable two-file change](audits/archive-checker/ARCHIVE-CHECKER-FIX-REVIEW.md)
at local commit `062a031b948f1bb2a6a5ece535405dba9d4dfaef`. Its published equivalent
is `251c7d0db091e147349ad39a93bba1dbb6d028b4`; both have tree
`48a49e1ccd9e381474f0e1efc937ffaf55279bf9`. The regression passed 2/2 tests, and
all 51 archived originals totaling 13,205,154 bytes passed independent verification.
This correction still requires the final full CI run on the integrated source.

## Resume rules

Read this document and the final PR's latest acceptance comment, then fetch live
main, branch and run state. Do not reset an existing branch or reuse historical CI
as final acceptance. If an execution is running, retain its run ID and exact source.
No main push/merge, deployment, production data operation, force push or paid
resource is authorized. Fixed Runtime review expiry: `2026-11-30T00:00:00Z`.
