"""Scan a locally built OCI image; never pull/run/push the application image.

Exit 0: scan completed without HIGH/CRITICAL package findings or unsupported OS.
Exit 2: scan completed, but findings block the gate and require explicit triage.
Exit 1: execution, freshness, identity, or report validation failed.
All severities remain in the raw report; license metadata is a separate inventory.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
import time


PIN = json.loads(Path(__file__).with_name("image-audit-tool.json").read_text())
SEVERITIES = ("UNKNOWN", "LOW", "MEDIUM", "HIGH", "CRITICAL")
INDEX_TYPES = {"application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"}
OS_FAMILIES = {"alpine", "ubuntu"}


def object_value(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"Expected an object for {label}")
    return value


def object_records(value, label):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ValueError(f"Expected an array of objects for {label}")
    return value


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def inspect_oci(directory, build_digest):
    """Verify manifest/config/layer bytes and identify exactly one linux/amd64 image."""
    directory = Path(directory)
    if object_value(json.loads((directory / "oci-layout").read_text()), "OCI layout").get("imageLayoutVersion") != "1.0.0":
        raise ValueError("Unsupported OCI layout")
    index = object_value(json.loads((directory / "index.json").read_text()), "OCI index")
    root_digest = "sha256:" + sha256(directory / "index.json")
    verified = {root_digest}
    candidates = []

    def blob(descriptor, parse=False):
        object_value(descriptor, "OCI descriptor")
        digest = descriptor.get("digest", "")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise ValueError("Invalid OCI descriptor digest")
        path = directory / "blobs" / "sha256" / digest[7:]
        if path.is_symlink() or not path.is_file() or path.stat().st_size != descriptor.get("size"):
            raise ValueError("Missing or invalid OCI blob")
        if digest not in verified:
            if sha256(path) != digest[7:]:
                raise ValueError("OCI blob checksum mismatch")
            verified.add(digest)
        if parse:
            if path.stat().st_size > 4 * 1024 * 1024:
                raise ValueError("Oversized OCI metadata")
            return object_value(json.loads(path.read_text()), "OCI metadata")

    def visit(descriptor, ancestors, depth=0):
        if depth > 4:
            raise ValueError("Excessive OCI index depth")
        document = blob(descriptor, True)
        lineage = ancestors + [descriptor["digest"]]
        if descriptor.get("mediaType") in INDEX_TYPES:
            for child in object_records(document.get("manifests"), "OCI manifests"):
                visit(child, lineage, depth + 1)
            return
        config = blob(document["config"], True)
        # BuildKit provenance may add an unknown/unknown attestation image.
        if (config.get("os"), config.get("architecture")) != ("linux", "amd64"):
            return
        for layer in object_records(document["layers"], "OCI layers"):
            blob(layer)
        candidates.append({
            "manifestDigest": descriptor["digest"], "configDigest": document["config"]["digest"],
            "indexDigest": root_digest, "buildDigest": build_digest,
            "platform": "linux/amd64", "layerDigests": [item["digest"] for item in document["layers"]],
            "compressedLayerBytes": sum(item["size"] for item in document["layers"]), "lineage": lineage,
        })

    for descriptor in object_records(index.get("manifests"), "OCI manifests"):
        visit(descriptor, [root_digest])
    if len(candidates) != 1:
        raise ValueError("Expected exactly one linux/amd64 image in the OCI export")
    result = candidates[0]
    if build_digest not in result.pop("lineage"):
        raise ValueError("BuildKit digest does not match the scanned OCI export")
    return result


def checked_command(arguments, log, *, timeout=660, env=None):
    with Path(log).open("wb") as output:
        subprocess.run([str(argument) for argument in arguments], check=True, timeout=timeout,
                       stdout=output, stderr=subprocess.STDOUT, env=env)


def install_scanner(directory, report):
    archive = directory / "trivy.tar.gz"
    checked_command([
        "curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
        "--connect-timeout", "10", "--max-time", "180", PIN["archiveUrl"], "--output", archive,
    ], report / "scanner-download.log", timeout=200)
    if sha256(archive) != PIN["archiveSha256"]:
        raise ValueError("Scanner archive checksum differs from the reviewed upstream pin")
    executable = directory / "trivy"
    with tarfile.open(archive) as package:
        member = package.getmember("trivy")
        if not member.isfile() or member.size > 512 * 1024 * 1024:
            raise ValueError("Invalid scanner executable entry")
        with package.extractfile(member) as source, executable.open("wb") as destination:
            shutil.copyfileobj(source, destination)
    executable.chmod(0o700)
    return executable


def validate_database(version, now=None, *, field="VulnerabilityDB", max_age_hours=48):
    now = now or datetime.now(timezone.utc)
    object_value(version, "scanner version")
    if version.get("Version") != PIN["version"]:
        raise ValueError("Unexpected scanner version")
    database = object_value(version.get(field, {}), "database metadata")
    if type(database.get("Version")) is not int or database["Version"] < 1:
        raise ValueError("Missing vulnerability database schema version")
    for timestamp_field in ("UpdatedAt", "DownloadedAt", "NextUpdate"):
        timestamp = database.get(timestamp_field)
        if not isinstance(timestamp, str):
            raise ValueError("Missing vulnerability database timestamp")
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.year < 2020:
            raise ValueError("Missing vulnerability database timestamp")
        if timestamp_field == "UpdatedAt" and not -600 <= (now - parsed).total_seconds() <= max_age_hours * 3600:
            raise ValueError("Vulnerability database is stale or unexpectedly future dated")
    return database


def summarize(scan, identity):
    object_value(scan, "scanner report")
    if scan.get("SchemaVersion") != 2 or scan.get("ArtifactType") != "container_image":
        raise ValueError("Expected Trivy v2 container-image report")
    metadata = object_value(scan.get("Metadata", {}), "image metadata")
    if metadata.get("ImageID") != identity["configDigest"]:
        raise ValueError("Scanner did not report the verified image config digest")
    operating_system = object_value(metadata.get("OS", {}), "operating system")
    if operating_system.get("Family") not in OS_FAMILIES or not operating_system.get("Name"):
        raise ValueError("Scanner did not identify a supported image operating system")
    results = scan.get("Results")
    if not isinstance(results, list):
        raise ValueError("Scanner returned no results array")
    packages, library_packages, vulnerabilities, licenses, inventory = [], [], [], [], []
    for result in object_records(results, "scan results"):
        if result.get("Class") in {"os-pkgs", "lang-pkgs"}:
            found = object_records(result.get("Packages"), "installed packages")
            (packages if result["Class"] == "os-pkgs" else library_packages).extend(found)
            context = {key: result.get(key) for key in ("Target", "Class", "Type")}
            inventory.append({**context, "packages": len(found), "packagesWithoutVersion": sum(not item.get("Version") for item in found)})
            vulnerabilities.extend({**item, **context} for item in object_records(result.get("Vulnerabilities"), "vulnerabilities"))
        elif result.get("Vulnerabilities"):
            raise ValueError("Unexpected vulnerability result class")
        if result.get("ExperimentalModifiedFindings"):
            raise ValueError("Suppressed or modified findings require explicit review")
        licenses.extend(object_records(result.get("Licenses"), "license metadata"))
    if not packages:
        raise ValueError("Missing installed OS package inventory; zero findings cannot mean zero coverage")
    if any(not item.get("Name") or not item.get("Version") for item in packages):
        raise ValueError("Installed OS package inventory lacks names or versions")
    if any(not item.get("Name") for item in library_packages):
        raise ValueError("Installed library inventory lacks package names")
    counts = Counter({severity: 0 for severity in SEVERITIES})
    blocking = []
    for finding in vulnerabilities:
        severity = finding.get("Severity", "UNKNOWN")
        if severity not in SEVERITIES or not finding.get("VulnerabilityID") or not finding.get("PkgName"):
            raise ValueError("Invalid vulnerability record")
        counts[severity] += 1
        if severity in {"HIGH", "CRITICAL"}:
            blocking.append({key: finding.get(key) for key in (
                "VulnerabilityID", "PkgName", "InstalledVersion", "FixedVersion", "Severity", "Status", "PrimaryURL",
                "Target", "Class", "Type",
            )})
    return {
        "operatingSystem": operating_system, "installedOsPackages": len(packages),
        "installedLibraryPackages": len(library_packages), "inventoryByTarget": inventory,
        "libraryPackagesWithoutVersion": sum(not item.get("Version") for item in library_packages),
        "vulnerabilitiesBySeverity": dict(counts), "blockingVulnerabilities": blocking,
        "requiresFindingTriage": bool(vulnerabilities),
        "licenseMetadata": {
            "records": len(licenses), "classificationCounts": dict(Counter(item.get("Category", "UNKNOWN") for item in licenses)),
            "packagesWithoutDeclaredLicense": sum(not item.get("Licenses") for item in packages + library_packages),
            "interpretation": "Reported package metadata; no repository license grant or legal approval.",
        },
        "gate": "BLOCKED_FINDINGS" if blocking or operating_system.get("EOSL") else "PASS",
    }


def validate_library_coverage(component, scan):
    """Detect accidental loss of the expected installed application/runtime analyzers."""
    required = {"back": "@nestjs/core", "judge": "bullmq", "runtime": "esbuild"}.get(component)
    libraries = [result for result in scan["Results"] if result.get("Class") == "lang-pkgs"]
    npm_names = {item["Name"] for result in libraries if result.get("Type") == "node-pkg" for item in result.get("Packages", [])}
    if required and required not in npm_names:
        raise ValueError(f"Installed npm coverage did not identify expected package: {required}")
    go_runtime = [result for result in libraries if result.get("Type") == "gobinary" and result.get("Target", "").lstrip("/") == "opt/go-judge"]
    if component == "runtime" and not any(item.get("Name") == "stdlib" and item.get("Version") for result in go_runtime for item in result.get("Packages", [])):
        raise ValueError("Runtime coverage did not identify /opt/go-judge and its Go stdlib version")
    return {"requiredInstalledNpmPackage": required, "goJudgeWithStdlibRequired": component == "runtime", "status": "VERIFIED"}


def scan_image(component, directory, report, build_digest):
    report = Path(report)
    report.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    manifest = {
        "schemaVersion": 1, "component": component, "execution": "RUNNING", "stage": "image-identity",
        "startedAt": datetime.now(timezone.utc).isoformat(), "scannerPin": PIN,
        "scope": "Installed image OS packages and supported language/runtime libraries, including installed npm and embedded Go modules/stdlib; standard package license metadata. Not complete lockfile/bundled-JavaScript/arbitrary-binary coverage or legal approval.",
        "policy": "All severities reported; HIGH/CRITICAL OS and library vulnerabilities and EOSL block. No ignores, unfixed suppression, or automatic risk acceptance. Other findings and unknown versions still require explicit triage.",
        "ci": {key: os.environ.get(key) for key in ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")},
    }
    exit_code = 1
    try:
        manifest["sourceCommit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        manifest["workingTreeDirty"] = bool(subprocess.check_output(["git", "status", "--porcelain"], text=True).strip())
        manifest["sourceSha256"] = {
            "scannerScript": sha256(__file__), "scannerPin": sha256(Path(__file__).with_name("image-audit-tool.json")),
        }
        manifest["image"] = inspect_oci(directory, build_digest)
        with tempfile.TemporaryDirectory(prefix="oj-image-scan-") as temporary:
            work = Path(temporary)
            manifest["stage"] = "scanner-install"
            scanner = install_scanner(work, report)
            manifest["scannerExecutableSha256"] = sha256(scanner)
            # Explicit flags plus no inherited Trivy settings prevent accidental ignore/config reuse.
            env = {key: value for key, value in os.environ.items() if not key.startswith("TRIVY_")}
            cache = work / "cache"
            common = [scanner, "--cache-dir", cache, "--config", ""]
            manifest["stage"] = "database-download"
            checked_command(common + ["image", "--download-db-only", "--db-repository", PIN["databaseRepository"],
                                      "--disable-telemetry", "--skip-version-check", "--timeout", "4m"],
                            report / "database-download.log", timeout=260, env=env)
            checked_command(common + ["version", "--format", "json"], report / "scanner-version.json", timeout=30, env=env)
            manifest["database"] = validate_database(json.loads((report / "scanner-version.json").read_text()))
            manifest["databaseSha256"] = sha256(cache / "db" / "trivy.db")
            manifest["stage"] = "image-scan"
            checked_command(common + [
                "image", "--input", Path(directory).resolve(), "--scanners", "vuln,license", "--pkg-types", "os,library",
                "--format", "json", "--output", (report / "trivy.json").resolve(), "--list-all-pkgs",
                "--severity", ",".join(SEVERITIES), "--ignorefile", "", "--ignore-unfixed=false",
                "--java-db-repository", PIN["javaDatabaseRepository"],
                "--offline-scan", "--disable-telemetry", "--skip-version-check", "--skip-db-update",
                "--exit-code", "0", "--timeout", "10m",
            ], report / "scan.log", env=env)
            manifest["stage"] = "report-validation"
            scan = json.loads((report / "trivy.json").read_text())
            manifest["summary"] = summarize(scan, manifest["image"])
            manifest["libraryCoverage"] = validate_library_coverage(component, scan)
            checked_command(common + ["version", "--format", "json"], report / "scanner-version-after.json", timeout=30, env=env)
            after = json.loads((report / "scanner-version-after.json").read_text())
            validate_database(after)
            if after.get("JavaDB"):
                manifest["javaDatabase"] = validate_database(after, field="JavaDB", max_age_hours=7 * 24)
                manifest["javaDatabaseSha256"] = sha256(cache / "java-db" / "trivy-java.db")
            elif any(result.get("Type") == "jar" for result in scan["Results"]):
                raise ValueError("Java archive results have no recorded Java index database")
            else:
                manifest["javaDatabase"] = {"status": "NOT_DOWNLOADED", "interpretation": "Scanner did not request the Java index; no Java archive coverage is claimed."}
            if sha256(cache / "db" / "trivy.db") != manifest["databaseSha256"]:
                raise ValueError("Vulnerability database changed during scan")
            manifest["rawReportSha256"] = sha256(report / "trivy.json")
            manifest["execution"] = "COMPLETED"
            exit_code = 0 if manifest["summary"]["gate"] == "PASS" else 2
    except Exception as error:
        # Any failure is non-success; retain evidence even for an unexpected tool/schema change.
        manifest["execution"] = "FAILED"
        manifest["error"] = f"{type(error).__name__}: {error}"
    finally:
        manifest["finishedAt"] = datetime.now(timezone.utc).isoformat()
        manifest["elapsedSeconds"] = round(time.monotonic() - started, 3)
        write_json(report / "manifest.json", manifest)
        print(json.dumps({"component": component, "execution": manifest["execution"],
                          "stage": manifest["stage"], "summary": manifest.get("summary"),
                          "error": manifest.get("error")}, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=("back", "front", "judge", "runtime"))
    parser.add_argument("oci_directory", type=Path)
    parser.add_argument("report_directory", type=Path)
    parser.add_argument("build_digest")
    args = parser.parse_args()
    raise SystemExit(scan_image(args.component, args.oci_directory, args.report_directory, args.build_digest))
