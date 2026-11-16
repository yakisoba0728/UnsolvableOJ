# Phase II image findings and bounded remediation

Status: **IMPLEMENTED / locally TESTED; image/native CI pending.** The image
gate remains strict and the Ubuntu header findings remain blocking. This is not
an image-security pass or a deployment-readiness declaration.

## Actual failing baseline

PR [#68](https://github.com/yakisoba0728/UnsolvableOJ/pull/68), head
`6d11f600006884f43d93c8deb35afe9f62acaf73`, ran image audits in
[43796045174](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43796045174).
GitHub checked out merge commit `c167a1e17e7b915fc313c52357e7505f8cf56b6f`.
All four scans completed with valid OS/library inventories and exited **2 for
findings**. These were not scanner download, coverage, or report errors. Runtime
coverage recognized both esbuild and the actual `/opt/go-judge` binary, including
its Go standard library. No failed scan is counted as a pass.

| Final image / installed package | Before HIGH | Before CRITICAL | Implemented change | After |
|---|---:|---:|---|---|
| Back: global npm's brace-expansion / undici | 6 | 0 | Remove the unused global npm tree after production install | N/A; CI pending |
| Judge worker: same global npm tree | 6 | 0 | Same final-image-only removal | N/A; CI pending |
| Front: libxslt `1.1.43-r3` | 3 | 0 | Alpine security package `>=1.1.43-r4` | N/A; CI pending |
| Runtime: apt and libapt-pkg6.0t64 `2.8.3` | 2 | 0 | Explicit supported-distribution update, minimum `2.8.4ubuntu0.1` | N/A; CI pending |
| Runtime: go-judge's x/net `v0.61.0` and stdlib `v1.27.2` | 2 | 0 | Pinned source rebuild with x/net `v0.62.0` and Go `1.27.4` | Binary versions checked locally; image scan pending |
| Runtime: linux-libc-dev `6.8.0-149.149` | 177 | 5 | Retained unchanged; applicability review and vendor fixes outstanding | Still blocking; no exception |

The complete original artifact ZIPs, their GitHub artifact IDs and SHA-256
digests, per-report hashes, all severity counts, and every HIGH/CRITICAL finding
are retained in [before-provenance.json](measurements/phase2-image-remediation/before-provenance.json)
and the four adjacent `before-*.zip` files. The ZIPs are the original downloaded
bytes, not reconstructed summaries. Each contains the raw Trivy JSON, scanner
version/provenance, and download/scan logs. The image manifests also retain the
OCI image/layer identity and advisory database provenance.

## Final Back/Judge image contents

Both scans located the six HIGH findings at these exact paths:

- `usr/local/lib/node_modules/npm/node_modules/brace-expansion/package.json`
- `usr/local/lib/node_modules/npm/node_modules/undici/package.json`

They belong to base-image npm `11.19.1`; they are not the application's locked
production dependency instances. The maintainer advisories identify patched
[brace-expansion versions](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7)
and [undici versions](https://github.com/nodejs/undici/security/advisories/GHSA-2m5v-pch6-74hx).
The exact additional advisory IDs and installed paths remain in the raw reports.

The Dockerfiles still run `npm ci` in build stages and `npm ci --omit=dev` for
application production dependencies. After the latter completes, only the
global npm installation, its npm/npx launchers, and root's npm download cache
are removed from the final image. Application `node_modules`, its package
metadata and licenses, Node itself, and OS package metadata remain present.
This removes shipped executable code; it does not hide it from the scanner.

Back's entrypoint invokes `node_modules/.bin/typeorm` (a Node CLI), then
`node dist/main.js`. The worker runs `node dist/worker.js`. Included maintenance
scripts can still run as `node scripts/bootstrap-admin.mjs` and
`node scripts/seed-starter.mjs`. No actual entrypoint or included maintenance
path invokes npm. The final image intentionally no longer supports ad-hoc
`npm install` or `npm run`; source checkouts/build stages retain those commands.
The real Compose startup/migrations/browser/Judge tests remain required.

Node and nginx now use the exact immutable base digests resolved in the failing
CI builds. This change does not claim a newer Node release, a clean builder
image, or complete coverage of statically embedded Node dependencies.

## Supported OS package updates

Front retains nginx's XSLT support and applies the
[Alpine v3.24 libxslt security package](https://pkgs.alpinelinux.org/packages?branch=v3.24&name=libxslt).
The `>=1.1.43-r4` constraint fails the image build if the security fix cannot be
obtained, rather than continuing with the old package.

Runtime explicitly installs/upgrades APT alongside its existing language tools
and asserts that both apt and libapt-pkg6.0t64 meet the fixed minimum. Ubuntu
[USN-8996-1](https://ubuntu.com/security/notices/USN-8996-1) specifies
`2.8.4ubuntu0.1` for Noble. The old APT is used with `Acquire::Retries=0` while
installing the fix, following Ubuntu's
[CVE-2026-109518 mitigation](https://ubuntu.com/security/CVE-2026-109518).
No unrelated distribution migration, compiler/header removal, package-database
deletion, or vulnerability suppression is introduced.

## Minimal go-judge security rebuild

The source is still upstream **v1.13.3**, exact commit
[`4ebd2ffe9474639c665fa21cfb438f68820fe77c`](https://github.com/criyle/go-judge/tree/4ebd2ffe9474639c665fa21cfb438f68820fe77c).
Docker verifies the source archive SHA-256 before extracting it. The rebuild
has three deliberate security changes:

1. Use the official Go `1.27.4` builder pinned by OCI index digest. The official
   [Go release history](https://go.dev/doc/devel/release) and
   [crypto/x509 advisory](https://pkg.go.dev/vuln/GO-2026-6809) support the patched
   toolchain choice. Docker Hub's returned index digest matched the downloaded
   index bytes. Its official source revision and Go binary SHA-256 were compared
   with both the
   [docker-library Dockerfile](https://github.com/docker-library/golang/blob/6aa5c5f09346fb65fdefa941a23eb3cb25ba7b1a/1.27/bookworm/Dockerfile)
   and `go.dev/dl` metadata. The same verified toolchain was used locally.
2. Update x/net to `v0.62.0`, the fix for
   [GO-2026-6860 / CVE-2026-78661](https://pkg.go.dev/vuln/GO-2026-6860).
   Committed `go-judge.go.mod` and `go-judge.go.sum` are complete locks. Comparing
   the before/after module graphs changes **only x/net**; the go.sum delta is
   its two checksums. This uses ordinary Go module resolution and sum
   verification, with no replacement directive or checksum bypass.
3. Apply the exact two-hunk upstream
   [authentication-log redaction fix `57165af`](https://github.com/criyle/go-judge/commit/57165afa402dad1b8b83274120560274b4e498c0).
   The old startup code logs the configured token through both configuration
   and auth-attachment messages. The backport logs a redacted configuration
   copy and removes the token field from the attachment message. Authentication
   still receives the original token. No real credential was used in tests.

Upstream v1.14.1 was evaluated, but its go.mod still used x/net `v0.61.0` and the
v1.14 series also changes cgroup pooling, exit-order reporting, and swap
behavior. Those independent runtime changes are outside this bounded fix.
The current swap enforcement, seccomp policy, namespaces, resource settings,
eight language tools, and authenticated readiness checks remain in force.

The source rebuild uses upstream's `nomsgpack,grpcnotrace` tags and disables cgo.
It compiles command/protocol tests before the final binary. Source archives do
not contain Git metadata, so VCS stamping is disabled explicitly and the
application reports `v1.13.3-unsolvable.1`. Go's main-module build metadata is
`(devel)`, a disclosed coverage limitation for main-module version matching;
the standard library and dependency versions remain embedded and inspectable.
No upstream release version is forged. The image ships the exact source,
backport, builder, and lockfile identity in `/opt/go-judge-build.json`.

`check-logs.mjs` validates the actual startup logs after authenticated Compose
readiness in both native CI and the isolated full Compose flow. It requires
configuration/auth startup markers and a redacted token field, rejects the
configured token including its JSON-escaped form, and never prints the captured
logs or expected token on failure. Unit fixtures cover both original leak
forms, missing logs/markers, absent tokens, and JSON escaping. Existing native
authentication/isolation tests remain mandatory.

## Kernel headers: retained findings and explicit limits

The exact package inventory is retained in
[linux-libc-dev-inventory.json](measurements/phase2-image-remediation/linux-libc-dev-inventory.json).
It contains **988 `.h` files under `/usr/include` and two documentation files**;
there are no package-owned kernel executables or loadable modules in that
inventory. Ubuntu describes this package as
[development headers](https://packages.ubuntu.com/noble/linux-libc-dev), while
the scanner associates it with source package `linux`.

The five CRITICAL IDs are CVE-2026-63825, CVE-2026-64523, CVE-2026-68426,
CVE-2026-90162, and CVE-2026-93221. Their upstream descriptions concern kernel
implementation areas (gcov, handshake, xfrm, ksmbd, nfsd). The official
[63825](https://ubuntu.com/security/CVE-2026-63825) and
[64523](https://ubuntu.com/security/CVE-2026-64523) Noble entries were still
work in progress for `6.8.0-151.151` when inspected. A planned vendor version
is not an available fixed package.

This inventory helps distinguish source-package associations from shipped
kernel code. It does **not** prove the running host is safe, determine its
kernel configuration, or clear all 177 HIGH findings by analogy. Independent
per-advisory classification and deployment-host evidence are separate work.
The current scanner gate continues to fail on all unresolved HIGH/CRITICAL
findings. No ignore list, invented VEX, severity downgrade, or headers removal
is included. Dedicated execution-host patching remains an operating requirement;
no production host was accessed or modified.

## Local verification and remaining acceptance gates

| Check | Actual result |
|---|---|
| Complete Go before/after module graphs | Only x/net `v0.61.0` → `v0.62.0` |
| `go mod verify` | All modules verified |
| Patched Go command/protocol tests | Six packages passed; 53 tests/subtests; two additional packages have no tests |
| Patched Go build and `-version` | Passed; `v1.13.3-unsolvable.1` |
| Actual binary `go version -m` | Go `1.27.4`, x/net `v0.62.0`, cgo disabled, expected tags |
| Judge `npm run check` | Build and **107/107** tests passed |
| Image-audit adapter tests | **15/15** passed |
| CI policy and npm SBOM tests | **14/14** passed |
| Docker image build / actual updated image scans | **Not executed locally**; Docker unavailable |
| Actual startup-log check / 74 native cases / pipeline / Compose browser | **Pending exact candidate CI** |

Local Go build metadata, module graphs, test events, Judge test output, official
builder metadata, and unchanged baseline scan artifacts are retained alongside
the provenance JSON. The local Go binary SHA-256 is recorded only as a local
build result; it is not substituted for the eventual image binary identity.

Integration requires independent source review and exact-candidate CI. Runtime
image findings can still block that gate even when the bounded language and
recovery suites pass. Follow-up should obtain supported vendor fixes or complete
evidence-based applicability decisions, then rescan every actual image without
weakening coverage. Retire the small source backport when a reviewed upstream
release contains all required fixes and passes the same native acceptance suite.

## First patched image execution and zlib follow-up

At published head `1b6700546e44d67a3a6d78fd8a1087500cca1fa5`,
run [43800123825](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43800123825)
checked out PR merge ref `c1c09ab95f6e0cc073a13e602625cc01c99d6aec` and
built and scanned Back, Front and Judge successfully. All three actual scans
reported zero HIGH/CRITICAL findings with required analyzer coverage. Front
reported zero findings at any severity. Back and Judge each retained one MEDIUM
Alpine zlib finding, CVE-2026-4738, at `1.3.2-r1`, with fixed version `1.4-r0`.
This was reported rather than hidden by the passing HIGH/CRITICAL gate.

The [official Alpine security tracker](https://security.alpinelinux.org/vuln/CVE-2026-4738)
identifies `1.4-r0` on the supported 3.24 branch. The
[upstream 1.4 release notes](https://zlib.net/) include the contrib/infback9
correction and describe API/build behavior changes; no externally reachable
application exploit was established. Both final Node Alpine images now request
that supported security package explicitly. Builders and application locks are
unchanged. This is a package update, not an applicability exception. The next
actual image scan and Compose/API/Judge checks must establish its result;
the first patched scan cannot verify a subsequent Dockerfile.

The same run's actual updated runtime scan completed (artifact14195693161,
ZIP SHA256 `1fe33a51e5690f6b06fcd1522738890fdfafdaa5e484836542c05e612f09bfd2`).
Its only remaining HIGH177/CRITICAL5 records are the exact kernel-header
component under separate applicability review. APT and the rebuilt binary's
previous HIGH findings are absent. The scan still correctly blocks, preserves
all LOW/MEDIUM/UNKNOWN entries and identifies the real Go stdlib/dependencies.

Two installed base libraries have supported fixed versions even though their
reported severity is MEDIUM: seven PCRE2 records at `10.42-4ubuntu2.1` and one
Perl record at `5.38.2-3.2ubuntu0.6`. The Dockerfile now explicitly installs their
Noble security updates and checks minimum versions `10.42-4ubuntu2.2` and
`5.38.2-3.2ubuntu0.7`, following official
[USN-8974-1](https://ubuntu.com/security/notices/USN-8974-1) and
[USN-9006-1](https://ubuntu.com/security/notices/USN-9006-1).
These are targeted updates to already installed packages; the supported
compiler/runtime selection, header contents and distribution remain unchanged.
Other currently reported non-header LOW/MEDIUM records have no fixed version
in that report and remain visible; no blanket clean-image claim is made.
The one UNKNOWN Go record concerns unmaintained OpenPGP in x/crypto; its actual
build-package reachability is being checked separately, not assigned an
invented severity or silently removed.
