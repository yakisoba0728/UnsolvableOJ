# Frontend audit and implementation

## Baseline and scope

- Baseline: `6176015b63a1615cc2269172f246725ef08abab3` (`main`, verified from GitHub on 2026-11-16).
- Working branch: `overhaul/frontend-quality`.
- Inventory: 110 files under `Front/src` at baseline, including 29 page modules. Routes are defined in `Front/src/App.tsx`; most page modules are loaded on demand.
- This pass indexed the whole frontend and inspected the principal authentication, request, editor, submission, enterprise, community, notification, Markdown and telemetry paths. It does **not** assert that every UI state has been manually exercised.
- No API, schema, package-lock, deployment or authorization policy change is required by these changes.

## Feature and test map

| Area | Entry points and responsibilities | Existing test families |
| --- | --- | --- |
| Shell and account | `App`, `SiteHeader`, `auth`, `api`; routing, role-aware navigation, refresh rotation, cross-tab login, themes | `auth`, `account`, `session-refresh`, `privacy-refresh`, `layout`, `ui-harmony` |
| Account privacy | Settings, device sessions, password changes, email verification/preferences/unsubscribe, withdrawal | `privacy-email`, `privacy-refresh`, `account` |
| Public problems | Search, server pagination/facets, sorting, difficulty, tags, continuation suggestions | `problem-list`, `problem-metadata`, `pagination`, `page-range` |
| Authoring | Create/edit, local recovery drafts, statement/Markdown, testcase editor, publication workflow | `problem-authoring`, `problem-editor`, `problem-content`, `editor-recovery` |
| Solving and submissions | Eight language editor templates, local scoped drafts, sample runs, submit, polling, history, rejudge | `solve-editor`, `editor-focus`, `editor-persistence`, `submissions`, `submission-samples`, `load-errors`; live Judge flow |
| Learning | Home/profile/public user statistics, rankings, analysis questions, missions, streaks, reward state | `analysis-missions`, `server-missions`, `learning-days`, `mission-community-polish` |
| Community | Lists, write/edit, comments, votes, saves, following, moderation, reports, notifications | `community`, `community-regressions`, `community-moderation`, `admin-moderation`; live community flow |
| Enterprise | Test creation/scheduling, invited candidates, attempts, submissions, hidden/released scores, review | `enterprise`, `enterprise-attempt`, `enterprise-vibe` |
| Vibe coding | Catalog, attempt workspace, file revisions, autosave/recovery, AI proposals, test execution, submission/reflection | `vibe`, `vibe-layout`, `enterprise-vibe` |
| Administration | User/role management, moderation, operational and queue views | `admin`, `admin-moderation` |
| Shared editor and display | Keyboard/IME behavior, snippets, resizable panels, sanitized Markdown/math, confirmation dialogs | `autocomplete`, `code-editing`, `solve-split`, `editor-focus`, `vibe`, `problem-content` |
| Monitoring and build privacy | Optional Sentry error reporting, email bearer-link suppression, payload scrubbing, answer-bundle checks | `scripts/monitoring-privacy.test.mjs`, `scripts/check-bundle-answers.mjs` |

The updated Playwright configuration discovers 1,035 test instances in 42 spec files, including browser repetition. This is a discovery count, **not** a count of executed passes. The `unit` project has 85 browser-free cases. Live tests have separate configuration and require the real isolated backend/Judge stack.

## Findings and changes

| ID | Severity | Finding | Change and status |
| --- | --- | --- | --- |
| FRONT-001 | P1 | Notification UI state did not follow authentication identity changes. | The header now keys the notification component by user and login identity; pending list, count and mutation responses are cancelled or ignored after their owner is gone. Reproduced in React DOM; implemented; browser CI and independent review pending. |
| FRONT-002 | P2 | Repeated load-more activation could issue duplicate requests and append duplicate rows. | Synchronous request ownership prevents repeated activation before disabled state renders; appended pages deduplicate stable IDs. Reproduced in React DOM; implemented; browser CI pending. |
| FRONT-003 | P2 | Notification loading errors lacked an in-panel retry; failed read operations could present an inaccurate unread state. | Added retry, loading feedback, guarded read-all activation and successful-response updates. Existing data remains available during same-account refresh. Six browser regressions cover ownership, pending responses, duplicate activation, retry, failed reads and stale unread polling; browser CI pending. |
| FRONT-004 | P2 | Configured telemetry contributed SDK code to the initial application entry. | Separated the optional SDK behind a small, testable client and an error-only adapter chunk. Initial entry reduced under the telemetry-enabled comparison below. Four lifecycle/privacy regressions pass locally. |

These public descriptions omit detailed exploitation instructions and contain no actual user data or credentials. There is no claim of a backend authorization bypass.

## Architecture decision: optional telemetry

Keep React, Vite and Sentry. The initial module creates a small client; it imports the SDK only when monitoring is configured and the current route is outside the email-action privacy boundary. Initialization and early error reporting share the same import promise. The route is checked again after the import resolves, and the existing telemetry scrubber remains active for breadcrumbs and events. Import failure is caught and a later report can retry.

`monitoringSdk.ts` re-exports only `init` and `captureException`. Importing the vendor's complete export namespace produced an unnecessarily large optional chunk during the experiment; that version was rejected. The committed adapter retains only error reporting. There is no session replay, tracing, new telemetry destination or new dependency.

Tradeoff: with monitoring enabled, SDK initialization occurs asynchronously; errors explicitly sent through `reportError` wait for it. Errors before SDK instrumentation attaches are outside that instrumentation window. This change improves initial entry size, not measured network latency or total application size. With monitoring disabled, the baseline already eliminated most SDK code, so no default-configuration bundle reduction is claimed.

## Measurements

Environment: Linux x86-64, Node `24.22.1`, npm `11.9.0`, Vite `7.3.8`; reported CPU AMD EPYC 9V74, 9 available logical CPUs, approximately 10.45 GB host-visible memory. Builds used the committed lockfile (`npm ci`). Runtime hardware shares other workloads; single build durations are observations, not a performance claim.

### Isolated telemetry comparison

Both builds use the notification fix commit `58784a4f8e920f4d365fb84f6754f3b298a735e2` as the code baseline; only the monitoring implementation differs. Use a synthetic, non-routable build-time DSN to retain configured-monitoring code. No requests were sent to that address.

| Metric | Static monitoring | Deferred monitoring | Change |
| --- | ---: | ---: | ---: |
| Initial JS entry, bytes | 473,882 | 380,815 | -19.64% |
| Initial JS entry, gzip bytes | 155,519 | 122,700 | -21.10% |
| Optional error SDK chunk, bytes | included in entry | 92,991 | deferred |
| Optional error SDK chunk, gzip bytes | included in entry | 32,184 | deferred |
| Initial plus optional SDK, bytes | 473,882 | 473,806 | -76 bytes |
| Observed build time | 6.28 s | 5.92 s | not treated as a benchmark |

These are deterministic artifact sizes from one build per variant, gzip via Node's `gzipSync`. They do not demonstrate improved LCP, CPU use, memory use, or API performance. Browser timing remains unmeasured.

Reproduction, in `Front/` at each relevant commit:

```sh
npm ci --no-fund --no-audit
VITE_SENTRY_DSN=https://public@example.invalid/1 npm run build
```

Read the module script path from `dist/index.html`; measure that file and gzip it. The adapter's `monitoringSdk-*.js` chunk is separate. For an isolated before comparison use commit `58784a4`; for after use the subsequent frontend performance commit.

### Default configuration and notification request behavior

| Metric | Baseline | After | Interpretation |
| --- | ---: | ---: | --- |
| Default initial JS | 377.84 kB | 380.79 kB | Safety/lifecycle logic adds about 2.95 kB; no improvement claimed |
| Default initial JS, gzip | 121.58 kB | 122.68 kB | About 1.10 kB added |
| Initial stylesheet | 144.89 kB | 144.89 kB | Unchanged |
| Requests from two immediate load-more activations | 2 | 1 | React DOM execution with identical response fixture |
| Rows after those activations (one initial plus one new) | 3 | 2 | Duplicate removed |

## Verification record

| Check | Actual local result |
| --- | --- |
| Baseline `npm run check` | Passed: production build, answer-bundle check, 3 telemetry tests, E2E TypeScript check |
| Updated `npm run check` | Passed: production build, answer-bundle check, 7 telemetry tests, E2E TypeScript check |
| `npx playwright test --project=unit` | 85 passed; final run 3.3 seconds |
| React DOM reproduction against baseline and modified source | Baseline retained prior identity state and duplicated a page; modified source passed both scenarios |
| Production dependency audit | `npm audit --omit=dev --json`: 0 reported vulnerabilities |
| Baseline local Chromium suite | 85 unit passes; 321 browser starts failed before application execution due sandbox `socket()` permission denial |
| New browser regression execution | Blocked at the same browser startup boundary; no local browser pass claimed |
| Firefox / WebKit | Not executed locally; browser downloads returned incomplete archives |
| Live backend/Judge E2E, real browser performance and accessibility | Not executed locally in this pass |
| Independent review and GitHub CI | Coordinator gate; pending at the time of this document |

Playwright's normal browser installation was attempted and returned invalid/incomplete ZIP archives. The installed system Chromium was then attempted through a temporary local config, but the command environment denied required socket creation. Escalated execution was rejected by the configured approval policy. No security control was bypassed. Browser verification must run in the approved GitHub Actions environment before integration.

The DOM reproduction used temporary JSDOM tooling only; it is not a browser replacement or a new project dependency. The package lock was restored with `npm ci` before final checks and measurements. One check invocation was accidentally run at repository root (no `package.json`), then rerun successfully from `Front/`; this was an invocation error, not a code-test pass.

## Follow-up and limits

- Run the six new regressions and the existing Chromium/Firefox/WebKit suites in CI; do not merge on local type/build results alone.
- Live candidate/Judge flows, responsive layouts and accessibility need the existing integration/browser gates.
- Home/profile/problem pages still derive some summaries from full submission history. Enterprise problem selection reads all selectable problems. Both are scaling candidates requiring a coordinated API contract and measured dataset; no unmeasured optimization was applied.
- Large editor/workspace render costs and one-second Vibe timer updates need browser profiling before memoization or component splitting is justified.
- Broader async ownership tests for enterprise navigation and in-flight operations remain useful follow-up coverage. No unverified vulnerability is asserted for those paths.
- External font loading remains an availability/privacy dependency; no deployment policy was changed in this pass.

### Invitation policy guidance

The coordinator aligned the assessment form help text with the security branch: email invitations require a verified address; explicit username invitations remain available when email verification is not configured. No new endpoint or form field was added.
