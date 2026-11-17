# Frontend consolidation audit and implementation

## Scope and ownership

Worker: `/root/frontend_ux`. Isolated worktree `oj-front`, branch `internal/consolidation-front`.
Source baseline: `a687887068baf6d793cb752468ec336619610d1e`, exact Phase V tree `a2a2409dfd3e73b82ba7b39c2e41808eba7b5813`.
Only `Front/**` is changed. No remote writes, PR changes, workflow changes, dependency changes, browser security-mode changes, production services or paid resources.

All 30 page modules and the 36 top-level route declarations/four admin children were inventoried. Detailed source review concentrated on authentication lineage, asynchronous ownership, navigation, editors, shared focus controls and private account state. This is not a claim of complete state-space review or manual browser/accessibility certification.

## Confirmed defects and fixes

| ID | Severity | Before | Implementation | Regression evidence |
|---|---|---|---|---|
| FRONT-1 | P1 correctness | Community post/comment write receives 401, api refreshes the same login, App keys on accessToken and remounts the page. Old completion is ignored while the replacement input is unlocked; a committed write can appear unfinished and be submitted again. | Community route identity now uses account/login identity/path rather than rotating token. Composer and post actions use the existing identity-aware `useRequestOwner`. PostPage's duplicate mounted/navigation/token guard was removed. | Actual App/AuthProvider/router jsdom execution reproduces two failures; account/new-login controls pass. Browser cases cover new post, edit, answer and four stale-login controls. |
| FRONT-2 | P1 correctness | Settings username/password API refresh changes `getSessionVersion`, so successful PATCH session response is ignored and the form remains pending. | Accept completion only for the same login identity and still-mounted page. Preserve accepted completion through its own synchronous session replacement. Serialize account mutations with a ref plus disabled mutation controls so different responses cannot replace each other's session. | Actual DOM reproduces username/password failures. Browser cases assert one 401 refresh, exactly two HTTP attempts, accepted session, retained success feedback and cleared password fields. |
| FRONT-3 | P2 privacy/UX | A different login of the same user reuses SettingsPage and retains previously entered current/new/confirmation passwords and pending state. Late failure can also update the replacement login's status. | Layout effect clears secret inputs and mutation state before paint when login identity changes; stale success/failure/device completions are ignored. Same-login token refresh retains in-progress input. | Actual DOM reproduces two same-user-new-login failures; different-account controls already pass. Four browser cases cover account/login replacement × delayed success/failure. |

There is no new endpoint, data schema, dependency, feature flag or response contract. The changes do not relax authentication: server authorization remains authoritative, and a new login invalidates client request ownership even for the same user ID.

## Test execution

Implementation commits, in dependency order:

1. `6d7919c183704f0af73f14762a3a2486c5820023` — `fix(front): retain community write ownership through token refresh`.
2. `7d15a11216f4170181d29f66eab9ddd30a348349` — `fix(front): bind settings mutations to the current login`.

The branch is clean. Both commits need the coordinator's independent review; this report is an implementation/evidence handoff, not an approval. No dependency or lockfile change was made.

| Check | Result | Evidence |
|---|---|---|
| Same final DOM harness, baseline community | 2 failed, 4 passed; expected exit 1 | `frontend-dom-probe/final-community-before.json` and `.log` |
| Same final DOM harness, candidate community | 6 passed, 0 failed | `frontend-dom-probe/final-community-after.json` and `.log` |
| Same final DOM harness, baseline Settings | 4 failed, 2 passed; expected exit 1 | `frontend-dom-probe/final-settings-before.json` and `.log` |
| Same final DOM harness, candidate Settings | 6 passed, 0 failed | `frontend-dom-probe/final-settings-after.json` and `.log` |
| Final `npm run check --prefix Front` | Exit 0: TypeScript + Vite build, 10-answer bundle leakage guard, telemetry 7/7, E2E TypeScript | `frontend-final-check.log` |
| Playwright discovery `npx playwright test session-refresh.spec.ts --list` | Exit 0, 54 cases: 18 per Chromium/Firefox/WebKit; 13 per engine newly added (39 new entries) | Command output; discovery only |
| `git diff --check` before commit | Exit 0 | Command output |

All artifact paths above are relative to `/workspace/scratch/c0f7c387c945/`. Final DOM reports record the baseline's exact `a687887...` HEAD and empty diff. Candidate reports record `6d7919c...` plus the full Settings source diff; that exact diff was committed without subsequent changes as `7d15a11...`. Build verification used those same committed file contents.

The DOM `pending` observation records control disablement **before releasing the delayed response**, not final request state. In Settings a disabled button after a login replacement can also mean an unchanged username/empty password. `secretsCleared` is similarly sampled before releasing the old response. The post-response assertions use completion feedback, accepted session, lack of stale update, route and request counts. The new native-browser tests additionally assert that no processing status remains and that successful password changes clear the fields.

Reproduce without changing repository dependencies (Node v24.22.1, jsdom 31.0.1 installed only in scratch):

```sh
node Front/scripts/consolidation-session-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-front /workspace/scratch/c0f7c387c945/frontend-dom-probe candidate-community.json community
node Front/scripts/consolidation-session-dom-probe.mjs /workspace/scratch/c0f7c387c945/oj-front /workspace/scratch/c0f7c387c945/frontend-dom-probe candidate-settings.json settings
npm run check --prefix Front
```

For baseline reproduction, run the same committed probe script against `/workspace/scratch/c0f7c387c945/oj-front-baseline`, which is detached at the exact `a687887...` baseline. The scratch probe directory provides jsdom; `Front/node_modules` provides esbuild/React. Baseline Front/node_modules is a symlink to the installed candidate dependencies. The probe uses mock fetch data and never contacts a production service.

- Front dependency install succeeded, 214 packages; lockfile unchanged.
- Initial `npm run check --prefix Front` passed production TypeScript/Vite, answer-leakage guard, all seven telemetry privacy regressions, and E2E TypeScript.
- `consolidation-session-dom-probe.mjs` runs the actual App/AuthProvider/page components under jsdom 31.0.1 with synthetic fetch and a real memory router. It emits exact source HEAD/diff, runtime version, all observations and limitations. This is DOM execution, not native browser execution, layout, paint or backend authorization.
- New Playwright regressions: 13 per selected engine, appended to existing `session-refresh.spec.ts`. That filename is already selected by Chromium, WebKit and explicit Firefox CI. Nothing is skipped, retried, relaxed or removed.
- Native local browser launch failed before app assertions: installed Chromium exits with `process_singleton_posix.cc: socket() failed: Operation not permitted`. Pinned Playwright browsers are absent. No sandbox or network restriction was changed. Native three-engine execution remains the coordinator's exact-final-HEAD CI gate.
- Early DOM harness setup attempts (wrong selector/missing browser-global shim and an inherited-fieldset `.disabled` measurement) were corrected before recording source acceptance. Their failed output is not an application result. Final reports use the same final probe source; `matches(:disabled)` captures actual fieldset disablement. No application assertion was removed.

## Complete route mapping

These are the 36 declarations in `Front/src/App.tsx`, including the fallback, mapped to the 30 page modules (NotFoundPage lives inline in App). The explicit admin children add four named routes plus index/fallback redirects.

| Route | Page module |
|---|---|
| `/` | HomePage |
| `/auth` | AuthPage |
| `/problems` | ProblemsPage |
| `/problems/new` | CreateProblemPage |
| `/my-problems` | MyProblemsPage |
| `/my-problems/:id/edit` | CreateProblemPage |
| `/problems/view/:slug` | ProblemPage |
| `/problems/:slug` | ProblemPage |
| `/profile` | ProfilePage |
| `/learning` | LearningPage |
| `/settings` | SettingsPage |
| `/account/withdrawn` | WithdrawalCompletePage |
| `/email/verify` | EmailActionPage |
| `/email/unsubscribe` | EmailActionPage |
| `/rankings` | RankingsPage |
| `/users/:username` | UserPage |
| `/community` | CommunityPage |
| `/community/new` | CommunityWritePage |
| `/community/:id/edit` | CommunityWritePage |
| `/community/:id` | CommunityPostPage |
| `/analysis` | AnalysisPage |
| `/vibe` | VibePage |
| `/vibe/attempts/:id` | VibeWorkspacePage |
| `/analysis/:id` | AnalysisQuestionPage |
| `/missions` | MissionsPage |
| `/enterprise` | EnterprisePage |
| `/enterprise/new` | EnterpriseFormPage |
| `/enterprise/:id` | EnterpriseDetailPage |
| `/enterprise/join/:code` | EnterpriseJoinPage |
| `/enterprise/attempts/:id` | EnterpriseAttemptPage |
| `/enterprise/:testId/attempts/:attemptId/vibe/:id` | EnterpriseVibeReviewPage |
| `/enterprise/:id/edit` | EnterpriseFormPage |
| `/submissions` | SubmissionsPage |
| `/submissions/:id` | SubmissionPage |
| `/admin/*` | AdminPage |
| `*` | NotFoundPage (inline) |

AdminPage children: `/admin/users` → AdminUsers, `/admin/community` → AdminReports, `/admin/audit` → AdminAudit, `/admin/ops` → AdminOpsView. The admin index and unmatched child path redirect to `users`. This mapping does not assert backend authorization coverage.

## Route and source review inventory

| Module | Reviewed focus and retained boundary | Verification scope |
|---|---|---|
| HomePage | Account-owned root key; parallel recommendation/profile/history reads | Source review and existing suite inventory |
| ProblemsPage | URL search/filter/page ownership; facets; saved-list auth request | Source review and existing suite inventory |
| ProblemPage | Per-user source/draft scope, editor recovery, submission result, split observer cleanup | Detailed source review; native editor/layout deferred to CI |
| SubmissionsPage | Owner-keyed private history, grouped/status/date filters, pagination | Source review |
| SubmissionPage | Submission result hook, author/admin rejudge UI, owner key | Source review; backend controls independently required |
| ProfilePage | Owner-keyed records, date/streak helpers, local storage preferences | Source review |
| LearningPage | Login identity key, owner-specific goals/read refresh | Source and Phase V regression protocol review |
| SettingsPage | Session replacement, password fields, device writes | Changed; DOM and new browser regressions |
| UserPage | Public encoded username, abortable profile load, no private profile fetch | Detailed source review |
| RankingsPage | Public server pagination, current-user highlighting | Source review |
| AuthPage | Navigation/session-version guards and login/signup validation | Detailed source review |
| EmailActionPage | Fragment token removal, abort on identity change, same-login refresh | Detailed source review |
| WithdrawalCompletePage | Authorized completion state and session identity | Source review |
| CommunityPage | URL filters, abortable owner-dependent list/follow reads | Source review |
| CommunityWritePage | New/edit draft scope, delayed write ownership, safe compare-and-clear | Changed; DOM and new browser regressions |
| CommunityPostPage | Parallel read fan-out, writes, answer drafts, navigation/identity ownership | Changed; DOM and new browser regressions |
| CreateProblemPage | Problem draft revision and ownership, cleanup, private manage load | Detailed source review |
| MyProblemsPage | Status/rejudge batch ownership and load cancellation | Source review; broader refresh interleavings not exhaustively tested |
| AnalysisPage | Analysis catalog/progress and filter state | Source inventory and common hooks |
| AnalysisQuestionPage | Guest/user result persistence, alive guard, async verdict | Detailed source review |
| MissionsPage | Re-export to ServerMissions and shared APIs | Source inventory and common hooks |
| EnterprisePage | Identity/path/navigation-entry key, owned test lists | Source review |
| EnterpriseFormPage | Draft preservation under rotation; immutable editing ownership | Source and prior regression review |
| EnterpriseDetailPage | Results query/export and identity ownership | Source and prior regression review |
| EnterpriseJoinPage | Identity-aware confirmation/start request; token-dependent read | Detailed source review |
| EnterpriseAttemptPage | Pinned exam and editor state, login/navigation ownership | Source and prior regression review |
| EnterpriseVibeReviewPage | Owned result display/pinned review contracts | Source inventory and existing test inventory |
| AdminPage | Guarded role route, users/community/audit/ops children; abortable reads | Source review of mutation/read boundaries; complete state matrix deferred |
| VibePage | Catalog/history/start and popup ownership | Source review; late popup-start completion remains a targeted follow-up candidate, not reproduced here |
| VibeWorkspacePage | Account/path editor key, autosave/ref state, mount/observer cleanup | Detailed lifecycle review and existing bounded editor protocol; long-session/native validation deferred |

Shared review includes `App.tsx`, `auth.tsx`, `api.ts`, `hooks.ts`, `useUnsavedChanges`, `useRequestOwner`, ConfirmDialog, ActionMenu, Select, SiteHeader, RouteFocus, DateTimePicker, NotificationBell, ProblemBookmark, CodeEditor, editor drafts and AccountPrivacyPanels. Reused the React best-practices checklist for hooks, stable dependencies, component identity, accessibility and chunk boundaries. No framework/component library rewrite was adopted.

## Performance and unresolved scope

No performance optimization is claimed. Removing the duplicate request-owner hook is maintainability work; build sizes must be compared under the coordinator's controlled before/after protocol. The existing >500 kB ProblemMarkdown chunk warning remains visible. No field INP, LCP/CLS gain, CPU/heap improvement, long-session leak absence or maximum capacity result is inferred from these changes.

Manual screen reader/physical-device coverage, all role/state combinations, native engine assertions, full editor duration and live backend integration remain explicitly unperformed locally. The historical Phase V 30-module/route inventory and browser observations remain historical evidence, not this final commit's execution.

A separate source-backed follow-up candidate (not a confirmed finding in this handoff) exists in VibePage.start: the popup/fallback navigation has no request identity/navigation guard after its awaited creation call. This worker did not reproduce or change that path because the coordinator bounded this pass to confirmed community and Settings defects. Do not describe this candidate as validated exploitable disclosure; server access controls still apply.


## Remaining coordination gates

- Independently review and cherry-pick both commits in order; no self-approval is offered.
- Run the unchanged exact-final-HEAD CI, including the existing session-refresh spec on all selected engines. Added tests have been typechecked and discovered, but native browser pass counts remain zero locally.
- Have Performance compare baseline/candidate under the common fixture/environment. The final build took 56.38 seconds while other processes were active; this is a build log value, not a controlled performance result. Current output includes index 383.92 kB / 123.57 kB gzip and ProblemMarkdown 610.48 kB / 184.67 kB gzip; the warning was retained unchanged.
- Carry the route inventory and the explicit reviewed/deferred distinctions into the coordinator report. No unsupported clean bill of health is claimed for routes with only inventory or shared-hook review.
