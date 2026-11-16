# Bounded multi-API qualification

## Accepted actual native execution and integration — PR91

**INDEPENDENTLY_REVIEWED / CI_VERIFIED / INTEGRATED into Phase V integration.**
[Run 43905864054, attempt 1](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43905864054)
passed all twelve required jobs, including **36 pipeline cases in nine files**
and the one new two-API native case. The
[overall PR91 acceptance](evidence/reviews/backend-pr91-independent-review.json) and
[independent actual multi-API acceptance](evidence/reviews/multi-api-pr91-actual-acceptance.json)
bind source `281d0f1a30cd772cf7417e3affb8c98be252f405`, Actions checkout
`9aa843fad33b30270ab346bc62c4865c17697ff3`, base
`e8b08d6ab86181859d9491d15d1881a6b10262eb` and complete tree
`0f191c89a17b984cae8706cb02137ab0e4e2c3a4`. Integration merge
`a6588f7bedc87228c11852d8664fe20ec6b3ece3` has that same tree.

The [original actual report](evidence/backend-run-43905864054/phase5-multi-api.json)
records **PASS** with the following independently checked observations:

| Check | Observed result |
|---|---|
| Topology | Two actual API processes with distinct owned IPv4 loopback listeners; two actual workers; one shared disposable PostgreSQL/Redis/native-executor environment |
| Native outcomes | Eight languages, eight HTTP 202 admissions, eight generation-one ACCEPTED submissions, one started/completed queue attempt each and zero recoveries |
| Shared admission | Four requests per API; remaining quota exactly 12 through 19 at limit 20; three admission lanes; zero submission retries or counter resets during the campaign |
| Worker completion / overlap | Six jobs and two jobs; maximum recorded queue overlap two overall and one per worker |
| Fencing / replay | Both active competing claims returned 409; all eight terminal claims returned 409; all eight opposite-API result replays returned 200 without changing retained results |
| Persistence | Eight learned submissions, eight notifications, one solve-ledger row and 10 XP; all eight immutable source hashes matched |
| Cleanup | All eight owned queue jobs removed; all four children terminated without forced SIGKILL; both observer sets closed with zero pending operations/close failures; native cache unchanged |

There was one normal disposable-fixture throttle reset **before** API setup;
none occurred during the measured campaign. Recorded pending-row overlap was
three and queue overlap two; these are timestamp observations, not separately
measured transaction-commit or native instruction intervals.

The report records **8,864.358 ms** for setup/actions, **7,361.630 ms** for the
active batch and **44.566 ms** for cleanup. Its total **8,912.917 ms** is sampled
before report writing; the completed-test log records **8,915 ms** for the
enclosing test, within the unchanged 90-second timeout and allocated 84-second
budget. These are one eight-job observation, with no capacity, fairness,
population-tail or throughput-envelope claim. CPU/RSS samples cover the Node
processes, not native compilers or whole-host memory.

The independent receipt closes **PHASE5-MULTIAPI-001** through the corrected
source, focused deadline tests and this actual execution. It also confirms
source carry-forward and cleanup against the hosted job log. This acceptance is
for PR91 on Phase V integration; it does not pre-approve a later final source or
production deployment. The author checkpoints below remain historical evidence.

## Historical status and purpose

At the original author checkpoint the protocol was IMPLEMENTED, while native
execution and CI results were PENDING. The description below established the
protocol and evidence contract before the accepted actual run above.

The initial candidate `da8deeba` was blocked by independent finding
PHASE5-MULTIAPI-001: its cancellation signal did not bound in-process Nest setup
or sequential observer awaits. The correction removes that setup lifecycle and
uses owned transports and operation deadlines described below. Independent
re-review and the actual native CI qualification were pending at that checkpoint;
both are now recorded in the accepted current-source receipts above.

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
artifact, including failure cases, and bind every measured result to its exact
source/head/base/tree. The accepted PR91 report above satisfies that execution
gate; local type/lint results remain distinct from actual native evidence.

This topology provides two independent API processes on one host. It does not
establish host fault tolerance, production load-balancer behavior, cross-zone
database operation, long-term recovery reliability or a capacity envelope.
