# go-judge production package graph

The rebuilt runtime's original Trivy report from run `43800123825` contains
`GO-2026-5932` with severity `UNKNOWN` for module `golang.org/x/crypto` v0.58.0.
The [official Go advisory](https://pkg.go.dev/vuln/GO-2026-5932) concerns the
unmaintained `golang.org/x/crypto/openpgp` package and its descendants. A module
inventory alone does not show which packages enter this executable's build.

## Measured source-build result

On 2026-11-16, the verified patched v1.13.3 source, Go 1.27.4 and the exact
production build configuration resolved **505 packages**, including 231 standard
library packages. **No `golang.org/x/crypto/openpgp` package or descendant was
present.** The five imported x/crypto packages were `chacha20`,
`chacha20poly1305`, `internal/alias`, `internal/poly1305`, and `sha3`.

This command used the same flags and environment as the existing build:

```sh
CGO_ENABLED=0 GOTOOLCHAIN=local go list \
  -mod=readonly -buildvcs=false -trimpath -tags=nomsgpack,grpcnotrace \
  -deps -f '{{.ImportPath}}' ./cmd/go-judge
```

The [Go command documentation](https://pkg.go.dev/cmd/go#hdr-List_packages_or_modules)
describes `-deps` as the dependency traversal and documents the build flags shared
by `list` and `build`. The command did not use `-test`, `-e`, an alternate module
file, or an overlay. Any resolution error failed execution.

The sorted package-list SHA256 is
`1aa051d8531ccc96759b472ef4cf03d2ddda07d80bdfb660d3b4a9c9163192b6`.
`measurements/phase2-go-package-graph/` retains the actual local path list and a
summary tying it to the exact source archive, backport, lockfiles, environment,
checker, and already-built local binary. It explicitly records
`actualContainerBuild: false`; it is not presented as a completed Docker test.

## Build change

The existing module verification, six command/protocol package test targets,
version embed, and `go build` invocation remain unchanged. A subsequent Docker
layer runs the production `go list` command, sorts the complete path list and
rejects OpenPGP imports. The checker also rejects empty, malformed or duplicate
entries and a missing/duplicate main package. It fails normally on input errors.

The final runtime image retains:

| Path | Actual build evidence |
|---|---|
| `/opt/go-judge-packages.txt` | Sorted production dependency package paths |
| `/opt/go-judge-build-env.json` | Go version, GOOS, GOARCH, CGO and toolchain selection |
| `/opt/go-judge-build-info.txt` | `go version -m` output from the built binary |
| `/opt/go-judge-source-locks.sha256` | Hashes of the source lockfiles used by this builder |
| `/opt/go-judge-artifacts.sha256` | Hashes tying the executable and four evidence files together |

The existing `/opt/go-judge-build.json` describes these generated artifacts and
their scope. The source-level checker is copied into the builder only. No
application dependency was removed or upgraded for this advisory, and no
scanner result was suppressed or reclassified.

## Validation and limits

Locally, all four new graph regressions and the existing runtime Python test
passed. The actual 505-package list passed the same AWK guard used by Docker.
The CI-policy suite is unchanged and the runtime Dockerfile change selects full
native validation. Exact final-image build, image scan and native execution
remain required before integration.

Absence from this configured production import closure supports a narrow
source-build conclusion about these OpenPGP packages. It does not prove all
x/crypto packages are safe, validate a different architecture/tag configuration,
or replace vulnerability scanning. The original `UNKNOWN` finding remains in
the raw report for review. Future introduction of the prohibited import prefix
fails the image build and requires an explicit engineering decision.
