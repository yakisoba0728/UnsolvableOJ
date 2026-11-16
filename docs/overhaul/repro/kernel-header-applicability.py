#!/usr/bin/env python3
"""Read-only, bounded Linux CNA path inventory. This does not suppress findings."""
import concurrent.futures
import argparse
import datetime
import hashlib
import json
import pathlib
import re
import urllib.request


def read_url(url):
    request = urllib.request.Request(url, headers={"User-Agent": "UnsolvableOJ-applicability-review"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return response.read(2_000_001)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("report", type=pathlib.Path)
parser.add_argument("output", type=pathlib.Path)
parser.add_argument("--resume", type=pathlib.Path, help="Retry UNKNOWN entries from an identical report and pinned CNA commit")
parser.add_argument("--manifest", type=pathlib.Path, help="Optional scanner manifest, which must identify the exact input report")
parser.add_argument("--cve-commit", help="Use an explicit 40-hex CNA snapshot instead of resolving current main")
args = parser.parse_args()
if args.cve_commit:
    assert re.fullmatch(r"[a-f0-9]{40}", args.cve_commit), "CNA snapshot must be an immutable 40-hex commit"
report_path, output_path = args.report, args.output
started_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
raw = report_path.read_bytes()
scan = json.loads(raw)
result = next(item for item in scan["Results"] if any(package["Name"] == "linux-libc-dev" for package in item.get("Packages", [])))
package = next(item for item in result["Packages"] if item["Name"] == "linux-libc-dev")
installed = set(package.get("InstalledFiles", []))
findings = [item for item in result.get("Vulnerabilities", []) if item["PkgName"] == "linux-libc-dev" and item["Severity"] in {"HIGH", "CRITICAL"}]
assert len(findings) <= 250, "This bounded review accepts at most 250 findings"
assert len({item["VulnerabilityID"] for item in findings}) == len(findings)
scan_provenance = None
if args.manifest:
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    assert manifest["rawReportSha256"] == hashlib.sha256(raw).hexdigest()
    assert manifest["image"]["configDigest"] == scan["Metadata"]["ImageID"]
    scan_provenance = {"manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(), "sourceCommit": manifest["sourceCommit"], "ci": manifest["ci"], "image": manifest["image"], "scannerVersion": manifest["scannerPin"]["version"], "databaseSha256": manifest["databaseSha256"], "database": manifest["database"]}
commit_error = None
previous_entries = []
previous_attempts = []
if args.resume:
    previous = json.loads(args.resume.read_text())
    assert previous["inputReportSha256"] == hashlib.sha256(raw).hexdigest(), "Resume report must have identical bytes"
    assert previous["installedFiles"] == sorted(installed), "Resume package inventory must be identical"
    repository_commit = previous["cveRepositoryCommit"]
    assert re.fullmatch(r"[a-f0-9]{40}", repository_commit), "Only an immutable CNA snapshot can be resumed"
    assert args.cve_commit is None or args.cve_commit == repository_commit, "Resume must use the same CNA snapshot"
    identifiers = {finding["VulnerabilityID"] for finding in findings}
    assert len(previous["entries"]) == len(identifiers)
    assert {entry["id"] for entry in previous["entries"]} == identifiers
    previous_entries = [entry for entry in previous["entries"] if entry["reviewStatus"] != "UNKNOWN"]
    assert all(entry["reviewStatus"] in {"CNA_PATHS_NO_EXPORTED_HEADER_MATCH", "HEADER_PATH_MATCH_REQUIRES_REVIEW"} and re.fullmatch(r"[a-f0-9]{64}", entry.get("cnaRecordSha256", "")) for entry in previous_entries)
    previous_attempts = previous.get("collectionAttempts", [{"observedAt": previous["observedAt"], "knownRecords": len(previous_entries), "unknownRecords": len(identifiers) - len(previous_entries)}])
    if scan_provenance is None:
        scan_provenance = previous.get("scanProvenance")
elif args.cve_commit:
    repository_commit = args.cve_commit
else:
    try:
        repository_commit = json.loads(read_url("https://api.github.com/repos/CVEProject/cvelistV5/commits/main"))["sha"]
        assert re.fullmatch(r"[a-f0-9]{40}", repository_commit)
    except Exception as error:
        repository_commit = None
        commit_error = f"{type(error).__name__}: {error}"


def review(finding):
    identifier = finding["VulnerabilityID"]
    match = re.fullmatch(r"CVE-(\d{4})-(\d{4,7})", identifier)
    assert match, "Invalid CVE identifier"
    year, number = match.groups()
    group = number[:-3] + "xxx"
    url = f"https://raw.githubusercontent.com/CVEProject/cvelistV5/{repository_commit}/cves/{year}/{group}/{identifier}.json" if repository_commit else None
    entry = {"id": identifier, "scannerSeverity": finding["Severity"], "scannerSeveritySource": finding.get("SeveritySource"),
             "installedVersion": finding["InstalledVersion"], "fixedVersion": finding.get("FixedVersion"), "cnaUrl": url,
             "reviewStatus": "UNKNOWN", "runtimeHostApplicability": "NOT_INSPECTED"}
    if repository_commit is None:
        entry["error"] = "Immutable CNA snapshot unavailable: " + commit_error
        return entry
    try:
        payload = read_url(url)
        assert len(payload) <= 2_000_000, "CNA record exceeds the bounded response size"
        record = json.loads(payload)
        assert record["cveMetadata"]["cveId"] == identifier
        assert record["cveMetadata"]["state"] == "PUBLISHED"
        cna = record["containers"]["cna"]
        provider = cna["providerMetadata"]["shortName"]
        assert provider == "Linux", f"Unexpected CNA provider: {provider}"
        affected = cna.get("affected", [])
        assert affected and all(item.get("product") == "Linux" for item in affected)
        assert all(isinstance(item.get("programFiles"), list) and item["programFiles"] for item in affected), "An affected range lacks an explicit programFiles array"
        assert all(isinstance(name, str) for item in affected for name in item["programFiles"]), "A programFiles entry is not a path string"
        files = sorted({name for item in affected for name in item["programFiles"]})
        assert all(name and not name.startswith("/") and ".." not in pathlib.PurePosixPath(name).parts and not re.search(r"[\\*?{}\[\]]", name) for name in files), "An affected path is not an exact normalized source path"
        candidates = []
        for name in files:
            # Exported userspace headers are UAPI, not similarly named internal
            # include/linux headers. Only the installed amd64 architecture maps.
            if name.startswith("include/uapi/"):
                candidates.append({"source": name, "installedPath": "/usr/include/" + name.removeprefix("include/uapi/")})
            elif name.startswith("include/generated/uapi/"):
                candidates.append({"source": name, "installedPath": "/usr/include/" + name.removeprefix("include/generated/uapi/")})
            elif name.startswith("arch/x86/include/uapi/asm/") and package.get("Arch") == "amd64":
                relative = name.removeprefix("arch/x86/include/uapi/asm/")
                candidates.extend({"source": name, "installedPath": prefix + relative} for prefix in ["/usr/include/x86_64-linux-gnu/asm/", "/usr/include/asm/"])
        matches = [item for item in candidates if item["installedPath"] in installed]
        entry.update({"cnaProvider": provider, "cnaRecordSha256": hashlib.sha256(payload).hexdigest(),
                      "cnaDateUpdated": record["cveMetadata"].get("dateUpdated"), "programFiles": files,
                      "uapiSourcePaths": [name for name in files if "/uapi/" in name],
                      "exportedHeaderCandidates": candidates, "exportedHeaderMatches": matches,
                      "implementationAreas": sorted({name.split("/", 1)[0] for name in files}),
                      "reviewStatus": "HEADER_PATH_MATCH_REQUIRES_REVIEW" if matches else "CNA_PATHS_NO_EXPORTED_HEADER_MATCH"})
    except Exception as error:
        entry["error"] = f"{type(error).__name__}: {error}"
    return entry


entries = previous_entries.copy()
known_identifiers = {entry["id"] for entry in previous_entries}
pending_findings = [finding for finding in findings if finding["VulnerabilityID"] not in known_identifiers]
pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
futures = {pool.submit(review, item): item for item in pending_findings}
try:
    for future in concurrent.futures.as_completed(futures, timeout=180):
        entries.append(future.result())
except TimeoutError:
    completed = {entry["id"] for entry in entries}
    for future, finding in futures.items():
        if finding["VulnerabilityID"] not in completed:
            future.cancel()
            entries.append({"id": finding["VulnerabilityID"], "scannerSeverity": finding["Severity"],
                            "reviewStatus": "UNKNOWN", "error": "180-second collection deadline", "runtimeHostApplicability": "NOT_INSPECTED"})
finally:
    pool.shutdown(wait=True, cancel_futures=True)

observed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
entries_by_id = {entry["id"]: entry for entry in entries}
assert len(entries_by_id) == len(findings)
entries = []
for index, finding in enumerate(findings):
    entry = entries_by_id[finding["VulnerabilityID"]]
    entry.update({"inputIndex": index, "scannerTitle": finding.get("Title"), "scannerPrimaryUrl": finding.get("PrimaryURL")})
    entries.append(entry)
output = {"schemaVersion": 1, "observedAt": observed_at,
          "scope": "Machine-readable Linux CNA affected-file comparison only; not a VEX, suppression, host assessment or proof of exploitability",
          "inputReportSha256": hashlib.sha256(raw).hexdigest(), "imageId": scan.get("Metadata", {}).get("ImageID"),
          "scanProvenance": scan_provenance,
          "cveRepositoryCommit": repository_commit, "cveRepositoryCommitError": commit_error,
          "collectionAttempts": previous_attempts + [{"startedAt": started_at, "observedAt": observed_at, "requestedRecords": len(pending_findings), "knownRecords": sum(entry["reviewStatus"] != "UNKNOWN" for entry in entries), "unknownRecords": sum(entry["reviewStatus"] == "UNKNOWN" for entry in entries), "deadlineSeconds": 180, "maxParallelRequests": 4}],
          "package": {key: package.get(key) for key in ["Name", "Version", "Release", "SrcName", "SrcVersion", "SrcRelease", "Arch", "Identifier", "Layer"]},
          "installedFiles": sorted(installed), "kernelImageOrModulePackages": [item["Name"] for item in result["Packages"] if re.match(r"linux-(?:image|modules)(?:-|$)", item["Name"])],
          "entries": entries}
output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps({"output": str(output_path), "repositoryCommit": repository_commit,
                  "counts": {status: sum(entry["reviewStatus"] == status for entry in entries) for status in sorted({entry["reviewStatus"] for entry in entries})},
                  "critical": [entry for entry in output["entries"] if entry["scannerSeverity"] == "CRITICAL"]}, indent=2))
