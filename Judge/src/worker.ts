import { randomUUID } from "node:crypto";
import timers from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { checkSandbox, judge, SandboxUnavailableError, type Claim, type JudgeResult, type SandboxConfig } from "./judge.js";

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
  consume: (processor: (job: JudgeJob) => Promise<void>) => Pick<Worker, "close">,
  runJudge = judge,
) {
  if (!api.token) throw new Error("JUDGE_SERVICE_TOKEN is required");
  const workerId = randomUUID();
  const active = new Set<AbortController>();
  let worker: Pick<Worker, "close"> | undefined;
  let workerHeartbeat: ReturnType<typeof setInterval> | undefined;
  let authenticationFailure: JudgeApiError | undefined;
  const stopping = new AbortController();
  let sandboxOutage: Promise<void> | undefined;

  // 실행 서비스가 멈추면 새 작업을 꺼내 lease를 소모하지 않도록, 복구될 때까지 채점을 멈추고 상태를 확인한다.
  function waitForSandbox() {
    sandboxOutage ??= (async () => {
      console.error("Sandbox unavailable; pausing judging until it recovers");
      for (let delay = 5_000; ; delay = Math.min(delay * 2, 60_000)) {
        await timers.setTimeout(delay, undefined, { signal: stopping.signal });
        try {
          await checkSandbox(sandbox);
          console.log("Sandbox recovered; resuming judging");
          return;
        } catch (error) {
          console.error("Sandbox still unavailable:", error);
        }
      }
    })().finally(() => { sandboxOutage = undefined; });
    return sandboxOutage;
  }

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
        console.error(`Judge worker exiting after API authentication failure; fix the token: ${error.message}`);
        clearInterval(workerHeartbeat);
        for (const controller of active) controller.abort(error);
        // 결과를 더 보낼 수 없으므로 진행 중인 작업을 기다리지 않고, 종료 코드로 restart 정책과 `docker compose ps`에 드러냅니다.
        void worker?.close(true).catch((closeError) => console.error("Judge worker close failed:", closeError))
          .finally(() => process.exit(1));
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
    // 장애 중이면 lease를 잡기 전에 기다린다. 종료 중이면 작업을 실패시켜 BullMQ가 나중에 다시 시도하게 한다.
    if (sandboxOutage) await sandboxOutage;
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
        if (error instanceof SandboxUnavailableError) {
          // lease를 반납하면 API가 복구 횟수를 쓰지 않고 다음 generation으로 다시 큐에 넣는다.
          // 반납에 실패하면 예전처럼 lease 만료 복구에 맡긴다(제출당 5회 뒤에는 API가 SYSTEM_ERROR로 끝냄).
          void waitForSandbox().catch(() => {});
          await callApi(`${path}/release`, "PATCH", undefined, attempt, cancellation.signal).catch((releaseError) => {
            console.error(`Judge lease release failed for ${job.data.submissionId}:`, releaseError);
            throw error;
          });
          return;
        }
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
    // 실행 서비스 장애 중에는 존재 신호를 멈춰 운영 조회에 채점 가능한 워커로 보이지 않게 한다.
    if (sandboxOutage) return;
    void callApi("/internal/judge/heartbeat", "POST").catch((error) => {
      if (!authenticationFailure) console.error("Worker heartbeat failed:", error);
    });
  }, 10_000);
  workerHeartbeat.unref();

  return {
    async close() {
      clearInterval(workerHeartbeat);
      stopping.abort();
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
