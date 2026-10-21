import assert from "node:assert/strict";
import timers, { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import type { Claim, JudgeResult, judge } from "./judge.js";
import { startWorker } from "./worker.js";

const claim: Claim = {
  language: "PYTHON", sourceCode: "print(3)",
  limits: { timeMs: 1000, memoryMb: 256 },
  testCases: [{ input: "", expectedOutput: "3\n", isSample: true }],
};
const result: JudgeResult = {
  status: "ACCEPTED", runtimeMs: 2, memoryKb: 1000,
  passedTestCases: 1, totalTestCases: 1, debugOutputs: [],
};
const path = "/api/v1/internal/judge/submissions/submission";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

interface ApiRequest {
  path: string;
  method: string;
  headers: Headers;
  body: RequestInit["body"];
}

type Processor = Parameters<Parameters<typeof startWorker>[2]>[0];

function harness(
  t: TestContext,
  handle: (request: ApiRequest) => Response | Promise<Response> = () => Response.json({ ok: true }),
  runJudge: typeof judge = async () => result,
) {
  const requests: ApiRequest[] = [];
  const intervals = new Map<ReturnType<typeof setInterval>, () => void>();
  const sleeps: { ms: number; resolve: () => void }[] = [];
  let processor: Processor | undefined;
  const consumer = {
    pause: t.mock.fn(async (_doNotWaitActive?: boolean) => {}),
    close: t.mock.fn(async () => {}),
  };
  const consume = t.mock.fn((process: Processor) => {
    processor = process;
    return consumer;
  });
  const errors = t.mock.method(console, "error", () => {});
  const logs = t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "setInterval", (callback: () => void, ms: number) => {
    assert.equal(ms, 10_000);
    const timer = { unref() {} } as ReturnType<typeof setInterval>;
    intervals.set(timer, callback);
    return timer;
  });
  t.mock.method(globalThis, "clearInterval", (timer: ReturnType<typeof setInterval>) => {
    intervals.delete(timer);
  });
  t.mock.method(timers, "setTimeout", (ms: number, _value: unknown, options?: { signal?: AbortSignal }) => {
    const wait = deferred<void>();
    const signal = options?.signal;
    const abort = () => wait.reject(signal?.reason);
    const resolve = () => {
      signal?.removeEventListener("abort", abort);
      wait.resolve();
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    sleeps.push({ ms, resolve });
    return wait.promise;
  });
  t.mock.method(globalThis, "fetch", async (input: string | URL, options?: RequestInit) => {
    options?.signal?.throwIfAborted();
    const url = new URL(input);
    if (url.host === "sandbox.test") {
      if (url.pathname === "/version") return Response.json({ os: "linux" });
      if (url.pathname === "/config") return Response.json({ runnerConfig: {
        cgroupType: 2, seccomp: true, workDir: "/w", cgroupControllers: ["cpu", "memory", "pids"],
      } });
      assert.equal(url.pathname, "/file");
      return Response.json({});
    }
    const request = {
      path: url.pathname, method: options?.method ?? "GET",
      headers: new Headers(options?.headers), body: options?.body,
    };
    requests.push(request);
    if (request.path === path && request.method === "GET") {
      const response = await handle(request);
      return response.ok ? Response.json(claim) : response;
    }
    return handle(request);
  });
  return {
    requests, intervals, sleeps, consumer, consume, errors, logs,
    start: (token = "unit-token") => startWorker(
      { url: "http://api.test/api/v1", token },
      { url: "http://sandbox.test", token: "sandbox-token" },
      consume, runJudge,
    ),
    process() {
      assert.ok(processor);
      return processor({ data: { submissionId: "submission", generation: 7 } });
    },
    async heartbeat() {
      for (const callback of [...intervals.values()]) callback();
      await setImmediate();
    },
  };
}

for (const failure of ["network", 429, 503] as const) {
  test(`result ${failure} retries the same payload and attempt with a live lease until acknowledgment`, async (t) => {
    const acknowledgment = deferred<Response>();
    let patches = 0;
    let judgingSignal: AbortSignal | undefined;
    const runJudge = t.mock.fn<typeof judge>(async (_claim, _sandbox, signal) => {
      judgingSignal = signal;
      return result;
    });
    const h = harness(t, (request) => {
      if (request.path !== `${path}/result`) return Response.json({ ok: true });
      if (++patches > 1) return acknowledgment.promise;
      if (failure === "network") throw new TypeError("connection reset");
      return Response.json({}, { status: failure });
    }, runJudge);
    const running = await h.start();
    t.after(() => running.close());
    const invocation = h.process();
    await setImmediate();
    assert.deepEqual(h.sleeps.map((sleep) => sleep.ms), [1000]);
    assert.equal(h.intervals.size, 2);
    await h.heartbeat();
    assert.equal(judgingSignal?.aborted, false);
    h.sleeps[0].resolve();
    await setImmediate();
    await h.heartbeat();
    assert.equal(h.intervals.size, 2, "lease remains active while result response is pending");
    const reports = h.requests.filter((request) => request.path === `${path}/result`);
    assert.equal(reports.length, 2);
    assert.equal(reports[0].body, reports[1].body);
    const claimed = h.requests.find((request) => request.path === path)!;
    for (const report of reports) {
      assert.equal(report.method, "PATCH");
      assert.equal(report.headers.get("X-Judge-Attempt"), claimed.headers.get("X-Judge-Attempt"));
      assert.equal(report.headers.get("X-Judge-Generation"), "7");
      assert.equal(report.headers.get("X-Judge-Worker"), claimed.headers.get("X-Judge-Worker"));
      assert.equal(report.headers.get("X-Judge-Token"), "unit-token");
    }
    assert.equal(h.requests.filter((request) => request.path === `${path}/heartbeat`).length, 2);
    assert.equal(h.logs.mock.callCount(), 0, "no success log before result acknowledgment");
    acknowledgment.resolve(Response.json({ ok: true }));
    await invocation;
    assert.equal(h.intervals.size, 1, "only worker heartbeat remains after acknowledgment");
    assert.equal(runJudge.mock.callCount(), 1);
    assert.equal(h.consumer.pause.mock.callCount(), 0);
    assert.deepEqual(h.logs.mock.calls.map((call) => call.arguments), [["Judged submission"]]);
  });
}

test("result retries are bounded to three requests with 1s/2s backoff", async (t) => {
  const h = harness(t, (request) => Response.json({}, { status: request.path.endsWith("/result") ? 503 : 200 }));
  const running = await h.start();
  t.after(() => running.close());
  const failed = assert.rejects(h.process(), /HTTP 503/);
  await setImmediate();
  h.sleeps[0].resolve();
  await setImmediate();
  h.sleeps[1].resolve();
  await failed;
  assert.deepEqual(h.sleeps.map((sleep) => sleep.ms), [1000, 2000]);
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 3);
  assert.equal(h.intervals.size, 1);
});

for (const status of [400, 409]) {
  test(`definitive result HTTP ${status} is not retried`, async (t) => {
    const h = harness(t, (request) => Response.json({}, { status: request.path.endsWith("/result") ? status : 200 }));
    const running = await h.start();
    t.after(() => running.close());
    await assert.rejects(h.process(), new RegExp(`HTTP ${status}`));
    assert.equal(h.sleeps.length, 0);
    assert.equal(h.intervals.size, 1);
  });
}

test("a committed result with a lost response is replayed without another claim or execution", async (t) => {
  let persisted: ApiRequest | undefined;
  const runJudge = t.mock.fn(async () => result);
  const h = harness(t, (request) => {
    if (!request.path.endsWith("/result")) return Response.json({ ok: true });
    if (!persisted) {
      persisted = request;
      throw new TypeError("response lost after commit");
    }
    assert.equal(request.body, persisted.body);
    assert.equal(request.headers.get("X-Judge-Attempt"), persisted.headers.get("X-Judge-Attempt"));
    return Response.json({ ok: true });
  }, runJudge);
  const running = await h.start();
  t.after(() => running.close());
  const invocation = h.process();
  await setImmediate();
  h.sleeps[0].resolve();
  await invocation;
  assert.equal(runJudge.mock.callCount(), 1);
  assert.equal(h.requests.filter((request) => request.path === path).length, 1);
});

test("an obsolete claim does not run or report", async (t) => {
  const runJudge = t.mock.fn(async () => result);
  const h = harness(t, (request) => Response.json({}, { status: request.path === path ? 409 : 200 }), runJudge);
  const running = await h.start();
  t.after(() => running.close());
  await h.process();
  assert.equal(runJudge.mock.callCount(), 0);
  assert.equal(h.intervals.size, 1);
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 0);
  assert.equal(h.logs.mock.callCount(), 0);
});

for (const cooperates of [true, false]) {
  test(`lease HTTP 409 aborts the judge and suppresses obsolete reporting (cooperative=${cooperates})`, async (t) => {
    const execution = deferred<JudgeResult>();
    let signal: AbortSignal | undefined;
    const h = harness(t, (request) => Response.json({}, { status: request.path === `${path}/heartbeat` ? 409 : 200 }),
      async (_claim, _sandbox, cancellation) => {
        signal = cancellation;
        if (cooperates) cancellation!.addEventListener("abort", () => execution.reject(cancellation!.reason), { once: true });
        return execution.promise;
      });
    const running = await h.start();
    t.after(() => running.close());
    const invocation = h.process();
    await setImmediate();
    await h.heartbeat();
    assert.equal(signal?.aborted, true);
    assert.match(String(signal?.reason), /HTTP 409/);
    execution.resolve(result);
    await invocation;
    assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 0);
    assert.equal(h.consumer.pause.mock.callCount(), 0, "lease loss must not pause unrelated jobs");
    assert.equal(h.logs.mock.callCount(), 0, "obsolete work must not log a successful verdict");
    assert.equal(h.intervals.size, 1);
  });
}

test("transient lease failures do not abort judging", async (t) => {
  const execution = deferred<JudgeResult>();
  let signal: AbortSignal | undefined;
  const failures = ["network", 429, 503];
  const h = harness(t, (request) => {
    if (request.path !== `${path}/heartbeat`) return Response.json({ ok: true });
    const failure = failures.shift();
    if (failure === "network") throw new TypeError("connection reset");
    return Response.json({}, { status: Number(failure) });
  }, async (_claim, _sandbox, cancellation) => {
    signal = cancellation;
    return execution.promise;
  });
  const running = await h.start();
  t.after(() => running.close());
  const invocation = h.process();
  await setImmediate();
  for (let i = 0; i < 3; i++) {
    await h.heartbeat();
    assert.equal(signal?.aborted, false);
  }
  execution.resolve(result);
  await invocation;
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 1);
  assert.equal(h.consumer.pause.mock.callCount(), 0);
});

test("lease loss during result backoff cancels the wait and prevents replay", async (t) => {
  const h = harness(t, (request) => Response.json({}, {
    status: request.path === `${path}/heartbeat` ? 409 : request.path.endsWith("/result") ? 503 : 200,
  }));
  const running = await h.start();
  t.after(() => running.close());
  const invocation = h.process();
  await setImmediate();
  assert.equal(h.sleeps.length, 1);
  await h.heartbeat();
  await invocation;
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 1);
  assert.equal(h.intervals.size, 1);
});

test("a lease HTTP 409 remains definitive even if discarding its response body fails", async (t) => {
  const execution = deferred<JudgeResult>();
  let signal: AbortSignal | undefined;
  const h = harness(t, (request) => {
    const response = Response.json({}, { status: request.path === `${path}/heartbeat` ? 409 : 200 });
    if (response.status === 409) t.mock.method(response.body!, "cancel", async () => { throw new Error("stream closed"); });
    return response;
  }, async (_claim, _sandbox, cancellation) => {
    signal = cancellation;
    cancellation!.addEventListener("abort", () => execution.reject(cancellation!.reason), { once: true });
    return execution.promise;
  });
  const running = await h.start();
  t.after(() => running.close());
  const invocation = h.process();
  await setImmediate();
  await h.heartbeat();
  await invocation;
  assert.match(String(signal?.reason), /HTTP 409/);
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 0);
});

test("transient worker presence failures neither pause consumption nor abort active judging", async (t) => {
  let started = false;
  const execution = deferred<JudgeResult>();
  const failures = ["network", 503];
  let signal: AbortSignal | undefined;
  const h = harness(t, (request) => {
    if (started && request.path === "/api/v1/internal/judge/heartbeat") {
      const failure = failures.shift();
      if (failure === "network") throw new TypeError("connection reset");
      return Response.json({}, { status: Number(failure) });
    }
    return Response.json({ ok: true });
  }, async (_claim, _sandbox, cancellation) => {
    signal = cancellation;
    return execution.promise;
  });
  const running = await h.start();
  t.after(() => running.close());
  started = true;
  const invocation = h.process();
  await setImmediate();
  for (let i = 0; i < 2; i++) {
    await h.heartbeat();
    assert.equal(signal?.aborted, false);
    assert.equal(h.consumer.pause.mock.callCount(), 0);
  }
  execution.resolve(result);
  await invocation;
  assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, 1);
});

test("an ordinary judge failure reports SYSTEM_ERROR without exposing internal details", async (t) => {
  const h = harness(t, undefined, async () => { throw new Error("e".repeat(1500)); });
  const running = await h.start();
  t.after(() => running.close());
  await h.process();
  const report = h.requests.find((request) => request.path.endsWith("/result"));
  assert.ok(report && typeof report.body === "string");
  assert.deepEqual(JSON.parse(report.body), {
    status: "SYSTEM_ERROR", runtimeMs: 0, memoryKb: 0,
    passedTestCases: 0, totalTestCases: 1, debugOutputs: [], judgeMessage: "채점 중 시스템 오류가 발생했습니다.",
  });
  assert.equal(h.errors.mock.callCount(), 1);
  assert.match(String(h.errors.mock.calls[0].arguments[1]), /e{1500}/);
});

test("the consuming worker is constructed only after an authenticated API heartbeat", async (t) => {
  const authenticated = deferred<Response>();
  const h = harness(t, () => authenticated.promise);
  const starting = h.start();
  await setImmediate();
  assert.equal(h.consume.mock.callCount(), 0);
  assert.equal(h.intervals.size, 0);
  authenticated.resolve(Response.json({ ok: true }));
  const running = await starting;
  await running.close();
  assert.equal(h.consume.mock.callCount(), 1);
  assert.equal(h.consumer.close.mock.callCount(), 1);
  assert.equal(h.intervals.size, 0);
});

for (const status of [401, 403, 503]) {
  test(`startup HTTP ${status} consumes no jobs`, async (t) => {
    const h = harness(t, () => Response.json({}, { status }));
    await assert.rejects(h.start("nonempty-wrong-token"), new RegExp(`HTTP ${status}`));
    assert.equal(h.consume.mock.callCount(), 0);
    assert.equal(h.intervals.size, 0);
  });
}

test("an empty API token fails before constructing a consumer", async (t) => {
  const h = harness(t);
  await assert.rejects(h.start(""), /JUDGE_SERVICE_TOKEN is required/);
  assert.equal(h.consume.mock.callCount(), 0);
  assert.equal(h.requests.length, 0);
});

for (const stage of ["worker", "claim", "lease", "result"] as const) {
  for (const status of [401, 403]) {
    test(`runtime ${stage} HTTP ${status} pauses consumption and stops obsolete work`, async (t) => {
      let deny = false;
      let signal: AbortSignal | undefined;
      const execution = deferred<JudgeResult>();
      const deniedPath = stage === "worker" ? "/api/v1/internal/judge/heartbeat"
        : stage === "claim" ? path : `${path}/${stage === "lease" ? "heartbeat" : "result"}`;
      const h = harness(t, (request) => Response.json({ error: "secret-response-body" }, {
        status: deny && request.path === deniedPath ? status : 200,
      }), async (_claim, _sandbox, cancellation) => {
        signal = cancellation;
        if (stage === "result") return result;
        cancellation!.addEventListener("abort", () => execution.reject(cancellation!.reason), { once: true });
        return execution.promise;
      });
      const running = await h.start();
      t.after(() => running.close());
      deny = true;
      if (stage === "claim") await assert.rejects(h.process(), new RegExp(`HTTP ${status}`));
      else {
        const invocation = h.process();
        await setImmediate();
        if (stage !== "result") await h.heartbeat();
        await invocation;
        assert.equal(signal?.aborted, true);
      }
      assert.equal(h.consumer.pause.mock.callCount(), 1);
      assert.deepEqual(h.consumer.pause.mock.calls[0].arguments, [true]);
      assert.equal(h.intervals.size, 0);
      assert.equal(h.requests.filter((request) => request.path.endsWith("/result")).length, stage === "result" ? 1 : 0);
      assert.equal(h.errors.mock.callCount(), 1, "the first authentication failure must be diagnosed exactly once");
      const diagnostic = h.errors.mock.calls[0].arguments.join(" ");
      assert.match(diagnostic, /worker paused/i);
      assert.match(diagnostic, /restart required/i);
      assert.match(diagnostic, new RegExp(`HTTP ${status}`));
      assert.ok(diagnostic.includes(`${stage === "worker" ? "POST" : stage === "claim" ? "GET" : "PATCH"} ${deniedPath.slice("/api/v1".length)}`));
      assert.ok(!diagnostic.includes("unit-token"));
      assert.ok(!diagnostic.includes("secret-response-body"));
      assert.equal(h.logs.mock.callCount(), 0, "authentication cancellation must not log Judged completion");
      const calls = h.requests.length;
      await assert.rejects(h.process(), new RegExp(`HTTP ${status}`));
      assert.equal(h.requests.length, calls, "paused worker must not make more claim requests");
      assert.equal(h.errors.mock.callCount(), 1, "latched authentication failures must not repeat diagnostics");
    });
  }
}

test("closing stops worker presence heartbeats but retains the active lease through result delivery", async (t) => {
  const execution = deferred<JudgeResult>();
  const h = harness(t, undefined, async () => execution.promise);
  const running = await h.start();
  const invocation = h.process();
  await setImmediate();
  h.consumer.close.mock.mockImplementation(() => invocation);
  const closing = running.close();
  assert.equal(h.intervals.size, 1);
  await h.heartbeat();
  assert.equal(h.requests.at(-1)?.path, `${path}/heartbeat`);
  execution.resolve(result);
  await closing;
  assert.equal(h.consumer.close.mock.callCount(), 1);
  assert.equal(h.intervals.size, 0);
  assert.equal(h.requests.at(-1)?.path, `${path}/result`);
});
