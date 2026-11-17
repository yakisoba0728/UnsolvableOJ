from copy import deepcopy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import check_consolidation_evidence as evidence
from check_consolidation_evidence import MANIFEST, validate_manifest


class ArchiveManifestTests(unittest.TestCase):
    def test_new_receipt_does_not_hide_archived_or_unindexed_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.DEVNULL)
            git("init", "--quiet")
            git("config", "diff.renames", "true")
            historical = root / "docs/overhaul"
            historical.mkdir(parents=True)
            archived = historical / "archived.json"
            undeclared = historical / "undeclared.json"
            payload = '{"run":1,"status":"BLOCKED","records":[1,2,3]}\n'
            archived.write_text(payload)
            undeclared.write_text('{"unexpected":"deletion"}\n')
            git("add", ".")
            git("-c", "user.name=Evidence fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "historical evidence")
            base = git("rev-parse", "HEAD").decode().strip()
            archived.unlink()
            undeclared.unlink()
            receipt = root / "docs/consolidation/new-receipt.json"
            receipt.parent.mkdir(parents=True)
            receipt.write_text(payload)
            git("add", ".")
            self.assertIn("R100", git("diff", "--name-status", base).decode())
            with patch.object(evidence, "ROOT", root):
                removed = evidence.historical_deletions(base)
            self.assertEqual(removed, {"docs/overhaul/archived.json", "docs/overhaul/undeclared.json"})
            self.assertNotEqual(removed, {"docs/overhaul/archived.json"})

    def test_manifest_rejects_missing_duplicate_and_unsafe_records(self):
        original = json.loads(MANIFEST.read_text())
        self.assertEqual(len(validate_manifest(original)), 51)
        mutations = [
            lambda d: d["files"].pop(),
            lambda d: d["files"].append(deepcopy(d["files"][0])),
            lambda d: d["files"][0].update(path="../outside.json"),
            lambda d: d["files"][0].update(path="/absolute.json"),
            lambda d: d["files"][0].update(bytes=-1),
            lambda d: d["files"][0].update(sha256="unverified"),
            lambda d: d.update(preservedCommit="main"),
            lambda d: d.update(archiveUrlPrefix="https://example.invalid/"),
        ]
        for mutate in mutations:
            candidate = deepcopy(original)
            mutate(candidate)
            with self.assertRaises(AssertionError):
                validate_manifest(candidate)


if __name__ == "__main__":
    unittest.main()
