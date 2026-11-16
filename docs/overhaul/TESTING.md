# Testing and validation evidence

A test counted here was actually executed. Discovery/compilation, mocks, React DOM and real browsers are distinguished. All data and credentials used in tests are synthetic; PostgreSQL/Redis services and Actions runners are disposable.

## Baseline

| Layer | Observed result |
|---|---|
| Back Node24.22.1 `npm run check` | Lint/type/build and275 units /18files passed |
| Front `npm run check` | Build, answer-bundle privacy guard,3 telemetry tests and E2E types passed |
| Front browser-free Playwright project |85 tests passed |
| Judge `npm run check` | Build and89 tests passed |
| Judge Python health |1 test passed |
| Main CI43778049679 | Success; native/full job skipped |

## Local changed and combined suites

| Change | Actual result |
|---|---|
| Backend lock/eligibility | Focused baseline3fail/1pass;3selected actual DB races all fail before fix. Changed279 units and166 API tests passed. |
| Security boundaries | Initial focused6fail/6pass; HTTP3fail/1pass. Optional guard baseline3unit failures/2passes and2HTTP failures/2passes. Final288units and167API tests passed. |
| Database |4 score semantic units;26-migration upgrade/refusal/rollback checks;4 relevant API files18/18 passed. Raw benchmark medians/digests independently recomputed. |
| Judge |94 tests plus1Python health test passed;160,000 differential input pairs included. Root reran full check; QA reran4focused tests. |
| Front |Build, answer guard,7telemetry tests, test types and85browser-free units passed.12 notification browser regressions compile/discover; actual execution is recorded in CI. |
| Notification independent review |4confirmed ordering failures in initial patch; final4/4 ordinary and4/4StrictMode React DOM cases passed, including visible rows. This is not browser E2E. |
| CI policy |Initial gate regressions reproduced. Final9/9 actual-shell tests passed, including38native-risk paths and fail-closed cases. |
| Combined Back/Security/DB candidate |Lint/type/unit/build:296 units /22files. All26 migrations passed. Actual API/DB:175 tests /28files,72.77s. |
| New HTTP harness safety |Independent8/8 passed: target/protocol/opt-in/email/server DB guard, preservation of nonempty Redis, SIGINT130/SIGTERM143 cleanup during HTTP activity. |

Native local DB environment: PostgreSQL17.11, Redis8.10.3, Node24.22.1; services/clients share one owned process lifetime. CI uses its pinned configured images and dependency lockfiles. Build-consuming checks run sequentially per checkout.

## Verified Actions checkpoints

| PR / exact tested head | Run | Applicable results |
|---|---|---|
| #54 `df1d8e9fc71454f2e061bf6f7a42523ddd2ba0d3` | [43780585600](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43780585600) | Audit/images/components/browser/required passed; native skipped by then-current policy |
| #57 `60e680b4918f8d0cbaf6f86c5279bb5ece1e90dd` | [43781976177](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43781976177) | All12jobs success. Native runtime26/26, actual pipeline16/16, full Compose live browser2/2; browser matrix and all images/components passed |
| #58 `e1feb77304a36923357bcaa28d7b62e189798e1b` | [43782814422](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43782814422) | All applicable audit/image/Back/API/required jobs passed; unrelated browser/Judge/native jobs skipped by reviewed path policy |
| #55 `fa347ff4d2197699210ffe75f1655a4fe64cba5a` | [43782671800](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43782671800) | All12jobs successful, including native/runtime/pipeline/Compose and full browser selection |
| #56 `de6a80706604e85781b795e2f3573830f35fd3f8` | [43782820352](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43782820352) | All applicable build/privacy/browser/audit/image/required checks passed; native not selected for UI-only diff |
| #59 `4e5bc9400470f4c65a737acd98f81ba94c5d1360` | [43782676706](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43782676706) | All12full jobs successful |
| #60 `7752dd94b9ea85cce29234d0bd3bd6aaf33f53fa` | [43782682001](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43782682001) | All12full jobs successful |

Final validation-follow-up and combined main-PR runs are recorded when they actually finish. An older green run is never substituted for a changed head. Review metadata is in REVIEW.md; final readiness is in FINAL-REPORT.md.

## Failure and environment ledger

- Local browser downloads returned incomplete archives; installed Chromium launch failed required socket operations. Automatic escalation review rejected the action.321 baseline browser startup failures occurred before application execution;85browser-free tests passed. No permission control was bypassed; actual browsers run in Actions.
- Docker/go-judge are unavailable locally. Native/cgroup/seccomp/network/8-language tests run in authorized disposable Actions, never by launching untrusted user code on the shared host.
- Cross-worktree dependency symlinks caused TypeScript declaration portability errors; isolated installs fixed the environment without compiler relaxation.
- A security API run overlapped rebuilding its dist tree and failed8seed CLI imports. The sequential replay passed167/167 with no assertion removed.
- New fixture/import/type/invocation errors were corrected and rerun. Independent review caught actual notification and benchmark-tool defects; fixes were re-reviewed. These are not hidden as environmental passes.
- A migration refusal message for case-colliding legacy usernames is an expected asserted negative case, followed by successful migration-runner exit; it is not an ignored failure.

## Reproduction and gates

From a checkout with locked dependencies, run `npm run check --prefix Back`, `npm run check --prefix Front`, `npm run check --prefix Judge`, `node --test scripts/ci-policy.test.mjs`, and the documented disposable Back migration/E2E/pipeline commands. Native/browser suites need their configured Linux/Docker/browser capabilities; see `.github/CI.md` and VALIDATION-COVERAGE.md.

Require exact-head remote CI, independent code review, actual combined contracts and clean diff before integration. No test deletion, weakened assertion, disabled security control, forced main merge or production deployment is part of this work.
