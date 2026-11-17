# Remaining risks and explicit gates

| Item | Disposition | Required completion evidence |
|---|---|---|
| New exact-source full CI and independent final QA | PENDING until final PR receipt | Current head/base/checkout/parents/tree; all12 actual jobs; decoded logs/artifacts and separate reviewers |
| Runtime raw HIGH177/CRITICAL5 | Reviewed component findings remain present | Fresh exact image/scanner/advisory/payload match; drift or expiry must block |
| Runtime review deadline | Fixed `2026-11-30T00:00:00Z` | Supported patch or a newly justified independently reviewed proposal; no automatic renewal |
| Dedicated executor host/kernel/VM | BLOCKED_EXTERNAL_ENVIRONMENT | Approved host inventory, patch and isolation evidence; no shared-host escape test |
| Real networks/firewall/egress and gateway | BLOCKED_EXTERNAL_ENVIRONMENT | Deployed topology and negative network-path checks |
| Operational certificates/credentials | BLOCKED_EXTERNAL_ENVIRONMENT | Issuer/owner, rotation, revocation, distribution and expiry monitoring |
| Production migration and backup/restore | BLOCKED_EXTERNAL_ENVIRONMENT | Representative data, lock/writer discipline, offsite retention/access and verified recovery |
| Monitoring and alert ownership | BLOCKED_EXTERNAL_ENVIRONMENT | Named operator and demonstrated delivery/recovery process |
| Sustained capacity and independent fault domains | BLOCKED_EXTERNAL_ENVIRONMENT | Bounded approved resources/load plan, complete instrumentation and stop thresholds |
| Field INP/LCP/CLS | BLOCKED_EXTERNAL_ENVIRONMENT | Actual deployed population/approved telemetry; field INP remains null |
| Physical devices/manual assistive technology | BLOCKED_EXTERNAL_ENVIRONMENT | Device and screen-reader acceptance; no whole-site WCAG certification claimed |
| Hours-long editor memory and exhaustive signal taxonomy | DEFERRED_NONBLOCKING | Separate controlled duration/signal protocol; short heap samples do not prove absence of leaks |
| Java hard-limit MLE | DEFERRED_NONBLOCKING | Separate bounded native cgroup-pressure proof; existing heap OOM stays RE |
| Paid-provider quality and repository license | OWNER_DECISION_REQUIRED | Explicit authorized provider scope/spend or copyright-owner license choice |
| Following an existing post by a withdrawn author | CONTRACT_UNCONFIRMED, nonblocking audit observation | Product decision on target eligibility; the acting follower is fenced, and no broader target-account rule was invented |

The historical [external gate detail](../overhaul/phase5/REMAINING-EXTERNAL-GATES.md)
supplies prior evidence and operator requirements. Its old phase status and manual
stack order are historical. The canonical consolidation receipt determines current
code disposition.

Source review cannot establish that every possible interleaving, role/state,
runtime signal or external component was exhausted. Record concrete residual
findings with severity, reproduction and owner; do not replace a blocked test with
a guessed PASS or claim product-wide100% completion.
