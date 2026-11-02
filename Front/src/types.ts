export type Difficulty = "BEGINNER" | "EASY" | "MEDIUM" | "HARD" | "EXPERT";
export const LANGUAGES = [
  "C",
  "CPP",
  "JAVA",
  "PYTHON",
  "JAVASCRIPT",
  "TYPESCRIPT",
  "GO",
  "RUST",
] as const;
export type Language = (typeof LANGUAGES)[number];
/** 언어 코드(서버 값)를 화면 이름으로. 모르는 코드는 호출하는 쪽에서 그대로 보여 준다. */
export const LANGUAGE_LABELS: Record<string, string> = {
  C: "C",
  CPP: "C++",
  JAVA: "Java",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  GO: "Go",
  RUST: "Rust",
};
export type Role = "USER" | "AUTHOR" | "ADMIN";

export interface User {
  id: string;
  email: string;
  username: string;
  role: Role;
  level: number;
  xp: number;
  rating: number;
}

export interface Session {
  accessToken: string;
  tokenType: string;
  expiresIn: string;
  user: User;
}

export interface ProblemSummary {
  id: string;
  slug: string;
  title: string;
  difficulty: Difficulty;
  timeLimitMs: number;
  memoryLimitMb: number;
  createdAt: string;
  /** 정답을 받은 사용자 수 */
  solverCount?: number;
  /** 채점이 끝난 제출 중 정답 비율(0–100). 제출이 없으면 null */
  acceptanceRate?: number | null;
}

export interface Problem extends ProblemSummary {
  statementMarkdown: string;
  inputDescriptionMarkdown: string;
  outputDescriptionMarkdown: string;
  status: string;
  samples: { input: string; expectedOutput: string }[];
  updatedAt: string;
}

export interface Submission {
  id: string;
  problem: { id: string; slug?: string; title?: string };
  language: Language;
  status: string;
  runtimeMs: number | null;
  memoryKb: number | null;
  passedTestCases: number;
  totalTestCases: number;
  compileOutput: string | null;
  judgeMessage: string | null;
  problemVersion?: number;
  sourceCode?: string;
  sampleTestCases?: {
    testCase: number;
    input: string;
    expectedOutput: string;
  }[];
  debugOutputs?: {
    testCase: number;
    stdout: string;
    stderr: string;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  }[];
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile extends User {
  badges?: { badge: string; awardedAt: string }[];
  createdAt: string;
  solvedCount: number;
}

export interface RankingEntry {
  id: string;
  username: string;
  level: number;
  xp: number;
  rating: number;
  solvedCount: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  /** 다음 페이지 커서(내용은 해석하지 않는다). null이면 끝이고, 옛 오프셋 방식 응답에는 없다. */
  nextCursor?: string | null;
}
