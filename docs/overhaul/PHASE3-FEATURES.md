# Phase III delivered product contracts

The recovery baseline is `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4`.
Phase II bookmarks, algorithm-version pinning and enterprise result pagination
remain existing features. The following work is additive to that baseline.
Implementation, test, review, CI and integration receipts are separate; see
[PHASE3-VALIDATION.md](PHASE3-VALIDATION.md) and each linked PR for actual status.

## Personal learning dashboard — PR #73

**User problem.** Learners could inspect submissions and lifetime statistics but
had no bounded period view connecting recent activity, topics, difficulty and
unfinished problems. Existing full-history consumers also download more history
than this task needs.

**Result.** The new `/learning` route offers 7/30/90-day windows, submission and
distinct-problem counts, active days, a successful-submission ratio, daily activity,
difficulty/tag breakdowns, and up to ten unfinished problems with bookmark state.
The selected period remains in the URL. Home/profile links make the view reachable;
continuation and filtered-catalog links reuse the existing problem routes.

**Data/API.** `GET /api/v1/users/me/learning?days=30` uses the authenticated caller,
one PostgreSQL statement and the existing user/time index. Output is limited to
90 calendar days, five difficulties, twenty tags and ten review items. No new
table, cache or dependency is added. The KST window and current-verdict meanings
are explicit; review suggestions additionally exclude lifetime credited solves.

**Privacy and UI behavior.** Private/unpublished problems, enterprise attempts,
test runs, future timestamps and other accounts are excluded. Account/login and
period identity own requests, so obsolete completions cannot populate a new
screen. Loading, empty, retry and truncation states are explicit. The exact daily
table complements the grouped chart; native controls, keyboard focus and wrapping
layouts cover the implemented route. Development StrictMode cancellation was
reproduced and corrected before the accepted browser run.

**Acceptance.** Actual PostgreSQL/API checks cover identity, window boundaries,
counts, ties, limits, bookmarks and visibility changes. Fourteen browser cases run
on Chromium/Firefox/WebKit, including 320/375/1440-pixel layouts and delayed old
requests. The production Compose flow uses real signup, problem publication,
accepted and wrong submissions, API data and the UI; it does not mock learning
responses. The SQL still scans matching window history, so bounded JSON does not
prove constant CPU or unlimited capacity. Existing full-history consumers remain.

[PR #73](https://github.com/yakisoba0728/UnsolvableOJ/pull/73) ·
[API contract](PHASE3-LEARNING.md) · [frontend implementation](PHASE3-FRONTEND.md)

## Immutable enterprise Vibe assessment versions — PR #75

**User problem.** Algorithm questions were frozen in Phase II, but a Vibe task ID
still resolved mutable catalog content. Candidates starting at different times or
reviewing saved code after a deployment could receive a different task, fixtures,
template or evaluator inputs.

**Result.** Selection now binds a canonical content digest and the selected model
identifier. Ordinary metadata edits preserve them. An explicit pre-start refresh
updates Vibe content/model independently of algorithm refresh. Archived selections
retain their labels and remain usable when removed from the live catalog; an
unsupported refresh fails clearly. The owner interface exposes the version and
intentional refresh control, with no private test content.

**Data/API.** Migration `1796000000000` adds immutable content archives,
assessment-version bindings and required attempt provenance. Views, saves, AI
context, executions, final evaluations, revisions and staff review resolve the
same archive. Readonly archived source files reach compilation. Result scoring
uses the selected case count instead of a hardcoded eleven. Metadata responses
gain version summaries and authorized selected labels; the update DTO adds
`refreshVibeVersions`. No existing public endpoint is removed.

**Security and migration.** Fixtures, harnesses, prompts and model configuration
stay server-side. Hidden diagnostic suppression follows the server cohort rather
than a name prefix. Missing/inconsistent/unsupported snapshots fail closed.
Historical backfill uses a frozen migration document, refuses unknown or mixed
provenance, and cannot reconstruct unstored history. New writes require explicit
versions. Production cutover must stop old writers; rollback refuses unsafe loss
of content/model provenance. No production schema was changed.

**Acceptance.** Real PostgreSQL tests cover selection retention/refresh, removed
catalog entries, privacy, shared attempt provenance, historical migration and
rollback guards. Five UI cases cover version labels, refresh and removal across
the three browser engines. Five native pipeline cases include real compiled
execution, errors and renamed hidden-case privacy. One connects actual HTTP,
PostgreSQL, runner, sandbox and saved results; only paid AI evaluation is replaced.
This is not a full browser-native Vibe journey. Model names do not pin provider
weights, and no paid provider call or AI-quality claim is made.

[PR #75](https://github.com/yakisoba0728/UnsolvableOJ/pull/75) ·
[complete Vibe contract](PHASE3-VIBE.md)

## Engineering capabilities supporting these features

| Change | User/maintainer effect | Acceptance and cost |
| --- | --- | --- |
| Verified dedicated-worker Redis TLS/mTLS and HTTPS configuration | Makes encrypted, authenticated transport enforceable in the worker rather than an external setup assumption | Real Redis/BullMQ positive and negative cases, rendered topology checks, readonly UID1000 worker; actual dedicated host/kernel/ACL provisioning remains unverified |
| Incremental current-verdict problem statistics | Removes full-history recount from each terminal write on a popular problem while preserving API counts | Statement-level count oracle, actual lock/rollback races, reversible transactional migration and fixed-work measurements; adds counters and heartbeat overhead |
| Bounded browser measurement in existing Compose flow | Produces reproducible raw observations tied to a real authorized dashboard | Three warm visits and fifteen period switches; optional metrics have explicit missing reasons, functional assertions remain mandatory; not field INP or a performance improvement claim |

[Security](PHASE3-SECURITY.md) · [database contract and measurements](PHASE3-DATABASE.md) ·
[browser protocol](PHASE3-BROWSER-PERFORMANCE.md)

This iteration does not claim a whole-site redesign, complete accessibility audit,
long editor profiling, sustained Judge capacity, a new admin console or enterprise
export. Those are explicitly scoped follow-ups in [PHASE3-ROADMAP.md](PHASE3-ROADMAP.md).
