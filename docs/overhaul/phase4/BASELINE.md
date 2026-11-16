# Phase IV baseline

## Start gate — PASS

Live read-only verification on 2026-11-16 18:34 KST established the following before any Phase IV mutation.

| Binding | Value |
|---|---|
| Phase III source | `3bcba380f92bd2da8973e6c88c00cd14b03be08e` |
| Complete source tree | `bb7a10752038434c79b51282a5227186143ff405` |
| Unchanged main / PR63 base | `6176015b63a1615cc2269172f246725ef08abab3` |
| Actual PR63 CI checkout | `7bb0b27e6f7a57bf2ba743dc8a765ac2ac312ecc` |
| Exact-source Actions | [43834915085](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43834915085), completed/success, all 12 jobs |
| Independent C approval | [PR63 final receipt](https://github.com/yakisoba0728/UnsolvableOJ/pull/63#issuecomment-6912127737), 18:08:02 KST |
| Latest central handoff | [Issue72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72#issuecomment-6912145086), 18:08:51 KST |

PRs #76, #77 and #78 are actually merged. Their merge commits are respectively `d6f8bb9c963800093fb24f293652bab2ca42883f`, `3bcba380f92bd2da8973e6c88c00cd14b03be08e`, and `f52c7d0aecfb6ae98329d219110eac526bb0dbcb`. The CI checkout has the expected main/source parents and identical complete tree. C's explicit `READY_FOR_MANUAL_MERGE` applies to this unchanged head; no later blocking P0/P1 was recorded. This checks C's existing independent disposition, not a replacement approval by a new implementer.

Two separate read-only agents checked final QA and actual CI. Required execution was observed for native 74 assertions, pipeline 33 cases, three Compose flows, browser projects, all four image builds/scans, 327 backend units, 243 PostgreSQL/API cases, 137 worker cases and five Python health cases. Browser totals are 764 actual executions plus 85 browser-free units, not 849 distinct stories.

Runtime remains `PASS_WITH_REVIEWED_COMPONENT_FINDINGS`: raw HIGH 177 / CRITICAL 5 and scanner exit 2 are preserved, with the existing exact component review and 2026-11-30 00:00 UTC expiry. Host/kernel assurance is unverified.

## Branch and preservation contract

`overhaul4/integration` starts at the Phase III source above. Feature PRs target that branch. The final Phase IV PR targets `overhaul/integration` while PR63 remains unmerged, or main after a separately observed manual Phase III merge. Neither final PR is automatically merged. Main and the Phase III integration branch are not written by this work.

The first Phase IV change adds its integration branch to CI's PR trigger and full-validation selection. Every Phase IV feature PR and final PR must run the existing full 12-job gate. Scanner rules, audit thresholds, execution assertions and review expiry remain unchanged.

## Environment and measurement limits

The initial local workspace has Node 24.22.1 and npm 11.9.0, but no Docker/Podman/PostgreSQL/Redis executable. Local build/unit/browser checks and actual GitHub Actions execution are recorded separately. Finite CI measurements are not field Web Vitals, production capacity, host isolation, or multi-hour leak evidence. No production state or paid service is used.
