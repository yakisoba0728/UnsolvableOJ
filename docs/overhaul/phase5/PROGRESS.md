# Phase V progress

Authoritative changing checkpoints are posted to [Issue87](https://github.com/yakisoba0728/UnsolvableOJ/issues/87); this committed document records its own source checkpoint, not a future CI result.

| Milestone | Current state |
|---|---|
| M0 live baseline and new integration | COMPLETE |
| M1 finite backlog and worktree isolation | IN PROGRESS; three implementation streams started |
| M2 implementation | IN PROGRESS |
| M3 actual qualification/measurements | NOT COMPLETE |
| M4 independent review and exact final CI | NOT COMPLETE |
| M5 manual handoff | NOT COMPLETE |

Initial subagents: Frontend, Judge/Vibe, DB/API (three created, maximum three concurrent). Security/Infra and Reliability/QA are queued for separate agents. Counts will be updated from actual execution; queued work is not a created agent.

Protected state: main `6176015...`, PR63 head `3bcba380...`, PR86 head `d0159b1...`, all unchanged/open/unmerged. Final manual order is #63 → #86 → new Phase V PR, subject to re-reading actual merge state and latest compatible-base CI.

Resume by reading Issue87, querying all live heads/PR checks, then reading the per-stream evidence. Never infer completion from this initial document or reuse a superseded green run.

## Runtime evidence checkpoint — 2026-11-16 14:50 UTC

Foundation PR #88 run `43884655462` failed the Runtime image and aggregate required jobs; the other ten jobs succeeded. The original source `ce26659b816c1dc1450cdc48f0c58d6e41ecea1e`, checkout `a5c85b0f4a32fb1451a51f6db95d7a6abbee3970`, and tree `6fcefbd2a2714b1cad1e2c51fa090958c73b6048` remain recorded. Fifteen reviewed advisory fingerprints changed; no HIGH/CRITICAL cohort ID changed. The failed raw ZIP and all before/after records are retained.

Security proposed exact content at remote `5021547e8214cd6404bc2e7728c70634dbca0c63` (local `4c7d24dd12b300df2312e35d4d81a43fe625844c`), tree `61650d4c296150f540468aa6fd5e049df13bce7b`. Independent QA approved content SHA256 `d938665f24995ea53bf0984047459de0aa9ba366dc5ebbe37055f304c68903fb` after independent CNA/vendor retrieval and exact-source review. Coordinator separately repeated binding checks and actual evaluations before adding approval metadata. Raw HIGH177/CRITICAL5, November30 expiry, scanner/evaluator and fail-closed behavior remain unchanged. Fresh full CI is mandatory before integration.

PRs #89 (Frontend), #90 (Judge), and #91 (database qualification) are published drafts with independent scoped source review; none is merged. Six unique worker agents have been created, at most three worker agents concurrently, plus the coordinator. Follow-up turns reuse those agents. Actual per-stream completion and final CI are still pending.
