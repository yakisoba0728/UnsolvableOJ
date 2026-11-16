# Locked dependencies and reported licenses

Baseline: `6176015b63a1615cc2269172f246725ef08abab3`. Integration snapshot: `03f356375c839ed2ccb84116a6fecd336c8e50f3`.

This inventory reads the committed `package.json` and npm lockfile v3 records for Back, Front and Judge at those exact revisions. It is a metadata audit: it does not download packages, install a new scanner, adjudicate license terms, or claim legal approval. The machine-readable summary, file hashes and exceptional entries are in [dependency-licenses.json](measurements/dependency-licenses.json). The complete transitive package lists remain in the three lockfiles.

## Changes between the two revisions

All three `package-lock.json` files are **byte-identical**. Back and Front manifests are also identical. The only manifest change is in `Judge/package.json`: the check script includes the new output/HTTP regressions and a `benchmark:output` script is added. No dependency declaration, locked version or reported dependency license changes in this comparison.

| Component | Application name | `private` | Application `license` field | Lock records | Direct runtime declarations | Direct development declarations |
|---|---|---|---|---:|---:|---:|
| Back | `@unsolvable-oj/back` | `true` | `UNLICENSED` | 504 | 25 | 17 |
| Front | `@unsolvable-oj/front` | `true` | Not declared | 263 | 12 | 7 |
| Judge | `@unsolvable-oj/judge` | `true` | Not declared | 29 | 3 | 2 |

`UNLICENSED` is the Back application manifest value, separate from the license metadata of its third-party dependencies. Front and Judge omit the application license field; all three manifests set `private: true`. These metadata values are not a license approval for dependency code and are not converted into one by this report.

No tracked top-level `LICENSE`, `LICENCE`, `COPYING` or `NOTICE` file, with or without an extension, exists at either examined revision. The top-level README has no license section identified by the license/copyright text check. Accordingly, this inventory identifies **no repository-wide top-level license grant**; public repository visibility is not recorded as such a grant. Two nested notices are present: [presentation assets](../presentation/src/assets/LICENSE) contains an MIT notice, and [presentation fonts](../presentation/src/assets/fonts/LICENSE) contains a SIL Open Font License 1.1 notice. Those scoped notices are not represented here as a grant for the whole application.

## Counting rules

The **796** count is the number of non-root `packages` entries across the three lockfiles: 504 Back, 263 Front and 29 Judge. A package at two lock paths or in two components is counted twice. Application root entries (`packages[""]`) are excluded. This is not a count of distinct libraries, installed production packages, browser-bundled modules, or container contents. Optional platform-specific packages remain in the lock inventory even when the local install omits them.

Flags below are the literal lock-record booleans. An absent/false flag is treated as unset. The combinations are disjoint and sum to each component total. In particular, an unflagged record is not proof that it is deployed, and manifest `devDependencies` membership is not identical to the lock `dev` flag: shared transitive/peer reachability can produce different metadata. For example, Back declares `@types/node` as a development dependency but its lock record is unflagged, while Back TypeScript has `devOptional: true`. The raw summary cross-tabulates every reported license with these flag combinations.

| Lock flags set | Back | Front | Judge | Total |
|---|---:|---:|---:|---:|
| `unflagged` | 262 | 147 | 17 | 426 |
| `dev` | 177 | 63 | 3 | 243 |
| `optional` | 10 | 0 | 9 | 19 |
| `dev+optional` | 53 | 53 | 0 | 106 |
| `devOptional` | 2 | 0 | 0 | 2 |

## Reported license fields

Values are retained exactly as reported in the lockfiles. This pass does not validate every string against an SPDX parser or compare it with each package tarball. Compound expressions are kept intact rather than selecting one alternative or treating an `AND` expression as a single-license grant.

| Reported field | Back | Front | Judge | Total records |
|---|---:|---:|---:|---:|
| `(AFL-2.1 OR BSD-3-Clause)` | 1 | 0 | 0 | 1 |
| `(MIT AND BSD-3-Clause)` | 1 | 0 | 0 | 1 |
| `0BSD` | 6 | 0 | 1 | 7 |
| Missing | 4 | 0 | 0 | 4 |
| `Apache-2.0` | 17 | 6 | 4 | 27 |
| `BSD-2-Clause` | 7 | 1 | 1 | 9 |
| `BSD-3-Clause` | 16 | 1 | 0 | 17 |
| `BlueOak-1.0.0` | 6 | 0 | 0 | 6 |
| `CC-BY-4.0` | 0 | 1 | 0 | 1 |
| `ISC` | 26 | 8 | 1 | 35 |
| `MIT` | 407 | 246 | 22 | 675 |
| `MPL-2.0` | 12 | 0 | 0 | 12 |
| `PSF-2.0` | 1 | 0 | 0 | 1 |

No null, empty-string, object-valued or `SEE LICENSE` field was found among the dependency records. Four entries omit `license`; their status remains unknown in this metadata inventory. The two compound expressions below are not declared invalid: they are retained for explicit review rather than flattened.

| Component | Lock entry | Version | Reported license / issue | Lock flags |
|---|---|---|---|---|
| Back | `node_modules/busboy` | `1.6.0` | Missing `license` field | `unflagged` |
| Back | `node_modules/passport-strategy` | `1.0.0` | Missing `license` field | `unflagged` |
| Back | `node_modules/pause` | `0.0.1` | Missing `license` field | `unflagged` |
| Back | `node_modules/streamsearch` | `1.1.0` | Missing `license` field | `unflagged` |
| Back | `node_modules/json-schema` | `0.4.0` | `(AFL-2.1 OR BSD-3-Clause)` | `unflagged` |
| Back | `node_modules/sha.js` | `2.4.12` | `(MIT AND BSD-3-Clause)` | `unflagged` |

Other less frequent labels are preserved in the counts, including 12 Back `MPL-2.0` records for Lightning CSS and its platform packages, one Back `PSF-2.0` record for `argparse`, and one Front `CC-BY-4.0` record for `caniuse-lite`. Their inclusion is an observation about lock metadata, not a conclusion about redistribution requirements.

## Direct dependency resolutions

Each row joins the current manifest declaration to its exact `packages["node_modules/<name>"]` lock entry. All 66 direct declarations resolve there without a missing entry. `Runtime` below means the manifest `dependencies` section; `Development` means `devDependencies`. These labels do not override the separate lock flags. Registry URLs and integrity digests remain available at those lock paths; lockfile Git blob IDs and SHA-256 digests are recorded in the JSON artifact.

### Back

Sources: [Back/package.json](../../Back/package.json) and [Back/package-lock.json](../../Back/package-lock.json). The table applies to both examined revisions because the dependency declarations and lock entries are unchanged.

| Declaration scope | Package | Declared range | Locked version | Reported license |
|---|---|---|---|---|
| Runtime | `@ai-sdk/openai` | `^4.0.114` | `4.0.114` | `Apache-2.0` |
| Runtime | `@nestjs/bullmq` | `^12.0.1` | `12.0.1` | `MIT` |
| Runtime | `@nestjs/common` | `^12.4.0` | `12.4.0` | `MIT` |
| Runtime | `@nestjs/config` | `^12.1.1` | `12.1.1` | `MIT` |
| Runtime | `@nestjs/core` | `^12.4.0` | `12.4.0` | `MIT` |
| Runtime | `@nestjs/jwt` | `^12.0.4` | `12.0.4` | `MIT` |
| Runtime | `@nestjs/passport` | `^12.0.1` | `12.0.1` | `MIT` |
| Runtime | `@nestjs/platform-express` | `^12.0.1` | `12.4.1` | `MIT` |
| Runtime | `@nestjs/swagger` | `^12.1.1` | `12.1.1` | `MIT` |
| Runtime | `@nestjs/throttler` | `^6.7.1` | `6.7.1` | `MIT` |
| Runtime | `@nestjs/typeorm` | `^12.0.3` | `12.0.3` | `MIT` |
| Runtime | `ai` | `^7.0.169` | `7.0.169` | `Apache-2.0` |
| Runtime | `bullmq` | `^6.7.1` | `6.7.1` | `MIT` |
| Runtime | `class-transformer` | `^0.5.1` | `0.5.1` | `MIT` |
| Runtime | `class-validator` | `^0.15.1` | `0.15.1` | `MIT` |
| Runtime | `dotenv` | `^17.2.2` | `17.2.2` | `BSD-2-Clause` |
| Runtime | `helmet` | `^8.3.0` | `8.3.0` | `MIT` |
| Runtime | `ioredis` | `^5.8.2` | `5.8.2` | `MIT` |
| Runtime | `joi` | `^18.2.9` | `18.3.2` | `BSD-3-Clause` |
| Runtime | `passport` | `^0.7.0` | `0.7.0` | `MIT` |
| Runtime | `passport-jwt` | `^4.0.1` | `4.0.1` | `MIT` |
| Runtime | `pg` | `^8.23.1` | `8.23.1` | `MIT` |
| Runtime | `reflect-metadata` | `^0.2.2` | `0.2.2` | `Apache-2.0` |
| Runtime | `rxjs` | `^7.8.1` | `7.8.2` | `Apache-2.0` |
| Runtime | `typeorm` | `^0.3.31` | `0.3.31` | `MIT` |
| Development | `@mixmark-io/domino` | `^2.2.0` | `2.2.0` | `BSD-2-Clause` |
| Development | `@nestjs/cli` | `^12.0.12` | `12.0.12` | `MIT` |
| Development | `@nestjs/schematics` | `^12.0.0` | `12.0.13` | `MIT` |
| Development | `@nestjs/testing` | `^12.4.0` | `12.4.0` | `MIT` |
| Development | `@types/express` | `^5.0.0` | `5.0.6` | `MIT` |
| Development | `@types/node` | `^24.0.0` | `24.13.6` | `MIT` |
| Development | `@types/passport-jwt` | `^4.0.1` | `4.0.1` | `MIT` |
| Development | `@types/supertest` | `^7.0.0` | `7.2.1` | `MIT` |
| Development | `@vitest/coverage-v8` | `^4.1.2` | `4.1.11` | `MIT` |
| Development | `oxlint` | `^1.92.0` | `1.92.0` | `MIT` |
| Development | `oxlint-tsgolint` | `^7.0.2001` | `7.0.2006` | `MIT` |
| Development | `prettier` | `^3.9.10` | `3.9.10` | `MIT` |
| Development | `supertest` | `^7.3.1` | `7.3.1` | `MIT` |
| Development | `turndown` | `^7.2.5` | `7.2.5` | `MIT` |
| Development | `turndown-plugin-gfm` | `^1.0.2` | `1.0.2` | `MIT` |
| Development | `typescript` | `^6.0.2` | `6.0.3` | `Apache-2.0` |
| Development | `vitest` | `^4.1.2` | `4.1.11` | `MIT` |

### Front

Sources: [Front/package.json](../../Front/package.json) and [Front/package-lock.json](../../Front/package-lock.json). The table applies to both examined revisions because the dependency declarations and lock entries are unchanged.

| Declaration scope | Package | Declared range | Locked version | Reported license |
|---|---|---|---|---|
| Runtime | `@sentry/react` | `^11.11.0` | `11.11.0` | `MIT` |
| Runtime | `katex` | `^0.19.1` | `0.19.1` | `MIT` |
| Runtime | `lucide-react` | `^1.70.0` | `1.70.0` | `ISC` |
| Runtime | `react` | `^19.3.1` | `19.3.1` | `MIT` |
| Runtime | `react-dom` | `^19.3.1` | `19.3.1` | `MIT` |
| Runtime | `react-markdown` | `^10.1.0` | `10.1.0` | `MIT` |
| Runtime | `react-router-dom` | `^7.18.5` | `7.18.5` | `MIT` |
| Runtime | `rehype-katex` | `^7.0.1` | `7.0.1` | `MIT` |
| Runtime | `rehype-raw` | `^7.0.0` | `7.0.0` | `MIT` |
| Runtime | `rehype-sanitize` | `^6.0.0` | `6.0.0` | `MIT` |
| Runtime | `remark-gfm` | `^4.0.1` | `4.0.1` | `MIT` |
| Runtime | `remark-math` | `^6.0.0` | `6.0.0` | `MIT` |
| Development | `@playwright/test` | `1.63.0` | `1.63.0` | `Apache-2.0` |
| Development | `@types/node` | `24.19.0` | `24.19.0` | `MIT` |
| Development | `@types/react` | `^19.1.0` | `19.3.0` | `MIT` |
| Development | `@types/react-dom` | `^19.1.0` | `19.3.0` | `MIT` |
| Development | `@vitejs/plugin-react` | `^5.0.0` | `5.2.0` | `MIT` |
| Development | `typescript` | `^6.0.2` | `6.0.3` | `Apache-2.0` |
| Development | `vite` | `^7.1.0` | `7.3.8` | `MIT` |

### Judge

Sources: [Judge/package.json](../../Judge/package.json) and [Judge/package-lock.json](../../Judge/package-lock.json). The table applies to both examined revisions because the dependency declarations and lock entries are unchanged.

| Declaration scope | Package | Declared range | Locked version | Reported license |
|---|---|---|---|---|
| Runtime | `bullmq` | `^6.7.1` | `6.7.1` | `MIT` |
| Runtime | `dotenv` | `^17.2.2` | `17.4.2` | `BSD-2-Clause` |
| Runtime | `ioredis` | `^5.8.2` | `5.11.1` | `MIT` |
| Development | `@types/node` | `^24.0.0` | `24.19.0` | `MIT` |
| Development | `typescript` | `^6.0.2` | `6.0.3` | `Apache-2.0` |

## Scope and remaining evidence

The CI workflow runs `npm audit --omit=dev --audit-level=high` for Back, Front and Judge. Its pass/fail state belongs to the exact CI run linked in [TESTING.md](TESTING.md). A passing gate means that command did not fail its configured npm advisory threshold at that time; it does not imply zero low/moderate findings, absence of all CVEs, OS/container coverage, a complete SBOM, license approval, or a blanket security clearance. This inventory did not run a fresh registry audit.

OS packages, base images, language compilers, go-judge binaries, downloaded runtime tooling, fonts/assets and externally fetched resources are outside the npm lock inventory. The two tracked asset notices were inspected separately, without asserting that they cover every asset. Exact shipped-image/package and browser-bundle inventories require artifact-specific evidence.

Follow-up consists of inspecting authoritative packaged notices for the four missing metadata entries and preserving the two compound expressions when preparing any artifact notice inventory. Repository-wide application licensing remains an owner decision; this task adds no license grant and makes no compliance determination. Dependency/lock changes after the recorded integration SHA require regeneration.

For reproduction, read `git show <revision>:<component>/package-lock.json`, exclude the empty root key, group each remaining record by the literal `license` field and the true `dev`/`optional`/`devOptional` flags, and join direct manifest names to `node_modules/<name>`. Compare source bytes or the recorded hashes before interpreting a change. This operation requires only Git and a JSON parser.
