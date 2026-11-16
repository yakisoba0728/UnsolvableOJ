# Phase II: owned Redis restart and interrupted rejudge

Source base: `6495492811bc09024822416982cc1caf13c5d052`.
Separate branch: `overhaul2/judge-recovery`.

This followup extends the already separate worker-link and API-process tests.
It does not reinterpret a TCP proxy interruption as a Redis service restart.
At implementation time these new native scenarios are **not yet executed**;
independent review and exact-head full CI are required before integration.

## Actual clean Redis daemon restart

`Back/test/judge-redis-restart.pipeline-spec.ts` creates a uniquely named and
labelled Redis container and AOF volume. It uses the full job's already pulled
`redis:8.10.3` image (`--pull=never`), records its actual image ID, and binds its
fixed restart endpoint only to a freshly reserved loopback port. Resource limits
are 128 MiB memory with no additional swap, 0.5 CPU and 64 PIDs. It is not
privileged. The existing workflow Redis service is never stopped or modified.

The helper accepts no existing container or volume. It uses
[Docker create](https://docs.docker.com/reference/cli/docker/container/create/)
before start so that an exact owned ID is available even if startup fails.
It refuses remote Docker host overrides/contexts and pins the verified local
Unix socket for subsequent commands.
Before every container
mutation it verifies the exact ID, unique ownership label/name, unprivileged
configuration, configured CPU/memory/PID limits, loopback port and its own volume mount. Volume removal rechecks
the ownership label. Cleanup stops owned API/worker children first, disconnects
observers, captures Redis logs, removes the exact created container, and then
removes its created volume. Errors remain test failures. If the CI job itself
is forcibly terminated, runner disposal is the final resource boundary; normal
test teardown is not claimed to survive a SIGKILL of the entire test process.

The API and worker are separate child processes pointed exclusively at this
Redis instance. DB 0 belongs only to that newly created instance, not the
workflow or development Redis. PostgreSQL must be loopback and match the
integration runner's unique disposable database name both in the URL and an
actual `current_database()` query before fixture writes. `NODE_ENV=test` and
PostgreSQL protocols are required; URL query parameters/fragments are rejected
before constructing a client because pg can override a URL's host/database
through query parameters. The no-connection guard regression checks these
overrides and asserts that rejected inputs never call `DataSource.initialize()`.

Acceptance checks:

1. Admit one slow Python submission and queued C/JavaScript submissions using
   the real HTTP API and normal three-pending-submissions limit.
2. Cleanly stop the owned Redis daemon. Require exit code 0, observe a failed
   Redis PING, and verify the first submission is still JUDGING after shutdown.
3. A new HTTP submission during the outage must return a bounded server error
   and create no row. Record the actual status; a 503 contract is not assumed.
   The current Redis-backed global throttle fails closed before admission.
4. While Redis remains stopped, the internal result callback must persist the
   active job's ACCEPTED result through PostgreSQL; the other two stay QUEUED.
5. Start the same container with its AOF volume. Verify a changed Redis server
   run ID, AOF enabled, and all original queue jobs still present.
6. Require all original accepted requests and the retried rejected request to
   finish with generation 1, zero recovery increments, completed queue jobs,
   one notification per submission, consistent learning, and one solve/10 XP.
   The original worker and API must remain alive throughout.

This is a **clean daemon restart and AOF reload test** with `appendfsync=everysec`.
It does not demonstrate sudden power-loss, corrupt-AOF or crash-fsync durability.
The workload is a small mixed-language burst, not prolonged mixed-load chaos.
[Docker stop](https://docs.docker.com/reference/cli/docker/container/stop/) can
escalate to SIGKILL after its grace period; the required zero exit status prevents
such a forced stop being counted as this scenario's clean restart.

Limits are finite: each Docker command 15 seconds, clean stop 10 seconds, API
readiness 15 seconds, Redis readiness 10 seconds, outage HTTP response 2 seconds
and total request 3 seconds, outage callback 15 seconds, recovered jobs 40 seconds,
and retry completion 15 seconds. The entire new scenario has a 120-second cap.
Its new cleanup hook has a separate 120-second cap to permit owned-child and
container cleanup after an assertion failure; no existing timeout is changed.

## Worker loss during an already accepted submission's rejudge

`Back/test/judge-rejudge-recovery.pipeline-spec.ts` uses the standard disposable
database and test Redis, a real Nest API, and actual Judge children. It first
obtains ACCEPTED at generation 1 and verifies one solve/10 XP, one learned
submission and one notification. An authorized rejudge creates generation 2.
The owned worker is killed only after that generation reaches JUDGING.

Previously earned evidence must remain while the real 60-second lease expires
and the normal recovery timer creates QUEUED generation 3. The test never edits
lease timestamps, Redis locks or clocks and never invokes a private recovery
method. The generation-2 callback must return 409 before and after replacement
execution. Replacement generation 3 must finish ACCEPTED with recovery count 1;
its duplicate callback returns 200 without changing terminal state. XP, solves,
learning and notification uniqueness are checked before interruption, while
queued after recovery, and after final completion.

The new scenario has a 150-second cap: initial result 15 seconds, actual lease
recovery observation 95 seconds, final result 20 seconds, and worker starts
15 seconds each. The cleanup hook is capped at 60 seconds. A child gets at most
10 seconds for the requested signal and 5 further seconds after fallback
SIGKILL; cleanup errors fail the test. Existing Phase I synthetic-lease and
Phase II ordinary-submission natural-lease tests remain unchanged.

## Evidence and remaining scope

Raw reports, uploaded by the existing full-job artifact step:

- `Back/reports/phase2-redis-restart.json` and `.log` include lifecycle stages,
  outage response/latency, actual restart timing, image and server IDs, final
  consistency checks and cleanup status.
- `Back/reports/phase2-rejudge-recovery.json` and `.log` include real recovery
  duration, final generation and consistency/fencing results.

The reports add completed evidence only after all assertions pass. A file's
existence alone does not mean its scenario succeeded; use exact-head job status
and its nonempty evidence together. API process restart, worker TCP faults,
ordinary natural lease expiry and capacity measurements remain in their
original reports. Multi-hour mixed failures and host-power-loss durability
remain unverified, and no production connection or deployment is involved.

The native CI selector also covers `*.pipeline-helpers.ts`; changing only the
new process or Redis helper must still run the real pipeline. The existing CI
policy regression exercises both helper paths and both new scenario paths.
