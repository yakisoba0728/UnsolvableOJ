export interface Claim {
  language: string;
  sourceCode: string;
  limits: { timeMs: number; memoryMb: number };
  testCases: {
    input: string;
    expectedOutput: string;
    isSample: boolean;
  }[];
}

export interface JudgeResult {
  status: string;
  runtimeMs: number;
  memoryKb: number;
  passedTestCases: number;
  totalTestCases: number;
  compileOutput?: string;
  judgeMessage?: string;
  debugOutputs: {
    testCase: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }[];
}

export interface SandboxConfig {
  url: string;
  token: string;
}

type File = { content: string } | { fileId: string };
interface Command {
  args: string[];
  env: string[];
  files: (File | { name: string; max: number })[];
  copyIn: Record<string, File>;
  copyOutCached: string[];
  copyOutMax: number;
  cpuLimit: number;
  clockLimit: number;
  memoryLimit: number;
  procLimit: number;
  cpuRateLimit: number;
}

interface Execution {
  status: string;
  exitStatus: number;
  time: number;
  runTime: number;
  memory: number;
  fileIds?: Record<string, string>;
  fileError?: { type: string }[];
}

const OUTPUT_LIMIT = 1_000_000;
const STATUSES: Record<string, string> = {
  Accepted: "ACCEPTED",
  "Memory Limit Exceeded": "MEMORY_LIMIT_EXCEEDED",
  "Time Limit Exceeded": "TIME_LIMIT_EXCEEDED",
  "Output Limit Exceeded": "OUTPUT_LIMIT_EXCEEDED",
  "Nonzero Exit Status": "RUNTIME_ERROR",
  Signalled: "RUNTIME_ERROR",
  "Dangerous Syscall": "RUNTIME_ERROR",
};
const ENV = [
  "PATH=/usr/local/bin:/usr/bin:/bin",
  "HOME=/w",
  "TMPDIR=/w",
  "GOCACHE=/w/.cache/go",
  "GOPATH=/w/.go",
  "GOMAXPROCS=2",
  "LANG=C.UTF-8",
];
const LANGUAGES: Record<string, { source: string; compile?: string[]; artifact?: string; run: string[] }> = {
  C: { source: "main.c", compile: ["/usr/bin/gcc", "main.c", "-O2", "-std=gnu17", "-o", "main", "-lm"], artifact: "main", run: ["/w/main"] },
  CPP: { source: "main.cpp", compile: ["/usr/bin/g++", "main.cpp", "-O2", "-std=c++20", "-o", "main"], artifact: "main", run: ["/w/main"] },
  JAVA: {
    source: "Main.java",
    // Stream the jar to avoid JDK's temporary-file copy calls denied inside the sandbox.
    compile: ["/bin/sh", "-c", "mkdir classes && javac -J-Xmx512m -J-XX:ActiveProcessorCount=1 -d classes Main.java && jar -J-Xmx128m -J-XX:ActiveProcessorCount=1 --create -C classes . > main.jar"],
    artifact: "main.jar",
    run: ["/usr/bin/java", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC", "-cp", "/w/main.jar", "Main"],
  },
  PYTHON: { source: "main.py", run: ["/usr/bin/python3", "main.py"] },
  JAVASCRIPT: { source: "main.js", run: ["/usr/bin/node", "main.js"] },
  TYPESCRIPT: { source: "main.ts", compile: ["/usr/local/bin/esbuild", "main.ts", "--outfile=main.js", "--platform=node", "--format=cjs"], artifact: "main.js", run: ["/usr/bin/node", "main.js"] },
  GO: { source: "main.go", compile: ["/usr/bin/go", "build", "-o", "main", "main.go"], artifact: "main", run: ["/w/main"] },
  RUST: { source: "main.rs", compile: ["/usr/bin/rustc", "main.rs", "--edition=2021", "-O", "-o", "main"], artifact: "main", run: ["/w/main"] },
};

async function request(config: SandboxConfig, path: string, signal: AbortSignal, options: RequestInit = {}) {
  const response = await fetch(new URL(path, config.url), {
    ...options,
    headers: { Authorization: `Bearer ${config.token}`, ...options.headers },
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`go-judge ${options.method ?? "GET"} ${path.split("/")[1]}: HTTP ${response.status}`);
  }
  return response;
}

export async function checkSandbox(config: SandboxConfig) {
  if (!config.token) throw new Error("GO_JUDGE_TOKEN is required");
  const signal = AbortSignal.timeout(10_000);
  const version = await (await request(config, "/version", signal)).json();
  const settings = await (await request(config, "/config", signal)).json();
  const runner = settings?.runnerConfig;
  if (version?.os !== "linux" || ![1, 2].includes(runner?.cgroupType) ||
      runner?.seccomp !== true || runner?.workDir !== "/w" || !Array.isArray(runner?.cgroupControllers) ||
      !["cpu", "memory", "pids"].every((name) => runner?.cgroupControllers?.includes(name))) {
    throw new Error("go-judge requires Linux, seccomp, /w and cpu/memory/pids cgroups");
  }
  // /config is public upstream; check authentication before claiming any jobs.
  await (await request(config, "/file", signal)).body?.cancel();
}

async function readOutput(response: Response) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error("go-judge returned no output body");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > OUTPUT_LIMIT) throw new Error("go-judge returned oversized output");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function rstrip(buffer: Buffer) {
  let end = buffer.length;
  while (end && [9, 10, 11, 12, 13, 32].includes(buffer[end - 1])) end--;
  return buffer.subarray(0, end);
}

export async function judge(claim: Claim, config: SandboxConfig, cancellation?: AbortSignal): Promise<JudgeResult> {
  const verdict: JudgeResult = {
    status: "SYSTEM_ERROR", runtimeMs: 0, memoryKb: 0,
    passedTestCases: 0, totalTestCases: claim.testCases.length, debugOutputs: [],
  };
  const language = Object.hasOwn(LANGUAGES, claim.language) ? LANGUAGES[claim.language] : undefined;
  if (!language) return { ...verdict, judgeMessage: "지원하지 않는 언어입니다." };
  const deadline = AbortSignal.timeout(60_000 + claim.testCases.length * claim.limits.timeMs);
  const signal = cancellation ? AbortSignal.any([deadline, cancellation]) : deadline;
  const cached = new Set<string>();

  async function remove(ids: string[]) {
    const results = await Promise.allSettled(ids.map(async (id) => {
      const response = await fetch(new URL(`/file/${encodeURIComponent(id)}`, config.url), {
        method: "DELETE", headers: { Authorization: `Bearer ${config.token}` },
        redirect: "error", signal: AbortSignal.timeout(5_000),
      });
      await response.body?.cancel();
      if (!response.ok && response.status !== 404) throw new Error("go-judge cache deletion failed");
      cached.delete(id);
    }));
    if (results.some((result) => result.status === "rejected")) throw new Error("Could not clean go-judge cached files");
  }

  async function execute(args: string[], copyIn: Record<string, File>, timeMs: number, memoryMb: number, input = "", artifact?: string) {
    const command: Command = {
      args, env: ENV, copyIn,
      files: [{ content: input }, { name: "stdout", max: OUTPUT_LIMIT - 1 }, { name: "stderr", max: OUTPUT_LIMIT - 1 }],
      copyOutCached: ["stdout", "stderr", ...(artifact ? [`${artifact}?`] : [])],
      copyOutMax: 64 * 1024 * 1024,
      cpuLimit: timeMs * 1_000_000, clockLimit: timeMs * 1_000_000,
      memoryLimit: memoryMb * 1024 * 1024, procLimit: 64, cpuRateLimit: 1000,
    };
    const payload: unknown = await (await request(config, "/run", signal, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: [command] }),
    })).json();
    if (!Array.isArray(payload)) throw new Error("Invalid go-judge response");
    // Track even partial/error responses before validation so their files are reclaimed.
    for (const item of payload) {
      if (item?.fileIds && typeof item.fileIds === "object") {
        for (const id of Object.values(item.fileIds)) if (typeof id === "string" && id) cached.add(id);
      }
    }
    const execution: Execution = payload[0];
    if (payload.length !== 1 || !execution || typeof execution.status !== "string" ||
        ![execution.time, execution.runTime, execution.memory, execution.exitStatus].every(Number.isSafeInteger) ||
        execution.time < 0 || execution.runTime < 0 || execution.memory < 0) {
      throw new Error("Invalid go-judge result");
    }
    if (execution.status === "Internal Error" || execution.status === "File Error" ||
        execution.fileError?.some((error) => error.type !== "CollectSizeExceeded")) {
      throw new Error("go-judge could not execute or collect files");
    }
    if (!Object.hasOwn(STATUSES, execution.status) || (execution.status === "Accepted" && execution.exitStatus !== 0)) {
      throw new Error("Unexpected go-judge status");
    }
    const stdoutId = execution.fileIds?.stdout;
    const stderrId = execution.fileIds?.stderr;
    if (typeof stdoutId !== "string" || !stdoutId || typeof stderrId !== "string" || !stderrId) {
      throw new Error("go-judge did not return output files");
    }
    try {
      // JSON strings replace invalid UTF-8; download raw bytes for exact comparison.
      const stdout = await readOutput(await request(config, `/file/${encodeURIComponent(stdoutId)}`, signal));
      const stderr = await readOutput(await request(config, `/file/${encodeURIComponent(stderrId)}`, signal));
      return { execution, stdout, stderr };
    } finally {
      await remove([stdoutId, stderrId]);
    }
  }

  try {
    let copyIn: Record<string, File> = { [language.source]: { content: claim.sourceCode } };
    if (language.compile) {
      const { execution, stdout, stderr } = await execute(language.compile, copyIn, 30_000, 1024, "", language.artifact);
      if (execution.status !== "Accepted") {
        return { ...verdict, status: "COMPILE_ERROR", compileOutput: Buffer.concat([stdout, stderr]).subarray(0, 65_536).toString("utf8") || "컴파일에 실패했거나 자원 제한을 초과했습니다." };
      }
      if (!language.artifact || typeof execution.fileIds?.[language.artifact] !== "string" || !execution.fileIds[language.artifact]) {
        throw new Error("go-judge did not return a compiled artifact");
      }
      copyIn = { [language.artifact]: { fileId: execution.fileIds[language.artifact] } };
    }
    const args = [...language.run];
    if (claim.language === "JAVA") args.splice(1, 0, `-Xmx${claim.limits.memoryMb}m`);
    if (["JAVASCRIPT", "TYPESCRIPT"].includes(claim.language)) args.splice(1, 0, `--max-old-space-size=${claim.limits.memoryMb}`);
    const cases = claim.testCases.map((testCase, index) => ({ ...testCase, index: index + 1 }))
      .sort((left, right) => Number(right.isSample === true) - Number(left.isSample === true));
    for (const testCase of cases) {
      // REST has no per-command RLIMIT_FSIZE; prlimit enforces the exact 1MB hard limit without limiting compiler artifacts.
      const { execution, stdout, stderr } = await execute(
        ["/usr/bin/prlimit", `--fsize=${OUTPUT_LIMIT}:${OUTPUT_LIMIT}`, "--", ...args],
        copyIn, claim.limits.timeMs, claim.limits.memoryMb, testCase.input,
      );
      verdict.runtimeMs = Math.max(verdict.runtimeMs, Math.round(execution.runTime / 1_000_000));
      verdict.memoryKb = Math.max(verdict.memoryKb, Math.ceil(execution.memory / 1024));
      if (testCase.isSample === true && verdict.debugOutputs.length < 5) {
        verdict.debugOutputs.push({
          testCase: testCase.index,
          stdout: stdout.subarray(0, 1000).toString("utf8"), stderr: stderr.subarray(0, 1000).toString("utf8"),
          stdoutTruncated: stdout.length > 1000, stderrTruncated: stderr.length > 1000,
        });
      }
      let status = STATUSES[execution.status];
      if (!["MEMORY_LIMIT_EXCEEDED", "TIME_LIMIT_EXCEEDED"].includes(status) &&
          (stdout.length >= OUTPUT_LIMIT || stderr.length >= OUTPUT_LIMIT)) status = "OUTPUT_LIMIT_EXCEEDED";
      if (status === "RUNTIME_ERROR") verdict.judgeMessage = testCase.isSample === true
        ? stderr.subarray(0, 1000).toString("utf8") : "비공개 테스트에서 런타임 에러가 발생했습니다.";
      if (status !== "ACCEPTED") return { ...verdict, status };
      if (!rstrip(stdout).equals(rstrip(Buffer.from(testCase.expectedOutput)))) return { ...verdict, status: "WRONG_ANSWER" };
      verdict.passedTestCases++;
    }
    return { ...verdict, status: "ACCEPTED" };
  } finally {
    await remove([...cached]);
  }
}
