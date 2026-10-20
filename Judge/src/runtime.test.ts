import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkSandbox, judge, type Claim } from "./judge.js";

const config = {
  url: process.env.GO_JUDGE_URL ?? "http://127.0.0.1:5050",
  token: process.env.GO_JUDGE_TOKEN ?? "",
};
const sources: Record<string, string> = JSON.parse(await readFile(new URL("../runtime/smoke-sources.json", import.meta.url), "utf8"));

function input(sourceCode: string, language = "PYTHON", memoryMb = 256, timeMs = 1000): Claim {
  return {
    submissionId: "runtime-smoke", sourceCode, language, limits: { timeMs, memoryMb },
    testCases: [
      { id: "sample", input: "5 7\n", expectedOutput: "12\n", isSample: true, score: 1 },
      { id: "private", input: "1 2\n", expectedOutput: "3\n", isSample: false, score: 1 },
    ],
  };
}

test("real go-judge sandbox", { timeout: 600_000 }, async (t) => {
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
      const result = await judge(input(source, language, 256, 5000), config);
      assert.equal(result.status, "ACCEPTED", JSON.stringify(result));
      assert.equal(result.passedTestCases, 2);
      assert.ok(result.memoryKb > 0);
      assert.deepEqual(result.debugOutputs, [{
        testCase: 1, stdout: "12\n", stderr: "", stdoutTruncated: false, stderrTruncated: false,
      }]);
    });
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
});
