# Phase II independent baseline

Observed 2026-11-16. Source of truth: GitHub refs, PR metadata and source; prior prose is an assertion to verify.

| Item | Direct observation |
|---|---|
| main | `6176015b63a1615cc2269172f246725ef08abab3` |
| integration | `c8ba9712d1a29ac633519511e50428ef647edf66` |
| final PR | [#63](https://github.com/yakisoba0728/UnsolvableOJ/pull/63), open/unmerged, integration → main |
| historical work | #54–#62 all have non-null merged_at and integration base |
| historical CI | [43786206115](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43786206115): 12 jobs success at c8ba971, confirmed from jobs API |
| protection | Branch list reports protected:false; repository rulesets list empty. No settings changed. |
| outside work | Dependabot #51–#53 open against main; preserved, not merged or rewritten |

The historical run is historical evidence, not a Phase II rerun. Local checkout HEAD matched the integration SHA and was clean before work. Isolated worktrees separate implementation. Three specialists plus coordinator are the actual concurrent limit.

## Re-audit coverage and findings

Read the required handoff set (FINAL-REPORT, AUDIT, ARCHITECTURE, API, DATA-MODEL, BACKLOG, VALIDATION-COVERAGE, PERFORMANCE, TESTING, SECURITY, REVIEW, RECOVERY, DEPENDENCIES, DECISIONS, PROGRESS), then checked implementation and executable suites.

- Security review found verified-email invitation checks, forced-password optional-auth restrictions, immutable-version diagnostic filtering and anonymous sandbox rejection in source. Fresh baseline Back lint/types/build and 296 unit tests passed in the independent security worktree. HTTP/native evidence must be tracked separately.
- Enterprise submission/finish serializes on attempt locks and evaluates `clock_timestamp()` after waiting; the Phase I lock-order improvement is retained. However the enterprise statement still reads mutable `problems`/`test_cases`, while each submission independently selects current_version. Different candidates can therefore receive different assessment versions. New Phase II regressions address that inconsistency.
- Enterprise start reads invitation policy before its insert and uses transaction-start `now()`. Unlike the corrected submission/workspace paths, it needs an independent start/update/deadline concurrency check.
- Judge AC coverage names all eight languages. Most negative native cases are representative rather than a full language/verdict cross product. Prior recovery intentionally advances the lease expiration. These limits agree with the candid parts of Phase I documentation.
- Baseline production npm audit reproduces three moderate dependency nodes from two advisories in TypeORM/glob/minimatch. A clean high/critical gate is not a zero-vulnerability result.
- Problem bookmarks are absent; existing community saves and editor drafts solve different user needs. This is a substantive new full-stack feature rather than renamed existing functionality.

The 25-item Phase I register includes process, performance and tooling defects. It is not 25 exploitable vulnerabilities. Presence of tests and a historical green CI does not establish exhaustive state-space coverage. Every new claim is linked to fresh evidence in PHASE2-VALIDATION/REVIEW.

## Environment limits

Node24.22.1/npm11.9.0. Docker absent locally; native execution remains in disposable Actions. User-local PostgreSQL17.11 and Redis8.10.3 core are used only with newly created data directories and loopback random ports. Unix sockets are unavailable, so PostgreSQL uses supported TCP-only configuration. No operating-system or permission control is modified. No production databases, Redis, volumes, paid providers, or live user credentials are used.

## Priority and unverified scope

The bounded roadmap is PHASE2-ROADMAP.md. Prior valid fixes are preserved. Dedicated-host deployment, dangerous sandbox escape research, external providers, real-user field metrics and production capacity remain outside executable evidence. They will not be marked complete through documentation alone.
