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

## Execution status

**PENDING actual pipeline CI.** No local PostgreSQL, Redis or native worker
campaign has been executed for this addition. Measured values, exact run links
and the independent review receipt must be taken from the eventual report and
Actions run, not invented from earlier Phase II observations. The coordinator
retains the compact report as a CI artifact without committing duplicated raw logs.
Local TypeScript verification passed with `--preserveSymlinks` for the shared
dependency layout; it does not execute or certify the native campaign.
