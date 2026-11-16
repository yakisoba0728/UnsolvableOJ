#!/usr/bin/env python3
"""Bounded independent raw CNA retrieval. Does not modify a policy or repository."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args()
    assert re.fullmatch(r"[a-f0-9]{40}", args.commit)
    inventory_bytes = args.inventory.read_bytes()
    inventory = json.loads(inventory_bytes)
    args.out_dir.mkdir(parents=True, exist_ok=False)
    begun = now()

    def fetch(entry):
        identifier = entry["id"]
        assert re.fullmatch(r"CVE-\d{4}-\d{4,}", identifier)
        _, year, number = identifier.split("-")
        url = f"https://raw.githubusercontent.com/CVEProject/cvelistV5/{args.commit}/cves/{year}/{number[:-3]}xxx/{identifier}.json"
        errors = []
        for attempt in range(1, 4):
            try:
                with urlopen(Request(url, headers={"User-Agent":"UnsolvableOJ-independent-component-review"}), timeout=12) as response:
                    assert response.status == 200
                    raw = response.read(2 * 1024 * 1024 + 1)
                    assert len(raw) <= 2 * 1024 * 1024
                    final_url = response.url
                document = json.loads(raw)
                assert document["cveMetadata"]["cveId"] == identifier
                provider = document["containers"]["cna"]["providerMetadata"].get("shortName")
                assert provider == "Linux"
                body_hash = sha(raw)
                return raw, {"id":identifier, "url":url, "finalUrl":final_url, "retrievedAt":now(), "attempts":attempt, "errorsBeforeSuccess":errors, "size":len(raw), "sha256":body_hash, "previousSha256":entry["cnaRecordSha256"], "byteHashMatchesPreviousInventory":body_hash == entry["cnaRecordSha256"], "provider":provider, "dateUpdated":document["cveMetadata"].get("dateUpdated")}
            except Exception as error:
                errors.append(type(error).__name__ + ": " + str(error))
        return None, {"id":identifier,"url":url,"attempts":3,"errors":errors,"failed":True}

    results = []
    bodies = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        futures = [pool.submit(fetch, entry) for entry in inventory["entries"]]
        for future in as_completed(futures):
            raw, receipt = future.result()
            results.append(receipt)
            if raw is not None:
                bodies[receipt["id"]] = raw
            if len(results) % 30 == 0:
                print(json.dumps({"completed":len(results),"successful":len(bodies)}), flush=True)
    archive = args.out_dir / "current-cna-records.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for identifier in sorted(bodies):
            info = zipfile.ZipInfo(identifier + ".json", (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, bodies[identifier])
    failed = [r["id"] for r in results if r.get("failed")]
    changed = [r["id"] for r in results if not r.get("failed") and not r["byteHashMatchesPreviousInventory"]]
    report = {"schemaVersion":1, "reviewer":"independent_recovery", "source":"Independent HTTPS retrieval of immutable Linux CNA records; raw response bytes preserved", "startedAt":begun,"finishedAt":now(), "repository":"CVEProject/cvelistV5", "repositoryCommit":args.commit,"previousInventorySha256":sha(inventory_bytes),"sourceScriptSha256":sha(Path(__file__).read_bytes()),"maxWorkers":6,"maxAttemptsPerRecord":3,"timeoutSecondsPerRequest":12,"recordByteLimit":2*1024*1024,"expectedCount":len(inventory["entries"]),"retrievedCount":len(bodies),"failed":failed,"changed":changed,"allRawHashesMatch":not failed and not changed,"archiveSha256":sha(archive.read_bytes()),"records":sorted(results,key=lambda r:r["id"]),"limits":["Byte identity supports carrying forward the prior component assessments; it does not establish host kernel safety or eliminate scanner findings.","This retrieval is independent of the policy author's collector and does not approve any active policy."]}
    (args.out_dir / "current-cna-independent-receipt.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({k:report[k] for k in ("finishedAt","repositoryCommit","expectedCount","retrievedCount","failed","changed","allRawHashesMatch","archiveSha256")},indent=2))
    if failed or changed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
