import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { checkSandbox, judge, type Claim, type JudgeResult } from "./judge.js";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000/api/v1";
const token = process.env.JUDGE_SERVICE_TOKEN;
if (!token) throw new Error("JUDGE_SERVICE_TOKEN is required");
const sandbox = {
  url: process.env.GO_JUDGE_URL ?? "http://127.0.0.1:5050",
  token: process.env.GO_JUDGE_TOKEN ?? "",
};
await checkSandbox(sandbox);

async function callApi(path: string, method = "GET", body?: unknown, attempt?: { generation: number; attemptId: string }) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      "X-Judge-Token": token!,
      "X-Judge-Worker": workerId,
      ...(attempt ? { "X-Judge-Generation": String(attempt.generation), "X-Judge-Attempt": attempt.attemptId } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409 && method === "GET") return null;
  if (!response.ok)
    throw new Error(`Judge API ${method} ${path}: HTTP ${response.status}`);
  return response.json();
}

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
  maxRetriesPerRequest: null,
});

const workerId = randomUUID();
const workerHeartbeat = setInterval(() => {
  void callApi("/internal/judge/heartbeat", "POST").catch((error) =>
    console.error("Worker heartbeat failed:", error),
  );
}, 10_000);
workerHeartbeat.unref();

const worker = new Worker<{ submissionId: string; generation?: number }>(
  "judge-submissions",
  async (job) => {
    const path = `/internal/judge/submissions/${job.data.submissionId}`;
    const attempt = { generation: job.data.generation ?? 1, attemptId: randomUUID() };
    const claim = (await callApi(path, "GET", undefined, attempt)) as Claim | null;
    if (!claim) return;
    const leaseHeartbeat = setInterval(() => {
      void callApi(`${path}/heartbeat`, "PATCH", undefined, attempt).catch((error) =>
        console.error("Judge lease heartbeat failed:", error),
      );
    }, 10_000);
    leaseHeartbeat.unref();
    let result: JudgeResult;
    try {
      result = await judge(claim, sandbox);
    } catch (error) {
      result = {
        status: "SYSTEM_ERROR",
        runtimeMs: 0,
        memoryKb: 0,
        passedTestCases: 0,
        totalTestCases: claim.testCases.length,
        debugOutputs: [],
        judgeMessage:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Judge failed",
      };
    } finally {
      clearInterval(leaseHeartbeat);
    }
    await callApi(`${path}/result`, "PATCH", result, attempt);
  },
  {
    connection: redis,
    concurrency: Number(process.env.JUDGE_CONCURRENCY ?? 2),
  },
);

worker.on("ready", () => console.log("Judge worker ready"));
worker.on("completed", (job) => console.log(`Judged ${job.id}`));
worker.on("failed", (job, error) =>
  console.error(`Failed ${job?.id}: ${error.message}`),
);
worker.on("error", (error) => console.error("Judge worker error:", error));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(workerHeartbeat);
    void worker
      .close()
      .then(() => redis.quit())
      .then(() => process.exit(0));
  });
}
