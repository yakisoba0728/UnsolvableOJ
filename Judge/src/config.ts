import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { createSecureContext, type ConnectionOptions } from "node:tls";
import type { RedisOptions } from "ioredis";

type Environment = Readonly<Record<string, string | undefined>>;

function integer(env: Environment, name: string, fallback: number, min: number, max: number) {
  const text = env[name] ?? String(fallback);
  if (!/^\d+$/.test(text)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function hostname(value: string, name: string) {
  if (!isIP(value) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.?$/i.test(value)) {
    throw new Error(`${name} must contain a hostname or IP address, not a URL`);
  }
  return value;
}

function serviceUrl(value: string, name: string, httpsOnly = false) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTP(S) URL`); }
  if (!(httpsOnly ? url.protocol === "https:" : ["http:", "https:"].includes(url.protocol))) {
    throw new Error(`${name} must use ${httpsOnly ? "HTTPS in dedicated mode" : "HTTP(S)"}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, a query or a fragment`);
  }
  return url.href.replace(/\/$/, "");
}

function tlsFile(env: Environment, name: string): Buffer | undefined {
  if (!env[name]) return undefined;
  try { return readFileSync(env[name]); } catch { throw new Error(`Cannot read ${name}`); }
}

/** Validate before opening any connection. Errors name settings, never values. */
export function loadWorkerConfig(env: Environment) {
  const mode = env.JUDGE_DEPLOYMENT_MODE ?? "embedded";
  if (mode !== "embedded" && mode !== "dedicated") {
    throw new Error("JUDGE_DEPLOYMENT_MODE must be embedded or dedicated");
  }
  const dedicated = mode === "dedicated";
  const tlsSetting = env.REDIS_TLS ?? "false";
  if (tlsSetting !== "true" && tlsSetting !== "false") throw new Error("REDIS_TLS must be true or false");
  if (dedicated && tlsSetting !== "true") throw new Error("REDIS_TLS must be true in dedicated mode");

  const apiToken = env.JUDGE_SERVICE_TOKEN ?? "";
  const sandboxToken = env.GO_JUDGE_TOKEN ?? "";
  if (!apiToken) throw new Error("JUDGE_SERVICE_TOKEN is required");
  if (!sandboxToken) throw new Error("GO_JUDGE_TOKEN is required");
  if (dedicated) {
    for (const name of ["JUDGE_SERVICE_TOKEN", "GO_JUDGE_TOKEN", "REDIS_PASSWORD"] as const) {
      const token = env[name] ?? "";
      if (token.length < 32 || /\s/.test(token)) throw new Error(`${name} must contain at least 32 non-whitespace characters in dedicated mode`);
    }
    if (new Set([apiToken, sandboxToken, env.REDIS_PASSWORD]).size !== 3) {
      throw new Error("Dedicated API, sandbox and Redis credentials must be distinct");
    }
  }

  const host = hostname(env.REDIS_HOST ?? "localhost", "REDIS_HOST");
  const tlsNames = ["REDIS_TLS_SERVERNAME", "REDIS_TLS_CA_FILE", "REDIS_TLS_CERT_FILE", "REDIS_TLS_KEY_FILE"];
  if (tlsSetting === "false" && tlsNames.some((name) => env[name])) {
    throw new Error("Redis TLS options require REDIS_TLS=true");
  }
  if (Boolean(env.REDIS_TLS_CERT_FILE) !== Boolean(env.REDIS_TLS_KEY_FILE)) {
    throw new Error("REDIS_TLS_CERT_FILE and REDIS_TLS_KEY_FILE must be provided together");
  }
  let tls: ConnectionOptions | undefined;
  if (tlsSetting === "true") {
    const servername = env.REDIS_TLS_SERVERNAME
      ? hostname(env.REDIS_TLS_SERVERNAME, "REDIS_TLS_SERVERNAME") : isIP(host) ? undefined : host;
    if (servername && isIP(servername)) throw new Error("REDIS_TLS_SERVERNAME must be a DNS hostname");
    tls = {
      minVersion: "TLSv1.2",
      rejectUnauthorized: true,
      ...(servername ? { servername } : {}),
      ca: tlsFile(env, "REDIS_TLS_CA_FILE"),
      cert: tlsFile(env, "REDIS_TLS_CERT_FILE"),
      key: tlsFile(env, "REDIS_TLS_KEY_FILE"),
    };
    try { createSecureContext(tls); } catch { throw new Error("Invalid Redis TLS CA, client certificate or private key"); }
  }
  const redis: RedisOptions = {
    host,
    port: integer(env, "REDIS_PORT", 6379, 1, 65535),
    username: env.REDIS_USERNAME || undefined,
    password: env.REDIS_PASSWORD || undefined,
    db: integer(env, "REDIS_DB", 0, 0, 2_147_483_647),
    maxRetriesPerRequest: null,
    ...(tls ? { tls } : {}),
  };
  return {
    redis,
    api: { url: serviceUrl(env.API_BASE_URL ?? "http://localhost:3000/api/v1", "API_BASE_URL", dedicated), token: apiToken },
    sandbox: { url: serviceUrl(env.GO_JUDGE_URL ?? "http://127.0.0.1:5050", "GO_JUDGE_URL"), token: sandboxToken },
    concurrency: integer(env, "JUDGE_CONCURRENCY", 2, 1, 128),
  };
}
