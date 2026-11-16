from pathlib import Path
import re
import subprocess
import tempfile
import unittest


HERE = Path(__file__).parent
MAIN = "github.com/criyle/go-judge/cmd/go-judge"


class GoPackageGraphTests(unittest.TestCase):
    def check(self, content):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "packages.txt"
            path.write_text(content)
            return subprocess.run(["awk", "-f", str(HERE / "check-go-package-graph.awk"), str(path)],
                                  capture_output=True, text=True, timeout=5)

    def test_normal_production_graph_accepts_other_crypto_packages(self):
        result = self.check("\n".join(["fmt", "golang.org/x/crypto/chacha20", "golang.org/x/crypto/sha3", MAIN]) + "\n")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("4 packages; OpenPGP imports: 0", result.stdout)

    def test_unmaintained_openpgp_and_every_descendant_block_the_build(self):
        for path in ("golang.org/x/crypto/openpgp", "golang.org/x/crypto/openpgp/packet",
                     "golang.org/x/crypto/openpgp/armor", "golang.org/x/crypto/openpgp/clearsign",
                     "golang.org/x/crypto/openpgp/errors", "golang.org/x/crypto/openpgp/elgamal",
                     "golang.org/x/crypto/openpgp/s2k", "golang.org/x/crypto/openpgp/future"):
            with self.subTest(path=path):
                self.assertNotEqual(self.check(MAIN + "\n" + path + "\n").returncode, 0)

    def test_empty_missing_main_duplicate_and_malformed_graphs_fail(self):
        for content in ("", "fmt\n", MAIN + "\n" + MAIN + "\n", MAIN + "\nfmt\nfmt\n",
                        MAIN + "\n\n", MAIN + "\npackage with spaces\n"):
            with self.subTest(content=content):
                self.assertNotEqual(self.check(content).returncode, 0)
        result = subprocess.run(["awk", "-f", str(HERE / "check-go-package-graph.awk"), "/nonexistent/oj-package-graph"],
                                capture_output=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)

    def test_docker_graph_uses_actual_build_flags_and_keeps_original_test_build_layer(self):
        dockerfile = (HERE / "Dockerfile").read_text()
        self.assertIn("go test -mod=readonly -tags=nomsgpack,grpcnotrace -count=1 ./cmd/go-judge/...", dockerfile)
        build = re.search(r"go build (.+?) -ldflags='-s -w' -o /opt/go-judge ./cmd/go-judge", dockerfile)
        listing = re.search(r"go list (.+?) -deps -f '\{\{\.ImportPath\}\}' ./cmd/go-judge", dockerfile)
        self.assertIsNotNone(build)
        self.assertIsNotNone(listing)
        self.assertEqual(build[1], listing[1])
        self.assertIn("ENV CGO_ENABLED=0 GOTOOLCHAIN=local", dockerfile)
        self.assertLess(dockerfile.index("go build "), dockerfile.index("COPY check-go-package-graph.awk"))
        self.assertIn("&& awk -f /tmp/check-go-package-graph.awk /opt/go-judge-packages.txt", dockerfile)
        self.assertNotIn("|| true", dockerfile)
        for name in ("go-judge-packages.txt", "go-judge-build-env.json", "go-judge-build-info.txt",
                     "go-judge-source-locks.sha256", "go-judge-artifacts.sha256"):
            self.assertIn("/opt/" + name, dockerfile.split("FROM ubuntu:", 1)[1])


if __name__ == "__main__":
    unittest.main()
