# Runtime kernel-header findings: independent applicability review

Status: **static evidence collected; proposed component classification awaits independent review.**
The scanner gate, severity values, installed headers and original reports are unchanged.
This document does not certify the execution host or declare an image scan successful.

## Exact input and scope

The input is the completed runtime scan in Actions
[43796045174](https://github.com/yakisoba0728/UnsolvableOJ/actions/runs/43796045174),
whose manifest reports source revision `c167a1e17e7b915fc313c52357e7505f8cf56b6f`.
The complete original artifact is retained with the image remediation evidence;
this review retains the following independent identities:

| Identity | Value |
|---|---|
| Raw Trivy report SHA-256 | `406d2627e4b48c8d248552e1f9d1d7daf8d8dd8c09d9cd33125fd1f9167a8926` |
| OCI image manifest | `sha256:5c441685db9ee2b1af03cbf01d5c1aca2c0729fe522f42fb04934823c91bb303` |
| Image config / reported ImageID | `sha256:00b0bf5c0eb5e5eab8bee4a458985d1f8b81ec2c298156eb0c1843ee14e8bf85` |
| Platform | Ubuntu 24.04, linux/amd64 |
| Installed component | `linux-libc-dev` `6.8.0-149.149` |
| CNA snapshot | CVEProject/cvelistV5 `050afa4f401f53a4001e1bc7268f74e952418f8e` |

The raw report contains **177 HIGH and 5 CRITICAL findings** for this component,
all without a fixed version. It additionally contains 453 MEDIUM and 341 LOW
findings for that package; those are outside this bounded classification.
Severity is preserved from the scanner's Ubuntu source. A differing upstream
CVSS score does not silently change the scanner policy.

Trivy records `Version=6.8.0`, `Release=149.149`, `SrcName=linux`,
`SrcVersion=6.8.0`, and `SrcRelease=149.149`. These are separate fields, not
evidence that the Ubuntu revision was discarded. The official binary package's
control fields are `Version: 6.8.0-149.149`, `Source: linux`, and
`Architecture: amd64`. No scanner-matching defect is asserted.

## What is actually installed

The report's complete package-owned inventory contains **990 regular file
paths: 988 `.h` files below `/usr/include` and two documentation files**. The
documentation paths are `changelog.Debian.gz` and `copyright` below
`/usr/share/doc/linux-libc-dev`. There are no package-owned kernel executables,
loadable modules, `/boot` paths, or `/lib/modules` paths. The report contains no
other installed `linux-*` package and no `linux-image`/`linux-modules` package.

The exact-version [Ubuntu package archive](https://archive.ubuntu.com/ubuntu/pool/main/l/linux/linux-libc-dev_6.8.0-149.149_amd64.deb)
was independently downloaded and read without installation or execution. Its
1,698,546 bytes hash to
`e4b7b9c5023ba727908868661e1113d28ed9b68e47aed00e314723dad4b2b31d`.
All 990 regular file paths exactly match the scan's inventory. The evidence
also records SHA-256 for each file in that official package. Retrieval used
Ubuntu's HTTPS archive; a separate archive-repository signature verification
was not performed.

This distinction matters: Ubuntu describes
[linux-libc-dev](https://packages.ubuntu.com/noble/linux-libc-dev) as development
headers. Linux's [header export documentation](https://www.kernel.org/doc/html/latest/kbuild/headers_install.html)
explains that exported headers describe userspace's interface to kernel
services. A source-package advisory for `linux` can concern implementation
that is absent from this particular binary package.

The file list is package metadata from the actual image scan. The downloaded
package provides independent content evidence, **not a forensic hash of the
image's actual file payloads**. This limitation is retained for a later
reviewed applicability decision.

## Method and complete coverage of the 182 selected records

The read-only [collector](repro/kernel-header-applicability.py) fetches Linux
CNA records from one immutable CVEProject revision. It checks the CVE identifier,
published state, Linux CNA/provider and product, and explicit exact
`affected.programFiles` arrays in every affected entry. It retains each record's
URL, SHA-256 and update timestamp. Missing records, incomplete path metadata,
wildcards, or network errors remain `UNKNOWN`; none is treated as a pass.

Only actual UAPI export paths are mapped to installed userspace headers.
`include/linux/...` and `net/.../*.h` are internal kernel files; a similar
basename does not make them `/usr/include/linux/...`. The mapping includes
generic/generated UAPI and amd64's architecture UAPI directory.

The first bounded collection completed 116 records and left 66 at its
180-second deadline. A second invocation resumed only those 66, against the
same raw report and immutable CNA revision. All **182 records now have explicit
affected-file evidence, with zero missing/invalid records**. The history is
retained, rather than presenting the first incomplete attempt as complete.

| Evidence class | CRITICAL | HIGH | Result |
|---|---:|---:|---|
| CNA paths entirely outside exported userspace headers | 5 | 176 | Listed vulnerable implementation is absent from the package inventory |
| CNA includes an installed exported-header path | 0 | 1 | CVE-2026-80668; individually inspected below |
| Missing, invalid or unfetched CNA records after resume | 0 | 0 | None |

The five Critical fixes and the one overlapping High fix were manually reviewed
at patch level. The other 176 High entries were individually matched by their
authoritative affected-file metadata; this is not a claim to have read all
176 complete patches or validated their runtime exploitability.

## Five Critical findings

For each row, the complete stable fix diff was read and its changed file set
matched the CNA record. All changed paths are outside the exported header
package. Patch URLs and exact content hashes are retained in the review JSON.

| CVE | Actual affected source | Observed fix and component conclusion |
|---|---|---|
| [CVE-2026-63825](https://ubuntu.com/security/CVE-2026-63825) | Kernel `Makefile` | Changes kernel GCOV compilation flags for safe concurrent counter updates. The header package contains no kernel build file or instrumented kernel binary. |
| [CVE-2026-64523](https://ubuntu.com/security/CVE-2026-64523) | `net/handshake/handshake.h`, `netlink.c`, `request.c` | Retains the socket file reference across kernel handshake completion/cancellation. Installed `/usr/include/linux/handshake.h` is a different UAPI file, not that internal structure or execution code. |
| [CVE-2026-68426](https://ubuntu.com/security/CVE-2026-68426) | `net/xfrm/xfrm_device.c` | Repairs the retained packet-segment list after asynchronous crypto. Installed `linux/xfrm.h` contains the userspace interface, not this kernel packet-processing implementation. |
| [CVE-2026-90162](https://ubuntu.com/security/CVE-2026-90162) | `fs/smb/server/smb2pdu.c` | Changes when the kernel SMB server publishes a batch of granted locks. That server code is not shipped in the header package. |
| [CVE-2026-93221](https://ubuntu.com/security/CVE-2026-93221) | `fs/nfsd/netns.h`, `nfs4proc.c`, `nfs4recover.c`, `nfs4state.c`, `nfsctl.c`, `nfssvc.c` | Uses atomic flag transitions in the kernel NFS server. Installed NFS UAPI headers do not contain these internal objects or grace-period implementation. |

The supported static conclusion is limited to **absence of these vulnerable
implementations from this binary header component**. For the running kernel,
GCOV configuration, handshake consumers, IPsec/offload setup, ksmbd, and nfsd
configuration remain uninspected. The Noble `linux` entries for all five still
reported work in progress for `6.8.0-151.151` when checked on 2026-11-16; that
planned version is not an available fixed-package claim.

## The UAPI overlap: CVE-2026-80668

Its CNA lists `include/uapi/linux/netfilter/nf_conntrack_common.h`, which maps
to an installed file. That overlap was kept visible and manually investigated;
it was not classified by the package name alone.

Both the complete [upstream fix](https://github.com/torvalds/linux/commit/b8b09dc2bf35a00d4e0556b5d6308c7b917ebda2)
and [stable backport](https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/patch/?id=61ca26e1a45965590f7e477c4d6f711162642e1c)
were read. The only change to the UAPI source file is a single
`NF_CT_EXPECT_DEAD` flag definition inside `#ifdef __KERNEL__`. The vulnerable
timer/reference handling and its replacement garbage collection are in
`net/netfilter/*.c` and the internal
`include/net/netfilter/nf_conntrack_expect.h`.

The same immutable upstream revision's
[headers_install.sh](https://raw.githubusercontent.com/torvalds/linux/b8b09dc2bf35a00d4e0556b5d6308c7b917ebda2/scripts/headers_install.sh)
explicitly exports with `unifdef -U__KERNEL__ -D__EXPORTED_HEADERS__`, removing
that kernel-only block. Inspection of the exact official Ubuntu package found
the exported header contains declarations and flags, with neither that block
nor the affected timer, master-pointer, or GC implementation. Its SHA-256 is
`f96c03a170825a42f0a417efe70d77f05dd4265d7855eb05ba8024a58cc938f8`.

Thus the source-path overlap is supporting kernel-only metadata rather than
shipped vulnerable execution logic in the official userspace header payload.
Before binding this conclusion to a gate decision for a built image, independently
compare the actual image file bytes with the recorded official-package evidence.
The [Ubuntu advisory](https://ubuntu.com/security/CVE-2026-80668) still applies to
affected running kernels; editing the header cannot patch a running kernel.

## Proposed disposition and remaining proof gaps

The evidence supports an **exact-CVE, exact-component proposal** that the 182
listed kernel implementations are not shipped in the reviewed header package.
For 181 cases, that conclusion follows from explicit CNA affected paths and
the complete file inventory. For the overlapping case it additionally relies
on the reviewed patch, export preprocessing, and exact-version official package
payload; actual image payload confirmation remains outstanding.

No generic exclusion of `linux-libc-dev`, automatic exemption for future CVEs,
severity downgrade, risk acceptance, VEX assertion, or scanner-output editing
is introduced. Every raw finding is retained. A different version, new CVE,
unknown path mapping, changed file inventory, or missing proof requires review.

The execution-host boundary remains separate. Docker containers
[share the host or VM kernel](https://docs.docker.com/get-started/docker-concepts/the-basics/what-is-a-container/).
The repository's [architecture](ARCHITECTURE.md) and [security record](SECURITY.md)
already identify the privileged execution service as insufficient by itself
to isolate the host. No host kernel version, patches, loaded modules, feature
configuration, or exploit reachability was established here. No production
host was accessed, and no kernel attack or escape experiment was performed.

An independently reviewed artifact classification can resolve a source-package
association without resolving deployment-host readiness. The latter stays
**unverified** until the intended dedicated execution environment is assessed.

## Reproduction and retained evidence

- [Per-CVE CNA/path inventory](evidence/phase2-kernel-header-applicability.json): all 182 original IDs in scanner order, raw and image hashes, scanner/database provenance, immutable CNA URLs/hashes, source paths, matches, and collection attempts.
- [Manual review and package payload evidence](evidence/phase2-kernel-header-review.json): exact package control fields, five Critical patch identities, the overlapping-header analysis, and a pending-review proposal for every original finding.
- [Official package file manifest](evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json): all 990 regular file paths, byte sizes and SHA-256 digests for a separate OCI payload verifier. Directory records are omitted; the official package contains no symbolic links, hard links, or special files. The manifest makes no vulnerability acceptance decision.

Run the collector against the retained original artifact's `trivy.json` and
`manifest.json`. It performs at most four concurrent public requests and uses a
180-second collection deadline per invocation:

```sh
python3 docs/overhaul/repro/kernel-header-applicability.py \
  /path/to/runtime/trivy.json /path/to/result.json \
  --cve-commit 050afa4f401f53a4001e1bc7268f74e952418f8e \
  --manifest /path/to/runtime/manifest.json
python3 docs/overhaul/repro/kernel-header-applicability.py \
  /path/to/runtime/trivy.json /path/to/result.json \
  --resume /path/to/result.json --manifest /path/to/runtime/manifest.json
```

The package was inspected with `dpkg-deb -f` and `dpkg-deb --fsys-tarfile`;
the archive was read in memory without extracting paths or running maintainer
scripts. Read the cited immutable patches to reproduce the manual distinction.
This is static artifact review, not a runtime security test or an assertion
that all dependency, image, or host vulnerabilities have been evaluated.
