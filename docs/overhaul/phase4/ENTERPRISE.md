# Phase IV — enterprise result analysis and complete CSV export

## Scope and acceptance

This adds two connected owner workflows to the existing assessment detail page:
an overview of attempt completion and score distribution, and a downloadable
whole-assessment result file. Existing result pagination, rounded score semantics,
Vibe pending-score behavior and immutable assessment versions are reused.

Acceptance criteria:

- The existing owner/admin policy applies to export. Being invited or participating
  does not grant access to other candidates. Anonymous requests receive 401 and
  non-owner requests receive the same 404 as a missing assessment.
- `GET /enterprise/tests/:id/results/export` returns a UTF-8 CSV attachment with
  `Cache-Control: private, no-store`. A fixed filename avoids user-controlled
  response headers. Success is CSV; errors retain the ordinary JSON contract.
- Export covers the whole assessment, independent of the page currently shown.
  **5,000 candidates are allowed; 5,001 are rejected with 409 before score
  aggregation.** The server never silently truncates a report. An empty assessment
  produces the column header alone. The endpoint admits five requests per minute
  under the existing per-client throttle mechanism.
- Authorization, candidate count and scalar score projection run in one
  `REPEATABLE READ` transaction. A concurrent candidate join is included in the
  next export, preserving the current report's consistent snapshot and cap.
- Only username, UTC start/deadline/finish timestamps, attempt status, solved and
  total algorithm-task counts, total score and evaluation status are exported.
  Source code, test cases, workspace state/history, email, invitations and tokens
  are absent. All cells are quoted and embedded quotes doubled. Dangerous formula
  prefixes (including leading whitespace/control/format characters) are prefixed
  with an apostrophe; raw scanners and security policy are unaffected.
- Existing `summary` fields stay unchanged. The additive `analytics` object has
  finished/active/expired counts and five score bands (0–19, 20–39, 40–59, 60–79,
  80–100). Pending evaluations are excluded from the score bands and average and
  remain visible separately. Counts cover the whole assessment, not the page.
- The UI supports keyboard download, responsive actions, busy/error/retry/cap/empty
  feedback and an accessible text equivalent of every score band. Downloads use
  the existing API base URL, bearer authentication and token-refresh logic.
  Route or account changes cancel the request and suppress a stale download.

## Boundaries

The aggregate query returns a fixed-size object and the export reads at most the
allowed number of scalar rows. It never fetches per-candidate submission bodies
or Vibe workspace documents into the API process. No migration, new infrastructure,
paid provider call or operational data change is needed.

CSV is a snapshot, not a hiring recommendation. Scores for active attempts can
change; pending evaluations have an empty score and explicit `PENDING` status,
distinct from a scored zero. Attempt status is independently `ACTIVE`, `FINISHED`
or `EXPIRED`. Dates are UTC. Formula-prefix apostrophes intentionally make those
usernames literal text in spreadsheet consumers; machine parsers should treat
the file as CSV text and preserve the quoted values.

No before/after latency, capacity or memory improvement is claimed. Added global
aggregates incur SQL work; the export deliberately trades a finite 5,000-row
allocation for a useful complete download. Very large assessments remain readable
through the existing bounded pages but cannot use this complete export.

## Verification

- Backend CSV units exercise formula prefixes, Unicode, quotes/commas/newlines,
  zero-versus-pending scores and empty CSVs.
- PostgreSQL/API coverage in `enterprise-export.e2e-spec.ts` checks actual
  authorization, all 123 candidates across pages, attachment/cache headers,
  omitted sensitive fields, global analytics, empty/missing assessments, exact
  5,000/5,001 limits and the concurrent-join snapshot boundary.
- Existing mixed algorithm/Vibe result fixtures also check score-band and pending
  parity while retaining all original page/score assertions.
- `enterprise-results.spec.ts` covers keyboard download, mobile errors/retry,
  cap/empty behavior, HTML fallback rejection, token refresh and late responses
  after account/navigation changes. This existing suite runs in the configured
  Chromium, Firefox and WebKit projects without changing CI selection.
- The existing Compose `enterprise-flow.spec.ts` reuses its owner and candidate
  accounts for a real browser → API → PostgreSQL → CSV download, unauthorized
  candidate rejection, header/score/privacy checks and global completion counts.
  Registration counts, admission limits and production guards are unchanged.

Local execution and exact-commit CI receipts are recorded by the coordinator;
test definitions alone do not establish that PostgreSQL, browsers or Compose ran.
