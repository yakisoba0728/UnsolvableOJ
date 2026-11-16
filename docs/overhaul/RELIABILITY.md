# Infrastructure and reliability audit

Reviewed base: `bbb40555a1220c505a0bcc668e72d7d750877625` (verified integration after PR #54).
Application baseline remains `6176015b63a1615cc2269172f246725ef08abab3`.

## Implemented finding

| ID | Priority | Evidence | Change | State |
|---|---|---|---|---|
| REL-001 | P1 validation process | Native sandbox, actual queue pipeline and Compose tests were selected only by schedule/manual/final integration PR. An ordinary Judge or critical submission-contract PR could be integrated with the native path skipped. | Select full validation from execution/contract/Compose/harness changes before integration, and fail closed when PR changes cannot be determined. | REPRODUCED → IMPLEMENTED → TESTED locally; independent review and CI pending |

The implementation uses the existing workflow's change-detection shell. No deployment job, token permission, test retry, assertion or existing test is removed or weakened. A full selection includes every component, even without a matching frontend path. Ordinary frontend/API/migration/documentation changes retain bounded checks. Workflow-only changes retain all basic checks and do not automatically add a native run.

The policy explicitly includes Judge source/runtime/config/dependencies, submission contracts, Vibe runner/service/catalog/types, queue/Redis/environment settings, runtime Docker/proxy/Compose configuration and the live test harness. It excludes documentation and benchmark-only changes from the expensive native path. The exact list and operational instructions are in `.github/CI.md`.

The coordinator also assigned `Judge/.dockerignore` for a preventive correction: it now excludes `.env.*` as well as `.env` and `*.env`, matching the other application build contexts. This is a build-context exposure control, not a claim that any real credential leaked. The ignore-file path is included in the native selection policy; this PR itself therefore exercises the new full-validation path.

## Verification actually executed

- Existing five CI policy tests plus four new grouped regression tests were run against the old workflow: **6 passed, 3 failed**. Native-path selection and unknown-PR fail-closed cases exposed the gap.
- Corrected workflow: **9 passed, 0 failed**, including 38 execution/contract/harness path examples, ordinary frontend/API/docs/migration/workflow selections, missing-base/fetch/diff failures, and all original gate/SIGPIPE checks.
- Tests execute the actual Bash blocks with a local fake Git producer. They do not call GitHub, Docker, a production endpoint or a real sandbox.
- Python/PyYAML parsed the workflow; eight jobs are retained.
- `git diff --check` passed.
- Docker, Compose execution, image vulnerability scanning and native sandbox tests were **not run locally** because no Docker daemon/client is available. The applicable GitHub Actions run must pass before this branch is integrated; subsequent native-path feature PRs require their own exact-head full run.

Local evidence: `evidence/reliability-ci-before.log` and `evidence/reliability-ci-after.log` in the task workspace. Their absence after workspace cleanup does not remove the committed executable regressions.

## Audited configuration and existing controls

Read the root/deployment/executor Compose definitions and accompanying documentation, all four Dockerfiles, three `.dockerignore` files, backend entrypoint, frontend nginx/proxy files, runtime health/mount/start configuration, all workflow/dependency-update configuration and Compose/budget scripts.

| Area | Observed control | Limit of this audit |
|---|---|---|
| GitHub Actions | Read-only contents permission, full action SHA pins, non-persisted checkout credentials, no image push, bounded jobs, synthetic service credentials | No repository administration settings changed; live branch protections are coordinator evidence |
| App images | Backend/worker use node user; development dependencies are excluded from final runtime stages; frontend serves built static assets | Some base images use version tags rather than immutable digest pins; no new CVE/SBOM scan was executed locally |
| Production Compose | No host-published app/data/sandbox ports, internal sandbox network, separate Traefik-facing frontend network, non-sandbox capability restrictions and memory/CPU/PID budgets | Correct host/proxy settings and available capacity require operator validation |
| go-judge | Fail-closed no-fallback startup, cgroup/seccomp checks, bounded mounts, memory and swap policy, authenticated service contract | Privileged container on the application host is not VM isolation; actual enforcement requires native runtime tests |
| Queue lifecycle | Init forwarding, two-minute worker shutdown grace, heartbeat-driven unhealthy-worker termination, persistent Redis with noeviction | No sustained load/restart/reconnect drill was performed by this specialist |
| Data lifecycle | Migration-on-start refuses startup on failure; disposable integration runner uses generated DB names | Concurrent deployment migration coordination and rollback compatibility need operational validation |
| Backups | PostgreSQL-version-matched pg_dump sidecar, partial→final rename, age/health checks, retention only after successful dump | Same-host storage does not protect host loss; off-host copy/restore instructions exist but were not executed |
| Public proxy | Explicit internal-judge path denial, forwarded-IP replacement, configured trusted proxy networks, CSP/security headers and immutable asset caching | Real CDN/TLS/DNS/Traefik behavior was not exercised; no live service was contacted |

## Residual observations

- The dedicated executor template lacks some worker CPU/PID/capability restrictions present in the all-in-one production template. This is a configuration-parity follow-up, not evidence that the sandbox limit enforcement failed.
- The `.env.*` build-context omission was corrected after the coordinator assigned that one Judge file to this branch. No real credential or leaked runtime image was observed. Docker runtime verification remains an exact-head CI gate.
- A reproducible backup restoration drill and representative resource exhaustion/recovery measurements remain necessary before production readiness is claimed.

No production server, database, Redis, volume, network policy, paid resource or main branch was changed. No sandbox escape experiment was attempted.
