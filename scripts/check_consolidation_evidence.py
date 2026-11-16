#!/usr/bin/env python3
"""Verify historical evidence relocation and repository Markdown targets.

--verify-git additionally authenticates each original against the immutable Git
commit. Shallow CI fetches that exact commit before running this mode. Neither
mode runs a historical benchmark or approves the current application source.
"""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "docs/consolidation/archived-evidence.json"


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def validate_manifest(manifest):
    assert manifest["schemaVersion"] == 1
    assert manifest["repository"] == "yakisoba0728/UnsolvableOJ"
    assert re.fullmatch(r"[0-9a-f]{40}", manifest["preservedCommit"])
    assert re.fullmatch(r"[0-9a-f]{40}", manifest["preservedTree"])
    prefix = f"https://github.com/{manifest['repository']}/blob/{manifest['preservedCommit']}/"
    assert manifest["archiveUrlPrefix"] == prefix
    seen = set()
    for item in manifest["files"]:
        path = PurePosixPath(item["path"])
        assert not path.is_absolute() and ".." not in path.parts and str(path) == item["path"]
        assert item["path"] not in seen
        seen.add(item["path"])
        assert re.fullmatch(r"[0-9a-f]{64}", item["sha256"])
        assert re.fullmatch(r"[0-9a-f]{40}", item["gitBlob"])
        assert type(item["bytes"]) is int and item["bytes"] > 0
        assert item["textLines"] is None or (type(item["textLines"]) is int and item["textLines"] >= 0)
    assert len(seen) == manifest["summary"]["files"]
    assert sum(i["bytes"] for i in manifest["files"]) == manifest["summary"]["bytes"]
    assert sum(i["textLines"] or 0 for i in manifest["files"]) == manifest["summary"]["textLines"]
    return seen


def verify(verify_git):
    manifest = json.loads(MANIFEST.read_text())
    archived = validate_manifest(manifest)
    commit = manifest["preservedCommit"]
    for item in manifest["files"]:
        assert not (ROOT / item["path"]).exists(), f"Archived file unexpectedly duplicated: {item['path']}"
        if verify_git:
            original = git("show", f"{commit}:{item['path']}")
            assert len(original) == item["bytes"], f"Archive size: {item['path']}"
            assert hashlib.sha256(original).hexdigest() == item["sha256"], f"Archive SHA256: {item['path']}"
            assert hashlib.sha1(b"blob " + str(len(original)).encode() + b"\0" + original).hexdigest() == item["gitBlob"], f"Git blob: {item['path']}"
            if item["textLines"] is not None:
                assert original.count(b"\n") == item["textLines"], f"Archive line count: {item['path']}"
    if verify_git:
        assert git("rev-parse", commit + "^{tree}").decode().strip() == manifest["preservedTree"]
        removed = set(filter(None, git("diff", "--name-only", "--diff-filter=D", "-z", commit, "--").decode().split("\0")))
        historical = {p for p in removed if p.startswith("docs/overhaul/") or "/benchmarks/" in p}
        assert historical == archived, f"Unindexed historical deletions: {historical ^ archived}"

    # Git's ignore rules exclude dependency/build trees. Include new documents
    # during local work as well as tracked documents on the CI checkout.
    paths = set(filter(None, git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")))
    checked = 0
    for name in sorted(p for p in paths if p.endswith(".md")):
        document = ROOT / name
        if not document.exists():
            continue
        for target in re.findall(r"\[[^\]\n]*\]\(([^\s)]+)(?:\s+[^)]*)?\)", document.read_text()):
            target = unquote(target.split("#", 1)[0].split("?", 1)[0])
            if not target or ":" in target or target.startswith("//"):
                continue
            destination = ROOT / target.lstrip("/") if target.startswith("/") else document.parent / target
            assert destination.exists(), f"Broken document target: {name} -> {target}"
            checked += 1

    print(json.dumps({"status": "PASS", "archivedFiles": len(archived),
                      "verifiedOriginalBytes": manifest["summary"]["bytes"] if verify_git else None,
                      "localMarkdownTargets": checked, "gitOriginalsVerified": verify_git}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-git", action="store_true")
    verify(parser.parse_args().verify_git)
