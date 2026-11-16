#!/usr/bin/env python3
"""Offline arithmetic and retained-evidence verifier; no benchmark or Git calls.

Run: python3 docs/overhaul/phase5/evidence/performance/verify-performance.py
The retained directory may be copied anywhere together with ../database-local-
f037d5c.json and ../frontend/bundle-comparison.json. All paths start at __file__.
This checks byte integrity and consistency of retained receipts, not remote
authenticity, current CI acceptance, causation, or a replay of the experiments.
"""

from collections import Counter
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import statistics
import sys
import zipfile

# Loading the companion arithmetic module must not create bytecode in evidence.
sys.dont_write_bytecode = True


HERE = Path(__file__).resolve().parent
REPO_URL = "https://github.com/yakisoba0728/UnsolvableOJ"
FOUNDATION_DATA_SHA256 = "d2d971d21d70d1054612ae8e5e7096ab43c89bcf9594153cc16fdf45b9e0d025"
IMMUTABLE_SECTIONS = ("foundation", "database", "judge", "phase2ScalingTrials",
                      "recovery", "browser", "bundle")
CHECKS = 0


def check(condition, message):
    global CHECKS
    CHECKS += 1
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def same(actual, expected, label):
    if isinstance(expected, float):
        check(isinstance(actual, (float, int)) and
              math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), label)
    elif isinstance(expected, dict):
        check(isinstance(actual, dict) and actual.keys() == expected.keys(), label + " keys")
        for key in expected:
            same(actual[key], expected[key], label + "." + str(key))
    elif isinstance(expected, list):
        check(isinstance(actual, list) and len(actual) == len(expected), label + " length")
        for i, (a, e) in enumerate(zip(actual, expected)):
            same(a, e, label + f"[{i}]")
    else:
        check(actual == expected, label)


def quant(values):
    ordered = sorted(values)
    check(bool(ordered) and all(math.isfinite(x) for x in ordered), "finite samples")
    return {"n": len(ordered), "p50": ordered[math.ceil(len(ordered) * .50) - 1],
            "p95": ordered[math.ceil(len(ordered) * .95) - 1],
            "p99": ordered[math.ceil(len(ordered) * .99) - 1],
            "min": ordered[0], "max": ordered[-1]}


def zip_json(path, member, metadata=None):
    data = path.read_bytes()
    if metadata is not None:
        same("sha256:" + sha(data), metadata["digest"], path.name + " digest")
        same(len(data), metadata.get("bytes", metadata.get("size_in_bytes")), path.name + " bytes")
    with zipfile.ZipFile(path) as archive:
        raw = archive.read(member)
    return json.loads(raw), raw


def session_cls(entries):
    maximum, score, start, last = 0., 0., -math.inf, -math.inf
    for entry in entries:
        if entry["hadRecentInput"]:
            continue
        time = entry["startTime"]
        if time - last < 1000 and time - start < 5000:
            score += entry["value"]
        else:
            start, score = time, entry["value"]
        last = time
        maximum = max(maximum, score)
    return maximum


def browser_vectors(data):
    samples = data["samples"]
    same(len(samples), 3, "browser navigation count")
    same(data["protocol"]["navigations"], 3, "browser protocol count")
    same(data["inp"]["value"], None, "INP remains unmeasured")
    for sample in samples:
        same(sample["api"]["status"], 200, "initial API status")
        same(len(sample["periods"]), 5, "period count")
        same([p["api"]["days"] for p in sample["periods"]], [7, 90, 30, 7, 90], "period sequence")
        for period in sample["periods"]:
            same(period["api"]["status"], 200, "period API status")
            timing = period["timing"]["value"]
            same(timing["verifiedRenderFrameMs"] - timing["clickStartMs"],
                 timing["clickToVerifiedRenderFrameMs"], "period duration arithmetic")
        for stage in ("initial", "final"):
            snapshot = sample[stage]
            check(not any(snapshot["truncated"].values()), "observer buffer not truncated")
            same(session_cls(snapshot["layoutShifts"]), snapshot["observedCls"]["value"], "CLS session arithmetic")
    lcp = [s["initial"]["lcpCandidate"]["value"]["startTime"] for s in samples]
    cls = [s["initial"]["observedCls"]["value"] for s in samples]
    switches = [p["timing"]["value"]["clickToVerifiedRenderFrameMs"]
                for s in samples for p in s["periods"]]
    return {
        "lcpCandidateMs": {"raw": lcp, "median": statistics.median(lcp), "max": max(lcp)},
        "initialObservedCls": {"raw": cls, "median": statistics.median(cls), "max": max(cls)},
        "clickToSecondVerifiedFrameMs": {"raw": switches, "median": statistics.median(switches), "max": max(switches)},
        "lcpCandidateAreas": [s["initial"]["lcpCandidate"]["value"]["size"] for s in samples],
        "heapDeltaUsedBytes": [s["heapAfter"]["value"]["usedBytes"] - s["heapBefore"]["value"]["usedBytes"] for s in samples],
    }


def attribution_observation(directory):
    metadata = read(directory / "github-metadata.json")
    data, raw = zip_json(directory / "browser.zip", "phase3-browser-performance.json", metadata["artifact"])
    same(raw, (directory / "phase3-browser-performance.json").read_bytes(), "candidate retained JSON bytes")
    same(sha(raw), metadata["jsonSha256"], "candidate JSON digest")
    same(data["schemaVersion"], 2, "candidate schema")
    same(data["probeVersion"], "phase5-layout-attribution-v1", "candidate probe version")
    same(data["status"], "complete", "candidate observation complete")
    same(metadata["run"]["conclusion"], "failure", "failed candidate stays failed")
    same(metadata["run"]["id"], 43898203434, "candidate run")
    same(data["checkout"]["sha"], metadata["checkout"]["sha"], "candidate checkout")
    same(data["checkout"]["tree"], metadata["checkout"]["tree"], "candidate tree")
    same(data["checkout"]["tree"], metadata["run"]["head_commit"]["tree_id"], "candidate source tree")
    same(metadata["artifact"]["workflow_run"]["head_sha"], metadata["run"]["head_sha"], "candidate artifact source")
    same(int(data["checkout"]["workflowRunId"]), metadata["run"]["id"], "candidate workflow ID")
    jobs = metadata["jobs"]
    counts = dict(Counter(j["conclusion"] for j in jobs))
    same(counts, {"success": 9, "failure": 3}, "candidate jobs")
    compose = next(j for j in jobs if j["name"] == "Sandbox, pipeline and Compose")
    same(compose["conclusion"], "success", "independent Compose job")
    proof = metadata["probeSourceProof"]
    for receipt in proof:
        payload = (directory / ("learning-performance-" + receipt["ref"] + ".ts")).read_bytes()
        same(sha(payload), receipt["sha256"], "candidate source SHA256")
        blob = hashlib.sha1(b"blob " + str(len(payload)).encode() + b"\0" + payload).hexdigest()
        same(blob, receipt["sha"], "candidate source Git blob")
    same(proof[0]["sha256"], proof[1]["sha256"], "probe bytes unchanged at corrected head")
    same(metadata["probeBytesEqual"], True, "probe equality receipt")
    vectors = browser_vectors(data)
    shifts = []
    for sample in data["samples"]:
        same(sample["initial"]["layoutShifts"], sample["final"]["layoutShifts"], "no later recorded shift")
        same(sample["initial"]["layout"], sample["final"]["layout"], "stable bounded snapshot geometry")
        for shift in sample["initial"]["layoutShifts"]:
            check(not shift["sourcesTruncated"], "source list not truncated")
            check(len(shift["sources"]) <= 5, "source list bound")
        shifts.append({"navigation": sample["navigation"],
                       "initialObservedThroughMs": sample["initial"]["observedThroughMs"],
                       "finalObservedThroughMs": sample["final"]["observedThroughMs"],
                       "shifts": sample["initial"]["layoutShifts"],
                       "initialFontStatus": sample["initial"]["layout"]["fontStatus"],
                       "finalFontStatus": sample["final"]["layout"]["fontStatus"],
                       "sameInitialFinalGeometry": True,
                       "sameInitialFinalShiftEntries": True,
                       "initialEventTimingEntries": len(sample["initial"]["eventTiming"]["value"]),
                       "finalEventTimingEntries": len(sample["final"]["eventTiming"]["value"]),
                       "recordedEventTimingDurationsMs": sorted(set(e["duration"] for e in sample["final"]["eventTiming"]["value"]))})
    same(sum(len(x["shifts"]) for x in shifts), 6, "six unique per-document shifts; no snapshot double counting")
    same([x["initialFontStatus"] for x in shifts] + [x["finalFontStatus"] for x in shifts], ["loaded"] * 6, "font snapshot states")
    return {
        "stage": "FAILED_FRONTEND_CANDIDATE_WITH_SUCCESSFUL_COMPOSE_OBSERVATION",
        "acceptance": "NOT_ACCEPTED_OVERALL; corrected candidate requires a fresh full run and its own artifacts",
        "runId": metadata["run"]["id"], "runUrl": metadata["run"]["url"],
        "overallConclusion": metadata["run"]["conclusion"], "jobConclusions": counts,
        "sourceHead": metadata["run"]["head_sha"], "checkout": data["checkout"],
        "composeJob": {"id": compose["id"], "name": compose["name"], "conclusion": compose["conclusion"],
                       "url": REPO_URL + "/actions/runs/43898203434/job/" + str(compose["id"])},
        "artifactId": metadata["artifact"]["id"],
        "artifactUrl": REPO_URL + "/actions/runs/43898203434/artifacts/" + str(metadata["artifact"]["id"]),
        "zipBytes": metadata["artifact"]["size_in_bytes"],
        "zipSha256": metadata["artifact"]["digest"].removeprefix("sha256:"),
        "jsonSha256": sha(raw), "schemaVersion": data["schemaVersion"], "probeVersion": data["probeVersion"],
        "probeSourceProof": proof, "probeBytesEqualAtCorrectedHead": True,
        "fixture": data["fixture"], "environment": data["environment"], "protocol": data["protocol"],
        "vectors": vectors, "layoutAttribution": shifts,
        "commonInitialAndFinalLayout": data["samples"][0]["initial"]["layout"],
        "allSnapshotLayoutsEqual": all(s[t]["layout"] == data["samples"][0]["initial"]["layout"] for s in data["samples"] for t in ("initial", "final")),
        "observerBuffersTruncated": False, "apiStatusesAll200": True,
        "inp": data["inp"], "limitations": data["limitations"] + [
            "Impacted source boxes and nearest fixed ancestor labels are not initiating-cause attribution.",
            "Font status is sampled after UI readiness and at the end, not at shift time; font-causality is unresolved.",
            "Schema 2 adds observer/source geometry work; timing comparisons with schema 1 are descriptive and not controlled speedup evidence.",
            "The source failed the overall CI run. Successful Compose observations do not accept the failed source or the corrected head.",
        ],
    }


def editor_observation(directory, metadata, artifact_id=14242761020):
    artifact = next(a for a in metadata["artifacts"] if a["id"] == artifact_id)
    data, raw = zip_json(directory / "editor-shard2.zip", "phase5-editor-observation.json", artifact)
    same(raw, (directory / "phase5-editor-observation.json").read_bytes(), "corrected editor raw JSON")
    same(data["status"], "PASS", "corrected editor observation status")
    same(data["schemaVersion"], 1, "editor schema")
    source = data["source"]
    same(source["sourceHead"], metadata["source"]["sha"], "editor source")
    same(source["checkout"], metadata["checkout"]["sha"], "editor checkout")
    same(source["tree"], metadata["checkout"]["tree"], "editor tree")
    same(int(source["workflowRunId"]), metadata["run"]["id"], "editor run")
    check(source["trackedTreeClean"], "editor measured tree clean")
    proof = read(directory / "editor-source-proof.json")
    probe_bytes = (directory / proof["retainedPath"]).read_bytes()
    same(sha(probe_bytes), proof["sha256"], "editor probe SHA256")
    same(len(probe_bytes), proof["bytes"], "editor probe bytes")
    same(hashlib.sha1(b"blob " + str(len(probe_bytes)).encode() + b"\0" + probe_bytes).hexdigest(),
         proof["gitBlob"], "editor probe Git blob")
    same(proof["ref"], source["sourceHead"], "editor probe ref")
    protocol = data["protocol"]
    for key, expected in {"trials": 1, "cycles": 10, "plannedObservationMs": 40000,
                          "maximumObservationMs": 45000, "testTimeoutMs": 90000,
                          "editorWrites": 10, "fileToggles": 10, "charactersPerWrite": 8,
                          "plannedHeapSamples": 13, "maximumEventEntries": 200,
                          "eventDurationThresholdMs": 16, "gcForced": False}.items():
        same(protocol[key], expected, "editor bounded protocol " + key)
    check(0 < data["protocolElapsedMs"] < protocol["maximumObservationMs"], "editor protocol within action budget")
    check(data["protocolElapsedMs"] <= data["actualObservationMs"] < protocol["testTimeoutMs"], "editor total interval bounded")
    same(data["fieldINP"]["value"], None, "editor field INP unmeasured")
    same(data["actual"], {"heapSamples": 13, "actions": 20, "autosaveWrites": 10,
                          "unexpectedRequests": 0, "pageErrors": 0}, "editor completed correctness counts")
    samples = data["raw"]["heapSamples"]
    same([s["label"] for s in samples], ["ready", "baseline-after-idle"] +
         [f"cycle-{i}" for i in range(1, 11)] + ["final-after-idle"], "editor sample schedule")
    check(all(s["visibilityState"] == "visible" for s in samples), "editor visible samples")
    check(all(a["elapsedMs"] < b["elapsedMs"] for a, b in zip(samples, samples[1:])), "heap browser sample clock order")
    supported = [s for s in samples if s["heap"]["value"] is not None]
    for sample in supported:
        check(all(math.isfinite(n) and n >= 0 for n in sample["heap"]["value"].values()), "finite heap estimates")
    heap_fields = ("usedJSHeapSize", "totalJSHeapSize", "jsHeapSizeLimit")
    heap_quantiles = {field: quant([s["heap"]["value"][field] for s in supported]) for field in heap_fields} if supported else None
    all_supported = len(supported) == len(samples)
    used = [s["heap"]["value"]["usedJSHeapSize"] for s in supported]
    actions = data["raw"]["actions"]
    same(len(actions), 20, "editor action count")
    same([(a["cycle"], a["kind"]) for a in actions],
         [(i, kind) for i in range(1, 11) for kind in ("edit-autosave", "file-toggle")], "editor action order")
    check(all(a["elapsedMs"] < b["elapsedMs"] for a, b in zip(actions, actions[1:])), "action Node clock order")
    action_summaries = {}
    for kind in ("edit-autosave", "file-toggle"):
        selected = [a for a in actions if a["kind"] == kind]
        check(all(a["valueMatched"] for a in selected), "editor action content checks")
        if kind == "edit-autosave":
            same([a["revision"] for a in selected], list(range(1, 11)), "editor sequential revisions")
            check(all(a["focusRetained"] for a in selected), "edit focus retained")
        else:
            check(all(a["tabFocused"] and a["editorFocusRestored"] for a in selected), "file toggle focus checks")
        values = [a["wallDurationMs"] for a in selected]
        action_summaries[kind] = {"rawWallMs": values, "nearestRankMs": quant(values), "arithmeticMedianMs": statistics.median(values)}
    events = data["raw"]["eventTiming"]
    rows = events["value"]
    check(events["discardedEntries"] >= 0, "editor event discard count")
    same(events["truncated"], events["discardedEntries"] > 0, "editor event truncation flag")
    event_summary = {"supported": rows is not None, "reason": events["reason"],
                     "retainedEntries": None if rows is None else len(rows),
                     "truncated": events["truncated"], "discardedEntries": events["discardedEntries"],
                     "observedDurationMs": events["observedDurationMs"],
                     "quantileScope": "Retained thresholded event entries only, not independent interactions; a full buffer keeps the early prefix and discards later entries."}
    if rows is not None:
        check(len(rows) <= protocol["maximumEventEntries"], "editor event buffer bound")
        same(len(rows), 200, "actual retained editor entries")
        same(events["discardedEntries"], 176, "actual discarded editor entries")
        check(all(x["region"] in (None, "editor", "file-tab") for x in rows), "editor event fixed regions")
        duration = [x["duration"] for x in rows]
        processing = [x["processingEnd"] - x["processingStart"] for x in rows
                      if x["processingEnd"] is not None and x["processingStart"] is not None]
        delay = [x["processingStart"] - x["startTime"] for x in rows if x["processingStart"] is not None]
        event_summary.update({
            "rawDurationMs": duration, "rawProcessingMs": processing, "rawInputDelayMs": delay,
            "durationNearestRankMs": quant(duration) if duration else None,
            "processingNearestRankMs": quant(processing) if processing else None,
            "inputDelayNearestRankMs": quant(delay) if delay else None,
            "firstRetainedStartMs": min(x["startTime"] for x in rows) if rows else None,
            "lastRetainedStartMs": max(x["startTime"] for x in rows) if rows else None,
            "nameCounts": dict(Counter(x["name"] for x in rows)),
            "regionCounts": dict(Counter(x["region"] or "unattributed" for x in rows)),
            "distinctNonzeroInteractionIds": len({x["interactionId"] for x in rows if x["interactionId"]}),
            "deliveredFilteredEntryCount": len(rows) + events["discardedEntries"],
        })
    return {
        "status": data["status"], "source": source, "environment": data["environment"],
        "artifactId": artifact["id"], "artifactUrl": REPO_URL + "/actions/runs/" + str(metadata["run"]["id"]) + "/artifacts/" + str(artifact["id"]),
        "zipSha256": artifact["digest"].removeprefix("sha256:"), "zipBytes": artifact["size_in_bytes"],
        "jsonSha256": sha(raw), "probeSourceProof": proof, "protocol": protocol,
        "protocolElapsedMs": data["protocolElapsedMs"], "observerCleanupMs": data["observerCleanupMs"],
        "actualObservationMs": data["actualObservationMs"], "actual": data["actual"],
        "rawHeapSamples": samples, "supportedHeapSamples": len(supported), "heapNearestRankBytes": heap_quantiles,
        "adjacentUsedHeapDeltaBytes": [b - a for a, b in zip(used, used[1:])] if all_supported else None,
        "readyToFinalUsedHeapDeltaBytes": used[-1] - used[0] if all_supported else None,
        "baselineIdleToFinalUsedHeapDeltaBytes": used[-1] - used[1] if all_supported else None,
        "rawActions": actions, "actionWallTimingByKind": action_summaries, "eventTiming": event_summary,
        "fieldINP": data["fieldINP"], "limitations": data["limitations"] + [
            "Every reported heap estimate in this run is identical and coarse; zero recorded change does not establish zero allocation or absence of a leak.",
            "The EventTiming buffer was full: 200 early entries retained and 176 later delivered filtered entries discarded. Quantiles cover the retained prefix only.",
            "Edit-autosave and file-toggle wall intervals include automation and assertions and remain separate distributions; browser and Node time origins are not identical.",
        ],
    }


def corrected_frontend_observation(directory):
    metadata = read(directory / "github-metadata.json")
    same(metadata["run"]["id"], 43901468081, "corrected candidate run")
    same(metadata["run"]["status"], "completed", "corrected run completed")
    same(metadata["run"]["conclusion"], "success", "corrected run success")
    same(dict(Counter(j["conclusion"] for j in metadata["jobs"])), {"success": 12}, "corrected 12 jobs success")
    same(metadata["source"]["sha"], "49a3674e76f79b0d1626b12f02862825c189bdff", "corrected source head")
    same(metadata["source"]["sha"], metadata["run"]["head_sha"], "corrected run source binding")
    same(metadata["source"]["tree"], metadata["checkout"]["tree"], "corrected source/checkout tree equality")
    same(metadata["run"]["tree"], metadata["checkout"]["tree"], "corrected run tree")
    same(metadata["checkout"]["sha"], "8d59c05bcc2161e3088355daf63756ed655ac234", "corrected actual checkout")
    same(metadata["checkout"]["parents"], ["6d8556c07fd370ee97d7c55798286f5b2885cf4c", metadata["source"]["sha"]], "corrected merge parents")
    artifact = next(a for a in metadata["artifacts"] if a["id"] == 14245410256)
    for artifact_id in (14245410256, 14242761020):
        receipt = next(a for a in metadata["artifacts"] if a["id"] == artifact_id)
        same(receipt["workflow_run"]["id"], metadata["run"]["id"], "corrected artifact run binding")
        same(receipt["workflow_run"]["head_sha"], metadata["source"]["sha"], "corrected artifact source binding")
    data, raw = zip_json(directory / "browser.zip", "phase3-browser-performance.json", artifact)
    same(raw, (directory / "phase3-browser-performance.json").read_bytes(), "corrected layout raw JSON")
    same(data["schemaVersion"], 2, "corrected layout schema")
    same(data["probeVersion"], "phase5-layout-attribution-v1", "corrected layout probe")
    same(data["status"], "complete", "corrected layout complete")
    same(data["checkout"]["sha"], metadata["checkout"]["sha"], "corrected layout checkout")
    same(data["checkout"]["tree"], metadata["checkout"]["tree"], "corrected layout tree")
    same(int(data["checkout"]["workflowRunId"]), 43901468081, "corrected layout run")
    proof = read(directory / "layout-source-proof.json")
    probe = (directory / "learning-performance.ts").read_bytes()
    same(sha(probe), proof["sha256"], "corrected layout source SHA256")
    same(hashlib.sha1(b"blob " + str(len(probe)).encode() + b"\0" + probe).hexdigest(), proof["sha"], "corrected layout Git blob")
    same(proof["ref"], metadata["source"]["sha"], "corrected layout probe ref")
    same(sha(probe), "ff344f39c413c56a8ae6544d22aa7c3b370491ed1154fac9a6327bfe46f5400b", "same layout probe as failed candidate")
    vectors = browser_vectors(data)
    layouts = []
    for sample in data["samples"]:
        same(sample["initial"]["layoutShifts"], sample["final"]["layoutShifts"], "corrected no additional recorded shift")
        same(sample["initial"]["layout"], sample["final"]["layout"], "corrected bounded snapshot geometry")
        same(len(sample["initial"]["layoutShifts"]), 2, "corrected two shifts per navigation")
        for shift in sample["initial"]["layoutShifts"]:
            check(not shift["sourcesTruncated"], "corrected source lists not truncated")
        layouts.append({"navigation": sample["navigation"],
                        "initialObservedThroughMs": sample["initial"]["observedThroughMs"],
                        "finalObservedThroughMs": sample["final"]["observedThroughMs"],
                        "shifts": sample["initial"]["layoutShifts"],
                        "initialLayout": sample["initial"]["layout"], "finalLayout": sample["final"]["layout"],
                        "sameInitialFinalShiftEntries": True, "sameInitialFinalGeometry": True})
    return {
        "stage": "CORRECTED_FRONTEND_COMPONENT_CI_SUCCESS; FINAL_COMPOSED_QUALIFICATION_PENDING",
        "acceptanceScope": "PR89 component source has complete successful CI; this is not a later PR91/final integration execution or a substitute for independent QA acceptance.",
        "runId": 43901468081, "runUrl": REPO_URL + "/actions/runs/43901468081",
        "overallConclusion": metadata["run"]["conclusion"], "jobConclusions": {"success": 12},
        "sourceHead": metadata["source"]["sha"], "checkout": metadata["checkout"],
        "metadataSha256": sha((directory / "github-metadata.json").read_bytes()),
        "editor": editor_observation(directory, metadata),
        "layoutObservation": {
            "status": data["status"], "schemaVersion": data["schemaVersion"], "probeVersion": data["probeVersion"],
            "artifactId": artifact["id"], "artifactUrl": REPO_URL + "/actions/runs/43901468081/artifacts/" + str(artifact["id"]),
            "zipSha256": artifact["digest"].removeprefix("sha256:"), "zipBytes": artifact["size_in_bytes"],
            "jsonSha256": sha(raw), "checkout": data["checkout"], "probeSourceProof": proof,
            "environment": data["environment"], "protocol": data["protocol"], "fixture": data["fixture"],
            "vectors": vectors, "layoutAttribution": layouts,
            "apiStatusesAll200": True, "observerBuffersTruncated": False, "inp": data["inp"],
            "limitations": data["limitations"] + [
                "Impacted source rectangles and ancestor region labels do not identify the initiating cause.",
                "Font state is loaded at six bounded snapshots, not recorded at shift time; no font-causality finding is supported.",
                "Same schema2 probe as the failed candidate, but separate CI samples; no controlled speedup or causal regression claim.",
                "The positive third-visit used-heap delta and 52.1ms maximum switch observation are retained.",
            ],
        },
    }


def main():
    base_bytes = (HERE / "performance-source-data-foundation.json").read_bytes()
    same(sha(base_bytes), FOUNDATION_DATA_SHA256, "immutable original foundation source-data")
    base = json.loads(base_bytes)
    current = read(HERE / "performance-source-data.json")
    for section in IMMUTABLE_SECTIONS:
        same(current[section], base[section], "unchanged original " + section)
    provenance = read(HERE / "foundation-provenance.json")
    same(provenance, base["foundation"], "retained foundation receipt")
    same(provenance["run"]["conclusion"], "success", "foundation run accepted")
    browser_meta, judge_meta = provenance["artifacts"]
    judge_zip = HERE / "foundation-judge-43890166522.zip"
    mixed, mixed_bytes = zip_json(judge_zip, "phase4-mixed-capacity.json", judge_meta)
    same(sha(mixed_bytes), base["judge"]["rawSha256"], "mixed JSON digest")
    same(mixed["status"], "PASSED", "mixed status")
    check(mixed["provenance"]["trackedTreeClean"], "mixed clean tree")
    same(mixed["provenance"]["sourceHeadSha"], provenance["run"]["head_sha"], "mixed source")
    same(mixed["provenance"]["checkoutSha"], provenance["checkout"]["sha"], "mixed checkout")
    same(mixed["provenance"]["treeSha"], provenance["checkout"]["tree"], "mixed tree")
    same(provenance["checkout"]["tree"], provenance["run"]["head_commit"]["tree_id"], "foundation source/checkout tree")
    metrics = [m for w in mixed["waves"] for m in w["measurements"]]
    same(len(metrics), 24, "mixed job count")
    same(len({m["submissionId"] for m in metrics}), 24, "mixed unique submissions")
    same(len({m["workerId"] for m in metrics}), 2, "mixed workers")
    check(all(m["status"] == "ACCEPTED" and m["generation"] == 1 for m in metrics), "mixed accepted generation one")
    expected_languages = ["C", "CPP", "GO", "JAVA", "JAVASCRIPT", "PYTHON", "RUST", "TYPESCRIPT"]
    for wave in mixed["waves"]:
        same(sorted(m["language"] for m in wave["measurements"]), expected_languages, "mixed language coverage")
        same(wave["workerPids"], mixed["workerPids"], "workers reused across waves")
        same(wave["queueAttemptsMade"], [1] * 8, "single queue attempts")
        same(wave["jobsPerActiveSecond"], 8000 / wave["activeBatchMs"], "wave active throughput")
        for field, reported in (("queueWaitMs", "queueWaitMs"), ("totalMs", "acknowledgedWorkerMs")):
            q = quant([m[field] for m in wave["measurements"]])
            for key, value in wave[reported].items():
                same(q[key], value, "wave " + field + " " + key)
        cpu = sum((a["cpuTicks"] - b["cpuTicks"]) * 1000 / mixed["environment"]["clockTicks"]
                  for a, b in zip(wave["workerCpuSamples"]["after"], wave["workerCpuSamples"]["before"]))
        same(cpu, wave["workerCpuMs"], "wave CPU")
        same([wave[k] for k in ("failedJobs", "recoveryCount", "retryCount")], [0, 0, 0], "wave recovery/retry/failure")
    for field, reported in (("queueWaitMs", "queueWaitMs"), ("totalMs", "acknowledgedWorkerMs")):
        q = quant([m[field] for m in metrics])
        for key, value in mixed["summary"][reported].items():
            same(q[key], value, "mixed summary " + field + " " + key)
    for field in ("queueWaitMs", "claimMs", "judgeMs", "reportMs", "totalMs"):
        same([m[field] for m in metrics], base["judge"]["rawDurationsMs"][field], "preserved mixed raw " + field)
    for field in ("claimMs", "judgeMs", "reportMs"):
        same(quant([m[field] for m in metrics]), base["judge"]["derivedStageQuantilesMs"][field], "stage quantiles")
    for key in ("activeBatchMs", "admissionWaitMs"):
        same(mixed["summary"][key], sum(w[key] for w in mixed["waves"]), "mixed " + key + " sum")
    same(mixed["summary"]["jobsPerActiveSecond"], 24000 / mixed["summary"]["activeBatchMs"], "mixed active throughput")
    same(mixed["jobsPerWallSecond"], 24000 / mixed["totalWallMs"], "mixed wall throughput")
    same(mixed["summary"]["activeWorkerCpuMs"], sum(w["workerCpuMs"] for w in mixed["waves"]), "mixed active CPU")
    cpu_samples = mixed["summary"]["workerCpuSamples"]
    same(mixed["summary"]["workerCpuIncludingWaitsMs"],
         sum((a["cpuTicks"] - b["cpuTicks"]) * 1000 / mixed["environment"]["clockTicks"]
             for a, b in zip(cpu_samples["after"], cpu_samples["before"])), "mixed wall CPU")
    for wave, drift in zip(mixed["waves"], mixed["waveDriftFromFirst"]):
        same(drift["throughputRatio"], wave["jobsPerActiveSecond"] / mixed["waves"][0]["jobsPerActiveSecond"], "wave drift ratio")
    p2, p2_bytes = zip_json(judge_zip, "phase2-judge-capacity.json")
    same(sha(p2_bytes), base["phase2ScalingTrials"]["rawSha256"], "Phase II JSON digest")
    p2_metrics = [m for t in p2["trials"] for m in t["measurements"]]
    same(len(p2_metrics), 32, "Phase II jobs")
    same(len({m["submissionId"] for m in p2_metrics}), 32, "Phase II unique jobs")
    check(not ({m["submissionId"] for m in p2_metrics} & {m["submissionId"] for m in metrics}), "protocol ID sets do not overlap")
    same([t["workers"] for t in p2["trials"]], [1, 2, 2, 1], "Phase II worker order")
    for trial in p2["trials"]:
        same(len(trial["measurements"]), 8, "trial count")
        check(all(m["status"] == "ACCEPTED" and m["generation"] == 1 for m in trial["measurements"]), "trial acceptance")
        same(trial["jobsPerSecond"], 8000 / trial["elapsedMs"], "trial throughput")
        for field, reported in (("queueWaitMs", "queueWaitMs"), ("totalMs", "acknowledgedWorkerMs")):
            q = quant([m[field] for m in trial["measurements"]])
            for key, value in trial[reported].items():
                same(q[key], value, "trial quantiles")
        cpu = trial["workerCpuSamples"]
        same(trial["workerCpuMs"], sum((a["cpuTicks"] - b["cpuTicks"]) * 1000 / cpu["clockTicks"]
             for a, b in zip(cpu["after"], cpu["before"])), "trial CPU")
        same(trial["workerCpuCores"], trial["workerCpuMs"] / trial["elapsedMs"], "trial CPU cores")
    recovery = []
    with zipfile.ZipFile(judge_zip) as archive:
        for name in sorted(n for n in archive.namelist() if n.startswith("phase2-") and n.endswith(".json")):
            raw = archive.read(name)
            data = json.loads(raw)
            for case in data.get("recovery", data.get("evidence", [])):
                recovery.append({"file": name, "rawSha256": sha(raw), "case": case})
    same(recovery, base["recovery"], "seven separate recovery observations")
    same(len(recovery), 7, "recovery count")

    db_bytes = (HERE.parent / "database-local-f037d5c.json").read_bytes()
    same(sha(db_bytes), base["database"]["rawSha256"], "original local DB bytes")
    db = json.loads(db_bytes)
    same(db["source"]["head"], "f037d5c91f6b9cc5561fb46a3e7ed13d0289aa77", "local DB source")
    same(db["source"]["dirtyPaths"], "", "local DB clean tree")
    same(db["status"], "PASS", "local DB status")
    same(len(db["measurements"]), 7, "DB workload count")
    same(db["migrations"], 31, "DB migration count")
    for field in ("source", "environment", "fixture", "limits", "elapsedMs", "cleanup"):
        same(db[field], base["database"][field], "DB " + field)
    check(db["cleanup"]["created"] and db["cleanup"]["dropped"], "disposable DB cleaned")
    same(max(x["databaseBytes"] for x in db["stages"]), base["database"]["maximumDatabaseBytes"], "DB size maximum")
    check(base["database"]["maximumDatabaseBytes"] <= db["limits"]["databaseBytes"], "DB size within declared bound")
    check(db["elapsedMs"] < db["limits"]["durationMs"], "DB run inside soft time cap")
    for measurement, summary in zip(db["measurements"][:5], base["database"]["readSamples"]):
        raw = [x["elapsedMs"] for x in measurement["samples"]]
        same(len(raw), 5, "DB read n5")
        same(raw, summary["rawMs"], "DB raw samples")
        q = quant(raw)
        same(q, summary["queryLatencyMs"], "DB quantiles")
        for key in ("p50", "p95", "p99"):
            same(q[key], measurement[key + "Ms"], "DB reported quantile")
        same(q["p95"], q["max"], "n5 p95 is sample maximum")
        same(q["p99"], q["max"], "n5 p99 is sample maximum")
        same(len({x["resultDigest"] for x in measurement["samples"]}), 1, "stable DB result digest")
        same(measurement["samples"][0]["resultDigest"], summary["resultDigest"], "retained DB result digest")
        same(sum(x["clientCpuMs"] for x in measurement["samples"]), summary["clientCpuMsTotal"], "DB client CPU")
        rss = [x[k] for x in measurement["samples"] for k in ("clientRssBytesBefore", "clientRssBytesAfter")]
        same([min(rss), max(rss)], summary["clientRssBytesRange"], "DB client RSS range")
        same(measurement["plan"]["Execution Time"], summary["explainExecutionMs"], "DB EXPLAIN execution")
    stats, bulk = db["measurements"][-2:]
    same({k: v for k, v in stats.items() if k != "label"}, base["database"]["distinctSolvers"], "distinct solver observation")
    same({k: v for k, v in bulk.items() if k not in ("label", "plan")}, base["database"]["bulk"], "bulk WAL and rollback observation")
    same(bulk["clusterWalBytes"], 195400, "recorded cluster WAL delta; LSN endpoints not retained")
    same(bulk["plan"]["Plan"]["Temp Written Blocks"], 8, "bulk top-node temp blocks")
    same(bulk["plan"]["Plan"]["Temp Read Blocks"], 0, "bulk top-node temp reads")

    historical = read(HERE / "historical-browser-artifacts.json")
    inputs = [("phase4-browser-foundation-43841589126.zip", historical[0]),
              ("phase4-browser-baseline.zip", historical[1]),
              ("foundation-browser-43890166522.zip", browser_meta)]
    for (filename, metadata), expected in zip(inputs, base["browser"]["runs"]):
        data, raw = zip_json(HERE / filename, "phase3-browser-performance.json", metadata)
        same(sha(raw), expected["jsonSha256"], "browser JSON digest")
        same(data["checkout"], expected["checkout"], "browser checkout receipt")
        same(int(data["checkout"]["workflowRunId"]), expected["runId"], "browser run binding")
        same(metadata["id"], expected["artifactId"], "browser artifact binding")
        for field, value in browser_vectors(data).items():
            same(value, expected[field], "browser raw vector/summary " + field)
    source_proof = read(HERE / "source-proof.json")["sourceFiles"]
    same(len(source_proof), 5, "historical source receipts")
    for receipt in source_proof:
        data = (HERE / receipt["retainedPath"]).read_bytes()
        same(sha(data), receipt["sha256"], "historical source SHA256")
        same(len(data), receipt["bytes"], "historical source bytes")
        blob = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        same(blob, receipt["gitBlob"], "historical source Git blob")
    old_probes = [r for r in source_proof if r["repositoryPath"].startswith("Front/")]
    same(len(old_probes), 3, "old browser probe sources")
    same({r["sha256"] for r in old_probes}, {base["browser"]["probeSha256"]}, "identical old probe hashes")
    same({r["gitBlob"] for r in old_probes}, {base["browser"]["probeGitBlob"]}, "identical old probe blobs")
    judge_proofs = [r for r in source_proof if r["repositoryPath"].startswith("Back/")]
    same(len({r["sha256"] for r in judge_proofs}), 1, "unchanged foundation Judge protocol")

    bundle_bytes = (HERE.parent / "frontend/bundle-comparison.json").read_bytes()
    same(sha(bundle_bytes), base["bundle"]["artifactSha256"], "bundle comparison digest")
    bundle = json.loads(bundle_bytes)
    for key, value in bundle["delta"].items():
        same(value, bundle["candidate"][key] - bundle["baseline"][key], "bundle delta " + key)
    current_repo_binding = {"status": "NOT_CHECKED_NO_REPOSITORY_SOURCE_PRESENT", "files": []}
    repo = next((p for p in HERE.parents if (p / "Front/package-lock.json").is_file()), None)
    if repo is not None:
        measured_files = dict(bundle["candidateComponentSha256"])
        measured_files["Front/package-lock.json"] = bundle["lockSha256"]
        current_repo_binding["files"] = [{"path": path, "matchesMeasuredBytes": (repo / path).is_file() and sha((repo / path).read_bytes()) == expected}
                                         for path, expected in measured_files.items()]
        current_repo_binding["status"] = ("ALL_MEASURED_BYTES_IDENTICAL" if all(x["matchesMeasuredBytes"] for x in current_repo_binding["files"])
                                          else "CURRENT_FILES_DIFFER; HISTORICAL_MEASUREMENT_NOT_REBOUND")

    observation = attribution_observation(HERE / "observed-candidates/43898203434")
    candidates = current.get("observedCandidates", [])
    selected = [x for x in candidates if x["runId"] == 43898203434]
    same(len(selected), 1, "one additive failed-stage observation")
    same(selected[0], observation, "candidate derived data")
    corrected = [x for x in candidates if x["runId"] == 43901468081]
    same(len(corrected), 1, "one separate corrected candidate observation")
    same(corrected[0], corrected_frontend_observation(HERE / "observed-candidates/43901468081"), "corrected candidate derived data")
    composed = [x for x in candidates if x["runId"] == 43905864054]
    same(len(composed), 1, "one separate composed PR91 observation")
    spec = importlib.util.spec_from_file_location("pr91_retained_arithmetic", HERE / "verify-pr91.py")
    pr91 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pr91)
    same(composed[0], pr91.composed_observation(HERE / "observed-candidates/43905864054", base,
         check, same, quant, editor_observation, browser_vectors), "composed PR91 derived data")
    return {"allChecks": "PASS", "checks": CHECKS, "networkCalls": 0, "gitCalls": 0,
            "benchmarksExecuted": 0, "originalFoundationSectionsUnchanged": list(IMMUTABLE_SECTIONS),
            "dbWorkloads": 7, "dbReadSamplesPerWorkload": 5, "dbNearestRankP95P99EqualMaximum": True,
            "mixedCampaignJobs": 24, "separatePhase2Jobs": 32, "submissionIdOverlap": 0,
            "recoveryObservations": 7, "historicalBrowserReports": 3, "historicalProbeReceipts": 5,
            "observedCandidateRunId": 43898203434, "observedCandidateOverallConclusion": "failure",
            "observedCandidateComposeConclusion": "success", "candidateProbeBytesEqualAtCorrectedHead": True,
            "correctedCandidateVerified": bool(corrected),
            "correctedCandidateRunId": 43901468081 if corrected else None,
            "correctedEditorEventTimingTruncated": corrected[0]["editor"]["eventTiming"]["truncated"] if corrected else None,
            "composedCandidateRunId": 43905864054,
            "composedCandidateDatabaseSchema": composed[0]["database"]["schemaVersion"],
            "composedCandidateRestoreSchema": composed[0]["restore"]["schemaVersion"],
            "composedCandidateMultiApiJobs": len(composed[0]["multiApi"]["timelines"]),
            "composedCandidateApiProcesses": composed[0]["multiApi"]["limits"]["apiProcesses"],
            "composedCandidateWorkerProcesses": composed[0]["multiApi"]["limits"]["workerProcesses"],
            "failedCandidateVectors": observation["vectors"], "currentRepositoryMeasuredFileBinding": current_repo_binding,
            "verificationScope": "Retained byte integrity, receipt consistency and independent arithmetic only; not experiment replay, remote authentication, causal improvement, current CI acceptance or a capacity claim."}


if __name__ == "__main__":
    try:
        print(json.dumps(main(), indent=2))
    except (AssertionError, KeyError, OSError, TypeError, ValueError, zipfile.BadZipFile) as error:
        print(json.dumps({"allChecks": "FAIL", "checksCompleted": CHECKS, "reason": str(error)}, indent=2), file=sys.stderr)
        sys.exit(1)
