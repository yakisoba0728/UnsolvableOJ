# Phase II installed-image vulnerability inventory

Baseline: `8a72b3701a94153a5b5ab353a6af5efc15378d3c`. This follow-up closes the
missing scan path identified in [PHASE2-SECURITY.md](PHASE2-SECURITY.md). A
successful image build and a successful npm audit are different evidence from
an operating-system package scan. The four actual application-image scan
results remain **pending exact-commit GitHub Actions execution** until their
artifacts are reviewed. No local Docker build or application-image scan is
claimed in this document.

## Scope and acceptance

The existing `images` matrix builds the same four final images and exports
each to a local OCI directory on its isolated Actions runner. It does not push
to a registry or start an application container. The build digest must match
the exported OCI index or selected manifest; config and actual layer bytes are
hashed before scanning. Exactly one `linux/amd64` application image must be
present. The scanner's image config ID must equal the verified config digest.

| Existing image | Dockerfile | Installed-package/runtime coverage requested |
|---|---|---|
| Back | `Back/Dockerfile` | Final Alpine OS packages and installed npm packages |
| Front | `Front/Dockerfile` | Final nginx Alpine OS packages and any supported detected libraries |
| Judge worker | `Judge/Dockerfile` | Final Alpine OS packages and installed npm packages |
| Judge runtime | `Judge/runtime/Dockerfile` | Final Ubuntu OS packages, installed esbuild metadata, Go binary modules/stdlib, and supported language packages/Java archives present in the filesystem |

`scripts/image_audit.py` explicitly retains Trivy's **`os,library`** package
scope with vulnerability and standard license-metadata scanners. It does not
disable the library or embedded-binary analyzers to obtain fewer findings.
Its JSON inventory includes detected packages without CVE findings, with
separate package counts by target/class/type. A supported Alpine or Ubuntu
identification and nonempty OS package name/version coverage are required.
Expected installed npm anchors (`@nestjs/core` in Back, `bullmq` in the worker,
`esbuild` in the runtime) must be recognized. The runtime must also contain a
`gobinary` result for `/opt/go-judge` with a versioned `stdlib`. Missing one of
these expected results fails coverage validation instead of looking clean.

This is an **installed package inventory**, not a guaranteed complete
installed-image SBOM. Trivy's pinned
[Node.js coverage documentation](https://github.com/aquasecurity/trivy/blob/v0.76.2/docs/guide/coverage/language/nodejs.md)
establishes installed `node_modules/**/package.json` detection; that does not
establish advisory coverage for the independently copied Node engine binary.
Its [Go coverage documentation](https://github.com/aquasecurity/trivy/blob/v0.76.2/docs/guide/coverage/language/golang.md)
describes embedded modules and the compiler's stdlib, including the limitations
of missing main-module versions, compressed binaries and unknown call-path
reachability. Library packages with unknown versions remain counted and
require review. Arbitrary C/C++ binaries, application-specific bugs and a
complete mapping from minified frontend bundles to original dependencies are
not claimed as covered. Actual Go/esbuild/npm coverage must be confirmed from
the four image reports, not inferred from supported-analyzer documentation.

The existing `scripts/collect-sboms.mjs` separately produces complete
CycloneDX npm **lockfile graphs**, including build and optional dependencies.
Those graphs are neither a list of binaries shipped in the final image nor a
substitute for this installed-image scan. Neither inventory alone proves the
absence of all vulnerabilities. Existing digest-pinned Ubuntu/Node runtime
base references are preserved. Other mutable base/service tags remain the
documented gap in `PHASE2-SECURITY.md`; recording an exact built-image digest
does not retroactively pin those upstream tags.

## Reviewed scanner and provenance

The pinned tool is [Aqua Security Trivy v0.76.2](https://github.com/aquasecurity/trivy/releases/tag/v0.76.2),
published on **2026-11-05**, source commit
[`3f6334d223b52188324af3b9923b4249cd206652`](https://github.com/aquasecurity/trivy/tree/3f6334d223b52188324af3b9923b4249cd206652).
On 2026-11-16, the official release API identified the release as immutable.
Its asset digests, the downloaded official checksum file and the downloaded
archive agreed. The pin is stored in `scripts/image-audit-tool.json`.

| Reviewed artifact | SHA-256 |
|---|---|
| `trivy_0.76.2_Linux-64bit.tar.gz` (52,714,130 bytes) | `bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf` |
| `trivy_0.76.2_checksums.txt` | `802e4ac1418ed967cd3c4b901f4f71ca00b7363ede67778665a22d9f13f58c83` |
| Extracted `trivy` executable, independently measured locally | `6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3` |

Primary provenance sources:

- [Official release REST metadata](https://api.github.com/repos/aquasecurity/trivy/releases/tags/v0.76.2)
  and [tag reference](https://api.github.com/repos/aquasecurity/trivy/git/ref/tags/v0.76.2).
- [Official checksums](https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_checksums.txt)
  and [Linux amd64 archive](https://github.com/aquasecurity/trivy/releases/download/v0.76.2/trivy_0.76.2_Linux-64bit.tar.gz).
- [Trivy's official March 2026 security advisory](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)
  and [incident conclusion](https://github.com/aquasecurity/trivy/discussions/10462).
  The documented compromised releases/actions were considered when selecting
  a later immutable release and a direct archive pin. This does not establish
  trust in every upstream dependency or replace a signed build attestation.
- [OCI directory export](https://docs.docker.com/build/exporters/oci-docker/),
  [Trivy container scanning](https://trivy.dev/docs/latest/target/container_image/),
  and [standard versus full license scanning](https://trivy.dev/docs/dev/scanner/license/).
  The implementation was also checked against the pinned source's
  [`pkg/fanal/image/oci.go`](https://github.com/aquasecurity/trivy/blob/v0.76.2/pkg/fanal/image/oci.go),
  [`pkg/types/report.go`](https://github.com/aquasecurity/trivy/blob/v0.76.2/pkg/types/report.go)
  and [`pkg/version/version.go`](https://github.com/aquasecurity/trivy/blob/v0.76.2/pkg/version/version.go).

The runtime verifies the archive checksum **before** extracting only the
regular `trivy` member and executing it. This is checksum-integrity
verification, not Sigstore attestation verification. No additional third-party
GitHub Action is introduced; the existing commit-pinned build/export and
artifact actions remain in use. Tool or pin changes select all four image
jobs. Updating the tool requires a new reviewed version, source commit,
official asset checksums, adapter tests and exact-head Actions scans.

## Failure policy and evidence

Each job downloads a fresh advisory database from the explicit official
`ghcr.io/aquasecurity/trivy-db:2` repository into a new temporary cache. The
manifest records tool version, executable hash, database schema, `UpdatedAt`,
`DownloadedAt`, `NextUpdate` and the actual database-file SHA-256. An update
older than 48 hours or more than ten minutes in the future fails validation.
The scan then disables vulnerability-DB updates and verifies that database
hash again afterward. Java archives may additionally trigger the pinned
tool's on-demand download from `ghcr.io/aquasecurity/trivy-java-db:1`. When
requested, its separate schema/timestamps and file SHA-256 are captured after
the scan, with a seven-day age limit appropriate to that index's slower
updates. Java results without recorded Java-index metadata fail validation.
When the scanner did not download the Java index, this is recorded explicitly;
no Java-archive coverage is then claimed. The
[pinned Java documentation](https://github.com/aquasecurity/trivy/blob/v0.76.2/docs/guide/coverage/language/java.md)
and [index updater](https://github.com/aquasecurity/trivy/blob/v0.76.2/pkg/javadb/client.go)
describe this separate database path. The mutable database tags therefore do
not conceal which database bytes were actually used.

No inherited `TRIVY_*` settings, automatic config file, ignore file,
unfixed-vulnerability filter, severity filter or modified-finding suppression
can silently turn findings into a clean report. All severities and statuses
remain in `trivy.json`; offline package analysis and telemetry disabling are
explicit. Network downloads are confined to scanner/distribution data; the
application image is read locally. The 30-minute image-job limit remains, with
bounded scanner install, DB download and image-scan subprocess timeouts.

| Outcome | Exit status | Meaning |
|---|---|---|
| Download, checksum, DB freshness, image identity, scan or report failure | 1 | Execution failed; no clean-image claim |
| Completed scan with HIGH/CRITICAL OS or library findings, including unfixed findings, or an end-of-life OS | 2 | Image gate blocked; fix and rescan, or retain the unresolved blocker |
| Completed scan without those blocking findings | 0 | Package gate passed; lower/unknown findings and unversioned library packages still require explicit review |

The scanner is first asked to write all findings with its own `--exit-code 0`;
the wrapper then applies the mandatory policy above. That collection step does
not decide CI success. There is no `continue-on-error`, blanket ignore list or
automatic vulnerability acceptance. The raw report must be read alongside
`manifest.json`; only `execution: COMPLETED` plus the policy result proves a
completed scan. A passed severity gate does not accept lower-severity findings
on a reviewer's behalf. Before integration, record their package/version,
advisory, fixed version, actual reachability where established, decision and
remaining risk. Do not alter severity thresholds to make a failed run pass.

On success or failure, the artifact named
`image-audit-<component>-<workflow-sha>-<attempt>` retains for 30 days:

- `manifest.json`: actual checkout commit, dirty-worktree flag, scanner-source
  and pin hashes, exact image/config/layer digests, tool/DB provenance, status,
  finding counts, expected-library coverage, unknown-version counts, blocking
  findings with target/type, and license-metadata counts.
- `trivy.json`: complete raw scan report with OS/library package inventory,
  all CVEs and standard license metadata, when the scan reached this stage.
- Scanner download, database download and scan logs, plus raw version JSON.

Failure to produce the expected artifacts also fails the job. The existing
aggregate required gate continues to depend on every image matrix result.

## License boundaries

The downloaded scanner archive contains Trivy's Apache-2.0 license; its
[upstream license](https://github.com/aquasecurity/trivy/blob/v0.76.2/LICENSE)
is separate from the scanned images' package declarations. License category
and severity fields from the license scanner are reported independently from
security CVE severity. Missing package license declarations are counted rather
than assumed to be permissive. Full source-file license detection and legal
interpretation are outside this step. No repository license is assigned, and
no package-license inventory is described as legal approval. Existing notices
for copied runtime binaries remain relevant. In particular, recognized Go
binary module versions do not imply that licenses for all embedded modules
were recovered; standard license coverage differs from vulnerability coverage.

## Reproduction and observed validation

Run the policy/identity tests without Docker or network access:

```sh
python3 -m unittest discover -s scripts -p 'image_audit_test.py'
node --test scripts/ci-policy.test.mjs scripts/collect-sboms.test.mjs
```

For a locally built OCI directory exported with `type=oci,tar=false`, run:

```sh
python3 scripts/image_audit.py back /tmp/oj-back-oci reports/images/back '<actual-build-digest>'
```

The tool deliberately refuses a guessed or mismatched digest. Obtain it from
the build's metadata, as CI does from `steps.image.outputs.digest`.

`scripts/image_audit_fixture.py` can create a small deterministic OCI fixture
and optionally exercise the real pinned tool/download/database/report path:

```sh
python3 scripts/image_audit_fixture.py /tmp/oj-image-fixture --scan-report reports/images/synthetic-fixture
```

This fixture contains only text OS/npm package metadata, deliberately old
BusyBox, OpenSSL and lodash versions, and no executable programs or application
files. A
completed scan with blocking advisories returns **2**, preserving the real
policy result. Its findings do not describe any shipped UnsolvableOJ image.
The adapter fixture cannot replace the four application-image Actions scans.

Local execution evidence, dated 2026-11-16:

- Official archive/checksum download and comparison completed. The extracted
  binary reported `Version: 0.76.2`; its actual CLI flags were checked.
- A fresh official GHCR advisory DB download completed (134.14 MiB). This
  establishes tool/DB availability, not an image scan result.
- Fifteen wrapper/identity/failure/coverage tests passed, including npm/Go
  library findings, missing expected runtime coverage, malformed reports,
  database freshness and actual workflow path selection. Ten existing CI
  policy tests and four existing npm-SBOM coverage tests also passed.
- The actual synthetic OCI adapter scan completed in 42.459 seconds, including
  fresh scanner and DB downloads. It identified **two OS packages and one
  installed npm package**. Its 77 finding instances were 33 LOW, 27 MEDIUM,
  14 HIGH and 3 CRITICAL, including six lodash library findings. The wrapper
  preserved `execution: COMPLETED`, `gate: BLOCKED_FINDINGS` and exit status
  **2**. It did not turn those findings into successful CI. Three standard
  license records were reported separately. Java was not present in the
  fixture and the Java index was correctly recorded as not downloaded.
- The [unaltered synthetic-run manifest](evidence/image-audit-synthetic-2026-11-16.json)
  records the dirty pre-commit checkout honestly, exact scanner/pin source
  hashes, fixture image/config/layer digests, tool executable digest, raw
  report digest and database timestamps/hash. The vulnerability DB was updated
  at `2026-11-16T01:11:02.624123452Z`, downloaded at
  `2026-11-16T02:58:48.243411959Z`, and had SHA-256
  `dcbd479f6de2e82a0d1588afe354c12456dcacd4b8f6128e2046ae0623a67f87`.
  The raw local report/logs remain under `reports/images/synthetic-fixture/`;
  CI will retain the four application images' raw reports in its artifacts.
- Docker is unavailable locally. Real Back/Front/Judge/runtime scans,
  actual Go binary and Java archive recognition, vulnerability triage and
  exact-commit CI remain required before integration.

No before/after service-performance claim follows from this tooling change.
The cost is bounded extra image-export, hashing, database-download and scan
work on existing isolated CI runners.
