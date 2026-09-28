import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";

interface Claim {
  submissionId: string;
  language: string;
  sourceCode: string;
  limits: { timeMs: number; memoryMb: number };
  testCases: {
    id: string;
    input: string;
    expectedOutput: string;
    score: number;
  }[];
}

interface JudgeResult {
  status: string;
  runtimeMs?: number;
  memoryKb?: number;
  passedTestCases: number;
  totalTestCases: number;
  compileOutput?: string;
  judgeMessage?: string;
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000/api/v1";
const token = process.env.JUDGE_SERVICE_TOKEN;
if (!token) throw new Error("JUDGE_SERVICE_TOKEN is required");

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

function runContainer(claim: Claim): Promise<JudgeResult> {
  const name = `unsolvable-judge-${randomUUID()}`;
  const image =
    process.env.JUDGE_RUNTIME_IMAGE ?? "unsolvable-judge-runtime:local";
  const memoryMb = Math.max(128, claim.limits.memoryMb + 96);
  const timeoutMs = Math.min(
    600_000,
    60_000 + claim.testCases.length * claim.limits.timeMs,
  );

  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "-i",
        "--name",
        name,
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "64",
        "--memory",
        `${memoryMb}m`,
        "--memory-swap",
        `${memoryMb}m`,
        "--cpus",
        "1",
        "--tmpfs",
        "/workspace:rw,exec,nosuid,size=256m,mode=1777",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
        "--env",
        "HOME=/workspace",
        "--env",
        "GOCACHE=/workspace/go-cache",
        "--env",
        "GOPATH=/workspace/go",
        "--env",
        "TMPDIR=/workspace/tmp",
        "--user",
        "65534:65534",
        "--workdir",
        "/workspace",
        image,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let outputExceeded = false;
    let spawnError: Error | undefined;
    const stop = () => {
      const removal = spawn("docker", ["rm", "-f", name], { stdio: "ignore" });
      removal.on("error", () => undefined);
      child.kill("SIGKILL");
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 1_000_000 && !outputExceeded) {
        outputExceeded = true;
        stop();
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < 16_000) {
        stderr.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (spawnError) return reject(spawnError);
      if (timedOut) return reject(new Error("Judge container timed out"));
      if (outputExceeded)
        return reject(new Error("Judge runner produced too much output"));
      if (code === 137)
        return resolve({
          status: "MEMORY_LIMIT_EXCEEDED",
          passedTestCases: 0,
          totalTestCases: claim.testCases.length,
        });
      if (code !== 0)
        return reject(
          new Error(
            `Judge container exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 1000)}`,
          ),
        );
      try {
        resolve(
          JSON.parse(Buffer.concat(stdout).toString("utf8")) as JudgeResult,
        );
      } catch {
        reject(new Error("Judge runner returned invalid JSON"));
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(JSON.stringify(claim));
  });
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
      result = await runContainer(claim);
    } catch (error) {
      result = {
        status: "SYSTEM_ERROR",
        passedTestCases: 0,
        totalTestCases: claim.testCases.length,
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
