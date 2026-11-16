"""Behavioral orchestration tests with explicit synthetic subprocess outputs.

Scanner/helper executables are replaced only by this test runner. The real
raw-evidence validator and applicability evaluator execute without mocked
decisions. Actual OCI helper/evaluator composition has its separate regression.
"""
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

import image_applicability as applicability
import image_applicability_test as evaluator_fixture
import image_audit as audit
import image_gate


class GateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        evaluator_fixture.ApplicabilityTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        evaluator_fixture.ApplicabilityTests.tearDownClass()

    def setUp(self):
        self.case = evaluator_fixture.ApplicabilityTests()
        self.case.setUp()
        self.temporary = tempfile.TemporaryDirectory(prefix="oj-image-gate-")
        self.directory = Path(self.temporary.name)
        self.oci = self.directory / "synthetic-oci-placeholder"
        self.oci.mkdir()
        self.calls = []
        self.reports = []

    def tearDown(self):
        self.temporary.cleanup()

    def component_documents(self, component="runtime", *, clean=False, approved=True):
        if component == "runtime":
            raw, manifest, proof, policy = self.case.documents(approved=approved)
            scan = json.loads(raw)
        else:
            artifact = self.case.repo / f"docs/overhaul/measurements/phase2-image-remediation/before-{component}.zip"
            with zipfile.ZipFile(artifact) as archive:
                scan = json.loads(archive.read("trivy.json"))
                manifest = json.loads(archive.read("manifest.json"))
            _, fresh, proof, policy = self.case.documents(approved=approved)
            for field in ("startedAt", "finishedAt", "database"):
                manifest[field] = deepcopy(fresh[field])
            if manifest.get("javaDatabase", {}).get("Version"):
                manifest["javaDatabase"] = deepcopy(fresh["javaDatabase"])
        if clean:
            for result in scan["Results"]:
                if "Vulnerabilities" in result:
                    result["Vulnerabilities"] = [finding for finding in result["Vulnerabilities"] if finding["Severity"] not in applicability.HIGH]
        raw = evaluator_fixture.encode(scan)
        manifest["rawReportSha256"] = applicability.digest(raw)
        manifest["summary"] = audit.summarize(scan, manifest["image"])
        manifest["libraryCoverage"] = audit.validate_library_coverage(component, scan)
        proof["scan"]["sha256"] = applicability.digest(raw)
        proof["scan"]["findingCounts"] = deepcopy(manifest["summary"]["vulnerabilitiesBySeverity"])
        return [raw, manifest, proof, policy]

    def run_gate(self, documents=None, *, component="runtime", raw_code=2, payload_code=0,
                 raw_error=None, payload_error=None, omit_proof=False, mutate_after_payload=None):
        documents = documents or self.component_documents(component)
        raw, manifest, proof, policy = documents
        (self.case.root / "scripts/image-applicability-policy.json").write_bytes(evaluator_fixture.encode(policy))
        report = self.directory / f"reports-{len(self.reports)}"
        self.reports.append(report)
        manifest_bytes = evaluator_fixture.encode(manifest)

        def runner(arguments, **options):
            self.calls.append((list(arguments), options))
            self.assertFalse(options["check"])
            self.assertNotIn("shell", options)
            if Path(arguments[1]).name == "image_audit.py":
                self.assertEqual(arguments[2:], [component, str(self.oci), str(report), manifest["image"]["buildDigest"]])
                self.assertEqual(options["timeout"], 1200)
                if raw_error:
                    raise raw_error
                (report / "trivy.json").write_bytes(raw)
                (report / "manifest.json").write_bytes(manifest_bytes)
                return SimpleNamespace(returncode=raw_code)
            self.assertEqual(Path(arguments[1]).name, "verify_image_payload.py")
            self.assertEqual(options["timeout"], 210)
            self.assertEqual(arguments[arguments.index("--scan-report") + 1], str(report / "trivy.json"))
            self.assertEqual(arguments[arguments.index("--expected-manifest") + 1], str(self.case.root / image_gate.PACKAGE_MANIFEST))
            if payload_error:
                raise payload_error
            if not omit_proof:
                (report / "payload-verification.json").write_bytes(evaluator_fixture.encode(proof))
            if mutate_after_payload:
                mutate_after_payload(report)
            return SimpleNamespace(returncode=payload_code)

        result, code = image_gate.gate_image(component, self.oci, report, manifest["image"]["buildDigest"],
                                             root=self.case.root, runner=runner, now=self.case.now)
        self.assertEqual(json.loads((report / "gate.json").read_text()), result)
        if not mutate_after_payload and not raw_error:
            self.assertEqual((report / "trivy.json").read_bytes(), raw)
            self.assertEqual((report / "manifest.json").read_bytes(), manifest_bytes)
        return result, code

    def test_plain_raw_pass_uses_no_applicability_decision_for_any_image(self):
        for component in sorted(image_gate.COMPONENTS):
            with self.subTest(component=component):
                calls = len(self.calls)
                result, code = self.run_gate(self.component_documents(component, clean=True, approved=False), component=component, raw_code=0)
                self.assertEqual(code, 0, result["blockingReasons"])
                self.assertEqual(result["gate"], "PASS_RAW_SCAN")
                self.assertEqual(result["rawScannerExitCode"], 0)
                self.assertIsNone(result["applicabilityExitCode"])
                self.assertEqual(len(self.calls), calls + 1)
                self.assertFalse((self.reports[-1] / "applicability-evaluation.json").exists())

    def test_other_image_findings_never_reach_runtime_applicability(self):
        for component in ("back", "front", "judge"):
            with self.subTest(component=component):
                calls = len(self.calls)
                result, code = self.run_gate(self.component_documents(component), component=component)
                self.assertEqual(code, 2, result["blockingReasons"])
                self.assertEqual(result["gate"], "BLOCKED_FINDINGS")
                self.assertEqual(result["rawScannerExitCode"], 2)
                self.assertEqual(len(self.calls), calls + 1)
                self.assertIsNone(result["payloadVerifierExitCode"])

    def test_runtime_proposed_policy_preserves_raw_failure_and_every_finding(self):
        result, code = self.run_gate(self.component_documents(approved=False))
        self.assertEqual(code, 2)
        self.assertEqual(result["gate"], "BLOCKED_REVIEW")
        self.assertEqual((result["rawScannerExitCode"], result["payloadVerifierExitCode"], result["applicabilityExitCode"]), (2, 0, 2))
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["HIGH"], 177)
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["CRITICAL"], 5)
        evaluation = json.loads((self.reports[-1] / "applicability-evaluation.json").read_text())
        self.assertEqual(len(evaluation["proposedCodeNotPresent"]), 182)
        self.assertEqual(evaluation["reviewedCodeNotPresent"], [])
        self.assertEqual(len(evaluation["remainingBlockingFindings"]), 182)

    def test_synthetic_reviewed_runtime_retains_raw_exit_two_and_counts(self):
        result, code = self.run_gate()
        self.assertEqual(code, 0, result["blockingReasons"])
        self.assertEqual(result["gate"], "PASS_WITH_REVIEWED_COMPONENT_FINDINGS")
        self.assertEqual(result["rawScannerExitCode"], 2)
        self.assertEqual(result["rawSummary"]["gate"], "BLOCKED_FINDINGS")
        self.assertEqual(len(result["rawSummary"]["blockingVulnerabilities"]), 182)

    def test_execution_failure_unknown_exit_and_signals_cannot_reach_review(self):
        for raw_code in (1, 3, -9, True, None):
            with self.subTest(raw_code=raw_code):
                calls = len(self.calls)
                result, code = self.run_gate(raw_code=raw_code)
                self.assertEqual(code, 1)
                self.assertEqual(result["gate"], "BLOCKED_EXECUTION")
                self.assertEqual(len(self.calls), calls + 1)
                self.assertIsNone(result["applicabilityExitCode"])

    def test_raw_exit_and_summary_disagreement_is_an_error(self):
        for raw_code, clean in ((0, False), (2, True)):
            with self.subTest(raw_code=raw_code):
                result, code = self.run_gate(self.component_documents(clean=clean), raw_code=raw_code)
                self.assertEqual(code, 1)
                self.assertIn("RAW_EXIT_AND_SUMMARY_DISAGREE", result["blockingReasons"])
                self.assertIsNone(result["payloadVerifierExitCode"])

    def test_incomplete_identity_source_coverage_or_database_cannot_reach_review(self):
        for mutation in ("execution", "stage", "hash", "image", "dirty", "source", "coverage", "version", "executable", "database", "java", "summary"):
            with self.subTest(mutation=mutation):
                documents = self.component_documents()
                manifest = documents[1]
                if mutation == "execution": manifest["execution"] = "FAILED"
                elif mutation == "stage": manifest["stage"] = "image-scan"
                elif mutation == "hash": manifest["rawReportSha256"] = "0" * 64
                elif mutation == "image": manifest["image"]["configDigest"] = "sha256:" + "0" * 64
                elif mutation == "dirty": manifest["workingTreeDirty"] = True
                elif mutation == "source": manifest["sourceSha256"]["scannerScript"] = "0" * 64
                elif mutation == "coverage": manifest["libraryCoverage"] = {}
                elif mutation == "version": manifest["scannerPin"]["version"] = "different"
                elif mutation == "executable": manifest["scannerExecutableSha256"] = "0" * 64
                elif mutation == "database": manifest["database"]["UpdatedAt"] = (self.case.now - timedelta(days=3)).isoformat()
                elif mutation == "java": del manifest["javaDatabase"]
                else: manifest["summary"]["vulnerabilitiesBySeverity"]["HIGH"] = 0
                result, code = self.run_gate(documents)
                self.assertEqual(code, 1, mutation)
                self.assertIsNone(result["payloadVerifierExitCode"])

    def test_missing_actual_library_analyzer_is_not_covered_by_forged_metadata(self):
        self.case.scan["Results"] = [item for item in self.case.scan["Results"] if item.get("Type") != "gobinary"]
        documents = self.case.documents()
        result, code = self.run_gate(documents)
        self.assertEqual(code, 1)
        self.assertIsNone(result["payloadVerifierExitCode"])

    def test_eosl_blocks_before_payload_or_policy_even_with_matching_runtime(self):
        self.case.scan["Metadata"]["OS"]["EOSL"] = True
        result, code = self.run_gate(self.component_documents())
        self.assertEqual(code, 2)
        self.assertIn("OPERATING_SYSTEM_END_OF_SUPPORT", result["blockingReasons"])
        self.assertIsNone(result["payloadVerifierExitCode"])

    def test_payload_failure_missing_proof_or_mismatched_bytes_is_never_accepted(self):
        for mutation in ("exit1", "exit2", "signal", "missing", "state", "hash", "file", "stale"):
            with self.subTest(mutation=mutation):
                documents = self.component_documents()
                options = {}
                if mutation in ("exit1", "exit2", "signal"): options["payload_code"] = {"exit1": 1, "exit2": 2, "signal": -9}[mutation]
                elif mutation == "missing": options["omit_proof"] = True
                elif mutation == "state": documents[2]["state"] = "MISMATCH"
                elif mutation == "hash": documents[2]["scan"]["sha256"] = "0" * 64
                elif mutation == "file": documents[2]["payload"]["files"][0]["actualSha256"] = "0" * 64
                else: documents[2]["observedAt"] = (self.case.now - timedelta(days=2)).isoformat()
                result, code = self.run_gate(documents, **options)
                self.assertEqual(code, 1)
                self.assertNotEqual(result["gate"], "PASS_WITH_REVIEWED_COMPONENT_FINDINGS")
                self.assertEqual(result["rawScannerExitCode"], 2)

    def test_policy_expiry_and_changed_or_missing_cohort_remain_blocking(self):
        baseline = deepcopy(self.case.scan)
        for mutation in ("expired", "changed", "missing", "new", "downgraded"):
            with self.subTest(mutation=mutation):
                self.case.setUp()
                self.case.scan = deepcopy(baseline)
                selected, _, finding = self.case.selected()
                if mutation == "expired": self.case.now = applicability.timestamp(self.case.policy["expiresAt"], "fixture expiry")
                elif mutation == "changed": finding["Description"] += " changed"
                elif mutation == "missing": selected["Vulnerabilities"].remove(finding)
                elif mutation == "downgraded": finding["Severity"] = "MEDIUM"
                else:
                    extra = deepcopy(finding)
                    extra["VulnerabilityID"] = "CVE-2026-199999"
                    extra["Fingerprint"] = applicability.scanner_fingerprint(self.case.scan, selected, extra)
                    selected["Vulnerabilities"].append(extra)
                result, code = self.run_gate(self.component_documents())
                self.assertEqual(code, 2, result["blockingReasons"])
                self.assertIn("POLICY_EXPIRED_REVALIDATION_REQUIRED" if mutation == "expired" else "EXACT_CVE_COHORT_REVALIDATION_REQUIRED", result["blockingReasons"])

    def test_timeouts_remain_failed_commands(self):
        for stage in ("raw", "payload"):
            with self.subTest(stage=stage):
                result, code = self.run_gate(**{stage + "_error": subprocess.TimeoutExpired("synthetic fixture", 1)})
                self.assertEqual(code, 1)
                self.assertEqual(result["gate"], "BLOCKED_EXECUTION")

    def test_no_forged_success_contract_can_replace_the_real_evaluator(self):
        with patch.object(applicability, "evaluate", return_value=({"execution": "COMPLETED", "gate": "PASS"}, 0)):
            result, code = self.run_gate()
        self.assertEqual(code, 1)
        self.assertIn("APPLICABILITY_SUCCESS_CONTRACT_MISMATCH", result["blockingReasons"])

    def test_raw_input_cannot_be_modified_by_a_later_stage(self):
        result, code = self.run_gate(mutate_after_payload=lambda report: (report / "trivy.json").write_text("tampered"))
        self.assertEqual(code, 1)
        self.assertIn("RAW_EVIDENCE_CHANGED_DURING_GATE", result["blockingReasons"])

    def test_report_directory_is_new_and_cannot_target_oci_input(self):
        for report in (self.oci, self.oci / "report", self.directory):
            with self.subTest(report=report):
                with patch("subprocess.run", side_effect=AssertionError("must not start a command")):
                    result, code = image_gate.gate_image("runtime", self.oci, report, "sha256:" + "0" * 64)
                self.assertEqual(code, 1)
                self.assertEqual(result["gate"], "BLOCKED_EXECUTION")


if __name__ == "__main__":
    unittest.main()
