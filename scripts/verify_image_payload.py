"""Compare an actual merged OCI package payload with an external byte manifest.

No image/container execution or filesystem extraction; no vulnerability decision.
Exit 0 means bytes/control/inventory MATCH, 2 means MISMATCH, 1 means ERROR.
All scanner findings remain unchanged and remain subject to the original gate.
"""
import argparse
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import tarfile
import time

import image_audit as audit


CHUNK = 1024 * 1024
SHA = re.compile(r"[0-9a-f]{64}")
LAYER_TYPES = {
    "application/vnd.oci.image.layer.v1.tar": False,
    "application/vnd.oci.image.layer.v1.tar+gzip": True,
    "application/vnd.docker.image.rootfs.diff.tar": False,
    "application/vnd.docker.image.rootfs.diff.tar.gzip": True,
}


@dataclass(frozen=True)
class Limits:
    seconds: int = 180
    layers: int = 128
    entries: int = 200_000
    compressed: int = 4 * 1024**3
    uncompressed: int = 8 * 1024**3
    file_bytes: int = 1024**3
    control_bytes: int = 16 * 1024**2
    json_bytes: int = 64 * 1024**2


class Budget:
    def __init__(self, limits):
        self.limits = limits
        self.started = time.monotonic()
        self.uncompressed = 0
        self.entries = 0

    def check(self):
        if time.monotonic() - self.started > self.limits.seconds:
            raise TimeoutError("Payload verification exceeded its finite deadline")


class DigestReader:
    """Bounded streaming reads; never allocate an attacker-specified large read."""
    def __init__(self, source, budget, maximum, *, uncompressed=False):
        self.source, self.budget, self.maximum = source, budget, maximum
        self.uncompressed = uncompressed
        self.count = 0
        self.digest = hashlib.sha256()

    def read(self, amount):
        self.budget.check()
        if amount < 0 or amount > 16 * CHUNK:
            raise ValueError("Oversized or unbounded archive read")
        data = self.source.read(amount)
        self.count += len(data)
        if self.count > self.maximum:
            raise ValueError("OCI stream exceeds its byte bound")
        if self.uncompressed:
            self.budget.uncompressed += len(data)
            if self.budget.uncompressed > self.budget.limits.uncompressed:
                raise ValueError("OCI layers exceed the total decompression bound")
        self.digest.update(data)
        return data


def path_name(value, *, absolute=False):
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 4096:
        raise ValueError("Invalid or oversized image path")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Control character in image path")
    if value.startswith("/") and not absolute:
        raise ValueError("Absolute archive entry path")
    if value.startswith("//"):
        raise ValueError("Ambiguous absolute image path")
    value = value[1:] if absolute and value.startswith("/") else value
    while value.startswith("./"):
        value = value[2:]
    value = value.rstrip("/")
    if value in ("", "."):
        return "/"
    parts = value.split("/")
    if len(parts) > 128 or any(part in ("", ".", "..") for part in parts):
        raise ValueError("Traversal or ambiguous archive path")
    return "/" + "/".join(parts)


def parents(path):
    parts = path.strip("/").split("/")
    return ["/"] + ["/" + "/".join(parts[:index]) for index in range(1, len(parts))]


def path_digest(paths):
    # Public contract: UTF-8, sorted absolute paths, compact JSON, no newline.
    data = json.dumps(sorted(paths), ensure_ascii=False, separators=(",", ":")).encode()
    return hashlib.sha256(data).hexdigest()


def read_json(path, maximum):
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("Invalid or oversized JSON input")
    data = path.read_bytes()
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON object key")
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError("Non-finite JSON constant")

    return json.loads(data, object_pairs_hook=unique_object, parse_constant=invalid_constant), hashlib.sha256(data).hexdigest()


def expected_payload(path, limits):
    value, digest = read_json(path, limits.json_bytes)
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise ValueError("Unsupported expected-payload schema")
    package = value.get("package", {})
    if (not isinstance(package, dict)
            or set(package) != {"name", "version", "architecture", "sourceField"}
            or not all(isinstance(package.get(key), str) and package[key]
                       for key in ("name", "version", "architecture", "sourceField"))
            or not re.fullmatch(r"[a-z0-9][a-z0-9+.-]+", package["name"])
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]+", package["architecture"])):
        raise ValueError("Missing or invalid expected package control")
    archive = value.get("archive", {})
    if (not isinstance(archive, dict) or not isinstance(archive.get("sha256"), str)
            or not SHA.fullmatch(archive["sha256"])):
        raise ValueError("Expected package archive has no SHA256 identity")
    files = value.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 10_000 or value.get("fileCount") != len(files):
        raise ValueError("Expected payload file count is invalid")
    records = {}
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Invalid expected payload entry")
        name = path_name(item.get("path"), absolute=True)
        if (name != item["path"] or name == "/" or name in records
                or item.get("type") != "file" or not isinstance(item.get("sha256"), str)
                or not SHA.fullmatch(item["sha256"])
                or type(item.get("size")) is not int or not 0 <= item["size"] <= limits.file_bytes):
            raise ValueError("Non-canonical, duplicate, or non-regular expected payload")
        records[name] = item
    return value, digest, records


def preflight_oci(directory, limits):
    directory = Path(directory)
    for path in (directory, directory / "blobs", directory / "blobs/sha256"):
        if path.is_symlink() or not path.is_dir():
            raise ValueError("OCI directories must not be symlinks")
    for name, maximum in (("oci-layout", 65536), ("index.json", 4 * CHUNK)):
        read_json(directory / name, maximum)
    total = count = 0
    for path in (directory / "blobs/sha256").iterdir():
        count += 1
        if (count > 512 or not SHA.fullmatch(path.name) or path.is_symlink()
                or not stat.S_ISREG(path.stat().st_mode)):
            raise ValueError("Invalid or excessive OCI blob inventory")
        total += path.stat().st_size
        if total > limits.compressed:
            raise ValueError("OCI export exceeds the compressed byte bound")


def verified_document(directory, digest):
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
        raise ValueError("Invalid OCI document digest")
    value, observed = read_json(Path(directory) / "blobs/sha256" / digest[7:], 4 * CHUNK)
    if observed != digest[7:] or not isinstance(value, dict):
        raise ValueError("OCI metadata changed after identity verification")
    return value


def bounded_tar_info(budget):
    class BoundedTarInfo(tarfile.TarInfo):
        def _proc_member(self, archive):
            # Count extension headers too, before tarfile consumes their bodies.
            budget.check()
            budget.entries += 1
            if budget.entries > budget.limits.entries:
                raise ValueError("OCI entry count exceeds its bound")
            if not 0 <= self.size <= budget.limits.file_bytes:
                raise ValueError("Oversized OCI member")
            if self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE) and self.size > 65536:
                raise ValueError("Oversized OCI extended header")
            if self.type in (tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK) and self.size > 4097:
                raise ValueError("Oversized OCI long name")
            if self.type == tarfile.GNUTYPE_SPARSE:
                raise ValueError("Sparse OCI files are unsupported")
            return super()._proc_member(archive)

        # Reject sparse extensions before stdlib attempts to read their maps.
        def _proc_gnusparse_00(self, *args):
            raise ValueError("Sparse OCI files are unsupported")

        _proc_gnusparse_01 = _proc_gnusparse_00
        _proc_gnusparse_10 = _proc_gnusparse_00

    return BoundedTarInfo


def read_layer(directory, descriptor, diff_id, budget, captures, protected, protected_parents):
    compressed = descriptor.get("mediaType")
    if compressed not in LAYER_TYPES:
        raise ValueError("Unsupported OCI layer compression")
    path = Path(directory) / "blobs/sha256" / descriptor["digest"][7:]
    entries, deleted, opaque, seen = [], set(), set(), set()
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
        if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
            raise ValueError("OCI layer is not a regular file")
        raw = DigestReader(source, budget, descriptor["size"])
        decoded = gzip.GzipFile(fileobj=raw) if LAYER_TYPES[compressed] else raw
        stream = DigestReader(decoded, budget, budget.limits.uncompressed, uncompressed=True)
        with tarfile.open(fileobj=stream, mode="r|", tarinfo=bounded_tar_info(budget)) as archive:
            for member in archive:
                budget.check()
                name = path_name(member.name)
                if name in seen:
                    raise ValueError("Duplicate canonical path within an OCI layer")
                seen.add(name)
                if member.sparse is not None or not 0 <= member.size <= budget.limits.file_bytes:
                    raise ValueError("Sparse or oversized OCI member")
                if not member.isdir() and member.name.endswith("/"):
                    raise ValueError("Non-directory archive entry has a directory name")
                base = name.rsplit("/", 1)[-1]
                parent = name.rsplit("/", 1)[0] or "/"
                if base.startswith(".wh."):
                    if not member.isfile() or member.size != 0:
                        raise ValueError("Whiteout is not an empty regular file")
                    if base == ".wh..wh..opq":
                        opaque.add(parent)
                    else:
                        target = base[4:]
                        if target in ("", ".", "..") or target.startswith(".wh."):
                            raise ValueError("Invalid whiteout target")
                        deleted.add((parent.rstrip("/") + "/" + target))
                    continue
                node = {"layerDigest": descriptor["digest"], "mode": member.mode,
                        "uid": member.uid, "gid": member.gid}
                if member.isfile():
                    digest, size, pieces = hashlib.sha256(), 0, []
                    if name in captures and member.size > budget.limits.control_bytes:
                        raise ValueError("Oversized package control file")
                    with archive.extractfile(member) as content:
                        while chunk := content.read(CHUNK):
                            budget.check()
                            size += len(chunk)
                            digest.update(chunk)
                            if name in captures:
                                pieces.append(chunk)
                    if size != member.size:
                        raise ValueError("Truncated regular file in OCI layer")
                    node.update(kind="file", size=size, sha256=digest.hexdigest())
                    if name in captures:
                        node["content"] = b"".join(pieces)
                else:
                    if member.size:
                        raise ValueError("Non-regular OCI member carries a data payload")
                    if member.isdir():
                        node["kind"] = "directory"
                    elif member.issym():
                        if len(member.linkname.encode("utf-8")) > 4096:
                            raise ValueError("Oversized symbolic link")
                        node.update(kind="symlink", target=member.linkname)
                    elif member.islnk():
                        target = path_name(member.linkname, absolute=True)
                        if target in protected or target in protected_parents:
                            raise ValueError("Hardlink aliases package payload/control")
                        node.update(kind="hardlink", target=target)
                    elif member.isdev() or member.isfifo():
                        node["kind"] = "special"
                    else:
                        raise ValueError("Unsupported OCI tar member type")
                if node["kind"] != "directory" and name in protected_parents:
                    raise ValueError("A package ancestor is replaced by a non-directory")
                if node["kind"] != "file" and name in protected:
                    raise ValueError("Package payload/control is not a regular file")
                entries.append((name, node))
            # OCI padding after the end marker may contain zeros, not a second
            # hidden archive. Drain the tar reader's own buffer as well.
            while tail := archive.fileobj.read(CHUNK):
                if tail.strip(b"\0"):
                    raise ValueError("Non-zero bytes after the OCI tar end marker")
        if raw.count != descriptor["size"] or raw.digest.hexdigest() != descriptor["digest"][7:]:
            raise ValueError("OCI layer bytes changed during payload verification")
        if stream.digest.hexdigest() != diff_id[7:]:
            raise ValueError("Uncompressed OCI layer does not match config diff_id")
        if LAYER_TYPES[compressed]:
            decoded.close()
    return entries, deleted, opaque


def apply_layer(nodes, entries, deleted, opaque, budget):
    # Whiteouts hide lower layers only, irrespective of tar member order.
    for name in list(nodes):
        if name == "/":
            continue
        ancestors = parents(name)
        if any(path in deleted for path in [name, *ancestors]) or any(path in opaque for path in ancestors):
            del nodes[name]
    pending = set()
    for name, node in entries:
        budget.check()
        for ancestor in parents(name) if name != "/" else []:
            previous = nodes.get(ancestor)
            if previous is None:
                nodes[ancestor] = {"kind": "directory", "implicit": True}
            elif previous["kind"] != "directory":
                raise ValueError("OCI member would write through a non-directory ancestor")
        if node["kind"] != "directory" and nodes.get(name, {}).get("kind") == "directory":
            for child in list(nodes):
                if child.startswith(name.rstrip("/") + "/"):
                    del nodes[child]
        nodes[name] = node
        if len(nodes) > budget.limits.entries:
            raise ValueError("Merged OCI node count exceeds its bound")
        if node["kind"] == "hardlink":
            target = nodes.get(node["target"])
            if target and target["kind"] in ("file", "hardlink") and target.get("sha256"):
                node.update(sha256=target["sha256"], size=target["size"])
            else:
                pending.add(name)

    def resolve(name, visited):
        if len(visited) >= 64 or name in visited:
            raise ValueError("Cyclic or excessive hardlink chain")
        node = nodes.get(name)
        if not node or node["kind"] not in ("file", "hardlink"):
            raise ValueError("Unresolved or non-regular hardlink target")
        if not node.get("sha256"):
            target = resolve(node["target"], {*visited, name})
            node.update(sha256=target["sha256"], size=target["size"])
        return node

    for name in pending:
        resolve(name, set())


def merge_oci(directory, identity, expected, package, budget):
    name, arch = package["name"], package["architecture"]
    status_path = "/var/lib/dpkg/status"
    lists = (f"/var/lib/dpkg/info/{name}.list", f"/var/lib/dpkg/info/{name}:{arch}.list")
    captures = {status_path, *lists}
    protected = set(expected) | captures
    protected_parents = {ancestor for path in protected for ancestor in parents(path)}
    document = verified_document(directory, identity["manifestDigest"])
    config = verified_document(directory, identity["configDigest"])
    layers = audit.object_records(document.get("layers"), "OCI layers")
    rootfs = audit.object_value(config.get("rootfs"), "OCI rootfs")
    diff_ids = rootfs.get("diff_ids")
    if (rootfs.get("type") != "layers" or not isinstance(diff_ids, list) or len(diff_ids) != len(layers)
            or not 1 <= len(layers) <= budget.limits.layers
            or any(not isinstance(value, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", value) for value in diff_ids)
            or [layer["digest"] for layer in layers] != identity["layerDigests"]):
        raise ValueError("Invalid or inconsistent OCI rootfs layer chain")
    nodes = {"/": {"kind": "directory"}}
    for layer, diff_id in zip(layers, diff_ids):
        entries, deleted, opaque = read_layer(directory, layer, diff_id, budget, captures, protected, protected_parents)
        apply_layer(nodes, entries, deleted, opaque, budget)
    return nodes, status_path, lists


def parse_control(content, package_name):
    text = content.decode("utf-8")
    found = []
    for paragraph in re.split(r"\n\s*\n", text):
        values, last = {}, None
        for line in paragraph.splitlines():
            if line.startswith((" ", "\t")) and last:
                values[last] += "\n" + line
                continue
            if ":" not in line:
                if line:
                    raise ValueError("Malformed dpkg status paragraph")
                continue
            key, value = line.split(":", 1)
            if key in values:
                raise ValueError("Duplicate dpkg control field")
            values[key], last = value.strip(), key
        if values.get("Package") == package_name:
            found.append(values)
    if len(found) != 1:
        raise ValueError("Expected exactly one installed dpkg package stanza")
    value = found[0]
    return {"name": value.get("Package"), "version": value.get("Version"),
            "architecture": value.get("Architecture"), "sourceField": value.get("Source", value.get("Package")),
            "status": value.get("Status")}


def scanner_package(scan, identity, expected, package):
    audit.object_value(scan, "scanner report")
    metadata = audit.object_value(scan.get("Metadata"), "scanner metadata")
    os_metadata = audit.object_value(metadata.get("OS"), "scanner OS")
    if (scan.get("SchemaVersion") != 2 or scan.get("ArtifactType") != "container_image"
            or metadata.get("ImageID") != identity["configDigest"]
            or os_metadata.get("Family") != "ubuntu"):
        raise ValueError("Scanner report is not the verified Ubuntu image")
    results = audit.object_records(scan.get("Results"), "scanner results")
    selected = [item for result in results
                if result.get("Class") == "os-pkgs" and result.get("Type") == "ubuntu"
                for item in audit.object_records(result.get("Packages"), "scanner packages")
                if item.get("Name") == package["name"]]
    if len(selected) != 1:
        raise ValueError("Scanner package identity is absent or ambiguous")
    item = selected[0]
    version = str(item.get("Version", ""))
    if item.get("Release"):
        version += "-" + str(item["Release"])
    if item.get("Epoch"):
        version = str(item["Epoch"]) + ":" + version
    if version != package["version"] or item.get("Arch") != package["architecture"]:
        raise ValueError("Scanner package version/architecture differs from expected package")
    source = re.fullmatch(r"([a-z0-9][a-z0-9+.-]+)(?: \(([^()\s]+)\))?", package["sourceField"])
    source_version = str(item.get("SrcVersion", ""))
    if item.get("SrcRelease"):
        source_version += "-" + str(item["SrcRelease"])
    if item.get("SrcEpoch"):
        source_version = str(item["SrcEpoch"]) + ":" + source_version
    if (not source or item.get("SrcName") != source[1]
            or source_version != (source[2] or package["version"])):
        raise ValueError("Scanner source package/version differs from expected control")
    listed = item.get("InstalledFiles")
    if not isinstance(listed, list):
        raise ValueError("Scanner package has no installed-file inventory")
    paths = [path_name(path, absolute=True) for path in listed]
    if paths != listed or len(paths) != len(set(paths)) or set(paths) != set(expected):
        raise ValueError("Scanner installed-file set differs from the expected payload")
    layer = audit.object_value(item.get("Layer"), "scanner package layer")
    if layer.get("Digest") not in identity["layerDigests"]:
        raise ValueError("Scanner package layer is outside the verified image")
    keys = ("ID", "Name", "Version", "Release", "Epoch", "Arch", "SrcName", "SrcVersion", "SrcRelease", "SrcEpoch", "Identifier", "Layer", "AnalyzedBy")
    counts = Counter({severity: 0 for severity in audit.SEVERITIES})
    for result in results:
        for finding in audit.object_records(result.get("Vulnerabilities"), "scanner findings"):
            severity = finding.get("Severity", "UNKNOWN")
            if severity not in counts or not finding.get("VulnerabilityID"):
                raise ValueError("Malformed original scanner finding")
            counts[severity] += 1
    return {"imageId": identity["configDigest"], "package": {key: item[key] for key in keys if key in item},
            "installedFileCount": len(paths), "installedFilesSha256": path_digest(paths), "findingCounts": dict(counts)}


def compare_payload(nodes, expected, package, status_path, list_paths):
    status = nodes.get(status_path)
    if not status or status["kind"] != "file" or "content" not in status:
        raise ValueError("Merged image lacks regular dpkg status")
    observed = parse_control(status["content"], package["name"])
    if observed != {**package, "status": "install ok installed"}:
        # expected package schema is intentionally a small exact control projection.
        raise ValueError("Actual dpkg control/source/version/architecture differs")
    found = [path for path in list_paths if path in nodes]
    if len(found) != 1 or nodes[found[0]]["kind"] != "file" or "content" not in nodes[found[0]]:
        raise ValueError("Missing, ambiguous, or non-regular dpkg owned-file list")
    list_path, listed = found[0], nodes[found[0]]
    raw_paths = listed["content"].decode("utf-8").splitlines()
    paths = [path_name(line, absolute=True) for line in raw_paths]
    if any(path != raw and not (path == "/" and raw == "/.") for path, raw in zip(paths, raw_paths)):
        raise ValueError("Non-canonical path in dpkg owned-file list")
    if len(paths) != len(set(paths)):
        raise ValueError("Duplicate canonical path in dpkg owned-file list")
    owned_files, declared_non_directories, directories = set(), set(), []
    for path in paths:
        node = nodes.get(path)
        if node and node["kind"] == "directory":
            directories.append(path)
        else:
            declared_non_directories.add(path)
            if node and node["kind"] == "file":
                owned_files.add(path)
    extra = sorted(declared_non_directories - set(expected))
    missing_owned = sorted(set(expected) - owned_files)
    files = []
    counts = Counter()
    for path, item in sorted(expected.items()):
        node = nodes.get(path)
        state = "MISSING" if node is None else "NON_REGULAR" if node["kind"] != "file" else (
            "MATCH" if node["sha256"] == item["sha256"] and node["size"] == item["size"] else "CHANGED")
        counts[state] += 1
        files.append({"path": path, "state": state, "expectedSha256": item["sha256"], "expectedSize": item["size"],
                      "actualSha256": node.get("sha256") if node else None, "actualSize": node.get("size") if node else None,
                      "layerDigest": node.get("layerDigest") if node else None})
    control = {"state": "MATCH" if not extra and not missing_owned else "MISMATCH",
               "observed": observed, "statusPath": status_path, "statusSha256": status["sha256"],
               "listPath": list_path, "listSha256": listed["sha256"], "ownedRegularFileCount": len(owned_files),
               "ownedDirectoryCount": len(directories), "ownedFilesSha256": path_digest(owned_files)}
    payload = {"expectedFiles": len(expected), "matchedFiles": counts["MATCH"], "missingFiles": counts["MISSING"],
               "changedFiles": counts["CHANGED"], "nonRegularFiles": counts["NON_REGULAR"],
               "unexpectedOwnedFiles": extra, "missingOwnedFiles": missing_owned, "files": files}
    matched = counts["MATCH"] == len(expected) and not extra and not missing_owned
    return control, payload, matched


def verify(directory, build_digest, manifest_path, scan_path, limits=Limits()):
    budget = Budget(limits)
    report = {"schemaVersion": 1, "kind": "oci-package-payload-comparison", "state": "ERROR",
              "observedAt": None, "verifierSourceSha256": audit.sha256(__file__),
              "sourceSha256": {"scripts/verify_image_payload.py": audit.sha256(__file__),
                               "scripts/image_audit.py": audit.sha256(audit.__file__)},
              "execution": {"containersStarted": False, "filesystemExtraction": False},
              "errors": []}
    try:
        manifest, manifest_hash, expected = expected_payload(manifest_path, limits)
        report["expectedManifest"] = {"sha256": manifest_hash, "package": manifest["package"],
                                      "archiveSha256": manifest["archive"]["sha256"], "fileCount": len(expected)}
        preflight_oci(directory, limits)
        report["identity"] = audit.inspect_oci(directory, build_digest)
        budget.check()
        scan, scan_hash = read_json(scan_path, limits.json_bytes)
        report["scan"] = {**scanner_package(scan, report["identity"], expected, manifest["package"]), "sha256": scan_hash}
        config = verified_document(directory, report["identity"]["configDigest"])
        diff_ids = audit.object_value(config.get("rootfs"), "OCI rootfs").get("diff_ids")
        package_layer = report["scan"]["package"]["Layer"]
        layer_index = report["identity"]["layerDigests"].index(package_layer["Digest"])
        if (not isinstance(diff_ids, list) or layer_index >= len(diff_ids)
                or package_layer.get("DiffID") != diff_ids[layer_index]):
            raise ValueError("Scanner package layer diff_id differs from verified config")
        nodes, status_path, lists = merge_oci(directory, report["identity"], expected, manifest["package"], budget)
        control, payload, matched = compare_payload(nodes, expected, manifest["package"], status_path, lists)
        report.update(packageControl=control, payload=payload, state="MATCH" if matched else "MISMATCH")
        if not matched:
            report["errors"].append("Actual package payload or ownership differs from the expected byte manifest")
    except (ValueError, OSError, UnicodeError, tarfile.TarError, EOFError, KeyError, TypeError, RecursionError, TimeoutError) as error:
        report["errors"].append(str(error))
    report["observedAt"] = datetime.now(timezone.utc).isoformat()
    report["execution"].update(elapsedSeconds=time.monotonic() - budget.started,
                               uncompressedLayerBytes=budget.uncompressed, archiveEntries=budget.entries)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--oci", type=Path, required=True)
    parser.add_argument("--build-digest", required=True)
    parser.add_argument("--expected-manifest", type=Path, required=True)
    parser.add_argument("--scan-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if (destination.is_relative_to(args.oci.resolve())
            or destination in {args.expected_manifest.resolve(), args.scan_report.resolve()}
            or args.output.exists()):
        parser.error("Output must be a new report outside the read-only inputs")
    def expired(_signal, _frame):
        raise TimeoutError("Payload verification exceeded its finite deadline")
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(Limits().seconds)
    try:
        report = verify(args.oci, args.build_digest, args.expected_manifest, args.scan_report)
    finally:
        signal.alarm(0)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(json.dumps({"state": report["state"], "matchedFiles": report.get("payload", {}).get("matchedFiles"),
                      "errors": report["errors"]}))
    return {"MATCH": 0, "MISMATCH": 2, "ERROR": 1}[report["state"]]


if __name__ == "__main__":
    raise SystemExit(main())
