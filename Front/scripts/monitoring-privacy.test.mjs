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
