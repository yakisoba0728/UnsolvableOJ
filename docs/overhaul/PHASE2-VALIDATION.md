# Phase II validation evidence

This is an execution ledger, not a claim that every requested state has been covered. The current integration history and exact source/run/merge mapping are in PHASE2-PROGRESS. A source review, test discovery, a local API execution and actual Actions browser/native execution are different evidence classes.

## Completed component gates

PRs #64, #66, #65, #67 and #69 each passed independent source review and all 12 jobs of their own exact-source-head run before integration. PR #69's final full run [43798756788](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43798756788) directly showed FULL=true, 299 Backend units, 204 actual API cases, 74 native runtime cases, 26 pipeline cases and 2 real Compose browser flows. Standard browser/unit projects passed 338 cases per shard; Firefox added 55 per shard. WebKit's enterprise-results cases are present in the actual second-shard log. These counts describe that head, not later verification changes.

The earlier PR #69 run 43797162669 succeeded overall with a skipped native job and without full Firefox/WebKit selection. It was rejected as sufficient integration evidence. Positive label opt-in was added and independently reviewed; the later full run above supplied the missing evidence.

## Combined verification candidate, before Actions

Application composition independently reviewed at local `3d43b4dde170266a22e2a49043ba66c3919ce936`; its documentary successor was merged with actual integration `e97b08a238798f740438118818d8dd75e68173d8` without changing the reviewed combined tree. The only merge conflict was the Firefox file list: both enterprise-results and enterprise-pinned-summary checks were retained. The resulting tree identity was asserted before the merge commit.

| Check actually executed | Result and environment | Limit |
|---|---|---|
| Back lint/types/build/units | 320 units in 24 files passed; Node 24.22.1, npm 11.9.0 | Does not execute native sandbox |
| Full actual PostgreSQL API suite | 209/209 in 35 files; 80.18 seconds; owned PG 17.11 and Redis 8.10.3 on loopback | Synthetic disposable data; no production load |
| Front check | Build, source/test types and seven telemetry/privacy cases passed | Local browser socket setup is unavailable |
| CI/SBOM policy checks | 17/17 after label + complete-audit changes | Shell/contract tests, not a substitute for GitHub execution |
| Independent React DOM probes | Ownership 2/2, form refresh 1/1, result paging/retry/reset/shrink assertions all passed | Actual React under JSDOM with synthetic API; no browser/layout claim |
| Four enterprise browser spec discovery | 69 instances registered across Chromium/Firefox/WebKit | Discovery only; exact-head browser run required |
| Complete and production npm audits | Zero findings for each of Back/Front/Judge, six scopes; raw dated evidence retained | Actual shipping images have separate findings |
| Owned recovery fixture safety | 18 cases reject unsafe database/resource inputs before connection and preserve ownership | New actual Redis daemon/rejudge scenarios still need native CI |

[Independent composition record](evidence/composition-review-3d43b4d.json) embeds the observed DOM outputs and head/base. The candidate submission title regression first failed against the earlier source, then passed in both coordinator and independent review worktrees; raw before/after logs are preserved. The owner selected-problem API includes real concurrent version-refresh and current-private-source cases. The full exam browser flow uses actual API/Judge data and no mocked responses, but its implementation is not counted as execution until Actions succeeds.

## Reliability coverage accounting

Already executed on integrated Judge heads: real worker SIGKILL and natural 60-second lease, worker connection interruption/reconnection to Redis and API, actual API-process SIGKILL/replacement, concurrent duplicate delivery, terminal duplicates and stale callback fencing, with XP/solve/learning/notification checks. Existing normal shutdown behavior remains covered by worker tests and Compose lifecycle.

The new follow-up is distinct: clean restart of an exactly owned Redis daemon/AOF volume under a small mixed-language queue and interruption during an already accepted submission's rejudge. It has bounded time/resources, unique generated data ownership, no lease timestamp editing and explicit final data assertions. No success is claimed before actual execution. Multi-hour chaos, abrupt host-power-loss/AOF durability, a full runtime-by-verdict memory matrix and production-host isolation remain unverified.

## Performance evidence and gaps

PHASE2-PERFORMANCE and PHASE2-RESULTS contain fixed source hashes, environments, bounded workloads, raw outputs, repeated ranges and limitations. Results API comparisons preserve whole-test statistics and the first 50 rows while intentionally changing response size. Judge 1/2-worker trials are same-implementation scaling observations, not a Phase I/II optimization. Worker procfs CPU/RSS excludes compilers/executor. Small-sample p99 is the maximum. Index read gains are paired with measured insert/WAL/storage costs. Frontend sizes are artifact sizes; field LCP/INP/CLS, sustained RPS, lock waits under realistic write load and long-running memory behavior remain N/A.

## Image and final gates

Initial image run 43796045174 completed all four scans and correctly failed on HIGH/CRITICAL findings. Patchable package/toolchain issues have a reviewed candidate; exact image bytes/native behavior and residual kernel-header applicability are separate gates. Image build success and clean npm audits cannot clear these findings. Raw scans, immutable image/source identity, database freshness and all severities are preserved.

After pending candidates pass and are integrated, run full CI at the final integration HEAD, update this ledger with the exact evidence, and update PR #63. Until then, this document does not declare final merge readiness or deployment readiness.

## Completed combined verification gate

PR #70 source `d5dc5a9cfa627a505efeeac6458a7d9556b71e06` passed all12 jobs in
[43800127993](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43800127993)
against base `e97b08a238798f740438118818d8dd75e68173d8`, then integrated as
`e7caa9b3aa23ac051e3a786780bc3b8c0780affa`. Backend320 units and actual API209
passed in Actions. Native74, pipeline28 and all3 real Compose browser flows
passed, including the new real exam/Judge flow. Six complete/production npm
audits reported zero findings. The Front logs contain85 browser-free unit
instances plus372 Chromium,111 Chromium-slow,112 WebKit and112 Firefox cases:
707 actual browser instances,792 total. No retry-only/flaky success was reported.

The previously pending pinned-summary, owned Redis restart and interrupted
rejudge cases have now actually executed. The raw artifact and exact job/source
identities are retained under evidence/judge-run-43800127993. This certifies that
component combination, not the subsequently rebuilt runtime image or final
integration HEAD. Those still require their own observed gates.

## Accepted shipping-image and combined runtime gate

PR #68 source `0e70a2fe6d725362bcb248836c3697d310e16742`, actual checkout
`71370b28d8a30d3ac79cf18de5facd291b6447d2`, and source/checkout tree
`f302cef7d2459736d3810ee930f1c9e63662ed65` passed all12 jobs in
[43805214804](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43805214804).
The current base was `e7caa9b3aa23ac051e3a786780bc3b8c0780affa`; integration
`bfb6adaa28d5d99d34d6bc8051f06fe1aa0c6ee3` has the same accepted tree.

Product, Judge and coordinator independently checked the actual job results
and public Git identities before merge. Back320, API209, Judge107, native74,
pipeline28, Compose3, browser707 and browser-free85 all passed. Six npm audits
reported zero findings. The runtime image job executed88 evidence/gate tests
and generated the actual505-package Go closure with no OpenPGP import.
Back/Front/Judge pass the unmodified raw image scanner. Runtime preserves raw
exit2,177 HIGH and5 CRITICAL, with the separate reviewed182-record decision
and990-file actual-OCI proof. Host readiness is UNVERIFIED.

The final raw image ZIPs/independent QA are retained under
[evidence/images-run-43805214804](evidence/images-run-43805214804/provenance.json);
the rebuilt runtime's original recovery ZIP and four JSON records are under
[evidence/judge-run-43805214804](evidence/judge-run-43805214804/provenance.json).
These observed results supersede the earlier image-candidate pending entries,
while preserving their historical failed attempts.

The final documentation PR still receives independent review and full CI;
after integration, the post-merge integration HEAD is checked separately.
The final verification receipt on PR #63 records those exact head/tree/run
identities and any failure. This document cannot predeclare that later result.
