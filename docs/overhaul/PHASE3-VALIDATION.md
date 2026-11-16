# Phase III validation receipts

This document records observed execution, not planned success. Component reports
preserve their implementation checkpoints. Later accepted PR receipts supersede
their pending-CI paragraphs. The newest final PR63 receipt supplies the final
integration commit and CI after this document itself is merged.

## PR77 recovery — dependency state observed at 2026-11-16 08:31 UTC

The observations below distinguish the original failed run from the accepted
Runtime response and the refreshed database candidate. They do not certify a
new PR77 source.

| Scope | Source / actual checkout | Observed result |
| --- | --- | --- |
| Original PR77 | `e23729640b0ce18b6bb5ab82c578dc1eb35c7392` / `9e4ce9df2aa4338a99a8deb7f32e161458a39a04` | [43823181757](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43823181757): 10 successful jobs, Runtime and aggregate failed. Compose and the browser artifact succeeded. |
| Accepted Runtime PR78 | `031275ebcc949514c9721c1d531a5edd90f2ec50` / `a63642e623982cf7d3a10527708c5217634bf10f` | [43828449988](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43828449988): all 12 successful; merged as `f52c7d0aecfb6ae98329d219110eac526bb0dbcb`. |
| Refreshed database PR76 | `6143d7ccd982d42e035db01edee0f1353ad55a21` / `dcd1f30c6028020ddeb320fc1023088a62164386` | [43830226504](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43830226504): all 12 successful; still OPEN / UNMERGED at this observation. |

Original PR77 logs show 327 Back units, 243 real PostgreSQL/API cases, 137 Judge
units, 74 native assertions, 33 pipeline cases and 3 Compose flows (37.7s).
Browser shard totals are 359+359 and 66+65 Firefox entries, including the
85 browser-free units; they are not 849 unique browser stories. The Runtime
failure did not prevent these jobs from running. The accepted PR78 security
run belongs to its own source and does not substitute for PR77's final CI.

Checkpoint `0cc65a2702f5b1e44c2c678dd5b4f2340adcbda3` is now included in PR77's
recovery work. Its original raw browser bytes and reviews remain unchanged.
The separate [browser recovery review](evidence/phase3-browser-recovery-review.json)
and [CI history audit](evidence/phase3-validation-recovery-ci-audit.json) record
what was rechecked. The original browser report is still bound to the original
failed workflow, not relabelled as a fresh or accepted measurement.

Local recovery checks on checkpoint `0cc65a2` passed all 63 existing CI/Compose
policy tests and Front E2E TypeScript. Playwright discovery lists the original
three live tests; it is not a browser run. An initial discovery invocation was
correctly rejected because disposable-stack configuration was absent. A second,
discovery-only invocation used an inert loopback URL and a disposable project
name; no test body, database or browser was started. The
[policy log](evidence/phase3-recovery-policy.log),
[typecheck log](evidence/phase3-recovery-e2e-types.log),
[initial discovery guard](evidence/phase3-recovery-discovery-guard.log) and
[configured discovery](evidence/phase3-recovery-discovery.log) retain those results.

**BLOCKED_ON_PR76:** final PR77 acceptance requires the actual PR76 merge SHA,
current integration ancestry, preservation of both ordered migrations and PR78,
an author-separated composition review, and all required jobs on the resulting
exact HEAD. A pending or successful pre-dependency run does not satisfy this
condition. Final PR63 verification remains the separate C owner's responsibility.

## Recovery and accepted feature gates

Recovery confirmed Phase II's final run43809685401 on source45b6c9c6/tree141e2df9,
with all12 jobs successful. Back320/API209/Judge107/native74/pipeline28/Compose3
and707 browser +85 browser-free instances were independently read from logs.
Those results are historical baseline evidence only.

| Feature | Accepted source | Exact tree | Actual Actions checkout | Accepted full run |
| --- | --- | --- | --- | --- |
| Learning73 | `b09d2289e2645334070f0d067e6f8dfdef5aac49` | `b3def644fea449bb8518290db72132071d23420f` | `7d4da02ada94d10f76f16fa8d3ff678fe978c124` | [43816883930](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43816883930),12 success |
| Executor74 | `dfcf742963f7dde8d6a5ba72edc3dec1f0b7d96b` | `54394f9af541764214155e9b44d1122965933bac` | `627d72067ff9348b49ab59f3efb1eb791e162ce6` | [43818814392](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43818814392),12 success |
| Vibe75 | `8e640b90709d37f979f4208c186c25440b96514f` | `fe0ab0e3ccac59f3583cb493845403c5d1578d39` | `a2ce8848b16efc3862e3f9bd1ef85bd1d9b84ed7` | [43821157776](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43821157776),12 success |

PR75 was tested on current integrationa30b0b3 after the executor merge. Its actual
logs show327 Back units,230 PostgreSQL/API cases,74 native assertions,33 pipeline
cases (including5 new Vibe cases), and3 production Compose browser flows (30.4s).
Browser shards show359+359 standard instances and66+65 Firefox instances:
849 total =764 browser executions +85 browser-free units. They are not849 unique
stories and do not imply three-engine coverage of every route. Worker, actual
Redis TLS/BullMQ, dependency audits and all four image gates completed successfully.

The native HTTP Vibe case keeps real HTTP/API/PostgreSQL/runner/sandbox/result
persistence, replacing only paid AI evaluation. Four other new native cases cover
selected fixtures, structural hidden-diagnostic suppression and compile/runtime
errors. This is distinct from a full browser-native Vibe E2E.

## Historical database candidate and first final-evidence execution

PR76 source`e3aa50c4cdcadaa0dd965a29086c0148b79261a8`, tree
`483d4e29db0274b07fc46decf62e4bc1f8a412b0`, includes integration87cc1e7.
Run[43822819719](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43822819719)
completed all12 jobs successfully at actual checkout
`257e795ca89f1c1a425ed54d8150db009c65a65b`. Logs show327 Back units,243 API cases,
74 native assertions,33 pipeline cases and3 Compose flows(32.9s). PR76 remains
unmerged while a subsequently observed Runtime advisory change is revalidated.

Its same-tree local composition passed327 units,243 real PostgreSQL/API cases
in40files and the full migration chain. The two migrations are registered once
in chronological order. The separate reviewer verified13 DB files and60 incoming
Vibe/executor files, with only the datasource union changing an overlapping blob.
The exact benchmark implementation hashes remain unchanged.

[Combined check](evidence/phase3-database-combined-check.log) ·
[API243](evidence/phase3-database-combined-api.log) ·
[migration execution](evidence/phase3-database-combined-migrations.log) ·
[independent composition](evidence/phase3-database-composition-review.json)

The final evidence branch adds a bounded actual-Compose browser measurement.
Its protocol, numeric-only projection, artifact failure behavior and retained
functional assertions were independently reviewed; Front E2E types and policy
checks passed. PR77 source`e23729640b0ce18b6bb5ab82c578dc1eb35c7392`, tree
`0e90a39685e1246c8f9a3ab1637fc0c89b4d85e7`, actual checkout
`9e4ce9df2aa4338a99a8deb7f32e161458a39a04`, executed the probe in
[run43823181757](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43823181757).
Its Compose job passed3 flows(37.7s), and the complete3-visit/15-interaction report
was downloaded with its GitHub ZIP digest verified. The raw report and provenance
are in [browser performance](PHASE3-BROWSER-PERFORMANCE.md). This run failed the
Runtime image job and dependent required gate; its successful browser measurement
does not make the overall candidate accepted. The final evidence PR must
incorporate accepted security/DB integration and run fresh full CI before its own
merge, followed by the final PR63 integration-head run.

## Historical Runtime advisory block — resolved separately in PR78

Run43823181757 correctly rejected reuse of the prior exact applicability approval:
`EXACT_CVE_COHORT_REVALIDATION_REQUIRED`. Its newer Trivy DB, updated07:10:39UTC
(accepted prior DB01:11:02UTC), changed16 HIGH/CRITICAL advisory fingerprints.
Raw HIGH177/CRITICAL5 and the990-file payload match remained the same. Initial
comparison isolated References plus three AlmaLinux vendor-severity fields; these
facts did not authorize bypassing the exact gate. A separate source-bound primary
advisory revalidation was subsequently reviewed and accepted in PR78. Historical
Phase II evidence, strict fingerprinting and the existing November30 expiry must
be retained. Both pending merges were held until that work passed fresh full CI;
the current dependency gate is recorded above.

## Regression and failure evidence

CI caught duplicate learning GETs under development StrictMode and invalid focus
fixtures. The former was reproduced with the real application under StrictMode;
the latter now enters actual keyboard mode before checking the same outline.
Original one-request/focus assertions remain. Real rendered Compose then exposed
canonical decimal byte strings and absolute secret targets; strict equivalent
forms were added while invalid cases remained rejected. Independent inherited-name
secret probes caused a further own-property correction.

Local build/seed races were corrected by ordering the build before API runs.
One unchanged full Vibe run timed out in five existing Missions cases; the same
file then passed24/24 and the full suite222/222 without changing assertions or
timeouts. The reviewer overlong-username fixture and the benchmark pre-start
ENOSPC failure are preserved, not counted as product fixes or measured samples.
[Audit register](PHASE3-AUDIT.md) and [review ledger](PHASE3-REVIEW.md) link details.

## Execution boundaries

Local Docker was unavailable, and local Chromium failed before app launch with
Unix socket EPERM. No sandbox control was bypassed. Actual native, images and
three-engine browser gates use the authorized disposable GitHub Actions setup.
Local DB/Redis runs used owned temporary clusters and random loopback ports.

No new long soak, prolonged network-fault campaign, VM/host-kernel attestation,
all-language/all-verdict memory certification, production rollout/restore or paid
AI evaluation was executed. The retained recovery pipeline still exercises its
existing worker/lease/API/Redis/rejudge scenarios on changed code; that is fresh
regression coverage, not a new long-duration reliability result.

Runtime raw HIGH177/CRITICAL5 remain separate from component-applicability
decisions and their2026-11-30 00:00UTC expiry. Fresh final image scans and payload
checks are mandatory; no existing exemption date or scanner failure gate changed.
