# Infrastructure audit and CI corrections

Baseline: `6176015b63a1615cc2269172f246725ef08abab3` (remote main verified 2026-11-16).

## Findings and changes

| ID | Severity | Evidence | Correction | State |
|---|---|---|---|---|
| INF-001 | P1 | `CI required.needs` omitted the dependency audit and four-image matrix; a required green status could coexist with their failure. | Include `audit` and `images` in required dependencies; retain all existing checks. | TESTED locally; CI/review pending |
| INF-002 | P2 | Image detection piped `git diff` into `grep -q` under `pipefail`; a 30,001-file fixture reproduced `build=false` even with a matching first file because the producer received SIGPIPE. | Read the diff before matching it. | REPRODUCED → TESTED locally; CI/review pending |
| INF-003 | P1 (integration process) | Workflow only accepted PRs targeting main. Authorized integration PRs would have no automated checks. | Accept PRs to `overhaul/integration`; final integration→main PR automatically includes full validation. | TESTED locally; CI/review pending |

Regression command: `node --test scripts/ci-policy.test.mjs`.
With the new tests against the baseline workflow: 1 passed, 3 failed.
With the corrected workflow: 5 passed, 0 failed. Independent review also required FULL=true to select all component jobs even for documentation-only diffs; a regression now executes that path.
The tests execute the actual aggregate-gate shell and image-detection shell with a local fake Git producer; they do not call GitHub or Docker.

## Existing controls inspected

- Workflow permissions are read-only; checkout credentials are not persisted; Actions are pinned to full SHAs.
- Docker builds set `push: false`; full tests run disposable local Compose projects.
- Production Compose publishes no application/data/sandbox host ports and makes its sandbox network internal.
- Services have memory/CPU budgets; non-sandbox services drop capabilities and set no-new-privileges.
- The sandbox remains privileged and shares a host in the all-in-one production example. Container hardening is not proof of a hostile-code isolation boundary. Dedicated execution-host deployment in `Judge/deploy/` needs operator validation before production.
- Backups use atomic partial→final files and retain successful dumps; they remain on the same host. Off-host backup, restoration objectives, and a restore drill are outstanding.

## Environment limits

Local Node 24.22.1/npm 11.9.0 and Python are available. Docker is absent. TCP localhost binding succeeds; Unix-domain socket creation is denied. Browser launch was blocked by that policy, and an escalation request was rejected by the configured approval policy. Native sandbox/Compose validation must run on the authorized disposable CI runner; no controls are weakened here.

## Merge policy

Feature PRs target `overhaul/integration`. Root verifies every job, exact PR head, independent review, and regressions before merging. `main` remains user-controlled. No deployment, branch protection setting, repository secret, operational database, Redis, or volume was modified.
