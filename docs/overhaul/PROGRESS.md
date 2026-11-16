# Progress and resumable handoff

## Verified baseline and repository permissions

- Main baseline: `6176015b63a1615cc2269172f246725ef08abab3`, checked from Git and GitHub API at start.
- Baseline CI: [43778049679](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43778049679), success with native/full skipped.
- Integration current checkpoint: `03f356375c839ed2ccb84116a6fecd336c8e50f3` after reviewed PRs #54–#60 (all seven feature/CI PRs).
- Main branch API reported protected:false; rulesets empty. Protection detail API403 reflects connector administration limits. No protection/settings changes were made.
- Initial open PR/issue lists empty. Subsequent Dependabot PRs are independent and untouched.
- Shell clone/fetch works; authenticated connector Git tree/commit/ref operations publish changes because shell push has no credentials. Exact local/remote trees are verified; author metadata means commit IDs can differ.

## Implementation state at checkpoint

| Area | Branch / PR | State |
|---|---|---|
| Base CI | `overhaul/infra-ci`, [#54](https://github.com/yakisoba0728/UnsolvableOJ/pull/54) | INTEGRATED after independent review and exact-head CI43780585600 |
| Native CI/context | `overhaul/reliability-ci`, [#57](https://github.com/yakisoba0728/UnsolvableOJ/pull/57) | INTEGRATED after review, 9 policy tests, all12 jobs in43781976177 |
| Judge | `overhaul/judge-hardening`, [#55](https://github.com/yakisoba0728/UnsolvableOJ/pull/55) | INTEGRATED; full CI43782671800 passed |
| Front | `overhaul/frontend-quality`, [#56](https://github.com/yakisoba0728/UnsolvableOJ/pull/56) | INTEGRATED after final review corrections and CI43782820352 |
| Database | `overhaul/database-performance`, [#58](https://github.com/yakisoba0728/UnsolvableOJ/pull/58) | INTEGRATED; CI43782814422 passed |
| Backend | `overhaul/backend-correctness`, [#59](https://github.com/yakisoba0728/UnsolvableOJ/pull/59) | INTEGRATED; full CI43782676706 passed |
| Security | `overhaul/security-boundaries`, [#60](https://github.com/yakisoba0728/UnsolvableOJ/pull/60) | INTEGRATED; full CI43782682001 passed |
| Evidence/tools | `overhaul/audit-evidence` | Reports, inventory and approved HTTP harness being consolidated |

## Last local combined evidence

A separate `overhaul/verification-candidate` checkout combines the reviewed Back/Security/Database changes only for testing; it is not a remote integration substitute. Combined static/unit/build passed **296 units /22files**. All26 migration round-trip/upgrade/refusal checks passed. Actual PostgreSQL17.11/Redis8.10.3 API suite passed **175 tests /28files**,72.77s. Final index-extraction cleanup removed an unused type import; migration/API rebuilds consumed the latest source. HTTP comparison completed with three fresh processes per source and nine samples per concurrency. The merged integration Back/src tree exactly matches the measured/tested candidate: `2be5615a912a710c33b3feea3d6040143dd714dd`.

Independent QA approved Front/Back/Security/Judge/Database, including corrections to notification ordering and benchmark connection guards. HTTP tool independent safety8/8 passed, including interrupted-request cleanup. See REVIEW.md. Source review is separate from CI; failed/unexecuted CI will not be merged.

## Environment and failures preserved

Node24.22.1/npm11.9.0; user-local PostgreSQL17.11 and Redis8.10.3; no Docker locally. Browser launch and required Unix sockets are blocked; requested escalation was automatically rejected. No control was bypassed. Actual browser/native isolation runs use disposable GitHub Actions.

Each shell call has a separate process/network namespace; services and clients run under one invocation. Initial cross-worktree dependency symlinks caused declaration portability errors and were replaced by independent installs. A security API run overlapped a build and lost compiled seed imports; the sequential rerun passed167/167. Initial test-fixture/type mistakes and independent-review defects were fixed, with baseline and after reruns. No tests, assertions or CI conditions were weakened.

## Next actions

1. Complete the bounded validation follow-up: real worker process kill/restart with explicitly simulated lease expiry, plus selected Firefox core flows in full CI. Source review and actual CI are required before integration.
2. Integrate this evidence/tooling branch after independent review and applicable CI; do not represent pending validation as passed.
3. Fetch final integration, validate combined source contracts and create integration→main PR with forced full CI.
4. Record final full results and remaining limits. Leave main PR unmerged; no deployment.

No production service/data/secret or paid resource is used. No automatic continuation after this session is promised. Resume by re-reading actual GitHub heads/runs before acting; this checkpoint is time-specific.
