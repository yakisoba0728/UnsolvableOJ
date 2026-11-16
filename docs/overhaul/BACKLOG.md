# Fixed iteration scope and follow-up backlog

The first implementation scope is frozen around reproduced authorization/time/ownership defects, CI correctness, defensive sandbox/callback boundaries, and measured local allocation/loading costs. Additions require a newly confirmed serious defect or a concrete verification dependency.

## Current gates

- Finish enterprise transaction/deadline/lock-order tests on actual PostgreSQL and Redis.
- Finish independent cross-domain security fixes and regressions.
- Execute real-browser tests in CI and final native 8-language/pipeline/Compose validation.
- Complete separate database/performance and infrastructure/reliability audits.
- Review every changed code path independently, then integrate only green PRs.

## Capacity and operations work

- Representative large-volume query plans and sustained API/queue stress; no arbitrary target numbers.
- Queue/worker/API restart and Redis reconnect observations under concurrent submissions.
- Dedicated sandbox execution-host topology validation; same-host privileged deployment remains a documented limitation.
- Off-host backup and a measured restoration drill; current same-host dumps do not cover host loss.
- Dependency-license governance and transitive SBOM; absence of a scanner finding is not license approval.
- Frontend cross-browser/mobile/accessibility assessment beyond current regression suite.
- External AI/email failure/rate-limit tests with deterministic providers; no paid live calls or production secrets.

## Deferred feature expansion

Add features only after the security/correctness gates above. This iteration already includes practical notification error/retry behavior. Larger assessments exports, operational dashboards, new editor tools and broader learning features require separately bounded acceptance criteria and measured user benefit.
