## 9. Final PR92 numerical addendum — run 43913852145

[Final CI 43913852145](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145), attempt 1, measured source `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`, checkout `70307b3d3c7c9591ee3822e4b5ab903d3527f1b1`, tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813`. Checkout parents are Phase IV `d0159b1f844bf0608415dded9e84af566c8e2041` and that source. All twelve CI jobs succeeded; arithmetic verification and independent semantic acceptance remain separate. QA's source receipt records all **876 paths outside Phase V docs identical to PR91**. These fresh samples remain separate from PR91; different CI hosts and sample variability preclude causal improvement/regression inference.

### Exact original evidence

Original ZIP hashes/lengths and extracted JSON bytes were checked. [Full-precision vectors and calculations](evidence/final-run-43913852145/derived-performance.json) accompany this appendix. Schemas are DB **1**, restore **2**, multi-API **1**, editor **1**, layout **2**. No new experiment or application test was run.

| Original artifact | ZIP SHA256 | JSON SHA256 |
| --- | --- | --- |
| [DB 14247944044](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/artifacts/14247944044), [raw JSON](evidence/final-run-43913852145/phase5-database.json) | `41b9c26f8a6e68c9a3f551a06f280f4232db099248ccc4a73c19ac7abe576d5d` | `337cbcc2132f1fd9c27d024f034a249ca55b055cfe7be74f88467c6d493e76f0` |
| [Restore 14248613692](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/artifacts/14248613692), [raw JSON](evidence/final-run-43913852145/phase4-restore.json) | `15e74add3c7d4f22624ff1a9869a472f2aa7582aafab2743b171a2fa1f0f3af8` | `ee077e87ef3b3f700a6a53fa0fc068125a69991fd3e575ff1d1e458d2dcf8c7c` |
| [Multi-API 14249198949](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/artifacts/14249198949), [raw JSON](evidence/final-run-43913852145/phase5-multi-api.json) | `bf5ea3ba7956f67295f255c132365e677b3a2a4b45e22815f50bc94f9cd59d45` | `644afcd93bf7902815f6eb3a9b0c094e9419bf3cceb9a9f6a35d44790e626f2a` |
| [Editor/shard 2 14249607210](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/artifacts/14249607210), [raw JSON](evidence/final-run-43913852145/phase5-editor-observation.json) | `c8b1759609705d77297c938d7a0ea2606058b5673847e95841796c317e5b638d` | `fbfff690fdc12cda92ff0575a9db7173fec6da400ba47ab2ab2f9c6c0de1ae7e` |
| [Compose browser 14250011866](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43913852145/artifacts/14250011866), [raw JSON](evidence/final-run-43913852145/phase3-browser-performance.json) | `1bbb4f8d8214e2953dbc6b2a03807f2c1ef66cfae7d34e0721f301643a640b66` | `7832745ab70125a085db97afb1c2393720af5cf72218d34badf25e310574478b` |

### Database and restore

The seven-workload fixture passes: 5,000 candidates, 20,000 learning rows, 5,000 distinct solvers and 256×32KiB source rows. Node 24.22.2/PostgreSQL 17.11 ran on Intel 6975P-C/AWS, four exposed CPUs; PR91's backend used Intel 6973P-C/Azure. Measured source hashes and harness limits match PR91.

| Serial warmed SQL measurement | n | p50 ms | p95/p99 ms |
| --- | ---: | ---: | ---: |
| Page offset 0 | 5 | 2.036128 | 2.578519 |
| Page offset 4,950 | 5 | 1.889522 | 1.951045 |
| Whole-assessment summary | 5 | 18.460630 | 18.749867 |
| 5,000-row scalar export | 5 | 22.652149 | 30.574047 |
| Learning history | 5 | 11.587268 | 11.823032 |

Nearest-rank p95/p99 equal the maximum at n=5. The summary, export maximum and learning samples exceed PR91; these adverse observations remain. Total time is **1,986.283389ms**; maximum database size **33,052,339 bytes**. Client RSS endpoints reach **178,941,952 bytes (170.652MiB)**, including accumulated evidence and excluding PostgreSQL/native memory. SQL timing excludes full HTTP/CSV serialization.

The distinct-solver insert takes **134.753590ms**; bulk rejudge **6.035227ms**. Recorded cluster WAL is **191,752 bytes**; separate 5.376ms EXPLAIN reports **175,394 WAL bytes**, eight temporary blocks written/zero read. These have different boundaries; original LSN endpoints are unavailable. Learning still estimates **988 versus 10,000 actual rows**. Full plans, stable query digests, rollback and cleanup remain recorded. Bounds stay at 15s statement/2s lock, 32MiB temporary files, 160MiB database and 180s soft cancellation.

Restore preserves 37 tables/2,976 reported rows, including goals and versioned assessment/Vibe history; writer-barrier and populated-goal rollback checks pass. Total **1,026.560620ms** includes dump **116.499265ms**, restore **138.561472ms** and populated rollback refusal **127.353023ms**. Both generated databases are removed. The reported dump is 270,181 bytes; its bytes are not retained. This single rehearsal establishes neither production RTO/RPO nor an offline restore replay.

### Two APIs and two workers

Eight jobs finish accepted at generation one: API participation 4+4, worker distribution 6+2, queue overlap 2/per-worker 1, quota headers 12…19. No protocol reset, retry or recovery occurs; replay/lease/XP invariants and owned cleanup pass. This host is **AMD EPYC 7763/Azure**, versus PR91's **Intel 6975P-C/AWS**.

| Eight-job interval | p50 ms | p95/p99 ms |
| --- | ---: | ---: |
| API request | 15.812 | 81.247 |
| Queue timestamp wait | 41 | 579 |
| Arrival to BullMQ finish | 485 | 10,129 |
| Worker-reported queue age | 42 | 581 |
| Total worker interval | 143.998 | 10,078.540 |

At n=8, high quantiles again equal sample maxima. Go's arrival-to-finish is **10,129ms**; BullMQ active interval 10,080ms. Raw arrival/enqueue/start/finish clocks are preserved. DB row-timestamp overlap three is not commit-time/native concurrency; worker and queue clocks have different boundaries.

Active batch: **11,176.100703ms (0.715813 jobs/s)**; scenario: **13,397.353062ms**; cleanup: **83.358242ms**; elapsed through cleanup: **13,488.428723ms (0.593101 jobs/s)**, sampled before report writing/upload. Elapsed is **4,575.511864ms / 51.34% longer than PR91's 8,912.916859ms**. Neither admitted batch measures sustainable capacity.

Endpoint RSS/peak KiB is API0 **248,676/248,676**, API1 **196,688/196,688**, worker0 **103,548/110,844**, worker1 **101,112/110,568**. Cumulative lifetime CPU is **2,200/1,990/480/430ms**, without pre-batch counters. These are neither isolated job costs nor aggregate system peaks; V8's 256MiB old-space limit does not cap process RSS. Four children exit without SIGKILL, observers drain and native caches remain empty.

### Editor and Compose

The editor retains **13 heap samples, 20 actions, 10 mock writes**; protocol **40,020.498419ms**, total **40,085.762096ms**. Edit/autosave n=10 p50/max is **1,458.040/1,816.337ms**; toggle/refocus **229.063/285.862ms**, including automation/assertions/debounce. At n=10, nearest-rank p95/p99 also equal maxima. All heap estimates remain 19.3MB used/26MB total: coarse snapshots cannot establish leak absence.

**200 Event Timing entries survive and 176 are discarded.** Retained starts span 5,039.1–20,107.3ms of the 40,022.3ms observer interval. This thresholded prefix has duration p50/p95/p99 **40/96/104ms**, maximum **120ms**; processing **0.3/63.1/81.8ms**, input delay **0.3/6.3/13.1ms**. Duration p95 exceeds PR91's 64ms. Its 49 nonzero interaction IDs are not 200 independent interactions; field INP remains null.

Compose's three warm visits give LCP candidates **[424,396,396]ms**: median 396ms, **28ms above PR91**. CLS is **[0.048731330235799154,0.048731330235799154,0.05432499885559082]**. Fifteen dependent switches have median **47.0ms**, maximum **53.7ms**, versus PR91's 47.1/49.2ms. Heap changes are **−3,509,020/−5,407,188/−5,303,292 bytes** without forced GC; decreases do not establish memory improvement. All 18 APIs return 200, with untruncated layout observers.

Six shifts expose the same footer and 24px toolbar/goal-descendant movements; the third visit includes an unlabeled box. Fonts are loaded in six snapshots, without a font-state timeline at shift time. Attribution does not identify the initiating cause. These separate finite protocols establish no population tail, causal performance change, fixed CLS, field INP or memory stability.

