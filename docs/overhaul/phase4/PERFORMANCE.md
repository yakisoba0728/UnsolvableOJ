# Phase IV — bounded mixed-language worker campaign

## Fixed method

The existing real pipeline capacity suite now adds **one campaign of 24 admitted
jobs**: three consecutive eight-language waves, processed by the same two owned
Node worker processes at concurrency one each. C, C++, Java, Python, JavaScript,
TypeScript, Go and Rust use the existing sum fixture and all expect ACCEPTED.
There are no added warmup jobs, worker restarts or fault injections in this
campaign. The test has a fixed **240-second deadline** and no automatic repetitions.
Existing Phase II trials and recovery checks remain in place.

Submissions pass through the actual HTTP API, PostgreSQL, Redis/BullMQ, worker,
native go-judge and persisted result callback. The existing per-IP **20 requests
per minute** budget remains enabled. Before each wave, the harness reserves eight
requests using observed admission headers and waits for the existing window if
needed. It does not clear counters, rotate users/IPs to evade limits, retry 429s
inside a wave or change the admission policy. Those pauses are recorded separately
in the Phase IV report, retaining the Phase II report's own pause history.

## Measurements and invariants

`Back/reports/phase4-mixed-capacity.json` records:

- Actual checkout SHA and Git tree, PR source head/base when available, clean
  tracked-tree observation, Actions run/attempt/job and runtime/CPU environment.
- Each wave's admission wait, active batch duration and throughput, API latency,
  queue wait and acknowledged-worker duration using nearest-rank percentiles.
- Aggregate active throughput across the three measured batches and full wall
  throughput including process startup, admission waits, checks and shutdown.
- Owned-PID procfs CPU tick deltas, active versus wait-inclusive worker CPU, and
  each process's lifetime peak RSS. The same worker PIDs are retained throughout.
- Per-wave drift relative to wave one, including queue p95, throughput ratio,
  worker CPU and peak RSS changes. Negative changes are retained.
- Failure, recovery and queue-retry counts, plus compact acknowledged measurements.

Each admitted job must have exactly one terminal ACCEPTED acknowledgement,
generation one, no recovery, one completed queue attempt, one judged notification,
learning/accepted-XP evidence and one user/problem solve ledger entry. Existing
user XP must remain consistent with unique solve entries, rather than awarding
another ten XP for every repeated solution. A partial failed campaign is labelled
FAILED with its last stage and observed counts; it is not presented as a passing
capacity result.

## Interpretation limits

This is a longer finite regression campaign than the existing independent
eight-job bursts. Three waves are not a steady arrival stream or saturation test.
At eight samples per wave, p95 and p99 are sample maxima; at 24 combined samples,
p99 is still the maximum. The values do not estimate population tail latency.

The first wave has no campaign-specific warmup, but preceding pipeline tests may
have warmed the shared executor. Wave-to-wave change therefore cannot identify an
optimization effect. Shared-runner variance remains visible. Worker CPU/RSS do
not include the API/test harness, database, Redis, compiler or sandbox processes.
Lifetime peak RSS cannot establish leak freedom. This AC-only fixture does not
complete the eight-language verdict/memory matrix, a long fault campaign or
production capacity validation. No optimization or speedup is claimed.

## Actual run and retained evidence

**PASSED finite campaign:** [run43844858225](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43844858225), attempt1, full job. Source dd7523b48679a6e3fb68cfed65a4b1a606840e52, checkout9c7114cf9912c6390c82bda98243c787a7604ffa, treece6c1fdd5ea92695b9fc9727abec1dc4ea87970f; tracked tree clean. All twelve jobs and independent QA passed.

The fixture ran on Node24.22.2, Linux7.0.0-1017-azure, four logical CPUs, AMD EPYC7763. It started at2026-11-16T10:07:08.928Z and finished at10:08:57.052Z. These are observations from a shared CI runner, not controlled before/after optimization results.

| Wave | Jobs | Active seconds | Admission wait seconds | Active jobs/s | Queue p50/p95/p99 ms | Node-worker CPU ms |
|---|---:|---:|---:|---:|---|---:|
| 1 | 8 | 10.193 | 36.500 | 0.78485 | 536/2266/2266 | 160 |
| 2 | 8 | 10.519 | 0.000 | 0.76055 | 131/2044/2044 | 120 |
| 3 | 8 | 10.606 | 39.642 | 0.75432 | 565/1454/1454 | 170 |
| Aggregate | 24 | 31.317 | 76.143 | 0.76635 | 536/2199/2266 | 450 |

Wall time including startup, waits, checks and shutdown was108.138seconds: **0.22194jobs/s**. Wave2's unrounded admission-helper duration was0.029825ms with no quota pause.

Twenty-four admitted jobs produced twenty-four distinct accepted acknowledgements, generation1, one queue attempt each and no failure, recovery or retry. The same two worker PIDs processed all waves.

**Adverse drift is retained:** wave2 throughput was3.10% lower than wave1; wave3 was3.89% lower. Wave3 queue p95 fell812ms while worker CPU rose10ms. This is descriptive variation, not evidence that code changes improved performance.

Node-worker CPU totaled450ms in active batches and570ms including intervening waits/checks, sampled with100Hz procfs ticks. Lifetime peak RSS was111336/111196KiB (108.73/108.59MiB), with no recorded peak increase across the three waves. These exclude API, DB, Redis, compilers and executor; unchanged short-run lifetime peaks do not establish leak freedom.

[Compact aggregate evidence](evidence/mixed-capacity-run-43844858225.json) preserves provenance, limits and observations without per-job IDs or raw logs. Original artifact14214399509 ZIP SHA256 is9924b104210308f19fecaf498ade4c709df6fdede61db84e2c0ee46a5b030373. Its23964-byte source JSON SHA256 isdcbe4b7c0b2f59f2f7b4f1530f4da4622ec8cc23ba71897c4125359602c46e5c. The final combined run has its own artifact and receipt; these values remain bound to this feature checkpoint.

Local TypeScript verification used --preserveSymlinks for the shared dependency layout. Actual native/DB/Redis execution above is Actions evidence. No production capacity, population-tail, compiler-RSS, full verdict-matrix or causal speedup claim follows.
