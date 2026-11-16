from datetime import datetime, timedelta, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout

import image_audit as audit
from image_audit_fixture import create_fixture


def fixture_oci(directory):
    directory = Path(directory)
    (directory / "blobs/sha256").mkdir(parents=True)
    audit.write_json(directory / "oci-layout", {"imageLayoutVersion": "1.0.0"})

    def blob(value, media_type):
        data = value if isinstance(value, bytes) else json.dumps(value).encode()
        digest = hashlib.sha256(data).hexdigest()
        (directory / "blobs/sha256" / digest).write_bytes(data)
        return {"mediaType": media_type, "digest": "sha256:" + digest, "size": len(data)}

    layer = blob(b"synthetic layer bytes: not an actual application image", "application/vnd.oci.image.layer.v1.tar")
    config = blob({"os": "linux", "architecture": "amd64"}, "application/vnd.oci.image.config.v1+json")
    manifest = blob({"schemaVersion": 2, "config": config, "layers": [layer]}, "application/vnd.oci.image.manifest.v1+json")
    nested = blob({"schemaVersion": 2, "manifests": [manifest]}, "application/vnd.oci.image.index.v1+json")
    audit.write_json(directory / "index.json", {"schemaVersion": 2, "manifests": [nested]})
    return nested["digest"], manifest["digest"], config["digest"], layer["digest"]


def fixture_report(config):
    return {"SchemaVersion": 2, "ArtifactType": "container_image", "Metadata": {
        "ImageID": config, "OS": {"Family": "alpine", "Name": "3.24.3"},
    }, "Results": [{"Class": "os-pkgs", "Packages": [{"Name": "example", "Version": "1", "Licenses": ["MIT"]}]}]}


def fixture_version():
    now = datetime.now(timezone.utc)
    return {"Version": audit.PIN["version"], "VulnerabilityDB": {
        "Version": 2, "UpdatedAt": now.isoformat(), "DownloadedAt": now.isoformat(),
        "NextUpdate": (now + timedelta(hours=6)).isoformat(),
    }}


class ImageAuditTests(unittest.TestCase):
    def test_real_adapter_fixture_is_identifiable_and_does_not_overwrite_existing_layouts(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "fixture"
            digest = create_fixture(image)
            self.assertEqual(audit.inspect_oci(image, digest)["manifestDigest"], digest)
            with self.assertRaises(FileExistsError):
                create_fixture(image)

    def test_scanner_source_pin_and_tests_select_all_four_image_jobs(self):
        workflow = (Path(__file__).parents[1] / ".github/workflows/ci.yml").read_text()
        images = workflow.split("\n  images:\n", 1)[1].split("\n  changes:\n", 1)[0]
        match = re.search(r"        run: \|\n((?:          .*\n|\n)+)", images)
        self.assertIsNotNone(match)
        script = "\n".join(line[10:] for line in match.group(1).splitlines())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            git = root / "git"
            git.write_text('#!/bin/sh\nif [ "$1" = fetch ]; then exit 0; fi\nif [ "$1" = diff ]; then printf "%s\\n" "$CI_TEST_FILES"; exit 0; fi\nexit 1\n')
            git.chmod(0o700)
            output = root / "output"
            for changed in ("scripts/image-audit-tool.json", "scripts/image_audit.py", "scripts/image_audit_test.py", "scripts/image_audit_fixture.py"):
                for context in ("Back", "Front", "Judge", "Judge/runtime"):
                    output.write_text("")
                    run = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], capture_output=True, text=True, env={
                        **os.environ, "PATH": f'{root}{os.pathsep}{os.environ["PATH"]}', "BASE": "test-base",
                        "CONTEXT": context, "GITHUB_OUTPUT": str(output), "CI_TEST_FILES": changed,
                    })
                    self.assertEqual(run.returncode, 0, run.stderr)
                    self.assertEqual(output.read_text().strip(), "build=true", (changed, context))

    def test_export_identity_binds_build_digest_manifest_config_and_layer_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            build, manifest, config, layer = fixture_oci(directory)
            identity = audit.inspect_oci(directory, build)
            self.assertEqual(identity["manifestDigest"], manifest)
            self.assertEqual(identity["configDigest"], config)
            self.assertEqual(identity["layerDigests"], [layer])
            with self.assertRaisesRegex(ValueError, "BuildKit digest"):
                audit.inspect_oci(directory, "sha256:" + "0" * 64)
            path = Path(directory) / "blobs/sha256" / layer[7:]
            original = path.read_bytes()
            path.write_bytes(b"X" + original[1:])
            with self.assertRaisesRegex(ValueError, "checksum"):
                audit.inspect_oci(directory, build)

    def test_ambiguous_images_do_not_select_an_arbitrary_platform(self):
        with tempfile.TemporaryDirectory() as directory:
            build, *_ = fixture_oci(directory)
            path = Path(directory) / "index.json"
            index = json.loads(path.read_text())
            index["manifests"] *= 2
            audit.write_json(path, index)
            with self.assertRaisesRegex(ValueError, "exactly one"):
                audit.inspect_oci(directory, build)

    def test_checksum_failure_rejects_the_scanner_before_extraction_or_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(audit, "checked_command", side_effect=lambda *args, **kwargs: (root / "trivy.tar.gz").write_bytes(b"changed archive")):
                with self.assertRaisesRegex(ValueError, "checksum"):
                    audit.install_scanner(root, root)
            self.assertFalse((root / "trivy").exists())

    def test_missing_stale_future_and_wrong_version_databases_fail(self):
        for version in ({"Version": audit.PIN["version"]}, {**fixture_version(), "Version": "0.0.0"}):
            with self.assertRaises(ValueError):
                audit.validate_database(version)
        for offset in (-49, 1):
            version = fixture_version()
            version["VulnerabilityDB"]["UpdatedAt"] = (datetime.now(timezone.utc) + timedelta(hours=offset)).isoformat()
            with self.assertRaisesRegex(ValueError, "stale|future"):
                audit.validate_database(version)

    def test_java_index_database_has_recorded_schema_and_bounded_freshness(self):
        version = fixture_version()
        version["JavaDB"] = {**version["VulnerabilityDB"], "Version": 1}
        version["JavaDB"]["UpdatedAt"] = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
        self.assertEqual(audit.validate_database(version, field="JavaDB", max_age_hours=168)["Version"], 1)
        version["JavaDB"]["UpdatedAt"] = (datetime.now(timezone.utc) - timedelta(days=8)).isoformat()
        with self.assertRaisesRegex(ValueError, "stale"):
            audit.validate_database(version, field="JavaDB", max_age_hours=168)

    def test_empty_coverage_wrong_image_and_suppression_are_not_clean_scans(self):
        config = "sha256:" + "a" * 64
        for mutate in (
            lambda report: report["Metadata"].update(ImageID="sha256:" + "b" * 64),
            lambda report: report["Metadata"].pop("OS"),
            lambda report: report["Results"][0].update(Packages=[]),
            lambda report: report["Results"][0].update(ExperimentalModifiedFindings=[{"ignored": True}]),
        ):
            report = fixture_report(config)
            mutate(report)
            with self.assertRaises(ValueError):
                audit.summarize(report, {"configDigest": config})

    def test_malformed_schema_and_unsupported_os_never_produce_a_clean_summary(self):
        config = "sha256:" + "a" * 64
        for value in ([], None, "unexpected"):
            with self.assertRaises(ValueError):
                audit.summarize(value, {"configDigest": config})
            with self.assertRaises(ValueError):
                audit.validate_database(value)
        for mutate in (
            lambda report: report.update(Metadata=[]),
            lambda report: report["Metadata"]["OS"].update(Family="unrecognized"),
            lambda report: report["Results"].append(None),
            lambda report: report["Results"][0].update(Packages=[{"Name": "package-without-version"}]),
            lambda report: report["Results"][0].update(Vulnerabilities="unexpected"),
            lambda report: report["Results"][0].update(Licenses=["unexpected"]),
        ):
            report = fixture_report(config)
            mutate(report)
            with self.assertRaises(ValueError):
                audit.summarize(report, {"configDigest": config})

    def test_unfixed_high_cves_block_and_low_findings_still_require_review(self):
        config = "sha256:" + "a" * 64
        for severity, gate in (("HIGH", "BLOCKED_FINDINGS"), ("CRITICAL", "BLOCKED_FINDINGS"), ("LOW", "PASS")):
            report = fixture_report(config)
            report["Results"][0]["Vulnerabilities"] = [{
                "VulnerabilityID": "CVE-TEST-1", "PkgName": "example", "InstalledVersion": "1",
                "FixedVersion": "", "Status": "affected", "Severity": severity,
            }]
            summary = audit.summarize(report, {"configDigest": config})
            self.assertEqual(summary["gate"], gate)
            self.assertTrue(summary["requiresFindingTriage"])
            self.assertEqual(summary["vulnerabilitiesBySeverity"][severity], 1)

    def test_npm_and_embedded_go_library_findings_block_and_unversioned_packages_stay_visible(self):
        config = "sha256:" + "a" * 64
        report = fixture_report(config)
        for kind, target, name in (("node-pkg", "Node.js", "lodash"), ("gobinary", "opt/go-judge", "stdlib")):
            report["Results"].append({
                "Class": "lang-pkgs", "Type": kind, "Target": target,
                "Packages": [{"Name": name, "Version": "1.0"}, {"Name": "unknown-main-module"}],
                "Vulnerabilities": [{"VulnerabilityID": "CVE-TEST-LIB", "PkgName": name, "Severity": "HIGH"}],
            })
        summary = audit.summarize(report, {"configDigest": config})
        self.assertEqual(summary["gate"], "BLOCKED_FINDINGS")
        self.assertEqual(summary["vulnerabilitiesBySeverity"]["HIGH"], 2)
        self.assertEqual({item["Type"] for item in summary["blockingVulnerabilities"]}, {"node-pkg", "gobinary"})
        self.assertEqual(summary["installedLibraryPackages"], 4)
        self.assertEqual(summary["libraryPackagesWithoutVersion"], 2)

    def test_missing_expected_npm_or_go_judge_stdlib_coverage_fails(self):
        report = fixture_report("sha256:" + "a" * 64)
        for component, required in (("back", "@nestjs/core"), ("judge", "bullmq"), ("runtime", "esbuild")):
            with self.assertRaisesRegex(ValueError, required):
                audit.validate_library_coverage(component, report)
        report["Results"].append({"Class": "lang-pkgs", "Type": "node-pkg", "Packages": [
            {"Name": name, "Version": "1"} for name in ("@nestjs/core", "bullmq", "esbuild")
        ]})
        self.assertEqual(audit.validate_library_coverage("back", report)["status"], "VERIFIED")
        self.assertEqual(audit.validate_library_coverage("judge", report)["status"], "VERIFIED")
        with self.assertRaisesRegex(ValueError, "Go stdlib"):
            audit.validate_library_coverage("runtime", report)
        report["Results"].append({"Class": "lang-pkgs", "Type": "gobinary", "Target": "/opt/go-judge", "Packages": [{"Name": "stdlib"}]})
        with self.assertRaisesRegex(ValueError, "Go stdlib"):
            audit.validate_library_coverage("runtime", report)
        report["Results"][-1]["Packages"][0]["Version"] = "1.28.0"
        self.assertTrue(audit.validate_library_coverage("runtime", report)["goJudgeWithStdlibRequired"])

    def test_license_classification_is_separate_from_cve_gate_and_end_of_life_os_blocks(self):
        config = "sha256:" + "a" * 64
        report = fixture_report(config)
        report["Results"].append({"Class": "license", "Licenses": [{"Category": "Restricted", "Severity": "HIGH", "Name": "example-license"}]})
        summary = audit.summarize(report, {"configDigest": config})
        self.assertEqual(summary["gate"], "PASS")
        self.assertEqual(summary["licenseMetadata"]["classificationCounts"], {"Restricted": 1})
        self.assertEqual(sum(summary["vulnerabilitiesBySeverity"].values()), 0)
        report["Metadata"]["OS"]["EOSL"] = True
        self.assertEqual(audit.summarize(report, {"configDigest": config})["gate"], "BLOCKED_FINDINGS")

    def test_successful_scanner_with_findings_fails_policy_and_preserves_raw_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build, _, config, _ = fixture_oci(root / "image")
            scan = fixture_report(config)
            scan["Results"].append({"Class": "lang-pkgs", "Type": "node-pkg", "Packages": [{"Name": "example-library", "Version": "1"}],
                                    "Vulnerabilities": [{"VulnerabilityID": "CVE-TEST-2", "PkgName": "example-library", "Severity": "HIGH"}]})

            def install(work, report):
                executable = work / "trivy"
                executable.write_bytes(b"test double; never executed")
                return executable

            def command(arguments, log, **_):
                if "--download-db-only" in arguments:
                    database = Path(arguments[2]) / "db/trivy.db"
                    database.parent.mkdir(parents=True)
                    database.write_bytes(b"synthetic database fixture")
                elif "version" in arguments:
                    audit.write_json(log, fixture_version())
                elif "--output" in arguments:
                    audit.write_json(arguments[arguments.index("--output") + 1], scan)

            with patch.object(audit, "install_scanner", install), patch.object(audit, "checked_command", command), redirect_stdout(io.StringIO()):
                status = audit.scan_image("synthetic-fixture", root / "image", root / "report", build)
            manifest = json.loads((root / "report/manifest.json").read_text())
            self.assertEqual(status, 2)
            self.assertEqual(manifest["execution"], "COMPLETED")
            self.assertEqual(manifest["summary"]["gate"], "BLOCKED_FINDINGS")
            self.assertEqual(json.loads((root / "report/trivy.json").read_text()), scan)

    def test_database_transport_failure_preserves_failure_manifest_not_zero_findings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            build, *_ = fixture_oci(root / "image")
            executable = root / "trivy"
            executable.write_bytes(b"test double; never executed")
            with patch.object(audit, "install_scanner", return_value=executable), \
                    patch.object(audit, "checked_command", side_effect=subprocess.CalledProcessError(1, "database download")), redirect_stdout(io.StringIO()):
                status = audit.scan_image("back", root / "image", root / "report", build)
            manifest = json.loads((root / "report/manifest.json").read_text())
            self.assertEqual(status, 1)
            self.assertEqual(manifest["execution"], "FAILED")
            self.assertEqual(manifest["stage"], "database-download")
            self.assertNotIn("summary", manifest)


if __name__ == "__main__":
    unittest.main()
