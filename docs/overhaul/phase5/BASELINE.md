# Phase V immutable starting receipt

Live GitHub reads and a local Git checkout confirmed this baseline on 2026-11-16 (KST). This is a new increment; prior Phase I–IV reports and acceptance receipts remain intact.

| Identity | Verified value |
|---|---|
| Main, unchanged | `6176015b63a1615cc2269172f246725ef08abab3` |
| Phase III / PR63 head | `3bcba380f92bd2da8973e6c88c00cd14b03be08e` |
| PR63 state and base | OPEN / UNMERGED, `main` |
| Phase IV / PR86 head | `d0159b1f844bf0608415dded9e84af566c8e2041` |
| PR86 state and base | OPEN / UNMERGED, `overhaul/integration` |
| Phase IV complete tree | `f12f6c377ea07f0cb4b498ca0fe5889ed4401a66` |
| Phase IV CI | [43852089830](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43852089830), all 12 jobs completed successfully |
| Baseline actual checkout | `906819c36a56f1f8326e6d8743b02a102762138a` (historical independent receipt) |
| New integration starting point | `overhaul5/integration` at the exact Phase IV head |
| New tracking issue | [#87](https://github.com/yakisoba0728/UnsolvableOJ/issues/87); shared history [#72](https://github.com/yakisoba0728/UnsolvableOJ/issues/72) |

No pre-existing Phase V branch or open PR was found. PR63 and PR86 were the only open PRs. Latest Issue72 receipt supersedes historical IN PROGRESS notes. The live workflow job list, source branch and local Git tree agree with the accepted Phase IV source.

## Existing evidence reused

Phase IV already supplies learning goals, safe 5,000-row enterprise export, result distributions, route/mobile focus, dedicated Vibe HTTPS/mTLS transport, a 24-job/3-wave/two-worker experiment and disposable 31-migration/37-table restore checks. Phase III supplies learning/review, immutable assessment versions and statement-delta statistics. These are not new Phase V features.

Baseline Runtime raw HIGH177 / CRITICAL5 and scanner exit2 are preserved. Component applicability review expires **2026-11-30 00:00 UTC / 09:00 KST**; this increment cannot renew it automatically. Existing limited browser LCP364→384ms and CLS0.029427→0.048731 medians are separate small CI samples, not established causal regressions or field metrics.

## Execution and boundaries

Local Git read access and connected GitHub write access work. Docker is absent. Local dependencies and owned PostgreSQL/Redis binaries are assessed before use; CI executes native, Compose and four-image qualification. No production DB, Redis, volume, key, host, deployment or paid provider is used. Feature PRs target only Phase V integration. The final stacked PR targets Phase IV integration and remains open/unmerged.
