# Private learning dashboard contract

## User problem and scope

Existing Home/Profile consumers download complete paginated submission history
to derive local statistics. There was no bounded period summary with a review
queue or distinct tag/difficulty progress. The new dashboard is a separate
authenticated route; existing profile/history APIs remain compatible.

`GET /api/v1/users/me/learning?days=30` accepts only7,30,90 (default30). It has no
user selector. All panels use one PostgreSQL statement/snapshot and the existing
`submissions(user_id,created_at)` index. A window starts at midnight Asia/Seoul
`days-1` days ago and ends at statement time. Activity contains exactly `days`
zero-filled calendar rows. Future fixture timestamps are excluded.

Only the current caller's ordinary, non-test, non-enterprise submissions to
currently PUBLISHED, nonprivate problems contribute. Hiding a problem removes
its metadata and counts from this view. No source, diagnostic output, private
test, exam content or other account data is projected.

| Field | Meaning / bound |
|---|---|
| `days`, `timeZone`, `generatedAt` | Requested window, Asia/Seoul, database snapshot time |
| `summary` | submissions, acceptedSubmissions, distinct solvedProblems/attemptedProblems, activeDays in window |
| `activity` | Ascending date, submissions, acceptedSubmissions; exactly7/30/90 rows |
| `difficulties` | Distinct attempted/accepted problems by current visible difficulty in window |
| `tags` | Distinct attempted/accepted problems per deduplicated current tag, top20 by attempted then binary tag order |
| `tagsTruncated` | Explicitly true when more than20 tags exist |
| `review` | Up to10 recent distinct problems without a window acceptance or lifetime credited solve; deterministic time/UUID ordering |
| Review item | UUID id, slug, title, difficulty, latest time/status, caller bookmark boolean |

The solve ledger's historical evidence excludes previously solved review
targets even after a later unsuccessful retry. Charts deliberately describe
acceptances in the selected window, not lifetime solves. Rejudging can change
window verdict counts; no immutable historical-performance claim is made.
Current tag/difficulty metadata is a learning navigation aid, not exam metadata.

## Architecture and resource cost

No new table, migration, cache or dependency is required. A scalar materialized
window is aggregated in SQL; bounded result JSON is returned. Complexity still
depends on the number of matching submissions, and repeated requests perform
fresh aggregation. Window/response bounds are not a constant-CPU or unlimited
capacity guarantee. Existing rate limits remain unchanged.

## Acceptance and observed checks

Seven real PostgreSQL/API regressions passed locally at implementation handoff:
authentication/DTO and foreign-selector rejection; empty zero-filled calendar;
distinct counts, duplicate tags and private/test/account isolation; exact KST
boundary and future exclusion; bounded review/lifetime solve/bookmarks; stable
latest-status ties and explicit tag truncation; visibility and withdrawal.
They insert actual submissions/solves and call the real Nest API.

Related frontend and final independent review/CI results are recorded in
PHASE3-PROGRESS and the feature PR; a local pass does not predeclare integration.
