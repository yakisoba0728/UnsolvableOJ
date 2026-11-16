# UnsolvableOJ Phase V final engineering handoff

**Final code decision: READY_FOR_MANUAL_MERGE.** [PR #92](https://github.com/yakisoba0728/UnsolvableOJ/pull/92) is OPEN, ready for review and UNMERGED. All twelve required jobs in [final run 43913852145](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145), attempt1, actually completed successfully at the exact source/base/tree below. Independent whole-run and security reviewers accepted that execution with no blocking findings in the tested scope.

**Operational deployment: BLOCKED_EXTERNAL_ENVIRONMENT.** This code decision does not authorize deployment or certify a production host, network, certificate operation, backup or RTO/RPO. The fixed Runtime review expiry and remaining operator gates still apply.

This is the completed post-run report copy on the evidence-only archive branch. The tested release source remains `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`; the archive is not an additional release-code change or a PR to merge. The original pre-run source report and all failed/historical receipts remain preserved in Git.

## Final exact-source acceptance

| Binding | Verified value |
|---|---|
| Final source / branch | `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5` / `overhaul5/integration` |
| Current base / branch | `d0159b1f844bf0608415dded9e84af566c8e2041` / `overhaul4/integration` |
| Actual Actions checkout | `70307b3d3c7c9591ee3822e4b5ab903d3527f1b1` |
| Equal source and checkout tree | `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813` |
| Checkout parents | `d0159b1f844bf0608415dded9e84af566c8e2041`, then `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5` |
| Final CI | [43913852145](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145), attempt1;12 completed successful jobs |
| Whole-run independent receipt | [JSON](evidence/reviews/final-pr92-independent-review.json), SHA256 `70f6f4489b0f355691c64158043f254aaa7ddb8f955b02fd32e7e09ff6d5144b` |
| Separate security/native receipt | [JSON](evidence/reviews/final-pr92-security-acceptance.json), SHA256 `631c04e5e5954ed9a12a8d2a3c94deb0726e7cf2bbdf7197757e4643f0c0dc2a` |
| Final source-document review | [JSON](evidence/reviews/final-docs-independent-acceptance.json), SHA256 `ad50b1a3947b949824b3db02efa877f12e35af29a55d291efdb6affb82a00494` |
| Protected live-state read | `2026-11-16 17:27:25 UTC`; main/#63/#86 unchanged, #63/#86/#92 OPEN/UNMERGED |

| Required job | Exact job ID | Actual conclusion |
|---|---|---|
| Detect changes | [133462613274](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462613274) | SUCCESS |
| Docker image (judge) | [133462613610](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462613610) | SUCCESS |
| Docker image (runtime) | [133462613878](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462613878) | SUCCESS |
| Dependency audit | [133462613893](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462613893) | SUCCESS |
| Docker image (front) | [133462613974](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462613974) | SUCCESS |
| Docker image (back) | [133462614697](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462614697) | SUCCESS |
| Sandbox, pipeline and Compose | [133462777184](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462777184) | SUCCESS |
| Backend and API | [133462777250](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462777250) | SUCCESS |
| Browser tests (1/2) | [133462777344](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462777344) | SUCCESS |
| Judge worker | [133462777373](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462777373) | SUCCESS |
| Browser tests (2/2) | [133462778158](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133462778158) | SUCCESS |
| CI required | [133474126427](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/job/133474126427) | SUCCESS |

The [final acceptance JSON](evidence/final-acceptance.json), [complete final metadata](evidence/final-run-43913852145/final-metadata.json), [original artifact map](evidence/final-run-43913852145/downloaded-artifacts.json) and [decoded-log bindings](evidence/final-run-43913852145/decoded-log-bindings.json) retain the raw provenance. All15 selected original ZIPs match GitHub artifact digests and sizes. Twelve decoded logs are retained in a separate ZIP after explicit credential-retention review; the bindings describe their exact encoding scope.

Actual final execution passed **392 Backend unit tests**, **261 real PostgreSQL API tests**, **137 Judge worker tests**, **5 Python runtime checks** (one health/four Go-package-graph), **90 native tests** including their parent, **36 pipeline cases**, **979 ordinary Playwright entries** (894 real-browser cases and85 browser-free units), and **4 real Compose browser flows**. The72 recorded native matrix rows are not an additional72 tests. The final DB qualification passed7 workloads; schema2 restore passed31 migrations/37 table fingerprints, writer refusal, saved-goal rollback refusal, restored writes and owned cleanup.

There were no failed, cancelled or skipped required jobs in this final run. Browser retries remain0; conditional failure-only artifact steps and the duplicate Front build omission on shard2 are not skipped application suites. Earlier failed source runs and local baseline exclusions remain separately recorded below. The final run's raw measurement values remain source-bound; the detailed selected performance observations later in this report still refer to their explicitly named feature runs.

## Decisions and scope

The final decision applies to the reviewed code stack and its disposable validation environment. Operational deployment remains blocked on the specific operator evidence in [REMAINING-EXTERNAL-GATES.md](REMAINING-EXTERNAL-GATES.md). The owner retains manual control of PR #63, PR #86 and the final Phase V PR. The order is **#63 → #86 → Phase V**, followed by revalidation against any changed base. No protected branch, production resource, operational secret, paid provider or production execution host was modified.

This increment extends the accepted Phase IV source `d0159b1f844bf0608415dded9e84af566c8e2041`, tree `f12f6c377ea07f0cb4b498ca0fe5889ed4401a66`. It reuses the existing product, execution and recovery contracts. The new product corrections are shared date/time focus restoration, stable same-owner goal content during refresh, and saved-goal preservation during downgrade. Qualification adds real native memory/verdict evidence, an actual dedicated Vibe browser path, deeper database/authorization cases, a bounded two-API protocol, richer restore fixtures and source-bound browser observations.

The DB/API and reliability sources were combined in PR91 after separate independent reviews, so their common PostgreSQL, migration and restore paths are validated together without an additional duplicate full-CI campaign.

The phase created six distinct workers (Frontend, Judge, Database, Security, Reliability and Independent QA), with at most three workers active alongside the coordinator. Follow-up turns reused those workers. Implementation, review, native execution, current-base full CI and integration were separate gates.

## Final scope matrix

Percentages are the coordinator's **subjective estimates of the stated Phase V goals**, not objective product completion, coverage, pass rates or security scores. There is no weighted aggregate. The estimates include the explicitly unverified scope below; final code acceptance is supplied by the exact-source receipt above.

| Area | Final status / subjective estimate | Completed evidence | Limit or remaining requirement |
|---|---|---|---|
| Frontend UX / a11y | INTEGRATED / 90% | 30-module/36-top-level-route inventory; shared focus and refresh fixes; new three-engine responsive cases; real editor invariants | Manual assistive technology, real devices and complete site-wide WCAG certification are not established |
| Product | INTEGRATED / 90% | Existing student, author, enterprise and administrator journeys retained; two concrete shared UX defects fixed | No speculative feature expansion or claim that every role/state combination was manually audited |
| Judge / verdict matrix | CI_VERIFIED, INTEGRATED / 95% | 72 observed language/scenario cells; 90 native assertions including parent; source and cleanup binding | Java heap OOM remains RE; complete signal taxonomy and a hard-limit Java MLE trial remain separate |
| API / DB | CI_VERIFIED, INTEGRATED / 95% | Deep-page/CSV ownership and revocation, actual PostgreSQL regressions, seven bounded data workloads and exact oracles | Query qualification is not production throughput or a demonstrated optimization |
| Runtime security | INDEPENDENTLY_REVIEWED, CI_VERIFIED / 85% | Four actual image scans, current advisory/CNA/payload matching, independent applicability review and strict expiry | Raw HIGH177/CRITICAL5 remain; no host-kernel patch claim; review expires November30 |
| Vibe gateway | CI_VERIFIED, INTEGRATED / 95% | Browser → real API → repository nginx/mTLS → existing native executor → persisted assessment; negative transport probes | Production gateway operations, rotation and paid-provider quality require separate authorization/evidence |
| Resilience | CI_VERIFIED / 90% | Actual finite API/Redis/worker/rejudge recovery and generation/duplicate invariants | Clean Redis AOF restart is not a power-loss test; no long chaos campaign or independent fault domain |
| Migration / backup / recovery | CI_VERIFIED, INTEGRATED / 95% | READ COMMITTED-only empty rollback/reapply; populated-goal and stale-snapshot refusals. Actual schema-2 dump/restore, writer barrier, restored 37-table equality and post-restore write passed | Operational data size, retention, access and RTO/RPO remain external |
| Performance / scale | TESTED, limited qualification / 80% | Recomputed raw finite load, queue/admission timings, query plans/WAL, browser geometry/heap/EventTiming and bundle bytes | No unsupported speedup, population p99, long-session leak or maximum-capacity claim |
| CI / independent QA | CI_VERIFIED, INDEPENDENTLY_REVIEWED / 95% | Required current-source/current-base full jobs and independent source/artifact review | Acceptance is bound to one source/base/tree; later changes invalidate automatic reuse |
| Deployment readiness | BLOCKED_EXTERNAL_ENVIRONMENT / 35% | Concrete release runbook and stop/go evidence requirements | Dedicated host/kernel, networks/egress, operational credentials/certificates, production migration/backup and monitoring receipts needed |

## Source and integration ledger

The machine-readable [validation ledger](evidence/validation-ledger.json) is the exact source/run/job/artifact index. Full SHAs are mandatory; the source branch commit and GitHub's merge-test checkout are distinct. Acceptance requires both parents to match the actual base and PR source and the tested tree to match the intended combined tree.

| Feature PR | Accepted source | Actual checkout / tested tree | Full CI | Integration merge |
|---|---|---|---|---|
| [#88 — foundation and Runtime revalidation](https://github.com/yakisoba0728/UnsolvableOJ/pull/88) | `6ec519261b1103b2eadcfe0afcc0dec961353405` | `93b753d73b12efe2ce6e71805feca6522f7428d2` / `5588cb3e8648afed8fe10146d4da961a0ebb4035` | [43890166522](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43890166522), 12/12 | `e7a61bce79d39d2571c810e6edbdf04c7fa41361` |
| [#90 — Judge and dedicated Vibe](https://github.com/yakisoba0728/UnsolvableOJ/pull/90) | `1583ee1c5f30310b37c02d30d53fb9226f776f19` | `af29ece67e20e06b0cce453434b482cc5215d4f6` / `8a5843db4feba7ba619159731f62d4d824369520` | [43893025800](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43893025800), 12/12 | `6d8556c07fd370ee97d7c55798286f5b2885cf4c` |
| [#89 — Frontend](https://github.com/yakisoba0728/UnsolvableOJ/pull/89) | `49a3674e76f79b0d1626b12f02862825c189bdff` | `8d59c05bcc2161e3088355daf63756ed655ac234` / `c90c955a3f4c8cd1e28f26a77a5845b9bf874cd1` | [43901468081](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43901468081),12/12 | `e8b08d6ab86181859d9491d15d1881a6b10262eb` |
| [#91 — DB/API qualification and guarded recovery](https://github.com/yakisoba0728/UnsolvableOJ/pull/91) | `281d0f1a30cd772cf7417e3affb8c98be252f405` | `9aa843fad33b30270ab346bc62c4865c17697ff3` / `0f191c89a17b984cae8706cb02137ab0e4e2c3a4` | [43905864054](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054),12/12 | `a6588f7bedc87228c11852d8664fe20ec6b3ece3` |

The final stacked PR's immutable acceptance comment records the final source, base, merge checkout, equal tree, run/attempt and all twelve job IDs after execution. A document cannot contain its own future commit SHA; that post-run receipt is the authoritative final binding. Historical feature measurements remain tied to their own named source rather than relabeled as the final execution.

Protected starting heads were `main=6176015b63a1615cc2269172f246725ef08abab3`, PR63 `3bcba380f92bd2da8973e6c88c00cd14b03be08e`, and PR86 `d0159b1f844bf0608415dded9e84af566c8e2041`. The final acceptance above repeats the live read of these heads and OPEN/UNMERGED states.

## Actual tests and interpretation

The completed combined Backend/Recovery feature run43905864054 contains these actual results. The final stacked PR independently re-executed those required suites at its own exact source/base/tree; its receipt above records the final job IDs. This table preserves the separately accepted feature execution.

| Executed scope | Actual result in combined feature CI |
|---|---|
| Required jobs |12 completed SUCCESS; none skipped or cancelled|
| Backend unit tests |392/392 across30 files|
| Real-PostgreSQL API tests |261/261 across44 files|
| Judge worker tests |137/137|
| Python runtime checks (health + Go package graph) |5/5|
| Native suite |90/90 including parent;72 separately recorded scenario rows|
| Actual native pipeline |36/36 across9 files|
| Ordinary Playwright |979 entries:894 real-browser cases +85 browser-free units|
| Actual Compose browser |4/4 separate from ordinary Playwright|
| Database qualification |7 bounded workloads,31 migrations, exact oracles and owned database deleted|
| Enriched restore |schema2,31 migrations,37 exact table fingerprints, writer barrier, populated rollback refusal, restored write and cleanup|
| Dependency audit |6 runtime/complete graphs over Back/Front/Judge; all report zero vulnerabilities|
| SBOM collector regression |4/4|
| CI/executor-Compose/Vibe fixture batch |86/86, including18 CI-policy cases and22 Vibe fixture cases|
| Vibe TLS probe |16/16 including parent|
| BOJ import / operations / enterprise benchmark / restore guards / DB guards / starter fixtures |7/6/4/2/2/2 respectively, all pass|
| Four image gates |Back/Front/Judge raw findings0; Runtime rawHIGH177/CRITICAL5, exact reviewed applicability accepted|

All displayed Node summaries have zero failures, cancellations and skips. Browser retries are configured0; no retry/flake is used as acceptance. Deliberate shard-specific build-step omissions and baseline test-name exclusions are distinct from required-suite execution and final case counts.

For already accepted PR90, the actual counts were 386 backend units, 255 real-PostgreSQL API cases, 137 worker tests, five Python runtime checks, 90 native tests including their parent, 35 pipeline cases and four real Compose browser flows. Ordinary Playwright's 936 entries comprised 851 real-browser cases and 85 browser-free units; the four Compose cases are separate. The larger combined-run counts above come from its completed logs; they were not inferred by adding planned tests.

The 72 native matrix cells are eight languages times AC, WA, RE, TLE, OLE, syntax, UTF-8, below-memory and over-allocation scenarios. All below-memory cases passed. Seven over-allocation cases returned MLE. Java returned the explicitly checked `java.lang.OutOfMemoryError: Java heap space` path and remains RE. Python and JavaScript syntax probes remain RE; compiled syntax probes return CE. No raw cgroup OOM-event or complete signal taxonomy is claimed. See [JUDGE.md](JUDGE.md).

The real Vibe browser flow used a generated one-day CA/client/server chain, the actual Front image's nginx configuration and the existing native CI executor. It retained the normal five-per-minute authentication policy with a measured idle admission interval. Public execution and final assessment succeeded; 11/11 functional checks and 40/40 functional points persisted across reload, and owner isolation was checked. Paid evaluation was unavailable by design. Seven actual transport probes covered successful version access, missing client certificate, wrong/absent bearer, wrong hostname, unsupported path and query refusal. The final Compose report confirms cleanup; a nested preflight's earlier cleanup field is not the final state. See [VIBE-BROWSER.md](VIBE-BROWSER.md).

## Findings, failed attempts and corrections

| Event | Actual finding | Resolution / retained limitation |
|---|---|---|
| Foundation run43884655462 | Runtime and required gate failed; other ten jobs passed. Fifteen reviewed advisory fingerprints drifted. | Exact proposal independently revalidated; fixed expiry and gate retained; fresh full run43890166522 accepted. Raw182 findings did not become zero. |
| Frontend run43897227270 | Invalid workflow expression context; zero jobs executed. | Status functions removed from artifact with-inputs; step outcomes used; eighteenth policy regression added and independently passed. |
| Frontend run43898203434 | 17 new cases failed at Git provenance: shard1 eight failures/395 passes; shard2 nine failures/393 passes. Firefox did not execute after failure. | Readonly provenance scoped to the exact module-derived checkout; global trust and actual source binding preserved. Accepted fresh run43901468081 passed all12 jobs, including all17 previously failing cases and both Firefox steps. |
| P5-RELIABILITY-001 | An exclusive lock did not refresh a pre-existing higher-isolation snapshot, so the initial guard could miss a committed saved goal. | Down now refuses non-READ-COMMITTED transactions. Both old-snapshot probes first failed, then passed; independent PostgreSQL replay and 13 targeted cases passed. Only the existing down() changes; up(), registration and the count of31 migrations are unchanged. |
| PHASE5-MULTIAPI-001 | Initial setup/observer awaits did not all honor the promised scenario deadline. | Corrected at7c1731db with owned transports, shared factory deadlines and84-second total allocation under the existing90-second ceiling. Independent six-case adversarial tests pass. Actual current-source eight-job execution and independent artifact review now pass; the originally blocked receipt remains unchanged. |
| Browser artifact privacy review | Failure traces/reporter arguments could retain ephemeral test credentials. | Scoped trace removal and page-local generation/real fetch prevent those values entering the reporting path. Inert timeout canary reproduced the risk before correction. |
| Local browser execution | Pinned download invalid; system browser startup denied by socket restrictions. | Local browser assertions remain NOT_EXECUTED. Required real CI browsers provide acceptance; no host/sandbox restriction was bypassed. |
| DB fixture development | Shared authentication fixture hit its existing limit; initial deep-page expected arithmetic was wrong. | New auth tests isolated on a fresh owned app; expected arithmetic corrected. Application admission policy and authorization were not weakened. |

Failed and superseded runs remain in the ledger. Retry, cancellation, test-selection exclusions and unexecuted steps must be reported separately from pass counts. Local source compilation is never reported as native execution. Evidence scripts retain adverse measurements and absent optional metrics.

## Performance and security conclusions

The final run retained less favorable timings under different CI job hosts. Its two-API batch measured11,176.100703ms active (0.715813jobs/s) and13,488.428723ms through cleanup before report writing (0.593101jobs/s), compared with PR91's8,912.916859ms through-cleanup observation:4,575.511864ms /51.34% longer. The final pipeline host was AMD EPYC7763/Azure; PR91 used Intel6975P-C/AWS. Eight-job arrival-to-finish p50/max were485/10,129ms. This is a finite same-code observation across different hosts, not a causal regression or capacity claim.

The final Compose LCP candidates were[424,396,396]ms, median396ms versus PR91's368ms; the15-switch maximum was53.7ms versus49.2ms. CLS remained[0.048731330235799154,0.048731330235799154,0.05432499885559082]. The editor retained200 events and discarded176, with duration p95/p99=96/104ms; fieldINP stayed null and heap snapshots remained coarse. Final DB qualification took1,986.283389ms and the separate tiny restore1,026.560620ms. The [final numerical addendum](FINAL-RUN-PERFORMANCE.md) preserves exact raw hashes, vectors, per-job environments, limits and adverse observations. The earlier feature observations below remain tied to their named runs.

[PERFORMANCE.md](PERFORMANCE.md) contains protocol-specific raw hashes, conditions, raw vectors, recomputation and limits. The earlier 32-job/four-trial and 24-job/three-wave campaigns both used one API with multiple workers; they are separate protocols and must not be pooled or relabeled as two-API evidence. Tiny nearest-rank p95/p99 values are observed order statistics. Admission time is retained separately from active throughput.

The accepted two-API run43905864054 used eight jobs across eight languages, three admission lanes and two workers. APIs admitted4+4 jobs; workers completed6+2. Active-window throughput was1.086716jobs/s and through-cleanup throughput0.897574jobs/s. Arrival-to-BullMQ-finish p50/p95 were317/6707ms; with eight observations p95 and p99 are the observed maximum. Queue-timestamp wait3/456ms and worker-reported queue age6/457ms have different boundaries. The normal shared quota, claim409, duplicate200, generation1, one10-XP solve and owned cleanup invariants passed. Final report-write time is excluded from the latter denominator. API lifetime CPU and end-RSS include startup and exclude the native executor/DB/Redis/host; this is correctness and bounded resource evidence, not capacity. See [MULTI-API.md](MULTI-API.md).

Actual CI DB qualification completed seven workloads in1,808.688ms with a maximum33,068,723-byte disposable database. Five-read p50/p95 timings were2.099/2.784ms for page0,1.973/2.024ms for page4950,16.628/16.761ms for summary,22.698/29.057ms for5k CSV and10.465/10.680ms for learning. Bulk rejudge took6.223496ms; EXPLAIN WAL168,050B and cluster WAL184,376B have different scopes. Deep pagination sorted5,000rows versus a top50 first page; learning estimated988rows versus actual10,000. Those adverse plans and the local/CI configuration differences remain in [DATABASE.md](DATABASE.md) and [PERFORMANCE.md](PERFORMANCE.md); the lower CI times are not a speedup claim.

The actual enriched restore took1,027.631ms for this tiny owned fixture, including dump124.624ms and restore142.817ms. All31 migrations and37 table fingerprints matched; the writer barrier, populated-goal downgrade refusal and restored write passed. The270,084-byte dump's hash is retained, but the dump bytes/table data are not published. Offline report verification cannot re-execute restoration. These figures are not operational RTO/RPO.

The local DB qualification used 5,000 candidates/10,000 submissions, 20,000 history rows, 5,000 distinct solvers and 256 large-source rows. It applied all31 migrations and verified cleanup. Five serial read samples and seven workloads qualify current correctness/plans; there is no schema optimization or controlled baseline/candidate speedup. The client's RSS growth includes retained results and evidence, not just query work or PostgreSQL memory. TOAST references prevent treating an eight-MiB logical source fixture as proof of an eight-MiB transition-table materialization.

The comparable old browser probe runs retain adverse observations: the older Phase IV foundation CLS median0.029427 versus later0.048731, and a later click-to-frame median increase45.9→46.8ms. These tiny, different-content CI samples do not establish cause. The new additive layout attribution has its own schema/version and is not silently spliced into an unchanged-probe experiment. The bounded editor sample is laboratory heap/EventTiming with a mocked backend, not field INP or a long-session leak test. The unchanged initial JS byte count and +54 emitted-JS/+79 summed-gzip bytes are not a speedup.

[SECURITY.md](SECURITY.md) retains the exact Runtime review. Raw HIGH177/CRITICAL5, scanner exit2 and the distinction between header-package metadata and shipping reachable payload remain visible. `PASS_WITH_REVIEWED_COMPONENT_FINDINGS` requires exact applicable evidence. Expiry stays **2026-11-30T00:00:00Z**; later advisory/payload drift or expiry must fail. The other three image scans are separately recorded. No test here certifies a production host kernel or a penetration test.

## Manual handoff

At this receipt, PR63 targets `main`, PR86 targets `overhaul/integration`, and PR92 targets `overhaul4/integration`. After each owner merge, inspect the next PR's actual base and retarget it to the intended current `main` when necessary, then repeat all required CI against that new base before merging. This receipt approves the recorded PhaseIV base; it does not pre-approve a future retarget or changed merge tree. The evidence-only archive branch is not part of the release merge sequence.

**READY_FOR_MANUAL_MERGE** is the sole final code disposition after actual validation. Production deployment remains blocked on the separately listed operator evidence.

Read the final PR acceptance receipt, [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md), and [REMAINING-EXTERNAL-GATES.md](REMAINING-EXTERNAL-GATES.md). Confirm the live stack and required checks; merge #63, then #86, then the final Phase V PR manually, refreshing CI if the base changes. A merge is not a deployment authorization. Operational stop/go requires the dedicated host, network, credentials/certificates, backup/restore, migration and monitoring evidence listed in the runbook.
