# Portable offline performance verification

The portable entry point is `persisted-evidence/performance/verify-performance.py`, with the adjacent arithmetic module `verify-pr91.py`. Both use only Python's standard library. The entry point locates all inputs from `Path(__file__).resolve().parent`, and never invokes Git, reads hidden local commit objects, installs packages, connects to services, runs a benchmark or writes an output file. Bytecode generation is disabled when loading the companion. Its only output is the JSON verification result on stdout, or a failure reason and nonzero exit code.

After committing the retained layout into `docs/overhaul/phase5/evidence`, run:

```bash
python3 docs/overhaul/phase5/evidence/performance/verify-performance.py
```

The same command can use an absolute script path from any working directory. An isolated copy containing only the listed evidence files also works; no repository is required.

## Required layout

Relative to the script's `performance/` directory, retain these inputs:

| Path | Purpose |
|---|---|
| `verify-pr91.py` | Adjacent module for the actual composed PR91 DB, restore, multi-API and frontend arithmetic |
| `foundation-judge-43890166522.zip` | Original accepted foundation Judge artifact; includes the distinct 24-job mixed campaign, 32-job scaling trials and recovery JSONs |
| `foundation-browser-43890166522.zip` | Original accepted foundation browser artifact |
| `phase4-browser-baseline.zip` | Original Phase IV **final** browser artifact, run 43852089830 |
| `phase4-browser-foundation-43841589126.zip` | Original earlier Phase IV foundation browser artifact; needed to retain all three historical vectors |
| `foundation-provenance.json` | Retrieved run/checkout/tree/artifact receipt |
| `historical-browser-artifacts.json` | Retrieved metadata for the two historical browser ZIPs |
| `performance-source-data-foundation.json` | Exact original 42,990-byte derived foundation dataset; its SHA256 is pinned in the script |
| `performance-source-data.json` | The same foundation sections plus explicitly stage-labeled failed, corrected component and actual composed PR91 observations; only later publication identities remain pending |
| `source-proof.json` | Five immutable-ref source hash receipts: three old browser probes and two unchanged Judge probes |
| `source-snapshots/foundation-learning-performance.ts` | Exact old browser probe bytes; SHA256 `a8e184761cc09cb1fa532834076e2034ac19a0a0526798da50ebe6607d4453c7` |
| `source-snapshots/foundation-judge-capacity.pipeline-spec.ts` | Exact old/foundation Judge probe bytes; SHA256 `43a75e8479d1d327dfbc5be3f4abf46c2f6963042f362f127025ccb233c04ae3` |
| `observed-candidates/43898203434/browser.zip` | Original schema-2 browser ZIP from the failed frontend candidate |
| `observed-candidates/43898203434/phase3-browser-performance.json` | Exact extracted JSON; independently checked against the ZIP member |
| `observed-candidates/43898203434/github-metadata.json` | Retrieved failed-run, successful-Compose, checkout and artifact receipts |
| `observed-candidates/43898203434/learning-performance-500329305615070e4e9edbde0ca9215539ed1cc4.ts` | Measured candidate probe bytes |
| `observed-candidates/43898203434/learning-performance-49a3674e76f79b0d1626b12f02862825c189bdff.ts` | Corrected-source probe bytes, independently byte-identical |
| `observed-candidates/43901468081/github-metadata.json` | Exact independently retrieved corrected-run metadata: source49a367, checkout8d59c05, treec90c955, all12 successful jobs and original artifact digests |
| `observed-candidates/43901468081/editor-shard2.zip` | Original corrected-source frontend shard-2 ZIP, artifact14242761020 |
| `observed-candidates/43901468081/phase5-editor-observation.json` | Exact editor JSON, checked against its ZIP member |
| `observed-candidates/43901468081/phase5-editor-observation.spec.ts` and `editor-source-proof.json` | Measured editor probe and immutable-ref byte/hash receipt |
| `observed-candidates/43901468081/browser.zip` | Original corrected-source Compose browser ZIP, artifact14245410256 |
| `observed-candidates/43901468081/phase3-browser-performance.json` | Exact corrected-source schema-2 layout JSON, checked against its ZIP member |
| `observed-candidates/43901468081/learning-performance.ts` and `layout-source-proof.json` | Exact unchanged schema-2 layout probe and source proof |
| `observed-candidates/43905864054/github-metadata.json` | Stable independently retrieved final run/source/checkout/tree/parent/artifact receipt for all twelve successful PR91 jobs |
| `observed-candidates/43905864054/database.zip` and `phase5-database.json` | Original DB qualification ZIP 14244922097 and its exact schema-1 JSON member |
| `observed-candidates/43905864054/restore.zip` and `phase4-restore.json` | Original enriched restore ZIP 14245512021 and its exact schema-2 JSON member |
| `observed-candidates/43905864054/multi-api.zip` and `phase5-multi-api.json` | Original actual two-API/two-worker ZIP 14246816098 and its exact schema-1 JSON member |
| `observed-candidates/43905864054/editor-shard2.zip` and `phase5-editor-observation.json` | Original frontend ZIP 14244698713 and exact fresh editor observation |
| `observed-candidates/43905864054/browser.zip` and `phase3-browser-performance.json` | Original Compose ZIP 14245879774 and exact fresh schema-2 layout observation |
| `observed-candidates/43905864054/source-proof.json` and `source-snapshots/` | Five immutable-ref receipts and exact source snapshots: `ci.yml`, `phase5-db-qualification.mjs`, `phase4-restore-rehearsal.mjs`, `phase5-multi-api.pipeline-spec.ts`, `phase5-multi-api.pipeline-helpers.ts` |
| `observed-candidates/43905864054/phase5-editor-observation.spec.ts` and `editor-source-proof.json` | Exact editor probe and source receipt, unchanged from corrected PR89 |
| `observed-candidates/43905864054/learning-performance.ts` and `layout-source-proof.json` | Exact layout probe and source receipt, unchanged from corrected PR89 |
| `observed-candidates/43905864054/smoke-sources.json` and `native-fixture-source-proof.json` | Exact eight-language fixture strings and source receipt; every observed/persisted source hash is recomputed |
| `../database-local-f037d5c.json` | Original committed local DB raw report; verification does not require its local author commits to be remotely reachable |
| `../frontend/bundle-comparison.json` | Original frontend bundle comparison report |

Both historical source snapshots were matched to GitHub `fetch_file` immutable-ref Git blob hashes. The verifier recomputes SHA256, byte length and Git blob SHA1 from the retained bytes. This supplies an offline consistency proof of the saved receipts; it is not a fresh remote authenticity check.

## Scope of checks

The verifier checks original ZIP SHA256 and byte counts, JSON member hashes, source/checkout/tree bindings, preservation of every original foundation section, seven local DB workload records, raw n=5 nearest-rank read quantiles and stable result digests, client CPU/RSS summaries, fixture/resource limits, cleanup, recorded WAL/temporary-block observations, 24-job and separate 32-job Judge arithmetic, unique submission IDs, zero overlap, per-wave acceptance and retries, CPU tick arithmetic, throughput, stage quantiles, seven separately retained recovery observations, all three historical browser reports, raw navigation/switch vectors and CLS session sums, old probe identity, bundle deltas, and all three later candidate stages. The editor extensions independently derive the thirteen-sample heap summaries and differences, separate ten-sample action distributions, the truncated two-hundred-entry Event Timing prefix and its processing/input-delay differences, the 176 discarded-entry count, and separate Compose layout vectors. The failed candidate must remain failed, while corrected PR89 and composed PR91 each bind to their own actual twelve-success run.

The PR91 module independently derives all five n=5 CI read distributions, stable result hashes, client CPU/RSS ranges, plan summaries and canonical full-plan digests, stage totals, fixtures and observed resource bounds. It requires the five measured DB source hashes to equal the local sample. It checks actual schema-2 restore counts, product invariants, the 37-table barrier/fingerprint record, separate empty/populated rollback observations, stage totals and cleanup. For the eight-job multi-API scenario, it recomputes absolute arrival/queue/start/finish intervals and quantiles, worker/API participation, per-worker/total queue overlap, separate DB-row timestamp overlap, quota progression, retries and persisted/replay/lease results. Procfs tick arithmetic and both active and recorded-through-cleanup throughput are kept separate from unmeasured per-job/system costs. Fresh PR91 editor/layout observations are recomputed independently instead of reusing PR89 numbers.

The bulk DB raw reports contain measured cluster WAL deltas but do not retain start/end LSNs. The verifier checks the local 195,400-byte and CI 184,376-byte recorded values and their immutable raw hashes; it does not reconstruct missing LSN endpoints. Plan WAL has a different scope. It also does not rerun a SQL query to prove a result digest: it verifies that the five recorded digests agree and match the original report. The enriched restore artifact retains the report, not the reported dump archive or database rows; offline verification cannot replay restore or reconstruct its row fingerprints.

If the script sits inside a repository containing `Front/package-lock.json`, it additionally compares the current two measured component files and lockfile with the bundle report's hashes. A mismatch is reported as `CURRENT_FILES_DIFFER; HISTORICAL_MEASUREMENT_NOT_REBOUND`; it does not attach the historical measurement to different current code. In a standalone evidence copy this optional field reads `NOT_CHECKED_NO_REPOSITORY_SOURCE_PRESENT`, while the offline evidence checks remain valid.

## Actual results, preserved by stage

The earlier companion, before adding the corrected-source artifacts, passed locally against the retained staging layout, checking **3,240 field/arithmetic conditions**, with zero network calls, zero Git calls and zero benchmark executions. These are verifier conditions, not 3,240 application tests. That result identified seven DB workloads with five samples per read workload; 24 mixed-campaign jobs and 32 separate scaling jobs with no ID overlap; seven recovery observations; three historical browser reports; five historical source receipts; and failed overall run 43898203434 with a successful separate Compose observation. The current-source binding is deliberately not asserted in this standalone staging directory.

Portability was also checked in a disposable copy containing only the retained inputs: Python isolated mode (`-I`), an empty `PATH`, and a working directory outside the copy. It again passed all 3,240 conditions. In that disposable copy only, appending bytes to the foundation browser ZIP produced the expected nonzero failure on its digest check. Original evidence was untouched. The exact verification result, relocation conditions, integrity negative control and verifier/source-data hashes are retained in `performance/portable-verification.json`.

The original scratch-specific recomputation script was also rerun and passed. It now preserves additive `observedCandidates` records when regenerating the original foundation sections. The portable companion is the file to commit for independent reuse; the original scratch script is not needed by it.

After adding actual corrected-source run 43901468081 editor and Compose artifacts, that companion version passed **5,599 field/arithmetic conditions**. It preserved the same seven original foundation sections, the failed predecessor, and the corrected component's separate stage. Its proof is `performance/portable-verification-corrected-43901468081.json`; the earlier `portable-verification.json` remains an unchanged record for the earlier verifier version and its hash. That version was again checked in an isolated retained-evidence copy. Changing the corrected editor's derived truncation flag to false in that disposable copy was rejected, so the reported loss of 176 later Event Timing entries could not silently become a complete-session result.

The current companion, including actual composed run **43905864054**, passes **10,875 field/arithmetic conditions**. These remain verifier conditions, not application tests. Actual PR91 slots are populated with **schema-1 DB, schema-2 restore and schema-1 multi-API** evidence, plus fresh editor/Compose data. Only subsequent integration/publication identities remain coordinator-owned. The original scratch recomputation preserves all three candidate records and the populated fields.

The current proof is `performance/portable-verification-pr91-43905864054.json`. It records the ordinary run and a relocated evidence-only copy using Python isolated mode, an empty `PATH`, a working directory outside the copy and no bytecode writes. A negative control changes only the copied derived multi-API overlap from two to three; the verifier must reject it by recomputing from the retained queue timestamps. Original raw artifacts and the two historical proof files remain untouched.

These checks establish retained-byte integrity, receipt consistency and arithmetic reproducibility. They do not replay the experiments, establish capacity or saturation, produce a causal before/after result, authenticate GitHub anew, replace the separate QA/Security acceptance, or bind the observations to a later unmeasured source.
