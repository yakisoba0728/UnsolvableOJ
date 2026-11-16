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
| First native CI attempt | [Run 43784164298, job 133027976114](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43784164298/job/133027976114) failed in the new setup hook: `expect.poll() must be called inside a test`. Existing 16 pipeline cases passed; the new recovery case was skipped because setup failed. |
| Recovery-test correction | Move the first worker start from `beforeAll` into the test body so both readiness polls run inside the test. Preserve the readiness assertion, 15-second bound and existing 90-second test timeout. |
| Focused local Vitest check | 2/2 scratch tests passed on the installed Vitest 4.1.11: polling in `beforeAll` raises the observed error, while both readiness polls succeed inside a test body. This verifies the test-framework correction, not native worker recovery. |
| Native recovery rerun | [Run43784688710, job133029687437](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43784688710/job/133029687437) passed: recovery case35.228s;2pipeline files/17tests in54.00s; native26/26 and Compose2/2 also passed. Exact head8801454dc297d0d1af0e195408767dcc002fe584; all12jobs successful. No local native run is claimed. |
| Independent review | QA approved the initial scenario and independently verified the final27ad6a3 correction and actual logs. Remote test blob0380de50db4ef62b6b79f86e46ff42c4f481f26f matches reviewed source. Coordinator separately checked the correction, full CI and published tree. PR62 merged into integration57cd03a after these gates. |

Full command: `npm run test:pipeline --prefix Back`, with the existing disposable PostgreSQL/Redis runner settings and an authorized test-only go-judge instance. The existing `vitest.config.pipeline.ts` pattern automatically includes the new file. Worker diagnostics are saved to `Back/reports/pipeline-recovery-worker.log` without real user credentials.

## Limits

- PostgreSQL and Redis are real, but this scenario does not restart either service or the API process.
- The worker process death/restart is real; the database lease expiry time is deliberately simulated.
- This is a new verification gate, not evidence that a previously unknown production defect was found or fixed.
- A test pass cannot establish complete resilience to arbitrary network partitions, kernel failures, sandbox escape or prolonged host outage.
