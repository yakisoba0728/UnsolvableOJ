# Performance evidence

No full-platform latency/throughput result is inferred from microbenchmarks or bundle sizes.

## Baseline available

Frontend baseline build: initial JS 377.84 kB (121.58 kB gzip), CSS 144.89 kB (26.04 kB gzip), Vite build 5.10 s on the observed local run. Timing is a single baseline observation, not a statistically supported speed claim. Frontend specialist will record same-condition configured-telemetry comparison separately.

## Judge output comparator

The executable benchmark and every raw sample are committed in `Judge/scripts/benchmark-output.mjs` and `Judge/benchmarks/output-comparison.json` by the Judge branch. Five fresh-process samples per input/mode alternate order. Inputs and verdict semantics are identical.

| Input | Before median ms/op | After median ms/op | Before peak RSS KiB | After peak RSS KiB |
|---|---:|---:|---:|---:|
| Ordinary 100-line output | 0.1095 | 0.0771 | 47,260 | 46,136 |
| 999,999 newline bytes | 587.9439 | 3.7263 | 279,924 | 43,056 |
| Dense short lines | 289.6901 | 58.7161 | 186,620 | 48,944 |
| Long single line | 7.3579 | 0.2344 | 46,516 | 42,552 |

Node 24.22.1; Linux 6.18.57 x64; AMD EPYC 9V74; 9 visible logical CPUs. Shared-host noise applies. Peak RSS is the whole child process, not incremental bytes allocated by the comparator. The algorithm changes from allocating per line to constant auxiliary state; this is a demonstrated local component improvement, not a jobs/sec measurement.

## Still required for platform capacity claims

API p50/p95/p99 and error rate; database EXPLAIN ANALYZE/buffer counts on representative volumes; mixed-language judge throughput/queue wait; sustained concurrency and recovery; CPU utilization/peak memory under load; real-browser loading/render timing. Until executed, these remain N/A.
