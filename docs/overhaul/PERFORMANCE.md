# Performance results and reproducibility

Measurements below are component experiments or bounded local observations. No browser loading improvement, platform capacity, Judge jobs/second or queue-wait guarantee is inferred from them. Environment: Node24.22.1, Linux6.18.57 x86_64, AMD EPYC9V74 host with9logical CPUs exposed; shared hardware. Native DB experiments use PostgreSQL17.11/Redis8.10.3. Every reported before/after pair uses the same fixture/settings within its experiment.

## Actual baseline versus combined frontend build

The coordinator rebuilt original baseline application source and integrated frontend source with identical dependencies and explicit disabled/enabled synthetic monitoring configurations. Measurements are exact entry bytes and Python gzip level9 bytes; these differ from Vite's display compression and should not be mixed with it. The enabled DSN is a synthetic build input; no running application contacted that host.

| Configuration / metric | Before | Integrated | Change |
|---|---:|---:|---:|
| disabled / entry bytes | 377,840 | 381,313 | +0.92% |
| disabled / entry gzip bytes | 121,072 | 122,285 | +1.00% |
| enabled / entry bytes | 472,421 | 381,348 | -19.28% |
| enabled / entry gzip bytes | 154,558 | 122,310 | -20.86% |

Baseline frontend source tree: `e5f28a68bd115fced30bd2881288253a827cfc8b`; integrated tree: `05948aee32bf0d620f75d5ff45fc3a73b39a96e2`. Raw four-build results: [frontend-bundles.json](measurements/frontend-bundles.json). The enabled SDK is deferred into92,991bytes /32,143gzip bytes. Initial plus optional SDK is474,339bytes versus472,421before: **total code grows slightly**, while initial configured entry shrinks. The default entry grows3,473bytes due to correctness/lifecycle logic; no default bundle reduction is claimed. The emitted optional asset is not requested when disabled or on protected email routes, as covered by privacy tests.

This final comparison includes all notification and invitation UX fixes. FRONTEND.md also records a separate earlier isolated telemetry experiment from58784a4; its380,815byte entry is not the final integration artifact. The final source measurements above supersede that number for overall before/after reporting.

Reproduce by building both source versions with `VITE_SENTRY_DSN=` and with `VITE_SENTRY_DSN=https://benchmark@example.invalid/1`, running `npm run build --prefix Front`, finding the module script in `Front/dist/index.html`, and measuring it plus `monitoringSdk-*.js`. Use the same gzip level and lockfile. No real-browser navigation/render/Core Web Vitals timing was measured.

## Judge comparison algorithm

Five fresh child processes per fixture/algorithm; alternating execution order. CPU is user+system CPU around comparison. RSS is the whole child high-water mark. The verdict/output semantics are checked separately by differential tests.

| Fixture | Before ms/op | After ms/op | Before CPU ms/op | After CPU ms/op | Before RSS KiB | After RSS KiB |
|---|---:|---:|---:|---:|---:|---:|
| Ordinary100lines |0.1095|0.0771|0.1465|0.1210|47,260|46,136|
|999,999newline bytes|587.9439|3.7263|666.7380|6.4550|279,924|43,056|
| Dense short lines|289.6901|58.7161|379.5530|70.8320|186,620|48,944|
| Single long line|7.3579|0.2344|9.9750|0.2930|46,516|42,552|

Command: `npm run benchmark:output --prefix Judge`. Source/raw: [benchmark-output.mjs](../../Judge/scripts/benchmark-output.mjs), [output-comparison.json](../../Judge/benchmarks/output-comparison.json). Constant auxiliary state removes line-count allocation amplification. Compiler/runtime time, queue wait and full worker throughput are excluded.

## Database and result assembly

| Metric / fixed fixture | Before | After | Tradeoff / evidence |
|---|---:|---:|---|
| Saved/voted profile SQL: voted median ms |8.542|0.790|3warmups,7EXPLAIN samples,1connection |
| Saved profile SQL median ms |7.797|0.854|Same ordered response digest |
| Shared buffer hits, each query |1,688|195|Zero shared reads in warmed samples |
| Enterprise10kcandidate assembly median ms |541.403503|7.006376|5fresh processes per mode;8,571project rows; identical complete payload hashes |
| Enterprise assembly CPU ms |543.068|10.061|Excludes SQL/HTTP/serialization |
| Enterprise assembly process RSS KiB |75,356|76,996|**+1,640KiB** for indexing/result setup |

The SQL dataset contains10kusers,2kposts and200kvotes+200ksaved relations. The actual migration was applied between plans. Each new index uses9,961,472bytes in this fixture; write throughput/index-build production lock cost remain unmeasured. No table/schema shape is redesigned.

Commands after Back build: `node Back/scripts/benchmark-enterprise-scores.mjs` and, against an explicitly disposable local PostgreSQL instance, `UNSOLVABLE_BENCHMARK=1 node Back/scripts/benchmark-community-indexes.mjs`. Source/raw JSON under `Back/scripts/` and `Back/benchmarks/`; DATABASE.md contains exact settings, SQL, plans and interpretation.

## Bounded HTTP comparison on the integrated backend source

Endpoint: anonymous `GET /api/v1/problems?limit=20`,2,000synthetic published problems. This endpoint was **not** optimized by the implementation; its observations check basic load behavior. Separate API/client processes, one shared host. Three fresh API processes per source, each with20warmups and3×80requests at concurrency1/8/32. Order: baseline1,integrated1,integrated2,baseline2,baseline3,integrated3. Each table cell is the median of9rounds. Before and integrated source trees are recorded in [http-comparison.json](../../Back/benchmarks/http-comparison.json).

| Concurrency / metric | Before median | Integrated median |
|---|---:|---:|
| 1 / p50 ms | 5.070 | 4.779 |
| 1 / p95 ms | 7.154 | 7.249 |
| 1 / p99 ms | 11.376 | 10.861 |
| 1 / observed requests/s | 190.899 | 196.167 |
| 1 / API CPU % of one core | 43.027 | 45.611 |
| 1 / API lifetime peak RSS KiB | 181,080.000 | 172,740.000 |
| 8 / p50 ms | 13.104 | 11.883 |
| 8 / p95 ms | 21.258 | 17.759 |
| 8 / p99 ms | 24.978 | 19.831 |
| 8 / observed requests/s | 568.135 | 649.019 |
| 8 / API CPU % of one core | 104.627 | 92.262 |
| 8 / API lifetime peak RSS KiB | 211,804.000 | 198,168.000 |
| 32 / p50 ms | 38.503 | 39.352 |
| 32 / p95 ms | 72.158 | 62.203 |
| 32 / p99 ms | 79.429 | 64.033 |
| 32 / observed requests/s | 627.115 | 664.843 |
| 32 / API CPU % of one core | 101.906 | 108.566 |
| 32 / API lifetime peak RSS KiB | 243,572.000 | 241,744.000 |

All4,320 normal measured requests returned200 (720per process ×6processes). Each separate160-request rate-limit burst returned100×200 and60×429; six bursts were asserted. Warmups were excluded. The harness clears only rate counters in its initially empty disposable Redis DB between rounds so the documented100/minute control does not invalidate normal measurements. This is disclosed experiment setup, not a production rate-limit change.

The shared host shows substantial variability. At concurrency32, individual p95 samples range39.195–136.607ms before and33.894–290.159ms after. Accordingly **no statistically supported API speedup, stable latency regression bound or production capacity claim is made**. A previous single pair showed an apparent high-concurrency slowdown; repeated alternating processes exposed the variance, and every repeat is preserved rather than selecting a favorable sample. The median API RSS is slightly lower at concurrency32 but is not proof of lower total platform memory.

CPU uses API-child `/proc` ticks and can exceed100% of one core; it excludes load generator, PostgreSQL and Redis. RSS is that API process's lifetime high-water mark, including earlier rounds/warmup, not per-round allocation. No sustained saturation, hours-long soak, mixed authenticated traffic or network/CDN cost was tested.

Reproduce: build Back, provision a fresh local PostgreSQL and empty disposable Redis, set `NODE_ENV=test`, `OJ_DISPOSABLE_BENCHMARK=1`, a plain loopback `DATABASE_URL` without query overrides, local `REDIS_HOST/PORT/DB`, `EMAIL_ENABLED=false`, `EMAIL_WORKER_ENABLED=false`, empty `OPENAI_API_KEY`, and synthetic test JWT/Judge credentials. Run `node Back/scripts/benchmark-http.mjs`. The script creates/drops only its random benchmark database, runs actual migrations, and shuts down its API child. It rejects nonempty Redis and inappropriate targets. Independent safety evidence is [http-safety-review.json](../../Back/benchmarks/http-safety-review.json); request accounting, signals and cleanup were tested separately.

## Explicitly unmeasured

| Metric / objective | Status |
|---|---|
| Mixed-language native Judge jobs/s, queue p50/p95/p99 |N/A |
| End-to-end compiler/sandbox overhead under concurrency |N/A |
| Whole-platform CPU/RSS, network and DB resource cost under sustained traffic |N/A |
| Production-like request/error distribution and sustained saturation |N/A |
| Browser load/render/Core Web Vitals and slow physical devices |N/A |
| Index maintenance write cost, production migration lock duration |N/A |

These remain bounded follow-up work, not invented improvements. Correctness/security changes intentionally add selected checks/roundtrips; performance claims above apply only to the measured paths.
