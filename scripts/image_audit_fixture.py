"""Create a tiny, deliberately vulnerable OCI metadata fixture; it is not an app image.

The filesystem contains text package metadata only, no executable programs. The
old package versions intentionally exercise real advisory matching. With
--scan-report, run the ordinary pinned scanner adapter and preserve its exit
status (2 means completed with blocking findings). Never publish this fixture.
"""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import tarfile

from image_audit import scan_image, write_json


def create_fixture(directory):
    directory = Path(directory)
    # Refuse an existing destination rather than overwrite another image export.
    directory.mkdir(parents=True)
    (directory / "blobs/sha256").mkdir(parents=True)

    def blob(data, media_type):
        if not isinstance(data, bytes):
            data = json.dumps(data, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(data).hexdigest()
        (directory / "blobs/sha256" / digest).write_bytes(data)
        return {"mediaType": media_type, "digest": "sha256:" + digest, "size": len(data)}

    files = {
        "etc/os-release": 'ID=alpine\nNAME="Alpine Linux"\nVERSION_ID=3.24.3\n',
        "etc/alpine-release": "3.24.3\n",
        "lib/apk/db/installed": (
            "P:busybox\nV:1.36.1-r0\nA:x86_64\no:busybox\nL:GPL-2.0-only\n\n"
            "P:openssl\nV:3.1.1-r0\nA:x86_64\no:openssl\nL:Apache-2.0\n\n"
        ),
        "app/node_modules/lodash/package.json": '{"name":"lodash","version":"4.17.11","license":"MIT"}\n',
    }
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as package:
        for name, text in sorted(files.items()):
            data = text.encode()
            member = tarfile.TarInfo(name)
            member.mode, member.size, member.mtime = 0o644, len(data), 0
            package.addfile(member, io.BytesIO(data))
    uncompressed = archive.getvalue()
    layer = blob(gzip.compress(uncompressed, mtime=0), "application/vnd.oci.image.layer.v1.tar+gzip")
    config = blob({
        "architecture": "amd64", "os": "linux",
        "config": {"Labels": {"org.opencontainers.image.title": "Synthetic image-audit adapter test fixture"}},
        "rootfs": {"type": "layers", "diff_ids": ["sha256:" + hashlib.sha256(uncompressed).hexdigest()]},
        "history": [{"created_by": "Synthetic metadata only; no UnsolvableOJ application or executable"}],
    }, "application/vnd.oci.image.config.v1+json")
    manifest = blob({"schemaVersion": 2, "config": config, "layers": [layer]}, "application/vnd.oci.image.manifest.v1+json")
    manifest["platform"] = {"architecture": "amd64", "os": "linux"}
    write_json(directory / "index.json", {"schemaVersion": 2, "manifests": [manifest]})
    write_json(directory / "oci-layout", {"imageLayoutVersion": "1.0.0"})
    return manifest["digest"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--scan-report", type=Path)
    args = parser.parse_args()
    digest = create_fixture(args.destination)
    print(json.dumps({"fixture": "synthetic-metadata-only", "manifestDigest": digest}))
    if args.scan_report:
        raise SystemExit(scan_image("synthetic-fixture", args.destination, args.scan_report, digest))
