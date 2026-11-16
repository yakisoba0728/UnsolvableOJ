# Phase V route, role and state inventory

Source baseline: `d0159b1f844bf0608415dded9e84af566c8e2041` / tree
`f12f6c377ea07f0cb4b498ca0fe5889ed4401a66`. This inventory was checked against
`Front/src/App.tsx`, `Front/src/pages/AdminPage.tsx`, the page modules and test
filenames. **30 page modules; 36 top-level route declarations**, including the
admin wildcard and the final not-found catchall. There are four explicit admin
child routes plus index/catchall redirects. These counts describe source, not
36 independently certified user journeys.

“Existing suite” means the named executable regression file exists. Execution at
the Phase V final source is recorded in the coordinator's CI receipt. A browser
route guard does not replace server authorization. The API remains authoritative
for ownership, private visibility and exam admission.

| Top-level route | Page module | Principal role / behavior | Existing suite examples |
|---|---|---|---|
| `/` | HomePage | Guest/member variants; independent summary requests | layout, learning-days |
| `/auth` | AuthPage | Login/signup/recovery; previous destination retained | auth, session-refresh |
| `/problems` | ProblemsPage | Public discovery; authenticated saved filter | problem-list, problem-bookmarks |
| `/problems/new` | CreateProblemPage | Author/admin guard; draft/validation | problem-authoring, editor-recovery |
| `/my-problems` | MyProblemsPage | Author/admin; own problems | problem-authoring |
| `/my-problems/:id/edit` | CreateProblemPage | Author/admin plus server ownership | problem-authoring, problem-editor |
| `/problems/view/:slug` | ProblemPage | Read/solve; server visibility; optional login | problem-content, solve-editor |
| `/problems/:slug` | ProblemPage | Legacy-compatible problem route | solve-editor, submission-samples |
| `/profile` | ProfilePage | Signed-in private history | account, privacy-refresh |
| `/learning` | LearningPage | Signed-in account/login-keyed goal and dashboard | learning-dashboard, learning-goals, phase5-ux |
| `/settings` | SettingsPage | Signed-in; forced-password-change landing | account, auth, privacy-email |
| `/account/withdrawn` | WithdrawalCompletePage | Completed withdrawal confirmation | account |
| `/email/verify` | EmailActionPage | Token action; navigation entry/hash scoped | privacy-email |
| `/email/unsubscribe` | EmailActionPage | Token action; allowed during forced password change | privacy-email |
| `/rankings` | RankingsPage | Public ranking/empty/error | data-regressions, pagination |
| `/users/:username` | UserPage | Public user view; unavailable/not found | data-regressions, privacy-refresh |
| `/community` | CommunityPage | Public discovery, member saved/voted filters | community, community-regressions |
| `/community/new` | CommunityWritePage | Signed-in account-owned draft | community, editor-recovery |
| `/community/:id/edit` | CommunityWritePage | Signed-in plus server author permission | community-regressions |
| `/community/:id` | CommunityPostPage | Public/member content, reactions/reporting | community-moderation, community-regressions |
| `/analysis` | AnalysisPage | Guest/member catalog and progress | analysis-missions |
| `/vibe` | VibePage | Guest/member catalog and availability | vibe, vibe-layout |
| `/vibe/attempts/:id` | VibeWorkspacePage | Signed-in plus server attempt ownership | vibe, editor-focus |
| `/analysis/:id` | AnalysisQuestionPage | Question/answer/result, availability | analysis-missions |
| `/missions` | MissionsPage | Delegates to missions/ServerMissions | server-missions, mission-community-polish |
| `/enterprise` | EnterprisePage | Listing; account/navigation-keyed content | enterprise, enterprise-refresh |
| `/enterprise/new` | EnterpriseFormPage | Signed-in creator; server policy, field validation | enterprise, phase5-ux |
| `/enterprise/:id` | EnterpriseDetailPage | Owner/candidate variants; results/export boundary | enterprise-results, enterprise-pinned-summary |
| `/enterprise/join/:code` | EnterpriseJoinPage | Invitation/eligibility/start; login as needed | enterprise, enterprise-ownership |
| `/enterprise/attempts/:id` | EnterpriseAttemptPage | Server admission/attempt ownership; deadline | enterprise-attempt, enterprise-ownership |
| `/enterprise/:testId/attempts/:attemptId/vibe/:id` | EnterpriseVibeReviewPage | Signed-in reviewer plus server ownership | enterprise-vibe, enterprise-vibe-versioning |
| `/enterprise/:id/edit` | EnterpriseFormPage | Signed-in owner; scheduled/editable check | enterprise, enterprise-refresh |
| `/submissions` | SubmissionsPage | Signed-in private pagination | submissions, pagination |
| `/submissions/:id` | SubmissionPage | Signed-in plus server visibility; verdict/diagnostic | submissions, submission-samples |
| `/admin/*` | AdminPage | ADMIN; guest login/member not-found | admin, admin-moderation |
| `*` | NotFoundPage component | Unmatched route | qa-regressions |

Admin children: `/admin/users` (`AdminUsers`), `/admin/community`
(`AdminReports`), `/admin/audit` (`AdminAudit`), `/admin/ops` (`AdminOpsView`).
Admin index and unmatched children redirect to `users`. All are behind the
parent role check and retain API authorization.

## Representative role journeys and coverage boundaries

| Journey / state | Reused executable evidence | Phase V contribution / remaining boundary |
|---|---|---|
| Guest discovery → login → destination | auth, problem-list, navigation-accessibility | Shared shell retained; no claim of every guest/error combination |
| Student discovery → bookmark → goal → submit → result/statistics | problem-bookmarks, learning-goals, solve-editor, submissions; existing Compose judge flow | Goal refresh keeps confirmed content and disables writes; initial load/whole-lifetime CLS remains measured separately |
| Author draft → validation → save/reopen | problem-authoring, problem-editor, editor-recovery | Existing functionality preserved; no new author workflow |
| Enterprise create/edit → invite → attempt → review/export | enterprise, enterprise-attempt, enterprise-results, enterprise-vibe; existing Compose enterprise flow | Date/time keyboard-close paths now return focus; outside focus is preserved |
| Admin users → reports/audit/operations | admin, admin-moderation | Existing route guards and controls retained; operational host readiness is separate |
| Loading, empty, failure/retry | load-errors, learning-dashboard, learning-goals, enterprise-results | Refresh loading is distinct from absent goal and from a failed/lost write |
| Long text and narrow screens | learning-dashboard, learning-goals, layout, ui-harmony | New exact goal geometry at 320/375/768/1440 px, light/dark and reduced motion; screenshots require actual CI execution |
| Token rotation, account switch, new tab | session-refresh, privacy-refresh, enterprise-ownership, learning-goals | Existing account/login key and abort/uncertain-write behavior retained; new browser spec does not replace these suites |
| Keyboard and dialogs | navigation-accessibility, editor-focus, enterprise | New hour/minute Enter, Done, Clear, Escape and outside-focus assertions; no manual assistive-technology certification |
| Long editor session / memory / field vitals | Existing bounded editor recovery and live learning probe | Long-duration editor heap, real mobile hardware, field INP and population performance remain unverified |

The product's shipped interface is Korean. Long Korean/Latin text regressions
exist, but this phase does not establish full multilingual localization or a
complete contrast/screen-reader audit. Full-site screenshots across every route,
role, viewport, state and engine would be a distinct, substantially larger
matrix; selected coverage must not be described as that matrix.
