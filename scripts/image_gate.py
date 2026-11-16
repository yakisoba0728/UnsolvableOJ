"""Run the unchanged image scanner, retaining its exit/report before any review.

Only runtime raw exit 2 may reach the exact-component applicability evaluator.
Raw execution errors, coverage failures, EOSL and inconsistent evidence block.
This wrapper cannot approve a policy or modify findings.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import sys

import image_applicability as applicability
import image_audit as audit


ROOT = Path(__file__).resolve().parent.parent
SCANNER_EXECUTABLE_SHA256 = "6a972c69606c7b3ea4c6bdcc6fc9332ea9ad38381624310c1e85cc77345909f3"
PACKAGE_MANIFEST = "docs/overhaul/evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json"
COMPONENTS = {"back", "front", "judge", "runtime"}


def new_json(path, value):
    with Path(path).open("x", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")


def validate_raw(component, raw_bytes, manifest, build_digest, root, now):
    """Recheck original completion/identity/coverage before routing its exit."""
    require = applicability.require
    scan = applicability.decode(raw_bytes)
    require(type(manifest.get("schemaVersion")) is int and manifest["schemaVersion"] == 1
            and manifest.get("component") == component and manifest.get("execution") == "COMPLETED"
            and manifest.get("stage") == "report-validation", "RAW_SCAN_DID_NOT_COMPLETE")
    require(manifest.get("rawReportSha256") == applicability.digest(raw_bytes), "RAW_REPORT_HASH_MISMATCH")
    applicability.validate_image_identity(manifest.get("image"))
    require(manifest["image"]["buildDigest"] == build_digest, "RAW_BUILD_DIGEST_MISMATCH")
    require(manifest.get("workingTreeDirty") is False and isinstance(manifest.get("sourceCommit"), str)
            and re.fullmatch(r"[a-f0-9]{40}", manifest["sourceCommit"]), "RAW_SOURCE_NOT_VERIFIED")
    require(manifest.get("sourceSha256") == {
        "scannerScript": audit.sha256(root / "scripts/image_audit.py"),
        "scannerPin": audit.sha256(root / "scripts/image-audit-tool.json"),
    }, "RAW_SCANNER_SOURCE_MISMATCH")
    require(manifest.get("scannerPin") == audit.PIN and scan.get("Trivy", {}).get("Version") == audit.PIN["version"]
            and manifest.get("scannerExecutableSha256") == SCANNER_EXECUTABLE_SHA256, "RAW_SCANNER_PIN_MISMATCH")
    finished = applicability.fresh_timestamp(manifest.get("finishedAt"), now, "STALE_RAW_SCAN")
    started = applicability.timestamp(manifest.get("startedAt"), "INVALID_RAW_SCAN_START")
    require(started <= finished and (finished - started).total_seconds() <= 3600, "INVALID_RAW_SCAN_INTERVAL")
    audit.validate_database({"Version": audit.PIN["version"], "VulnerabilityDB": manifest.get("database")}, now)
    applicability.hash_value(manifest.get("databaseSha256"), "MISSING_RAW_DATABASE_HASH")
    java = applicability.object_value(manifest.get("javaDatabase"), "MISSING_RAW_JAVA_DATABASE_EVIDENCE")
    if java.get("status") == "NOT_DOWNLOADED":
        require(java == {"status": "NOT_DOWNLOADED", "interpretation": "Scanner did not request the Java index; no Java archive coverage is claimed."}
                and "javaDatabaseSha256" not in manifest and not any(result.get("Type") == "jar" for result in scan["Results"]),
                "RAW_JAVA_DATABASE_ABSENCE_CONTRADICTS_COVERAGE")
    else:
        audit.validate_database({"Version": audit.PIN["version"], "JavaDB": java}, now, field="JavaDB", max_age_hours=7 * 24)
        applicability.hash_value(manifest.get("javaDatabaseSha256"), "MISSING_RAW_JAVA_DATABASE_HASH")
    summary = audit.summarize(scan, manifest["image"])
    require(summary == manifest.get("summary"), "RAW_SUMMARY_MISMATCH")
    require(audit.validate_library_coverage(component, scan) == manifest.get("libraryCoverage"), "RAW_LIBRARY_COVERAGE_MISMATCH")
    if "EOSL" in summary["operatingSystem"]:
        require(type(summary["operatingSystem"]["EOSL"]) is bool, "INVALID_RAW_OS_SUPPORT_STATUS")
    return scan, summary


def gate_image(component, directory, report_directory, build_digest, *, root=ROOT, runner=None, now=None):
    root, directory, report_directory = Path(root).resolve(), Path(directory), Path(report_directory)
    runner = runner or subprocess.run
    result = {
        "schemaVersion": 1, "kind": "image-scan-gate", "component": component,
        "observedAt": None, "execution": "FAILED", "stage": "input-validation", "gate": "BLOCKED_EXECUTION",
        "rawScannerExitCode": None, "payloadVerifierExitCode": None, "applicabilityExitCode": None,
        "rawReportSha256": None, "rawManifestSha256": None, "rawSummary": None,
        "wrapperSourceSha256": audit.sha256(__file__), "blockingReasons": [],
        "interpretation": "Original scanner exit, reports and severity counts are retained. Reviewed component applicability is separate from patch status and host readiness.",
    }
    created_report_directory = False
    code = 1
    try:
        applicability.require(component in COMPONENTS and isinstance(build_digest, str)
                              and applicability.DIGEST_PATTERN.fullmatch(build_digest), "INVALID_GATE_ARGUMENTS")
        applicability.require(directory.is_dir() and not directory.is_symlink(), "MISSING_LOCAL_OCI_DIRECTORY")
        applicability.require(not report_directory.resolve().is_relative_to(directory.resolve()), "REPORT_MUST_BE_OUTSIDE_OCI_INPUT")
        applicability.require(not report_directory.exists() and not report_directory.is_symlink(), "REPORT_DIRECTORY_MUST_BE_NEW")
        report_directory.mkdir(parents=True, exist_ok=False)
        created_report_directory = True
        result["stage"] = "raw-scan"
        # No shell interpolation, scanner suppression flags, or rewritten exit.
        raw_run = runner([sys.executable, str(root / "scripts/image_audit.py"), component,
                          str(directory.resolve()), str(report_directory.resolve()), build_digest], cwd=root, check=False, timeout=1200)
        raw_code = raw_run.returncode
        result["rawScannerExitCode"] = raw_code
        applicability.require(type(raw_code) is int and raw_code in (0, 2), "RAW_SCANNER_EXECUTION_FAILED")
        result["stage"] = "raw-evidence-validation"
        raw_path, manifest_path = report_directory / "trivy.json", report_directory / "manifest.json"
        raw_bytes, manifest_bytes = applicability.read_bytes(raw_path), applicability.read_bytes(manifest_path)
        manifest = applicability.decode(manifest_bytes)
        _, summary = validate_raw(component, raw_bytes, manifest, build_digest, root, now or datetime.now(timezone.utc))
        result.update(rawReportSha256=applicability.digest(raw_bytes), rawManifestSha256=applicability.digest(manifest_bytes),
                      rawSummary=summary, image=manifest["image"], sourceCommit=manifest["sourceCommit"])
        applicability.require((raw_code == 0 and summary["gate"] == "PASS")
                              or (raw_code == 2 and summary["gate"] == "BLOCKED_FINDINGS"), "RAW_EXIT_AND_SUMMARY_DISAGREE")
        if raw_code == 0:
            result.update(execution="COMPLETED", gate="PASS_RAW_SCAN", stage="raw-scan-gate")
            code = 0
        elif summary["operatingSystem"].get("EOSL"):
            result.update(execution="COMPLETED", gate="BLOCKED_FINDINGS", stage="raw-scan-gate")
            result["blockingReasons"].append("OPERATING_SYSTEM_END_OF_SUPPORT")
            code = 2
        elif component != "runtime":
            result.update(execution="COMPLETED", gate="BLOCKED_FINDINGS", stage="raw-scan-gate")
            result["blockingReasons"].append("RAW_FINDINGS_HAVE_NO_COMPONENT_APPLICABILITY_POLICY")
            code = 2
        else:
            result["stage"] = "runtime-payload-verification"
            proof_path = report_directory / "payload-verification.json"
            payload_run = runner([sys.executable, str(root / "scripts/verify_image_payload.py"),
                                  "--oci", str(directory.resolve()), "--build-digest", build_digest,
                                  "--expected-manifest", str(root / PACKAGE_MANIFEST),
                                  "--scan-report", str(raw_path.resolve()), "--output", str(proof_path.resolve())],
                                 cwd=root, check=False, timeout=210)
            result["payloadVerifierExitCode"] = payload_run.returncode
            applicability.require(type(payload_run.returncode) is int and payload_run.returncode == 0, "ACTUAL_PAYLOAD_VERIFICATION_FAILED")
            result["stage"] = "runtime-applicability-evaluation"
            proof_bytes = applicability.read_bytes(proof_path)
            policy_bytes = applicability.read_bytes(root / "scripts/image-applicability-policy.json")
            evaluation, evaluation_code = applicability.evaluate(raw_bytes, manifest_bytes, proof_bytes, policy_bytes, root=root, now=now)
            new_json(report_directory / "applicability-evaluation.json", evaluation)
            result.update(applicabilityExitCode=evaluation_code, payloadProofSha256=applicability.digest(proof_bytes),
                          policySha256=applicability.digest(policy_bytes),
                          applicabilityReportSha256=audit.sha256(report_directory / "applicability-evaluation.json"))
            applicability.require(type(evaluation_code) is int and evaluation_code in (0, 1, 2), "UNKNOWN_APPLICABILITY_EXIT")
            if evaluation_code == 0:
                applicability.require(evaluation.get("execution") == "COMPLETED"
                    and evaluation.get("gate") == "PASS_WITH_REVIEWED_COMPONENT_FINDINGS"
                    and evaluation.get("policyReviewState") == "REVIEWED"
                    and evaluation.get("rawReportSha256") == result["rawReportSha256"]
                    and evaluation.get("rawSummary") == summary
                    and evaluation.get("remainingBlockingFindings") == [] and evaluation.get("blockingReasons") == []
                    and evaluation.get("proposedCodeNotPresent") == [] and len(evaluation.get("reviewedCodeNotPresent", [])) == 182,
                    "APPLICABILITY_SUCCESS_CONTRACT_MISMATCH")
                result.update(execution="COMPLETED", gate="PASS_WITH_REVIEWED_COMPONENT_FINDINGS")
                code = 0
            else:
                result.update(execution="COMPLETED" if evaluation_code == 2 else "FAILED", gate=evaluation["gate"])
                result["blockingReasons"].extend(evaluation["blockingReasons"])
                code = evaluation_code
        # The independent decision files never replace or rewrite raw evidence.
        applicability.require(applicability.digest(applicability.read_bytes(raw_path)) == result["rawReportSha256"]
                              and applicability.digest(applicability.read_bytes(manifest_path)) == result["rawManifestSha256"],
                              "RAW_EVIDENCE_CHANGED_DURING_GATE")
    except (applicability.EvidenceError, ValueError, KeyError, TypeError, AttributeError, OSError,
            RecursionError, subprocess.SubprocessError) as error:
        result.update(execution="FAILED", gate="BLOCKED_EXECUTION")
        result["blockingReasons"].append(str(error) if isinstance(error, applicability.EvidenceError) else "GATE_EXECUTION_OR_EVIDENCE_FAILED")
        code = 1
    finally:
        result["observedAt"] = datetime.now(timezone.utc).isoformat()
        if created_report_directory:
            # A failed write raises and therefore remains a failed command.
            new_json(report_directory / "gate.json", result)
    return result, code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("component", choices=sorted(COMPONENTS))
    parser.add_argument("oci_directory", type=Path)
    parser.add_argument("report_directory", type=Path)
    parser.add_argument("build_digest")
    args = parser.parse_args()
    result, code = gate_image(args.component, args.oci_directory, args.report_directory, args.build_digest)
    print(json.dumps({key: result[key] for key in ("component", "execution", "stage", "gate", "rawScannerExitCode",
                                                "payloadVerifierExitCode", "applicabilityExitCode", "blockingReasons")}))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
