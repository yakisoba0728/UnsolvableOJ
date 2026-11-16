# Audit scope and finding register

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.

## Scope accounting

| Area | Structural inventory | Human/code-path audit | Runtime evidence |
|---|---|---|---|
| Frontend | Routes, pages, dependencies, test files generated | Auth/request ownership, notification UX, telemetry and selected editor/enterprise flows | Build/static/unit baseline; browser blocked locally, CI pending |
| Backend | All controllers and schema migrations inventoried | Auth/domain/enterprise/submission/queue/XP paths inspected | 275 baseline unit tests; DB runs being prepared |
| Judge | All six original source/test files and runtime/deploy configuration read | Compile/run/limits/leases/output/private cases inspected | 89 baseline and 94 changed tests; native runtime pending |
| Database | 25 migrations and 30 table declarations inventoried | Specialist query/constraint pass pending | Isolated PostgreSQL binary available; live catalog/performance pending |
| Security | Trust boundaries mapped | Dedicated cross-domain review in progress | Focused reproductions and regression tests in progress |
| Infrastructure | Compose/CI/scripts/Dockerfiles inventoried | CI gating, sandbox topology, backup assumptions inspected | CI policy reproduced/fixed; Docker/full checks in CI |
| Documentation/assets | Tracked-file inventory | Relevant execution docs read; static presentation/assets are not an application code audit | Not applicable |

A structural inventory is not a claim of line-by-line review. Remaining audit gaps are retained in BACKLOG.md.

## Findings tracked this iteration

| ID | Priority | Summary | State / evidence owner |
|---|---|---|---|
| INF-001 | P1 | Aggregate CI status omitted independent audit/image failures | Local TESTED, independent REVIEWED; PR #54 CI pending |
| INF-002 | P2 | Large changed-file output could wrongly skip image builds | REPRODUCED → TESTED; PR #54 |
| INF-003 | P1 process | Integration target lacked PR validation trigger | TESTED → REVIEWED; PR #54 |
| BE-001 | P1 | Assessment state/deadline could change during submission lock waits | REPRODUCED → IMPLEMENTED; DB validation pending |
| BE-002 | P1 | Workspace start could use transaction-start time after a lock wait | IMPLEMENTED; DB validation pending |
| BE-003 | P1 | Quota locking could conflict with assessment/FK lock order | IMPLEMENTED; real concurrency validation pending |
| FE-001 | P1 privacy | Notification state/replies could outlive their authenticated owner | REPRODUCED with React DOM → IMPLEMENTED; browser CI pending |
| FE-002 | P2 | Concurrent pagination/read failures could show duplicates or false success | REPRODUCED with React DOM → IMPLEMENTED; browser CI pending |
| JG-001 | P2 | Internal transport followed redirects | REPRODUCED → TESTED; independent review pending |
| JG-002 | P2 | Sandbox readiness did not prove authentication enforcement | REPRODUCED → TESTED; native confirmation pending |
| JG-003 | P2 performance | Output line count amplified comparator allocation | Measured → IMPLEMENTED → TESTED |
| SEC-review | Undetermined | Cross-domain identity and callback data boundaries under dedicated review | Do not publish sensitive reproduction detail; final classification after verification |

States: DISCOVERED → REPRODUCED → IMPLEMENTED → TESTED → REVIEWED → INTEGRATED. BLOCKED/UNVERIFIED are separate from success. No current entry establishes production exploitability or a clean bill of health for unrelated paths.
