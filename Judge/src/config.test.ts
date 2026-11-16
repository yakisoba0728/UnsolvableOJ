import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type TLSSocket } from "node:tls";
import { after, before, test } from "node:test";
import { Redis } from "ioredis";
import { loadWorkerConfig } from "./config.js";

const embedded = { JUDGE_SERVICE_TOKEN: "unit-api-token", GO_JUDGE_TOKEN: "unit-sandbox-token" };
const dedicated = {
  ...embedded,
  JUDGE_DEPLOYMENT_MODE: "dedicated",
  API_BASE_URL: "https://api.example.test/api/v1",
  JUDGE_SERVICE_TOKEN: "synthetic-api-token-".repeat(3),
  GO_JUDGE_TOKEN: "synthetic-sandbox-token-".repeat(3),
  REDIS_PASSWORD: "synthetic-redis-token-".repeat(3),
  REDIS_TLS: "true",
  REDIS_HOST: "redis.example.test",
};

test("embedded default remains local while dedicated transport uses verified TLS", () => {
  const local = loadWorkerConfig(embedded);
  assert.equal(local.api.url, "http://localhost:3000/api/v1");
  assert.equal(local.redis.tls, undefined);
  assert.equal(local.concurrency, 2);
  const remote = loadWorkerConfig(dedicated);
  assert.equal(remote.redis.tls?.rejectUnauthorized, true);
  assert.equal(remote.redis.tls?.minVersion, "TLSv1.2");
  assert.equal(remote.redis.tls?.servername, dedicated.REDIS_HOST);
  assert.equal(remote.redis.maxRetriesPerRequest, null, "BullMQ blocking reconnect contract is preserved");
});

for (const [name, value] of [
  ["API_BASE_URL", "http://api.example.test/api/v1"],
  ["API_BASE_URL", "https://user:do-not-log-this@api.example.test/api/v1"],
  ["API_BASE_URL", "https://api.example.test/api/v1?token=do-not-log-this"],
  ["GO_JUDGE_URL", "file:///do-not-log-this"],
  ["GO_JUDGE_URL", "http://sandbox.test/#do-not-log-this"],
  ["REDIS_TLS", "false"], ["REDIS_TLS", "1"],
  ["REDIS_HOST", "rediss://user:do-not-log-this@redis.test"],
  ["REDIS_TLS_SERVERNAME", "127.0.0.1"],
  ["JUDGE_DEPLOYMENT_MODE", "production"],
  ["JUDGE_CONCURRENCY", "0"], ["JUDGE_CONCURRENCY", "129"],
  ["JUDGE_CONCURRENCY", "2.5"], ["JUDGE_CONCURRENCY", "Infinity"],
  ["REDIS_PORT", "0"], ["REDIS_PORT", "65536"],
  ["REDIS_DB", "-1"], ["REDIS_DB", ""],
  ["JUDGE_SERVICE_TOKEN", "short"], ["GO_JUDGE_TOKEN", "short"],
  ["REDIS_PASSWORD", "short"], ["REDIS_PASSWORD", "white space".repeat(5)],
] as const) {
  test(`startup rejects unsafe ${name} setting without echoing its value (${value.slice(0, 18)})`, () => {
    assert.throws(() => loadWorkerConfig({ ...dedicated, [name]: value }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(name) || name === "REDIS_TLS_SERVERNAME");
      assert.ok(!error.message.includes("do-not-log-this"));
      return true;
    });
  });
}

test("dedicated credentials cannot reuse another service's token", () => {
  for (const overrides of [
    { GO_JUDGE_TOKEN: dedicated.JUDGE_SERVICE_TOKEN },
    { REDIS_PASSWORD: dedicated.GO_JUDGE_TOKEN },
    { REDIS_PASSWORD: dedicated.JUDGE_SERVICE_TOKEN },
  ]) assert.throws(() => loadWorkerConfig({ ...dedicated, ...overrides }), /distinct/);
});

test("TLS client identity is paired and never silently ignored on plaintext connections", () => {
  assert.throws(() => loadWorkerConfig({ ...dedicated, REDIS_TLS_CERT_FILE: "/cert" }), /provided together/);
  assert.throws(() => loadWorkerConfig({ ...dedicated, REDIS_TLS_KEY_FILE: "/key" }), /provided together/);
  assert.throws(() => loadWorkerConfig({ ...embedded, REDIS_TLS_SERVERNAME: "redis.test" }), /REDIS_TLS=true/);
  assert.throws(() => loadWorkerConfig({ ...dedicated, REDIS_TLS_CA_FILE: "/absent/do-not-log-this" }), /^Error: Cannot read REDIS_TLS_CA_FILE$/);
});

test("invalid startup configuration exits before attempting an unavailable Redis connection", () => {
  const run = spawnSync(process.execPath, [new URL("./worker.js", import.meta.url).pathname], {
    env: { ...process.env, ...dedicated, REDIS_PORT: "not-a-port", REDIS_HOST: "127.0.0.1" },
    encoding: "utf8", timeout: 2000,
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /REDIS_PORT must be an integer/);
  assert.doesNotMatch(run.stderr, /Redis connection error|ECONNREFUSED|synthetic-api-token/);
});

let directory: string;
let certificate: Buffer;
let key: Buffer;
before(() => {
  directory = mkdtempSync(join(tmpdir(), "oj-worker-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "1",
    "-subj", "/CN=redis.unit.test", "-addext", "subjectAltName=DNS:redis.unit.test",
    "-keyout", join(directory, "key.pem"), "-out", join(directory, "cert.pem")], { stdio: "pipe", timeout: 10_000 });
  certificate = readFileSync(join(directory, "cert.pem"));
  key = readFileSync(join(directory, "key.pem"));
});
after(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

// A small owned RESP endpoint validates the actual ioredis TLS connection, not
// just an options object. It is not a Redis/BullMQ integration test.
async function tlsEndpoint(t: { after(fn: () => unknown): void }, mutual = false) {
  let receivedCommands = 0;
  const sockets = new Set<TLSSocket>();
  const server = createServer({ key, cert: certificate, ca: certificate, requestCert: mutual, rejectUnauthorized: true }, (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length) {
        const header = buffer.indexOf("\r\n");
        if (header < 0) return;
        const count = Number(buffer.subarray(1, header).toString());
        let offset = header + 2;
        const args: string[] = [];
        for (let i = 0; i < count; i++) {
          const end = buffer.indexOf("\r\n", offset);
          if (end < 0) return;
          const length = Number(buffer.subarray(offset + 1, end).toString());
          if (buffer.length < end + 2 + length + 2) return;
          args.push(buffer.subarray(end + 2, end + 2 + length).toString());
          offset = end + 2 + length + 2;
        }
        buffer = buffer.subarray(offset);
        receivedCommands++;
        socket.write(args[0]?.toLowerCase() === "ping" ? "+PONG\r\n" : "+OK\r\n");
      }
    });
  });
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { port: address.port, count: () => receivedCommands };
}

function tlsClient(port: number, overrides: Record<string, string | undefined> = {}) {
  return new Redis({
    ...loadWorkerConfig({ ...dedicated, REDIS_HOST: "127.0.0.1", REDIS_PORT: String(port),
      REDIS_TLS_SERVERNAME: "redis.unit.test", REDIS_TLS_CA_FILE: join(directory, "cert.pem"), ...overrides }).redis,
    lazyConnect: true, enableReadyCheck: false, disableClientInfo: true,
    retryStrategy: () => null, maxRetriesPerRequest: 0, connectTimeout: 1500, commandTimeout: 2000,
  });
}

test("actual ioredis TLS authenticates a trusted named server and sends encrypted commands", async (t) => {
  const endpoint = await tlsEndpoint(t);
  const client = tlsClient(endpoint.port);
  client.on("error", () => {});
  try {
    await client.connect();
    assert.equal(await client.ping(), "PONG");
    assert.ok(endpoint.count() >= 2, "AUTH and PING reach only the established TLS endpoint");
  } finally { client.disconnect(); }
});

for (const [name, overrides] of [
  ["untrusted certificate", { REDIS_TLS_CA_FILE: undefined }],
  ["wrong server identity", { REDIS_TLS_SERVERNAME: "another.unit.test" }],
] as const) {
  test(`actual ioredis TLS rejects ${name} before sending credentials`, async (t) => {
    const endpoint = await tlsEndpoint(t);
    const client = tlsClient(endpoint.port, overrides);
    client.on("error", () => {});
    try { await assert.rejects(client.connect()); } finally { client.disconnect(); }
    assert.equal(endpoint.count(), 0);
  });
}

test("actual ioredis supports a required TLS client certificate and rejects a missing one", async (t) => {
  const endpoint = await tlsEndpoint(t, true);
  const missing = tlsClient(endpoint.port);
  missing.on("error", () => {});
  try { await assert.rejects(async () => { await missing.connect(); await missing.ping(); }); } finally { missing.disconnect(); }
  assert.equal(endpoint.count(), 0);
  const client = tlsClient(endpoint.port, { REDIS_TLS_CERT_FILE: join(directory, "cert.pem"), REDIS_TLS_KEY_FILE: join(directory, "key.pem") });
  client.on("error", () => {});
  try { await client.connect(); assert.equal(await client.ping(), "PONG"); } finally { client.disconnect(); }
  assert.ok(endpoint.count() >= 2);
});
