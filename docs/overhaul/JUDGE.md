# Judge audit, hardening and output-comparison measurements

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.
Branch: `overhaul/judge-hardening`.
Scope: all files under `Judge/`, plus read-only inspection of the backend claim, lease, result DTO and result persistence contract.

## Architecture and inventory

| Area | Current behavior and evidence |
|---|---|
| Queue consumer | `src/worker.ts` consumes `judge-submissions`; every claim includes submission ID, generation, random attempt ID and worker identity. |
| Lease lifecycle | Backend owns a 60-second lease. Worker renews every 10 seconds, cancels stale attempts on HTTP 409, retries result delivery up to three requests, and retains its lease until acknowledgement. |
| Failure recovery | Sandbox transport/429/502/503/504 failures release the lease and pause new claims until readiness returns. Release consumes one of the backend's five recovery allowances. Authentication failure cancels active work and exits nonzero. |
| Compiler/runtime contracts | C17, C++20, Java 21, Python 3, JavaScript/Node 24, TypeScript/esbuild, Go and Rust 2021. Compiled artifacts are reused only within the submission, then removed. Java packages all class files. |
| Resource contracts | Compile CPU/wall budget 30 seconds and 1 GiB; per-case CPU/wall/memory from the problem snapshot; process limit 64; one CPU equivalent; exact output/file hard limit for execution. |
| Case ordering and privacy | Public samples run first while retaining original numbers; stop at first failed case. Only public sample stdout/stderr previews are sent. Expected outputs are never sent to the execution service. |
| Verdicts | Byte-preserving comparison and upstream status validation; accepted exit must be zero. Per-case time/memory, aggregate maximums, compile diagnostics and bounded sample previews. |
| Cleanup | Cached stdout/stderr removed after use; artifact and partial-result IDs cleaned on success/error/cancellation. Cleanup failures preserve verdicts; service idle TTL is the fallback. |
| Isolation configuration | Privileged go-judge outer container; Linux namespaces/seccomp/cgroups inside; read-only compiler mounts, writable bounded tmpfs, fixed unprivileged submission UID/GID, no application credentials or Docker socket mounts. |
| Dedicated executor template | `deploy/` separates the execution host from application services, has no host port publications and requires nonempty service credentials. No deployment was performed. |
| Existing automated coverage | Mock HTTP protocol, cache cleanup, byte comparison, resource-command construction, worker authentication/lease/retry/recovery/shutdown; Python swap-policy readiness test; dedicated native-runtime suite for all languages and isolation cases. |

## Findings and fixes

| ID | Severity | Confirmed behavior | Change | State |
|---|---|---|---|---|
| JG-001 | P2 | Internal API requests followed redirects; a local two-origin HTTP test confirmed the worker continued instead of rejecting the redirect. | Reject API redirects and verify that the second origin receives no request. | REPRODUCED → IMPLEMENTED → TESTED; independent review/CI pending |
| JG-002 | P2 | Startup accepted a mock execution service that did not enforce authentication, despite its configured token. This is a readiness defense gap; it does not demonstrate an exposed production service. | Require both authenticated success and anonymous 401/403 on the protected file endpoint. | REPRODUCED → IMPLEMENTED → TESTED; independent review/CI pending |
| JG-003 | P2 | The comparator allocated Buffer views per line. One permitted-size newline fixture reached median process peak RSS 279,924 KiB and blocked comparison for 587.94 ms in the local benchmark. | Compare numeric byte ranges using constant auxiliary memory; preserve existing whitespace and binary semantics. | MEASURED → IMPLEMENTED → TESTED; independent review/CI pending |
| JG-004 | P3 | Worker source comment said releasing a lease did not consume recovery budget, contrary to backend implementation and README. | Correct the comment. | IMPLEMENTED → TESTED with worker suite |

No external API contract or verdict policy was intentionally changed. Deployments using a redirecting `API_BASE_URL` must specify its canonical endpoint. Services with authentication disabled now fail readiness as intended.

## Verification ledger

| Check | Result |
|---|---|
| Baseline `npm ci --no-audit --no-fund` | Installed 24 locked packages successfully. |
| Baseline `npm run check` | TypeScript build succeeded; 89 tests passed, 0 failed. |
| New HTTP regression tests against original code | 2 failed, both due to missing rejection, reproducing JG-001/JG-002. |
| New-test TypeScript compilation during development | One Buffer generic inference error encountered and fixed with explicit fixture array type; no checks weakened. |
| Final `npm run check` | TypeScript build succeeded; 94 tests passed, 0 failed. Includes exhaustive 160,000 short byte-pair comparisons, all byte values, large bounded inputs and real loopback HTTP redirect behavior. |
| `python3 -m unittest discover -s Judge/runtime -p 'test_*.py'` | 1 test passed, covering five mocked host swap/cgroup cases. |
| `git diff --check` | Passed. |
| `npm audit --omit=dev --audit-level=high --json` | 0 production vulnerabilities reported (0 critical/high/moderate/low) at execution time. |
| Native `npm run test:runtime` | NOT EXECUTED: Docker, Podman and go-judge executable are absent. No untrusted submission code was run on the shared host. |
| Real Redis/BullMQ concurrency and restart | NOT EXECUTED in this worktree. Worker state-machine tests use deterministic mocks; full pipeline remains a separate integration gate. |
| CI and independent review | Coordinator must verify exact commit before integration. Local success is not a claim of integration or production readiness. |

## Performance measurement

Command: `npm run benchmark:output` (or build first, then `node scripts/benchmark-output.mjs` for pure JSON).
Environment: Node v24.22.1; Linux 6.18.57 x64; AMD EPYC 9V74 80-Core Processor; 9 logical CPUs exposed. This is a shared task environment, not dedicated performance hardware.
Each algorithm/fixture uses five fresh child processes; execution order alternates. The table reports medians. CPU time is user + system CPU measured around comparison. Peak RSS is the complete child process high-water mark, not isolated JavaScript heap. No network, database, compiler or sandbox is involved.

| Fixture | Actual/expected bytes | Iterations per process | Before elapsed ms/op | After elapsed ms/op | Before CPU ms/op | After CPU ms/op | Before peak RSS KiB | After peak RSS KiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Ordinary 100-line output | 1,000 / 800 | 200 | 0.1095 | 0.0771 | 0.1465 | 0.1210 | 47,260 | 46,136 |
| Trailing blank lines | 999,999 / 0 | 1 | 587.9439 | 3.7263 | 666.7380 | 6.4550 | 279,924 | 43,056 |
| Dense short lines | 999,999 / 666,666 | 1 | 289.6901 | 58.7161 | 379.5530 | 70.8320 | 186,620 | 48,944 |
| Single long line | 999,999 / 999,998 | 1 | 7.3579 | 0.2344 | 9.9750 | 0.2930 | 46,516 | 42,552 |

Raw samples and environment are in `Judge/benchmarks/output-comparison.json`. These measurements support reduced comparison overhead and memory amplification; they do not establish whole-system throughput or absence of all memory-pressure failure modes.

## Remaining verification and backlog

- Run native language, resource limit, network isolation, PID/orphan cleanup and cache tests on an authorized disposable Linux Docker runner.
- Verify full callback privacy at the backend: it currently trusts worker sample flags and debug-output membership; the backend should validate those against the immutable snapshot. This is separately owned by the coordinator/backend audit.
- Privileged outer-container isolation, host/kernel patching and upstream executable/image provenance remain operational review areas. Configuration inspection is not evidence of resistance to a sandbox escape.
- Real queue throughput, latency percentiles, CPU utilization under concurrent submissions and per-language overhead remain unmeasured.
- Raw sandbox JSON responses are trusted internal-service data; total response limits and richer runtime claim validation are future defense-in-depth candidates, not confirmed external vulnerabilities.
