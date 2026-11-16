# Progress and resumable handoff

## Verified baseline and repository permissions

- Main baseline: `6176015b63a1615cc2269172f246725ef08abab3`, checked from Git and GitHub API at start.
- Baseline CI: [43778049679](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43778049679), success with native/full skipped.
- Integration checkpoint before this evidence PR: `57cd03a92eb7811ed290d586c11756aa0b9cdace` after reviewed PRs #54–#60 and #62 (eight feature/CI/validation PRs).
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
| Recovery and Firefox | `overhaul/recovery-validation`, [#62](https://github.com/yakisoba0728/UnsolvableOJ/pull/62) | INTEGRATED after independent review and all12 jobs in43784688710; native26, pipeline17, Compose2, standard selection603 including85 browser-free units, additional Firefox74 passed |
| Evidence/tools | `overhaul/audit-evidence`, [#61](https://github.com/yakisoba0728/UnsolvableOJ/pull/61) | TESTED / REVIEWED locally; this document is part of its final publication. Exact-head CI and merge state are in the PR. The earlier43e7ffd run43784074455 passed, but does not certify later documentation commits. |

## Last local combined evidence

A separate `overhaul/verification-candidate` checkout combines the reviewed Back/Security/Database changes only for testing; it is not a remote integration substitute. Combined static/unit/build passed **296 units /22files**. All26 migration round-trip/upgrade/refusal checks passed. Actual PostgreSQL17.11/Redis8.10.3 API suite passed **175 tests /28files**,72.77s. Final index-extraction cleanup removed an unused type import; migration/API rebuilds consumed the latest source. HTTP comparison completed with three fresh processes per source and nine samples per concurrency. The merged integration Back/src tree exactly matches the measured/tested candidate: `2be5615a912a710c33b3feea3d6040143dd714dd`.

Independent QA approved Front/Back/Security/Judge/Database, including corrections to notification ordering and benchmark connection guards. HTTP tool independent safety8/8 passed, including interrupted-request cleanup. See REVIEW.md. Source review is separate from CI; failed/unexecuted CI will not be merged.

## Environment and failures preserved

Node24.22.1/npm11.9.0; user-local PostgreSQL17.11 and Redis8.10.3; no Docker locally. Browser launch and required Unix sockets are blocked; requested escalation was automatically rejected. No control was bypassed. Actual browser/native isolation runs use disposable GitHub Actions.

Each shell call has a separate process/network namespace; services and clients run under one invocation. Initial cross-worktree dependency symlinks caused declaration portability errors and were replaced by independent installs. A security API run overlapped a build and lost compiled seed imports; the sequential rerun passed167/167. Initial test-fixture/type mistakes and independent-review defects were fixed, with baseline and after reruns. No tests, assertions or CI conditions were weakened.

The first recovery CI43784164298 failed because Vitest polling ran in a setup hook. The first worker start moved into the active test body, preserving all assertions and timeouts. Corrected head8801454 passed all12 jobs in43784688710; independent QA checked the actual35.228-second recovery case and74 distinct Firefox cases. Database lease expiry is simulated; worker death, timer, queue and replacement execution are real.

## Final publication and resumable handoff

This committed checkpoint precedes its own evidence-PR merge and the final integration→main run. It cannot contain the SHA of a future merge that includes itself. The final exact integration HEAD, main-PR URL, final CI run and readiness are recorded in the description of [evidence PR #61](https://github.com/yakisoba0728/UnsolvableOJ/pull/61) and the [integration→main PR](https://github.com/yakisoba0728/UnsolvableOJ/pulls?q=is%3Apr+head%3Aoverhaul%2Fintegration+base%3Amain). Re-read those live records before resuming; never substitute the checkpoint's earlier green runs.

Remaining coordinator actions at this commit:

1. Publish the independently reviewed evidence tree, require its applicable exact-head CI, then merge #61 into integration.
2. Create integration→main PR and require the forced full workflow on the combined latest head, including Firefox and native recovery.
3. Record the final head/run/results in both PR descriptions and the user handoff. Leave main PR unmerged; no deployment.

The report is [FINAL-REPORT.md](FINAL-REPORT.md). Unfinished platform-wide verification and operational work remain explicit in [BACKLOG.md](BACKLOG.md) and [VALIDATION-COVERAGE.md](VALIDATION-COVERAGE.md); they are not silently marked complete by code integration.

No production service/data/secret or paid resource is used. No automatic continuation after this session is promised. Resume by re-reading actual GitHub heads/runs before acting; this checkpoint is time-specific.
