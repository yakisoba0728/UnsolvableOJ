import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { checkSandbox, judge, type Claim } from "./judge.js";

interface Step {
  status?: string;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
  runTime?: number;
  memory?: number;
  exitStatus?: number;
  httpStatus?: number;
  missingArtifact?: boolean;
  dropStdout?: boolean;
  transform?: (result: Record<string, unknown>) => unknown;
  hang?: () => void;
}

async function sandbox(t: TestContext, steps: Step[] = []) {
  const files = new Map<string, Buffer>();
  const commands: any[] = [];
  const deleted: string[] = [];
  const state = {
    os: "linux", denyDelete: false,
    runner: { cgroupType: 2, seccomp: true, workDir: "/w", cgroupControllers: ["cpu", "memory", "pids"] },
  };
  let nextId = 0;
  const server = createServer((request, response) => {
    void (async () => {
      const json = (value: unknown, status = 200) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      if (request.url === "/version") return json({ os: state.os });
      if (request.url === "/config") return json({ runnerConfig: state.runner });
      if (request.headers.authorization !== "Bearer unit-token") return json("Unauthorized", 401);
      if (request.url === "/file") return json(Object.fromEntries(files));
      if (request.url?.startsWith("/file/")) {
        const id = decodeURIComponent(request.url.slice(6));
        if (request.method === "DELETE") {
          deleted.push(id);
          if (state.denyDelete) return json("Unavailable", 503);
          response.writeHead(files.delete(id) ? 200 : 404);
          return response.end();
        }
        const content = files.get(id);
        response.writeHead(content ? 200 : 404, { "Content-Type": "application/octet-stream" });
        return response.end(content);
      }
      if (request.url !== "/run" || request.method !== "POST") return json("Not found", 404);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.cmd.length, 1);
      commands.push(body.cmd[0]);
      const step = steps.shift();
      assert.ok(step, "Unexpected execution");
      if (step.hang) return step.hang();
      if (step.httpStatus) return json({ error: "hidden-secret" }, step.httpStatus);
      const fileIds: Record<string, string> = {};
      for (const name of body.cmd[0].copyOutCached as string[]) {
        if (name.endsWith("?") && (step.missingArtifact || (step.status && step.status !== "Accepted"))) continue;
        const key = name.replace(/\?$/, "");
        const id = String(++nextId);
        files.set(id, Buffer.from(key === "stdout" ? (step.stdout ?? "") : key === "stderr" ? (step.stderr ?? "") : "binary"));
        fileIds[key] = id;
      }
      const result = {
        status: step.status ?? "Accepted", exitStatus: step.exitStatus ?? 0,
        time: 1_000_000, runTime: step.runTime ?? 2_000_000,
        memory: step.memory ?? 8 * 1024 * 1024, fileIds,
      };
      if (step.dropStdout) files.delete(fileIds.stdout);
      json(step.transform ? step.transform(result) : [result]);
    })().catch((error) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { config: { url: `http://127.0.0.1:${address.port}`, token: "unit-token" }, files, commands, deleted, state };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    submissionId: "test", language: "PYTHON", sourceCode: "print(3)",
    limits: { timeMs: 1000, memoryMb: 256 },
    testCases: [{ id: "sample", input: "1 2\n", expectedOutput: "3\n", isSample: true, score: 1 }],
    ...overrides,
  };
}

test("startup requires authenticated Linux, seccomp and all resource controllers", async (t) => {
  const s = await sandbox(t);
  await checkSandbox(s.config);
  await assert.rejects(checkSandbox({ ...s.config, token: "" }), /TOKEN/);
  await assert.rejects(checkSandbox({ ...s.config, token: "wrong" }), /HTTP 401/);
  s.state.os = "darwin";
  await assert.rejects(checkSandbox(s.config), /requires Linux/);
  s.state.os = "linux";
  for (const controller of ["cpu", "memory", "pids"]) {
    s.state.runner.cgroupControllers = ["cpu", "memory", "pids"].filter((name) => name !== controller);
    await assert.rejects(checkSandbox(s.config), /cgroups/);
  }
  s.state.runner.cgroupControllers = ["cpu", "memory", "pids"];
  s.state.runner.seccomp = false;
  await assert.rejects(checkSandbox(s.config), /seccomp/);
  s.state.runner.seccomp = true;
  s.state.runner.cgroupType = 0;
  await assert.rejects(checkSandbox(s.config), /cgroups/);
});

test("normal exit is compared with the expected output and preserves units and limits", async (t) => {
  const s = await sandbox(t, [{ stdout: "4\n", stderr: "debug\n", runTime: 12_000_000, memory: 8193 }]);
  const result = await judge(claim(), s.config);
  assert.equal(result.status, "WRONG_ANSWER");
  assert.equal(result.runtimeMs, 12);
  assert.equal(result.memoryKb, 9);
  assert.equal(result.debugOutputs[0].stdout, "4\n");
  assert.equal(result.debugOutputs[0].stderr, "debug\n");
  assert.deepEqual(s.commands[0].args.slice(0, 3), ["/usr/bin/prlimit", "--fsize=1000000:1000000", "--"]);
  assert.equal(s.commands[0].clockLimit, 1_000_000_000);
  assert.equal(s.commands[0].cpuLimit, 1_000_000_000);
  assert.equal(s.commands[0].memoryLimit, 256 * 1024 * 1024);
  assert.equal(s.commands[0].procLimit, 64);
  assert.equal(s.commands[0].cpuRateLimit, 1000);
  assert.equal(s.files.size, 0);
});

for (const [count, timeMs, expected] of [[1, 100, 60_100], [100, 60_000, 6_060_000]]) {
  test(`aggregate deadline allows all ${count} per-test budgets of ${timeMs}ms plus overhead`, async (t) => {
    const timeout = t.mock.method(AbortSignal, "timeout");
    const s = await sandbox(t, [{ status: "Time Limit Exceeded" }]);
    const input = claim({ limits: { timeMs, memoryMb: 256 } });
    input.testCases = Array.from({ length: count }, (_, i) => ({ ...input.testCases[0], id: String(i) }));
    assert.equal((await judge(input, s.config)).status, "TIME_LIMIT_EXCEEDED");
    assert.equal(timeout.mock.calls[0].arguments[0], expected);
    assert.ok(Number.isFinite(expected));
    assert.equal(s.files.size, 0);
  });
}

test("a non-finite workload cannot create an infinite deadline", async () => {
  await assert.rejects(judge(claim({ limits: { timeMs: Infinity, memoryMb: 256 } }), {
    url: "http://sandbox.invalid", token: "unit-token",
  }), RangeError);
});

for (const [name, stdout, expected, status] of [
  ["trailing ASCII whitespace", "3\t\r\n ", "3\n", "ACCEPTED"],
  ["internal whitespace", "3 \n4\n", "3\n4\n", "WRONG_ANSWER"],
  ["internal CRLF", "3\r\n4\n", "3\n4\n", "WRONG_ANSWER"],
  ["non-ASCII whitespace", "3\u00a0", "3", "WRONG_ANSWER"],
  ["invalid UTF-8", Buffer.from([0xff]), "\ufffd", "WRONG_ANSWER"],
  ["NUL bytes", Buffer.from([51, 0]), "3", "WRONG_ANSWER"],
] as const) {
  test(`byte comparison: ${name}`, async (t) => {
    const s = await sandbox(t, [{ stdout }]);
    const input = claim();
    input.testCases[0].expectedOutput = expected;
    assert.equal((await judge(input, s.config)).status, status);
    assert.equal(s.files.size, 0);
  });
}

test("samples run first with original case numbers; hidden outputs never escape", async (t) => {
  const s = await sandbox(t, [
    { stdout: "public\n" },
    { status: "Nonzero Exit Status", exitStatus: 1, stderr: "hidden-secret" },
  ]);
  const input = claim({ testCases: [
    { id: "private", input: "secret-input", expectedOutput: "secret-answer", isSample: false, score: 1 },
    { id: "public", input: "public-input", expectedOutput: "public\n", isSample: true, score: 1 },
  ] });
  const result = await judge(input, s.config);
  assert.equal(result.status, "RUNTIME_ERROR");
  assert.equal(result.passedTestCases, 1);
  assert.equal(result.debugOutputs.length, 1);
  assert.equal(result.debugOutputs[0].testCase, 2);
  assert.equal(s.commands[0].files[0].content, "public-input");
  assert.equal(s.commands[1].files[0].content, "secret-input");
  assert.ok(!JSON.stringify(result).includes("hidden-secret"));
  assert.ok(!JSON.stringify(s.commands).includes("secret-answer"));
  assert.equal(s.files.size, 0);
});

test("preview truncation does not affect comparison and only five samples are exposed", async (t) => {
  const stdout = "가".repeat(700) + "\n";
  const s = await sandbox(t, Array.from({ length: 7 }, () => ({ stdout })));
  const input = claim();
  input.testCases = Array.from({ length: 7 }, (_, i) => ({ ...input.testCases[0], id: String(i), expectedOutput: stdout }));
  const result = await judge(input, s.config);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.passedTestCases, 7);
  assert.equal(result.debugOutputs.length, 5);
  assert.equal(result.debugOutputs[0].stdout, Buffer.from(stdout).subarray(0, 1000).toString("utf8"));
  assert.equal(result.debugOutputs[0].stdoutTruncated, true);
  assert.equal(s.files.size, 0);
});

for (const [upstream, expected] of [
  ["Memory Limit Exceeded", "MEMORY_LIMIT_EXCEEDED"], ["Time Limit Exceeded", "TIME_LIMIT_EXCEEDED"],
  ["Output Limit Exceeded", "OUTPUT_LIMIT_EXCEEDED"], ["Nonzero Exit Status", "RUNTIME_ERROR"],
  ["Signalled", "RUNTIME_ERROR"], ["Dangerous Syscall", "RUNTIME_ERROR"],
]) {
  test(`maps ${upstream}, retains flushed sample output and stops at the first failure`, async (t) => {
    const s = await sandbox(t, [{ status: upstream, stdout: "before failure", exitStatus: 1 }]);
    const input = claim();
    input.testCases.push({ ...input.testCases[0], id: "unexecuted" });
    const result = await judge(input, s.config);
    assert.equal(result.status, expected);
    assert.equal(result.passedTestCases, 0);
    assert.equal(result.totalTestCases, 2);
    assert.equal(result.debugOutputs[0].stdout, "before failure");
    assert.equal(s.commands.length, 1);
    assert.equal(s.files.size, 0);
  });
}

for (const stream of ["stdout", "stderr"]) {
  for (const length of [999_999, 1_000_000]) {
    test(`${stream} output limit at ${length} bytes`, async (t) => {
      const output = "x".repeat(length);
      const s = await sandbox(t, [{ stdout: "3\n", [stream]: output }]);
      const input = claim();
      if (stream === "stdout") input.testCases[0].expectedOutput = output;
      assert.equal((await judge(input, s.config)).status, length === 1_000_000 ? "OUTPUT_LIMIT_EXCEEDED" : "ACCEPTED");
      assert.equal(s.files.size, 0);
    });
  }
}

test("compiles once, reuses only the artifact and cleans it after all tests", async (t) => {
  const s = await sandbox(t, [{}, { stdout: "3\n", memory: 9000 }, { stdout: "3\n", runTime: 6_000_000 }]);
  const input = claim({ language: "CPP" });
  input.testCases.push({ ...input.testCases[0], id: "second" });
  const result = await judge(input, s.config);
  assert.equal(result.status, "ACCEPTED");
  assert.equal(result.runtimeMs, 6);
  assert.equal(s.commands[0].args[0], "/usr/bin/g++");
  assert.equal(s.commands[0].clockLimit, 30_000_000_000);
  assert.equal(s.commands[0].memoryLimit, 1024 * 1024 * 1024);
  assert.deepEqual(s.commands[1].copyIn, s.commands[2].copyIn);
  assert.ok(s.commands[1].copyIn.main.fileId);
  assert.equal(s.commands[1].copyIn["main.cpp"], undefined);
  assert.equal(s.files.size, 0);
  assert.equal(s.deleted.length, 7);
});

test("Java packages all class files and runs the jar with an explicit heap limit", async (t) => {
  const s = await sandbox(t, [{}, { stdout: "3\n" }]);
  assert.equal((await judge(claim({ language: "JAVA" }), s.config)).status, "ACCEPTED");
  assert.match(s.commands[0].args[2], /-C classes \./);
  assert.match(s.commands[0].args[2], /> main\.jar$/);
  assert.ok(s.commands[1].copyIn["main.jar"].fileId);
  assert.ok(s.commands[1].args.includes("-Xmx256m"));
  assert.equal(s.files.size, 0);
});

test("compile failure bounds diagnostics, never runs cases and reclaims output", async (t) => {
  const s = await sandbox(t, [{ status: "Nonzero Exit Status", exitStatus: 1, stderr: "e".repeat(100_000) }]);
  const result = await judge(claim({ language: "C" }), s.config);
  assert.equal(result.status, "COMPILE_ERROR");
  assert.equal(result.compileOutput?.length, 65_536);
  assert.deepEqual(result.debugOutputs, []);
  assert.equal(s.commands.length, 1);
  assert.equal(s.files.size, 0);
});

for (const step of [
  { status: "Internal Error" }, { status: "File Error" }, { status: "Unexpected Status" },
  { httpStatus: 503 }, { transform: (result: Record<string, unknown>) => [{ ...result, memory: -1 }] },
  { transform: (result: Record<string, unknown>) => [result, result] },
]) {
  test(`fails closed and cleans cached files: ${JSON.stringify(step)}`, async (t) => {
    const s = await sandbox(t, [step]);
    await assert.rejects(judge(claim(), s.config), /go-judge/);
    assert.equal(s.files.size, 0);
  });
}

test("a missing compiled artifact is an infrastructure error", async (t) => {
  const s = await sandbox(t, [{ missingArtifact: true }]);
  await assert.rejects(judge(claim({ language: "C" }), s.config), /artifact/);
  assert.equal(s.files.size, 0);
});

test("a lost output download still cleans the compiled artifact and other outputs", async (t) => {
  const s = await sandbox(t, [{}, { stdout: "3\n", dropStdout: true }]);
  await assert.rejects(judge(claim({ language: "C" }), s.config), /HTTP 404/);
  assert.equal(s.files.size, 0);
});

test("oversized output is rejected and all cached files are reclaimed", async (t) => {
  const s = await sandbox(t, [{ stdout: "x".repeat(1_000_001) }]);
  await assert.rejects(judge(claim(), s.config), /oversized/);
  assert.equal(s.files.size, 0);
});

test("aborting execution still cleans artifacts with a separate cleanup signal", async (t) => {
  const abort = new AbortController();
  const s = await sandbox(t, [{}, { hang: () => abort.abort() }]);
  await assert.rejects(judge(claim({ language: "C" }), s.config, abort.signal), /abort/i);
  assert.equal(s.files.size, 0);
});

test("cache cleanup failure is reported rather than silently leaking files", async (t) => {
  const s = await sandbox(t, [{ stdout: "3\n" }]);
  s.state.denyDelete = true;
  await assert.rejects(judge(claim(), s.config), /clean go-judge/);
  assert.ok(s.deleted.length >= 2);
});
