"""Adversarial synthetic OCI tests; these do not prove application-image bytes."""
from contextlib import ExitStack
from dataclasses import replace
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import image_audit as audit
import verify_image_payload as payload


FILES = {
    "/usr/include/linux/a.h": b"/* synthetic UAPI header */\n",
    "/usr/include/asm-generic/b.h": b"#define SYNTHETIC 1\n",
    "/usr/share/doc/linux-libc-dev/copyright": b"Synthetic test fixture only\n",
}
PACKAGE = {"name": "linux-libc-dev", "version": "6.8.0-149.149", "architecture": "amd64", "sourceField": "linux"}
STATUS = "/var/lib/dpkg/status"
LIST = "/var/lib/dpkg/info/linux-libc-dev:amd64.list"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def control_text(**fields):
    values = {"Package": PACKAGE["name"], "Status": "install ok installed", "Architecture": "amd64",
              "Version": PACKAGE["version"], "Source": "linux", "Description": "synthetic fixture\n continuation"}
    values.update(fields)
    return ("\n".join(f"{name}: {value}" for name, value in values.items()) + "\n\n").encode()


def owned_text(paths=FILES):
    directories = {parent for path in paths for parent in payload.parents(path)}
    return ("\n".join("/." if path == "/" else path for path in sorted(directories | set(paths))) + "\n").encode()


def baseline_entries():
    return [(path.lstrip("/"), "file", data) for path, data in FILES.items()] + [
        (STATUS.lstrip("/"), "file", control_text()), (LIST.lstrip("/"), "file", owned_text()),
        ("usr/bin/helper", "file", b"fixture"), ("bin", "symlink", "usr/bin"),
    ]


def tar_bytes(entries, *, format=tarfile.PAX_FORMAT):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w", format=format) as archive:
        for path, kind, value in entries:
            info = tarfile.TarInfo(path)
            info.mode = 0o755 if kind == "directory" else 0o644
            info.mtime = 0
            if kind == "file":
                info.size = len(value)
                archive.addfile(info, io.BytesIO(value))
                continue
            info.type = {"directory": tarfile.DIRTYPE, "symlink": tarfile.SYMTYPE,
                         "hardlink": tarfile.LNKTYPE, "special": tarfile.CHRTYPE}[kind]
            if kind in ("symlink", "hardlink"):
                info.linkname = value
            archive.addfile(info)
    return output.getvalue()


def fixture(root, layers=None, *, compressed=True, raw_layers=None, config_mutate=None, scan_mutate=None, manifest_mutate=None):
    """Return ordinary files containing an OCI layout, expected manifest and report."""
    root = Path(root)
    image = root / "oci"
    blobs = image / "blobs/sha256"
    blobs.mkdir(parents=True)
    audit.write_json(image / "oci-layout", {"imageLayoutVersion": "1.0.0"})

    def blob(value, media_type):
        data = value if isinstance(value, bytes) else json.dumps(value).encode()
        identity = "sha256:" + digest(data)
        (blobs / identity[7:]).write_bytes(data)
        return {"mediaType": media_type, "digest": identity, "size": len(data)}

    raw_layers = raw_layers if raw_layers is not None else [tar_bytes(entries) for entries in (layers or [baseline_entries()])]
    diff_ids = ["sha256:" + digest(layer) for layer in raw_layers]
    descriptors = [blob(gzip.compress(layer, mtime=0) if compressed else layer,
                        "application/vnd.oci.image.layer.v1.tar" + ("+gzip" if compressed else "")) for layer in raw_layers]
    config_value = {"os": "linux", "architecture": "amd64", "rootfs": {"type": "layers", "diff_ids": diff_ids}}
    if config_mutate:
        config_mutate(config_value)
    config = blob(config_value, "application/vnd.oci.image.config.v1+json")
    manifest = blob({"schemaVersion": 2, "config": config, "layers": descriptors}, "application/vnd.oci.image.manifest.v1+json")
    index = blob({"schemaVersion": 2, "manifests": [manifest]}, "application/vnd.oci.image.index.v1+json")
    audit.write_json(image / "index.json", {"schemaVersion": 2, "manifests": [index]})
    expected = {"schemaVersion": 1, "package": PACKAGE, "archive": {"sha256": "0" * 64}, "fileCount": len(FILES),
                "files": [{"path": name, "type": "file", "sha256": digest(data), "size": len(data)} for name, data in FILES.items()]}
    if manifest_mutate:
        manifest_mutate(expected)
    manifest_path = root / "expected.json"
    audit.write_json(manifest_path, expected)
    scan = {"SchemaVersion": 2, "ArtifactType": "container_image",
            "Metadata": {"ImageID": config["digest"], "OS": {"Family": "ubuntu", "Name": "24.04"}},
            "Results": [{"Class": "os-pkgs", "Type": "ubuntu", "Packages": [{
                "Name": PACKAGE["name"], "Version": "6.8.0", "Release": "149.149", "Arch": "amd64",
                "SrcName": "linux", "SrcVersion": "6.8.0", "SrcRelease": "149.149",
                "Identifier": {"PURL": "pkg:deb/ubuntu/linux-libc-dev@6.8.0-149.149?arch=amd64&distro=ubuntu-24.04"},
                "Layer": {"Digest": descriptors[0]["digest"], "DiffID": config_value.get("rootfs", {}).get("diff_ids", diff_ids)[0]},
                "InstalledFiles": sorted(FILES),
            }], "Vulnerabilities": [{"VulnerabilityID": "CVE-SYNTHETIC", "Severity": "CRITICAL", "PkgName": PACKAGE["name"]}]}]}
    if scan_mutate:
        scan_mutate(scan)
    scan_path = root / "scan.json"
    audit.write_json(scan_path, scan)
    return image, index["digest"], manifest_path, scan_path


class PayloadTests(unittest.TestCase):
    def run_fixture(self, **options):
        with tempfile.TemporaryDirectory() as directory:
            return payload.verify(*fixture(directory, **options))

    def assert_error(self, expected, **options):
        report = self.run_fixture(**options)
        self.assertEqual(report["state"], "ERROR", report)
        self.assertIn(expected, " ".join(report["errors"]))
        return report

    def test_bytes_control_inventory_identity_source_hashes_and_findings_are_separate(self):
        for compressed in (False, True):
            with self.subTest(compressed=compressed), tempfile.TemporaryDirectory() as directory:
                args = fixture(directory, compressed=compressed)
                # The verifier has no subprocess/container or extraction path.
                with ExitStack() as stack:
                    for target in ("subprocess.run", "subprocess.Popen", "tarfile.TarFile.extract", "tarfile.TarFile.extractall"):
                        stack.enter_context(patch(target, side_effect=AssertionError("image execution/extraction is forbidden")))
                    report = payload.verify(*args)
                self.assertEqual(report["state"], "MATCH", report)
                self.assertEqual(report["errors"], [])
                self.assertEqual(report["payload"]["matchedFiles"], len(FILES))
                self.assertEqual(report["scan"]["sha256"], audit.sha256(args[3]))
                self.assertEqual(report["identity"], audit.inspect_oci(args[0], args[1]))
                self.assertEqual(report["scan"]["imageId"], report["identity"]["configDigest"])
                self.assertEqual(report["scan"]["findingCounts"]["CRITICAL"], 1)
                self.assertNotIn("gate", report)
                self.assertEqual(report["verifierSourceSha256"], audit.sha256(payload.__file__))
                self.assertEqual(report["sourceSha256"]["scripts/image_audit.py"], audit.sha256(audit.__file__))
                self.assertTrue(report["observedAt"].endswith("+00:00"))
                self.assertFalse(report["execution"]["containersStarted"])
                self.assertFalse(report["execution"]["filesystemExtraction"])
                self.assertGreaterEqual(report["execution"]["archiveEntries"], len(baseline_entries()))
                self.assertEqual(report["packageControl"]["ownedFilesSha256"], payload.path_digest(FILES))

    def test_later_layer_changed_bytes_are_not_hidden_by_earlier_correct_files(self):
        for data in (b"tampered\n", b""):
            with self.subTest(data=data):
                report = self.run_fixture(layers=[baseline_entries(), [("usr/include/linux/a.h", "file", data)]])
                self.assertEqual(report["state"], "MISMATCH", report)
                self.assertEqual(report["payload"]["changedFiles"], 1)
                changed = next(item for item in report["payload"]["files"] if item["state"] == "CHANGED")
                self.assertEqual(changed["actualSha256"], digest(data))
                self.assertEqual(changed["layerDigest"], report["identity"]["layerDigests"][-1])

    def test_explicit_whiteout_removes_lower_payload_and_records_missing(self):
        report = self.run_fixture(layers=[baseline_entries(), [("usr/include/linux/.wh.a.h", "file", b"")]])
        self.assertEqual(report["state"], "MISMATCH", report)
        self.assertEqual(report["payload"]["missingFiles"], 1)
        self.assertIn("/usr/include/linux/a.h", report["payload"]["missingOwnedFiles"])

    def test_whiteout_of_ancestor_removes_all_lower_children(self):
        report = self.run_fixture(layers=[baseline_entries(), [("usr/.wh.include", "file", b"")]])
        self.assertEqual(report["state"], "MISMATCH", report)
        self.assertEqual(report["payload"]["missingFiles"], 2)

    def test_opaque_whiteout_preserves_same_layer_additions_in_either_member_order(self):
        whiteout = ("usr/include/.wh..wh..opq", "file", b"")
        additions = [(name.lstrip("/"), "file", data) for name, data in FILES.items() if name.startswith("/usr/include/")]
        for entries in ([whiteout, *additions], [*additions, whiteout]):
            report = self.run_fixture(layers=[baseline_entries(), entries])
            self.assertEqual(report["state"], "MATCH", report)

    def test_same_layer_file_replaces_explicit_whiteout_independent_of_member_order(self):
        whiteout = ("usr/include/linux/.wh.a.h", "file", b"")
        addition = ("usr/include/linux/a.h", "file", FILES["/usr/include/linux/a.h"])
        for entries in ([whiteout, addition], [addition, whiteout]):
            report = self.run_fixture(layers=[baseline_entries(), entries])
            self.assertEqual(report["state"], "MATCH", report)

    def test_root_opaque_layer_removes_control_and_fails(self):
        self.assert_error("dpkg status", layers=[baseline_entries(), [(".wh..wh..opq", "file", b"")]])

    def test_duplicate_and_ambiguous_paths_are_rejected(self):
        for path in ("usr/include/linux/a.h", "./usr/include/linux/a.h"):
            with self.subTest(path=path):
                self.assert_error("Duplicate canonical path", layers=[baseline_entries() + [(path, "file", b"overwrite")]])
        for path in ("/etc/escape", "../escape", "usr/../escape", "usr//escape", "usr/./escape", "usr/\nescape"):
            with self.subTest(path=path):
                self.assert_error("path", layers=[baseline_entries(), [(path, "file", b"x")]])

    def test_symlink_hardlink_device_or_directory_at_payload_path_fails(self):
        for kind, target in (("symlink", "/tmp/header"), ("hardlink", "usr/bin/helper"), ("special", ""), ("directory", "")):
            with self.subTest(kind=kind):
                self.assert_error("not a regular file", layers=[baseline_entries(), [("usr/include/linux/a.h", kind, target)]])

    def test_control_paths_and_ancestors_cannot_be_replaced_or_aliased(self):
        for path, kind, target in (
            (STATUS.lstrip("/"), "symlink", "/tmp/status"),
            ("usr/include", "symlink", "/tmp/include"),
            ("var/lib/dpkg", "file", b"replacement"),
            ("tmp/alias", "hardlink", "usr/include/linux/a.h"),
            ("tmp/alias", "hardlink", STATUS),
            ("tmp/alias", "hardlink", "usr/include"),
        ):
            with self.subTest(path=path, kind=kind):
                self.assert_error("package" if path == "tmp/alias" else "Package" if path == STATUS.lstrip("/") else "ancestor",
                                  layers=[baseline_entries(), [(path, kind, target)]])

    def test_write_through_unrelated_symlink_and_hardlink_cycles_fail(self):
        self.assert_error("write through", layers=[baseline_entries(), [
            ("tmp/alias", "symlink", "/usr/include"), ("tmp/alias/linux/a.h", "file", b"tamper")]])
        self.assert_error("Cyclic", layers=[baseline_entries(), [
            ("tmp/a", "hardlink", "tmp/b"), ("tmp/b", "hardlink", "tmp/a")]])
        self.assert_error("Unresolved", layers=[baseline_entries(), [("tmp/a", "hardlink", "tmp/missing")]])

    def test_unrelated_links_are_not_followed_and_regular_hardlinks_do_not_change_payload(self):
        report = self.run_fixture(layers=[baseline_entries(), [
            ("tmp/a", "file", b"unrelated"), ("tmp/b", "hardlink", "tmp/a"),
            ("tmp/c", "symlink", "../../outside"), ("tmp/device", "special", "")]])
        self.assertEqual(report["state"], "MATCH", report)

    def test_whiteouts_must_be_empty_regular_entries_with_unambiguous_targets(self):
        for path, kind, value in (("usr/.wh.include", "file", b"x"), ("usr/.wh.include", "special", ""),
                                  ("usr/.wh.", "file", b""), ("usr/.wh..wh.invalid", "file", b"")):
            with self.subTest(path=path, kind=kind):
                self.assert_error("Whiteout" if value or kind == "special" else "whiteout", layers=[baseline_entries(), [(path, kind, value)]])

    def test_missing_extra_duplicate_noncanonical_and_both_owned_lists_fail(self):
        for content, expected in (
            (owned_text(set(FILES) - {"/usr/include/linux/a.h"}), "MISMATCH"),
            (owned_text() + b"/tmp/extra\n", "MISMATCH"),
            (owned_text() + b"/usr/include/linux/a.h\n", "ERROR"),
            (owned_text() + b"//usr/include/linux/a.h\n", "ERROR"),
        ):
            with self.subTest(content=content[-50:]):
                report = self.run_fixture(layers=[baseline_entries(), [(LIST.lstrip("/"), "file", content)]])
                self.assertEqual(report["state"], expected, report)
        self.assert_error("ambiguous", layers=[baseline_entries(), [("var/lib/dpkg/info/linux-libc-dev.list", "file", owned_text())]])
        self.assert_error("owned-file list", layers=[baseline_entries(), [("var/lib/dpkg/info/.wh.linux-libc-dev:amd64.list", "file", b"")]])

    def test_dpkg_source_version_architecture_and_install_status_are_exact(self):
        for fields in ({"Version": "6.8.0-148.148"}, {"Source": "other"}, {"Source": "linux (6.8.0-148.148)"},
                       {"Architecture": "arm64"}, {"Status": "deinstall ok config-files"}):
            with self.subTest(fields=fields):
                self.assert_error("control/source/version/architecture", layers=[baseline_entries(), [(STATUS.lstrip("/"), "file", control_text(**fields))]])
        self.assert_error("exactly one", layers=[baseline_entries(), [(STATUS.lstrip("/"), "file", control_text() * 2)]])
        self.assert_error("Duplicate dpkg control field", layers=[baseline_entries(), [(STATUS.lstrip("/"), "file", control_text().rstrip() + b"\nSource: linux\n")]])

    def test_final_control_metadata_is_used_instead_of_lower_layer_metadata(self):
        lower = [(path, kind, control_text(Source="old") if path == STATUS.lstrip("/") else value) for path, kind, value in baseline_entries()]
        report = self.run_fixture(layers=[lower, [(STATUS.lstrip("/"), "file", control_text())]])
        self.assertEqual(report["state"], "MATCH", report)

    def test_scanner_image_package_source_inventory_and_layer_bindings_are_required(self):
        changes = (
            lambda report: report["Metadata"].update(ImageID="sha256:" + "f" * 64),
            lambda report: report["Results"][0]["Packages"][0].update(Version="5.0"),
            lambda report: report["Results"][0]["Packages"][0].update(SrcRelease="148.148"),
            lambda report: report["Results"][0]["Packages"][0].update(SrcName="other"),
            lambda report: report["Results"][0]["Packages"][0]["InstalledFiles"].pop(),
            lambda report: report["Results"][0]["Packages"][0]["InstalledFiles"].append("/tmp/extra"),
            lambda report: report["Results"][0]["Packages"][0]["Layer"].update(Digest="sha256:" + "f" * 64),
            lambda report: report["Results"][0]["Packages"][0]["Layer"].update(DiffID="sha256:" + "f" * 64),
            lambda report: report["Results"][0]["Packages"].append(report["Results"][0]["Packages"][0]),
        )
        for change in changes:
            with self.subTest(change=change):
                report = self.run_fixture(scan_mutate=change)
                self.assertEqual(report["state"], "ERROR", report)

    def test_uncompressed_hash_and_blob_tampering_fail(self):
        self.assert_error("Uncompressed", config_mutate=lambda config: config["rootfs"]["diff_ids"].__setitem__(0, "sha256:" + "0" * 64))
        with tempfile.TemporaryDirectory() as directory:
            args = fixture(directory)
            identity = audit.inspect_oci(args[0], args[1])
            blob = args[0] / "blobs/sha256" / identity["layerDigests"][0][7:]
            data = blob.read_bytes()
            blob.write_bytes(b"x" + data[1:])
            report = payload.verify(*args)
            self.assertEqual(report["state"], "ERROR", report)
            self.assertIn("checksum", report["errors"][0])

    def test_hidden_second_archive_and_nonzero_tar_trailer_fail(self):
        for suffix in (b"nonzero", tar_bytes([("tmp/hidden", "file", b"hidden")])):
            with self.subTest(suffix=len(suffix)):
                self.assert_error("Non-zero bytes", raw_layers=[tar_bytes(baseline_entries()) + suffix])

    def test_entries_layers_decompression_files_and_control_have_finite_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            args = fixture(directory)
            for limits in (replace(payload.Limits(), entries=2), replace(payload.Limits(), layers=0),
                           replace(payload.Limits(), uncompressed=1024), replace(payload.Limits(), file_bytes=16),
                           replace(payload.Limits(), control_bytes=1), replace(payload.Limits(), compressed=64)):
                with self.subTest(limits=limits):
                    report = payload.verify(*args, limits=limits)
                    self.assertEqual(report["state"], "ERROR", report)
            with patch.object(payload.time, "monotonic", side_effect=range(0, 10000, 1000)):
                report = payload.verify(*args)
                self.assertEqual(report["state"], "ERROR", report)
                self.assertIn("deadline", report["errors"][0])

    def test_large_extension_header_is_rejected_before_allocating_its_body(self):
        info = tarfile.TarInfo("pax")
        info.type, info.size = tarfile.XHDTYPE, 32 * 1024**2
        self.assert_error("extended header", raw_layers=[info.tobuf(format=tarfile.USTAR_FORMAT) + b"\0" * 1024])

    def test_pax_sparse_extension_and_excessive_hidden_headers_fail_before_file_reads(self):
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode="w", format=tarfile.PAX_FORMAT) as archive:
            info = tarfile.TarInfo("tmp/sparse")
            info.size = 1
            info.pax_headers = {"GNU.sparse.size": "100", "GNU.sparse.map": "0,1"}
            archive.addfile(info, io.BytesIO(b"x"))
        self.assert_error("Sparse", raw_layers=[output.getvalue()])
        info = tarfile.TarInfo("pax")
        info.type = tarfile.XGLTYPE
        header = info.tobuf(format=tarfile.USTAR_FORMAT)
        with tempfile.TemporaryDirectory() as directory:
            args = fixture(directory, raw_layers=[header * 10 + tar_bytes(baseline_entries())])
            report = payload.verify(*args, limits=replace(payload.Limits(), entries=5))
            self.assertEqual(report["state"], "ERROR", report)
            self.assertIn("entry count", report["errors"][0])

    def test_sparse_archive_is_unsupported_instead_of_partially_verified(self):
        info = tarfile.TarInfo("sparse")
        info.type = tarfile.GNUTYPE_SPARSE
        self.assert_error("Sparse", raw_layers=[info.tobuf(format=tarfile.USTAR_FORMAT) + b"\0" * 1024])

    def test_malformed_json_shapes_and_nonfinite_or_duplicate_keys_fail_closed(self):
        for change in (lambda report: report.update(Metadata=[]), lambda report: report.update(Results=[None]),
                       lambda report: report["Results"][0].update(Packages="bad"),
                       lambda report: report["Results"][0].update(Vulnerabilities=[None])):
            with self.subTest(change=change):
                self.assertEqual(self.run_fixture(scan_mutate=change)["state"], "ERROR")
        for data in (b'{"schemaVersion":1,"schemaVersion":1}', b'{"value":NaN}'):
            with tempfile.TemporaryDirectory() as directory:
                args = fixture(directory)
                args[2].write_bytes(data)
                self.assertEqual(payload.verify(*args)["state"], "ERROR")

    def test_oci_symlinked_blobs_are_rejected_without_following(self):
        with tempfile.TemporaryDirectory() as directory:
            args = fixture(directory)
            identity = audit.inspect_oci(args[0], args[1])
            blob = args[0] / "blobs/sha256" / identity["layerDigests"][0][7:]
            outside = Path(directory) / "outside"
            blob.rename(outside)
            blob.symlink_to(outside)
            report = payload.verify(*args)
            self.assertEqual(report["state"], "ERROR", report)
            self.assertIn("blob inventory", report["errors"][0])

    def test_cli_writes_only_a_new_evidence_file_and_returns_mismatch_status(self):
        with tempfile.TemporaryDirectory() as directory:
            args = fixture(directory, layers=[baseline_entries(), [("usr/include/linux/a.h", "file", b"modified")]])
            output = Path(directory) / "report.json"
            command = [sys.executable, payload.__file__, "--oci", str(args[0]), "--build-digest", args[1],
                       "--expected-manifest", str(args[2]), "--scan-report", str(args[3]), "--output", str(output)]
            run = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(run.returncode, 2, run.stderr + run.stdout)
            self.assertEqual(json.loads(output.read_text())["state"], "MISMATCH")
            original = output.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True, timeout=20).returncode, 0)
            self.assertEqual(output.read_bytes(), original)
            command[-1] = str(args[0] / "forbidden.json")
            self.assertNotEqual(subprocess.run(command, capture_output=True, timeout=20).returncode, 0)
            self.assertFalse((args[0] / "forbidden.json").exists())

    def test_verifier_and_manifest_changes_select_runtime_and_require_explicit_gate(self):
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
            for changed in ("scripts/verify_image_payload.py", "scripts/verify_image_payload_test.py",
                            "docs/overhaul/evidence/linux-libc-dev-6.8.0-149.149-amd64-files.json"):
                for context in ("Back", "Front", "Judge", "Judge/runtime"):
                    output.write_text("")
                    run = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", script], capture_output=True, text=True,
                                         timeout=10, env={**os.environ, "PATH": f'{root}{os.pathsep}{os.environ["PATH"]}',
                                                         "BASE": "test-base", "CONTEXT": context, "GITHUB_OUTPUT": str(output),
                                                         "CI_TEST_FILES": changed, "FULL": "false"})
                    self.assertEqual(run.returncode, 0, run.stderr)
                    self.assertEqual(output.read_text().strip(), "build=" + ("true" if context == "Judge/runtime" else "false"))
        # Orchestration now records the original exit and invokes this helper
        # inside a separately tested gate, without continuing a failed step.
        gate = images.split("      - name: Scan image and enforce the explicit evidence gate", 1)[1].split("      - name: Image vulnerability", 1)[0]
        self.assertIn('python3 scripts/image_gate.py "$COMPONENT"', gate)
        self.assertIn("-p 'verify_image_payload_test.py'", gate)
        self.assertIn("-p 'image_applicability_test.py'", gate)
        self.assertIn("-p 'image_gate_test.py'", gate)
        evidence = images.split("      - name: Image vulnerability", 1)[1]
        self.assertIn("!cancelled()", evidence)
        self.assertIn("if-no-files-found: error", evidence)
        self.assertNotIn("continue-on-error", images)
        self.assertNotIn("|| true", images)


if __name__ == "__main__":
    unittest.main()
