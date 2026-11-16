# Worker termination and recovery verification

Integration baseline: `03f356375c839ed2ccb84116a6fecd336c8e50f3`.
Branch: `overhaul/recovery-validation`.
Scope: one native pipeline regression in `Back/test/judge-recovery.pipeline-spec.ts`; no production code or existing timeout changes.

## Scenario and assertions

The standard pipeline runner creates a uniquely named disposable PostgreSQL database and uses the dedicated test Redis database. The new test creates its own user, problem, submission and worker process. The bounded Python sleep/sum fixture executes only through the real go-judge sandbox.

1. Submit through the HTTP API and observe the real worker's generation-1 claim in PostgreSQL.
2. Send `SIGKILL` to that owned child PID, await its `close` event, and verify its termination signal.
3. **Simulate lease expiry** by moving only that submission's database lease timestamp into the past, fenced by submission ID, generation, attempt and `JUDGING` state. This does not test a natural 60-second lease wait.
4. Wait for the application's **real 30-second recovery timer** to create generation 2 and enqueue it. No fake timers or direct calls to private recovery methods are used.
5. Send the old attempt's result through the actual internal API and require HTTP 409 with the recovered state unchanged.
6. Start a different owned worker process, consume the real BullMQ job and execute the fixture in go-judge. Require `ACCEPTED`, generation 2, one recovery and the expected public output.
7. Reject another stale callback and accept a duplicate callback from the successful attempt. Require the terminal database row, including metrics and update timestamp, to remain unchanged.
8. Verify exactly one solve, 10 XP, one learning submission and one judged notification for the isolated user/problem; require the generation-2 queue job to complete.
9. Wait for the old Redis lock to disappear without changing its clock or contents. Teardown stops the owned worker and removes only the tracked job IDs before closing the application; the standard runner drops its disposable database.

The existing pipeline test timeout remains 90 seconds. There are no increased retries, reduced assertions or weaker CI gates. The original BullMQ job may expire or settle during the test; **automatic recovery by BullMQ's separate multi-scan stalled-job checker is not asserted**. The coverage concerns database lease recovery, generation fencing and real replacement-worker processing.

## Execution record

| Check | Status |
|---|---|
| Backend lint (`npm run lint`) | Passed locally. |
| Backend TypeScript (`npm run typecheck`) | Passed locally. |
| Backend build (`npm run build`) | Passed locally. |
| `git diff --check` | Passed locally. |
| Native recovery scenario | Pending GitHub native CI; not run locally because Docker/go-judge are absent. |
| Independent review | Pending coordinator/QA review. |

Full command: `npm run test:pipeline --prefix Back`, with the existing disposable PostgreSQL/Redis runner settings and an authorized test-only go-judge instance. The existing `vitest.config.pipeline.ts` pattern automatically includes the new file. Worker diagnostics are saved to `Back/reports/pipeline-recovery-worker.log` without real user credentials.

## Limits

- PostgreSQL and Redis are real, but this scenario does not restart either service or the API process.
- The worker process death/restart is real; the database lease expiry time is deliberately simulated.
- This is a new verification gate, not evidence that a previously unknown production defect was found or fixed.
- A test pass cannot establish complete resilience to arbitrary network partitions, kernel failures, sandbox escape or prolonged host outage.
