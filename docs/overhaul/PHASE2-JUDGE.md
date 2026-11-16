# Phase II Judge, reliability and capacity

Base: `c8ba9712d1a29ac633519511e50428ef647edf66`.
Implementation branch: `overhaul2/judge-capacity`.

## Independent baseline review

Read the actual worker, output comparator, runner, native tests, deployment
configuration and backend claim/result/recovery code against the Phase I reports.
The worker API rejects redirects; sandbox readiness verifies authenticated
access and anonymous rejection; byte-range comparison preserves the documented
semantics without per-line views. Existing 94 worker/protocol tests and the
Python health regression were rerun locally and passed. This verifies those
bounded checks, not arbitrary host isolation.

The native suite's baseline covered AC for all eight languages, but negative
verdicts largely used Python plus one C compilation failure. The previous kill
recovery regression deliberately changed its owned submission lease timestamp;
it did not verify the natural 60-second lease. Neither source inspection nor the
old CI run is counted as a new native execution here.

## Production changes and acceptance

| ID | Finding/change | Acceptance |
|---|---|---|
| J2-001 P2 | A worker kept publishing API readiness while its queue Redis connection was disconnected. Suppress readiness renewal while disconnected; reject initially unavailable queues before presence. Track both main and blocking Redis clients after construction; retain local liveness to permit reconnect. | Baseline emitted 3 presence requests where only startup's 1 was permitted; changed code emits no outage renewals and resumes on reconnect. |
| J2-002 observability | Add opt-in `JUDGE_METRICS=json` acknowledged completion records: queue wait, claim, combined compile/run/cleanup, report/retry, total duration and process CPU/RSS. | No success metric before acknowledgement; no source/test content/token fields; observer failure cannot cause re-delivery. |
| J2-003 P2 defense | Dedicated executor lacked worker CPU/PID/capability parity and shared the default outbound network with the execution service. | Same worker ceilings/hardening as production; only worker on application network, execution service on internal sandbox network. Native deployment enforcement pending. |

No callback DTO, verdict semantics, public API, compile/run limits or recovery
allowances are changed. Startup connects/pings the main Redis client and authenticates before
constructing a consumer. This first authentication heartbeat can precede the
blocking Redis connection becoming ready; subsequent readiness renewals require
both main and blocking clients. No claim of atomic cross-service readiness is made. Existing stale API presence can remain until its normal TTL expires.

## New native verdict matrix

The added fixtures are bounded and execute only in the actual go-judge sandbox.
Each of C, C++, Java, Python, JavaScript, TypeScript, Go and Rust adds:

- WA, explicit nonzero exit, CPU timeout and output-limit verdicts;
- syntax rejection at the correct stage (Python/JavaScript runtime error;
  other six compilation error);
- two identical large UTF-8/CRLF echo cases to check repeat consistency,
  private-case exclusion and truncated public preview.

That is 48 new native cases on top of the existing suite. The original Python
memory, PID, detached-process cleanup, network and private-output cases remain.
**Memory-limit classification across all managed runtimes remains incomplete.**
A JVM/Node heap refusal can be a runtime exception before cgroup exhaustion;
this change does not relabel every allocation failure as MLE.

## New finite pipeline scenarios

`Back/test/judge-capacity.pipeline-spec.ts` uses the existing runner's uniquely
named disposable PostgreSQL database and test Redis DB. It creates only synthetic
users/problems/jobs, owned workers and loopback TCP proxies. It adds:

1. Eight-language accepted mix with 1, 2, 2, 1 worker processes, one active job
   per worker, one Python warmup/job per worker and eight measured jobs/trial.
2. Worker Redis-link interruption/reconnection while one result commits and a
   second job remains queued; an additional distinct BullMQ job delivers the same
   submission/generation after the terminal result and must not duplicate execution/XP/notification.
3. Worker API-link interruption during execution; the same attempt's result is
   retried and committed without a new generation or duplicate XP.
4. Two actual workers compete for the same active submission through distinct queue jobs; the duplicate completes without executing, while the original remains JUDGING with its original attempt.
5. Real SIGKILL and natural lease expiry: real 60-second lease plus real recovery
   timer; no clock edits, fake timers or private recovery invocation. Reject stale
   callback, replace worker, accept generation 2, verify one notification and
   consistent solve/XP/learning evidence. This new test has a finite 120-second
   budget because natural lease expiry exceeds the old synthetic case's duration;
   no existing test timeout or assertion is weakened.

The TCP proxies affect only owned worker connections. They **do not restart the
Redis daemon or API process**; such process restart/persistent Redis recovery and
sustained mixed-load failures remain distinct follow-ups.

## Measurement methodology and limits

Raw report: `Back/reports/phase2-judge-capacity.json` (CI artifact).
Environment includes Node/OS/kernel/CPU and logical CPU count. Per-trial raw
completion records retain per-language queue, claim, combined runner and report
timing; aggregate report records HTTP submission p50/p95/p99, queue percentiles,
completed jobs/s, worker CPU interval/core-equivalent and per-worker peak RSS.

Timing begins before the batch's real HTTP submissions and ends after all eight
DB final states and worker acknowledgement records. Polling adds up to roughly
100 ms to batch duration. CPU is owned-worker Linux procfs user+system tick change
from the end of a shared warmup batch to final acknowledgement, not sandbox CPU
or per-job attribution. The report records CLK_TCK, raw before/after samples and
their resolution. No scheduler-fairness assumption assigns one warmup to each
worker; every owned PID is sampled even if it received no warmup job.
RSS peak includes warmup. API shares the test process, so isolated API CPU/RSS is
N/A. Compiler-only overhead, DB lock timing and production capacity remain N/A.

Two repetitions and eight jobs/trial are a reproducible CI smoke workload. p95/p99
are the sample maxima; this does not estimate steady-state tail latency. Alternating
worker order exposes some shared-runner variance, but does not control hardware
noise. No before/after system optimization or general speedup is claimed from
this new instrumentation. Old comparator microbenchmarks are not substituted.

## Actually executed locally

- Baseline Judge build/protocol suite: 94/94 pass.
- New readiness regression on baseline worker transpiled from the immutable Git
  commit: FAIL (`3 !== 1` API readiness renewals), reproducing J2-001.
- Changed Judge build/protocol suite: 98/98 pass; Python health: 1/1 pass.
- Backend lint and full TypeScript check including the new pipeline test: pass.
- `git diff --check`: pass.
- Native matrix, capacity/recovery pipeline and Compose enforcement: **not run
  locally** (Docker/go-judge unavailable); exact candidate Actions must pass
  before integration. Raw metrics and native success must be filled from that
  observed run, not pre-declared here.

Independent review and exact-head CI remain coordinator gates. No main merge,
production connection, paid infrastructure or sandbox escape experiment occurred.

## Independent review corrections

Review of the first candidate reproduced initial readiness advertised before a
queue existed. Startup now requires the main Redis connection before presence,
and has a specific disconnected-start/reconnect regression. Interval readiness
also observes BullMQ's distinct blocking client. Review removed an incorrect
assumption that BullMQ must distribute two warmup jobs to two workers: owned-PID
procfs sampling now measures both processes independently of scheduler fairness.
Queue wait is job enqueue age at claim, including retries/outage waiting; on
separate hosts it assumes synchronized clocks. The CI workload uses first-attempt
jobs on one host. The added two-worker active-lease duplicate scenario is separate
from the terminal duplicate after Redis-link recovery.
