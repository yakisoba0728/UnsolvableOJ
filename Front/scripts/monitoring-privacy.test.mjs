import test from "node:test";
import assert from "node:assert/strict";
import {
  isEmailActionPath,
  redactTelemetry,
} from "../src/monitoringPrivacy.ts";

test("mail action screens are identified before Sentry initialization", () => {
  for (const path of ["/email/verify", "/email/verify/", "/email/unsubscribe"])
    assert.equal(isEmailActionPath(path), true);
  for (const path of ["/", "/settings", "/community", "/email/verify-other"])
    assert.equal(isEmailActionPath(path), false);
});

test("navigation secrets remain redacted after leaving the email action page", () => {
  const secret = "not-a-real-verification-secret";
  const link = `https://judge.example/email/verify#token=${secret}`;
  const source = {
    request: {
      url: "/settings",
      headers: { Referer: link, Authorization: "Bearer sensitive-value" },
    },
    breadcrumbs: [
      { category: "navigation", data: { from: link, to: "/settings" } },
      {
        category: "navigation",
        data: { from: encodeURIComponent(encodeURIComponent(link)) },
      },
      {
        category: "fetch",
        data: {
          url: "/api/v1/email/verification/confirm",
          body: JSON.stringify({ token: secret }),
        },
      },
    ],
    extra: {
      token: secret,
      password: "password-value",
      nested: [{ refreshToken: secret }],
    },
    message: `Request failed at ${link}`,
  };
  const clean = redactTelemetry(source);
  const serialized = JSON.stringify(clean);
  for (const value of [secret, "sensitive-value", "password-value"])
    assert.equal(serialized.includes(value), false);
  assert.equal(clean.breadcrumbs[0].data.to, "/settings");
  assert.equal(clean.request.url, "/settings");
  assert.equal(
    source.extra.token,
    secret,
    "sanitizing does not mutate caller data",
  );
});

test("unsubscribe paths and query-style token leaks are redacted without breaking ordinary error data", () => {
  const clean = redactTelemetry({
    url: "/email/unsubscribe#token=unsubscribe-secret",
    message: "Error for /somewhere?token=query-secret",
    error: { type: "TypeError", value: "Network connection failed" },
    values: [null, 42, true, "ordinary breadcrumb"],
  });
  assert.equal(clean.url, "[redacted]");
  assert.equal(clean.message, "[redacted]");
  assert.deepEqual(clean.error, {
    type: "TypeError",
    value: "Network connection failed",
  });
  assert.deepEqual(clean.values, [null, 42, true, "ordinary breadcrumb"]);
});

// The optional SDK lifecycle must preserve the same privacy boundary while its chunk loads.
import { createMonitoringClient } from "../src/monitoringClient.ts";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const fakeSdk = () => {
  const calls = { initialized: [], captured: [] };
  return {
    calls,
    init(options) { calls.initialized.push(options); },
    captureException(error) { calls.captured.push(error); return "event-id"; },
  };
};

test("disabled monitoring and mail action pages never download the optional SDK", async () => {
  let loads = 0;
  const load = async () => { loads += 1; return fakeSdk(); };
  for (const options of [
    { dsn: undefined, getPath: () => "/" },
    { dsn: "test-dsn", getPath: () => "/email/verify" },
    { dsn: "test-dsn", getPath: () => "/email/unsubscribe" },
  ]) {
    const client = createMonitoringClient({ environment: "test", load, ...options });
    client.init();
    client.report(new Error("local error"));
  }
  await flush();
  assert.equal(loads, 0);
});

test("initialization and early errors share one SDK download and redact telemetry", async () => {
  let loads = 0;
  const sdk = fakeSdk();
  const client = createMonitoringClient({
    dsn: "test-dsn", environment: "test", getPath: () => "/problems",
    load: async () => { loads += 1; return sdk; },
  });
  const error = new Error("visible error");
  client.init();
  client.report(error);
  client.init();
  await flush();
  assert.equal(loads, 1);
  assert.equal(sdk.calls.initialized.length, 1);
  assert.deepEqual(sdk.calls.captured, [error]);
  assert.equal(sdk.calls.initialized[0].tracesSampleRate, 0);
  assert.equal(sdk.calls.initialized[0].beforeSend({ extra: { token: "secret" } }).extra.token, "[redacted]");
});

test("entering a mail action while the SDK downloads suppresses initialization and queued errors", async () => {
  let pathname = "/problems";
  let release;
  const sdk = fakeSdk();
  const client = createMonitoringClient({
    dsn: "test-dsn", environment: "test", getPath: () => pathname,
    load: () => new Promise(resolve => { release = resolve; }),
  });
  client.init();
  client.report(new Error("pending error"));
  pathname = "/email/verify";
  release(sdk);
  await flush();
  assert.equal(sdk.calls.initialized.length, 0);
  assert.equal(sdk.calls.captured.length, 0);
  pathname = "/problems";
  client.init();
  release(sdk);
  await flush();
  assert.equal(sdk.calls.initialized.length, 1);
  pathname = "/email/unsubscribe";
  assert.equal(sdk.calls.initialized[0].beforeSend({ message: "secret" }), null);
  assert.equal(sdk.calls.initialized[0].beforeBreadcrumb({ message: "secret" }), null);
});

test("an unavailable telemetry chunk is recoverable without an unhandled rejection", async () => {
  const sdk = fakeSdk();
  let loads = 0;
  const client = createMonitoringClient({
    dsn: "test-dsn", environment: "test", getPath: () => "/",
    load: async () => { if (++loads === 1) throw new Error("offline"); return sdk; },
  });
  client.init();
  await flush();
  client.report(new Error("later error"));
  await flush();
  assert.equal(loads, 2);
  assert.equal(sdk.calls.initialized.length, 1);
  assert.equal(sdk.calls.captured.length, 1);
});
