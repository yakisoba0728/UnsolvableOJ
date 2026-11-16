"""Denial tests for the proposed evaluator; payload success is synthetic here.

The original scanner report is real retained evidence. Tests deliberately build
synthetic proof envelopes to exercise acceptance/denial rules; none is an OCI
verification result, independent approval, or authorization for the repository's
committed PROPOSED policy.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import image_applicability as applicability
import image_audit
import verify_image_payload as payload_verifier
import verify_image_payload_test as payload_fixture


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


class ApplicabilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="oj-applicability-tests-")
        cls.root = Path(cls.temporary.name)
        cls.repo = Path(__file__).resolve().parent.parent
        cls.policy = json.loads((cls.repo / "scripts/image-applicability-policy.json").read_text())
        # A later independently approved repository policy must not turn the
        # permanent proposed-state denial fixtures into approved fixtures.
        cls.policy["review"] = {"state": "PROPOSED", "reviewedAt": None, "contentSha256": None, "reviews": []}
        for binding in list(cls.policy["evidence"].values()) + [cls.policy["implementations"][key] for key in ("imageAudit", "scannerPin")]:
            source = cls.repo / binding["path"]
            destination = cls.root / binding["path"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
        # This inert file exists only in a temporary fixture repository. Its
        # hash cannot validate the real verifier or authorize the real policy.
        verifier = cls.root / cls.policy["implementations"]["payloadVerifier"]["path"]
        verifier.write_text("# synthetic unit-test verifier identity; never executed\n")
        cls.policy["implementations"]["payloadVerifier"]["sha256"] = applicability.digest(verifier.read_bytes())
        artifact = cls.root / cls.policy["evidence"]["baselineArtifact"]["path"]
        with zipfile.ZipFile(artifact) as archive:
            cls.original_raw = archive.read("trivy.json")
            cls.original_scan = json.loads(cls.original_raw)
            cls.original_manifest = json.loads(archive.read("manifest.json"))
        cls.files_manifest = json.loads((cls.root / cls.policy["evidence"]["packageFiles"]["path"]).read_text())
        cls.now = applicability.timestamp(cls.policy["createdAt"], "fixture-time") + timedelta(hours=1)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.scan = deepcopy(self.original_scan)
        self.manifest = deepcopy(self.original_manifest)
        self.policy = deepcopy(type(self).policy)
        self.now = type(self).now
        # A synthetic post-remediation report removes unrelated HIGH findings.
        # The real original report is retained unchanged in the bound ZIP.
        for result in self.scan["Results"]:
            if "Vulnerabilities" in result:
                result["Vulnerabilities"] = [finding for finding in result["Vulnerabilities"]
                    if finding["PkgName"] == applicability.PACKAGE_NAME or finding["Severity"] not in applicability.HIGH]

    def selected(self):
        result = next(result for result in self.scan["Results"]
                      if any(package["Name"] == applicability.PACKAGE_NAME for package in result.get("Packages", [])))
        package = next(package for package in result["Packages"] if package["Name"] == applicability.PACKAGE_NAME)
        finding = next(finding for finding in result["Vulnerabilities"]
                       if finding["PkgName"] == applicability.PACKAGE_NAME and finding["Severity"] in applicability.HIGH)
        return result, package, finding

    def approve_fixture(self):
        self.policy["review"] = {
            "state": "REVIEWED", "reviewedAt": self.policy["createdAt"],
            "contentSha256": applicability.policy_content_hash(self.policy),
            "reviews": [
                {"role": "independent-reviewer", "reviewer": "synthetic-independent-fixture", "reviewedCommit": "1" * 40},
                {"role": "coordinator", "reviewer": "synthetic-coordinator-fixture", "reviewedCommit": "2" * 40},
            ],
        }

    def documents(self, *, approved=True):
        if approved:
            self.approve_fixture()
        else:
            self.policy["review"] = {"state": "PROPOSED", "reviewedAt": None, "contentSha256": None, "reviews": []}
        raw = encode(self.scan)
        manifest = deepcopy(self.manifest)
        manifest["rawReportSha256"] = applicability.digest(raw)
        manifest["startedAt"] = (self.now - timedelta(seconds=30)).isoformat()
        manifest["finishedAt"] = (self.now - timedelta(seconds=2)).isoformat()
        manifest["database"].update({"UpdatedAt": (self.now - timedelta(minutes=30)).isoformat(),
                                     "DownloadedAt": (self.now - timedelta(minutes=15)).isoformat(),
                                     "NextUpdate": (self.now + timedelta(hours=24)).isoformat()})
        manifest["javaDatabase"].update({"UpdatedAt": (self.now - timedelta(minutes=30)).isoformat(),
                                         "DownloadedAt": (self.now - timedelta(minutes=15)).isoformat(),
                                         "NextUpdate": (self.now + timedelta(days=3)).isoformat()})
        manifest["summary"] = image_audit.summarize(self.scan, manifest["image"])
        result, package, _ = self.selected()
        files = self.files_manifest["files"]
        inventory_hash = applicability.paths_digest([item["path"] for item in files])
        source_bindings = self.policy["implementations"]
        proof = {
            "schemaVersion": 1, "kind": "oci-package-payload-comparison", "state": "MATCH", "errors": [],
            "observedAt": self.now.isoformat(), "identity": deepcopy(manifest["image"]),
            "verifierSourceSha256": source_bindings["payloadVerifier"]["sha256"],
            "sourceSha256": {source_bindings[key]["path"]: source_bindings[key]["sha256"] for key in ("payloadVerifier", "imageAudit")},
            "expectedManifest": {"sha256": self.policy["evidence"]["packageFiles"]["sha256"],
                "package": deepcopy(self.files_manifest["package"]), "archiveSha256": self.files_manifest["archive"]["sha256"], "fileCount": 990},
            "scan": {"sha256": applicability.digest(raw), "imageId": self.scan["Metadata"]["ImageID"],
                "package": {key: deepcopy(package[key]) for key in applicability.PAYLOAD_PACKAGE_KEYS if key in package},
                "installedFileCount": 990, "installedFilesSha256": inventory_hash,
                "findingCounts": deepcopy(manifest["summary"]["vulnerabilitiesBySeverity"])},
            "packageControl": {"state": "MATCH", "observed": deepcopy(applicability.EXPECTED_CONTROL),
                "statusPath": "/var/lib/dpkg/status", "listPath": "/var/lib/dpkg/info/linux-libc-dev:amd64.list",
                "statusSha256": applicability.digest(b"synthetic status bytes"),
                "listSha256": applicability.digest(b"synthetic list bytes"), "ownedRegularFileCount": 990,
                "ownedDirectoryCount": 53, "ownedFilesSha256": inventory_hash},
            "payload": {"expectedFiles": 990, "matchedFiles": 990, "missingFiles": 0, "changedFiles": 0,
                "nonRegularFiles": 0, "unexpectedOwnedFiles": [], "missingOwnedFiles": [],
                "files": [{"path": item["path"], "expectedSha256": item["sha256"], "actualSha256": item["sha256"],
                           "expectedSize": item["size"], "actualSize": item["size"], "state": "MATCH",
                           "layerDigest": package["Layer"]["Digest"]} for item in files]},
            "execution": {"containersStarted": False, "filesystemExtraction": False,
                          "elapsedSeconds": 2.5, "uncompressedLayerBytes": sum(item["size"] for item in files) + 10240,
                          "archiveEntries": 1100},
        }
        return raw, manifest, proof, deepcopy(self.policy)

    def evaluate(self, documents=None, *, approved=True):
        raw, manifest, proof, policy = documents or self.documents(approved=approved)
        return applicability.evaluate(raw, encode(manifest), encode(proof), encode(policy), root=self.root, now=self.now)

    def assert_evidence_blocked(self, documents):
        result, code = self.evaluate(documents)
        self.assertEqual(code, 1, result["blockingReasons"])
        self.assertEqual(result["gate"], "BLOCKED_EVIDENCE")
        self.assertEqual(result["reviewedCodeNotPresent"], [])
        return result

    def test_committed_policy_has_an_explicit_valid_review_state_and_fixtures_stay_proposed(self):
        policy = json.loads((self.repo / "scripts/image-applicability-policy.json").read_text())
        self.assertEqual(self.policy["review"], {"state": "PROPOSED", "reviewedAt": None, "contentSha256": None, "reviews": []})
        self.assertIn(policy["review"]["state"], ("PROPOSED", "REVIEWED"))
        reviewed = applicability.validate_review(policy, datetime.now(timezone.utc))
        self.assertEqual(reviewed, policy["review"]["state"] == "REVIEWED")
        if not reviewed:
            self.assertEqual(policy["review"], {"state": "PROPOSED", "reviewedAt": None, "contentSha256": None, "reviews": []})
        else:
            self.assertEqual(policy["review"]["contentSha256"], applicability.policy_content_hash(policy))
            self.assertEqual({record["role"] for record in policy["review"]["reviews"]}, {"independent-reviewer", "coordinator"})
            self.assertEqual(len({record["reviewer"] for record in policy["review"]["reviews"]}), 2)
            self.assertNotIn(policy["authoredBy"], {record["reviewer"] for record in policy["review"]["reviews"]})

    def test_proposed_policy_preserves_every_blocker_even_with_matching_synthetic_proof(self):
        documents = self.documents(approved=False)
        before = tuple(encode(item) if not isinstance(item, bytes) else item for item in documents)
        result, code = self.evaluate(documents)
        self.assertEqual(code, 2)
        self.assertEqual(result["gate"], "BLOCKED_REVIEW")
        self.assertEqual(len(result["proposedCodeNotPresent"]), 182)
        self.assertEqual(result["reviewedCodeNotPresent"], [])
        self.assertEqual(len(result["remainingBlockingFindings"]), 182)
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["CRITICAL"], 5)
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["HIGH"], 177)
        self.assertEqual(before, tuple(encode(item) if not isinstance(item, bytes) else item for item in documents))

    def test_synthetic_reviewed_case_separates_decisions_without_erasing_raw_counts(self):
        result, code = self.evaluate()
        self.assertEqual(code, 0, result["blockingReasons"])
        self.assertEqual(result["gate"], "PASS_WITH_REVIEWED_COMPONENT_FINDINGS")
        self.assertEqual(len(result["reviewedCodeNotPresent"]), 182)
        self.assertEqual(result["remainingBlockingFindings"], [])
        self.assertEqual(result["rawSummary"]["gate"], "BLOCKED_FINDINGS")
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["HIGH"], 177)
        self.assertEqual(result["rawSummary"]["vulnerabilitiesBySeverity"]["CRITICAL"], 5)
        self.assertEqual(result["hostKernelReadiness"], "UNVERIFIED")

    def test_actual_pinned_verifier_output_is_consumed_without_schema_translation(self):
        """Real helper -> synthetic 990-file OCI -> proposed evaluator.

        The fixture's bytes and temporary manifest/review bindings are explicitly
        synthetic, not the authoritative Ubuntu payload or a policy approval.
        This test catches schema drift between two independent implementations.
        """
        with tempfile.TemporaryDirectory(prefix="oj-applicability-contract-") as temporary:
            directory = Path(temporary)
            bound_root = directory / "bound-repository"
            shutil.copytree(self.root, bound_root)
            policy = deepcopy(self.policy)
            policy["review"] = {"state": "PROPOSED", "reviewedAt": None, "contentSha256": None, "reviews": []}
            helper_binding = policy["implementations"]["payloadVerifier"]
            actual_helper = Path(payload_verifier.__file__)
            shutil.copyfile(actual_helper, bound_root / helper_binding["path"])
            helper_binding["sha256"] = applicability.digest(actual_helper.read_bytes())
            committed = json.loads((self.repo / "scripts/image-applicability-policy.json").read_text())
            self.assertEqual(helper_binding["sha256"], committed["implementations"]["payloadVerifier"]["sha256"])

            files = {item["path"]: ("/* synthetic contract fixture: " + item["path"] + " */\n").encode()
                     for item in self.files_manifest["files"]}
            byte_manifest = deepcopy(self.files_manifest)
            byte_manifest["archive"]["sha256"] = applicability.digest(b"synthetic contract archive; never an official .deb")
            byte_manifest["files"] = [{"path": path, "type": "file", "sha256": applicability.digest(data), "size": len(data)}
                                      for path, data in sorted(files.items())]
            byte_binding = policy["evidence"]["packageFiles"]
            byte_path = bound_root / byte_binding["path"]
            byte_path.write_bytes(encode(byte_manifest))
            byte_binding["sha256"] = applicability.digest(byte_path.read_bytes())
            review_binding = policy["evidence"]["manualReview"]
            review_path = bound_root / review_binding["path"]
            synthetic_review = json.loads(review_path.read_text())
            synthetic_review["officialPackage"]["fileManifest"]["sha256"] = byte_binding["sha256"]
            synthetic_review["officialPackage"]["sha256"] = byte_manifest["archive"]["sha256"]
            synthetic_review["uapiOverlap"]["officialPackageHeaderSha256"] = applicability.digest(files["/usr/include/linux/netfilter/nf_conntrack_common.h"])
            review_path.write_bytes(encode(synthetic_review))
            review_binding["sha256"] = applicability.digest(review_path.read_bytes())

            for changed in (False, True):
                with self.subTest(changed_payload=changed):
                    actual_files = dict(files)
                    if changed:
                        actual_files[next(iter(actual_files))] += b"changed byte\n"
                    entries = [(path.lstrip("/"), "file", data) for path, data in actual_files.items()]
                    entries += [(payload_fixture.STATUS.lstrip("/"), "file", payload_fixture.control_text()),
                                (payload_fixture.LIST.lstrip("/"), "file", payload_fixture.owned_text(files))]

                    def bind_current_scan(scan):
                        image_id = scan["Metadata"]["ImageID"]
                        layer = deepcopy(scan["Results"][0]["Packages"][0]["Layer"])
                        scan.clear()
                        scan.update(deepcopy(self.scan))
                        scan["ArtifactID"] = scan["Metadata"]["ImageID"] = image_id
                        scan["Metadata"]["DiffIDs"] = [layer["DiffID"]]
                        for result in scan["Results"]:
                            for package in result.get("Packages", []):
                                if package["Name"] == applicability.PACKAGE_NAME:
                                    package["Layer"] = deepcopy(layer)
                            for finding in result.get("Vulnerabilities", []):
                                if finding["PkgName"] == applicability.PACKAGE_NAME:
                                    finding["Layer"] = deepcopy(layer)
                                finding["Fingerprint"] = applicability.scanner_fingerprint(scan, result, finding)

                    args = payload_fixture.fixture(directory / ("changed" if changed else "matching"),
                                                   layers=[entries], scan_mutate=bind_current_scan)
                    shutil.copyfile(byte_path, args[2])
                    # Only the observation clock is fixed; no verifier decision,
                    # reader, package matcher or byte comparison is mocked.
                    with patch.object(payload_verifier, "datetime") as fixed_clock:
                        fixed_clock.now.return_value = self.now
                        proof = payload_verifier.verify(*args)
                    self.assertEqual(proof["state"], "MISMATCH" if changed else "MATCH", proof["errors"])
                    raw = args[3].read_bytes()
                    scan = json.loads(raw)
                    manifest = self.documents(approved=False)[1]
                    manifest["image"] = proof["identity"]
                    manifest["rawReportSha256"] = applicability.digest(raw)
                    manifest["summary"] = image_audit.summarize(scan, proof["identity"])
                    manifest["libraryCoverage"] = image_audit.validate_library_coverage("runtime", scan)
                    output, code = applicability.evaluate(raw, encode(manifest), encode(proof), encode(policy), root=bound_root, now=self.now)
                    if changed:
                        self.assertEqual(code, 1)
                        self.assertEqual(output["gate"], "BLOCKED_EVIDENCE")
                        self.assertEqual(output["proposedCodeNotPresent"], [])
                    else:
                        self.assertEqual(code, 2, output["blockingReasons"])
                        self.assertEqual(output["execution"], "COMPLETED", output["blockingReasons"])
                        self.assertEqual(output["gate"], "BLOCKED_REVIEW")
                        self.assertEqual(len(output["proposedCodeNotPresent"]), 182)
                    self.assertEqual(output["reviewedCodeNotPresent"], [])
                    self.assertEqual(len(output["remainingBlockingFindings"]), 182)
                    self.assertEqual(proof["scan"]["sha256"], applicability.digest(args[3].read_bytes()))

    def test_original_other_package_findings_still_block(self):
        self.scan = deepcopy(self.original_scan)
        result, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(result["gate"], "BLOCKED_FINDINGS")
        self.assertEqual(len(result["reviewedCodeNotPresent"]), 182)
        self.assertEqual(len(result["remainingBlockingFindings"]), 4)
        self.assertEqual({item["PkgName"] for item in result["remainingBlockingFindings"]}, {"apt", "libapt-pkg6.0t64", "golang.org/x/net", "stdlib"})

    def test_end_of_support_is_never_waived(self):
        self.scan["Metadata"]["OS"]["EOSL"] = True
        result, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertIn("OPERATING_SYSTEM_END_OF_SUPPORT", result["blockingReasons"])

    def test_low_medium_unknown_remain_reported_under_existing_policy(self):
        result, _, finding = self.selected()
        for index, severity in enumerate(("LOW", "MEDIUM", "UNKNOWN")):
            extra = deepcopy(finding)
            extra.update({"VulnerabilityID": f"CVE-2026-{199990 + index}", "Severity": severity,
                          "PkgName": "unrelated-package", "PkgID": "unrelated-package@1"})
            extra["Fingerprint"] = applicability.scanner_fingerprint(self.scan, result, extra)
            result["Vulnerabilities"].append(extra)
        output, code = self.evaluate()
        self.assertEqual(code, 0, output["blockingReasons"])
        self.assertEqual(len(output["reviewedCodeNotPresent"]), 182)
        for severity in ("LOW", "MEDIUM", "UNKNOWN"):
            self.assertGreater(output["rawSummary"]["vulnerabilitiesBySeverity"][severity], 0)

    def test_new_high_is_not_covered_by_package_name_or_source(self):
        result, _, finding = self.selected()
        extra = deepcopy(finding)
        extra["VulnerabilityID"] = "CVE-2026-199999"
        extra["Fingerprint"] = applicability.scanner_fingerprint(self.scan, result, extra)
        result["Vulnerabilities"].append(extra)
        output, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(output["reviewedCodeNotPresent"], [])
        self.assertEqual(len(output["remainingBlockingFindings"]), 183)
        self.assertIn(extra["VulnerabilityID"], [item["VulnerabilityID"] for item in output["remainingBlockingFindings"]])
        self.assertEqual(output["unresolvedEvaluations"][0]["reason"], "CVE_NOT_IN_REVIEWED_ENUMERATION")

    def test_duplicate_current_id_keeps_both_records_blocking(self):
        result, _, finding = self.selected()
        result["Vulnerabilities"].append(deepcopy(finding))
        output, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(output["reviewedCodeNotPresent"], [])
        self.assertEqual(len(output["remainingBlockingFindings"]), 183)
        self.assertTrue(all(item["reason"] == "DUPLICATE_CURRENT_CVE" for item in output["unresolvedEvaluations"]))

    def test_reviewed_id_removed_or_downgraded_requires_whole_cohort_review(self):
        original = deepcopy(self.scan)
        for mutation in ("missing", "MEDIUM", "LOW", "UNKNOWN", "renamed-package"):
            with self.subTest(mutation=mutation):
                self.scan = deepcopy(original)
                result, _, finding = self.selected()
                identifier = finding["VulnerabilityID"]
                if mutation == "missing":
                    result["Vulnerabilities"].remove(finding)
                elif mutation == "renamed-package":
                    finding["PkgName"] = "other-package"
                else:
                    finding["Severity"] = mutation
                output, code = self.evaluate()
                self.assertEqual(code, 2)
                self.assertEqual(output["reviewedCodeNotPresent"], [])
                self.assertIn("EXACT_CVE_COHORT_REVALIDATION_REQUIRED", output["blockingReasons"])
                reason = "REVIEWED_CVE_MISSING_FROM_CURRENT_SCAN" if mutation in ("missing", "renamed-package") else "SCANNER_ADVISORY_CHANGED_REVIEW_REQUIRED"
                self.assertTrue(any(item["id"] == identifier and item["reason"] == reason for item in output["unresolvedEvaluations"]))

    def test_all_reviewed_findings_removed_is_not_an_automatic_pass(self):
        reviewed_ids = {item["id"] for item in self.policy["records"]}
        result, _, _ = self.selected()
        result["Vulnerabilities"] = [item for item in result["Vulnerabilities"] if item["VulnerabilityID"] not in reviewed_ids]
        # selected() ordinarily obtains a HIGH example to help test mutation;
        # this scenario has no such record, so construct proof before removal.
        removed = deepcopy(self.scan)
        self.scan = deepcopy(self.original_scan)
        documents = list(self.documents())
        self.scan = removed
        documents[0] = encode(removed)
        documents[1]["rawReportSha256"] = applicability.digest(documents[0])
        documents[1]["summary"] = image_audit.summarize(removed, documents[1]["image"])
        documents[2]["scan"]["sha256"] = applicability.digest(documents[0])
        documents[2]["scan"]["findingCounts"] = deepcopy(documents[1]["summary"]["vulnerabilitiesBySeverity"])
        output, code = self.evaluate(documents)
        self.assertEqual(code, 2)
        self.assertEqual(output["gate"], "BLOCKED_FINDINGS")
        self.assertEqual(output["reviewedCodeNotPresent"], [])
        self.assertEqual(len(output["unresolvedEvaluations"]), 182)
        self.assertIn("EXACT_CVE_COHORT_REVALIDATION_REQUIRED", output["blockingReasons"])

    def test_every_changed_advisory_field_requires_new_review(self):
        mutations = {
            "Title": "changed title", "Description": "changed description", "References": ["https://example.invalid/changed"],
            "CVSS": {"changed": {"V3Score": 10}}, "CweIDs": ["CWE-20"], "VendorSeverity": {"ubuntu": 3},
            "PublishedDate": "2026-11-16T00:00:00Z", "LastModifiedDate": "2026-11-16T00:00:00Z",
            "Status": "fixed", "FixedVersion": "6.8.0-151.151", "SeveritySource": "changed",
            "DataSource": {"ID": "changed"}, "PrimaryURL": "https://example.invalid/changed", "NewAdvisoryField": "new",
        }
        original = deepcopy(self.scan)
        for key, value in mutations.items():
            with self.subTest(field=key):
                self.scan = deepcopy(original)
                self.selected()[2][key] = value
                result, code = self.evaluate()
                self.assertEqual(code, 2)
                self.assertEqual(len(result["remainingBlockingFindings"]), 182)
                self.assertEqual(result["reviewedCodeNotPresent"], [])
                self.assertEqual(result["unresolvedEvaluations"][0]["reason"], "SCANNER_ADVISORY_CHANGED_REVIEW_REQUIRED")

    def test_missing_advisory_field_is_not_treated_as_unchanged(self):
        del self.selected()[2]["Description"]
        result, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(len(result["remainingBlockingFindings"]), 182)
        self.assertEqual(result["reviewedCodeNotPresent"], [])

    def test_raw_fingerprint_mismatch_or_omission_is_rejected(self):
        original = deepcopy(self.scan)
        for value in ("sha256:" + "f" * 64, None):
            with self.subTest(value=value):
                self.scan = deepcopy(original)
                finding = self.selected()[2]
                if value is None:
                    del finding["Fingerprint"]
                else:
                    finding["Fingerprint"] = value
                result, code = self.evaluate()
                self.assertEqual(code, 2)
                self.assertEqual(result["unresolvedEvaluations"][0]["reason"], "SCANNER_DERIVED_FINGERPRINT_MISMATCH")

    def test_rebuilt_identity_requires_correct_recomputed_raw_fingerprints(self):
        new_id = "sha256:" + "8" * 64
        self.scan["ArtifactID"] = self.scan["Metadata"]["ImageID"] = new_id
        self.manifest["image"]["configDigest"] = new_id
        failed, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(len(failed["remainingBlockingFindings"]), 182)
        for result in self.scan["Results"]:
            for finding in result.get("Vulnerabilities", []):
                finding["Fingerprint"] = applicability.scanner_fingerprint(self.scan, result, finding)
        passed, code = self.evaluate()
        self.assertEqual(code, 0, passed["blockingReasons"])
        self.assertEqual(len(passed["reviewedCodeNotPresent"]), 182)
        self.assertTrue(all(item["artifactId"] == new_id for item in passed["reviewedCodeNotPresent"]))

    def test_tagged_registry_reference_or_artifact_identity_is_out_of_scope(self):
        original = deepcopy(self.scan)
        for key, value in (("RepoTags", ["example.invalid/image:tag"]), ("RepoDigests", ["example.invalid/image@sha256:" + "a" * 64]), ("Reference", "example.invalid/image")):
            with self.subTest(field=key):
                self.scan = deepcopy(original)
                self.scan["Metadata"][key] = value
                self.assert_evidence_blocked(self.documents())
        self.scan = deepcopy(original)
        self.scan["ArtifactID"] = "sha256:" + "7" * 64
        self.assert_evidence_blocked(self.documents())

    def test_package_version_source_purl_epoch_arch_and_inventory_are_exact(self):
        original = deepcopy(self.scan)
        for key, value in (("Version", "6.8.1"), ("Release", "151.151"), ("SrcName", "other"), ("SrcVersion", "6.8.1"),
                           ("SrcRelease", "151.151"), ("SrcEpoch", "1"), ("Arch", "arm64"), ("AnalyzedBy", "rpm")):
            with self.subTest(field=key):
                self.scan = deepcopy(original)
                self.selected()[1][key] = value
                self.assert_evidence_blocked(self.documents())
        for mutation in ("purl", "missing-file", "duplicate-file", "duplicate-package"):
            with self.subTest(mutation=mutation):
                self.scan = deepcopy(original)
                result, package, _ = self.selected()
                if mutation == "purl": package["Identifier"]["PURL"] = "pkg:deb/ubuntu/other@1"
                elif mutation == "missing-file": package["InstalledFiles"].pop()
                elif mutation == "duplicate-file": package["InstalledFiles"][-1] = package["InstalledFiles"][0]
                else: result["Packages"].append(deepcopy(package))
                self.assert_evidence_blocked(self.documents())

    def test_payload_envelope_fields_cannot_be_omitted_or_forged(self):
        changes = [
            (("schemaVersion",), 2), (("schemaVersion",), True), (("state",), "MISMATCH"), (("errors",), ["unresolved"]),
            (("verifierSourceSha256",), "0" * 64), (("sourceSha256",), {}),
            (("identity", "manifestDigest"), "sha256:" + "0" * 64), (("identity", "configDigest"), "sha256:" + "0" * 64),
            (("identity", "layerDigests"), []), (("identity", "buildDigest"), "sha256:" + "0" * 64),
            (("expectedManifest", "sha256"), "0" * 64), (("expectedManifest", "fileCount"), 989),
            (("expectedManifest", "archiveSha256"), "0" * 64), (("scan", "sha256"), "0" * 64),
            (("scan", "imageId"), "sha256:" + "0" * 64), (("scan", "installedFilesSha256"), "0" * 64),
            (("scan", "findingCounts"), {}), (("scan", "findingCounts", "HIGH"), 0),
            (("scan", "findingCounts", "UNKNOWN"), True),
            (("scan", "package", "SrcRelease"), "changed"), (("packageControl", "state"), "UNKNOWN"),
            (("scan", "package", "Repository"), {"Class": "official"}),
            (("packageControl", "observed", "status"), "deinstall ok config-files"),
            (("packageControl", "observed", "sourceField"), "other"), (("packageControl", "ownedRegularFileCount"), 989),
            (("packageControl", "ownedFilesSha256"), "0" * 64), (("packageControl", "listSha256"), None),
            (("packageControl", "statusSha256"), None), (("packageControl", "ownedDirectoryCount"), True),
            (("packageControl", "ownedDirectoryCount"), 200_001),
            (("payload", "matchedFiles"), 989), (("payload", "nonRegularFiles"), ["/usr/include/linked.h"]),
            (("payload", "missingFiles"), []), (("payload", "changedFiles"), False), (("payload", "nonRegularFiles"), 1),
            (("payload", "unexpectedOwnedFiles"), ["/usr/include/extra.h"]),
            (("execution", "containersStarted"), True), (("execution", "filesystemExtraction"), True),
            (("execution", "elapsedSeconds"), True), (("execution", "elapsedSeconds"), -1),
            (("execution", "elapsedSeconds"), 180.1), (("execution", "elapsedSeconds"), None),
            (("execution", "uncompressedLayerBytes"), 0), (("execution", "uncompressedLayerBytes"), 8 * 1024**3 + 1),
            (("execution", "archiveEntries"), 991), (("execution", "archiveEntries"), 200_001),
        ]
        for keys, value in changes:
            with self.subTest(field=keys):
                documents = self.documents()
                obj = documents[2]
                for key in keys[:-1]: obj = obj[key]
                obj[keys[-1]] = value
                self.assert_evidence_blocked(documents)
        documents = self.documents()
        documents[2].clear()
        self.assert_evidence_blocked(documents)

    def test_every_file_byte_size_kind_and_exact_file_set_is_required(self):
        for mutation in ("hash", "size", "expected-hash", "state", "missing", "duplicate", "unrelated-path", "foreign-layer", "missing-layer"):
            with self.subTest(mutation=mutation):
                documents = self.documents()
                records = documents[2]["payload"]["files"]
                if mutation == "hash": records[500]["actualSha256"] = "0" * 64
                elif mutation == "size": records[500]["actualSize"] += 1
                elif mutation == "expected-hash": records[500]["expectedSha256"] = "0" * 64
                elif mutation == "state": records[500]["state"] = "SYMLINK"
                elif mutation == "missing": records.pop()
                elif mutation == "duplicate": records[-1] = deepcopy(records[0])
                elif mutation == "foreign-layer": records[500]["layerDigest"] = "sha256:" + "0" * 64
                elif mutation == "missing-layer": del records[500]["layerDigest"]
                else: records[500]["path"] = "/usr/include/unreviewed.h"
                self.assert_evidence_blocked(documents)

    def test_exact_qualified_or_unqualified_dpkg_list_is_allowed(self):
        for path in ("/var/lib/dpkg/info/linux-libc-dev.list", "/var/lib/dpkg/info/linux-libc-dev:amd64.list"):
            with self.subTest(path=path):
                documents = self.documents()
                documents[2]["packageControl"]["listPath"] = path
                result, code = self.evaluate(documents)
                self.assertEqual(code, 0, result["blockingReasons"])
        documents = self.documents()
        documents[2]["packageControl"]["listPath"] = "/var/lib/dpkg/info/linux-libc-dev:arm64.list"
        self.assert_evidence_blocked(documents)

    def test_raw_repository_origin_is_still_required_despite_narrow_proof_projection(self):
        self.selected()[1]["Repository"] = {"Class": "third-party"}
        result = self.assert_evidence_blocked(self.documents())
        self.assertIn("UNREVIEWED_PACKAGE_METADATA", result["blockingReasons"])

    def test_scan_source_counts_identity_and_freshness_are_bound(self):
        for mutation in ("raw-hash", "summary", "coverage", "source-hash", "executable-hash", "dirty", "schema", "version",
                         "old-db", "missing-java-db", "old-java-db", "missing-java-hash", "old-scan", "old-proof", "different-interval"):
            with self.subTest(mutation=mutation):
                documents = self.documents()
                manifest, proof = documents[1:3]
                if mutation == "raw-hash": manifest["rawReportSha256"] = "0" * 64
                elif mutation == "summary": manifest["summary"]["vulnerabilitiesBySeverity"]["HIGH"] = 0
                elif mutation == "coverage": manifest["libraryCoverage"] = {}
                elif mutation == "source-hash": manifest["sourceSha256"]["scannerScript"] = "0" * 64
                elif mutation == "executable-hash": manifest["scannerExecutableSha256"] = "0" * 64
                elif mutation == "dirty": manifest["workingTreeDirty"] = True
                elif mutation == "schema": manifest["schemaVersion"] = True
                elif mutation == "version": manifest["scannerPin"]["version"] = "changed"
                elif mutation == "old-db": manifest["database"]["UpdatedAt"] = (self.now - timedelta(days=3)).isoformat()
                elif mutation == "missing-java-db": del manifest["javaDatabase"]
                elif mutation == "old-java-db": manifest["javaDatabase"]["UpdatedAt"] = (self.now - timedelta(days=8)).isoformat()
                elif mutation == "missing-java-hash": del manifest["javaDatabaseSha256"]
                elif mutation == "old-scan": manifest["finishedAt"] = (self.now - timedelta(days=2)).isoformat()
                elif mutation == "old-proof": proof["observedAt"] = (self.now - timedelta(days=2)).isoformat()
                else: proof["observedAt"] = (self.now - timedelta(hours=2)).isoformat()
                self.assert_evidence_blocked(documents)

    def test_java_database_absence_requires_explicit_marker_and_no_jar_results(self):
        self.scan["Results"] = [result for result in self.scan["Results"] if result.get("Type") != "jar"]
        documents = self.documents()
        documents[1]["javaDatabase"] = {"status": "NOT_DOWNLOADED", "interpretation": "Scanner did not request the Java index; no Java archive coverage is claimed."}
        del documents[1]["javaDatabaseSha256"]
        output, code = self.evaluate(documents)
        self.assertEqual(code, 0, output["blockingReasons"])
        self.scan["Results"].append({"Target": "synthetic.jar", "Class": "lang-pkgs", "Type": "jar",
                                     "Packages": [{"Name": "synthetic-test-only", "Version": "1"}], "Vulnerabilities": []})
        documents = self.documents()
        documents[1]["javaDatabase"] = {"status": "NOT_DOWNLOADED", "interpretation": "Scanner did not request the Java index; no Java archive coverage is claimed."}
        del documents[1]["javaDatabaseSha256"]
        output = self.assert_evidence_blocked(documents)
        self.assertIn("JAVA_DATABASE_ABSENCE_CONTRADICTS_COVERAGE", output["blockingReasons"])

    def test_expiry_never_automatically_renews_a_review(self):
        self.now = applicability.timestamp(self.policy["expiresAt"], "expiry")
        result, code = self.evaluate()
        self.assertEqual(code, 2)
        self.assertEqual(result["gate"], "BLOCKED_REVIEW")
        self.assertEqual(result["reviewedCodeNotPresent"], [])
        self.assertEqual(len(result["remainingBlockingFindings"]), 182)
        self.assertIn("POLICY_EXPIRED_REVALIDATION_REQUIRED", result["blockingReasons"])

    def test_review_records_cannot_be_self_approved_stale_or_incomplete(self):
        for mutation in ("self", "same-reviewer", "missing-role", "missing-commit", "stale-content", "long-window"):
            with self.subTest(mutation=mutation):
                documents = self.documents()
                policy = documents[3]
                if mutation == "self": policy["review"]["reviews"][0]["reviewer"] = policy["authoredBy"]
                elif mutation == "same-reviewer": policy["review"]["reviews"][1]["reviewer"] = policy["review"]["reviews"][0]["reviewer"]
                elif mutation == "missing-role": policy["review"]["reviews"].pop()
                elif mutation == "missing-commit": del policy["review"]["reviews"][0]["reviewedCommit"]
                elif mutation == "stale-content": policy["expiresAt"] = "2026-11-29T00:00:00Z"
                else: policy["expiresAt"] = "2027-11-30T00:00:00Z"
                self.assert_evidence_blocked(documents)

    def test_unknown_policy_schema_cve_proof_and_duplicate_enumeration_fail(self):
        for mutation in ("schema", "boolean-schema", "duplicate", "missing", "cna-hash", "fingerprint", "scope", "epoch"):
            with self.subTest(mutation=mutation):
                documents = self.documents()
                policy = documents[3]
                if mutation == "schema": policy["schemaVersion"] = 2
                elif mutation == "boolean-schema": policy["schemaVersion"] = True
                elif mutation == "duplicate": policy["records"][-1] = deepcopy(policy["records"][0])
                elif mutation == "missing": policy["records"].pop()
                elif mutation == "cna-hash": policy["records"][0]["cnaRecordSha256"] = "0" * 64
                elif mutation == "fingerprint": policy["records"][0]["advisorySha256"] = "0" * 64
                elif mutation == "scope": policy["scope"]["package"]["Name"] = "linux-*"
                else: policy["scope"]["package"]["SrcEpoch"] = "1"
                # Even a synthetic refreshed approval cannot bless malformed or
                # unbound source evidence through the normal parser.
                policy["review"]["contentSha256"] = applicability.policy_content_hash(policy)
                self.assert_evidence_blocked(documents)

    def test_missing_tampered_or_outside_evidence_fails_closed(self):
        for name in self.policy["evidence"]:
            with self.subTest(binding=name):
                documents = self.documents()
                policy = documents[3]
                policy["evidence"][name]["sha256"] = "0" * 64
                policy["review"]["contentSha256"] = applicability.policy_content_hash(policy)
                self.assert_evidence_blocked(documents)
        documents = self.documents()
        policy = documents[3]
        policy["evidence"]["manualReview"]["path"] = "../outside.json"
        policy["review"]["contentSha256"] = applicability.policy_content_hash(policy)
        self.assert_evidence_blocked(documents)

    def test_source_mapping_unknown_remains_blocking_even_when_hashes_are_rebound(self):
        documents = self.documents()
        policy = documents[3]
        binding = policy["evidence"]["cnaInventory"]
        original_path = self.root / binding["path"]
        inventory = json.loads(original_path.read_text())
        inventory["entries"][0]["reviewStatus"] = "UNKNOWN"
        temporary_path = self.root / "changed-cna.json"
        temporary_path.write_bytes(encode(inventory))
        binding.update({"path": "changed-cna.json", "sha256": applicability.digest(temporary_path.read_bytes())})
        manual_path = self.root / policy["evidence"]["manualReview"]["path"]
        manual = json.loads(manual_path.read_text())
        manual["inputInventorySha256"] = binding["sha256"]
        changed_manual = self.root / "changed-review.json"
        changed_manual.write_bytes(encode(manual))
        policy["evidence"]["manualReview"].update({"path": "changed-review.json", "sha256": applicability.digest(changed_manual.read_bytes())})
        policy["review"]["contentSha256"] = applicability.policy_content_hash(policy)
        result = self.assert_evidence_blocked(documents)
        self.assertIn("UNKNOWN_SOURCE_PATH_MAPPING", result["blockingReasons"])

    def test_duplicate_json_keys_cannot_select_a_permissive_interpretation(self):
        documents = self.documents()
        result, code = applicability.evaluate(documents[0], encode(documents[1]), b'{"state":"MISMATCH","state":"MATCH"}', encode(documents[3]), root=self.root, now=self.now)
        self.assertEqual(code, 1)
        self.assertIn("DUPLICATE_JSON_KEY", result["blockingReasons"])

    def test_malformed_nested_metadata_is_a_structured_evidence_failure(self):
        for target in ("Trivy", "Metadata", "manifest-image", "proof-execution"):
            with self.subTest(target=target):
                documents = list(self.documents())
                if target in ("Trivy", "Metadata"):
                    scan = json.loads(documents[0])
                    scan[target] = None
                    documents[0] = encode(scan)
                    documents[1]["rawReportSha256"] = applicability.digest(documents[0])
                    documents[2]["scan"]["sha256"] = applicability.digest(documents[0])
                elif target == "manifest-image": documents[1]["image"] = None
                else: documents[2]["execution"] = None
                self.assert_evidence_blocked(documents)

    def test_cli_refuses_input_overwrite_and_hardlink_alias(self):
        with tempfile.TemporaryDirectory(prefix="oj-applicability-cli-") as temporary:
            root = Path(temporary)
            raw = root / "trivy.json"
            raw.write_bytes(self.original_raw)
            manifest, proof = root / "manifest.json", root / "proof.json"
            manifest.write_text("{}")
            proof.write_text("{}")
            alias = root / "alias.json"
            alias.hardlink_to(raw)
            existing = root / "previous-report.json"
            existing.write_text("existing report must remain unchanged\n")
            before = hashlib.sha256(raw.read_bytes()).hexdigest()
            for output in (raw, alias, existing):
                run = subprocess.run([sys.executable, str(self.repo / "scripts/image_applicability.py"),
                    "--scan-report", str(raw), "--scan-manifest", str(manifest), "--payload-proof", str(proof),
                    "--output", str(output)], capture_output=True, text=True, timeout=10)
                self.assertEqual(run.returncode, 1)
                self.assertEqual(json.loads(run.stdout)["gate"], "BLOCKED_EVIDENCE")
                self.assertEqual(hashlib.sha256(raw.read_bytes()).hexdigest(), before)
                self.assertEqual(existing.read_text(), "existing report must remain unchanged\n")


if __name__ == "__main__":
    unittest.main()
