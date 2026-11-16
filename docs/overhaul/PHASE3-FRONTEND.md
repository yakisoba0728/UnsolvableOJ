# Phase III frontend: bounded personal learning dashboard

Baseline: `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`. This document records the implementation handoff, before the coordinator's independent review, combined full-stack CI and integration. Later exact-HEAD receipts take precedence over the pending statements here.

## Recovered frontend and audit scope

All 29 pre-existing page modules and the route declarations were inventoried. Phase I/II notification, bookmark and enterprise ownership/version corrections remain present. The following findings are source-inspection results, not a claim of full visual or accessibility coverage across every route/state.

| Area | Existing behavior and Phase III disposition |
| --- | --- |
| Home, profile, submissions, problem catalog | `useSubmissionHistory` fetches the complete personal submission history. Existing client filters and statistics retain their behavior; replacing all consumers needs a separate compatibility change. A new bounded dashboard does not use this hook. |
| Authentication, settings, notifications | Shared login identity, token refresh and cancellation primitives are reused. The new dashboard is keyed by account and login identity; it does not extend any user's access. |
| Learning, rankings, analysis, missions | Existing profile/ranking/reward views remain. New windowed type/difficulty breakdown and actionable unsolved-review queue fill a different product need. |
| Problem detail/editor, authoring, result detail | Existing saved drafts, editor controls and native Judge flows remain. Dashboard continuation links use the existing encoded problem route. |
| Community, administration, Vibe workspace | Routes and coverage families indexed. No whole-area redesign or newly completed visual audit is claimed. |
| Enterprise | Existing immutable algorithm summaries and request/draft ownership retained. Vibe version UI is a separate implementation commit and contract. |

The bounded feature is prioritized over an unmeasured replacement of every existing page. Large-history consumers, whole-site visual/a11y review and long editor profiling remain explicit follow-up work.

## User problem and delivered feature

Learners had lifetime profile statistics and saved problems, but no bounded, period-based view connecting topic practice, difficulty progress, recent activity and unfinished work. `/learning` supplies:

- 7, 30 or 90 days, including today in `Asia/Seoul`, retained in the URL.
- Submission count, distinct solved/attempted problems, active days and an explicitly labelled successful-submission ratio.
- Daily activity with an exact accessible table. The 90-day visual groups three days per bar; daily rows remain unchanged.
- Difficulty and tag breakdowns linking to existing server-filtered catalogs. Tags are overlapping categories; a server top-20 truncation flag produces visible disclosure.
- At most ten visible unsolved problems from the selected window, most recently submitted first, with latest verdict and private bookmark indicator. Previously solved problems are excluded by the backend even if the newest attempt is wrong.
- Links from home/profile and to saved problems. No new frontend library or paid service is added.

## API, privacy and state contract

`GET /api/v1/users/me/learning?days=30` is authenticated. Accepted windows are 7/30/90. Summary, activity, difficulty and tag counts use the selected KST window, only current published nonprivate ordinary-problem submissions; sample runs and enterprise attempts are excluded. Activity is zero-filled. `tagsTruncated` describes the top-20 tag cap. `review.id` is the string UUID of a problem. All values and numeric counting policy are implemented by the coordinated backend change, with real PostgreSQL/API tests recorded separately.

The dashboard makes one bounded data request rather than paging through `/submissions`. It uses lazy code/CSS loading. New account or login identity destroys the previous screen; a different time window owns a separate request component, aborting and rejecting late responses from the previous window. Normal token refresh preserves the selected URL window and requests with the refreshed token. Failed/loading requests never substitute zero statistics or retain old-account rows.

Native buttons expose pressed state, loading/completion feedback has status semantics, errors have an explicit retry, table headings/caption describe exact activity, and meters expose textual solved/attempted values. Links and controls have visible keyboard focus, long titles/tags wrap, and the layout has 320/375/1440-pixel regression cases. These are implementation and test contracts; actual browser outcomes remain the CI gate below.

## Acceptance and verification at handoff

| Check | Observed result |
| --- | --- |
| Front `npm run check` | Pass: production build, answer-bundle privacy check, 7 telemetry tests, browser-spec TypeScript. |
| Existing browser-free unit project | 85 passed. |
| Actual React/AuthProvider/Router/App DOM probe | 5 passed: bounded request and rendered contract, older-period completion, immediate account clearing, late old-account completion, failure/retry. Uses JSDOM 31.0.1; not browser/layout evidence. |
| New `learning-dashboard.spec.ts` | 14 behavioral cases / 42 discovered Chromium/Firefox/WebKit instances. Covers scope/counts/exact table, guest gate, loading/error/retry/empty, period keyboard/URL/late response, identity/token ownership, encoded links/truncation and 3 viewport widths. |
| Local system Chromium attempt | Failed before application launch: `process_singleton_posix` `socket() failed: Operation not permitted`. Two starts failed and the run stopped; twelve cases did not run. No sandbox control was changed. |
| Real Compose browser flow | Existing signup/publication/Judge/XP flow extended with actual dashboard HTTP200, accepted and wrong-submission aggregation, 100%→50% successful ratio, and lifetime-solved review exclusion. No API mocking. Pending full-stack Actions execution. |
| Independent review / exact-HEAD full CI / integration | Coordinator gate, pending at this handoff. |

Manual DOM reproduction (temporary dependency outside the repository):

```sh
npm install --prefix /tmp/oj-learning-probe --no-save --no-audit --no-fund jsdom@31.0.1
node Front/scripts/learning-dom-probe.mjs "$PWD" /tmp/oj-learning-probe
```

The probe writes its JSON result and bundled actual app to the supplied temporary directory, stubs network calls with synthetic data, and does not change the production lockfile. It does not measure keyboard layout, browser compatibility, CSS or real-service authorization; Playwright and the real Compose flow supply those distinct gates.

## Performance and limits

The frontend request/DOM work is bounded by 90 activity rows, five difficulty entries, twenty tags and ten review rows. This is a structural bound, not a measured speedup over the old profile's different workload. The lazy route and its stylesheet add bytes; no LCP/INP/CLS, CPU, memory or real-device performance improvement is claimed. The React quality checklist was applied: unconditional hooks, primitive request dependencies, effect cancellation, no shared per-user mutable state, URL-derived period state, lazy route assets and no unnecessary memoization or added dependency.

The backend still needs its exact SQL, index and measured-data review; new API existence is not a whole-platform scaling claim. Follow-ups include migrating other whole-history consumers, sustained concurrency, field Web Vitals, full-site accessibility and visual comparison, and long editor sessions.
