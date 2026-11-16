# Phase II — selected assessment problem summaries

## Finding and bounded correction

At baseline `3957fb1746e1436da26dd9300bf87855c2000986`, assessment attempts and
Judge jobs used the selected `problem_versions` revision, but the owner's detail
page resolved question titles, difficulty and limits from the **current** public
and owned problem catalog. Editing the source after selection could therefore
show a different title and resource limits from those used by candidates. A
source that later disappeared from that catalog also looked unavailable even
when its selected revision remained intact. This is a confirmed display and
assessment-management correctness issue; it is separate from the candidate
submission-detail title disclosure corrected in `b479145c2d717a90f80c8cf2030e0c5fc5b263ae`.

`GET /api/v1/enterprise/tests/:id` now authorizes the owner/admin first and adds
`selectedProblems`, ordered by the assessment's stored selection position. Each
item contains exactly `id`, `version`, `title`, `difficulty`, `timeLimitMs` and
`memoryLimitMb`, projected from `enterprise_problem_versions → problem_versions`.
It returns no statement, editorial, sample, hidden input or expected answer.
The test header/version bindings and this query share one `REPEATABLE READ`
transaction so a concurrent, explicitly requested pre-start version refresh
cannot combine old bindings with new summaries.

The existing `toTest`, `TEST_COLUMNS`, invitation/candidate projection, list,
results aggregation, version-selection policy and database schema are unchanged.
This adds one bounded read (at most the existing 20 selected ordinary problems)
and transaction setup to the authorized detail request; no endpoint throughput
improvement is claimed or measured for this patch.

## User-visible behavior

The owner's selected question list and result column headings use the selected
revision's metadata and display `고정 vN`. The current catalog is used only for
an authorized source-navigation link and a clearly labeled current-source
privacy badge. The link now says `현재 원본 보기`, making its destination explicit.
If the source is no longer visible in that catalog, its pinned summary remains
available and the source link is omitted. Missing pinned metadata is reported
as unavailable, without substituting the current source.

The editor's problem picker still shows current selection choices. Its existing
notice and explicit refresh checkbox continue to explain when versions are
fixed. Existing login-identity ownership and stale-response guards are preserved.

## Verification evidence

Executed in the isolated worktree with independent `npm ci` installs:

| Verification | Observed result |
| --- | --- |
| Backend `npm run check` | Lint/type check/build and **317 unit tests** passed |
| Frontend `npm run check` | Type check/build, bundle answer-privacy guard, **7 telemetry checks**, browser/live test TypeScript passed |
| Disposable PostgreSQL 17.11 / Redis 8.10.3 API run | **17/17** tests passed across `enterprise-detail`, `enterprise-versions`, `enterprise` |
| CI policy tests | **10/10** passed; Firefox and WebKit bounded-file selections match |
| New browser test discovery | **6** cases selected: two scenarios each on Chromium, Firefox, WebKit; discovery is not execution |

The new four real API tests cover:

1. Selected v2 metadata after a different v3 title, difficulty and limits exist;
   exact six-key whitelist for owner and admin; absence of private bodies and
   answers; no extension of generic list/results projections.
2. Unauthenticated access returns 401, other accounts return 404, and the
   pre-start candidate invitation retains its exact six public test fields.
3. An originally accessible source later becomes another author's private
   problem; the selected metadata survives without revealing the new title.
4. A deterministic overlap pauses the summary query after the header read,
   commits a real version refresh, and resumes the read: both parts remain v1;
   the next request observes v2. Only the pause is instrumented; both operations
   use the real PostgreSQL API and committed version rows.

Reproduction commands, from the repository root (the service wrapper is a local
owned-runtime helper; CI uses its existing disposable services):

```sh
npm run check --prefix Back
npm run check --prefix Front
node --test scripts/ci-policy.test.mjs
cd Back
python3 /workspace/scratch/231e81830e94/test-runtime/with-services.py \
  node scripts/run-integration.mjs e2e \
  test/enterprise-detail.e2e-spec.ts \
  test/enterprise-versions.e2e-spec.ts test/enterprise.e2e-spec.ts
```

`Front/tests/enterprise-pinned-summary.spec.ts` checks the pinned title, version,
difficulty, limits, result heading, current-source link and reload; its second
scenario removes the source from the authorized catalog. The existing enterprise
fixtures now model the detail response separately enough to preserve their
original source-navigation assertions. The standalone two-scenario file is added
to both bounded non-Chromium CI selections.

`Front/tests-live/enterprise-flow.spec.ts` additionally checks the real candidate
pre-start JSON and attempt JSON, verifies the selected v2 sample and limits after
a v3 source update, requires actual Judge `ACCEPTED` with **2/2** cases, and checks
the owner's pinned title/limits/result heading after reload. Its new submission
JSON title assertion depends on the separate `b479145` disclosure correction.
The entire live suite still registers five users, within the existing five per
minute budget; no response is mocked and no retry or admission limit is relaxed.

Actual browser and Compose/Judge execution remains **pending exact combined
GitHub Actions CI**. Local browser startup is unavailable in this environment;
type checks and discovery are not presented as browser evidence. No production
system, registry push or operating data was used.

## Integration / independent review handoff

Keep the separate results-pagination implementation when resolving shared files:
this patch changes `findOwned` only in the backend service; `useEnterpriseTest`
only in the frontend API module; adds the owner-detail model; and changes the
selected list/maps plus ordinary problem `<th>` contents in the detail page.
It does not own the results pagination state, empty-page recovery, request hook
or navigation. Preserve all new browser filenames in both CI selections.

Review authorization before snapshot access, exact whitelist, read consistency,
absence of any generic pre-start projection expansion, and the explicit
current-source link semantics. Only the combined candidate containing the
submission privacy correction can satisfy the enhanced real live test.
