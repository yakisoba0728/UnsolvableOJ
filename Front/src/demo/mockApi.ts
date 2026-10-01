import { ApiError } from "../api";
import type {
  Page,
  Problem,
  ProblemSummary,
  RankingEntry,
  Session,
  Submission,
  User,
  UserProfile,
} from "../types";
import { demoProblems, demoRankers, type DemoProblem } from "./data";

/**
 * 백엔드 없이 화면을 시연하기 위한 브라우저 내 가짜 API (VITE_DEMO_MODE=true).
 * 데이터는 이 브라우저의 localStorage에만 저장되며, 채점은 실제 실행이 아닌 시뮬레이션이다.
 */

const storageKey = "unsolvable-oj-demo-v1";
const XP_PER_SOLVE = 10;
const HIDDEN_CASES = 3;

interface DemoUser extends User {
  solved: string[];
  createdAt: string;
}
interface DemoSubmission extends Submission {
  userId: string;
  awarded: boolean;
  finalStatus: string;
}
interface Store {
  users: DemoUser[];
  submissions: DemoSubmission[];
  problems: (DemoProblem & { id: string; createdAt: string })[];
}

const hourMs = 3_600_000;

function seedStore(): Store {
  const now = Date.now();
  const problems = demoProblems.map((problem, index) => ({
    ...problem,
    id: `demo-problem-${index + 1}`,
    createdAt: new Date(now - (demoProblems.length - index) * 6 * hourMs).toISOString(),
  }));
  const demoUser: DemoUser = {
    id: "demo-user",
    email: "demo@unsolvable.local",
    username: "demo",
    role: "AUTHOR",
    level: 1,
    xp: 0,
    rating: 0,
    solved: [],
    createdAt: new Date(now).toISOString(),
  };
  return { users: [demoUser], submissions: [], problems };
}

function load(): Store {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return JSON.parse(raw) as Store;
  } catch {
    /* 저장소를 쓸 수 없으면 새로 시작한다 */
  }
  return seedStore();
}

let memory: Store | null = null;
function store(): Store {
  memory ??= load();
  return memory;
}
function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(store()));
  } catch {
    /* 메모리 상태로만 유지 */
  }
}

const levelOf = (xp: number) => 1 + Math.floor(xp / 100);
const publicUser = ({ solved: _solved, createdAt: _created, ...user }: DemoUser): User => user;

function sessionFor(user: DemoUser): Session {
  return {
    accessToken: `demo.${user.id}`,
    tokenType: "Bearer",
    expiresIn: "12h",
    user: publicUser(user),
  };
}

function authed(token?: string): DemoUser {
  const user = store().users.find((item) => `demo.${item.id}` === token);
  if (!user) throw new ApiError(401, "로그인이 필요합니다.");
  return user;
}

// ---- 채점 시뮬레이션 -------------------------------------------------
const OUTPUT_PATTERN =
  /(print|cout|printf|console\.log|System\.out|fmt\.Print|println!|puts|write)/;

function judge(source: string, problem: DemoProblem) {
  const total = problem.samples.length + HIDDEN_CASES;
  if (OUTPUT_PATTERN.test(source) && source.trim().length > 20)
    return { status: "ACCEPTED", passed: total, total };
  return { status: "WRONG_ANSWER", passed: 0, total };
}

/** 제출 후 경과 시간에 따라 QUEUED → JUDGING → 최종 판정으로 보이게 한다. */
function settle(submission: DemoSubmission, user: DemoUser) {
  const elapsed = Date.now() - new Date(submission.createdAt).getTime();
  if (elapsed < 800) return { ...submission, status: "QUEUED" };
  if (elapsed < 1800) return { ...submission, status: "JUDGING" };
  if (submission.finalStatus === "ACCEPTED" && !submission.awarded) {
    submission.awarded = true;
    if (!user.solved.includes(submission.problem.id)) {
      user.solved.push(submission.problem.id);
      user.xp += XP_PER_SOLVE;
      user.level = levelOf(user.xp);
      user.rating = user.solved.length * 20;
    }
    save();
  }
  const accepted = submission.finalStatus === "ACCEPTED";
  return {
    ...submission,
    status: submission.finalStatus,
    runtimeMs: 8 + (submission.sourceCode?.length ?? 0) % 90,
    memoryKb: 9000 + (submission.sourceCode?.length ?? 0) * 7 % 20000,
    passedTestCases: accepted ? submission.totalTestCases : 0,
    judgeMessage: accepted
      ? "데모 모드: 실제 채점이 아닌 시뮬레이션 결과입니다."
      : "데모 모드: 출력 구문이 없는 코드는 오답으로 처리하는 시뮬레이션입니다.",
  };
}

// ---- 라우팅 ----------------------------------------------------------
function paginate<T>(items: T[], params: URLSearchParams): Page<T> {
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 20)));
  return {
    items: items.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: items.length,
    totalPages: Math.ceil(items.length / limit),
  };
}

const summary = (p: Store["problems"][number]): ProblemSummary => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  difficulty: p.difficulty,
  timeLimitMs: p.timeLimitMs,
  memoryLimitMb: p.memoryLimitMb,
  createdAt: p.createdAt,
});

function rankings(): RankingEntry[] {
  const dummies: RankingEntry[] = demoRankers.map((r, index) => ({
    id: `demo-ranker-${index}`,
    username: r.username,
    level: levelOf(r.xp),
    xp: r.xp,
    rating: r.solved * 20,
    solvedCount: r.solved,
  }));
  const real: RankingEntry[] = store().users.map((u) => ({
    id: u.id,
    username: u.username,
    level: u.level,
    xp: u.xp,
    rating: u.rating,
    solvedCount: u.solved.length,
  }));
  return [...dummies, ...real].sort((a, b) => b.xp - a.xp);
}

function body(options: RequestInit): Record<string, unknown> {
  try {
    return JSON.parse(String(options.body ?? "{}"));
  } catch {
    return {};
  }
}

export async function mockApi<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 120));
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  const method = (options.method ?? "GET").toUpperCase();
  const s = store();

  if (pathname === "/auth/register" && method === "POST") {
    const { email, username } = body(options) as Record<string, string>;
    if (!email || !username) throw new ApiError(400, "이메일과 닉네임을 입력해 주세요.");
    if (s.users.some((u) => u.email === email || u.username === username))
      throw new ApiError(409, "이미 사용 중인 이메일 또는 닉네임입니다.");
    const user: DemoUser = {
      id: `demo-${Date.now().toString(36)}`,
      email,
      username,
      role: "USER",
      level: 1,
      xp: 0,
      rating: 0,
      solved: [],
      createdAt: new Date().toISOString(),
    };
    s.users.push(user);
    save();
    return sessionFor(user) as T;
  }
  if (pathname === "/auth/login" && method === "POST") {
    const { email } = body(options) as Record<string, string>;
    const user = s.users.find((u) => u.email === email);
    if (!user)
      throw new ApiError(401, "등록되지 않은 이메일입니다. 데모 계정: demo@unsolvable.local");
    return sessionFor(user) as T;
  }

  if (pathname === "/problems" && method === "GET") {
    const difficulty = params.get("difficulty");
    const list = [...s.problems]
      .filter((p) => !difficulty || p.difficulty === difficulty)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(summary);
    return paginate(list, params) as T;
  }
  if (pathname === "/problems" && method === "POST") {
    const user = authed(token);
    if (user.role === "USER") throw new ApiError(403, "작성자 권한이 필요합니다.");
    const input = body(options) as Partial<DemoProblem> & { testCases?: unknown[]; status?: string };
    if (!input.slug || !input.title) throw new ApiError(400, "주소와 제목을 입력해 주세요.");
    if (s.problems.some((p) => p.slug === input.slug))
      throw new ApiError(409, "이미 사용 중인 문제 주소입니다.");
    const created = {
      slug: input.slug,
      title: input.title,
      difficulty: input.difficulty ?? "BEGINNER",
      timeLimitMs: input.timeLimitMs ?? 1000,
      memoryLimitMb: input.memoryLimitMb ?? 256,
      statementMarkdown: input.statementMarkdown ?? "",
      inputDescriptionMarkdown: input.inputDescriptionMarkdown ?? "",
      outputDescriptionMarkdown: input.outputDescriptionMarkdown ?? "",
      samples: [],
      id: `demo-problem-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    } as Store["problems"][number];
    const status = input.status === "DRAFT" ? "DRAFT" : "PUBLISHED";
    if (status === "PUBLISHED") {
      s.problems.push(created);
      save();
    }
    return { ...summary(created), ...created, status, updatedAt: created.createdAt } as T;
  }
  const problemMatch = /^\/problems\/(?:by-slug\/)?([^/]+)$/.exec(pathname);
  if (problemMatch && method === "GET") {
    const found = s.problems.find((p) => p.slug === decodeURIComponent(problemMatch[1]));
    if (!found) throw new ApiError(404, "문제를 찾을 수 없습니다.");
    return { ...found, status: "PUBLISHED", updatedAt: found.createdAt } as unknown as T;
  }
  const submitMatch = /^\/problems\/([^/]+)\/submissions$/.exec(pathname);
  if (submitMatch && method === "POST") {
    const user = authed(token);
    const problem = s.problems.find((p) => p.id === submitMatch[1]);
    if (!problem) throw new ApiError(404, "문제를 찾을 수 없습니다.");
    const { language, sourceCode } = body(options) as Record<string, string>;
    if (!sourceCode?.trim()) throw new ApiError(400, "소스 코드를 입력해 주세요.");
    const verdict = judge(sourceCode, problem);
    const now = new Date().toISOString();
    const submission: DemoSubmission = {
      id: `${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}-demo`,
      userId: user.id,
      awarded: false,
      finalStatus: verdict.status,
      problem: { id: problem.id, slug: problem.slug, title: problem.title },
      language: language as Submission["language"],
      status: "QUEUED",
      runtimeMs: null,
      memoryKb: null,
      passedTestCases: 0,
      totalTestCases: verdict.total,
      compileOutput: null,
      judgeMessage: null,
      sourceCode,
      createdAt: now,
      updatedAt: now,
    };
    s.submissions.unshift(submission);
    save();
    return settle(submission, user) as unknown as T;
  }

  if (pathname === "/submissions" && method === "GET") {
    const user = authed(token);
    const problemId = params.get("problemId");
    const list = s.submissions
      .filter((item) => item.userId === user.id && (!problemId || item.problem.id === problemId))
      .map((item) => settle(item, user));
    return paginate(list, params) as unknown as T;
  }
  const submissionMatch = /^\/submissions\/([^/]+)$/.exec(pathname);
  if (submissionMatch && method === "GET") {
    const user = authed(token);
    const found = s.submissions.find((item) => item.id === submissionMatch[1] && item.userId === user.id);
    if (!found) throw new ApiError(404, "제출을 찾을 수 없습니다.");
    return settle(found, user) as unknown as T;
  }

  if (pathname === "/users/me" && method === "GET") {
    const user = authed(token);
    const profile: UserProfile = {
      ...publicUser(user),
      createdAt: user.createdAt,
      solvedCount: user.solved.length,
    };
    return profile as T;
  }
  if (pathname === "/rankings" && method === "GET") return rankings() as T;

  throw new ApiError(404, `데모 모드에서 지원하지 않는 요청입니다 (${method} ${pathname}).`);
}
