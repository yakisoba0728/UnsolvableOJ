# UnsolvableOJ Phase II engineering report

Implementation checkpoint: seven reviewed implementation PRs are integrated, including the actual image-security gate. This report describes observed results through that checkpoint. The documentation PR and post-merge final integration HEAD are independently validated afterward; their exact head, tree, CI and final disposition are recorded in the final verification receipt on [PR #63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63). A component run is never substituted for that final run.

## Executive summary

Phase II began from `c8ba9712d1a29ac633519511e50428ef647edf66`, independently checked the nine historical work PRs and their recorded CI, and retained the existing React/NestJS/PostgreSQL/Redis/BullMQ/go-judge stack. Work was bounded around reproduced assessment/privacy/concurrency defects, a genuinely new private problem-bookmark feature, Judge readiness and real recovery, results-volume scaling, and dependency/artifact security. It did not substitute a new report for implementation.

Seven implementation PRs have passed independent source review and their own exact-head full CI before integration: #64, #66, #65, #67, #69, #70 and #68. The implementation checkpoint is `bfb6adaa28d5d99d34d6bc8051f06fe1aa0c6ee3`; main remains `6176015b63a1615cc2269172f246725ef08abab3`. PR #63 stays open and unmerged. No production deployment, production data operation, paid infrastructure, force push, or change to another contributor's branch was performed.

The most substantial measured application change is bounded enterprise results: at 5,000 synthetic candidates, median measured first-page API p95 fell from 521.46 to 60.77 ms, p99 from 647.58 to 65.54 ms, and peak API RSS from 462.00 to 176.82 MiB. Whole-assessment summaries and first-page row digests agree. This intentionally replaces an unbounded response with 50 result rows; it is not equal-byte throughput or a sustained production-capacity claim.

Combined application CI actually exercised 320 Backend unit cases, 209 PostgreSQL/API cases, 74 native runtime cases, 28 queue/pipeline cases, three live Compose browser flows, and 707 browser instances plus 85 browser-free units. The new Redis daemon/AOF restart and interrupted-rejudge scenarios passed with state, XP, learning, solve and notification assertions. Source review and local discovery are not counted as those executions.

The installed-image gate executed and passed at source `0e70a2fe6d725362bcb248836c3697d310e16742`, full run [43805214804](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43805214804). Back, Front and Judge have zero raw scanner findings. Runtime still reports HIGH177 / CRITICAL5: those182 exact header-component records have separate, independently reviewed absent-code decisions backed by the actual990 package files. Raw findings remain intact, approval expires on2026-11-30, and the host kernel remains UNVERIFIED. Supported package updates and a minimal pinned go-judge rebuild also address patchable findings and verify authentication-log redaction. This is a narrow component decision, not a vulnerability-free or deployment-ready claim.

## Independent re-audit of Phase I

[PHASE2-BASELINE](PHASE2-BASELINE.md) records the initial GitHub observations; [PHASE2-AUDIT](PHASE2-AUDIT.md) maps all 25 original entries to source and newly executed evidence. Those 25 entries include process, tooling and performance findings, not 25 independently exploitable vulnerabilities.

The independent pass confirmed the important Phase I corrections in actual source and fresh suites: submission and workspace eligibility after locking, verified-email invitation checks, temporary-password visibility, submitted-version diagnostic filtering, redirect rejection and anonymous sandbox denial, notification request ownership/reconciliation, output-comparison semantics, required CI dependencies, and the two user-first relationship indexes. Historical run 43786206115 was inspected but was not reused as validation of a changed head.

The pass also found gaps that the earlier completion summary did not settle:

- An exam could expose changing problem content while submissions independently chose newer versions. Phase II pins full algorithm-problem versions at selection and uses those versions throughout presentation, judging and rejudge.
- Starting an exam could wait across invitation or deadline changes and then commit using stale eligibility. Real PostgreSQL races reproduced the old wrong HTTP outcomes.
- Candidate submission titles and owner selection labels could describe a later private/current version despite an otherwise pinned exam. Both projections now read the authorized immutable version and fail closed when required metadata is unavailable.
- Enterprise async completions could affect a newer route/login, while ordinary token rotation could erase an unsaved form. Account/route ownership and same-login draft preservation were implemented and tested against actual React source.
- Queue readiness did not describe both Redis connections. Worker renewal now accounts for both links while preserving reconnect/liveness behavior.
- Earlier worker recovery shortened the database lease; new scenarios wait for the real lease and recovery timer. Earlier proxy-link faults did not prove Redis-process restart; a distinct owned-daemon test now does.
- Production npm audit did not describe development tools or actual shipping image packages. Complete npm audits and installed-image inventories are separate enforced scopes.
- Fast in-memory result assembly did not bound SQL/result/HTTP size. Pagination now limits detailed rows while retaining consistent whole-assessment statistics.

Independent review also caught defects introduced in early Phase II candidates: bookmark lock order, a stale exam save reverting refreshed bindings, a start/withdrawal deadlock, premature worker readiness, unsafe test-URL query overrides, and mismatched evidence-tool output contracts. Those findings were reproduced and corrected before acceptance. Failed CI runs and their causes remain in the component records; no assertion was removed to manufacture success.

## Security and correctness

### Dependencies and artifacts

TypeORM was changed through its supported dependency range to 1.1.3, removing the legacy glob/minimatch chain without forced overrides. Actual ORM null-selector, query-shape, rollback, migration and API checks passed. The stricter null/undefined selector behavior remains enabled.

A later complete audit found development-only Vitest/coverage/mocker and fast-uri advisories that a production-only audit could not detect. Ordinary updates to Vitest 4.1.12 and fast-uri 3.1.9 resolved them; existing production lock records were unchanged. All six Back/Front/Judge complete and production scopes reported zero findings in combined CI at the moderate gate. These are dated advisory results, not a zero-risk assertion.

Complete CycloneDX lockfile inventories are checked against every expected package/version and graph edge. This catches npm's observed omission of shared build/runtime dependencies. Installed-image inventories and license metadata are a separate artifact scope. The repository still has no owner-selected top-level license grant; none was invented. Third-party inventory is not a legal-compliance certificate.

The image-security change retains raw reports, database freshness, scanner/archive/source pins, actual OCI identities, all severities and analyzer-coverage checks. Targeted updates include supported OS-library fixes, removal of unused global npm tooling from final application images, and a pinned go-judge v1.13.3 source rebuild with the reviewed upstream authentication-log redaction, current toolchain and one necessary module update. Source provenance and the main-module `(devel)` scanner limitation are explicit. Image-specific decisions and remaining findings belong to the image audit records and PR #68.

The same Trivy0.76.2 and vulnerability-database digest were used for the retained first and accepted scans. Raw package-record counts changed from Back6HIGH→0, Front3HIGH→0, Judge6HIGH→0, and Runtime181HIGH/5CRITICAL→177HIGH/5CRITICAL. Runtime also retains UNKNOWN1, LOW363 and MEDIUM561. Changed/new/missing/downgraded findings, different package files, altered evidence, missing coverage, EOSL or an expired review prevent reuse of the182 decisions. The actual runtime build records505 production Go packages with no OpenPGP import; the raw UNKNOWN module record remains visible. PostgreSQL, Redis and the Playwright CI image remain version-tagged. None of these limits is hidden by a clean npm audit.

### Authorization, concurrency and data

Private bookmarks cannot grant access to an unpublished/private problem. Unique constraints make save/remove idempotent. Save and withdrawal use reviewed lock ordering and a fresh active-account check; stale authenticated work cannot recreate rows after withdrawal.

Exam creation/selection pins immutable versions. Ordinary editing preserves them, and an explicit pre-start refresh updates them. Candidates answering algorithm problems receive the same statement, samples, limits and grading version; hidden cases remain server-side. A submitted attempt retains its assessment version during rejudge. Owner metadata is a six-field whitelist after authorization, and candidate submission detail only copies the submitted snapshot title.

Start eligibility uses database time and current test state after the reviewed locks, including invitation and live-session checks. Actual concurrent revocation/deadline, refresh/save and withdrawal regressions establish the corrected ordering. Phase I submission/finish guards remain covered.

## Architecture and user-visible features

The topology is preserved. Changes are targeted at demonstrated boundaries rather than a service split, sharding, language rewrite or new paid provider. [PHASE2-ARCHITECTURE](PHASE2-ARCHITECTURE.md) records the decisions and intentional API differences.

| Implemented capability | User effect | Contract and evidence |
|---|---|---|
| Private saved problems | A persistent cross-device study shortlist with save/remove, authoritative recovery after uncertain mutations, and an authenticated saved-only catalog filter | New user/problem relation with uniqueness/FKs; status/PUT/DELETE APIs; server-side search/filter/facets/pagination; real DB races, three-engine regressions and live save/reload/remove flow |
| Immutable algorithm problems in enterprise exams | Editing a source problem no longer silently changes an existing assessment; owners can explicitly refresh before start | Selection-time version binding, migration validation, snapshot presentation/Judge/rejudge, owner-visible pinned metadata, private-version live exam flow |
| Bounded owner results | Useful page navigation, retry, focus/empty-state handling and recovery when the current page disappears | Default 50 / max 100, deterministic ordering, global summary plus page details in one REPEATABLE READ transaction; equivalence and HTTP measurements |
| Enterprise request/draft ownership | Old requests cannot navigate a new account/route; ordinary token rotation preserves the current unsaved draft | Actual-source before/after DOM reproductions and selected Chromium/Firefox/WebKit cases |
| Judge operational evidence | Queue readiness follows real connectivity; optional acknowledged metrics describe timing and worker resource use without code or private test data | Unit/native checks, real queue/worker scenarios and artifact-backed measurements |

No named collections, full personal-learning dashboard, complete design-system replacement or new Vibe AI feature is claimed. Route/page modules were structurally inventoried; targeted altered flows received loading/error/account/keyboard/small-screen checks. That is distinct from a comprehensive visual or accessibility audit of every page and state.

## Performance

[PHASE2-PERFORMANCE](PHASE2-PERFORMANCE.md) links source hashes, hardware/runtime versions, fixture sizes, raw samples, query plans, warmup/order and limitations. [PHASE2-RESULTS](PHASE2-RESULTS.md) details the HTTP experiment.

### Controlled application comparison

5,000 candidates, identical owned API/PostgreSQL/Redis fixture and measurement script, five warmup requests, three bursts of 20 requests at concurrency four. Normal admission limits remained enabled. Before returns all candidates; after returns the first 50 with equivalent global statistics.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| API p50, median burst | 404.06 ms | 40.12 ms | −90.1% |
| API p95, median burst | 521.46 ms | 60.77 ms | −88.3% |
| API p99, median burst | 647.58 ms | 65.54 ms | −89.9% |
| Admitted burst RPS | 9.29 | 86.11 | About 9.3× in this finite task |
| API CPU per 20 requests | 2,250 ms | 160 ms | −92.9% |
| API peak RSS | 462.00 MiB | 176.82 MiB | −61.7% |
| Complete response size | 3,731,355 B | 38,068 B | −99.0% |
| Measured errors | 0/60 | 0/60 | No observed errors |
| Initial frontend entry gzip | 122,616 B | 122,690 B | +74 B (+0.060%) |
| Total frontend JS gzip | 482,612 B | 485,346 B | +2,734 B (+0.567%) |
| Field LCP / INP / CLS | N/A | N/A | Not measured |
| Phase I→II Judge jobs/s / queue wait | N/A | N/A | No controlled old/new comparison |
| Whole-platform CPU/RSS / DB lock wait | N/A | N/A | Not measured |

The HTTP p95 ranges were 477.76–671.19ms before and 46.83–62.93ms after; a 20-request p99 is the sample maximum. CPU/RSS cover the API child, excluding DB/Redis/client. Whole-test aggregation remains O(N); deep offsets, large Vibe workspaces and concurrent examiner writes remain unmeasured. Frontend rows compare clean builds of Phase I and the complete Phase II application with the identical Front lockfile; they measure delivered bytes, not rendering latency.

### Judge scaling and database tradeoff

The same-code scaling snapshot is [run 43794094432](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43794094432), source `f1985dd19e3baf094bf82131250fb46bc5398941`, before the later runtime-image rebuild. These trials used all eight languages through actual HTTP→PostgreSQL→BullMQ→worker→go-judge→callback, alternating 1/2/2/1 workers, eight jobs per trial. One worker delivered 0.655–0.664jobs/s, two delivered 0.719–0.767jobs/s. Queue p95/p99 sample maxima fell from 11.577–11.693s to 1.258–2.015s. Node-worker CPU was 150ms versus 140–150ms per burst; each process used about 108MiB RSS, so two workers approximately double that part of memory. Compiler/executor CPU and memory are not included. This is finite admitted-burst scaling, not a new sustainable arrival limit or Phase I→II speedup.

The rebuilt runtime was also measured at the accepted source0e70/run43805214804: one worker delivered0.795–0.815jobs/s and two delivered0.910–0.942jobs/s, with queue p95/p99 sample maxima of1.881–9.407s and1.209–1.299s respectively. Worker CPU was100–110ms versus110–140ms per eight-job burst; each worker used about107MiB RSS. This later shared-runner observation has its own raw artifact and retains the substantial single-worker variation. It does not establish a causal before/after image improvement.

The Phase I community indexes were independently remeasured on 10,000 users, 2,000 posts and 200,000 relations per table. Read medians improved 9.358→1.414ms and 8.420→1.312ms, while 1,000-row insert medians increased 15.942→19.440ms and 17.125→20.878ms. Measured INSERT-plan WAL increased 50.3%; each index occupied 9,961,472 bytes. These costs are retained rather than presenting only favorable read numbers. Production migration lock duration is still unmeasured.

## Reliability

| Actually executed scenario | Observed result and scope |
|---|---|
| Worker SIGKILL with natural lease | Normal 60-second lease/recovery timer, new generation, final accepted result, stale callback rejection and unique XP/learning/notification evidence |
| Worker/API and worker/Redis link interruption | Owned loopback proxies, retained active work, retry/reconnect and eventual terminal state; distinct from daemon restarts |
| Actual API-process restart | Owned API SIGKILL/replacement; downtime request creates no row, retry succeeds; three accepted jobs complete in generation 1 |
| Two-worker competition / duplicate delivery | Duplicate does not execute or overwrite the active attempt; terminal duplicate remains idempotent |
| Owned Redis clean daemon/AOF restart | Server run ID changes; callback persists while Redis is stopped; queued work survives, four accepted jobs finish in generation 1 with zero recoveries and XP 10 once |
| API admission during Redis outage | Observed bounded HTTP 500 after 453 ms and zero created rows; retry after reconnect finishes. This is fail-closed admission, not uninterrupted availability or a 503 contract |
| Worker killed during rejudge | Accepted generation 1, interruption during generation 2, natural recovery to generation 3 in 86.51 s, final ACCEPTED in 89.78 s; one recovery, one XP award/solve/learning/notification |
| Old and duplicate result callbacks | Stale generation returns 409, duplicate terminal callback returns 200 without changing final data |

The rebuilt-runtime run43805214804 observed API replacement in1.042s and three accepted jobs complete by8.142s. Redis restart interval8.698s includes the stopped interval and callback/observation work; four final results completed by10.302s. These are individual bounded scenarios, not recovery SLO distributions. The owned Redis container had a private generated volume, loopback binding, 128 MiB memory, 0.5 CPU and 64 PID ceilings. Resource identity was checked before mutations and cleanup. The workflow Redis and all production resources were untouched.

Normal worker shutdown is covered by existing worker tests and Compose lifecycle; a dedicated long active-job graceful-stop/restart campaign was not separately measured. Server restart evidence covers owned API and Redis processes, not an entire host reboot. Mixed failure evidence is a bounded burst, not a prolonged campaign.

The clean Redis/AOF test does not establish abrupt-power-loss, corrupt-log or crash-fsync durability. Multi-hour mixed failures, distributed-clock behavior and full-platform resource exhaustion remain unverified. [PHASE2-RECOVERY](PHASE2-RECOVERY.md) and the retained original artifact give exact run/job/source/digest provenance.

## Validation and GitHub integration

Each implementation followed IMPLEMENTED→TESTED→INDEPENDENTLY REVIEWED→CI VERIFIED→INTEGRATED. Coordinator and three specialists used separate worktrees. Independent reviews are AI engineering reviews with reproduced evidence, not fabricated human GitHub approvals. Equal Git tree hashes were verified when publishing local snapshots through the authenticated connector.

| PR | Scope | Accepted exact-source CI |
|---|---|---|
| [64](https://github.com/yakisoba0728/UnsolvableOJ/pull/64) | ORM/dependencies/SBOM | [43790101564](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43790101564) |
| [66](https://github.com/yakisoba0728/UnsolvableOJ/pull/66) | Private problem bookmarks | [43792648475](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43792648475) |
| [65](https://github.com/yakisoba0728/UnsolvableOJ/pull/65) | Judge readiness/capacity/recovery | [43794094432](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43794094432) |
| [67](https://github.com/yakisoba0728/UnsolvableOJ/pull/67) | Exam versions/start/frontend ownership | [43795876240](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43795876240) |
| [69](https://github.com/yakisoba0728/UnsolvableOJ/pull/69) | Result pagination/full validation | [43798756788](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43798756788) |
| [70](https://github.com/yakisoba0728/UnsolvableOJ/pull/70) | Metadata, complete audit, Redis/rejudge/live exam | [43800127993](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43800127993) |
| [68](https://github.com/yakisoba0728/UnsolvableOJ/pull/68) | Actual images, security rebuild and precise applicability | [43805214804](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43805214804) |

PR #70's accepted source is `d5dc5a9cfa627a505efeeac6458a7d9556b71e06`, actual Actions merge checkout `793443c40a2022b30e11ebf52dce4af1a62f467a`, tree `4a9a1c557a2850f48029f550e7cf0adfc97af1e2`. All12 jobs succeeded. Browser counts are372 Chromium,111 slow Chromium,112 WebKit and112 Firefox, plus 85 browser-free units. These are execution instances, not707 unique user stories or complete three-engine coverage of every route.

PR #68's accepted source is `0e70a2fe6d725362bcb248836c3697d310e16742`, actual Actions merge checkout `71370b28d8a30d3ac79cf18de5facd291b6447d2`, tree `f302cef7d2459736d3810ee930f1c9e63662ed65`. It was integrated as `bfb6adaa28d5d99d34d6bc8051f06fe1aa0c6ee3` with the same tree after all12 jobs and independent Product/Judge/coordinator checks. The rebuilt runtime again passed native74, pipeline28 and Compose3; all application/browser counts above also passed at this source. Four original image artifacts and independent reviews are retained under `evidence/images-run-43805214804`; the new runtime recovery artifact is under `evidence/judge-run-43805214804`.

An earlier PR #69 run was overall green with incomplete native/browser selection and was explicitly rejected as sufficient merge evidence. The positive full-validation opt-in adds coverage; later exact-head full execution supplied the missing checks. It also forces all four actual image gates, including on final documentation changes. No required failure condition, application rate limit or assertion was relaxed. Failed image runs remain in the record; precise reviewed component applicability is distinct from removing a scanner finding.

Branches were observed unprotected with no rulesets. This workflow is enforced by explicit review/head/base/run checks, not a newly installed repository policy. Open external Dependabot PRs were preserved. [PHASE2-PROGRESS](PHASE2-PROGRESS.md), [PHASE2-VALIDATION](PHASE2-VALIDATION.md) and [PHASE2-REVIEW](PHASE2-REVIEW.md) provide the resume contract and source/run/merge identities.

## Outstanding work and operational readiness

The bounded application work is implemented, reviewed and integrated. This does not fulfill every exploratory item in the wider overhaul request. The following remain explicit:

1. Use the final exact-integration-HEAD verification receipt on PR #63 to determine code merge readiness; this implementation checkpoint alone cannot establish it. Preserve original scanner findings and the expiring, exact applicability policy. Renewing that review requires fresh evidence and independent review, not an automatic date change.
2. Assess and patch the dedicated execution host independently. Privileged go-judge namespaces/seccomp/cgroups are not a VM boundary; package-header analysis says nothing about the running host kernel. No dangerous shared-runner escape experiment was performed.
3. Rehearse production migrations, backup/restore and rollback on approved representative infrastructure. The test databases and volumes were disposable; no production compatibility rehearsal is claimed.
4. Measure popular-problem/XP write contention, large learning histories, deep result offsets, DB pool behavior, lock waits, executor/compiler resources, sustained multi-API/multi-worker traffic and prolonged mixed failures before making extreme-scale capacity claims.
5. Complete the language×verdict memory-limit matrix. AC and representative negative/UTF-8/resource cases cover all eight languages, but managed-runtime allocation refusal is not universally an MLE.
6. Measure browser LCP/INP/CLS, long-session editor responsiveness/memory, physical devices and complete accessibility/visual states. Structural route inventory and targeted browser checks do not certify all of them.
7. Implement and validate Vibe assessment challenge/runtime version parity; algorithm-problem pinning does not cover that separate model. Validate native Vibe runtime equivalence and any external AI behavior/cost controls in an explicitly approved environment. No real paid AI call or new provider integration was used here.
8. Have the copyright owner choose the repository license and maintain third-party notice review. Preserve unpatched lower-severity image advisories and scanner coverage limits; clean npm audit does not settle them.

PR #63 is the user's review handoff and remains unmerged. Code validation and operational deployment readiness are separate decisions. This session does not promise unattended continuation after it ends.
