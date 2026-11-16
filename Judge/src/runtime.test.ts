import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { test } from "node:test";
import { checkSandbox, judge, type Claim, type JudgeResult } from "./judge.js";

const config = {
  url: process.env.GO_JUDGE_URL ?? "http://127.0.0.1:5050",
  token: process.env.GO_JUDGE_TOKEN ?? "",
};
const sources: Record<string, string> = JSON.parse(await readFile(new URL("../runtime/smoke-sources.json", import.meta.url), "utf8"));
const verdictSources: Record<string, { source: string; syntaxError: string }> = JSON.parse(
  await readFile(new URL("../runtime/verdict-sources.json", import.meta.url), "utf8"),
);
const memorySources: Record<string, string> = JSON.parse(
  await readFile(new URL("../runtime/memory-sources.json", import.meta.url), "utf8"),
);

interface MatrixObservation {
  language: string;
  scenario: string;
  sourceSha256: string;
  memoryLimitMiB: number;
  configuredHeapFlag: string | null;
  timeLimitMs: number;
  elapsedMs: number;
  result?: Pick<JudgeResult, "status" | "runtimeMs" | "memoryKb" | "passedTestCases" | "totalTestCases" | "testResults">;
  verification: "PASS" | "FAIL";
  error?: string;
}

function input(sourceCode: string, language = "PYTHON", memoryMb = 256, timeMs = 1000): Claim {
  return {
    sourceCode, language, limits: { timeMs, memoryMb },
    testCases: [
      { input: "5 7\n", expectedOutput: "12\n", isSample: true },
      { input: "1 2\n", expectedOutput: "3\n", isSample: false },
    ],
  };
}

test("real go-judge sandbox", { timeout: 600_000 }, async (t) => {
  const started = performance.now();
  const observations: MatrixObservation[] = [];
  let completed = false;
  const scenarios = ["AC", "WA", "RE", "TLE", "OLE", "syntax", "UTF8", "memory-under", "memory-over"];
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const checkoutSha = git("rev-parse", "HEAD");
  const treeSha = git("rev-parse", "HEAD^{tree}");
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")) as { pull_request?: { head?: { sha?: string }; base?: { sha?: string } } }
    : undefined;
  t.after(async () => {
    const missing = Object.keys(sources).flatMap((language) => scenarios
      .filter((scenario) => !observations.some((row) => row.language === language && row.scenario === scenario))
      .map((scenario) => ({ language, scenario })));
    const report = {
      schemaVersion: 1,
      status: completed && missing.length === 0 && observations.length === Object.keys(sources).length * scenarios.length
        && observations.every((row) => row.verification === "PASS") ? "PASS" : "FAIL",
      timestamp: new Date().toISOString(),
      provenance: { checkoutSha, treeSha, sourceHeadSha: event?.pull_request?.head?.sha ?? checkoutSha,
        baseSha: event?.pull_request?.base?.sha ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        trackedTreeClean: git("status", "--porcelain", "--untracked-files=no") === "" },
      environment: { node: process.version, platform: platform(), kernel: release(), logicalCpus: cpus().length, cpu: cpus()[0]?.model },
      limits: { suiteTimeoutMs: 600_000, sequential: true, matrixCases: Object.keys(sources).length * scenarios.length,
        memoryProbeLimitMiB: 128, memoryAllocationsMiB: [8, 192], memoryProbeTimeLimitMs: 5000,
        compileLimitMiB: 1024, compileTimeLimitMs: 30_000, stdoutAndStderrLimitBytes: 1_000_000 },
      elapsedMs: performance.now() - started,
      missing, observations,
      limitations: [
        "One finite observation per language/scenario; not a threshold search, saturation test or population latency estimate.",
        "These are actual normalized JudgeResult measurements, not raw go-judge status/signal/cgroup OOM events.",
        "Python/JavaScript syntax errors are runtime errors; compiled languages reject syntax before execution.",
        "Memory pressure is MLE only when the engine reports MLE. A proven Java heap allocation failure may remain RE; no RE/signal is relabeled MLE.",
        "Reported memory is executor-reported peak for a case. Compiler, worker, API, Redis and PostgreSQL resources are separate.",
        "Dedicated production host/kernel isolation and unobserved memory thresholds remain UNVERIFIED.",
      ],
    };
    await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
    await writeFile(new URL("../reports/phase5-verdict-matrix.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  });
  async function observed(claim: Claim, scenario: string, verify: (result: JudgeResult) => void) {
    const began = performance.now();
    const row: MatrixObservation = { language: claim.language, scenario,
      sourceSha256: createHash("sha256").update(claim.sourceCode).digest("hex"),
      memoryLimitMiB: claim.limits.memoryMb,
      configuredHeapFlag: claim.language === "JAVA" ? `-Xmx${claim.limits.memoryMb}m`
        : ["JAVASCRIPT", "TYPESCRIPT"].includes(claim.language) ? `--max-old-space-size=${claim.limits.memoryMb}` : null,
      timeLimitMs: claim.limits.timeMs, elapsedMs: 0, verification: "FAIL" };
    observations.push(row);
    try {
      const result = await judge(claim, config);
      row.result = { status: result.status, runtimeMs: result.runtimeMs, memoryKb: result.memoryKb,
        passedTestCases: result.passedTestCases, totalTestCases: result.totalTestCases, testResults: result.testResults };
      verify(result);
      row.verification = "PASS";
      return result;
    } catch (error) {
      row.error = error instanceof Error ? error.message.slice(0, 2000) : "Native matrix probe failed";
      throw error;
    } finally { row.elapsedMs = performance.now() - began; }
  }
  await checkSandbox(config);
  const headers = { Authorization: `Bearer ${config.token}` };
  const listFiles = async () => {
    const response = await fetch(new URL("/file", config.url), { headers, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    return Object.keys(await response.json()).sort();
  };
  const initialFiles = await listFiles();

  for (const [language, source] of Object.entries(sources)) {
    await t.test(`accepts ${language}`, async () => {
      await observed(input(source, language, 256, 5000), "AC", (result) => {
      assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
      assert.equal(result.passedTestCases, 2);
      assert.ok(result.memoryKb > 0);
      assert.deepEqual(result.debugOutputs, [{
        testCase: 1, stdout: "12\n", stderr: "", stdoutTruncated: false, stderrTruncated: false,
      }]);
      });
    });
  }
  // Every supported language must exercise failure mapping, not only compilation
  // and the happy path. These bounded programs execute exclusively in go-judge.
  assert.deepEqual(Object.keys(verdictSources).sort(), Object.keys(sources).sort());
  for (const [language, fixture] of Object.entries(verdictSources)) {
    for (const [mode, scenario, expected] of [
      ["w", "WA", "WRONG_ANSWER"], ["r", "RE", "RUNTIME_ERROR"],
      ["t", "TLE", "TIME_LIMIT_EXCEEDED"], ["o", "OLE", "OUTPUT_LIMIT_EXCEEDED"],
    ]) {
      await t.test(`${language} verdict ${expected}`, async () => {
        const claim = input(fixture.source, language, 256, mode === "t" ? 1000 : 5000);
        claim.testCases = [{ input: mode, expectedOutput: "expected", isSample: true }];
        await observed(claim, scenario, (result) => {
        assert.equal(result.status, expected, JSON.stringify(result));
        assert.equal(result.passedTestCases, 0);
        assert.equal(result.testResults.length, 1);
        });
      });
    }
    await t.test(`${language} rejects syntax errors at its compilation or interpretation stage`, async () => {
      await observed(input(fixture.syntaxError, language, 256, 5000), "syntax", (result) => {
      const interpreted = ["PYTHON", "JAVASCRIPT"].includes(language);
      assert.equal(result.status, interpreted ? "RUNTIME_ERROR" : "COMPILE_ERROR", JSON.stringify(result));
      assert.equal(result.passedTestCases, 0);
      });
    });
    await t.test(`${language} preserves long UTF-8 input, CRLF and repeated-case verdicts`, async () => {
      const text = `echo\n한글 😀\r\n${"x".repeat(262_144)}\n`;
      const claim = input(fixture.source, language, 256, 5000);
      claim.testCases = [true, false].map((isSample) => ({ input: text, expectedOutput: text, isSample }));
      await observed(claim, "UTF8", (result) => {
      assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
      assert.equal(result.passedTestCases, 2);
      assert.equal(result.debugOutputs.length, 1);
      assert.equal(result.debugOutputs[0].stdoutTruncated, true);
      });
    });
  }
  assert.deepEqual(Object.keys(memorySources).sort(), Object.keys(sources).sort());
  for (const [language, source] of Object.entries(memorySources)) {
    for (const allocationMiB of [8, 192]) {
      const scenario = allocationMiB === 8 ? "memory-under" : "memory-over";
      await t.test(`${language} touches ${allocationMiB} MiB under a 128 MiB execution limit`, async () => {
        const claim = input(source, language, 128, 5000);
        claim.testCases = [{ input: `${allocationMiB}\n`, expectedOutput: `${allocationMiB * 256}\n`, isSample: true }];
        await observed(claim, scenario, (result) => {
          assert.equal(result.testResults.length, 1, JSON.stringify(result));
          assert.ok(result.memoryKb > 0);
          if (allocationMiB === 8) {
            assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
            assert.equal(result.passedTestCases, 1);
          } else {
            assert.equal(result.passedTestCases, 0);
            if (language === "JAVA" && result.status === "RUNTIME_ERROR") {
              // -Xmx128m can refuse the single 192 MiB allocation inside the VM
              // before a cgroup OOM. This is RE, not an inferred native MLE.
              assert.match(result.debugOutputs[0].stderr, /java\.lang\.OutOfMemoryError: Java heap space/);
            } else assert.equal(result.status, "MEMORY_LIMIT_EXCEEDED", JSON.stringify(result));
          }
        });
      });
    }
  }
  const checks: [string, string, string?, number?, number?][] = [
    ["WRONG_ANSWER", "print(0)"],
    ["RUNTIME_ERROR", 'print("before error", flush=True)\nraise RuntimeError("sample error")'],
    ["TIME_LIMIT_EXCEEDED", 'print("before timeout", flush=True)\nwhile True: pass'],
    ["TIME_LIMIT_EXCEEDED", "import time\ntime.sleep(3)", "PYTHON", 256, 100],
    ["MEMORY_LIMIT_EXCEEDED", "data = bytearray(256 * 1024 * 1024); print(12)", "PYTHON", 32],
    ["RUNTIME_ERROR", "import os, signal\nos.kill(os.getpid(), signal.SIGKILL)"],
    ["OUTPUT_LIMIT_EXCEEDED", 'while True: print("x" * 65536)'],
    ["OUTPUT_LIMIT_EXCEEDED", 'import sys\nsys.stderr.write("x" * 1000001)'],
    ["COMPILE_ERROR", "int main( {", "C"],
  ];
  for (const [expected, source, language, memoryMb, timeMs] of checks) {
    await t.test(`${expected}: ${source.slice(0, 35)}`, async () => {
      const result = await judge(input(source, language, memoryMb, timeMs), config);
      assert.equal(result.status, expected, JSON.stringify(result));
      if (source.includes("before timeout")) assert.equal(result.debugOutputs[0].stdout, "before timeout\n");
      if (expected === "OUTPUT_LIMIT_EXCEEDED") assert.ok(result.debugOutputs[0].stdoutTruncated || result.debugOutputs[0].stderrTruncated);
    });
  }
  await t.test("packages Java helper and nested classes", async () => {
    const result = await judge(input("class Helper { static int sum(int a,int b) { return a+b; } } public class Main { static class Nested { static int sum(int a,int b) { return Helper.sum(a,b); } } public static void main(String[] args) { java.util.Scanner s=new java.util.Scanner(System.in); System.out.println(Nested.sum(s.nextInt(),s.nextInt())); } }", "JAVA", 256, 5000), config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
  });
  await t.test("links C libm and exposes M_PI/strdup", async () => {
    const result = await judge(input('#include <math.h>\n#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\nint main(void) { int a,b; scanf("%d %d", &a, &b); char *s = strdup("x"); double p = pow(a, b), r = sqrt((double)a * a); printf("%d\\n", (int)floor(r + b * M_PI / M_PI + 0.5) + (p < 0) + (int)strlen(s) - 1); free(s); }', "C", 256, 5000), config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
  });
  await t.test("compiles Rust with the 2021 prelude", async () => {
    const result = await judge(input("use std::io::Read; fn main(){let mut s=String::new();std::io::stdin().read_to_string(&mut s).unwrap();let v:Vec<i64>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();let sum:i32=(v[0]+v[1]).try_into().unwrap();println!(\"{}\",sum);}", "RUST", 256, 5000), config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
  });
  await t.test("hides private stderr and keeps the public sample", async () => {
    const result = await judge(input('a,b=map(int,input().split())\nif a==1: raise RuntimeError("hidden-secret")\nprint(a+b)'), config);
    assert.equal(result.status, "RUNTIME_ERROR");
    assert.equal(result.debugOutputs.length, 1);
    assert.equal(result.debugOutputs[0].stdout, "12\n");
    assert.ok(!JSON.stringify(result).includes("hidden-secret"));
  });
  await t.test("resets files between cases and does not expose private input", async () => {
    const payload = input('from pathlib import Path\np=Path("saved.txt")\nassert not p.exists()\na,b=map(int,input().split())\np.write_text(str(a))\nprint(a+b)');
    payload.testCases.reverse();
    const result = await judge(payload, config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
    assert.equal(result.debugOutputs[0].testCase, 2);
  });
  await t.test("enforces combined child memory", async () => {
    const source = "import os,time\nfor _ in range(2):\n if os.fork()==0:\n  data=bytearray(48*1024*1024)\n  time.sleep(2)\n  os._exit(0)\nwhile True: time.sleep(1)";
    const result = await judge(input(source, "PYTHON", 64, 3000), config);
    assert.equal(result.status, "MEMORY_LIMIT_EXCEEDED", JSON.stringify(result));
  });
  await t.test("enforces PID limits and reaps detached children", async () => {
    const source = "import os,time\nchildren=[]\ntry:\n for _ in range(100):\n  pid=os.fork()\n  if pid==0:\n   os.setsid()\n   time.sleep(10)\n   os._exit(0)\n  children.append(pid)\nexcept OSError:\n print(sum(map(int,input().split())),flush=True)\nelse:\n raise RuntimeError('PID limit not enforced')";
    const started = Date.now();
    const result = await judge(input(source, "PYTHON", 256, 5000), config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
    assert.ok(Date.now() - started < 10_000, "Detached children were not killed before sandbox reuse");
  });
  await t.test("disables network access inside the submission", async () => {
    const source = 'from pathlib import Path\nimport socket,errno\nassert len(Path("/proc/net/route").read_text().splitlines()) <= 1\ntry:\n s=socket.socket()\nexcept OSError as e:\n assert e.errno in (errno.EPERM,errno.EACCES,errno.EAFNOSUPPORT)\nelse:\n s.settimeout(0.2)\n assert s.connect_ex(("1.1.1.1",80)) != 0\n s.close()\n s=socket.socket()\n s.settimeout(0.2)\n assert s.connect_ex(("127.0.0.1",5050)) != 0\nprint(sum(map(int,input().split())))';
    const result = await judge(input(source), config);
    assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
  });
  assert.deepEqual(await listFiles(), initialFiles, "Cached files leaked after judging");
  assert.equal(observations.length, Object.keys(sources).length * scenarios.length);
  assert.ok(observations.every((row) => row.verification === "PASS"), "Native matrix contains a failed row");
  completed = true;
});
