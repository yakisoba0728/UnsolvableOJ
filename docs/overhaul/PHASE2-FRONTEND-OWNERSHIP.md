# Enterprise screen and request ownership

## Independent finding and bounded correction

Phase I baseline: `c8ba9712d1a29ac633519511e50428ef647edf66`. The new bookmark feature is separately committed as `35d9d77daabc4b80246d63bc4399fa1b23f1b983`.

The baseline routes reused enterprise list, detail, join, attempt, form and Vibe review components across account or parameter changes. `useRequest` already aborted superseded reads and cleared fetched data in an effect. It did **not** own the components' editor/index/mutation state or guard continuations of an already issued write. Join start, test deletion and workspace creation could navigate after the user had left the route or changed login identity. This is a client privacy/correctness issue; no server authorization bypass is asserted.

The source probe below independently reproduced two externally visible failures using actual `App`, `AuthProvider`, router, API client and page code:

| Scenario | Baseline actual result | Corrected actual result |
| --- | --- | --- |
| Deletion finishes after user navigates to `/problems` | Old callback navigates to `/enterprise` | Remains on `/problems` |
| Start finishes after switching login account on the invitation screen | Old callback opens `/enterprise/attempts/a1` | Remains on the invitation screen |

The correction keys enterprise screens by authenticated login identity, pathname and navigation entry. Changing login identity, including a fresh login for the same user, destroys the previous screen state. Ordinary access-token rotation retains the identity and therefore preserves in-progress code. Async mutation continuations capture identity and navigation versions, check ownership after confirmations and responses, and suppress stale state changes, retries and navigation. Synchronous in-flight refs also reject duplicate same-event activation. Existing community helper callers retain their original token-sensitive behavior.

The parent enterprise versioning work supplies the form's matching request guard. The final integration must preserve its `getNavigationVersion` props on both new/edit routes when combining `App.tsx` changes. Form ownership browser tests in this follow-up require that parent change; they are not a standalone claim that the original form implementation was repaired by this commit.

## Bookmark review follow-up

The problem screen now displays its bookmark control only for `PUBLISHED` details. The actual current `by-slug` API already rejects nonpublished problems, so this is defense in depth and a contract-expansion safeguard, not a reproduced backend visibility bypass or presently reachable author-draft bug. DRAFT and ARCHIVED response fixtures assert that no bookmark control or status request is produced. Bookmark API authorization/visibility policy remains unchanged.

## Verification evidence and limits

- Front `npm run check`: passed after the standalone App avoided redundant Form props already supplied by the parent enterprise change. Includes TypeScript, production build, hidden-answer bundle guard, 7 telemetry tests and browser-spec typecheck.
- React DOM source comparison: baseline failed both behavioral assertions; corrected source passed both. Node `24.22.1`, JSDOM `31.0.1`, actual installed React/router versions, synthetic account and API fixtures, no external request. This is **not a Chromium/Firefox/WebKit run**, and does not measure layout, focus, accessibility, real network or backend authorization.
- Added `enterprise-ownership.spec.ts`: 11 scenarios / 33 engine instances. Covers delayed deletion, delayed start across account/new-login identity, confirmation cancellation, private list/detail clearing, client-side attempt parameter changes, delayed workspace creation, normal token refresh during submission, and delayed form save across navigation/account switch.
- Added 2 defensive bookmark cases; combined new files discover 26 scenarios / 78 Chromium/Firefox/WebKit instances. Discovery and typecheck passed. Actual browser execution remains the exact combined CI gate.
- WebKit and Firefox core selections include both the new ownership and bookmark files. The 10 CI policy tests pass, including equality of bounded browser selections.
- No backend contract or dependency was changed by this ownership patch. No operational browser metrics or whole-site privacy audit are claimed.

System Chromium was previously blocked before application startup by the workspace's Unix-socket policy; no bypass was attempted. The browser checks must run in the authorized Actions environment. The source probe uses a DOM substitute explicitly to provide bounded executable evidence while that gate is pending.

## Reproduce the source probe

Both worktrees need their normal Front `npm ci` installed. The probe installs its DOM substitute outside the repository and neither changes the production lockfile nor sends real API requests. Use an owned temporary directory; baseline is expected to exit 1 with two failed assertions, and a corrected source tree should exit 0.

```sh
PROBE_DIR="$(mktemp -d)"
npm install --prefix "$PROBE_DIR" --no-save --no-audit --no-fund jsdom@31.0.1
node docs/overhaul/repro/enterprise-request-ownership.mjs BASELINE_WORKTREE "$PROBE_DIR" before
node docs/overhaul/repro/enterprise-request-ownership.mjs CORRECTED_WORKTREE "$PROBE_DIR" after
```

The script writes the exact outcome JSON and bundled source to the temporary directory. Raw observed results are in [measurements/phase2-enterprise-ownership.json](measurements/phase2-enterprise-ownership.json). Its tests stub browser-only primitives such as dialog layout; the three-engine regression file remains authoritative for actual browser behavior.

## Independent review and integration state

Implementation and local evidence are ready for independent review. Reviewer verdict, combined Form dependency, immutable PR head, CI runs and integration status must be recorded by the coordinator; this document does not substitute an earlier success for final-HEAD verification.
