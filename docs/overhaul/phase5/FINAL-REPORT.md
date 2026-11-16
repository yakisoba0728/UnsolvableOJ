# UnsolvableOJ Phase V final engineering handoff

This source report closes the four accepted feature increments and preserves their immutable evidence. Final code acceptance requires the **post-run receipt on the final stacked PR**: the exact final source/base/checkout/tree, all twelve completed jobs and independent review. The completed receipt and a finalized copy of this report are retained on the evidence-only `overhaul5/final-receipts` branch without changing the tested release source. Until that receipt exists, this document does not grant merge or deployment approval.

## Decisions and scope

The final decision applies to the reviewed code stack and its disposable validation environment. Operational deployment remains blocked on the specific operator evidence in [REMAINING-EXTERNAL-GATES.md](REMAINING-EXTERNAL-GATES.md). The owner retains manual control of PR #63, PR #86 and the final Phase V PR. The order is **#63 → #86 → Phase V**, followed by revalidation against any changed base. No protected branch, production resource, operational secret, paid provider or production execution host was modified.

This increment extends the accepted Phase IV source `d0159b1f844bf0608415dded9e84af566c8e2041`, tree `f12f6c377ea07f0cb4b498ca0fe5889ed4401a66`. It reuses the existing product, execution and recovery contracts. The new product corrections are shared date/time focus restoration, stable same-owner goal content during refresh, and saved-goal preservation during downgrade. Qualification adds real native memory/verdict evidence, an actual dedicated Vibe browser path, deeper database/authorization cases, a bounded two-API protocol, richer restore fixtures and source-bound browser observations.

The DB/API and reliability sources were combined in PR91 after separate independent reviews, so their common PostgreSQL, migration and restore paths are validated together without an additional duplicate full-CI campaign.

The phase created six distinct workers (Frontend, Judge, Database, Security, Reliability and Independent QA), with at most three workers active alongside the coordinator. Follow-up turns reused those workers. Implementation, review, native execution, current-base full CI and integration were separate gates.

## Final scope matrix

Percentages are the coordinator's **subjective estimates of the stated Phase V goals**, not objective product completion, coverage, pass rates or security scores. There is no weighted aggregate. The estimates include the explicitly unverified scope below; final code acceptance still requires the final stacked PR receipt.

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
| CI / independent QA | Features CI_VERIFIED; final receipt required / 95% | Required current-source/current-base full jobs and independent source/artifact review | Acceptance is bound to one source/base/tree; later changes invalidate automatic reuse |
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

Protected starting heads were `main=6176015b63a1615cc2269172f246725ef08abab3`, PR63 `3bcba380f92bd2da8973e6c88c00cd14b03be08e`, and PR86 `d0159b1f844bf0608415dded9e84af566c8e2041`. The final acceptance must repeat the live read of these heads and OPEN/UNMERGED states.

## Actual tests and interpretation

The completed combined Backend/Recovery feature run43905864054 contains these actual results. The final stacked PR must re-execute the same required suites at its own exact source/base/tree; its post-run receipt records the final job IDs rather than reusing these feature counts as final execution.

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

[PERFORMANCE.md](PERFORMANCE.md) contains protocol-specific raw hashes, conditions, raw vectors, recomputation and limits. The earlier 32-job/four-trial and 24-job/three-wave campaigns both used one API with multiple workers; they are separate protocols and must not be pooled or relabeled as two-API evidence. Tiny nearest-rank p95/p99 values are observed order statistics. Admission time is retained separately from active throughput.

The accepted two-API run43905864054 used eight jobs across eight languages, three admission lanes and two workers. APIs admitted4+4 jobs; workers completed6+2. Active-window throughput was1.086716jobs/s and through-cleanup throughput0.897574jobs/s. Arrival-to-BullMQ-finish p50/p95 were317/6707ms; with eight observations p95 and p99 are the observed maximum. Queue-timestamp wait3/456ms and worker-reported queue age6/457ms have different boundaries. The normal shared quota, claim409, duplicate200, generation1, one10-XP solve and owned cleanup invariants passed. Final report-write time is excluded from the latter denominator. API lifetime CPU and end-RSS include startup and exclude the native executor/DB/Redis/host; this is correctness and bounded resource evidence, not capacity. See [MULTI-API.md](MULTI-API.md).

Actual CI DB qualification completed seven workloads in1,808.688ms with a maximum33,068,723-byte disposable database. Five-read p50/p95 timings were2.099/2.784ms for page0,1.973/2.024ms for page4950,16.628/16.761ms for summary,22.698/29.057ms for5k CSV and10.465/10.680ms for learning. Bulk rejudge took6.223496ms; EXPLAIN WAL168,050B and cluster WAL184,376B have different scopes. Deep pagination sorted5,000rows versus a top50 first page; learning estimated988rows versus actual10,000. Those adverse plans and the local/CI configuration differences remain in [DATABASE.md](DATABASE.md) and [PERFORMANCE.md](PERFORMANCE.md); the lower CI times are not a speedup claim.

The actual enriched restore took1,027.631ms for this tiny owned fixture, including dump124.624ms and restore142.817ms. All31 migrations and37 table fingerprints matched; the writer barrier, populated-goal downgrade refusal and restored write passed. The270,084-byte dump's hash is retained, but the dump bytes/table data are not published. Offline report verification cannot re-execute restoration. These figures are not operational RTO/RPO.

The local DB qualification used 5,000 candidates/10,000 submissions, 20,000 history rows, 5,000 distinct solvers and 256 large-source rows. It applied all31 migrations and verified cleanup. Five serial read samples and seven workloads qualify current correctness/plans; there is no schema optimization or controlled baseline/candidate speedup. The client's RSS growth includes retained results and evidence, not just query work or PostgreSQL memory. TOAST references prevent treating an eight-MiB logical source fixture as proof of an eight-MiB transition-table materialization.

The comparable old browser probe runs retain adverse observations: the older Phase IV foundation CLS median0.029427 versus later0.048731, and a later click-to-frame median increase45.9→46.8ms. These tiny, different-content CI samples do not establish cause. The new additive layout attribution has its own schema/version and is not silently spliced into an unchanged-probe experiment. The bounded editor sample is laboratory heap/EventTiming with a mocked backend, not field INP or a long-session leak test. The unchanged initial JS byte count and +54 emitted-JS/+79 summed-gzip bytes are not a speedup.

[SECURITY.md](SECURITY.md) retains the exact Runtime review. Raw HIGH177/CRITICAL5, scanner exit2 and the distinction between header-package metadata and shipping reachable payload remain visible. `PASS_WITH_REVIEWED_COMPONENT_FINDINGS` requires exact applicable evidence. Expiry stays **2026-11-30T00:00:00Z**; later advisory/payload drift or expiry must fail. The other three image scans are separately recorded. No test here certifies a production host kernel or a penetration test.

## Manual handoff

The final receipt must contain exactly one code disposition, `READY_FOR_MANUAL_MERGE`, `PARTIAL_READY_WITH_EXPLICIT_BLOCKERS`, or `BLOCKED`, after actual validation. This source checkpoint does not preselect that future result.

Read the final PR acceptance receipt, [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md), and [REMAINING-EXTERNAL-GATES.md](REMAINING-EXTERNAL-GATES.md). Confirm the live stack and required checks; merge #63, then #86, then the final Phase V PR manually, refreshing CI if the base changes. A merge is not a deployment authorization. Operational stop/go requires the dedicated host, network, credentials/certificates, backup/restore, migration and monitoring evidence listed in the runbook.
