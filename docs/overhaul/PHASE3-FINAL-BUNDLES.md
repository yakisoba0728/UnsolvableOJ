# Phase III final frontend bundle comparison

Measured on 2026-11-16. This **replaces the final-delivery interpretation** of the
earlier exploratory local `3038961b835a4a435e12205ff022c7b1d91226bd` measurement,
whose frontend source predates the final learning request-cancellation fix.
That exploratory artifact is not part of this accepted evidence bundle; the
raw metadata retains its original identifier for provenance. Use the numbers
and immutable sources below in the final Phase III report.

## Exact sources and conditions

| Source | Commit | Complete repository tree | Front subtree |
| --- | --- | --- | --- |
| Phase II baseline | `45b6c9c6f879b8966b8f0c14eecdd06fb5a588e4` | `141e2df98ff4739c1c574bd2a3165858c2a9ebc9` | `89a206a8b29054d3ad5525eae5bc46a4419e3304` |
| Final learning + Vibe frontend | `f93c569cf12d219b9999612ff992a2d52863e210` | `bad7cf2336617126d9a05b5a69cd8a10dfc7c216` | `efabdae74322c327c9716e907b271399950f3227` |

The final source contains the merged learning dashboard, its StrictMode
request-cancellation fix and the enterprise Vibe version UI. Local commit
`508545d40e2a08b00673e2c63396169243187434` has the same complete tree and Front tree;
the measured archive uses the actual `f93c569` Git object. Later backend-only or
test/document changes do not automatically invalidate the shipped asset sizes;
any change to frontend build inputs requires a new comparison.

Four fresh `git archive` snapshots were built in separate owned directories with
`npm run build` (`tsc -b && vite build`). Neither the Vibe worktree nor the final
validation worktree was modified. All four builds succeeded. There was **one build
per source/condition**; repeatability across multiple builds is not asserted.

- Node **24.22.1**, npm **11.9.0**, Linux x64; exact runtime/library versions and
  executable path are recorded in the raw JSON.
- The same already installed dependency tree was reused through symlinks. Both
  immutable `package.json` and `package-lock.json` files matched that installation;
  `npm ls --all --json` succeeded. No packages were installed or upgraded.
- Build environment was explicitly restricted to the recorded `PATH`,
  `LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `TZ=UTC`, `CI=1`, `NODE_ENV=production`, plus the
  one synthetic monitoring variable when applicable. Other inherited environment
  variables were omitted. No active Vite `.env` file was present.
- **Default:** `VITE_SENTRY_DSN` and `VITE_API_BASE_URL` unset.
- **Monitoring configured:** `VITE_SENTRY_DSN=https://benchmark@example.invalid/1`;
  `VITE_API_BASE_URL` unset. No built application was launched, so no monitoring
  service or paid external API was called.

Each emitted file has a SHA-256 and raw size. JavaScript, CSS and HTML also have
independent Node gzip level-9 and Brotli quality-11 sizes. Compression totals sum
those separately compressed files; they do not compress concatenated output.
The raw evidence also includes every tracked Front input's hash, the installed
dependency inventory/hash, output inventory/hash and the four build logs.

## Final comparison

All table values are **bytes**. “Initial entry” means the module script directly
referenced by generated `index.html`, matching the earlier measurement definition.
It is not the full initial request graph. “All emitted JS” includes every `.js`
file, lazy routes, the optional monitoring SDK and `theme-init.js`; it is not the
amount downloaded on every visit.

| Condition | Quantity | Phase II | Final Phase III | Change |
| --- | --- | ---: | ---: | ---: |
| Default | Initial entry, raw | 381,551 | 381,916 | +365 |
| Default | Initial entry, gzip | 122,690 | 122,789 | +99 |
| Default | All emitted JS, raw | 1,470,378 | 1,481,734 | +11,356 |
| Default | All emitted JS, gzip | 485,346 | 488,919 | +3,573 |
| Monitoring configured | Initial entry, raw | 381,582 | 381,947 | +365 |
| Monitoring configured | Initial entry, gzip | 122,710 | 122,807 | +97 |
| Monitoring configured | All emitted JS, raw | 1,470,409 | 1,481,765 | +11,356 |
| Monitoring configured | All emitted JS, gzip | 485,378 | 488,965 | +3,587 |

There are 53 emitted JavaScript files at baseline and 54 in the final build.
The optional monitoring chunk remains separately emitted: 92,991 raw bytes in all
four conditions, and 32,168 gzip bytes in both final builds. Its existence in
`dist` does not imply a download when monitoring is disabled.

### Lazy learning route

| Final condition | Asset | Raw | gzip | SHA-256 |
| --- | --- | ---: | ---: | --- |
| Default | `LearningPage-7bxxvcMA.js` | 9,678 | 3,166 | `69240f7017b6f723c986e90f3141192e89a394ae8c5daff6ed3b8db44d02b650` |
| Monitoring configured | `LearningPage-CQ9kfJAe.js` | 9,678 | 3,168 | `cb0f15c9fb983900e007734fe49592ad666a5b9c29aafe3eb29cfed6b87f0004` |
| Both | `LearningPage-aYmBmihx.css` | 5,891 | 1,470 | `e54a416d243ec7d900c06de2e74006b75711cf50960d7c396833a4d2208e8f64` |

These files are separate from the initial HTML module entry. The learning route
and its dependencies can require additional existing chunks on navigation; the
route-specific file sizes are not a claim of its complete cold-load payload.

The earlier checkpoint reported 1,478 gzip bytes for the **same CSS hash**.
The final comparison compresses every file consistently using Node's recorded
zlib implementation, producing 1,470. A retained cross-check reproduces 1,478 with
Python's zlib 1.3.2 on those identical bytes. This difference is compression
implementation behavior, **not a CSS source reduction**. Do not present it as a
product optimization.

## Evidence and reproduction

- [Raw measurements and complete input/output hashes](measurements/phase3-final-bundles/phase3-final-frontend-bundles.json)
- [Installed dependency inventory](measurements/phase3-final-bundles/installed-dependencies.json)
- [CSS compression cross-check](measurements/phase3-final-bundles/compression-crosscheck.json)
- [Reproduction script](repro/phase3-final-bundles.mjs)
- Build logs: [baseline/default](measurements/phase3-final-bundles/baseline-default.build.log),
  [final/default](measurements/phase3-final-bundles/final-default.build.log),
  [baseline/monitoring](measurements/phase3-final-bundles/baseline-monitoring-enabled.build.log),
  [final/monitoring](measurements/phase3-final-bundles/final-monitoring-enabled.build.log).

With both immutable Git objects available and matching Front dependencies already
installed, run from the repository root with a **new** output directory:

```sh
node docs/overhaul/repro/phase3-final-bundles.mjs "$PWD" "$PWD/Front" /tmp/oj-final-bundle-evidence-new
```

The script refuses to overwrite evidence, validates dependency/source matches,
builds isolated snapshots and verifies that tracked input bytes were unchanged.
The raw totals and all four retained log hashes were recomputed with a separate
Python calculation after collection and agreed with the report. This arithmetic
cross-check is distinct from the coordinator's independent review.

## Interpretation limits

This measures the delivery-size cost of the implemented features and final
correctness fix. It does not establish faster page loads, lower rendering cost,
lower CPU/RSS, improved Web Vitals or field/device-wide performance. It does not
measure nginx/CDN compression configuration, HTTP transfer overhead, caching,
browser parsing, execution or painting. The separate production Compose browser
probe supplies a different, explicitly bounded lab experiment; its results must
not be inferred from these byte counts.
