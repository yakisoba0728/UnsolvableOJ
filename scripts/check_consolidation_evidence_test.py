from copy import deepcopy
import json
import unittest

from check_consolidation_evidence import MANIFEST, validate_manifest


class ArchiveManifestTests(unittest.TestCase):
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
