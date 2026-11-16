# Actual OCI package payload verification

## Purpose and current status

`scripts/verify_image_payload.py` compares one installed package in a locally
built OCI image with an independently collected, exact package byte manifest.
It does not start an image or container, extract a filesystem, invoke package
maintainer scripts, change scanner findings, or decide vulnerability
applicability. `MATCH` means that this particular byte/control/inventory
comparison succeeded. The existing HIGH/CRITICAL and scanner-coverage gates
remain unchanged.

The initial input is the official Ubuntu `linux-libc-dev` **6.8.0-149.149 amd64**
manifest in `evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json`, collected in
the separate applicability-evidence change. Its SHA256 is
`010441a3487f836ca8d56b32d3264cd286c2d11b569f44b54d2ba3e949911172`.
It identifies 990 regular files and the observed official `.deb` digest. The
archive was obtained over official HTTPS; independent repository-signature
verification was not performed. See `PHASE2-IMAGE-APPLICABILITY.md` for that
provenance and the separately proposed advisory review.

Local verification at introduction: **27 payload regressions, 15 existing
image-audit regressions, 10 CI policy tests and 4 SBOM tests passed**. A separate
synthetic OCI containing all 990 official package files also returned `MATCH`.
That smoke used synthetic dpkg and scanner metadata; it is **not evidence that
the application image contains those bytes**. The actual runtime-image result
is pending the exact-HEAD Actions image job and is retained with that job's
original scanner report.

## Reproduce against an actual exported image

```sh
python3 -m unittest discover -s scripts -p '*image*test.py'
python3 scripts/verify_image_payload.py \
  --oci /path/to/verified-local-oci-layout \
  --build-digest sha256:THE_BUILD_ACTION_DIGEST \
  --expected-manifest docs/overhaul/evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json \
  --scan-report /path/to/original/trivy.json \
  --output /path/to/new/payload-verification.json
```

The output must be new and outside the input OCI layout. Exit codes are 0 for
`MATCH`, 2 for a measured `MISMATCH`, and 1 for `ERROR` or incomplete verification.
Errors never produce a match. Unsupported or ambiguous archive semantics fail
closed; a caller must not reinterpret an error as package absence.

The workflow runs this evidence step for the runtime image after the scanner,
including when the original scanner exits unsuccessfully. It only runs after a
successful image build and a completed scan step. The scanner's failure remains
a job failure. The existing artifact upload retains the payload report beside
the raw `trivy.json`, scanner provenance, logs, and image identity. Changes to
the verifier, its tests, or the expected package manifest select the runtime
image job even when no Dockerfile changes.

## What is verified

1. Reuse the reviewed `image_audit.inspect_oci` identity check for the exact
   BuildKit digest, index, one Linux/amd64 manifest, config, and ordered layer
   digests. Bound the local blob inventory before reading it.
2. Recompute each compressed layer hash while reading, and also require the
   complete uncompressed stream hash to equal its config `rootfs.diff_ids`
   entry. Accept ordinary tar or gzip layers; other compression fails closed.
3. Construct an in-memory final path map without following links. Apply explicit
   and opaque whiteouts to lower-layer state before the current layer's entries.
   Same-layer additions survive whiteouts irrespective of tar member order, as
   required by the [OCI image layer specification](https://github.com/opencontainers/image-spec/blob/v1.1.1/layer.md).
   Later regular-file replacements determine the final hash and layer identity.
4. Reject duplicate canonical paths, traversal, absolute tar entry paths,
   sparse files, unsafe payload/control links, non-directory ancestors,
   write-through links, hardlink aliases into the protected paths, unresolved
   hardlinks, and nonzero data after the archive end marker. Unrelated symlinks
   and special entries may be recorded but are never followed or opened.
5. Read final regular `/var/lib/dpkg/status` and exactly one architecture-qualified
   or unqualified package `.list` from that virtual map. Require one matching
   stanza and exact package, version, architecture, source field, and installed
   status. Require the owned regular-file set to match the manifest and each
   file's actual type, size and SHA256 to match.
6. Bind the original scanner report SHA256 and `Metadata.ImageID` to the verified
   config. Require the scanner's single Ubuntu package record, binary and source
   versions including release/epoch fields, architecture, installed-file set,
   layer digest and diff ID to agree with the same image/package evidence.

The protected files are the expected payload and dpkg controls. Non-directory
replacement of any protected ancestor is rejected even if a subsequent layer
would restore it. This conservative restriction may reject unusual valid
images; it cannot be used to claim such an image matches.

## Bounds and implementation limits

The CLI has a 180-second wall-clock alarm plus checked elapsed-time bounds.
It accepts at most 128 layers, 512 blob files, 200,000 tar headers/merged nodes,
4 GiB of compressed export bytes, and 8 GiB of decompressed layer data. Individual
files are limited to 1 GiB; captured dpkg controls to 16 MiB; JSON inputs to
64 MiB; metadata documents to 4 MiB; extended tar headers to 64 KiB; names to
4,096 UTF-8 bytes; and hardlink resolution to 64 hops. Extension headers count
toward the archive budget before their bodies are consumed. The Linux-only CLI
uses `O_NOFOLLOW` for layer reads and a finite `SIGALRM` deadline. Its tar
subclass checks extension processing before the standard library allocates an
attacker-declared header body; the tests cover that behavior.

This is a regular-file byte and ownership comparison. It does not prove host
kernel safety, sandbox escape resistance, package origin beyond the recorded
manifest evidence, or the absence of unrelated/unowned files. Directory
ownership counts are recorded but directory metadata, file modes and xattrs
are outside the expected byte manifest. It does not decide whether any CVE is
applicable. Those claims require their own reviewed evidence and policy.

## Evidence schema

The JSON has `schemaVersion: 1`, kind `oci-package-payload-comparison`, and state
`MATCH`, `MISMATCH`, or `ERROR`. It contains:

| Field | Evidence |
|---|---|
| `observedAt`, `verifierSourceSha256`, `sourceSha256` | UTC observation time and actual executing verifier/OCI-inspector file hashes |
| `identity` | Build/index/manifest/config digests, platform, ordered layers and compressed byte count |
| `expectedManifest` | Exact manifest digest, expected package, archive digest and regular-file count |
| `scan` | Original report digest, matching ImageID, one literal package projection, installed-file digest/count and unchanged finding counts |
| `packageControl` | Final control/list paths and byte hashes, exact observed fields, owned regular-file and directory counts |
| `payload.files` | Every expected path, result, expected/actual SHA256 and size, and final content layer digest |
| `execution`, `errors` | No-execution/no-extraction flags, elapsed time, bounded read counts and explicit failures |

`scan.installedFilesSha256` and `packageControl.ownedFilesSha256` use SHA256 of
UTF-8 compact JSON containing **sorted canonical absolute regular-file paths**:
`json.dumps(sorted(paths), ensure_ascii=False, separators=(',', ':')).encode()`.
There is no trailing newline in the hashed value. A proposed applicability
evaluator can bind these fields and all individual records to an approved
verifier version; this change does not enable such a decision.
