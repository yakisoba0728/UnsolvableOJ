import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { test, type TestContext } from "node:test";
import { startWorker } from "./worker.js";

async function listen(t: TestContext, listener: RequestListener) {
  const server = createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("API redirects cannot forward worker credentials to another origin", async (t) => {
  let targetRequests = 0;
  const target = await listen(t, (_request, response) => {
    targetRequests++;
    response.setHeader("Content-Type", "application/json");
    response.end("{}");
  });
  const api = await listen(t, (_request, response) => {
    response.writeHead(307, { Location: `${target}/redirected` });
    response.end();
  });
  const sandbox = await listen(t, (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/version") return response.end(JSON.stringify({ os: "linux" }));
    if (request.url === "/config") return response.end(JSON.stringify({ runnerConfig: {
      cgroupType: 2, seccomp: true, workDir: "/w", cgroupControllers: ["cpu", "memory", "pids"],
    } }));
    response.statusCode = request.headers.authorization === "Bearer sandbox-test-token" ? 200 : 401;
    response.end("{}");
  });
  let consumed = false;
  let worker: Awaited<ReturnType<typeof startWorker>> | undefined;
  t.after(() => worker?.close());
  await assert.rejects(async () => {
    worker = await startWorker(
      { url: api, token: "synthetic-unit-test-token" },
      { url: sandbox, token: "sandbox-test-token" },
      () => { consumed = true; return { close: async () => {} }; },
    );
  }, /fetch failed/);
  assert.equal(targetRequests, 0);
  assert.equal(consumed, false);
});
