# Image scanner and applicability gate composition

## Status

This is the orchestration layer for the
[exact-component evaluator](PHASE2-IMAGE-APPLICABILITY-EVALUATOR.md). Its author
kept the policy PROPOSED while implementing and testing the wrapper. In the
coordinator's composed candidate, the separate review transition
`9523ccdd3547f013935b853ddea296babe38278b` records Product's independent review
and the coordinator's approval of the unchanged exact component content.
The wrapper cannot create or extend that approval. The source/evidence scope,
182 individually enumerated records and 2026-11-30 expiry remain fixed.

The actual run43802320491 artifact was independently verified: all990 expected
file bytes matched. Its first evaluator execution remained BLOCKED_REVIEW with
all182 blockers; after the recorded independent approval, a separate evaluation
classified exactly those182 component findings. Both results and the untouched
raw177 HIGH/5 CRITICAL report are retained. This is not a clean raw scan, a host
kernel statement, or validation of the later image rebuilt by this workflow.

The new composed wrapper/workflow still requires independent source review and
actual exact-head full CI before integration. No prospective CI outcome is
claimed here.
## Routing and failure propagation

`scripts/image_gate.py` invokes the existing `scripts/image_audit.py` CLI with
its original four arguments. It adds no suppression/configuration flags and
does not change the scanner source, original report, original manifest, database
selection, library coverage or severity counts. It records the original process
exit explicitly as `rawScannerExitCode` in a separate `gate.json`.

| Raw scanner outcome | Required result |
|---|---|
| Exit 1, another unknown exit, signal, timeout, missing or inconsistent evidence | Failed gate; no applicability decision |
| Exit 0 with a completed, independently recomputed original PASS summary, coverage and provenance | `PASS_RAW_SCAN`; no applicability policy is invoked or reused |
| Exit 0 with a blocking summary, or exit 2 with a PASS summary | Failed gate because the process and evidence disagree |
| Any EOSL finding | Blocking gate before package applicability |
| Exit 2 for Back, Front or Judge worker image | Original blocking findings remain; no runtime policy is invoked |
| Exit 2 for runtime | Actual OCI payload verification, then exact-component evaluator; either stage can block |

A runtime exception path only returns success if the evaluator returns its
specific reviewed-component success contract: completed evaluation, valid
REVIEWED policy, all 182 reviewed decisions, the identical raw hash and summary,
zero remaining blockers, and no proposed decisions or blocking reasons. Its
`rawScannerExitCode` remains **2** and its raw summary remains
`BLOCKED_FINDINGS`; the separate reviewed decision is visible rather than
relabeled as a clean scan. Changed/missing/new/downgraded cohort entries,
proposed or expired review, changed file bytes or unverifiable provenance
continue to fail.

Raw PASS does not depend on the lifetime or presence of an applicability
approval: it represents the original scanner's clean threshold result and
uses no exemption. LOW, MEDIUM and UNKNOWN severities remain visible under the
existing scanner policy. Unknown approval/evidence states have a different
meaning and always block the applicability path.

The wrapper rechecks completed scan status, clean source commit, current
scanner-script/pin hashes, exact pinned executable, database and Java DB
provenance, observation freshness, build identity, original summary and actual
library coverage before routing an outcome. It uses a fresh clock after the
scanner finishes, so a long but bounded scan cannot accidentally use an earlier
evaluation time. The subprocesses are argument arrays without a shell, with
finite 1,200-second scanner and 210-second payload-command timeouts; the payload
helper retains its own 180-second internal resource bounds.

Reports must be written into a new directory outside the input OCI layout.
The wrapper never deletes an existing report or reuses its result. Separate
decision files are created exclusively, and raw report/manifest byte hashes are
rechecked after later stages to detect accidental mutation. Original raw
scanner artifacts are uploaded even when a gate fails.

## Workflow selection and evidence

The image job runs scanner and wrapper regression tests for each selected
image, plus the full verifier/evaluator tests for runtime. The wrapper command's
actual exit is the workflow step result. There is no `continue-on-error`, ignored
failure, or success overwrite. The existing required job depends on the image
matrix and retains failures/cancellations.

Full validation now requests **all four actual image builds**, including an
empty or documentation-only diff. The existing boolean full expression is
passed through an environment variable; PR text and labels are not interpolated
as shell source. Ordinary changes still use bounded path selection. Changes to
the common scanner, wrapper, applicability module, their tests or the policy
select all images. The wrapper uses the applicability module's JSON, identity,
timestamp and hash validators even on the ordinary raw PASS path, so that
module is a shared dependency. Runtime additionally selects on its verifier
and every committed applicability evidence file, the exact original runtime
ZIP, the package manifest and the source-evidence collector. A failed fetch
selects a build; a failed diff fails
the job rather than silently skipping it.

Artifacts retain `trivy.json`, its original `manifest.json`, scanner/database
logs, `gate.json`, and, when required, `payload-verification.json` plus
`applicability-evaluation.json`. The original counts remain available alongside
the separate decision and each source/report hash.

## Verification

Fifteen orchestration regressions execute the real raw validator and evaluator
against explicit synthetic subprocess outputs. They cover all four raw PASS
paths, all three non-runtime blocking paths, proposed and synthetic-reviewed
runtime paths, unchanged raw hashes/counts, unknown exits/signals/timeouts,
exit/summary disagreement, missing analyzer coverage, database/source mismatch,
EOSL, invalid/stale/changed/missing payload proof, policy expiry and new/changed/
missing/downgraded CVEs, output reuse and mutation of retained input bytes.
The accepted-review fixture is temporary and is not a repository approval.

The actual workflow selection shell is exercised for full validation on all
four contexts, every policy-bound evidence dependency, wrapper/scanner changes,
ordinary unrelated changes, unknown fetches, failed diffs and large diffs.
All **88 image Python tests** and **17 CI policy tests** passed before review.
The complete image suite also
includes the actual pinned helper → synthetic 990-file OCI → proposed evaluator
test and the independently observed real-image proposed evaluation described
in the evaluator document.

The initial combined run found one obsolete workflow-layout assertion in the
payload suite: it searched for the former separate payload step by name. The
test keeps its actual verifier/manifest path-selection cases and now requires
the explicit wrapper, payload/evaluator regression commands and failure-artifact
retention. No byte/control/ownership or rejection test was removed. The wrapper's
behavioral cases separately prove that a runtime raw exit 2 invokes the helper
and remains blocked under PROPOSED policy.

The wrapper's raw-evidence validator also read all four **actual retained**
reports from run `43802320491`; all four provenance/coverage validations passed.
Back, Front and Judge worker raw gates were PASS with zero HIGH/CRITICAL, while
runtime retained its 177 HIGH and 5 CRITICAL raw blockers. The per-report hashes
and exact scope are recorded in
[`actual-43802320491-raw-gate-validation.json`](measurements/phase2-image-applicability/actual-43802320491-raw-gate-validation.json).
This check did not launch a scanner, rebuild an image, or execute the new
workflow, and is not presented as a new scan result.

```sh
python3 -m unittest discover -s scripts -p '*image*test.py'
node --test scripts/ci-policy.test.mjs
```

Local Docker execution is unavailable. This candidate's new workflow must pass
the actual image builds and composed gate on its final exact commit before
integration; the earlier runtime artifact is not substituted for that result.
