"""Evaluate an explicitly reviewed, exact image-component applicability policy.

This evaluator does not edit a Trivy report or call a scanner with suppression
flags. A PROPOSED policy cannot authorize a pass; exact content requires an
independent review and coordinator record before it may be used. A reviewed
code-not-present decision is distinct from a patched dependency, zero
vulnerabilities, or a safe host.

Exit 0: reviewed evidence leaves no blocking HIGH/CRITICAL findings or EOSL.
Exit 2: findings, missing independent approval, or policy expiry still block.
Exit 1: malformed, missing, mismatched, or stale artifact evidence.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import zipfile

import image_audit


ROOT = Path(__file__).resolve().parent.parent
POLICY_PATH = ROOT / "scripts/image-applicability-policy.json"
HIGH = {"HIGH", "CRITICAL"}
MAX_JSON_BYTES = 64 * 1024 * 1024
HASH_PATTERN = re.compile(r"[a-f0-9]{64}")
DIGEST_PATTERN = re.compile(r"sha256:[a-f0-9]{64}")
CVE_PATTERN = re.compile(r"CVE-\d{4}-\d{4,7}")
FINGERPRINT_SCHEMA = "all-advisory-fields-except-verified-Fingerprint-Layer-PkgIdentifier.UID/v1"
PACKAGE_NAME = "linux-libc-dev"
PACKAGE_ID = "linux-libc-dev@6.8.0-149.149"
PURL = "pkg:deb/ubuntu/linux-libc-dev@6.8.0-149.149?arch=amd64&distro=ubuntu-24.04"
EXPECTED_PACKAGE = {
    "ID": PACKAGE_ID, "Name": PACKAGE_NAME, "Version": "6.8.0", "Release": "149.149",
    "SrcName": "linux", "SrcVersion": "6.8.0", "SrcRelease": "149.149",
    "Arch": "amd64", "AnalyzedBy": "dpkg", "Repository": {"Class": "official"},
}
EXPECTED_CONTROL = {
    "name": PACKAGE_NAME, "version": "6.8.0-149.149", "architecture": "amd64",
    "sourceField": "linux", "status": "install ok installed",
}
EXPECTED_MANIFEST_PACKAGE = {key: value for key, value in EXPECTED_CONTROL.items() if key != "status"}
# Exact literal projection emitted by the separately reviewed payload verifier.
# Repository remains required on the raw package above, but is not emitted in
# this verifier projection. Epoch fields are absent for this precise package.
PAYLOAD_PACKAGE_KEYS = ("ID", "Name", "Version", "Release", "Epoch", "Arch", "SrcName", "SrcVersion",
                        "SrcRelease", "SrcEpoch", "Identifier", "Layer", "AnalyzedBy")
IMAGE_KEYS = {
    "manifestDigest", "configDigest", "indexDigest", "buildDigest", "platform",
    "layerDigests", "compressedLayerBytes",
}


class EvidenceError(ValueError):
    """A fail-closed evidence error, without echoing report contents."""


def require(condition, code):
    if not condition:
        raise EvidenceError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def paths_digest(paths):
    return digest(json.dumps(sorted(paths), ensure_ascii=False, separators=(",", ":")).encode())


def object_value(value, code):
    require(isinstance(value, dict), code)
    return value


def array(value, code):
    require(isinstance(value, list), code)
    return value


def hash_value(value, code):
    require(isinstance(value, str) and HASH_PATTERN.fullmatch(value), code)
    return value


def bounded_integer(value, minimum, maximum, code):
    require(type(value) is int and minimum <= value <= maximum, code)
    return value


def unique_objects(items, key, code):
    array(items, code)
    result = {}
    for item in items:
        object_value(item, code)
        identifier = item.get(key)
        require(isinstance(identifier, str) and identifier not in result, code)
        result[identifier] = item
    return result


def timestamp(value, code):
    try:
        require(isinstance(value, str), code)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None and parsed.utcoffset().total_seconds() == 0, code)
        return parsed
    except (ValueError, AttributeError, TypeError) as error:
        raise EvidenceError(code) from error


def fresh_timestamp(value, now, code):
    parsed = timestamp(value, code)
    require(-600 <= (now - parsed).total_seconds() <= 24 * 3600, code)
    return parsed


def read_bytes(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "INPUT_FILE_UNAVAILABLE")
    require(path.stat().st_size <= MAX_JSON_BYTES, "INPUT_FILE_TOO_LARGE")
    data = path.read_bytes()
    require(len(data) <= MAX_JSON_BYTES, "INPUT_FILE_TOO_LARGE")
    return data


def decode(data):
    require(isinstance(data, bytes) and len(data) <= MAX_JSON_BYTES, "INVALID_JSON_INPUT")

    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result

    def invalid_constant(_):
        raise EvidenceError("NONFINITE_JSON_VALUE")

    try:
        return object_value(json.loads(data, object_pairs_hook=pairs, parse_constant=invalid_constant), "JSON_ROOT_NOT_OBJECT")
    except (ValueError, UnicodeError) as error:
        if isinstance(error, EvidenceError):
            raise
        raise EvidenceError("INVALID_JSON") from error


def bound_file(binding, root):
    object_value(binding, "INVALID_FILE_BINDING")
    require(set(binding) == {"path", "sha256"}, "INVALID_FILE_BINDING")
    relative = PurePosixPath(binding["path"])
    require(not relative.is_absolute() and ".." not in relative.parts, "EVIDENCE_PATH_OUTSIDE_REPOSITORY")
    path = Path(root) / relative
    require(path.resolve().is_relative_to(Path(root).resolve()), "EVIDENCE_PATH_OUTSIDE_REPOSITORY")
    require(digest(read_bytes(path)) == hash_value(binding["sha256"], "INVALID_BOUND_HASH"), "BOUND_FILE_HASH_MISMATCH")
    return path


def advisory_fingerprint(finding):
    """Hash every raw advisory field; only separately checked artifact data varies."""
    value = deepcopy(object_value(finding, "INVALID_FINDING"))
    value.pop("Layer", None)
    # This is not ignored: every original/current raw Fingerprint must first
    # reproduce the pinned scanner's image-derived identity calculation.
    value.pop("Fingerprint", None)
    identifier = object_value(value.get("PkgIdentifier"), "MISSING_FINDING_PACKAGE_IDENTIFIER")
    identifier.pop("UID", None)
    return digest(canonical(value))


def scanner_fingerprint(scan, result, finding):
    parts = [scan.get("ArtifactID"), result.get("Target"), finding.get("PkgID"), finding.get("VulnerabilityID")]
    require(all(isinstance(part, str) and part for part in parts), "MISSING_DERIVED_FINGERPRINT_INPUT")
    return "sha256:" + digest(":".join(parts).encode())


def validate_local_image_reference(scan, config_digest):
    metadata = object_value(scan.get("Metadata"), "MISSING_SCAN_IMAGE_METADATA")
    require(scan.get("ArtifactType") == "container_image" and scan.get("ArtifactID") == config_digest
            and metadata.get("ImageID") == config_digest, "ARTIFACT_ID_NOT_BOUND_TO_OCI_CONFIG")
    require(metadata.get("RepoTags") in (None, []) and metadata.get("RepoDigests") in (None, [])
            and metadata.get("Reference") in (None, ""), "UNREVIEWED_IMAGE_REFERENCE_MODE")


def policy_content_hash(policy):
    content = deepcopy(policy)
    content.pop("review", None)
    return digest(canonical(content))


def validate_review(policy, now):
    review = object_value(policy.get("review"), "MISSING_POLICY_REVIEW")
    state = review.get("state")
    require(state in {"PROPOSED", "REVIEWED"}, "UNKNOWN_POLICY_REVIEW_STATE")
    if state == "PROPOSED":
        require(review.get("reviews") == [] and review.get("contentSha256") is None
                and review.get("reviewedAt") is None, "PROPOSED_POLICY_HAS_APPROVAL_METADATA")
        return False
    require(review.get("contentSha256") == policy_content_hash(policy), "APPROVAL_CONTENT_HASH_MISMATCH")
    reviewed_at = timestamp(review.get("reviewedAt"), "INVALID_REVIEW_TIMESTAMP")
    require(timestamp(policy["createdAt"], "INVALID_POLICY_TIMESTAMP") <= reviewed_at <= now, "INVALID_REVIEW_TIMESTAMP")
    records = array(review.get("reviews"), "MISSING_INDEPENDENT_REVIEWS")
    require(len(records) == 2, "MISSING_INDEPENDENT_REVIEWS")
    require({record.get("role") for record in records if isinstance(record, dict)} == {"independent-reviewer", "coordinator"}, "MISSING_INDEPENDENT_REVIEWS")
    reviewers = set()
    for record in records:
        reviewer = record.get("reviewer")
        require(isinstance(reviewer, str) and reviewer.strip() == reviewer and reviewer
                and reviewer != policy.get("authoredBy") and reviewer not in reviewers, "REVIEW_IS_NOT_INDEPENDENT")
        reviewers.add(reviewer)
        require(isinstance(record.get("reviewedCommit"), str)
                and re.fullmatch(r"[a-f0-9]{40}", record["reviewedCommit"]), "MISSING_REVIEW_COMMIT")
    return True


def validate_policy(policy, root, now):
    require(type(policy.get("schemaVersion")) is int and policy.get("schemaVersion") == 1
            and policy.get("kind") == "exact-image-component-applicability-policy", "UNKNOWN_POLICY_SCHEMA")
    require(policy.get("fingerprintSchema") == FINGERPRINT_SCHEMA, "UNKNOWN_ADVISORY_FINGERPRINT_SCHEMA")
    require(policy.get("scope") == {"component": "runtime", "osFamily": "ubuntu", "osVersion": "24.04", "platform": "linux/amd64",
                                   "imageReferenceMode": "UNTAGGED_LOCAL_OCI", "package": EXPECTED_PACKAGE,
                                   "purl": PURL, "fileCount": 990, "originalFindingCount": 182}, "POLICY_SCOPE_NOT_REVIEWED")
    created = timestamp(policy.get("createdAt"), "INVALID_POLICY_TIMESTAMP")
    expires = timestamp(policy.get("expiresAt"), "INVALID_POLICY_EXPIRY")
    require(0 < (expires - created).total_seconds() <= 14 * 24 * 3600 and created <= now, "INVALID_POLICY_WINDOW")
    reviewed = validate_review(policy, now)
    bindings = object_value(policy.get("evidence"), "MISSING_EVIDENCE_BINDINGS")
    require(set(bindings) == {"cnaInventory", "manualReview", "packageFiles", "baselineArtifact", "scannerIdentity"}, "MISSING_EVIDENCE_BINDINGS")
    paths = {name: bound_file(binding, root) for name, binding in bindings.items()}
    inventory = decode(read_bytes(paths["cnaInventory"]))
    manual = decode(read_bytes(paths["manualReview"]))
    manifest = decode(read_bytes(paths["packageFiles"]))
    require(all(type(record.get("schemaVersion")) is int and record["schemaVersion"] == 1
                for record in (inventory, manual, manifest)), "UNKNOWN_SOURCE_EVIDENCE_SCHEMA")
    scanner_identity = decode(read_bytes(paths["scannerIdentity"]))
    require(type(scanner_identity.get("schemaVersion")) is int and scanner_identity["schemaVersion"] == 1
            and scanner_identity.get("scannerVersion") == image_audit.PIN["version"]
            and scanner_identity.get("scannerCommit") == image_audit.PIN["upstreamCommit"]
            and scanner_identity.get("algorithm") == "sha256(UTF8(ArtifactID + ':' + Target + ':' + PkgID + ':' + VulnerabilityID))"
            and scanner_identity.get("artifactIdRule") == "ImageID only when image reference, RepoTags and RepoDigests are empty",
            "UNREVIEWED_SCANNER_IDENTITY_ALGORITHM")
    require(manual.get("inputInventorySha256") == bindings["cnaInventory"]["sha256"], "MANUAL_REVIEW_INVENTORY_MISMATCH")
    require(manual.get("officialPackage", {}).get("fileManifest", {}).get("sha256") == bindings["packageFiles"]["sha256"], "MANUAL_REVIEW_FILE_MANIFEST_MISMATCH")
    require(manifest.get("package") == EXPECTED_MANIFEST_PACKAGE and manifest.get("fileCount") == 990, "UNREVIEWED_FILE_MANIFEST_PACKAGE")
    files = unique_objects(manifest.get("files"), "path", "DUPLICATE_OR_MISSING_EXPECTED_FILE")
    require(len(files) == 990 and sorted(files) == inventory.get("installedFiles"), "EXPECTED_INVENTORY_MISMATCH")
    for path, entry in files.items():
        require(path.startswith("/usr/") and ".." not in PurePosixPath(path).parts
                and str(PurePosixPath(path)) == path and entry.get("type") == "file", "UNSUPPORTED_EXPECTED_FILE_KIND")
        hash_value(entry.get("sha256"), "INVALID_EXPECTED_FILE_HASH")
        require(type(entry.get("size")) is int and entry["size"] >= 0, "INVALID_EXPECTED_FILE_SIZE")
    require(manifest["archive"]["sha256"] == manual["officialPackage"]["sha256"], "OFFICIAL_PACKAGE_ARCHIVE_MISMATCH")
    records = unique_objects(policy.get("records"), "id", "DUPLICATE_OR_MISSING_POLICY_CVE")
    cna_records = unique_objects(inventory.get("entries"), "id", "DUPLICATE_OR_MISSING_CNA_CVE")
    manual_records = unique_objects(manual.get("componentAssessments"), "id", "DUPLICATE_OR_MISSING_REVIEW_CVE")
    require(len(records) == 182 and set(records) == set(cna_records) == set(manual_records), "SOURCE_PROOF_CVE_SET_MISMATCH")
    require(inventory.get("cveRepositoryCommit") == policy.get("cnaRepositoryCommit")
            and re.fullmatch(r"[a-f0-9]{40}", str(policy.get("cnaRepositoryCommit"))), "UNPINNED_CNA_SNAPSHOT")
    for identifier, record in records.items():
        require(CVE_PATTERN.fullmatch(identifier) is not None, "INVALID_POLICY_CVE")
        cna, reviewed_record = cna_records[identifier], manual_records[identifier]
        require(record.get("cnaRecordSha256") == cna.get("cnaRecordSha256") == reviewed_record.get("cnaRecordSha256"), "CNA_RECORD_HASH_MISMATCH")
        hash_value(record.get("cnaRecordSha256"), "INVALID_CNA_RECORD_HASH")
        hash_value(record.get("advisorySha256"), "INVALID_ADVISORY_HASH")
        year, number = identifier.split("-")[1:]
        require(cna.get("cnaUrl") == f"https://raw.githubusercontent.com/CVEProject/cvelistV5/{policy['cnaRepositoryCommit']}/cves/{year}/{number[:-3]}xxx/{identifier}.json"
                and cna.get("cnaProvider") == "Linux", "UNREVIEWED_CNA_SOURCE")
        source_paths = array(cna.get("programFiles"), "MISSING_EXACT_SOURCE_PATHS")
        require(source_paths and all(isinstance(path, str) and path == str(PurePosixPath(path))
                and not path.startswith("/") and ".." not in PurePosixPath(path).parts
                and not re.search(r"[\\*?{}\[\]]", path) for path in source_paths), "UNKNOWN_SOURCE_PATH_MAPPING")
        if identifier == "CVE-2026-80668":
            overlap = manual.get("uapiOverlap", {})
            require(cna.get("reviewStatus") == "HEADER_PATH_MATCH_REQUIRES_REVIEW"
                    and cna.get("uapiSourcePaths") == ["include/uapi/linux/netfilter/nf_conntrack_common.h"]
                    and overlap.get("enclosingCondition") == "#ifdef __KERNEL__"
                    and overlap.get("officialPackageHeaderSha256") == files["/usr/include/linux/netfilter/nf_conntrack_common.h"]["sha256"]
                    and reviewed_record.get("patchManuallyReviewed") is True, "UNREVIEWED_UAPI_OVERLAP")
        else:
            require(cna.get("reviewStatus") == "CNA_PATHS_NO_EXPORTED_HEADER_MATCH"
                    and cna.get("exportedHeaderCandidates") == [] and cna.get("exportedHeaderMatches") == []
                    and not any("/uapi/" in path for path in source_paths), "UNKNOWN_SOURCE_PATH_MAPPING")
        require(reviewed_record.get("proposedComponentStatus") == "VULNERABLE_IMPLEMENTATION_NOT_SHIPPED_IN_HEADER_PACKAGE"
                and reviewed_record.get("hostKernelApplicability") == "UNKNOWN", "UNREVIEWED_COMPONENT_CONCLUSION")
    # Bind every policy record back to the untouched original scanner evidence.
    baseline = policy.get("baseline", {})
    with zipfile.ZipFile(paths["baselineArtifact"]) as archive:
        member = archive.getinfo("trivy.json")
        require(member.file_size <= MAX_JSON_BYTES, "BASELINE_REPORT_TOO_LARGE")
        original_bytes = archive.read(member)
        manifest_member = archive.getinfo("manifest.json")
        require(manifest_member.file_size <= MAX_JSON_BYTES, "BASELINE_MANIFEST_TOO_LARGE")
        original_manifest = decode(archive.read(manifest_member))
    require(digest(original_bytes) == baseline.get("rawReportSha256") == inventory.get("inputReportSha256")
            == manual.get("inputReportSha256"), "BASELINE_REPORT_HASH_MISMATCH")
    original = decode(original_bytes)
    hash_value(baseline.get("scannerExecutableSha256"), "MISSING_REVIEWED_SCANNER_EXECUTABLE_HASH")
    require(baseline["scannerExecutableSha256"] == original_manifest.get("scannerExecutableSha256"),
            "REVIEWED_SCANNER_EXECUTABLE_NOT_BOUND_TO_BASELINE")
    require(baseline.get("imageConfigDigest") == inventory.get("imageId") == manual.get("imageId"), "BASELINE_IMAGE_IDENTITY_MISMATCH")
    validate_local_image_reference(original, baseline["imageConfigDigest"])
    original_findings = []
    for result in original.get("Results", []):
        for finding in result.get("Vulnerabilities", []):
            if finding.get("PkgName") == PACKAGE_NAME and finding.get("Severity") in HIGH:
                require(finding.get("Fingerprint") == scanner_fingerprint(original, result, finding), "BASELINE_DERIVED_FINGERPRINT_MISMATCH")
                original_findings.append(finding)
    original_records = unique_objects(original_findings, "VulnerabilityID", "DUPLICATE_BASELINE_FINDING")
    require(set(original_records) == set(records), "BASELINE_CVE_SET_MISMATCH")
    for identifier, finding in original_records.items():
        require(advisory_fingerprint(finding) == records[identifier]["advisorySha256"], "POLICY_ADVISORY_NOT_BOUND_TO_BASELINE")
        require(records[identifier].get("originalScannerFingerprint") == finding.get("Fingerprint")
                and records[identifier].get("originalSeverity") == finding.get("Severity")
                == cna_records[identifier].get("scannerSeverity"), "BASELINE_FINDING_IDENTITY_MISMATCH")
    source_bindings = object_value(policy.get("implementations"), "MISSING_IMPLEMENTATION_BINDINGS")
    require(set(source_bindings) == {"imageAudit", "scannerPin", "payloadVerifier"}, "MISSING_IMPLEMENTATION_BINDINGS")
    for binding in source_bindings.values():
        bound_file(binding, root)
    return {"reviewed": reviewed, "expired": now >= expires, "records": records, "files": files,
            "packageManifest": manifest, "fileManifestSha256": bindings["packageFiles"]["sha256"],
            "pathsSha256": paths_digest(files), "sources": source_bindings,
            "scannerExecutableSha256": baseline["scannerExecutableSha256"]}


def validate_image_identity(identity):
    object_value(identity, "MISSING_IMAGE_IDENTITY")
    require(set(identity) == IMAGE_KEYS and identity.get("platform") == "linux/amd64", "UNKNOWN_IMAGE_IDENTITY_SCHEMA")
    for key in ("manifestDigest", "configDigest", "indexDigest", "buildDigest"):
        require(isinstance(identity[key], str) and DIGEST_PATTERN.fullmatch(identity[key]), "INVALID_IMAGE_DIGEST")
    layers = array(identity.get("layerDigests"), "MISSING_IMAGE_LAYERS")
    require(0 < len(layers) <= 128 and all(isinstance(item, str) and DIGEST_PATTERN.fullmatch(item) for item in layers), "INVALID_IMAGE_LAYERS")
    bounded_integer(identity.get("compressedLayerBytes"), 1, 4 * 1024**3, "INVALID_IMAGE_SIZE")


def validate_scan(scan, manifest, raw_sha, evidence, now):
    sources = evidence["sources"]
    require(type(manifest.get("schemaVersion")) is int and manifest.get("schemaVersion") == 1 and manifest.get("component") == "runtime"
            and manifest.get("execution") == "COMPLETED" and manifest.get("stage") == "report-validation", "SCAN_NOT_COMPLETED_RUNTIME")
    require(manifest.get("rawReportSha256") == raw_sha, "SCAN_REPORT_HASH_MISMATCH")
    validate_image_identity(manifest.get("image"))
    validate_local_image_reference(scan, manifest["image"]["configDigest"])
    require(manifest.get("workingTreeDirty") is False, "SCAN_SOURCE_TREE_UNVERIFIED")
    require(isinstance(manifest.get("sourceCommit"), str) and re.fullmatch(r"[a-f0-9]{40}", manifest["sourceCommit"]), "MISSING_SCAN_SOURCE_COMMIT")
    require(manifest.get("sourceSha256") == {"scannerScript": sources["imageAudit"]["sha256"], "scannerPin": sources["scannerPin"]["sha256"]}, "SCAN_IMPLEMENTATION_MISMATCH")
    require(manifest.get("scannerPin") == image_audit.PIN and scan.get("Trivy", {}).get("Version") == image_audit.PIN["version"], "SCANNER_PIN_MISMATCH")
    require(manifest.get("scannerExecutableSha256") == evidence["scannerExecutableSha256"], "SCANNER_EXECUTABLE_HASH_MISMATCH")
    finished = fresh_timestamp(manifest.get("finishedAt"), now, "STALE_SCAN_OBSERVATION")
    started = timestamp(manifest.get("startedAt"), "INVALID_SCAN_START")
    require(started <= finished and (finished - started).total_seconds() <= 3600, "INVALID_SCAN_INTERVAL")
    image_audit.validate_database({"Version": image_audit.PIN["version"], "VulnerabilityDB": manifest.get("database")}, now)
    hash_value(manifest.get("databaseSha256"), "MISSING_DATABASE_HASH")
    java_database = object_value(manifest.get("javaDatabase"), "MISSING_JAVA_DATABASE_EVIDENCE")
    if java_database.get("status") == "NOT_DOWNLOADED":
        require(java_database == {"status": "NOT_DOWNLOADED", "interpretation": "Scanner did not request the Java index; no Java archive coverage is claimed."}
                and "javaDatabaseSha256" not in manifest and not any(result.get("Type") == "jar" for result in scan["Results"]),
                "JAVA_DATABASE_ABSENCE_CONTRADICTS_COVERAGE")
    else:
        image_audit.validate_database({"Version": image_audit.PIN["version"], "JavaDB": java_database}, now,
                                      field="JavaDB", max_age_hours=7 * 24)
        hash_value(manifest.get("javaDatabaseSha256"), "MISSING_JAVA_DATABASE_HASH")
    summary = image_audit.summarize(scan, manifest["image"])
    require(summary == manifest.get("summary"), "RAW_SUMMARY_MISMATCH")
    require(image_audit.validate_library_coverage("runtime", scan) == manifest.get("libraryCoverage"), "RUNTIME_LIBRARY_COVERAGE_MISMATCH")
    require(summary["operatingSystem"].get("Family") == "ubuntu" and summary["operatingSystem"].get("Name") == "24.04", "UNREVIEWED_OPERATING_SYSTEM")
    if "EOSL" in summary["operatingSystem"]:
        require(type(summary["operatingSystem"]["EOSL"]) is bool, "INVALID_OS_SUPPORT_STATUS")
    matches = [(index, result, package) for index, result in enumerate(scan["Results"])
               if result.get("Class") == "os-pkgs" and result.get("Type") == "ubuntu"
               for package in result.get("Packages", []) if package.get("Name") == PACKAGE_NAME]
    require(len(matches) == 1, "MISSING_OR_DUPLICATE_COMPONENT_PACKAGE")
    result_index, result, package = matches[0]
    require(isinstance(scan.get("ArtifactName"), str) and scan["ArtifactName"]
            and result.get("Target") == scan["ArtifactName"] + " (ubuntu 24.04)", "UNREVIEWED_OS_RESULT_TARGET")
    require(all(package.get(key) == value for key, value in EXPECTED_PACKAGE.items()), "UNREVIEWED_PACKAGE_METADATA")
    require("Epoch" not in package and "SrcEpoch" not in package, "UNREVIEWED_PACKAGE_EPOCH")
    identifier = object_value(package.get("Identifier"), "MISSING_PACKAGE_IDENTIFIER")
    require(identifier.get("PURL") == PURL and isinstance(identifier.get("UID"), str) and identifier["UID"], "UNREVIEWED_PACKAGE_IDENTIFIER")
    layer = object_value(package.get("Layer"), "MISSING_PACKAGE_LAYER")
    require(layer.get("Digest") in manifest["image"]["layerDigests"]
            and layer.get("DiffID") in scan["Metadata"].get("DiffIDs", []), "PACKAGE_LAYER_NOT_IN_IMAGE")
    return summary, result_index, result, package


def validate_payload(proof, manifest, scan, raw_sha, selected_package, evidence, now):
    require(type(proof.get("schemaVersion")) is int and proof.get("schemaVersion") == 1 and proof.get("kind") == "oci-package-payload-comparison"
            and proof.get("state") == "MATCH" and proof.get("errors") == [], "PAYLOAD_NOT_VERIFIED")
    observed = fresh_timestamp(proof.get("observedAt"), now, "STALE_PAYLOAD_OBSERVATION")
    require(abs((observed - timestamp(manifest["finishedAt"], "INVALID_SCAN_TIMESTAMP")).total_seconds()) <= 3600, "PAYLOAD_SCAN_OBSERVATION_MISMATCH")
    require(proof.get("identity") == manifest["image"], "PAYLOAD_IMAGE_IDENTITY_MISMATCH")
    sources = evidence["sources"]
    require(proof.get("verifierSourceSha256") == sources["payloadVerifier"]["sha256"]
            and proof.get("sourceSha256") == {sources["payloadVerifier"]["path"]: sources["payloadVerifier"]["sha256"],
                                              sources["imageAudit"]["path"]: sources["imageAudit"]["sha256"]}, "PAYLOAD_VERIFIER_IMPLEMENTATION_MISMATCH")
    expected = object_value(proof.get("expectedManifest"), "MISSING_PAYLOAD_MANIFEST_BINDING")
    require(expected.get("sha256") == evidence["fileManifestSha256"] and expected.get("package") == EXPECTED_MANIFEST_PACKAGE
            and expected.get("archiveSha256") == evidence["packageManifest"]["archive"]["sha256"]
            and type(expected.get("fileCount")) is int and expected["fileCount"] == 990, "PAYLOAD_MANIFEST_BINDING_MISMATCH")
    scan_binding = object_value(proof.get("scan"), "MISSING_PAYLOAD_SCAN_BINDING")
    require(scan_binding.get("sha256") == raw_sha and scan_binding.get("imageId") == scan["Metadata"]["ImageID"], "PAYLOAD_RAW_REPORT_BINDING_MISMATCH")
    require(type(scan_binding.get("installedFileCount")) is int and scan_binding["installedFileCount"] == 990
            and scan_binding.get("installedFilesSha256") == evidence["pathsSha256"], "PAYLOAD_SCAN_INVENTORY_MISMATCH")
    counts = object_value(scan_binding.get("findingCounts"), "MISSING_PAYLOAD_FINDING_COUNTS")
    require(counts == manifest["summary"]["vulnerabilitiesBySeverity"]
            and all(type(count) is int and count >= 0 for count in counts.values()), "PAYLOAD_FINDING_COUNTS_MISMATCH")
    observed_package = object_value(scan_binding.get("package"), "MISSING_PAYLOAD_PACKAGE_METADATA")
    require(observed_package == {key: selected_package[key] for key in PAYLOAD_PACKAGE_KEYS if key in selected_package},
            "PAYLOAD_PACKAGE_METADATA_MISMATCH")
    installed = array(selected_package.get("InstalledFiles"), "MISSING_SCANNER_FILE_INVENTORY")
    require(len(installed) == 990 and len(set(installed)) == 990 and set(installed) == set(evidence["files"]), "SCANNER_FILE_INVENTORY_MISMATCH")
    control = object_value(proof.get("packageControl"), "MISSING_ACTUAL_PACKAGE_CONTROL")
    require(control.get("state") == "MATCH" and control.get("observed") == EXPECTED_CONTROL,
            "ACTUAL_PACKAGE_CONTROL_MISMATCH")
    require(control.get("statusPath") == "/var/lib/dpkg/status"
            and control.get("listPath") in ("/var/lib/dpkg/info/linux-libc-dev:amd64.list", "/var/lib/dpkg/info/linux-libc-dev.list"),
            "UNREVIEWED_DPKG_METADATA_PATH")
    hash_value(control.get("statusSha256"), "MISSING_DPKG_STATUS_HASH")
    hash_value(control.get("listSha256"), "MISSING_DPKG_LIST_HASH")
    require(type(control.get("ownedRegularFileCount")) is int and control["ownedRegularFileCount"] == 990
            and control.get("ownedFilesSha256") == evidence["pathsSha256"], "ACTUAL_PACKAGE_INVENTORY_MISMATCH")
    bounded_integer(control.get("ownedDirectoryCount"), 0, 200_000, "INVALID_OWNED_DIRECTORY_COUNT")
    payload = object_value(proof.get("payload"), "MISSING_FILE_PAYLOAD_PROOF")
    require(type(payload.get("expectedFiles")) is int and type(payload.get("matchedFiles")) is int
            and payload["expectedFiles"] == payload["matchedFiles"] == 990, "PAYLOAD_COUNT_MISMATCH")
    for field in ("missingFiles", "changedFiles", "nonRegularFiles"):
        bounded_integer(payload.get(field), 0, 0, "PAYLOAD_HAS_UNRESOLVED_FILES")
    for field in ("unexpectedOwnedFiles", "missingOwnedFiles"):
        require(payload.get(field) == [], "PAYLOAD_HAS_UNRESOLVED_FILES")
    files = unique_objects(payload.get("files"), "path", "DUPLICATE_OR_MISSING_PAYLOAD_FILE")
    require(set(files) == set(evidence["files"]), "PAYLOAD_FILE_SET_MISMATCH")
    for path, expected_file in evidence["files"].items():
        actual = files[path]
        require(actual.get("state") == "MATCH" and actual.get("expectedSha256") == actual.get("actualSha256") == expected_file["sha256"]
                and type(actual.get("actualSize")) is int and type(actual.get("expectedSize")) is int
                and actual["actualSize"] == actual["expectedSize"] == expected_file["size"], "PAYLOAD_FILE_BYTES_MISMATCH")
        require(actual.get("layerDigest") in manifest["image"]["layerDigests"], "PAYLOAD_FILE_LAYER_NOT_IN_IMAGE")
    execution = object_value(proof.get("execution"), "MISSING_PAYLOAD_EXECUTION_SCOPE")
    require(execution.get("containersStarted") is False and execution.get("filesystemExtraction") is False, "UNREVIEWED_PAYLOAD_EXECUTION_SCOPE")
    seconds = execution.get("elapsedSeconds")
    require(type(seconds) in (int, float) and math.isfinite(seconds) and 0 <= seconds <= 180, "INVALID_PAYLOAD_ELAPSED_TIME")
    bounded_integer(execution.get("uncompressedLayerBytes"), 1, 8 * 1024**3, "INVALID_PAYLOAD_READ_BYTES")
    bounded_integer(execution.get("archiveEntries"), 992, 200_000, "INVALID_PAYLOAD_ARCHIVE_ENTRIES")


def validate_current_cohort(scan, selected_index, package, records):
    """Revalidate all 182 entries atomically, including downgraded/missing IDs.

    Unreviewed LOW/MEDIUM/UNKNOWN records retain the existing scanner policy.
    A previously reviewed ID is always in scope, even after a severity change.
    Added HIGH/CRITICAL entries cannot reuse any part of this fixed cohort.
    """
    candidates = []
    seen = {}
    for result_index, result in enumerate(scan["Results"]):
        for finding_index, finding in enumerate(result.get("Vulnerabilities", [])):
            if finding.get("PkgName") != PACKAGE_NAME:
                continue
            identifier = finding.get("VulnerabilityID")
            if identifier not in records and finding.get("Severity") not in HIGH:
                continue
            context = {"id": identifier, "resultIndex": result_index, "findingIndex": finding_index}
            candidates.append((context, result, finding))
            seen[identifier] = seen.get(identifier, 0) + 1
    unresolved = [{"id": identifier, "reason": "REVIEWED_CVE_MISSING_FROM_CURRENT_SCAN"}
                  for identifier in sorted(set(records) - set(seen))]
    for context, result, finding in candidates:
        identifier = context["id"]
        record = records.get(identifier)
        reason = None
        if context["resultIndex"] != selected_index:
            reason = "UNREVIEWED_COMPONENT_CONTEXT"
        elif seen[identifier] != 1:
            reason = "DUPLICATE_CURRENT_CVE"
        elif record is None:
            reason = "CVE_NOT_IN_REVIEWED_ENUMERATION"
        elif finding.get("PkgID") != PACKAGE_ID or finding.get("InstalledVersion") != "6.8.0-149.149" \
                or finding.get("PkgIdentifier") != package["Identifier"] or finding.get("Layer") != package["Layer"]:
            reason = "FINDING_COMPONENT_IDENTITY_MISMATCH"
        elif finding.get("Fingerprint") != scanner_fingerprint(scan, result, finding):
            reason = "SCANNER_DERIVED_FINGERPRINT_MISMATCH"
        elif finding.get("Severity") != record["originalSeverity"] or advisory_fingerprint(finding) != record["advisorySha256"]:
            reason = "SCANNER_ADVISORY_CHANGED_REVIEW_REQUIRED"
        if reason:
            unresolved.append({**context, "reason": reason})
    return candidates, unresolved


def evaluate(raw_bytes, manifest_bytes, payload_bytes, policy_bytes, *, root=ROOT, now=None):
    now = now or datetime.now(timezone.utc)
    output = {
        "schemaVersion": 1, "kind": "image-component-applicability-evaluation", "observedAt": now.isoformat(),
        "execution": "FAILED", "gate": "BLOCKED_EVIDENCE", "rawReportSha256": digest(raw_bytes),
        "scanManifestSha256": digest(manifest_bytes), "policySha256": digest(policy_bytes), "payloadProofSha256": digest(payload_bytes),
        "evaluatorSourceSha256": digest(read_bytes(__file__)),
        "rawSummary": None, "proposedCodeNotPresent": [], "reviewedCodeNotPresent": [],
        "remainingBlockingFindings": [], "unresolvedEvaluations": [], "blockingReasons": [],
        "hostKernelReadiness": "UNVERIFIED",
        "interpretation": "Original scanner findings and severity counts are unchanged. Code-not-present is an exact-component review decision, not a patch, zero CVEs, or host readiness.",
    }
    try:
        scan, manifest, proof, policy = map(decode, (raw_bytes, manifest_bytes, payload_bytes, policy_bytes))
        # Retain the original severity/count summary even when later policy proof fails.
        summary = image_audit.summarize(scan, manifest.get("image", {}))
        output["rawSummary"] = summary
        output["remainingBlockingFindings"] = deepcopy(summary["blockingVulnerabilities"])
        evidence = validate_policy(policy, root, now)
        summary, selected_index, _, package = validate_scan(scan, manifest, digest(raw_bytes), evidence, now)
        validate_payload(proof, manifest, scan, digest(raw_bytes), package, evidence, now)
        output.update({"execution": "COMPLETED", "policyId": policy.get("policyId"), "policyReviewState": policy["review"]["state"],
                       "policyExpiresAt": policy["expiresAt"], "image": manifest["image"], "sourceCommit": manifest["sourceCommit"],
                       "databaseSha256": manifest["databaseSha256"]})
        if evidence["expired"]:
            output["blockingReasons"].append("POLICY_EXPIRED_REVALIDATION_REQUIRED")
        if not evidence["reviewed"]:
            output["blockingReasons"].append("INDEPENDENT_POLICY_REVIEW_REQUIRED")
        candidates, unresolved = validate_current_cohort(scan, selected_index, package, evidence["records"])
        output["unresolvedEvaluations"] = unresolved
        if unresolved:
            output["blockingReasons"].append("EXACT_CVE_COHORT_REVALIDATION_REQUIRED")
        excluded = set()
        # No partial reuse: every exact record must still agree before the
        # finite, separately approved cohort can authorize any decision.
        for context, result, finding in candidates if not unresolved else []:
            identifier = context["id"]
            record = evidence["records"][identifier]
            decision = {"id": identifier, "package": PACKAGE_ID, "purl": PURL, "severityUnchanged": finding["Severity"],
                        "advisorySha256": record["advisorySha256"], "cnaRecordSha256": record["cnaRecordSha256"],
                        "rawScannerFingerprint": finding["Fingerprint"], "artifactId": scan["ArtifactID"], "target": result["Target"],
                        "resultIndex": context["resultIndex"], "findingIndex": context["findingIndex"], "hostKernelApplicability": "UNKNOWN"}
            if evidence["reviewed"] and not evidence["expired"]:
                decision["decision"] = "REVIEWED_CODE_NOT_PRESENT_IN_EXACT_COMPONENT"
                output["reviewedCodeNotPresent"].append(decision)
                excluded.add((context["resultIndex"], context["findingIndex"]))
            else:
                decision["decision"] = "PROPOSED_CODE_NOT_PRESENT_NO_GATE_AUTHORIZATION"
                output["proposedCodeNotPresent"].append(decision)
        remaining = []
        for result_index, result in enumerate(scan["Results"]):
            for finding_index, finding in enumerate(result.get("Vulnerabilities", [])):
                if finding.get("Severity") in HIGH and (result_index, finding_index) not in excluded:
                    context = {key: result.get(key) for key in ("Target", "Class", "Type")}
                    remaining.append({**{key: finding.get(key) for key in ("VulnerabilityID", "PkgName", "InstalledVersion", "FixedVersion", "Severity", "Status", "PrimaryURL")}, **context})
        output["remainingBlockingFindings"] = remaining
        if summary["operatingSystem"].get("EOSL"):
            output["blockingReasons"].append("OPERATING_SYSTEM_END_OF_SUPPORT")
        if output["blockingReasons"] or remaining:
            output["gate"] = "BLOCKED_REVIEW" if not evidence["reviewed"] or evidence["expired"] else "BLOCKED_FINDINGS"
            return output, 2
        output["gate"] = "PASS_WITH_REVIEWED_COMPONENT_FINDINGS" if excluded else "PASS"
        return output, 0
    except (EvidenceError, ValueError, KeyError, TypeError, AttributeError, RecursionError, OSError, zipfile.BadZipFile) as error:
        output["blockingReasons"].append(str(error) if isinstance(error, EvidenceError) else "EVIDENCE_VALIDATION_FAILED")
        # A partially evaluated decision never authorizes an exception after an error.
        output["proposedCodeNotPresent"] = []
        output["reviewedCodeNotPresent"] = []
        output["execution"] = "FAILED"
        output["gate"] = "BLOCKED_EVIDENCE"
        if output["rawSummary"] is not None:
            output["remainingBlockingFindings"] = deepcopy(output["rawSummary"]["blockingVulnerabilities"])
        return output, 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-report", type=Path, required=True)
    parser.add_argument("--scan-manifest", type=Path, required=True)
    parser.add_argument("--payload-proof", type=Path, required=True)
    parser.add_argument("--policy", type=Path, default=POLICY_PATH)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    inputs = [args.scan_report, args.scan_manifest, args.payload_proof, args.policy]
    try:
        require(not args.output.exists() and not args.output.is_symlink(), "OUTPUT_MUST_BE_NEW")
        output_path = args.output.resolve()
        for path in inputs:
            require(output_path != path.resolve() and not (args.output.exists() and args.output.samefile(path)), "OUTPUT_WOULD_OVERWRITE_INPUT_EVIDENCE")
        # Also protect every policy-bound source/evidence file from output aliasing.
        policy_bytes = read_bytes(args.policy)
        policy = decode(policy_bytes)
        for binding in list(policy.get("evidence", {}).values()) + list(policy.get("implementations", {}).values()):
            source = ROOT / binding["path"]
            require(output_path != source.resolve() and not (args.output.exists() and source.exists() and args.output.samefile(source)), "OUTPUT_WOULD_OVERWRITE_BOUND_EVIDENCE")
        result, code = evaluate(read_bytes(args.scan_report), read_bytes(args.scan_manifest), read_bytes(args.payload_proof), policy_bytes)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as output_file:
            output_file.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"execution": result["execution"], "gate": result["gate"], "rawReportSha256": result["rawReportSha256"],
                          "rawSeverityCounts": result["rawSummary"].get("vulnerabilitiesBySeverity") if result["rawSummary"] else None,
                          "reviewedCodeNotPresent": len(result["reviewedCodeNotPresent"]),
                          "remainingBlockingFindings": len(result["remainingBlockingFindings"]), "blockingReasons": result["blockingReasons"]}))
        return code
    except (EvidenceError, OSError, ValueError, KeyError, TypeError, AttributeError, RecursionError):
        # Do not echo input documents, credentials, or arbitrary external error text.
        print(json.dumps({"execution": "FAILED", "gate": "BLOCKED_EVIDENCE", "reason": "INPUT_OR_OUTPUT_EVIDENCE_INVALID"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
