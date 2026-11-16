# Testing and evidence

## Baseline

| Command / environment | Observed result |
|---|---|
| Back `npm run check` (Node 24.22.1) | lint/typecheck/build; 18 files, 275 unit tests passed |
| Front `npm run check` | build, answer guard, telemetry privacy 3/3, E2E TS passed |
| Front Playwright unit project | 85 passed; no browser required |
| Judge `npm run check` | build; 89 passed |
| Judge Python health tests | 1 passed |
| Baseline main Actions 43778049679 | successful; native/full job explicitly skipped |

## Changes

CI policy: initial new tests against baseline workflow produced 3 failures and 1 pass; fixed policy has 5 passes, including the independent review's documentation-only full-validation case. See PR #54.

Judge: 94 local tests passed, including 160,000 bounded differential pairs, legal-sized high-line-count output, disabled-auth configuration and actual loopback HTTP redirect regressions. Python test passed. See specialist JUDGE.md.

Backend and frontend changed suites, actual DB races, security regressions and integrated CI results are recorded as they finish. A test added to source is not counted as executed merely because it compiles.

## Test layers and source map

- Back `src/**/*.spec.ts`: unit and configuration/DTO/query-policy checks.
- Back `test/*.e2e-spec.ts`: real Nest HTTP plus disposable PostgreSQL/Redis; serialized files share one disposable test DB.
- Back `test/judge.pipeline-spec.ts`: actual queue/worker/sandbox integration.
- Front `tests/`: browser-free unit project and mocked-API Chromium/slow/Firefox/WebKit projects.
- Front live configuration: disposable production-Compose browser flows, including real API/judging.
- Judge `src/*.test.ts`: worker protocol, comparator, runtime contracts; runtime tests require native go-judge.
- Judge `runtime/test_health.py`: readiness configuration checks.
- Scripts: isolated integration runner, starter/import fixtures, Compose wiring and sandbox resource budget.

## Boundaries

Browser local execution is blocked by the environment's Unix-socket policy; escalation was rejected. React DOM tests are useful logic evidence and are explicitly not browser E2E. Docker is absent locally; production Compose/static Docker configuration and 8-language/cgroup/seccomp checks are delegated to the existing disposable Actions workflow, not a production server.

Shell invocations isolate process/network namespaces; a test service and client must run under one invocation. User-local test binaries are outside the repository. Every DB used by integration commands is newly created and removed by the runner. No existing operational database is migrated/reset.

## Merge gate

Require relevant tests, every applicable Actions job, independent code review, clean diff/contract checks and exact remote head/tree verification. Preserve failure logs and fix their cause. The final main PR remains unmerged and its readiness depends on full integrated results.
