# Bounded multi-API qualification

## Status and purpose

IMPLEMENTED; native execution and CI results are PENDING. This document describes
the protocol and its evidence contract, not a measured performance result.

The initial candidate `da8deeba` was blocked by independent finding
PHASE5-MULTIAPI-001: its cancellation signal did not bound in-process Nest setup
or sequential observer awaits. The correction removes that setup lifecycle and
uses owned transports and operation deadlines described below. Independent
re-review and the actual native CI qualification remain pending.

Local validation: Back TypeScript (`tsc --noEmit --incremental false
--preserveSymlinks`), focused type-aware oxlint and six deadline/ownership tests
pass using the already installed shared dependency tree. The tests cover a
stalled setup reaching cleanup and a written FAIL report, late observer results
not starting `getJob`/`getState`, stalled PostgreSQL/Redis startup sockets being
closed, disabled Redis reconnection, and runner cancellation. They use deferred
promises and small owned loopback socket fixtures; they do not run native jobs.
The first PostgreSQL fixture exposed a pending connect callback when `Client.end`
was called during startup; the corrected transport close settles that callback,
and the six checks pass without increasing their existing five-second timeout.

`--preserveSymlinks` addresses the local dependency layout only; no repository
compiler configuration changes. The initial candidate's standalone Vitest list
attempt stopped at the existing pipeline configuration because this worktree
had no built `Back/dist/database/data-source.js`. CI must build and use the normal
disposable runner; none of these local checks qualify native execution.

The existing Phase II and Phase IV mixed-language receipts used one API instance
with two worker processes. The new `Back/test/phase5-multi-api.pipeline-spec.ts`
adds one eight-job qualification with two actual API processes. It uses the
existing disposable pipeline runner and does not change production code, sandbox
privileges, CI resource classes, timeouts, test selection or admission limits.

## Finite protocol

The runner creates a disposable PostgreSQL database; the test accepts only that
runner-owned database name and loopback PostgreSQL, Redis and native-executor
addresses. A bounded owned Redis observer clears disposable throttle counters
once before API setup, consistently with the existing fixture's pre-setup reset.
No counters are cleared after setup. The two API child processes start first;
normal HTTP registration/login/problem endpoints create one published addition
problem, one fixture administrator and one fresh regular solver. A bounded SQL
query promotes only the owned fixture administrator. There is no in-process Nest
context or separate fixture API whose creation can finish after cancellation.

Two child processes run `Back/dist/main.js` with `PORT=0`, letting the kernel
assign different ephemeral ports owned by those children. Two
other child processes run `Judge/dist/worker.js`, each with concurrency one and
its API URL pointing to a different API process. All four use the same disposable
database, Redis database and existing native executor. Each child receives a
256 MiB V8 heap ceiling; this is not a whole-process RSS limit. No external AI or
email provider is invoked. The SQL observer uses one directly owned PostgreSQL
client and TCP socket with two-second connection/query/statement timeouts. Its
Redis observer has a two-second command timeout and reconnect is disabled. Both
are registered before any connect operation starts. These observer settings do
not change either API's production database pool or timeout behavior.

Exactly eight ordinary submission requests use the repository's immutable smoke
sources: C, C++, Java, Python, JavaScript, TypeScript, Go and Rust, once each. Four
requests go to each API, alternating by source index. Three admission lanes keep
at most three requests/submissions outstanding for the single solver, respecting
the existing three-pending-submission limit. A lane admits its next source only
after observing its previous job's persisted acceptance and queue completion.
This is one finite campaign, with no warmup, repeated trial, 429 retry or extra
account to obtain additional quota.

The real submission endpoint must return HTTP 202 and the normal 20-per-minute
headers. Its eight remaining-budget values must be exactly 12 through 19, in any
response order. This directly checks that the two API processes consume one
Redis-backed rate budget for the shared client address. No request supplies a
forwarded client address or bypasses the public submission endpoint.

The action budget is 45 seconds, including setup and process readiness. Each
asynchronous setup, SQL, queue and HTTP operation is guarded before its factory
starts and while its promise is pending. The guard also consumes Vitest's
cancellation signal. Expiry rejects the current await and prevents subsequent
factories, so a slow SQL call cannot schedule `getJob` or `getState` after the
cutoff. Late results/rejections are consumed without changing a final FAIL.
Readiness polls also have individual 15-second ceilings; HTTP operations have at
most 5 seconds within the remaining action budget. The existing pipeline test
timeout remains 90 seconds. The complete budget is:

| Phase | Maximum |
| --- | ---: |
| Setup and actions | 45 seconds |
| Both workers stopping in parallel | 15 seconds |
| Both APIs stopping in parallel | 15 seconds |
| Cleanup operations | 5 seconds |
| Observer connection/promise drain | 1 second |
| Report writing | 3 seconds |
| Total allocated budget | 84 seconds |

Compilation retains the existing 30-second/1,024 MiB ceiling;
the one-test-case problem has a 2-second/256 MiB execution limit. The two workers
must both complete at least one job. No worker or API is restarted and no service
link is interrupted.

## Required assertions

Every source must have one unique submission ID and generation-one queue job,
the correct source SHA-256 in storage and when read through the opposite API,
one unique claim attempt, native acceptance, one passed test case, a completed
queue job, zero recoveries, learning completion and one notification. BullMQ
`attemptsStarted` and `attemptsMade` must both equal one: this installed BullMQ
version increments `attemptsMade` on successful completion as well as failure.
It is not a retry count by itself.

While the Go job has an observed live claim, the harness sends one competing
claim to each API using a fresh attempt ID. Both must return HTTP 409, and the
row must still be judging under its original attempt afterwards. This adds no
queue jobs or native executions. After all jobs finish, each completed submission
receives a terminal claim and an exact-status, same-attempt result replay through
the API opposite its completing worker. The claim must return 409, the duplicate
result must return 200, and the stored result, timestamps and notification count
must remain unchanged. The solver must have exactly eight submission rows, eight
learning completions, eight judged notifications, one solve-ledger row and 10 XP.

Each worker must emit exactly one acknowledged completion measurement per job;
the two workers must jointly cover all eight IDs. Queue start/finish intervals
must show at most one active job per worker and at most two in total. This is a
bounded concurrency observation, not a claim that all CPU, memory or compiler
activity is captured.

## Raw report and clock semantics

`Back/reports/phase5-multi-api.json` is written on success or assertion failure,
with overall status, partial observations and the failing phase. It records the
Git source head, base, checked-out commit, tree, tracked-file cleanliness and CI
run/attempt identifiers. It also includes the runtime, CPU model, process PIDs,
configured limits, per-source hashes and rate-limit headers.

The API entry point at the implementation base calls `app.listen(PORT, HOST)`.
The report separately retains the requested host and client URL, then matches
each listening socket's inode to that API child's `/proc/<pid>/fd` entries.
The expected observed listener is IPv4 `127.0.0.1` on its kernel-assigned port.
The HTTP client URL is derived from that owned socket observation; no parent
port-reservation listener is created. Merely
constructing a loopback client URL does not establish listener isolation. This
check does not qualify a firewall, reverse proxy or production network policy.

Submission send/acknowledgement times, BullMQ `timestamp` / `processedOn` /
`finishedOn`, and PostgreSQL creation/update timestamps are wall-clock values.
Worker claim, judge, report and total durations come from `performance.now()`;
the worker's queue-wait measurement uses its host wall clock. Queue start and
finish delimit BullMQ processing, including claim, compile/run and result
reporting. They are not native program instruction start/finish timestamps.

The report preserves the worker's cumulative CPU/RSS metrics and one procfs
sample per owned API/worker process after the jobs complete. These describe the
Node processes' lifetime totals and RSS, excluding native compilers and sandbox
children. There is no process sampling loop, leak verdict, memory-capacity
estimate, p95/p99 estimate or throughput extrapolation from eight jobs.

Only measurement fields and synthetic identifiers are retained. Source text,
request bodies, full process logs, account tokens, service tokens and environment
values are excluded from the report. The original test failure remains visible
in the normal test runner output.

## Cleanup and execution

On entering `finally`, the action scope destroys its PostgreSQL socket and
disconnects its Redis client, including connections still starting. There is no
late-initializing TypeORM pool. The supplied PostgreSQL transport is destroyed
with an error so that this installed `pg` version also settles its pending
startup/query callbacks; a simultaneous `Client.end()` would suppress a startup
callback. The Redis disconnect disables reconnection. The queue shares that
owned Redis transport and its close promise is retained.

The `finally` block then awaits both workers stopping in parallel, then both APIs
stopping in parallel. Each phase uses the existing helper's 10-second graceful
wait and 5-second forced-stop fallback. Cleanup looks up only this fixture's
solver/problem submissions, including a request whose response was lost, and
removes only those job IDs. It never drains the shared queue. The native cache's
file IDs must match the baseline; the harness does not delete arbitrary native
files. Cleanup uses fresh, separately owned SQL/Redis observer transports under
a five-second operation scope, with no additional throttle reset. Expiry or
completion closes those transports too. A one-second drain checks both phases'
closed-socket/end events, retained queue-close promises and late operations.
Cleanup failures force report status FAIL. The raw report records destroyed
PostgreSQL sockets, Redis end states, pending operations and close failures.
Report writing has its own three-second scope and passes its abort signal to
`writeFile`; deadline expiry fails the test rather than accepting an incomplete
report. The integration runner remains the outer process-group cleanup and
disposable-database deletion boundary, including failure cases.

The existing `test/*.pipeline-spec.ts` selection includes this test. Run it only
through `Back/scripts/run-integration.mjs pipeline` with the existing authorized
native sandbox and built Back/Judge outputs. A local type/lint check or test
listing does not qualify native execution. Preserve the raw report as a CI
artifact, including failure cases, and bind a measured result to the exact
source/head/base/tree before changing this document's PENDING status.

This topology provides two independent API processes on one host. It does not
establish host fault tolerance, production load-balancer behavior, cross-zone
database operation, long-term recovery reliability or a capacity envelope.
