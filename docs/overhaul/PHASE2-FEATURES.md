# Phase II product: private problem bookmarks

## Scope and user problem

Baseline: `c8ba9712d1a29ac633519511e50428ef647edf66` (`overhaul/integration`).
Implementation branch: `overhaul2/product-features`.

Learners could resume recent submissions and recover local editor drafts, but could not keep a server-backed list of problems to study later. Community article saves already existed; this feature addresses a different resource and does not duplicate that collection.

The bounded change provides:

- A save/remove control on the public problem solving page, with a sign-in return path, keyboard operation, truthful loading/error states, and recovery after a lost mutation response.
- A private **저장한 문제** filter in the existing problem list. Search, difficulty, tags, solve-state filters, sorting, page navigation, and keyset continuation remain server-side.
- Saved indicators returned in the paginated list response. No per-row bookmark request is added. Returning from a problem tab refreshes the list.
- Persistent storage across reloads/devices, and removal of private study bookmarks during account withdrawal.

No named collections, automatic spaced-repetition planner, or full learning dashboard is claimed. Those remain outside this bounded feature.

## API and database contract

| Contract | Behavior |
| --- | --- |
| `GET /api/v1/problems/:id/bookmark` | Authenticated user's boolean save state. Nonpublic/private/nonexistent problems return the same 404. |
| `PUT /api/v1/problems/:id/bookmark` | Idempotently saves a currently published, nonprivate problem. Returns `{ bookmarked: true }`. |
| `DELETE /api/v1/problems/:id/bookmark` | Idempotently removes only the caller's row. Returns `{ bookmarked: false }`, including when the problem became unavailable. |
| `GET /api/v1/problems?bookmarked=true` | Requires authentication. Applies all existing filters and facets inside the caller's saved set. |
| List item `bookmarked` | Current caller's state; false for anonymous lists. Public profiles do not expose bookmark collections. |
| Migration `1795900000000` | Adds `problem_bookmarks(user_id, problem_id, created_at)`, user-first composite primary key and problem-first cleanup index. Both foreign keys cascade on parent deletion. Down migration removes only this new table. |

The migration is additive and requires no backfill. Deploying an old server after using the feature would leave unused bookmark rows until its schema is reverted; down migration intentionally loses bookmark data. No production database was changed.

## Security, concurrency, and account ownership

Save transactions acquire a SHARE lock on the public problem, then a SHARE lock on the active user. The latter rechecks deletion, suspension, forced password change, and token version after waiting. This matches problem-management's problem-before-author locking; submission foreign-key KEY SHARE checks are compatible with the problem SHARE lock.

The initial implementation was caught during source review using the opposite user-before-problem order. That could conflict with an author moving their own published problem back to draft. The order was corrected before commit and a real PostgreSQL blocking regression was added. Withdrawal holds the user lock, clears bookmarks in the same transaction, and a previously authenticated save cannot recreate them after deletion commits.

List queries always enforce published/nonprivate visibility. Hiding a saved problem removes it from the list, totals, and facets; ownership of a bookmark never grants problem access. Mutation IDs pass the existing UUID validation. All SQL values are parameters. Concurrent saves use the composite unique key and `ON CONFLICT DO NOTHING`.

The bookmark control is owned by account/token/problem and aborts requests on ownership changes. Synchronous request ownership prevents double-click duplication. A failed mutation leaves state unknown and requires an authoritative status read before another toggle. The problem list remounts on account changes so `keepPrevious` remains useful for same-account filtering without retaining the previous account's saved data.

## Independent frontend re-audit

The route declarations and page modules in `Front/src/App.tsx` and `Front/src/pages` were enumerated. This is structural inventory, not a claim of every visual state being exercised.

| Area | Direct source inspection and resulting action |
| --- | --- |
| Authentication, settings, sessions, withdrawal | Read session ownership and withdrawal paths; new bookmark cleanup and deletion race regression added. |
| Problem catalog, authoring, solving, submissions | Read server filtering, existing continuation/draft features, solver ownership and error states. Added bookmarks without replacing valid existing features. |
| Home, profile, rankings, analysis and missions | Routes and existing coverage indexed. Whole submission-history consumers remain a scaling follow-up; no new measurement or full UX review claimed. |
| Community and notifications | Read `SiteHeader`, `NotificationBell`, request-owner helper, request client, and regression tests. Phase I identity key, cancellation, query epoch invalidation, mutation reconciliation, and deduplication are present in actual source. Browser rerun remains the CI gate. |
| Enterprise list/detail/join/attempt | Found unkeyed account/route ownership and unguarded async mutation/navigation. A separately reviewed follow-up is recorded in [PHASE2-FRONTEND-OWNERSHIP.md](PHASE2-FRONTEND-OWNERSHIP.md); bookmark feature evidence and measurements remain scoped to `35d9d77`. |
| Vibe workspace/catalog and administration | Routes, ownership pattern and coverage indexed; no paid AI calls, native Vibe parity, complete visual audit or operational claim. |
| Shared shell/error boundary | Existing skip link, lazy route fallback, error recovery and focus behavior read. New controls use native buttons, pressed states, live feedback and viewport tests. |

The React quality checklist was applied to the modified TSX: hooks remain unconditional, effects clean up owned requests/listeners, no module-level per-user mutable state is introduced, derived filters remain URL state, and no heavy dependency is added.

## Actual local verification

Environment: Node `24.22.1`, npm `11.9.0`, Linux x86-64. Isolated local tests used owned temporary PostgreSQL `17.11` and Redis `8.10.3`, random loopback ports and the repository's randomly named disposable database runner.

| Check | Result at implementation handoff |
| --- | --- |
| Back lint, TypeScript, build, unit | Passed; 299 unit cases in 23 files. |
| New real API/DB tests | 8/8 passed, including duplicate save, privacy/visibility, facets/filter/paging, author draft-transition locking, and withdrawal overlap. |
| Combined bookmark/search/withdrawal API run | 29/29 passed in 3 files; 8.59 s total suite time. |
| Migration checker | Passed legacy upgrade, refusal cases, partial rollback, fresh install/full rollback/reapply through 27 migrations. Expected case-colliding legacy username refusal remained asserted. |
| Front build, answer privacy guard, telemetry, E2E typecheck | Passed; 7 telemetry cases. |
| Existing browser-free unit project | 85/85 passed. |
| New browser regression discovery | Original bookmark commit: 13 scenarios / 39 instances across Chromium, Firefox, WebKit. Follow-up adds 2 defensive nonpublic-status cases (15 / 45). Discovered/typechecked, **not locally executed**. |
| Real-service browser flow | Existing disposable Compose signup/publication/Judge flow extended with save/reload/list/remove assertions. Execution pending Actions. |
| Independent review and exact-commit CI | Coordinator gate, pending at this document's commit. |

The first Back unit run found that an isolated existing HTTP-controller test needed the newly injected bookmark provider registered; the fixture was corrected without removing assertions. A new withdrawal overlap test initially timed out because it paused AdminModule's separate password hasher rather than AuthModule's actual dependency. The fixture now explicitly selects AuthModule; the original five-second timeout and all assertions were retained and the rerun passed.

System Chromium startup was attempted with the project Playwright client. It failed before application execution with `socket() failed: Operation not permitted` in `process_singleton_posix`. No security control was bypassed. Actual browser/layout/keyboard tests and the live-service flow require authorized Actions execution; discovery is not counted as a browser pass.

## Measured delivery cost

Both source versions used independent `npm ci --no-fund --no-audit` installs from the identical Front lockfile, Node/npm versions above, and clean `npm run build` with `VITE_SENTRY_DSN` and `VITE_API_BASE_URL` unset. Baseline is the immutable integration commit above. Feature source is `35d9d77daabc4b80246d63bc4399fa1b23f1b983`; later enterprise ownership changes are not included in this size snapshot. Measurements are artifact sizes, not LCP/INP/CLS, CPU, or network timings.

| Bytes | Before | After | Difference |
| --- | ---: | ---: | ---: |
| Initial HTML module entry | 381,317 | 381,356 | +39 |
| Initial entry gzip (level 9) | 122,616 | 122,638 | +22 |
| Initial entry Brotli (quality 11) | 105,818 | 105,931 | +113 |
| Total emitted JavaScript | 1,462,761 | 1,466,031 | +3,270 |
| Total JavaScript gzip | 482,612 | 483,739 | +1,127 |
| Total JavaScript Brotli | 410,297 | 411,275 | +978 |

Total sums per-file compressed sizes and includes lazy/optional chunks and `theme-init.js`; the initial entry is only the module referenced by HTML. This feature adds capability with a modest bundle increase; no frontend performance improvement is claimed. Static query structure adds one indexed join to authenticated page selection and uses that join for saved-only facets. Actual production DB latency/lock load remains unmeasured.

Raw per-file lengths, compression results and SHA-256 values: [measurements/phase2-product-bundles.json](measurements/phase2-product-bundles.json). Reproduce after separately building baseline and candidate:

```sh
node Front/scripts/measure-bundles.mjs BEFORE_DIST AFTER_DIST
```

All remaining browser/CI/integration status must be read from the actual branch HEAD and coordinator records; an earlier build or baseline CI is not the final gate.
