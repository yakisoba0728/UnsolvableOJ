import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpus, platform, release, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { sameOutput } from "../dist/output.js";

// Exact comparator from baseline 6176015b63a1615cc2269172f246725ef08abab3.
// Keep this reference isolated from production code so results remain reproducible.
function baseline(actual, expected) {
  function rstrip(buffer) {
    let end = buffer.length;
    while (end && [9, 10, 11, 12, 13, 32].includes(buffer[end - 1])) end--;
    return buffer.subarray(0, end);
  }
  const lines = (buffer) => {
    const result = [];
    for (let start = 0, i = 0; i <= buffer.length; i++)
      if (i === buffer.length || buffer[i] === 10) {
        result.push(rstrip(buffer.subarray(start, i)));
        start = i + 1;
      }
    while (result.length && !result[result.length - 1].length) result.pop();
    return result;
  };
  const [a, b] = [lines(actual), lines(expected)];
  return a.length === b.length && a.every((line, i) => line.equals(b[i]));
}

function fixture(name) {
  if (name === "ordinary") return { actual: Buffer.from("123 456 \r\n".repeat(100)), expected: Buffer.from("123 456\n".repeat(100)), iterations: 200 };
  if (name === "blank-lines") return { actual: Buffer.alloc(999_999, 10), expected: Buffer.alloc(0), iterations: 1 };
  if (name === "dense-lines") return { actual: Buffer.from("x \n".repeat(333_333)), expected: Buffer.from("x\n".repeat(333_333)), iterations: 1 };
  if (name === "long-line") return { actual: Buffer.from("x".repeat(999_998) + " "), expected: Buffer.from("x".repeat(999_998)), iterations: 1 };
  throw new Error(`Unknown fixture: ${name}`);
}

if (process.argv[2] === "--sample") {
  const compare = process.argv[3] === "before" ? baseline : sameOutput;
  const { actual, expected, iterations } = fixture(process.argv[4]);
  const cpuStart = process.cpuUsage();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) assert.equal(compare(actual, expected), true);
  const elapsedMs = (performance.now() - start) / iterations;
  const cpu = process.cpuUsage(cpuStart);
  process.stdout.write(JSON.stringify({ elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000 / iterations, peakRssKiB: process.resourceUsage().maxRSS }));
} else {
  const samples = 5;
  const results = [];
  for (const name of ["ordinary", "blank-lines", "dense-lines", "long-line"]) {
    const { actual, expected, iterations } = fixture(name);
    const measurements = { before: [], after: [] };
    for (let sample = 0; sample < samples; sample++) {
      // Alternate order to reduce a systematic warm-cache/order effect.
      for (const mode of sample % 2 ? ["after", "before"] : ["before", "after"]) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--sample", mode, name], { encoding: "utf8", timeout: 30_000 });
        if (child.status !== 0) throw new Error(child.error?.message ?? child.stderr);
        measurements[mode].push(JSON.parse(child.stdout));
      }
    }
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const summary = Object.fromEntries(Object.entries(measurements).map(([mode, values]) => [mode,
      Object.fromEntries(["elapsedMs", "cpuMs", "peakRssKiB"].map((key) => [key, median(values.map((value) => value[key]))])),
    ]));
    results.push({ fixture: name, inputBytes: actual.length, expectedBytes: expected.length, iterations, ...summary, samples: measurements });
  }
  process.stdout.write(JSON.stringify({
    scope: "Output comparator only; isolated child process per sample; no sandbox, queue, database or network timing",
    baseline: "6176015b63a1615cc2269172f246725ef08abab3", samplesPerMode: samples,
    environment: { node: process.version, os: `${platform()} ${release()} ${arch()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
    results,
  }, null, 2) + "\n");
}
