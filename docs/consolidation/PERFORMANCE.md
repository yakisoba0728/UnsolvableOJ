# Performance evidence and limits

## Decisions

No new runtime optimization is accepted without a controlled same-work comparison.
The consolidation's actor fences and response cleanup are correctness changes;
extra authorization statements have a cost and are not described as speedups.
Shared request/actor helpers reduce duplicated policy code without a performance
claim. Existing measured Phase I–III optimizations remain preserved in the exact
baseline rather than counted again as new work.

Current candidate bundle measurements and the new run's DB/Judge/editor/Compose
artifacts must be recorded with exact source and environment in the final PR
receipt. A different CI runner is not a controlled before/after experiment.
Field INP remains **null**; field LCP/CLS and long-duration memory stability are
unmeasured.

## Controlled consolidation bundle comparison

The same Node24.22.1 host, installed dependencies, byte-identical package lock and
Vite configuration, and absent `VITE_*` overrides produced both builds. The final
measured `Front` subtree is `df7596ff304e82efb122e7dbfa0c34f105bb9fcd` and includes
community, Settings and Vibe corrections. Gzip uses level9; Brotli uses quality11.
The whole-JavaScript rows sum independently compressed emitted files, including
lazy chunks; they are not a single page-load size or latency measurement.

| Metric, bytes | Phase V baseline | Final Front candidate | Delta |
|---|---:|---:|---:|
| HTML module entry | 383,981 | 383,958 | -23 |
| Entry gzip | 123,403 | 123,376 | -27 |
| Entry Brotli | 106,467 | 106,603 | +136 |
| All emitted JavaScript | 1,494,009 | 1,494,483 | +474 |
| Summed per-file gzip | 492,887 | 493,084 | +197 |
| Summed per-file Brotli | 419,149 | 419,614 | +465 |

The total-size increases and inherited large-chunk warning remain visible. No
runtime optimization is newly accepted. Build durations on a shared host are not
used to infer improvement. [Performance audit](audits/PERFORMANCE.md) identifies
the raw reports, source/lock/config hashes and commands; the final evidence archive
retains those bytes alongside the earlier intermediate and adverse observations.

## Preserved historical baseline: final Phase V run43913852145

These values belong only to source `e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5`,
checkout `70307b3d3c7c9591ee3822e4b5ab903d3527f1b1`, complete tree
`a2a2409dfd3e73b82ba7b39c2e41808eba7b5813`. The [immutable numerical addendum](https://github.com/yakisoba0728/UnsolvableOJ/blob/752fbdb68f6216ccd85003c77e71d1429689c015/docs/overhaul/phase5/FINAL-RUN-PERFORMANCE.md)
preserves full vectors and original artifact hashes.

| Workload | Historical observation | Scope / limitation |
|---|---|---|
| SQL page offset0 | p50 2.036128ms; p95/p99 2.578519ms | Five serial warmed samples; SQL/driver interval |
| SQL page offset4,950 | p50 1.889522ms; p95/p99 1.951045ms | Deep-page plan sorts5,000 rows; no production tail inference |
| Whole-assessment summary | p50 18.460630ms; p95/p99 18.749867ms | Five samples; slower observation than preceding PR91 |
| 5,000-row export query | p50 22.652149ms; max30.574047ms | Excludes full HTTP/CSV serialization |
| Learning query | p50 11.587268ms; max11.823032ms | Planner estimate988 versus10,000 actual rows remains visible |
| Distinct-solver insert / bulk rejudge | 134.753590ms / 6.035227ms | Finite fixture; separate EXPLAIN/cluster WAL scopes |
| Disposable restore | total1,026.560620ms; dump116.499265ms; restore138.561472ms | 37tables/2,976 reported rows; production RTO/RPO unproven |
| Two APIs / two workers / eight jobs | active0.715813jobs/s; through-cleanup0.593101jobs/s | Different denominators; finite correctness campaign |
| Arrival to BullMQ completion | p50 485ms; p95/p99 10,129ms | At n8 the high quantiles are sample maxima |
| Editor | 13heap samples,20actions,10mock writes over40s | Coarse heap; mocked backend; no leak-freedom claim |
| Compose browser | LCP candidates[424,396,396]ms; CLS[0.04873133,0.04873133,0.05432500] | Three warm lab visits; layout attribution is not causation |

The final Phase V scenario elapsed51.34% longer than PR91, and several query,
EventTiming and LCP observations were also worse. Different hosts and tiny dependent
samples prevent attributing those changes to source. Those adverse results remain
in the archive and are not removed or averaged into a favorable headline.

Worker/API endpoint RSS and cumulative CPU exclude the database, Redis, compiler,
executor and host. Queue-timestamp wait and worker-reported age have different
boundaries. Active jobs/s excludes admission pauses; wall jobs/s must state whether
startup, cleanup and report writing are included. A short zero-error run does not
establish sustained capacity, p99 under production load or independent fault domains.

## Reproducibility

The complete [historical offline verifier](../overhaul/phase5/evidence/performance/verify-performance.py)
and all its input bytes remain present after cleanup. It recomputes source-bound
metrics and hashes without running workloads. [Current qualification harness](../../Back/scripts/phase5-db-qualification.mjs),
[mixed pipeline campaign](../../Back/test/judge-capacity.pipeline-spec.ts),
[two-API campaign](../../Back/test/phase5-multi-api.pipeline-spec.ts) and
[editor observation](../../Front/tests/phase5-editor-observation.spec.ts) remain
part of the real current-source validation path.

Any new before/after comparison must hold workload, limits, instrument boundaries,
dependency lock and environment constant, retain raw samples and adverse outcomes,
and distinguish byte-size changes from user-perceived latency. Candidate changes
without that evidence remain unmeasured, not failed measurements or accepted
optimizations.
