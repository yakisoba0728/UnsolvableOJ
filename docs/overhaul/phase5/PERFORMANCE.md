# Phase V performance and bounded scale qualification

**Status: actual composed PR91 CI 43905864054 completed 12/12 jobs successfully, with independent QA and multi-API acceptance; its DB, enriched restore, multi-API, editor and Compose performance observations are recomputed below.** Final report publication and any later full CI remain coordinator-owned. The measurements retain distinct source stages: committed local database observations, the accepted Phase V foundation, a failed frontend candidate with a successful separate Compose observation, the corrected frontend component, and the composed PR91 source. None is presented as execution at a later final integration HEAD. No new benchmark or build was run while preparing this analysis.

The results support bounded correctness and describe the tested workloads. They do not establish a new general performance improvement, production capacity, sustained saturation, field Web Vitals or absence of memory leaks. Fresh foundation samples reuse protocols already present in Phase IV.

## 1. Exact evidence and arithmetic verification

[Foundation CI 43890166522](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43890166522) completed successfully at source `6ec519261b1103b2eadcfe0afcc0dec961353405`. The actual Actions checkout is `93b753d73b12efe2ce6e71805feca6522f7428d2`; its parents are Phase IV `d0159b1f844bf0608415dded9e84af566c8e2041` and the foundation source. Source and checkout both have tree `5588cb3e8648afed8fe10146d4da961a0ebb4035`. GitHub commit metadata and the raw artifacts independently agree on these bindings.

| Evidence | SHA256 of the original bytes |
| --- | --- |
| [Foundation Judge ZIP, artifact 14237646048](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43890166522/artifacts/14237646048) | `4eea1a0b5fb550bc2954de1a84cb684faa1e12107af43d3a1fd26e547ce090f9` |
| `phase4-mixed-capacity.json` inside that ZIP | `984a1656b15ae9e1743c217f0663486b63b4204394d3683d80cc0b5a72ab0c42` |
| [Foundation browser ZIP, artifact 14238046500](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43890166522/artifacts/14238046500) | `b436f4fe3802e47df95a20153c68900620c94759755b132aad968947c3f20571` |
| `phase3-browser-performance.json` inside that ZIP | `aae1f89bc02f3bbc18beabad0efd888bcf361764ffbae413195d9ca6366d7c2b` |
| [Committed local DB JSON](evidence/database-local-f037d5c.json) | `9d67ee4ea9cd4f1fce6e4882c6a4eefefdb48c84b789743c93e719dc05555d69` |
| [Local bundle comparison](evidence/frontend/bundle-comparison.json) | `d8b4fcc76d4d0a3c8c0233acfd62da242a438855266fef3d83a50d245b756667` |

The downloaded ZIP hashes and byte lengths match GitHub's artifact metadata. The database JSON bytes match their committed copy in local commit `9978a3ec33d551c899c9bb50415dd4cb2d030bdf`; the execution recorded inside is the earlier code commit `f037d5c91f6b9cc5561fb46a3e7ed13d0289aa77`, tree `01f16eb13077f3e12b99d34b14a5cca6b7057bef`, with an empty measured dirty-path list.

The analysis recomputed every available raw database latency quantile; Judge queue/worker-duration quantiles, jobs/s, CPU tick deltas and wave ratios; browser medians; and payload byte deltas. The Judge reports retain only per-wave/per-trial API submission summaries, so those API latency quantiles are reported as recorded and were not reconstructed from unavailable per-request raw samples. Normalized DB result hashes agree across every repeated workload.

The accompanying [performance source data](evidence/performance/performance-source-data.json) contains the recomputed values, raw timing vectors, hashes, source bindings, retained limits and separately labeled candidate stages. Actual PR91 artifacts now populate the composed qualification fields; only later publication identities remain null. The portable [verifier](evidence/performance/verify-performance.py), with its adjacent `verify-pr91.py` companion, reads retained original ZIPs, raw JSON and source snapshots relative to its own file, with no Git objects, worktree or network dependency. It checks old probe identity, arithmetic and source receipts while preserving every original foundation vector. The foundation artifacts expire on **2026-11-23**; their verified original bytes are retained alongside the report.

## 2. PostgreSQL/API scale observations

No application SQL, index or migration was changed by the database qualification stream. Existing Phase IV export-cap, snapshot and pagination behavior was reused. The new local tests add actual HTTP assertions at page 100 of 5,000 candidates and beyond the last page, plus stale-token rejection before service access and successful authentication after a new login. The corrected targeted suite passed **26 tests across five files**; the baseline suite had 25 tests across four files.

The SQL harness used PostgreSQL **17.11**, Node **24.22.1**, a shared AMD EPYC 9V74 host exposing nine logical CPUs, 64 MiB shared buffers, 4 MiB default work memory and a pool maximum of four. These read measurements are serial. Durability settings retained fsync, synchronous commit and full-page writes; WAL compression was disabled. Redis **8.10.3** served the separate HTTP tests, and is outside the SQL timing scope.

The fixed data contains 5,000 candidates with 10,000 enterprise submissions; 20,000 learning-history rows with exactly 10,000 in the window; 5,000 distinct accepted solvers for one problem; and 256 large-source rows of 32,768 bytes each. All data was synthetic and written only into a newly generated owned database. The run completed seven workloads and 31 migrations in **3,237.517 ms**, observed a maximum database size of **33,035,955 bytes**, and dropped that generated database successfully.

One warmup preceded five measured serial queries for each read. A separate EXPLAIN execution retained the complete `ANALYZE, BUFFERS, WAL, FORMAT JSON` plan. Query timings include execution, driver transfer and result decoding; CSV serialization and correctness/privacy checks are outside that SQL interval.

| Workload | Returned rows | n | p50 ms | p95 / p99 ms |
| --- | ---: | ---: | ---: | ---: |
| Enterprise page, offset 0 | 50 | 5 | 3.557 | 4.367 |
| Enterprise page, offset 4,950 | 50 | 5 | 3.191 | 4.221 |
| Whole-assessment summary | 1 | 5 | 34.497 | 98.131 |
| Complete scalar export projection | 5,000 | 5 | 47.506 | 78.465 |
| 90-day learning view over 20,000 history rows | 1 | 5 | 19.047 | 21.631 |

At `n=5`, nearest-rank p95 and p99 equal the sample maximum. The deep page's slightly lower median is ordinary shared-host sample variation, not evidence that deep paging is inherently cheaper. The unfavorable 98.131 ms summary and 78.465 ms export samples remain in the data. These figures are not HTTP throughput, steady-state capacity or production latency tails.

Independent content oracles require all 5,000 export rows, 2,500 scores of 50 and 2,500 scores of 100, average 75, and consistent global summaries. The learning oracle requires 10,000 in-window submissions, 5,000 accepted submissions, nine solved problems, eighteen attempted problems, ninety daily entries and nine review entries. Source code, hidden statements, password hashes and synthetic email addresses remain absent from result projections.

The high-cardinality insert of 5,000 accepted solver pairs took **284.859 ms** in one observation. Full aggregate and per-user multiplicity recounts matched. The entire counter relation and index occupied **638,976 bytes**, including the learning fixture's pairs; this is not an isolated bytes-per-solver estimate.

The committed 256-row rejudge took **8.383 ms** and advanced the cluster WAL position by **195,400 bytes**. Its plan reported eight temporary blocks written and zero read at the top-level update node. The reverse change inside a transaction restored all 256 solver/accepted counts, and rollback restored the committed zero-solver/zero-accepted state with 256 finished rows. The 8 MiB of logical source text was present, but TOAST references and trigger-internal behavior prevent interpreting this as 8 MiB materialized in each transition table. Plan blocks do not expose every internal temporary IO operation; cluster-LSN WAL includes checkpoint or concurrent-cluster effects if present.

Node measurement-process RSS increased across the run: paging endpoints began near **82.74 MiB**, export endpoints reached **146.75 MiB**, and later learning endpoints reached **150.42 MiB**. The client retains results and evidence; this is not PostgreSQL RSS, isolated production API RSS or a controlled memory improvement. No forced GC was used. Per-sample client CPU/RSS and unfavorable observations are retained.

Safety bounds remain: literal loopback/test/explicit disposable opt-in; one generated database; 15-second statement timeout; 2-second lock timeout; 15-second idle-transaction timeout; inherited 32 MiB temporary-file limit; 160 MiB checked database cap; and a 180-second soft cancellation deadline plus statement/cleanup bounds. The bulk step uses 64 KiB work memory. None of these statements imply production lock, pool, IO or memory qualification.

## 3. Two distinct Judge protocols in the fresh foundation artifact

The Judge ZIP contains **two different measurement datasets**:

| File | Actual measured jobs | Worker arrangement | API arrangement |
| --- | ---: | --- | --- |
| `phase2-judge-capacity.json` | 32: four trials of eight jobs | Fresh groups in order 1, 2, 2, 1; Python warmups excluded | One shared Nest API fixture |
| `phase4-mixed-capacity.json` | 24: three waves of eight jobs | Same two worker processes throughout | The same single Nest API fixture |

The raw measured submission-ID sets have **zero intersection**. They are kept separate because they use different startup/warmup/wait protocols; their throughput and latency distributions must not be pooled. The immutable [capacity test source](https://github.com/yakisoba0728/UnsolvableOJ/blob/6ec519261b1103b2eadcfe0afcc0dec961353405/Back/test/judge-capacity.pipeline-spec.ts) creates one app, submits through that app's HTTP server and gives every worker its URL. **These datasets do not establish concurrent multi-API capacity.** Multiple solver accounts are not multiple API processes.

Both datasets ran Node **24.22.2** on an Intel Xeon 6975P-C runner exposing four logical CPUs with AWS kernel `7.0.0-1014-aws`. The measured worker source and protocol are unchanged from Phase IV. Earlier tests can warm the shared native executor.

### 3.1 Four alternating one/two-worker trials

Each trial measures one job in each of eight languages after Python warmup. The 20/minute admission limit remains enabled. An observed **44,361.575 ms** admission pause is recorded outside the measured trial interval.

| Trial | Workers | Active interval ms | Jobs/s | Queue p50 ms | Queue p95 / p99 ms | Node worker CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 8,259.835 | 0.968542 | 938 | 7,920 | 90 |
| 2 | 2 | 7,421.231 | 1.077988 | 323 | 1,361 | 100 |
| 3 | 2 | 7,218.388 | 1.108281 | 89 | 661 | 100 |
| 4 | 1 | 8,415.058 | 0.950677 | 1,231 | 8,074 | 90 |

All 32 measured jobs are accepted at generation one. At eight samples per trial, p95/p99 are maxima. Worker lifetime peak RSS ranges from **110,756 to 112,572 KiB**, including startup and warmup. These are finite admitted-burst observations, not a before/after code optimization, a powered scaling study or a capacity limit. API/DB/Redis/compiler/executor resource use is not included in worker CPU/RSS.

### 3.2 Three waves on the same two workers

The separate repeated-wave protocol admits **24 jobs**, acknowledges **24**, and records **24 unique accepted generation-one results**. Each wave contains C, C++, Go, Java, JavaScript, Python, Rust and TypeScript exactly once. All queue `attemptsMade` values are one; failure, recovery and retry counters are zero. The two worker PIDs and identities remain fixed. The source additionally checks the persisted solve/XP/learning/notification invariants before declaring PASS.

| Wave | Active interval ms | Jobs/active second | Admission wait ms | Queue p50 ms | Queue p95 / p99 ms | Worker-duration p95 / p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,325.480 | 1.092079 | 43,923.153 | 97 | 598 | 6,626.025 |
| 2 | 7,084.133 | 1.129284 | 0.017 | 321 | 1,092 | 6,593.584 |
| 3 | 7,438.652 | 1.075464 | 46,038.584 | 51 | 1,019 | 6,845.960 |

Aggregate active time is **21,848.266 ms**, admission wait **89,961.754 ms**, and total wall time **112,287.051 ms**. Active throughput is **1.098485 jobs/s**; wall throughput is **0.213738 jobs/s**. Startup takes **447.302 ms** and shutdown **8.036 ms**. Active time includes submission HTTP and completion observation but excludes quota waits and separate consistency queries; wall time includes startup, waits, verification and shutdown.

Across 24 jobs, queue p50/p95/p99 is **97 / 1,025 / 1,092 ms**; acknowledged worker-duration p50/p95/p99 is **70.504 / 6,626.025 / 6,845.960 ms**. Stage durations recomputed from individual worker records are:

| Worker stage | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: |
| API claim | 3.754 | 12.878 | 15.637 |
| Judge service work | 55.009 | 6,614.937 | 6,836.464 |
| Result reporting | 6.249 | 9.069 | 9.614 |

These intervals are defined by [worker instrumentation](https://github.com/yakisoba0728/UnsolvableOJ/blob/6ec519261b1103b2eadcfe0afcc0dec961353405/Judge/src/worker.ts): queue age comes from the BullMQ timestamp, and total worker duration ends after result acknowledgement. Absolute per-job arrival→enqueue→start→finish timestamps are not retained. A population end-to-end arrival latency distribution therefore cannot be reconstructed from these records. Per-wave API submission quantiles are available in the raw report, but their raw request-duration samples are not.

Active Node-worker CPU totals **370 ms**; the before/after campaign CPU difference, including waits, is **460 ms** at 10 ms clock-tick granularity. Lifetime peak RSS is **110,780 / 110,508 KiB**, with no change across the three wave endpoints. That is a short observation of the two Node workers, excluding compiler/executor and all API/DB/Redis processes; unchanged peak RSS is not proof of long-term memory stability.

The third wave's throughput is **1.52% lower** than the first; the second is 3.41% higher. Queue maximum increases by **494 ms** in wave two and **421 ms** in wave three relative to wave one. These unfavorable observations are retained. No runtime code optimization is inferred from either favorable or unfavorable same-code variation.

## 4. Finite fault recovery observations

The same fresh Judge artifact separately preserves seven finite recovery scenarios. These are correctness/recovery observations, not fault-free throughput or production RTO/RPO. They are not part of either measured AC-only job count above.

| Scenario | Actual observation |
| --- | --- |
| Worker Redis TCP interruption plus duplicate delivery | Accepted generation one; 16 rejected connections; 2,433.879 ms case interval |
| Worker API TCP interruption/result retry | Accepted generation one; one rejected connection; 3,026.336 ms case interval; report interval 1,009.474 ms |
| Two-worker duplicate delivery during a live lease | One execution, accepted generation one |
| Worker SIGKILL and natural lease expiry | Recovery 69,676.881 ms; completion 71,902.589 ms; generation two, one recovery, stale callback 409 |
| Actual owned API SIGKILL/replacement | Restart 1,030.722 ms; completion 8,088.204 ms; three accepted submissions; one failure during downtime |
| Actual owned Redis clean restart with AOF | Restart 8,648.224 ms; completion 10,245.199 ms; four accepted submissions; one downtime request returned 500 in 452.825 ms; owned cleanup succeeded |
| Interrupted rejudge, natural recovery | Recovery 86,561.455 ms; completion 89,818.120 ms; final generation three, one recovery, XP 10 and one solve/learning/notification row; stale callback 409, duplicate final callback 200 |

The Redis test records a clean exit and AOF `appendfsync=everysec`; it explicitly does not test power-loss durability. Proxy tests interrupt owned worker links, not the service daemon. One successful execution per scenario is not a statistical recovery-success rate.

## 5. Browser observations and retained unfavorable data

The historical Phase IV foundation, final Phase IV, and fresh Phase V foundation used the identical probe:

- Git blob `50f15ac50213fbf5a874e62c689da275892a71fd`.
- SHA256 `a8e184761cc09cb1fa532834076e2034ac19a0a0526798da50ebe6607d4453c7`.
- [Immutable probe source](https://github.com/yakisoba0728/UnsolvableOJ/blob/6ec519261b1103b2eadcfe0afcc0dec961353405/Front/tests-live/learning-performance.ts).

All three use Chromium **153.0.8010.12**, a 1280×720 viewport, three warm document visits, five dependent period switches per visit, no CPU/network throttling and a synthetic fixture with two ordinary submissions. This probe captures a bounded initial LCP candidate, observed CLS and click→second verified animation-frame timing. It does not produce field LCP/INP/CLS or a real paint timestamp.

| Observation | [Phase IV foundation](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43841589126/artifacts/14213359764) | [Phase IV final](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43852089830/artifacts/14220435745) | [Phase V foundation](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43890166522/artifacts/14238046500) |
| --- | ---: | ---: | ---: |
| Initial LCP-candidate median, n=3, ms | 364 | 384 | 368 |
| Initial LCP-candidate maximum, ms | 368 | 400 | 384 |
| Observed CLS median, n=3 | 0.029427 | 0.048731 | 0.048731 |
| Observed CLS maximum | 0.029427 | 0.054325 | 0.048731 |
| Click→second verified frame median, n=15, ms | 46.6 | 45.9 | 46.8 |
| Click→second verified frame maximum, ms | 48.5 | 48.3 | 48.5 |
| INP | null | null | null |

The fresh foundation's median transition measurement is **0.9 ms higher** than the Phase IV final sample, while its LCP candidate median is 16 ms lower. Neither is a causal speedup/regression finding. Phase IV foundation versus final also changed visible content and candidate area from 6,498 to 7,410; this prevents treating that historical difference as a controlled rendering comparison. The adverse **0.019304 higher median CLS** versus the earlier foundation remains visible in both later samples. Phase IV final and Phase V foundation use unchanged application/probe code and still show run-to-run timing variation.

All recorded API responses are 200 and observer buffers report no truncation. The fresh foundation's per-visit used-heap deltas are **−13,409,080 / +6,895,664 / −2,858,052 bytes** without forced GC. Both increases and decreases remain; these are short CDP isolate-heap observations, not process RSS or evidence for/against an editor leak.

The two historical ZIPs were independently checked against their GitHub metadata and their extracted JSON bytes:

| Historical artifact | ZIP SHA256 | JSON SHA256 |
| --- | --- | --- |
| Phase IV foundation 14213359764 | `8e21922d89433c65856ae5ab4885018e7704228eaf473b60ed5d2b0c9bd19cd4` | `61d8f0ca7a1911ed974cea25157afe07abb9881ddbdb3f0face1e2300c1a955a` |
| Phase IV final 14220435745 | `333fe6f8119bf2ff947df7c95c01feca11aef3bc95df88aafcd38b44f40493fe` | `677e880c3fd1f4592a14d61bcff123a438810a6f3ddaf54fbcbeb8607c6f8493` |

## 6. Frontend payload cost

The existing [local bundle comparison](evidence/frontend/bundle-comparison.json) uses one production build per source, the same installed dependencies/lockfile and default monitoring on Node 24.22.1. Each emitted file was gzip-compressed independently at level nine with mtime zero. These exact bytes must not be mixed with earlier rounded Vite gzip output.

| Bytes | Phase IV baseline | Local candidate | Delta |
| --- | ---: | ---: | ---: |
| Initial JS module | 383,981 | 383,981 | 0 |
| Initial module gzip-9 | 123,080 | 123,079 | −1 |
| All 54 emitted JS files | 1,493,955 | 1,494,009 | +54 |
| Sum of separately compressed JS files | 489,252 | 489,331 | +79 |

The candidate's DateTimePicker and LearningGoalPanel hashes and the package-lock hash were independently matched to frontend source `4326d7febcf4f3a0e2ae819abdba7c81596b6e25`. Those are the only changed shipped frontend source files relative to Phase IV at that checkpoint. The one-byte initial gzip decrease reflects changed import hashes/compression; it is not a meaningful performance gain. The **+79-byte total compressed payload cost** remains explicit. Payload bytes do not establish browser latency.

## 7. Actual frontend and composed-source observations

### 7.1 Exact corrected-source binding

[PR89 CI 43901468081, attempt 1](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43901468081) completed successfully with **12/12 jobs**, including both browser shards and the actual Compose job. Its source is `49a3674e76f79b0d1626b12f02862825c189bdff`, actual merge checkout `8d59c05bcc2161e3088355daf63756ed655ac234`, and source/checkout tree `c90c955a3f4c8cd1e28f26a77a5845b9bf874cd1`. Checkout parents are `6d8556c07fd370ee97d7c55798286f5b2885cf4c` and the source head. The independent QA stream retained the original ZIPs and final GitHub metadata; this analysis separately checked hashes and recomputed the performance data from those bytes.

This is successful component-source CI. Its reports remain in a separate `observedCandidates` entry; the subsequent composed PR91 execution appears in sections 7.5–7.9 and original foundation vectors are unchanged. The older record's pending-stage label describes its historical checkpoint and is preserved.

| Original corrected-source evidence | Bytes | SHA256 |
| --- | ---: | --- |
| [Frontend shard-2 ZIP, artifact 14242761020](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43901468081/artifacts/14242761020) | 2,085,420 | `7a0be788d7884f53f138f64064f833832c8cd74d3baf3d6d13e6266bc788b8fb` |
| `phase5-editor-observation.json` within it | 65,666 | `6b4f1c1eb25640f01285929a7821fae79a0ee3b9934b147efe33bf5166f46cfc` |
| [Compose browser ZIP, artifact 14245410256](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43901468081/artifacts/14245410256) | 6,418 | `04fbf189a4a116e2c1fbae657467f45c282f429bd38312e8669f97e8c6ebf7bc` |
| `phase3-browser-performance.json` within it | Original bytes retained | `bb500cf61a2bed9ea8426eb935695d3c42258fcf18b320fd9a12511fd00e8461` |

The [editor probe at the measured source](https://github.com/yakisoba0728/UnsolvableOJ/blob/49a3674e76f79b0d1626b12f02862825c189bdff/Front/tests/phase5-editor-observation.spec.ts) has Git blob `2a91aef8904704f06b0bd5078460b4a12643ddda`, SHA256 `ce4d326dd25558ea8901a6b9c5811662a72287074691568e98637afd6e2f8823`. The live layout probe is schema 2, `phase5-layout-attribution-v1`, Git blob `e71e28ce217572f15c1da5c25c97998366810652`, SHA256 `ff344f39c413c56a8ae6544d22aa7c3b370491ed1154fac9a6327bfe46f5400b`. Its bytes match the failed predecessor's probe; they differ from the historical schema-1 probe in section 5.

### 7.2 Finite editor observation: actual results and material limitations

The actual Chromium `153.0.8010.12` trial used a 1280×720 viewport, the real editor and deterministic browser-routed mock persistence. There was no real backend, native executor or provider in this editor experiment. Two TypeScript fixtures began with 81 lines each. Ten cycles each performed an eight-character edit, verified one successful autosave and revision, switched files, verified the expected content, and restored editor focus. The schedule included five seconds of initial idle, ten three-second slots and five seconds of final idle.

The raw report is **PASS**, with **13 heap samples, 20 actions, 10 autosave writes, zero unexpected requests and zero page errors**. The action/autosave/sampling interval was **40,019.391 ms**, within the 45,000ms protocol budget. Observer cleanup took **85.432 ms**; the total recorded interval was **40,104.838 ms**, inside the specific test's 90-second ceiling. These bounds apply to this finite observation and do not change other test timeouts.

| Action wall interval | n | Nearest-rank p50 ms | p95 / p99 ms | Minimum ms |
| --- | ---: | ---: | ---: | ---: |
| Edit, content/focus assertions and mock autosave | 10 | 1,565.809 | 1,816.201 | 1,495.078 |
| File toggle, content/focus assertions and editor refocus | 10 | 210.676 | 385.669 | 125.418 |

For each ten-sample action group, nearest-rank p95 and p99 are its maximum. Arithmetic medians, using the average of the two middle values, are **1,570.215 ms** and **244.580 ms** respectively; they are retained separately to avoid confusing that convention with nearest-rank p50. The two action groups are not pooled. These Node-monotonic intervals include automation, assertions and the mock autosave debounce; they are not browser processing or paint latencies and do not establish an input-response speedup.

All thirteen `performance.memory` snapshots report **19,300,000 used bytes**, **26,000,000 total bytes** and a **3,760,000,000-byte browser-reported heap limit**. The thirteen-sample nearest-rank p50/p95/p99/min/max are therefore identical for each field. All twelve adjacent used-heap differences, the ready-to-final difference and the post-idle-baseline-to-final difference are zero. The browser remained visible throughout.

These equal, coarse nonstandard heap estimates are a **measurement limitation**. They do not show zero allocation, isolate editor memory, establish a leak or establish absence of leaks. The reported heap limit is a browser estimate, not a measured CI/process resource cap. No GC was forced, and this approximately forty-second trial does not establish long-duration memory behavior.

**The Event Timing buffer was truncated: 200 entries were retained and 176 later delivered, filtered entries were discarded.** The browser observer interval was 40,022.600ms, but retained entry start times cover only **5,065.400–20,241.800ms** after probe installation. The following quantiles describe that retained early subset only; they do not describe the full forty-second session or all twenty actions.

| Retained thresholded Event Timing data | n entries | Nearest-rank p50 ms | p95 ms | p99 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Browser-reported event duration | 200 | 48 | 96 | 104 | 104 |
| `processingEnd − processingStart` | 200 | 0.2 | 70.7 | 87.8 | 92.6 |
| `processingStart − startTime` | 200 | 0.3 | 4.6 | 11.7 | 23.6 |

The requested duration threshold is 16ms, and recorded event durations have 8ms granularity. There are 175 editor-region and 25 file-tab-region entries, covering 49 distinct nonzero interaction IDs; several event entries belong to the same interaction, and other entries use zero IDs. They are not 200 independent interactions. The threshold excludes faster events, and the full buffer excludes later entries. **Field INP remains null.** No full-session tail distribution, population p95/p99, interaction-level INP or before/after latency claim is derived. Browser and Node measurements also have nearby but different monotonic time origins, so their absolute offsets are not combined.

### 7.3 Corrected-source Compose layout attribution

The actual Compose browser report uses the same production Compose fixture, Chromium version, viewport and warm three-navigation/fifteen-switch schedule as recorded in section 5. All 18 API responses are 200; observer buffers and exposed source lists report no truncation. This is distinct from the editor's truncated 200-entry buffer.

| Corrected-source Compose observation | Actual values |
| --- | --- |
| Initial LCP candidate, n=3 | `[368, 368, 368]` ms; median and maximum 368ms |
| Initial observed CLS, n=3 | `0.048731330235799154` in all three |
| Click to second verified frame, n=15 dependent switches | Median **46.9ms**; maximum **52.1ms** |
| Per-navigation CDP used-heap deltas | **−2,055,940 / −5,638,388 / +6,498,316 bytes** |
| INP | `null` |

Each navigation has two non-recent-input shift events. The first exposes `.site-footer`, previous viewport rectangle `(30, 644, 1220, 76)` and current rectangle `(0, 0, 0, 0)`, at 337.300, 338.400 and 337.500ms. Its event score is `0.04548344612121582`. The second occurs at 357.100, 349.300 and 346.800ms with score `0.003247884114583333`; it exposes `.learning-toolbar` moving from y=412.671875 to 436.671875 and a descendant labeled `.learning-goal` moving from y=327.671875 to 351.671875, **24px each**. The goal-labeled source is a 1,130×40 descendant, not the outer panel's rectangle. The two event scores reproduce the recorded CLS in each navigation.

Initial and final snapshots contain the same shift entries, so there are six events total, not twelve. All six snapshots have the same region geometry and document dimensions, 1280×1759, with the footer at y=1683.234375, below the 720px viewport. A zero current attribution rectangle is not the footer's final document position or proof of its removal. Initial snapshots occur at 910.2–914.5ms and final snapshots at 1589.9–1611ms. No additional shift was recorded during the bounded period-switch windows.

Fonts are `loaded` in all six snapshots, but font state was not recorded at the earlier shift timestamps. This evidence neither establishes nor excludes a font-related initiating cause. Fixed ancestor labels and source rectangles identify impacted elements; they do not identify the earlier content change that initiated movement. The source label list is not a causal decomposition of an event score.

Relative to the accepted foundation, the corrected sample has the same 368ms LCP median and the same CLS median, a **0.1ms higher switch median** and a **3.6ms higher maximum switch interval**. Relative to the failed predecessor, LCP/CLS are lower while the maximum switch interval is **2.1ms higher**. The positive third-visit heap delta and these adverse switch values remain explicit. Same-probe sample variation, changed schema-1/schema-2 measurement work, small dependent samples and uncontrolled CI conditions prevent causal speedup/regression, memory-improvement or fixed-CLS claims.

### 7.4 Failed predecessor remains separate

[Run 43898203434](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43898203434), source `500329305615070e4e9edbde0ca9215539ed1cc4`, checkout `a996275996d543b89e0bd72c140bc993fe71df56`, tree `e0b79def06480dc462754b5cc039e25b48df37db`, remains **failed overall: nine jobs succeeded and both browser shards plus CI required failed**. Its separately successful Compose observation is retained with stage `FAILED_FRONTEND_CANDIDATE_WITH_SUCCESSFUL_COMPOSE_OBSERVATION`, not overwritten by the corrected run. The earlier attribution ZIP is [artifact 14241522019](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43898203434/artifacts/14241522019), SHA256 `01de99918f84e54faf18c483d3706fef71e8083f5b791e3cbfe109ea534eef1e`; JSON SHA256 `11eb9eda1a5673215f2bd86df6bcae45287cd39437752f307b799c367114841e`. Its raw LCP `[392,388,416]`, CLS `[0.05432499885559082,0.05432499885559082,0.048731330235799154]`, 46.8ms switch median and 50ms maximum remain in the source dataset. The first two visits additionally exposed an unlabeled shifted box; that difference does not retrospectively identify a cause.

### 7.5 Exact composed PR91 source and retained artifacts

[PR91 CI 43905864054, attempt 1](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054) completed with **12/12 successful jobs**. Source `281d0f1a30cd772cf7417e3affb8c98be252f405` and actual checkout `9aa843fad33b30270ab346bc62c4865c17697ff3` share tree `0f191c89a17b984cae8706cb02137ab0e4e2c3a4`. Checkout parents are base `e8b08d6ab86181859d9491d15d1881a6b10262eb` and that source. The retained [GitHub metadata](evidence/performance/observed-candidates/43905864054/github-metadata.json) has SHA256 `b19d8cad682ff1601c6dcf29b09b47439c93efe4ec1ecd71eebdcc829e27386f`. This performance recomputation is separate from the QA and Security acceptance receipts; green job status alone was not used as semantic acceptance.

The actual formats are **DB qualification schema 1, enriched restore schema 2 and multi-API schema 1**. The earlier planning slot that anticipated schema 2 for DB qualification was incorrect. Each ZIP below matches the original artifact's GitHub size and digest, and each extracted JSON matches its ZIP member exactly.

| Original composed-source artifact | ZIP bytes | ZIP SHA256 | JSON SHA256 |
| --- | ---: | --- | --- |
| [DB qualification 14244922097](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054/artifacts/14244922097) | 18,137 | `0bfc67d9f0d4d4364fffb6c42bacc8765033129b3296334153e40d76cfa6d38a` | `6e0122375e083564564e99ea134c4159809aa2decd58bffb133d51e2d7230a67` |
| [Enriched restore 14245512021](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054/artifacts/14245512021) | 2,263 | `7b848a59bf71babcd757b1b4bf9f508234ff6499b226321569522bac3255f20a` | `5fb52eed038d766de4ba7bc54ecbd315591853465f5a264424f02158d1c1d965` |
| [Multi-API 14246816098](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054/artifacts/14246816098) | 5,265 | `0f3294c747851ff1650dc61a371457e864a6d9074ce9958901a1db1b356f627d` | `aa59b7edaab1aefc9e763b6eb9723a4c6f5ce5274ce980933dba162e4cbf3d99` |
| [Frontend shard 2 / editor 14244698713](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054/artifacts/14244698713) | 2,085,369 | `493d46fff37a6dec5be608746dda676141735457a452de334ca5dfead0f1873b` | `ced30244f507f6b8d5388b497004bf1163ef8a53bea217ce272cbd7ab19a0e5b` |
| [Compose browser 14245879774](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054/artifacts/14245879774) | 6,679 | `2528d6771ce4524f8a6a5c18da5a188770ff38eb437c7e08c5c90ec65e3cb3df` | `2bd71b7aa203a091feacb3505e357a6aeefccbb14dee4aa6e5fdf0424be27dd9` |

The full raw reports and source snapshots are retained under [the PR91 evidence directory](evidence/performance/observed-candidates/43905864054/). They are separate experiments in different CI jobs, not a simultaneous DB/editor/multi-API load campaign. Final report commit, later integration run and final stacked-PR identities must be recorded by the coordinator without relabeling these measurements.

### 7.6 Actual CI database qualification

The [actual DB report](evidence/performance/observed-candidates/43905864054/phase5-database.json) records seven workloads, 31 migrations, the same finite fixture as section 2 and successful generated-database removal. Total time was **1,808.688ms**, maximum recorded database size **33,068,723 bytes**. Nine named stage intervals sum to 1,677.502ms; the remaining 131.186ms is outside those recorded intervals and is not assigned a synthetic stage.

All five measured source-file hashes, including the harness and query/export/learning/statistics sources, match the local `f037d5c` observation. The CI environment differs: Node **24.22.2**, PostgreSQL **17.11**, Intel Xeon 6973P-C with four exposed CPUs and Azure kernel `7.0.0-1017-azure`; shared buffers are **128MiB**, work memory 4MiB and maximum connections 100. Durability remains enabled and WAL compression disabled. The retained [workflow source](https://github.com/yakisoba0728/UnsolvableOJ/blob/281d0f1a30cd772cf7417e3affb8c98be252f405/.github/workflows/ci.yml) declares PostgreSQL **512MiB / one CPU / 256MiB data tmpfs** and Redis **128MiB / one CPU / 64MiB data tmpfs**. These declarations are resource caps, not measured peak resource use.

| Read workload | Raw measured milliseconds, in observation order | p50 ms | p95 / p99 ms | Separate EXPLAIN execution ms |
| --- | --- | ---: | ---: | ---: |
| Page offset 0, 50 rows | 2.551315, 2.783551, 2.098823, 1.998773, 1.970036 | 2.098823 | 2.783551 | 1.423 |
| Page offset 4,950, 50 rows | 2.023505, 1.973044, 2.010542, 1.934360, 1.882839 | 1.973044 | 2.023505 | 1.686 |
| Whole-assessment summary, one row | 16.760925, 16.628443, 16.757751, 16.548891, 16.521056 | 16.628443 | 16.760925 | 19.045 |
| Scalar export, 5,000 rows | 21.392291, 29.056744, 21.404702, 22.698310, 22.852138 | 22.698310 | 29.056744 | 12.978 |
| Learning history, one row | 10.680250, 10.510914, 10.464971, 10.333293, 10.377798 | 10.464971 | 10.680250 | 13.204 |

Each row has one warmup then five serial driver-level measurements and a stable repeated result digest; the independent content oracles pass. **At n=5, both nearest-rank p95 and p99 are the sample maximum.** The lower CI values versus the local host are not a controlled optimization result. Source hashes are unchanged, hosts/settings differ, and the observations are too small to support a production tail or throughput claim.

Full `ANALYZE, BUFFERS, WAL` plans remain in the raw report. Top-level read plans report shared hits **359 / 359 / 10,138 / 10,235 / 252**, respectively, with zero shared reads, temporary blocks and WAL at those top nodes. Parent and child buffer counts are not summed. The shallow candidate sort uses top-N heapsort for 50 rows and 31KiB; the deep sort materializes 5,000 rows with quicksort and 857KiB. Existing `submissions_attempt_idx` and `idx_submissions_user_created` indexes are used. The learning bitmap heap scan estimates **988 rows and observes 10,000**; this unfavorable estimate remains explicit. It identifies a fixture-specific estimation discrepancy, not a demonstrated production bottleneck or a justification for a speculative index.

The five groups' summed client CPU samples are **4.814 / 3.377 / 2.055 / 90.507 / 1.211ms**. Paging RSS endpoints range from 113,848,320 to 117,780,480 bytes; export endpoints reach **179,945,472 bytes**, and learning endpoints reach **186,789,888 bytes (178.137MiB)**. These are Node measurement-process endpoint samples while results/evidence accumulate. They exclude PostgreSQL RSS and cannot establish an isolated API memory cost, peak service memory or memory improvement.

The single 5,000-distinct-solver insert takes **122.624ms**; recounts match 5,000 solvers, accepted and finished rows. The full counter relation occupies **638,976 bytes**, including other fixture rows. The committed 256-row rejudge takes **6.223496ms**, with recorded cluster WAL growth **184,376 bytes**. Its separate plan runs in **5.630ms**, reports **168,050 WAL bytes**, 1,544 WAL records, zero full-page images and **eight temporary blocks written / zero read** at the top node; trigger time is 3.255ms for one call. The cluster and plan values have different measurement boundaries. Original cluster LSN endpoints are not retained, so the offline verifier checks the recorded value and artifact integrity, not a new LSN subtraction. The bulk index scan estimates one row and observes 256. Rollback restores the committed state of zero solvers/accepted rows and 256 finished rows.

The same 15-second statement, two-second lock, 32MiB inherited temporary-file, 160MiB checked database and 180-second soft cancellation bounds apply. Bulk work memory is 64KiB; the logical large-source fixture is 8MiB. TOAST/materialization and trigger-internal temporary IO remain incompletely observed. This run does not measure concurrent DB pool saturation, HTTP/CSV serialization or a causal before/after improvement.

### 7.7 Actual schema-2 restore and rollback rehearsal

The [enriched restore report](evidence/performance/observed-candidates/43905864054/phase4-restore.json) passes at the same actual checkout. Its synthetic fixture has **128 users, 24 problems and 2,056 submissions**: 2,048 ordinary plus eight assessment submissions. It includes 12 learning goals, 24 problem versions, 128 solve records, one assessment with eight candidates, one algorithm pin, one Vibe pin, eight workspaces and sixteen revisions. XP/ledger, solve evidence, submission ownership/version and workspace ownership/version invariants all pass.

A **SHARE barrier on 37 tables** refused the concurrent test writer and remained held through dump. All 37 table fingerprints are retained, with 18 nonempty tables and **2,976 reported rows in total**. Column/index/trigger/non-CHECK definitions and flags match; CHECK expressions use the recorded stable parser normalization. Source and restored database sizes are **11,278,003 / 11,589,299 bytes**, below the 64MiB cap for each.

| Single rehearsal stage | Milliseconds |
| --- | ---: |
| Fresh migrations | 78.707 |
| Empty final-migration rollback and reapply | 9.119 |
| Bounded fixture | 70.919 |
| Stop-writer barrier | 102.187 |
| `pg_dump` | 124.624 |
| `pg_restore` | 142.817 |
| All restored table fingerprints | 57.975 |
| Schema comparison | 66.606 |
| Migration ledger | 1.877 |
| Populated-goal rollback refusal and product-history preservation | 126.569 |
| Restored write and statistics check | 7.027 |
| Cleanup | 17.046 |

Total recorded time is **1,027.631ms**. Stage intervals sum to **805.471ms**, leaving **222.160ms** outside those intervals. Empty rollback/reapply and refusal to drop populated learning goals are distinct observed cases. Both generated databases were removed.

The report records a **270,084-byte dump**, SHA256 `4b7b3024c42252b5048195635c2d6849154306dbedc2b1929ab6ae1c475e3b36`. The retained ZIP contains the report, **not that dump archive or the database rows**. Offline verification checks report integrity, counts and arithmetic; it cannot recompute row fingerprints or replay restore without the original runtime data. These single-case timings are neither production RTO/RPO nor estimates for large backups, migration locks or backfills. Synthetic product consistency does not substitute for live authentication/award API execution.

### 7.8 Actual bounded two-API / two-worker execution

The [multi-API report](evidence/performance/observed-candidates/43905864054/phase5-multi-api.json) records **two actual `dist/main.js` API children and two actual Judge worker children**, zero in-process Nest fixtures, one shared database/Redis/native executor, one ordinary solver, eight languages and three finite admission lanes. Each API accepts four requests; worker distribution is **six plus two**, with concurrency one per worker. The source fixtures and all eight observed/persisted source hashes agree. This closes the missing bounded multi-API execution observation; sustained capacity remains unmeasured.

The 20-per-minute admission rule remains enabled. Remaining quota headers are exactly **12 through 19**, with one reset before setup and zero resets or retries during the protocol. All eight submissions return 202, finish accepted at generation one, and have one started/completed queue attempt, zero recoveries, one learned row and one notification each. Opposite submitting-API reads agree. Cross-worker-API terminal claims return 409 and duplicate callbacks return 200; the active Go lease rejects claims through both APIs with 409 while preserving ownership. Persistence contains eight submissions/learned rows/notifications and **one solve with one ten-XP award**. No outage or provider call is part of this scenario.

This full-job host is Node **24.22.2**, Intel Xeon 6975P-C, four exposed CPUs, AWS kernel `7.0.0-1014-aws`, with 100Hz process ticks; it differs from the backend job host. The first arrival epoch is **1,794,846,143,056ms**, or `2026-11-16T16:22:23.056Z`. All following queue-clock columns are millisecond offsets from that arrival, recomputed from the retained absolute timestamps:

| Language | Submitting API | Worker | Arrival | Queued | Started | Finished | Arrival → finish |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C | 0 | 0 | 0 | 26 | 29 | 125 | 125 |
| C++ | 1 | 0 | 0 | 52 | 125 | 449 | 449 |
| Java | 0 | 1 | 0 | 37 | 38 | 1,099 | 1,099 |
| Python | 1 | 0 | 165 | 176 | 449 | 482 | 317 |
| JavaScript | 0 | 0 | 482 | 490 | 490 | 548 | 66 |
| TypeScript | 1 | 0 | 495 | 516 | 548 | 592 | 97 |
| Go | 0 | 0 | 602 | 612 | 613 | 7,309 | 6,707 |
| Rust | 1 | 1 | 632 | 643 | 1,099 | 1,408 | 776 |

Observed queue-interval overlap is **two**, and each worker's maximum is **one**. Database `createdAt → updatedAt` row intervals overlap by three. Those row timestamps are not transaction-commit timestamps or proof of three simultaneous native executions. API request timers and worker stage timers use their own monotonic clocks and are not substituted for queue timestamps.

| Eight-job distribution | Nearest-rank p50 ms | p95 / p99 ms |
| --- | ---: | ---: |
| API request wall interval | 13.681 | 55.870 |
| Arrival → enqueue | 11 | 52 |
| Queue timestamp wait | 3 | 456 |
| BullMQ active interval | 96 | 6,696 |
| Arrival → BullMQ finish | 317 | 6,707 |
| Worker-reported queue age | 6 | 457 |
| Total worker interval | 92.138 | 6,695.459 |
| API claim stage | 6.694 | 27.100 |
| Judge stage | 58.651 | 6,677.617 |
| Result-report stage | 9.360 | 15.367 |

At **n=8**, p95 and p99 again mean only the observed maximum. Queue timestamp wait and worker queue age begin/end at different instrumentation boundaries. The long Go interval and unequal six/two distribution are retained; these eight heterogeneous fixtures do not yield a population tail or language performance ranking.

The active admission/completion batch lasts **7,361.630ms**, giving **1.086716 jobs per active second**. The scenario is **8,864.358ms**, cleanup **44.566ms**, and recorded elapsed time through cleanup **8,912.917ms**, giving **0.897574 jobs per recorded second**. The latter is sampled **before report writing/upload**, so it is not complete job wall time. The first-arrival to last-queue-finish span is 7,309ms, a third distinct interval. HTTP, polling and opposite-API consistency checks are included according to the retained harness boundaries. These rates describe one admitted batch, not saturation or sustainable capacity.

| Owned child | Endpoint RSS KiB | Lifetime peak RSS KiB | Cumulative user/system ticks | Cumulative CPU ms |
| --- | ---: | ---: | ---: | ---: |
| API 0 | 246,820 | 246,820 | 133 / 12 | 1,450 |
| API 1 | 196,528 | 196,528 | 116 / 12 | 1,280 |
| Worker 0 | 104,056 | 110,636 | 30 / 3 | 330 |
| Worker 1 | 101,080 | 110,852 | 25 / 3 | 280 |

These are one procfs endpoint per child. CPU counters include process startup/setup and have no paired pre-batch sample; they are **not isolated per-job CPU costs**. Per-completion CPU counters are also cumulative and must not be summed over jobs. Child RSS excludes PostgreSQL, Redis, native compiler/executor and host memory; independent lifetime peaks must not be summed as a simultaneous system peak. The `--max-old-space-size=256` child setting caps V8 old space, not whole-process RSS. Actual API listeners were bound by PID/socket inode to `127.0.0.1`; this is owned-test listener evidence, not production network-isolation qualification.

The finite action deadline is 45 seconds, with an existing 90-second test ceiling, 84-second total harness budget, bounded cleanup/observer commands and native compile/run limits recorded in the source/report. Eight owned queue jobs were removed; both workers exited normally and both APIs exited after SIGTERM, with **no SIGKILL**. Two observer sets drained with destroyed PostgreSQL sockets, ended Redis connections, zero pending requests and no force-close failures. The native cache was empty before and after. This verifies the owned scenario's cleanup, not every surrounding service's resource lifecycle.

### 7.9 Fresh composed-source editor and Compose observations

PR91 also supplies fresh samples of the **byte-identical editor and schema-2 layout probes** used by corrected PR89. Their complete raw vectors are retained separately; earlier favorable and adverse observations remain unchanged. Both still use Chromium `153.0.8010.12` at 1280×720.

The editor reports **13 heap samples, 20 actions and 10 successful mock writes**, zero unexpected requests and zero page errors. Protocol time is **40,016.477ms**; total recorded observation is **40,075.255ms**. The ten edit/autosave intervals have nearest-rank p50 **1,393.715ms**, p95/p99 **1,523.223ms**; the ten toggle/refocus intervals have p50 **168.979ms**, p95/p99 **257.978ms**. These include the same automation/assertions/debounce and remain separate distributions.

All thirteen heap samples again report 19,300,000 used bytes and 26,000,000 total bytes, with the same browser-reported 3,760,000,000-byte limit. **The Event Timing buffer again retains 200 entries and discards 176 later entries**: retained start times are only 5,059.100–20,142.400ms within the 40,021.300ms browser observer interval. The retained thresholded prefix has duration p50/p95/p99 **40 / 64 / 72ms**, processing **0.2 / 43.8 / 57.0ms**, and input delay **0.3 / 3.3 / 12.8ms**. It again represents 175 editor-region and 25 file-tab entries, 49 nonzero interaction IDs, not 200 independent interactions. Flat coarse heap values, discarded events and the distinction between browser and Node clocks remain material limitations. Field INP is null; no full-session latency tail or leak conclusion follows.

| Fresh PR91 Compose observation | Values |
| --- | --- |
| Initial LCP candidates, n=3 | `[368, 368, 368]` ms |
| Initial CLS, n=3 | `[0.048731330235799154, 0.05432499885559082, 0.048731330235799154]` |
| Fifteen dependent click-to-second-frame intervals | Median **47.1ms**, maximum **49.2ms** |
| Per-navigation CDP used-heap changes | **−13,713,112 / −5,679,760 / +7,826,396 bytes** |
| API/observer state | All 18 responses 200; layout buffers/source lists not truncated; INP null |

Six layout shifts remain, two per navigation. The footer event score is 0.04548344612121582 each time. Toolbar and goal-labeled descendants move 24px; the second visit additionally exposes the unlabeled box and has a second-event score of **0.008841552734375**, versus 0.003247884114583333 on the other visits. This reproduces its higher **0.054325 CLS**. Region snapshots remain identical before/after the switch window, with document dimensions 1280×1759 and the footer below the viewport. Fonts are loaded in all six sampled states, without a font-state timeline at shift time. The adverse second-visit CLS and positive third-visit heap delta remain visible.

The switch median is 0.2ms above corrected PR89, while its maximum is 2.9ms lower. These and the lower editor timing samples describe run variation under unchanged probes. They do not establish a causal performance gain, fix the CLS cause, prove memory stability or convert the new schema-2 work into a controlled comparison with historical schema-1 measurements. All actual composed evidence slots are now populated; only subsequent integration/publication identities remain coordinator-owned.

## 8. Scope that remains unestablished

- Sustained multi-API capacity/saturation, long mixed API/XP/Judge load, pool exhaustion and long-term resource bounds. The eight-job concurrent observation in section 7.8 establishes only that finite protocol.
- Compiler/executor CPU/RSS, PostgreSQL/Redis process CPU/RSS and isolated API resource attribution. The new eight-job protocol retains full arrival/queue clocks and endpoint API/worker counters; the historical 24/32-job reports still lack those absolute per-job clocks.
- A newly controlled baseline/candidate optimization comparison; no speculative index/schema change was introduced to manufacture one.
- Field Core Web Vitals, long editor sessions, manual accessibility/real-device qualification and memory-leak conclusions.
- Production-scale migration locks, backfills, backup size, RTO/RPO, host/VM/network isolation and operating certificate controls.

These remaining questions require representative experiments beyond the recorded finite protocols. Production operations require the separately approved external environment. Green correctness CI and reproducible arithmetic do not convert the observations into a production-readiness claim.
