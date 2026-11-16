# Phase IV security and deployment limits

## Preserved Runtime review

Runtime remains **PASS_WITH_REVIEWED_COMPONENT_FINDINGS**, raw **HIGH177 / CRITICAL5**, raw scanner exit **2**. This is not zero vulnerabilities. The existing component review expires **2026-11-30 00:00 UTC**. Changed images/packages/advisories require reevaluation; this work neither extends expiry nor suppresses findings or changes scanner policy. Phase IV still builds and scans four images.

Host/kernel and privileged-container escape resistance remain **UNVERIFIED**. No dangerous escape experiment is performed on a shared runner. Algorithm-worker separation did not automatically cover Vibe's independent API execution path.

## Implemented controls

Dedicated Vibe mode uses a private HTTPS agent with CA/hostname verification, mandatory client identity and a distinct strong bearer. Invalid origins, embedded URL credentials, weak/example/reused tokens and invalid/mismatched identities fail startup. TLS verification remains enabled. Method/path restrictions, no redirects, bounded requests/streamed responses, fixed run/cleanup deadlines and limited sockets/cache identifiers bound the transport. Public errors do not echo endpoint/secret material.

Sixteen real localhost TLS checks run in CI, covering server/client trust, hostname, missing/wrong bearer despite mTLS, redirect refusal, size limits, cancellation and cleanup. Existing native tests separately exercise embedded execution. A TLS fixture is not evidence that a deployed gateway or privileged host is secure.

Learning mutations preserve authorization, active/token-version checks and user-first lock order; withdrawal removes the goal. UI ownership distinguishes account changes from same-account token rotation. Enterprise exports enforce owner/admin authorization and one repeatable-read snapshot, a scalar allowlist, safe CSV, no-store and explicit size rejection. Backend ownership remains authoritative when the UI cancels stale work.

The restore rehearsal requires disposable-CI opt-in, NODE_ENV=test, loopback and an owned PostgreSQL17 service. It creates random databases and drops only names created by that invocation. PASS follows cleanup. Dump bytes, connection strings and raw DB errors are not public artifacts. CHECK normalization uses transaction-bound temporary tables and never changes original rows/constraints.

## Unverified operator responsibilities

| Boundary | Remaining validation |
|---|---|
| Dedicated host | Approved host/VM placement, kernel controls and privileged runtime risk |
| Gateway | Approved image/version, nginx validation and deployed mTLS/bearer behavior |
| Network | Private DNS, host firewall, inbound allowlist, egress and separate algorithm execution |
| Identity | Issuance, permissions, revocation/rotation and operational token/certificate secrecy |
| Topology | Actual expanded Compose semantics and operator-specific deployment validation |
| Recovery | Production-volume rehearsal, backup retention, writer/lock load, RTO/RPO |

The API overlay removes its local sandbox network attachment; it does not remove original algorithm judge/go-judge services. Separating all submitted-code execution also requires moving those services with the existing algorithm template. The dedicated runtime template has no published host port or application DB/Redis/JWT credentials, but an internal Docker network does not prove privileged-container isolation.

No production deployment occurs. Passing code/CI review is an input to a separate release decision. See [VIBE-TRANSPORT.md](VIBE-TRANSPORT.md) and [RELIABILITY.md](RELIABILITY.md) for bounded checks and commands.
