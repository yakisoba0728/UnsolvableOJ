# Data model and migration changes

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`.
This document describes that schema and the reviewed database, backend and security changes. It does not assert that a feature branch has been merged or deployed; [PROGRESS.md](PROGRESS.md) and [TESTING.md](TESTING.md) record integration status.

The structural inventory is [INVENTORY.json](INVENTORY.json), the service map is [ARCHITECTURE.md](ARCHITECTURE.md), and measurements are in [DATABASE.md](DATABASE.md). Schema facts below were checked against the migration sources and the actual PostgreSQL constraint catalog in [community-indexes.json](https://github.com/yakisoba0728/UnsolvableOJ/blob/e1bbab81bcc4666e92ffaf47bc6408c2d373e6f5/Back/benchmarks/community-indexes.json).

## What changed

The baseline has **25 migrations and 30 application tables**. This work adds migration `1795700000000-community-profile-indexes`, bringing the chain to **26 migrations**, with the same 30 application tables. It adds two non-unique indexes; it does not rename or remove a table, column, foreign key, enum, or existing index. No destructive schema redesign or data backfill is included.

The migrated PostgreSQL catalog has 31 primary keys including TypeORM's `migrations` table, 48 foreign keys, 20 CHECK constraints and five SQL UNIQUE constraints. Unique indexes created separately, including case-insensitive usernames and conditional uniqueness, are additional to those five UNIQUE constraints. The new indexes do not alter those constraint counts.

Email verification, problem snapshots, enterprise attempts, Vibe revisions and submission diagnostics all existed at the baseline. The reviewed changes strengthen how services use that state; they do not introduce new tables for those features.

## Persistence contract

PostgreSQL is the durable owner of accounts, problem versions, submissions, assessment state, learning evidence, community content and email delivery records. TypeORM maps `users`, `problems`, `test_cases` and `submissions`; other modules also use parameterized SQL directly. Both paths use the explicit migration chain in [data-source.ts](../../Back/src/database/data-source.ts), with `synchronize: false`.

Redis/BullMQ holds dispatch and operational state, including generation-specific Judge jobs, worker heartbeats and shared rate limits. It is not the authoritative store of a submission's final verdict or assessment deadline. The API can reconstruct missing queued work from PostgreSQL. Browser state and cached notification counts are projections; the frontend now reconciles them with the existing notification API after mutations.

## Table and relationship inventory

The following covers all 30 application tables. `CASCADE`, `RESTRICT` and `SET NULL` describe the database foreign-key delete action, not authorization to delete production records. Normal account withdrawal anonymizes and marks the retained account; it is not an unrestricted physical deletion of all its relations.

### Identity and audit

| Table | Key and relationships | State and integrity rules |
|---|---|---|
| `users` | UUID primary key; unique email and username indexes, plus unique `lower(username)` | Credential hash, role, XP/level/rating, `token_version`, suspension, temporary-password requirement, `email_verified_at`, and `deleted_at`. The withdrawal trigger prevents restoration of protected identity fields after deletion is recorded. |
| `refresh_tokens` | UUID primary key; `user_id → users` CASCADE; unique `token_hash` | Hashed refresh tokens, login family ID and creation time, issued token version, expiry/revocation and remember flag. Family and user indexes support session/reuse handling. |
| `audit_events` | UUID primary key; nullable `actor_id → users` SET NULL | Action, target type/ID, JSON details and creation time. The target UUID is polymorphic application metadata, not a foreign key to every target table. |

Sources: initial schema, backend foundations/hardening, refresh-token, account-security, account-withdrawal and community-email migrations; auth and admin services.

### Problems, judging and learning evidence

| Table | Key and relationships | State and integrity rules |
|---|---|---|
| `problems` | UUID primary key; unique slug; `author_id → users` RESTRICT | Mutable statement, visibility/status, difficulty, limits, tags/editorial and `current_version`. Updates create a new version snapshot through the problem service. |
| `test_cases` | UUID primary key; `problem_id → problems` CASCADE; unique `(problem_id, order)` | Current problem's input, expected output, sample designation, order and score. These rows are separate from historical version snapshots. |
| `problem_versions` | Composite primary key `(problem_id, version)`; `problem_id → problems` CASCADE | JSONB snapshot used for historical judging. Its immutability is an application write contract; this schema does not install a general no-update trigger on snapshots. |
| `submissions` | UUID primary key; user CASCADE, problem RESTRICT, optional enterprise attempt SET NULL | Source/language, verdict and resource metrics, `problem_version`, generation/attempt/lease/recovery state, `is_test`, retained XP/learning evidence, JSONB debug output and per-case results. `(problem_id, problem_version)` is resolved by the application; there is no composite FK from submissions to `problem_versions`. |
| `user_problem_solves` | Composite primary key `(user_id, problem_id)`; user/problem CASCADE; `accepted_submission_id → submissions` CASCADE | One credited solve per user/problem, anchor submission and awarded XP. Judge result reconciliation updates this ledger and the user total transactionally. |
| `problem_stats` | `problem_id` is primary key and FK to problems, CASCADE | Derived solver/accepted/finished counts. The submission trigger refreshes the affected problem's counts for relevant status/test changes and deletions. Test-only submissions and queued/judging/system-error/cancelled states are excluded from the finished aggregate. |

Sources: initial schema; migrations `1790550000000` through `1790554000000`, `1793001000000`, `1794400000000`, `1794600000000`, `1795200000000` and `1795300000000`; `ProblemsService`, `SubmissionsService` and `JudgeService`.

### Assessments and project workspaces

| Table | Key and relationships | State and integrity rules |
|---|---|---|
| `enterprise_tests` | UUID primary key; owner CASCADE; unique invite code | Schedule, duration, ordered problem/challenge arrays, invitation arrays and score-release policy. CHECKs require end after start, duration 10–600 minutes, 1–20 combined tasks and at most 200 explicit invitations. UUID/text arrays do not create element-level foreign keys. |
| `enterprise_attempts` | UUID primary key; test/user CASCADE; unique `(test_id, user_id)` | One candidate attempt per test, start/deadline timestamps and optional finish time. The effective deadline also accounts for the test's current `ends_at`. |
| `vibe_attempts` | UUID primary key; user CASCADE; optional enterprise attempt CASCADE | Challenge ID, JSONB workspace/report state, revision, model, deadline/submission time and operation lease. Partial unique index `(enterprise_attempt_id, challenge_id)` applies to enterprise workspaces. Challenge IDs are validated against application catalog data, not a challenge table FK. |
| `vibe_revisions` | Composite primary key `(attempt_id, revision)`; attempt FK to `vibe_attempts`, CASCADE | Retained files, action, changed paths, optional message ID and timestamp. The message ID relates to workspace state rather than a separate messages table. |

Sources: enterprise-tests/invites, Vibe-coding and enterprise-Vibe migrations; `EnterpriseService` and `VibeService`.

### Community and notifications

| Table | Key and relationships | State and integrity rules |
|---|---|---|
| `community_posts` | UUID primary key; author CASCADE; optional problem and accepted comment SET NULL | Category CHECK, title/body, tags/views, moderation and timestamps. Accepted-comment membership in the same post is a service rule beyond the FK's existence check. |
| `community_comments` | UUID primary key; post/author CASCADE | Body, timestamps and moderation visibility. |
| `community_votes` | Composite primary key `(post_id, user_id)`; both FKs CASCADE | One vote per user/post; new user-first index supports profile lookup without changing uniqueness. |
| `community_comment_votes` | Composite primary key `(comment_id, user_id)`; both FKs CASCADE | One vote per user/comment. |
| `community_saved` | Composite primary key `(post_id, user_id)`; both FKs CASCADE | One saved relation per user/post; new user-first index supports profile lookup. |
| `community_follows` | Composite primary key `(author_id, user_id)`; both FKs to users CASCADE | Following is an author/user relationship. A CHECK disallows self-following; the existing reverse index supports a user's followed authors. |
| `community_reports` | UUID primary key; reporter and optional post/comment FKs CASCADE | CHECK requires exactly one target. Partial unique indexes prevent duplicate reports by one reporter for the same post or comment. Resolution time is stored on the report. |
| `community_post_views` | Composite primary key `(post_id, viewer)`; post CASCADE | Deduplication by viewer key; `viewer` is not a user-ID FK. |
| `notifications` | UUID primary key; recipient/post/comment/submission CASCADE; actor SET NULL | Type CHECK, read state and creation time. Conditional uniqueness protects accepted-answer notifications; submission uniqueness prevents duplicate Judge notifications. |

Sources: community, community-UI and community-moderation-notifications migrations; community and notification services.

### Learning and email

| Table | Key and relationships | State and integrity rules |
|---|---|---|
| `mission_states` | UUID primary key; user CASCADE, optional problem SET NULL; unique `(user_id, mission_key, period_key)` | CHECKs constrain known mission keys, non-negative progress/reward, positive target, progress ≤ target and claiming only after completion. |
| `user_badges` | Composite primary key `(user_id, badge)`; user CASCADE | One grant per user/badge with award time. |
| `analysis_attempts` | Composite primary key `(user_id, question_id, day)`; user CASCADE | Selected answer 0–3, correctness and retained solved state. Question IDs refer to the application question catalog. |
| `email_preferences` | User ID is primary key and FK, CASCADE | Opt-in flags and per-category consent versions. |
| `email_tokens` | Token hash primary key; user CASCADE | VERIFY/UNSUBSCRIBE purpose CHECK, associated email, expiry and use time. Raw bearer tokens are not stored as keys. |
| `email_outbox` | UUID primary key; user CASCADE; optional unique notification FK CASCADE | Encrypted payload when present, consent version, bounded kind/state values, retries, delivery lease and timestamps. |
| `email_request_limits` | Recipient key primary key | Request timestamps with cardinality ≤ 5; used for persistent request limiting. |
| `email_delivery_clock` | Boolean primary key constrained to true | Singleton delivery pacing timestamp shared by application instances. |

Sources: missions, learning-evidence and community-email migrations; mission and email services. The notification-insert trigger can enqueue eligible community email, and the withdrawal trigger removes the withdrawn user's email delivery, token and preference records.

## Existing indexes and access paths

Primary and unique constraints supply their own indexes. The schema also explicitly defines these principal access paths:

| Workload | Index family or constraint |
|---|---|
| Identity lookup and ranking | `uq_users_email`, `uq_users_username`, `uq_users_username_lower`, `idx_users_xp_created`, partial `idx_users_active` |
| Problem and snapshot lookup | Unique slug and testcase order indexes; composite `problem_versions` primary key |
| Submission history, quota and recovery | `idx_submissions_user_created`, `idx_submissions_problem_created`, `idx_submissions_problem_status_user`; partial `idx_submissions_lease` for JUDGING and `idx_submissions_queued_updated` for QUEUED |
| Assessment ownership and scoring | `enterprise_tests_owner_idx`, `enterprise_attempts_user_idx`, unique test/user attempt, partial `submissions_attempt_idx` and `vibe_enterprise_challenge_idx`, `idx_vibe_attempts_user_started` |
| Community lists and threads | `idx_community_created`, `idx_community_category`, `idx_community_problem`, `idx_community_author`, `idx_community_comments`, `idx_community_comment_author` |
| Community relationships/moderation | Relationship primary keys, `idx_community_follows_user`, report target indexes, partial open-report and unique report indexes; two new profile indexes described below |
| Notification reads and idempotency | `idx_notifications_user`, partial `idx_notifications_unread`, post/comment indexes, `uq_notifications_accepted`, `uq_notifications_submission` |
| Learning, sessions and operations | `idx_mission_claimed`, `idx_analysis_user_updated`, refresh user/family indexes, `idx_audit_events_created` |
| Email lookup and retry | `idx_email_tokens_user`, `idx_email_outbox_user`, partial `idx_email_outbox_pending`, unique token/notification keys |

An FK's presence does not imply that every referencing column has an efficient leading index. Solve anchors and notification actors remain examples to assess against deletion/maintenance workloads. No extra index was added solely because a column participates in an FK.

## Transaction and state ownership

| State | Durable owner and reviewed behavior |
|---|---|
| Access/session eligibility | Current user and refresh-family rows are rechecked by authentication. Email-only enterprise access now additionally requires the existing `users.email_verified_at` value; arrays are not rewritten into unconditional user grants. |
| Submission acceptance | The API transaction owns quota and eligibility. Non-admin submissions lock the user with `FOR NO KEY UPDATE`; enterprise submissions then lock the attempt and read current eligibility in a separate statement using `clock_timestamp()`. The accepted problem version and queued row are saved together; enqueue follows commit. |
| Finish versus new enterprise work | Submission and new-workspace creation serialize on the same attempt row used by finishing. Workspace creation checks the effective deadline after obtaining that lock. Returning an existing eligible workspace retains its previous behavior. |
| Judge attempt | PostgreSQL generation, random attempt ID and lease fence claims/results; BullMQ's job key includes submission ID and generation. Rejudge/recovery can advance the generation, preventing an older worker from replacing a newer result. |
| Result visibility | For newly recorded per-case details, the API derives sample membership from the saved problem version. It filters diagnostic output and validates result indices before persistence. No historical submission rows are rewritten by this patch. |
| XP/statistics | Solve reconciliation and retained submission evidence own credited learning; database triggers own aggregate problem counts. The patch does not replace those mechanisms with Redis caches. |
| Vibe workspace | Revision and operation ID guard edits and long-running operations. Enterprise parent-before-workspace locking, retained revision files and score-release policy continue to apply. |
| Email delivery | PostgreSQL consent versions, outbox state and leases govern retries; provider work occurs under the existing delivery protocol. No email schema or provider contract changed. |

The lock changes close the reproduced acceptance/deadline and foreign-key lock-cycle cases. They do not claim a new serializable isolation level or protection for every possible schedule/invitation administration race. See [BACKEND.md](BACKEND.md) and [SECURITY.md](SECURITY.md) for the focused tests and limitations.

## Additive migration and rollback

`CommunityProfileIndexes1795700000000` is registered after `CommunityEmail1795600001000`. Its `up` adds:

| Table | Index | Ordered columns | Properties |
|---|---|---|---|
| `community_votes` | `idx_community_votes_user_post` | `user_id, post_id` | B-tree, non-unique, no predicate |
| `community_saved` | `idx_community_saved_user_post` | `user_id, post_id` | B-tree, non-unique, no predicate |

The existing `(post_id, user_id)` primary keys remain intact. The new order lets the actual saved/voted profile queries select one user's relationships efficiently. The benchmark applied the production migration to synthetic data and compared identical ordered responses; its two 200,000-row relation tables each gained a 9,961,472-byte index. Write amplification and production index-build duration were not benchmarked.

The migration uses ordinary transactional `CREATE INDEX`, not `CREATE INDEX CONCURRENTLY`. A future rollout on populated tables must budget the write-blocking interval, index storage and lock acquisition. No operational migration was executed in this task. A concurrent-index rollout would require a separately designed migration/transaction policy; this patch does not silently change the global runner's transaction rules.

`down` drops the saved index and then the vote index. It does not delete relationship rows or undo an authorization policy, and prior code can continue using the unchanged table shape. Ordinary index removal also needs database locks. Revert only this known migration when it is the last applied migration; do not interpret the successful disposable full-chain round trip as permission to roll back populated historical migrations. Existing history/consent/withdrawal rollback guards remain important.

Actual PostgreSQL migration-chain checks and the dedicated index integration test passed in the database workstream. Combined-branch and remote-CI results are maintained by the coordinator in [TESTING.md](TESTING.md); they are separate from this schema description.

## Deferred model and capacity work

Assessment `problem_ids` bind task IDs, not immutable `(problem_id, version)` pairs. A submission records the accepted current problem version inside its transaction, so that submission's later judging uses its snapshot; this does **not** freeze the entire assessment's task versions at publication or attempt start. A version-bound task relation needs an explicit publication/edit/retention policy, lifecycle tests and migration design. It is deferred, not implemented by this index migration.

Other deferred work includes workload-based FK maintenance indexes, an explicit multi-replica connection budget, bounded enterprise result pagination, larger search/history datasets, and a mixed-write benchmark of `refresh_problem_stats`. That trigger currently locks a problem's statistics and recounts finished submissions; replacing it safely requires concurrent submit/rejudge/delete evidence. No unmeasured scale guarantee or destructive redesign is claimed.
