# Phase IV frontend scope and verification

Baseline: `3bcba380f92bd2da8973e6c88c00cd14b03be08e` (Phase III).

## Bounded route and state inventory

The source contains **30 page modules**, including the Missions re-export. This
inventory follows `Front/src/App.tsx`, those modules and their shared state
components; it is a source inventory, not a complete visual/WCAG audit.

| Area / modules | Routes and existing state handling |
|---|---|
| HomePage | `/`; independent problem/profile/ranking/history loading and retry, guest/member variants |
| ProblemsPage, ProblemPage | `/problems`, `/problems/view/:slug`, `/problems/:slug`; bounded list/filter/empty/error states, bookmarks, editor and judging |
| CreateProblemPage, MyProblemsPage | `/problems/new`, `/my-problems`, `/my-problems/:id/edit`; author guards, draft recovery, validation, unsaved-change confirmation |
| SubmissionsPage, SubmissionPage | `/submissions`, `/submissions/:id`; authenticated history/detail, load errors, verdicts and diagnostics |
| ProfilePage, UserPage, RankingsPage | `/profile`, `/users/:username`, `/rankings`; private/public separation, skeleton/error/empty states |
| LearningPage, MissionsPage | `/learning`, `/missions`; private learning scope, loading/error/empty or progress states; MissionsPage delegates to `missions/ServerMissions.tsx` |
| CommunityPage, CommunityPostPage, CommunityWritePage | list/detail/new/edit routes; loading/errors, account-owned requests/drafts, native report/confirmation dialogs |
| AnalysisPage, AnalysisQuestionPage | `/analysis`, `/analysis/:id`; guest/member progress, filters, answer/result/error states |
| VibePage, VibeWorkspacePage | `/vibe`, `/vibe/attempts/:id`; catalog/attempt/workspace, pending runs and feedback, authentication |
| EnterprisePage, EnterpriseDetailPage, EnterpriseFormPage | list/detail/new/edit; account/navigation-owned state, bounded results, versioned forms and validation |
| EnterpriseJoinPage, EnterpriseAttemptPage, EnterpriseVibeReviewPage | join/attempt/review; invitation/eligibility/version/error/pending states, review authorization |
| AuthPage, SettingsPage, EmailActionPage, WithdrawalCompletePage | `/auth`, `/settings`, email and withdrawal actions; field errors, pending actions, forced-password flow, protected settings |
| AdminPage | `/admin/*`; role guard, users/reports/audit/operations, loading/error states |

Shared components already provide design tokens, `PageHeader`, `SkeletonRegion`,
native `ConfirmDialog`, error recovery and a skip link. Page titles already use
`useDocumentTitle`, including delegated Missions content; those titles remain
owned by the pages. Existing implementations are reused.

## Findings and implemented acceptance criteria

1. **Route focus:** the shell scrolled on pathname changes but did not transfer
   focus from the previous navigation link or removed route. `RouteFocus` now
   focuses the main landmark after the destination's lazy content commits. The
   last committed pathname lives outside Suspense, so the initial document load
   is left alone. Query-only updates, hash navigation and access-token refresh
   preserve current control focus. `preventScroll` preserves the shell's
   existing push/POP scroll policy.
2. **Loading announcement:** the plain shell lazy-loading text now exposes a
   `status` region. Page-specific data-loading components remain unchanged.
3. **Collapsed menu:** its links precede the toggle in DOM order, so keeping
   focus on the opening toggle skipped the disclosed links. Opening now focuses
   the first link. The panel remains a disclosure, not a focus-trapping modal.
   Escape returns to the toggle; leaving the panel closes it. Current-route
   activation closes it without relying on a pathname change. Destination
   activation hands focus to the new main content.
4. **Account/responsive transitions:** account/role changes close the panel and
   restore toggle focus when a private link is removed. Token rotation within
   the same login identity does not close it. Crossing the mobile breakpoint
   clears stale expanded state and moves focus away from a hidden panel/toggle.

These are shared-shell changes across all routes. Per-page visual redesign,
complete screen-reader evaluation and editor heap profiling are outside this
bounded change. Learning and enterprise results have separate owners.

## Verification

Executed locally on 2026-11-16:

- Baseline `npm run build --prefix Front`: passed.
- Changed `npm run check --prefix Front`: passed (TypeScript/Vite build,
  bundled-answer leakage check, seven telemetry-privacy tests, E2E TypeScript).
- `git diff --check`: passed.
- Added `tests/navigation-accessibility.spec.ts`: seven browser cases covering
  pathname/query/back navigation; initial form focus; delayed route loading;
  390px/900px keyboard menus; responsive focus; and same-route account change.
  Chromium/Firefox defaults select it; it is added to the WebKit selection.
  The coordinator owns the explicit CI Firefox file list.

**Local browser execution is blocked**, not passed: three baseline cases were
attempted, but Chromium failed before any page/test assertion with `socket()
failed: Operation not permitted` in `process_singleton_posix`. No sandbox policy
was changed. Actual browser assertions, existing layout/auth/editor regressions
and exact-head CI require the authorized GitHub Actions environment. The later
PR/CI receipt records those results; this checkpoint does not anticipate them.

## Build-size observation and limits

Same local dependency installation, Vite production build, default monitoring
configuration, using Vite's rounded decimal kB output:

| Initial index JavaScript | Baseline | Changed | Delta |
|---|---:|---:|---:|
| Emitted size | 381.92 kB | 383.16 kB | +1.24 kB |
| gzip | 122.98 kB | 123.34 kB | +0.36 kB |

The accessibility behavior adds a small payload cost. No browser speedup, LCP,
INP, CLS, retained heap reduction or sustained editor-memory claim is made.
No additional runtime dependency or whole-site rewrite is introduced.

## Responsive focus follow-up

PR80 run `43845660754`, job `133225404266` exposed a real Chromium focus
failure: after the first mobile-to-desktop resize, the active route link remained
unfocused. This is consistent with CSS hiding/blurring the toggle before the
media-query callback reads `document.activeElement`; the log itself does not
trace the browser event order. The source fix records navigation focus
ownership before the CSS transition and retains it only when the previous
element became hidden. An actual focus move or outside pointer action clears
that ownership; an unrelated focused control is never replaced by the fallback.
Listeners now register in a layout effect before the first painted interaction.
The original resize assertions remain, with one extra search-input preservation
case. Fresh exact-head browser CI is required for this correction; the earlier
build-size numbers describe the initial implementation only.
The independent source reviewer found no blocking issue in this correction.
Local full-check and bounded-heap TypeScript attempts exited 137 before
diagnostics under workspace memory pressure; they are not passing validation.
