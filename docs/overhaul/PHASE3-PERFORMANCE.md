# Phase III measurements and their limits

The new performance claim is the controlled problem-statistics SQL comparison.
Frontend bundle sizes record a feature delivery cost. Browser observations are a
separate finite lab protocol; none of these measurements establishes production
capacity, Judge jobs/s or field Web Vitals.

## Popular-problem statistics write path

The original trigger recomputed a problem's complete submission history for each
terminal write. The new migration applies statement deltas and maintains accepted
problem/user multiplicities. API count definitions and the fixed measured work
remain the same. The benchmark retains the original recount implementation on the
current schema; it does not compare two complete application deployments.

The final source-bound experiment has 1,000/10,000/50,000 historical rows for one
problem, 200 users, 140 historical accepted pairs, 64 target completions and at
most four clients. Each size uses baseline/candidate/candidate/baseline order.
Warmup, explicit vacuum and fixture setup are outside timing. All measured states
match a full-recount oracle. The shared host and repeated use of the same backends
are explicit limitations.

PostgreSQL17.11 uses 64 MiB shared buffers and 4 MiB work memory. fsync,
synchronous commit and full-page writes remain enabled. Fixture autovacuum is
disabled, WAL compression is disabled, and source strings are deliberately short.
This does not measure large-source transition-table spill or large solver counts.

| 50,000-row fixed workload | Before | After | Interpretation |
| --- | ---: | ---: | --- |
| Serial completion p95 | 55.389 ms | 2.269 ms | 128 committed updates per mode |
| Serial completion p99 | 174.645 ms | 4.348 ms | Small bounded sample, not a production tail SLO |
| Four-client completion p95 | 343.766 ms | 5.715 ms | Same64 updates per round, two rounds per mode |
| Four-client completion p99 | 576.107 ms | 7.625 ms | Includes driver, lock and commit time |
| Four-client pooled throughput | 30.58 updates/s | 1,188.38 updates/s | SQL updates only; not API requests or Judge jobs |
| Four-client PostgreSQL CPU | 4,150 ms | 120 ms | Summed participating-process CPU,10ms tick resolution |
| Four-client WAL | 97,640 B | 99,456 B | About1.9% more WAL; no universal write reduction |
| Heartbeat p95 | 0.740 ms | 1.213 ms | About0.473ms /63.8% more fixed processing |
| Bulk cycle p95/p99 | 4,998.534 ms | 121.228 ms | Only14 cycles per mode: both quantiles equal the observed maximum |

At the 1,000-row size, serial p95 also rises from1.418 to1.509ms (+6.4%). These
regressions are retained alongside the large-history improvement. The new counter
relation and index occupy65,536B for the measured140 accepted pairs. Storage grows
with accepted problem/user cardinality. RSS samples are endpoints, not peaks or
leak tests; the observed35,324–57,324KiB range does not isolate a memory saving.
One uncontended50,000-row upgrade took47.85ms and is not a production lock estimate.

The independent reviewer recomputed all twelve crossover rounds, raw quantiles,
throughput, CPU/WAL totals, oracle digests and three source bindings. It was a
separate arithmetic/source review of the author's experiment, not a second full
benchmark. The raw source SHA records the local measurement checkpoint; exact
file hashes bind the script and both migration implementations to the published
code even though API publication creates a different commit object.

[Full conditions, every size and reproduction](PHASE3-DATABASE.md) ·
[all samples](measurements/phase3-problem-stats.json) ·
[independent calculation](evidence/phase3-database-benchmark-review.json)

## Frontend asset cost

Four separate source archives were built: Phase II and final frontend, each with
monitoring disabled and synthetically configured. Both immutable lockfiles match
the one installed dependency graph. Node24.22.1/npm11.9.0 and the same per-file
Node gzip settings are used. There is one build per source/condition.

| Default condition | Phase II | Final Phase III | Change |
| --- | ---: | ---: | ---: |
| Initial HTML module entry, raw | 381,551 B | 381,916 B | +365 B |
| Initial HTML module entry, gzip | 122,690 B | 122,789 B | +99 B |
| All emitted JavaScript, raw | 1,470,378 B | 1,481,734 B | +11,356 B |
| All emitted JavaScript, gzip | 485,346 B | 488,919 B | +3,573 B |

With monitoring configured, initial gzip increases97B and total emitted JS gzip
increases3,587B. The final lazy learning JS is9,678B raw /3,166B gzip in the default
build; its CSS is5,891B raw /1,470B gzip. This route-specific chunk is not the full
cold-load dependency graph. The optional monitoring SDK remains separately emitted.

The initial module is not every initial request. Total emitted JS is not what
every visit downloads. This is feature cost, not a page-speed improvement.
The coordinator independently checked374 source-file bindings against immutable
Git objects, output inventory arithmetic, dependency inventory and all four log
hashes. No second build or browser transfer measurement is implied by that review.

[Exact sources, monitoring variant and compression caveat](PHASE3-FINAL-BUNDLES.md) ·
[raw build inventories](measurements/phase3-final-bundles/phase3-final-frontend-bundles.json) ·
[independent verification](evidence/phase3-final-bundles-independent-review.json)

## Actual browser observation protocol

The existing production Compose flow owns one learner, one public problem and
two ordinary submissions (one accepted, one wrong). The added probe makes three
warm-context full visits to `/learning?days=30`, followed by five period switches
per visit. Actual API and rendered data assertions are required on every sample.
No latency threshold replaces a functional assertion.

The report records browser-provided bounded LCP candidates, FCP, document
Navigation Timing, observed session-window CLS, raw Event Timing and optional
CDP isolate heap. Period latency runs from the browser click event to the second
animation frame after the correct new-period DOM. It is not an actual paint
timestamp or INP. INP is explicitly null. Unsupported/missing measurements carry
reasons rather than fabricated zero values.

Only five explicit nonnegative integer fixture-summary fields and timing metadata
are retained; no response body, credentials, submitted code or private fixture
content is stored. The successful Compose step requires the JSON artifact. The
original three flows, assertions, timeout and retry policy remain in place.

Actual observations must be read with their retained source/tree/run and browser
context. Three visits and fifteen dependent interactions cannot estimate field
p95/p99, all-device performance, long editor sessions or memory leak freedom.
[Protocol and evidence location](PHASE3-BROWSER-PERFORMANCE.md) and the final
[validation receipt](PHASE3-VALIDATION.md) identify the executed run.

## Deliberately unclaimed measurements

- No new steady-state Judge jobs/s, queue p50/p95/p99, compiler/executor CPU/RSS,
  saturated multi-worker efficiency or prolonged memory result was collected.
- The previous5,000-candidate first-page API result remains historical Phase II
  evidence, not a new Phase III same-payload throughput comparison.
- The learning response bound is a design property; no large-history API latency,
  database pool limit or whole-platform capacity claim follows from it.
- Vibe snapshots improve input consistency; no AI quality, native binary parity
  across different images, provider determinism or model-cost saving was measured.
- Production migration locking, distinct-solver cardinality, long mixed load,
  field Web Vitals and complete editor/device profiling remain explicit follow-up
  work in [PHASE3-ROADMAP.md](PHASE3-ROADMAP.md).
