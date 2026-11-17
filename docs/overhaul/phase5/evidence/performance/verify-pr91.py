"""PR91 retained-evidence arithmetic, called by verify-performance.py.

No service, subprocess, Git or network access. All raw inputs and source receipts
are retained beside the parent verifier. This does not rerun database or Judge
experiments, reconstruct missing database rows, or authenticate GitHub anew.
"""

from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
import zipfile


REPO_URL = "https://github.com/yakisoba0728/UnsolvableOJ"
RUN = 43905864054
SOURCE = "281d0f1a30cd772cf7417e3affb8c98be252f405"
CHECKOUT = "9aa843fad33b30270ab346bc62c4865c17697ff3"
TREE = "0f191c89a17b984cae8706cb02137ab0e4e2c3a4"
BASE = "e8b08d6ab86181859d9491d15d1881a6b10262eb"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_sha(data):
    return sha(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())


def nodes(node):
    yield node
    for child in node.get("Plans", []):
        yield from nodes(child)


def artifact_json(directory, metadata, artifact_id, filename, member, check, same):
    receipt = next(a for a in metadata["artifacts"] if a["id"] == artifact_id)
    original = (directory / filename).read_bytes()
    same("sha256:" + sha(original), receipt["digest"], "PR91 original ZIP digest " + filename)
    same(len(original), receipt["size_in_bytes"], "PR91 original ZIP bytes " + filename)
    same(receipt["workflow_run"]["id"], RUN, "PR91 artifact run")
    same(receipt["workflow_run"]["head_sha"], SOURCE, "PR91 artifact source")
    with zipfile.ZipFile(directory / filename) as archive:
        raw = archive.read(member)
    same(raw, (directory / member).read_bytes(), "PR91 exact JSON member " + member)
    binding = {"artifactId": artifact_id, "artifactUrl": REPO_URL + f"/actions/runs/{RUN}/artifacts/{artifact_id}",
               "zipBytes": len(original), "zipSha256": sha(original), "jsonBytes": len(raw),
               "jsonSha256": sha(raw), "member": member}
    return json.loads(raw), binding


def verify_source_receipts(directory, metadata, check, same):
    same(metadata["run"]["id"], RUN, "PR91 run ID")
    same(metadata["run"]["head_sha"], SOURCE, "PR91 workflow source")
    same(metadata["source"]["sha"], SOURCE, "PR91 source receipt")
    same(metadata["source"]["tree"], TREE, "PR91 source tree")
    same(metadata["checkout"]["sha"], CHECKOUT, "PR91 actual checkout")
    same(metadata["checkout"]["tree"], TREE, "PR91 checkout tree")
    same(metadata["checkout"]["parents"], [BASE, SOURCE], "PR91 merge parents")
    proof = json.loads((directory / "source-proof.json").read_bytes())
    same(len(proof["sourceFiles"]), 5, "PR91 retained source receipts")
    for receipt in proof["sourceFiles"]:
        payload = (directory / receipt["retainedPath"]).read_bytes()
        same(receipt["ref"], SOURCE, "PR91 source snapshot ref")
        same(len(payload), receipt["bytes"], "PR91 source snapshot bytes")
        same(sha(payload), receipt["sha256"], "PR91 source snapshot SHA256")
        same(hashlib.sha1(b"blob " + str(len(payload)).encode() + b"\0" + payload).hexdigest(),
             receipt["gitBlob"], "PR91 source snapshot Git blob")
    return proof


def backend_observations(directory, metadata, foundation, check, same, quant):
    proof = verify_source_receipts(directory, metadata, check, same)
    db, db_binding = artifact_json(directory, metadata, 14244922097, "database.zip", "phase5-database.json", check, same)
    same(db["schemaVersion"], 1, "actual DB schema is 1, not anticipated schema2")
    same(db["status"], "PASS", "PR91 DB observation status")
    same(db["source"]["head"], CHECKOUT, "PR91 DB actual checkout")
    same(db["source"]["tree"], TREE, "PR91 DB tree")
    same(db["source"]["dirtyPaths"], "", "PR91 DB clean measured source")
    same(db["source"]["hashes"], foundation["database"]["source"]["hashes"], "DB harness/measured source hashes unchanged from local sample")
    same(db["limits"], foundation["database"]["limits"], "same declared DB harness limits")
    same(db["fixture"], foundation["database"]["fixture"], "same finite DB fixture counts")
    same(db["migrations"], 31, "PR91 DB migrations")
    same(len(db["measurements"]), 7, "PR91 DB workloads")
    same(db["cleanup"], {"created": True, "dropped": True}, "PR91 DB generated database cleanup")
    workflow = (directory / "source-snapshots/ci.yml").read_text()
    check("--memory 512m --cpus 1" in workflow and "--tmpfs /var/lib/postgresql/data:rw,nosuid,size=256m" in workflow,
          "retained workflow PostgreSQL declarations")
    check("--memory 128m --cpus 1 --tmpfs /data:rw,nosuid,size=64m" in workflow,
          "retained workflow Redis declarations")
    settings = {s["name"]: {"setting": s["setting"], "unit": s["unit"]} for s in db["environment"]["settings"]}
    same(settings["shared_buffers"], {"setting": "16384", "unit": "8kB"}, "actual CI shared buffers 128MiB")
    same(settings["temp_file_limit"], {"setting": "32768", "unit": "kB"}, "DB inherited temp limit 32MiB")
    same(settings["statement_timeout"], {"setting": "15000", "unit": "ms"}, "DB actual statement timeout")
    same(settings["lock_timeout"], {"setting": "2000", "unit": "ms"}, "DB actual lock timeout")
    for key in ("fsync", "full_page_writes", "synchronous_commit"):
        same(settings[key]["setting"], "on", "DB durability setting " + key)
    reads = []
    for measurement, expected_rows in zip(db["measurements"][:5], [50, 50, 1, 5000, 1]):
        samples = measurement["samples"]
        same(len(samples), 5, "PR91 DB read n5")
        same([s["rows"] for s in samples], [expected_rows] * 5, "PR91 DB returned row counts")
        values = [s["elapsedMs"] for s in samples]
        q = quant(values)
        for key in ("p50", "p95", "p99"):
            same(q[key], measurement[key + "Ms"], "PR91 DB recorded query quantile")
        same(q["p95"], max(values), "PR91 n5 p95 sample maximum")
        same(q["p99"], max(values), "PR91 n5 p99 sample maximum")
        same(len({s["resultDigest"] for s in samples}), 1, "PR91 DB repeated result digest stable")
        rss = [s[k] for s in samples for k in ("clientRssBytesBefore", "clientRssBytesAfter")]
        plan = measurement["plan"]
        top_keys = ("Node Type", "Plan Rows", "Actual Rows", "Actual Loops", "Shared Hit Blocks", "Shared Read Blocks",
                    "Shared Dirtied Blocks", "Shared Written Blocks", "Temp Read Blocks", "Temp Written Blocks", "WAL Bytes")
        node_keys = ("Node Type", "Relation Name", "Index Name", "Plan Rows", "Actual Rows", "Actual Loops",
                     "Rows Removed by Filter", "Sort Method", "Sort Space Used", "Sort Space Type")
        scans_sorts = [{key: n[key] for key in node_keys if key in n} for n in nodes(plan["Plan"])
                       if "Scan" in n["Node Type"] or n["Node Type"] == "Sort"]
        reads.append({"label": measurement["label"], "rawMs": values, "queryLatencyMs": q,
                      "returnedRows": expected_rows, "resultDigest": samples[0]["resultDigest"],
                      "rawClientCpuMs": [s["clientCpuMs"] for s in samples], "clientCpuMsTotal": sum(s["clientCpuMs"] for s in samples),
                      "rawClientRssBeforeBytes": [s["clientRssBytesBefore"] for s in samples],
                      "rawClientRssAfterBytes": [s["clientRssBytesAfter"] for s in samples],
                      "clientRssBytesRange": [min(rss), max(rss)],
                      "explain": {"executionMs": plan["Execution Time"], "planningMs": plan["Planning Time"],
                                  "canonicalJsonSha256": canonical_sha(plan),
                                  "topNode": {key: plan["Plan"][key] for key in top_keys if key in plan["Plan"]},
                                  "scanAndSortNodes": scans_sorts}})
    stats, bulk = db["measurements"][-2:]
    same(stats["oracle"], {"solver_count": 5000, "accepted_count": 5000, "finished_count": 5000}, "PR91 distinct solver recount")
    same(bulk["initial"], {"solver_count": 256, "accepted_count": 256, "finished_count": 256}, "PR91 bulk initial recount")
    same(bulk["afterRollback"], {"solver_count": 0, "accepted_count": 0, "finished_count": 256}, "PR91 bulk rollback restores committed state")
    maximum_size = max(s["databaseBytes"] for s in db["stages"])
    check(maximum_size < db["limits"]["databaseBytes"], "PR91 owned database inside cap")
    stage_sum = sum(s["elapsedMs"] for s in db["stages"])
    check(0 < stage_sum <= db["elapsedMs"] < db["limits"]["durationMs"], "PR91 finite DB intervals")
    db_summary = {
        **db_binding, "schemaVersion": db["schemaVersion"], "status": db["status"], "source": db["source"],
        "environment": db["environment"], "fixture": db["fixture"], "limits": db["limits"], "methodology": db["methodology"],
        "migrations": db["migrations"], "cleanup": db["cleanup"], "readSamples": reads,
        "distinctSolvers": stats, "bulk": bulk, "maximumDatabaseBytes": maximum_size,
        "stages": db["stages"], "stageElapsedSumMs": stage_sum, "elapsedMs": db["elapsedMs"],
        "outsideRecordedStageIntervalsMs": db["elapsedMs"] - stage_sum,
        "sameHarnessAndMeasuredFileHashesAsLocal": True,
        "declaredWorkflowServiceCaps": {"postgresMemoryBytes": 512 * 1024**2, "postgresCpuQuotaCores": 1,
            "postgresDataTmpfsBytes": 256 * 1024**2, "redisMemoryBytes": 128 * 1024**2,
            "redisCpuQuotaCores": 1, "redisDataTmpfsBytes": 64 * 1024**2,
            "scope": "Declarations verified in retained workflow source, not measured service peak memory or CPU."},
        "limitations": ["Different host/runtime/settings from local execution; no causal before/after speedup or regression claim.",
            "All read queries are serial and warmed. SQL driver transfer/decoding is timed; full HTTP/CSV serialization is outside this interval.",
            "Node RSS values are endpoint samples of the client retaining data/evidence, not PostgreSQL/API peak RSS or isolated allocation.",
            "Full EXPLAIN JSON is retained in the original report. Parent/child buffer values are not summed; EXPLAIN execution is separate from timed queries.",
            "Cluster WAL endpoints are not retained for independent LSN subtraction. Reported cluster WAL and plan WAL have different scopes.",
            "Trigger-internal temporary IO and actual transition-table source materialization are not fully measured."],
    }

    restored, restore_binding = artifact_json(directory, metadata, 14245512021, "restore.zip", "phase4-restore.json", check, same)
    same(restored["schemaVersion"], 2, "PR91 enriched restore schema")
    same(restored["result"], "PASS", "PR91 enriched restore result")
    same(restored["source"], CHECKOUT, "PR91 restore actual checkout")
    same(int(restored["workflowRunId"]), RUN, "PR91 restore workflow run")
    same(restored["migrations"], 31, "PR91 restore migrations")
    products = restored["fixture"]["products"]
    for key, expected in {"goals": 12, "problemVersions": 24, "solves": 128, "assessments": 1,
                          "candidates": 8, "algorithmPins": 1, "vibePins": 1, "assessmentSubmissions": 8,
                          "workspaces": 8, "revisions": 16}.items():
        same(products[key], expected, "restored synthetic product fixture " + key)
    for key in ("xpMatchesLedger", "solveEvidenceMatches", "assessmentSubmissionOwnershipVersionsMatch", "workspaceOwnershipVersionsMatch"):
        same(products[key], True, "restore logical invariant " + key)
    same(restored["fixture"]["ordinaryFixtureSubmissions"] + products["assessmentSubmissions"],
         restored["fixture"]["submissions"], "restore fixture submission total")
    same(restored["writerBarrier"], {"mode": "SHARE", "tables": 37, "concurrentWriteRefused": True, "heldThroughDump": True}, "stop writer barrier")
    same(len(restored["tables"]), 37, "restore all table fingerprints")
    same(len({t["table"] for t in restored["tables"]}), 37, "restore unique table names")
    table_rows = {t["table"]: t["rows"] for t in restored["tables"]}
    for name, expected in {"learning_goals": 12, "problem_versions": 24, "users": 128, "user_problem_solves": 128,
                           "enterprise_attempts": 8, "submissions": 2056, "vibe_attempts": 8, "vibe_revisions": 16}.items():
        same(table_rows[name], expected, "restore reported table count " + name)
    check(all(restored["databaseBytes"][name] < restored["databaseBytes"]["capEach"] for name in ("source", "restored")), "restore both database caps")
    same(restored["cleanup"], "both generated databases removed", "restore owned cleanup")
    names = [s["name"] for s in restored["stages"]]
    check("empty final migration rollback and reapply" in names and
          "populated goal rollback refusal and product history preservation" in names, "two distinct rollback checks")
    restore_stage_sum = sum(s["elapsedMs"] for s in restored["stages"])
    check(0 < restore_stage_sum <= restored["elapsedMs"], "restore recorded stage interval sum")
    restore_summary = {
        **restore_binding, "schemaVersion": restored["schemaVersion"], "status": restored["result"],
        "sourceCheckout": restored["source"], "workflowRunId": restored["workflowRunId"],
        "migrations": restored["migrations"], "fixture": restored["fixture"], "writerBarrier": restored["writerBarrier"],
        "databaseBytes": restored["databaseBytes"], "reportedArchive": restored["archive"],
        "archiveBytesRetained": False, "tables": restored["tables"], "tableCount": len(restored["tables"]),
        "nonemptyTableCount": sum(t["rows"] > 0 for t in restored["tables"]),
        "sumReportedTableRows": sum(t["rows"] for t in restored["tables"]),
        "schemaComparison": restored["schemaComparison"], "stages": restored["stages"],
        "stageElapsedSumMs": restore_stage_sum, "elapsedMs": restored["elapsedMs"],
        "outsideRecordedStageIntervalsMs": restored["elapsedMs"] - restore_stage_sum,
        "cleanup": restored["cleanup"], "limitations": restored["limits"] + [
            "One rehearsal and one timing per stage, not statistical recovery-success rates or production RTO/RPO.",
            "The ZIP retains the report, not the dump archive or table data. Offline verification checks report integrity/counts, not a replay of dump/restore or row-hash computation.",
            "Full schema/table comparison and populated rollback refusal were executed by the harness; retained fingerprints are that execution's observations."],
    }
    return {"sourceProof": proof, "database": db_summary, "restore": restore_summary}


def epoch_ms(value):
    delta = datetime.fromisoformat(value.replace("Z", "+00:00")) - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return delta.days * 86400000 + delta.seconds * 1000 + delta.microseconds // 1000


def maximum_overlap(intervals):
    events = sorted([(start, 1) for start, end in intervals] + [(end, -1) for start, end in intervals])
    active = peak = 0
    for time, delta in events:
        active += delta
        peak = max(peak, active)
    return peak


def multi_api_observation(directory, metadata, check, same, quant):
    data, binding = artifact_json(directory, metadata, 14246816098, "multi-api.zip", "phase5-multi-api.json", check, same)
    same(data["schemaVersion"], 1, "multi-API schema")
    same(data["status"], "PASS", "multi-API observed result")
    provenance = data["provenance"]
    for key, expected in {"sourceHeadSha": SOURCE, "checkoutSha": CHECKOUT, "treeSha": TREE, "baseSha": BASE,
                          "runId": str(RUN), "runAttempt": "1", "trackedTreeClean": True}.items():
        same(provenance[key], expected, "multi-API provenance " + key)
    same(data["inProcessNestContexts"], 0, "actual API child processes")
    same(data["preSetupThrottleResets"], 1, "one reset before setup")
    same(data["admission"]["requests"], 8, "eight admitted requests")
    same(data["admission"]["maximumActiveLanes"], 3, "three finite admission lanes")
    same(data["admission"]["counterResetsDuringProtocol"], 0, "no protocol counter reset")
    same(data["admission"]["submissionRetries"], 0, "no submission retry")
    same(data["admission"]["solverRole"], "USER", "ordinary solver")
    for key, expected in {"submissions": 8, "languages": 8, "solverAccounts": 1, "apiProcesses": 2,
                          "workerProcesses": 2, "concurrencyPerWorker": 1, "submissionRateLimit": 20,
                          "submissionWindowMs": 60000, "providerCalls": 0}.items():
        same(data["limits"][key], expected, "multi-API bounded fixture " + key)
    check(data["scenarioElapsedMs"] < data["limits"]["scenarioMs"], "multi-API action deadline")
    check(data["scenarioElapsedMs"] < data["elapsedMs"] < data["limits"]["totalBudgetMs"], "multi-API total recorded deadline")
    jobs = sorted(data["observations"], key=lambda x: x["index"])
    same(len(jobs), 8, "multi-API job count")
    same([j["language"] for j in jobs], ["C", "CPP", "JAVA", "PYTHON", "JAVASCRIPT", "TYPESCRIPT", "GO", "RUST"], "all eight native languages")
    same(len({j["submissionId"] for j in jobs}), 8, "unique submissions")
    same(len({j["persisted"]["attempt"] for j in jobs}), 8, "unique fenced attempts")
    same(dict(Counter(j["apiIndex"] for j in jobs)), {0: 4, 1: 4}, "two API submission participation")
    same(sorted(j["rateLimit"]["remaining"] for j in jobs), list(range(12, 20)), "shared admission counter values")
    fixture_proof = json.loads((directory / "native-fixture-source-proof.json").read_bytes())
    fixture_raw = (directory / fixture_proof["retainedPath"]).read_bytes()
    same(fixture_proof["ref"], SOURCE, "native fixture ref")
    same(sha(fixture_raw), fixture_proof["sha256"], "native fixture SHA256")
    same(hashlib.sha1(b"blob " + str(len(fixture_raw)).encode() + b"\0" + fixture_raw).hexdigest(), fixture_proof["gitBlob"], "native fixture Git blob")
    fixture = json.loads(fixture_raw)
    metrics = [m for worker in data["workerMeasurements"] for m in worker["rows"]]
    same(len(metrics), 8, "eight worker completion metrics")
    by_id = {m["submissionId"]: m for m in metrics}
    same(set(by_id), {j["submissionId"] for j in jobs}, "worker/submission metric binding")
    same(len({m["workerId"] for m in metrics}), 2, "two actual worker identities")
    first_arrival = min(j["submittedAtEpochMs"] for j in jobs)
    timelines = []
    for job in jobs:
        queue = job["queue"]
        stored = job["persisted"]
        metric = by_id[job["submissionId"]]
        same(job["httpStatus"], 202, "multi-API HTTP admission")
        same(job["rateLimit"]["limit"], 20, "shared rate limit remains enabled")
        check(0 <= job["rateLimit"]["resetSeconds"] <= 60, "bounded admission reset header")
        same(job["sourceSha256"], sha(fixture[job["language"]].encode()), "exact immutable native source")
        same(stored["sourceSha256"], job["sourceSha256"], "persisted native source hash")
        for key, expected in {"state": "completed", "attemptsMade": 1, "attemptsStarted": 1, "generation": 1}.items():
            same(queue[key], expected, "single complete BullMQ attempt")
        for key, expected in {"status": "ACCEPTED", "generation": 1, "recoveries": 0, "learned": True,
                              "isTest": False, "passedTestCases": 1, "totalTestCases": 1, "notifications": 1}.items():
            same(stored[key], expected, "persisted multi-API invariant " + key)
        same(metric["status"], "ACCEPTED", "worker acceptance")
        same(metric["generation"], 1, "worker generation")
        same(job["readThroughApiIndex"], 1 - job["apiIndex"], "read through opposite submitting API")
        same(job["replayThroughApiIndex"], 1 - job["workerIndex"], "replay through opposite worker-linked API")
        same(job["finalClaimHttpStatus"], 409, "terminal claim fenced")
        same(job["duplicateResultHttpStatus"], 200, "duplicate callback idempotent")
        check(job["submittedAtEpochMs"] <= queue["timestampEpochMs"] <= queue["processedOnEpochMs"] < queue["finishedOnEpochMs"], "raw queue clock ordering")
        created, updated = epoch_ms(stored["createdAt"]), epoch_ms(stored["updatedAt"])
        check(created <= updated, "DB row timestamp order; no commit-time claim")
        timelines.append({"index": job["index"], "language": job["language"], "apiIndex": job["apiIndex"],
                          "workerIndex": job["workerIndex"], "submissionId": job["submissionId"],
                          "submittedAtEpochMs": job["submittedAtEpochMs"], "acknowledgedAtEpochMs": job["acknowledgedAtEpochMs"],
                          "queuedAtEpochMs": queue["timestampEpochMs"], "startedAtEpochMs": queue["processedOnEpochMs"],
                          "finishedAtEpochMs": queue["finishedOnEpochMs"], "dbCreatedAtEpochMs": created, "dbUpdatedAtEpochMs": updated,
                          "arrivalOffsetMs": job["submittedAtEpochMs"] - first_arrival,
                          "queuedOffsetMs": queue["timestampEpochMs"] - first_arrival,
                          "startedOffsetMs": queue["processedOnEpochMs"] - first_arrival,
                          "finishedOffsetMs": queue["finishedOnEpochMs"] - first_arrival,
                          "apiMonotonicMs": job["apiElapsedMs"],
                          "httpWallClockMs": job["acknowledgedAtEpochMs"] - job["submittedAtEpochMs"],
                          "arrivalToQueueMs": queue["timestampEpochMs"] - job["submittedAtEpochMs"],
                          "queueWaitFromTimestampsMs": queue["processedOnEpochMs"] - queue["timestampEpochMs"],
                          "bullmqActiveMs": queue["finishedOnEpochMs"] - queue["processedOnEpochMs"],
                          "arrivalToBullmqFinishedMs": queue["finishedOnEpochMs"] - job["submittedAtEpochMs"],
                          "dbCreatedToUpdatedMs": updated - created, "workerReportedQueueAgeMs": metric["queueWaitMs"],
                          "workerTotalMs": metric["totalMs"], "claimMs": metric["claimMs"], "judgeMs": metric["judgeMs"], "reportMs": metric["reportMs"]})
    intervals = [(j["queue"]["processedOnEpochMs"], j["queue"]["finishedOnEpochMs"]) for j in jobs]
    overlap = maximum_overlap(intervals)
    same(overlap, data["workerBound"]["maximumObservedQueueOverlap"], "observed queue overlap")
    same(overlap, 2, "two simultaneous BullMQ job intervals")
    same([maximum_overlap([(j["queue"]["processedOnEpochMs"], j["queue"]["finishedOnEpochMs"]) for j in jobs if j["workerIndex"] == i]) for i in (0, 1)],
         data["workerBound"]["perWorkerMaximumObservedQueueOverlap"], "per-worker overlap")
    db_overlap = maximum_overlap([(t["dbCreatedAtEpochMs"], t["dbUpdatedAtEpochMs"]) for t in timelines])
    same(db_overlap, 3, "distinct DB-row timestamp overlap includes queued lifetime")
    same(data["activeClaimConflict"]["language"], "GO", "one observed active Go lease")
    same([x["httpStatus"] for x in data["activeClaimConflict"]["conflicts"]], [409, 409], "both API active-lease conflicts")
    same(data["activeClaimConflict"]["originalAttempt"], data["activeClaimConflict"]["afterAttempt"], "active lease owner preserved")
    for key, expected in {"submissions": 8, "learned": 8, "notifications": 8, "xp": 10, "resultReplays": 8}.items():
        same(data["persistence"][key], expected, "shared persistence " + key)
    same(len(data["persistence"]["solves"]), 1, "single solve ledger entry")
    same(data["persistence"]["solves"][0]["awarded_xp"], 10, "single XP award")
    listeners = data["apiListeners"]
    same(len(listeners), 2, "two observed API listeners")
    same(len({a["pid"] for a in listeners}), 2, "two API PIDs")
    for listener in listeners:
        check(any(entry["protocol"] == "tcp" and entry["rawLocalAddress"] == f"0100007F:{listener['observedPort']:04X}"
                  for entry in listener["listeners"]), "owned PID/inode-linked loopback listener")
    roles = {a["pid"]: ("api", i) for i, a in enumerate(listeners)}
    roles.update({worker["pid"]: ("worker", worker["workerIndex"]) for worker in data["workerMeasurements"]})
    same(len(roles), 4, "four unique owned child PIDs")
    same({s["pid"] for s in data["processSamples"]}, set(roles), "endpoint procfs samples bind all owned children")
    resources = []
    for sample in data["processSamples"]:
        role, index = roles[sample["pid"]]
        check(sample["peakRssKiB"] >= sample["rssKiB"] > 0, "valid child RSS snapshot")
        resources.append({**sample, "role": role, "index": index,
                          "lifetimeCpuMsAtSample": (sample["userCpuTicks"] + sample["systemCpuTicks"]) * 1000 / data["environment"]["clockTicksPerSecond"],
                          "rssMiB": sample["rssKiB"] / 1024, "lifetimePeakRssMiB": sample["peakRssKiB"] / 1024})
    cleanup = data["cleanup"]
    same(cleanup["failures"], [], "multi-API cleanup failure list")
    same(set(cleanup["removedJobIds"]), {j["jobId"] for j in jobs}, "owned jobs removed")
    same({p["pid"] for p in cleanup["processes"]}, set(roles), "all owned processes accounted for")
    check(all(p["exitCode"] is not None or p["signal"] is not None for p in cleanup["processes"]), "all owned processes exited")
    check(all(p["signal"] != "SIGKILL" for p in cleanup["processes"]), "no forced SIGKILL in this sample")
    same(len(cleanup["observers"]), 2, "action and cleanup observer sets")
    for observer in cleanup["observers"]:
        same(observer, {"postgresSocketDestroyed": True, "redisStatus": "end", "queueCloseFailed": False,
                        "pendingOperations": 0, "forceCloseFailures": []}, "observer cancellation/drain result")
    same(data["nativeArtifacts"], {"before": [], "after": []}, "native artifact set unchanged")
    fields = ("apiMonotonicMs", "httpWallClockMs", "arrivalToQueueMs", "queueWaitFromTimestampsMs", "bullmqActiveMs",
              "arrivalToBullmqFinishedMs", "dbCreatedToUpdatedMs", "workerReportedQueueAgeMs", "workerTotalMs", "claimMs", "judgeMs", "reportMs")
    return {**binding, "schemaVersion": data["schemaVersion"], "status": data["status"], "provenance": provenance,
            "environment": data["environment"], "topology": data["topology"], "limits": data["limits"],
            "nativeFixtureProof": fixture_proof, "firstArrivalEpochMs": first_arrival, "timelines": timelines,
            "rawObservations": jobs, "rawWorkerMeasurements": data["workerMeasurements"],
            "derivedQuantilesMs": {key: quant([t[key] for t in timelines]) for key in fields},
            "admission": data["admission"], "preSetupThrottleResets": data["preSetupThrottleResets"],
            "workerJobCounts": {str(i): sum(j["workerIndex"] == i for j in jobs) for i in (0, 1)},
            "workerBound": data["workerBound"], "dbRowTimestampMaximumOverlap": db_overlap,
            "activeClaimConflict": data["activeClaimConflict"], "persistence": data["persistence"],
            "apiListeners": listeners, "processSamples": resources, "nativeArtifacts": data["nativeArtifacts"],
            "scenarioElapsedMs": data["scenarioElapsedMs"], "cleanup": cleanup, "elapsedMsBeforeReportWrite": data["elapsedMs"],
            "jobsPerActiveSecond": 8000 / data["admission"]["activeBatchMs"],
            "jobsPerRecordedThroughCleanupSecond": 8000 / data["elapsedMs"],
            "arrivalToLastBullmqFinishSpanMs": max(t["finishedAtEpochMs"] for t in timelines) - first_arrival,
            "limitations": data["limitations"] + [
                "Derived nearest-rank n8 p95/p99 equal maxima of this finite sample, not population-tail estimates.",
                "DB createdAt/updatedAt are observed row timestamp values, not commit timestamps or native execution boundaries. Their overlap3 is distinct from BullMQ overlap2.",
                "Process CPU is cumulative since each child started; no before-snapshot exists. Do not sum cumulative per-job worker counters or call endpoint CPU the eight-job CPU cost.",
                "Per-child RSS/peak excludes native compiler/executor, PostgreSQL, Redis and host resources. V8 old-space limits are not whole-process RSS caps.",
                "Recorded elapsed time includes cleanup but is sampled before report serialization/write/upload. Active interval includes HTTP, polling and cross-API result reads.",
                "Worker distribution6+2 and the long Go job are retained; this is not a fairness guarantee, steady-state capacity or saturation run."],
            }


def composed_observation(directory, foundation, check, same, quant, editor_parser, browser_parser):
    metadata_bytes = (directory / "github-metadata.json").read_bytes()
    metadata = json.loads(metadata_bytes)
    same(metadata["run"]["status"], "completed", "PR91 actual workflow completed")
    same(metadata["run"]["conclusion"], "success", "PR91 actual workflow success")
    same(dict(Counter(j["conclusion"] for j in metadata["jobs"])), {"success": 12}, "PR91 twelve actual successful jobs")
    backend = backend_observations(directory, metadata, foundation, check, same, quant)
    multi = multi_api_observation(directory, metadata, check, same, quant)
    editor = editor_parser(directory, metadata, 14244698713)
    layout, layout_binding = artifact_json(directory, metadata, 14245879774, "browser.zip", "phase3-browser-performance.json", check, same)
    same(layout["status"], "complete", "PR91 Compose browser complete")
    same(layout["schemaVersion"], 2, "PR91 layout schema2")
    same(layout["checkout"]["sha"], CHECKOUT, "PR91 layout actual checkout")
    same(layout["checkout"]["tree"], TREE, "PR91 layout tree")
    same(int(layout["checkout"]["workflowRunId"]), RUN, "PR91 layout run")
    proof = json.loads((directory / "layout-source-proof.json").read_bytes())
    source_bytes = (directory / "learning-performance.ts").read_bytes()
    same(proof["ref"], SOURCE, "PR91 layout probe ref")
    same(sha(source_bytes), proof["sha256"], "PR91 layout source SHA256")
    same(hashlib.sha1(b"blob " + str(len(source_bytes)).encode() + b"\0" + source_bytes).hexdigest(), proof["sha"], "PR91 layout Git blob")
    same(proof["sha256"], "ff344f39c413c56a8ae6544d22aa7c3b370491ed1154fac9a6327bfe46f5400b", "unchanged schema2 layout probe")
    same(editor["probeSourceProof"]["sha256"], "ce4d326dd25558ea8901a6b9c5811662a72287074691568e98637afd6e2f8823", "unchanged finite editor probe")
    vectors = browser_parser(layout)
    observations = []
    for sample in layout["samples"]:
        same(sample["initial"]["layoutShifts"], sample["final"]["layoutShifts"], "PR91 no later recorded layout shifts")
        same(sample["initial"]["layout"], sample["final"]["layout"], "PR91 initial/final geometry equality")
        for shift in sample["initial"]["layoutShifts"]:
            check(not shift["sourcesTruncated"], "PR91 source lists untruncated")
        observations.append({"navigation": sample["navigation"], "shifts": sample["initial"]["layoutShifts"],
                             "initialLayout": sample["initial"]["layout"], "finalLayout": sample["final"]["layout"],
                             "initialObservedThroughMs": sample["initial"]["observedThroughMs"],
                             "finalObservedThroughMs": sample["final"]["observedThroughMs"]})
    return {"stage": "COMPOSED_PR91_ACTUAL_CI_SUCCESS; INDEPENDENT_ACCEPTANCE_AND_FINAL_PUBLICATION_RECORDED_SEPARATELY",
            "runId": RUN, "runUrl": REPO_URL + f"/actions/runs/{RUN}", "overallConclusion": "success",
            "jobConclusions": {"success": 12}, "sourceHead": SOURCE, "checkout": metadata["checkout"],
            "metadataSha256": sha(metadata_bytes), **backend, "multiApi": multi,
            "frontend": {"editor": editor, "layout": {**layout_binding, "schemaVersion": 2,
                "probeVersion": layout["probeVersion"], "probeSourceProof": proof, "checkout": layout["checkout"],
                "environment": layout["environment"], "protocol": layout["protocol"], "fixture": layout["fixture"],
                "vectors": vectors, "layoutAttribution": observations, "apiStatusesAll200": True,
                "observerBuffersTruncated": False, "inp": layout["inp"], "limitations": layout["limitations"]}},
            "scope": "Actual arithmetic from distinct CI jobs and finite fixtures, not one simultaneous combined DB/export/Judge/editor workload. No before/after optimization, saturation, production RTO/RPO or field INP claim.",
            }
