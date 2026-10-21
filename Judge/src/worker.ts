import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { checkSandbox, judge, type Claim, type JudgeResult, type SandboxConfig } from "./judge.js";

interface JudgeJob {
  data: { submissionId: string; generation: number };
}

class JudgeApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function startWorker(
  api: { url: string; token: string },
  sandbox: SandboxConfig,
  consume: (processor: (job: JudgeJob) => Promise<void>) => Pick<Worker, "pause" | "close">,
  runJudge = judge,
) {
  if (!api.token) throw new Error("JUDGE_SERVICE_TOKEN is required");
  const workerId = randomUUID();
  const active = new Set<AbortController>();
  let worker: Pick<Worker, "pause" | "close"> | undefined;
  let workerHeartbeat: ReturnType<typeof setInterval> | undefined;
  let authenticationFailure: JudgeApiError | undefined;

  async function callApi(path: string, method = "GET", body?: unknown, attempt?: { generation: number; attemptId: string }, cancellation?: AbortSignal) {
    if (authenticationFailure) throw authenticationFailure;
    const deadline = AbortSignal.timeout(15_000);
    const response = await fetch(`${api.url}${path}`, {
      method,
      headers: {
        "X-Judge-Token": api.token,
        "X-Judge-Worker": workerId,
        ...(attempt ? { "X-Judge-Generation": String(attempt.generation), "X-Judge-Attempt": attempt.attemptId } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: cancellation ? AbortSignal.any([deadline, cancellation]) : deadline,
    });
    if (!response.ok) {
      const error = new JudgeApiError(`Judge API ${method} ${path}: HTTP ${response.status}`, response.status);
      if ((response.status === 401 || response.status === 403) && !authenticationFailure) {
        authenticationFailure = error;
        console.error(`Judge worker paused; restart required after API authentication failure: ${error.message}`);
        clearInterval(workerHeartbeat);
        void worker?.pause(true).catch((pauseError) => console.error("Judge worker pause failed:", pauseError));
        for (const controller of active) controller.abort(error);
      }
      await response.body?.cancel().catch(() => {});
      if (response.status === 409 && method === "GET") return null;
      throw error;
    }
    return response.json();
  }

  await checkSandbox(sandbox);
  await callApi("/internal/judge/heartbeat", "POST");
  worker = consume(async (job) => {
    const path = `/internal/judge/submissions/${job.data.submissionId}`;
    const attempt = { generation: job.data.generation, attemptId: randomUUID() };
    const cancellation = new AbortController();
    active.add(cancellation);
    let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const claim = (await callApi(path, "GET", undefined, attempt, cancellation.signal)) as Claim | null;
      if (!claim || cancellation.signal.aborted) return;
      let renewing = false;
      leaseHeartbeat = setInterval(() => {
        if (renewing || cancellation.signal.aborted) return;
        renewing = true;
        void callApi(`${path}/heartbeat`, "PATCH", undefined, attempt, cancellation.signal).catch((error) => {
          if (error instanceof JudgeApiError && error.status === 409) cancellation.abort(error);
          else if (!cancellation.signal.aborted) console.error("Judge lease heartbeat failed:", error);
        }).finally(() => { renewing = false; });
      }, 10_000);
      leaseHeartbeat.unref();
      let result: JudgeResult;
      try {
        result = await runJudge(claim, sandbox, cancellation.signal);
      } catch (error) {
        if (cancellation.signal.aborted) return;
        console.error(`Judge failed for ${job.data.submissionId}:`, error);
        result = {
          status: "SYSTEM_ERROR",
          runtimeMs: 0,
          memoryKb: 0,
          passedTestCases: 0,
          totalTestCases: claim.testCases.length,
          debugOutputs: [],
          judgeMessage: "채점 중 시스템 오류가 발생했습니다.",
        };
      }
      // Replay this attempt's result: a new BullMQ invocation cannot reclaim its live lease.
      for (let retry = 0; ; retry++) {
        if (cancellation.signal.aborted) return;
        try {
          await callApi(`${path}/result`, "PATCH", result, attempt, cancellation.signal);
          if (!cancellation.signal.aborted) console.log(`Judged ${job.data.submissionId}`);
          return;
        } catch (error) {
          if (cancellation.signal.aborted) return;
          if (retry === 2 || (error instanceof JudgeApiError && error.status !== 429 &&
              (error.status < 500 || error.status >= 600))) throw error;
          try {
            await timers.setTimeout(1000 * 2 ** retry, undefined, { signal: cancellation.signal });
          } catch (delayError) {
            if (cancellation.signal.aborted) return;
            throw delayError;
          }
        }
      }
    } finally {
      clearInterval(leaseHeartbeat);
      cancellation.abort();
      active.delete(cancellation);
    }
  });
  workerHeartbeat = setInterval(() => {
    void callApi("/internal/judge/heartbeat", "POST").catch((error) => {
      if (!authenticationFailure) console.error("Worker heartbeat failed:", error);
    });
  }, 10_000);
  workerHeartbeat.unref();

  return {
    async close() {
      clearInterval(workerHeartbeat);
      await worker!.close();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import("dotenv/config");
  let redis: Redis;
  const running = await startWorker({
    url: process.env.API_BASE_URL ?? "http://localhost:3000/api/v1",
    token: process.env.JUDGE_SERVICE_TOKEN ?? "",
  }, {
    url: process.env.GO_JUDGE_URL ?? "http://127.0.0.1:5050",
    token: process.env.GO_JUDGE_TOKEN ?? "",
  }, (processor) => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? "localhost",
      port: Number(process.env.REDIS_PORT ?? 6379),
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      db: Number(process.env.REDIS_DB ?? 0),
      maxRetriesPerRequest: null,
    });
    const worker = new Worker("judge-submissions", processor, {
      connection: redis,
      concurrency: Number(process.env.JUDGE_CONCURRENCY ?? 2),
    });
    worker.on("ready", () => console.log("Judge worker ready"));
    worker.on("failed", (job, error) => console.error(`Failed ${job?.id}: ${error.message}`));
    worker.on("error", (error) => console.error("Judge worker error:", error));
    return worker;
  });

  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (closing) return;
      closing = true;
      void running.close().then(() => redis.quit()).then(() => process.exit(0));
    });
  }
}
