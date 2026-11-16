# UnsolvableOJ engineering overhaul

This directory records a bounded, evidence-driven audit and implementation started on 2026-11-16.
The authoritative baseline is remote `main` commit `6176015b63a1615cc2269172f246725ef08abab3`, verified using both Git and the connected GitHub API.

**This is an in-progress engineering record, not a certification of the entire platform.**
`main` is not automatically merged and production is not changed.

- [Progress and handoff](PROGRESS.md)
- [Architecture and feature map](ARCHITECTURE.md)
- [API inventory](API.md) and [machine-readable inventory](INVENTORY.json)
- [Audit findings and scope](AUDIT.md)
- [Decisions](DECISIONS.md)
- [Testing](TESTING.md)
- [Performance](PERFORMANCE.md)
- [Backlog](BACKLOG.md)

Specialist reports are added in their respective feature PRs. Implementation and review are separate responsibilities. A change is integrated only after relevant tests, independent review, and all applicable CI jobs succeed.
