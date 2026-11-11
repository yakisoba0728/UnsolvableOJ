import { expect, test, type Page } from "@playwright/test";
import { authenticate, mockProblemApi } from "./fixtures";
import type {
  AttemptView,
  EnterpriseTest,
  TestResults,
} from "../src/enterprise/model";
import type { VibeReview, VibeCatalog } from "../src/vibe/types";

const iso = (minutes: number) =>
  new Date(Date.now() + minutes * 60000).toISOString();
const taskId = "post-search-v1";
const challenge: VibeCatalog["items"][number] = {
  id: taskId,
  title: "게시글 검색 API 개선하기",
  summary: "버그 수정과 태그 필터 추가",
  stack: "TypeScript",
  difficulty: "입문",
  durationMin: 45,
  requirements: ["검색 버그를 수정하세요."],
  rubric: [{ label: "결과물", max: 40, description: "기능 검증" }],
};
const exam = (): EnterpriseTest => ({
  id: "t1",
  title: "실무 코딩 테스트",
  description: "",
  startsAt: iso(-60),
  endsAt: iso(60),
  durationMin: 30,
  problemIds: [],
  vibeChallengeIds: [taskId],
  inviteCode: "abc",
  inviteOnly: false,
  invitees: [],
  showScoreToCandidates: false,
  attemptCount: 1,
  createdAt: iso(-120),
  updatedAt: iso(-120),
});
const review = (): VibeReview => ({
  id: "v1",
  challenge,
  candidate: { id: "c1", username: "candidate" },
  canGrade: true,
  enterprise: {
    testId: "t1",
    attemptId: "a1",
    finished: true,
    scoreVisible: false,
  },
  startedAt: iso(-30),
  deadlineAt: iso(-1),
  submittedAt: null,
  revision: 1,
  busyUntil: null,
  files: { "src/search.ts": "export const fixed = true;" },
  editablePaths: ["src/search.ts"],
  messages: [
    {
      id: "m1",
      role: "user",
      text: "빈 검색어와 대소문자 테스트도 작성해 주세요.",
      createdAt: iso(-20),
      baseRevision: 0,
    },
    {
      id: "m2",
      role: "assistant",
      text: "공백을 정규화하고 검증합니다.",
      createdAt: iso(-19),
      baseRevision: 0,
      files: { "src/search.ts": "export const fixed = true;" },
    },
  ],
  events: [
    {
      id: "e1",
      type: "apply",
      revision: 1,
      createdAt: iso(-18),
      paths: ["src/search.ts"],
      messageId: "m2",
    },
  ],
  runs: [
    {
      id: "r1",
      revision: 1,
      createdAt: iso(-17),
      checks: [{ name: "빈 검색어", passed: true }],
    },
  ],
  report: null,
  canUndo: true,
  remainingAiRequests: 19,
  remainingRuns: 19,
  availability: { ai: true, runner: true },
  limits: {
    aiRequests: 20,
    runs: 20,
    dailyAttempts: 5,
    fileBytes: 30000,
    minutes: 45,
  },
  revisions: [
    {
      revision: 0,
      action: "initial",
      paths: [],
      createdAt: iso(-30),
      messageId: null,
    },
    {
      revision: 1,
      action: "apply",
      paths: ["src/search.ts"],
      createdAt: iso(-18),
      messageId: "m2",
    },
  ],
});
async function setup(page: Page) {
  await authenticate(page);
  await mockProblemApi(page);
  await page.route("**/api/v1/problems/mine", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/api/v1/vibe/challenges", (route) =>
    route.fulfill({
      json: { items: [challenge], availability: { ai: true, runner: true } },
    }),
  );
}

test("a company creates a vibe-only assessment and retains its assignment when editing", async ({
  page,
}) => {
  await setup(page);
  let input: Record<string, unknown> | undefined;
  let saved = {
    ...exam(),
    startsAt: iso(60),
    endsAt: iso(600),
    attemptCount: 0,
  };
  await page.route("**/api/v1/enterprise/tests", async (route) => {
    input = route.request().postDataJSON();
    saved = { ...saved, ...input };
    return route.fulfill({ status: 201, json: saved });
  });
  await page.route("**/api/v1/enterprise/tests/t1", (route) =>
    route.fulfill({ json: saved }),
  );
  await page.goto("/enterprise/new");
  await page.getByLabel(/테스트 이름/).fill("실무 코딩 테스트");
  await page
    .getByRole("checkbox", { name: /게시글 검색 API 개선하기/ })
    .check();
  await expect(page.getByText("1 / 20개 선택")).toBeVisible();
  await page
    .getByRole("button", { name: "테스트 만들기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/enterprise\/t1$/);
  expect(input).toMatchObject({ problemIds: [], vibeChallengeIds: [taskId] });
  await expect(
    page.getByText("1문항 · 90분", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "편집", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: /게시글 검색 API 개선하기/ }),
  ).toBeChecked();
});

test("a candidate opens the assigned workspace, returns to the exam and sees no hidden score", async ({
  page,
}) => {
  await setup(page);
  let started = false;
  const view = (): AttemptView => ({
    id: "a1",
    startedAt: iso(-1),
    deadlineAt: iso(29),
    finishedAt: null,
    test: { ...exam(), problemCount: 1 },
    problems: [],
    result: null,
    vibeTasks: [
      {
        challengeId: taskId,
        title: challenge.title,
        id: started ? "v1" : null,
        submittedAt: null,
        score: null,
        status: started ? "working" : "not_started",
      },
    ],
  });
  await page.route("**/api/v1/enterprise/attempts/a1", (route) =>
    route.fulfill({ json: view() }),
  );
  await page.route(
    `**/api/v1/enterprise/attempts/a1/vibe/${taskId}`,
    (route) => {
      started = true;
      return route.fulfill({ status: 201, json: { id: "v1" } });
    },
  );
  await page.route("**/api/v1/vibe/attempts/v1", (route) =>
    route.fulfill({
      json: { ...review(), submittedAt: iso(-1), report: null },
    }),
  );
  await page.goto("/enterprise/attempts/a1");
  await page.getByRole("button", { name: "과제 시작" }).click();
  await expect(page).toHaveURL(/\/vibe\/attempts\/v1$/);
  await expect(
    page.getByText("기업 테스트 과제입니다.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "점수는 담당자의 공개 설정에 따라 응시 종료 후 표시됩니다.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "저장", exact: true }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "← 기업 테스트 응시" }).click();
  await expect(page).toHaveURL(/\/enterprise\/attempts\/a1$/);
  await expect(
    page.getByRole("button", { name: "작업 공간 보기" }),
  ).toBeVisible();
});

test("the owner opens a candidate's prompts, code revisions and runs, then retries pending grading", async ({
  page,
}) => {
  await setup(page);
  let data = review();
  const url = "/api/v1/enterprise/tests/t1/attempts/a1/vibe/v1";
  await page.route("**/api/v1/enterprise/tests/t1", (route) =>
    route.fulfill({ json: exam() }),
  );
  const results: TestResults = {
    test: exam(),
    summary: { candidates: 1, averageScore: null, pending: 1, perfect: 0 },
    candidates: [
      {
        id: "a1",
        user: data.candidate,
        startedAt: data.startedAt,
        deadlineAt: data.deadlineAt,
        finishedAt: iso(-1),
        problems: [],
        solved: 0,
        score: null,
        vibeTasks: [
          {
            challengeId: taskId,
            title: challenge.title,
            id: "v1",
            submittedAt: null,
            score: null,
            status: "working",
          },
        ],
      },
    ],
  };
  await page.route("**/api/v1/enterprise/tests/t1/results", (route) =>
    route.fulfill({ json: results }),
  );
  await page.route(`**${url}`, (route) => route.fulfill({ json: data }));
  await page.route(`**${url}/revisions/*`, (route) => {
    const revision = Number(route.request().url().split("/").at(-1));
    return route.fulfill({
      json: {
        revision,
        previousFiles: { "src/search.ts": "export const fixed = false;" },
        files: {
          "src/search.ts": revision
            ? "export const fixed = true;"
            : "export const fixed = false;",
        },
      },
    });
  });
  await page.route(`**${url}/evaluation`, (route) => {
    data = {
      ...data,
      submittedAt: iso(0),
      report: {
        outcome: 40,
        passed: 11,
        total: 11,
        evaluationStatus: "complete",
        reflection: "",
        checks: [],
        prompt: {
          score: 25,
          feedback: "요구사항이 명확합니다.",
          evidence: ["m1"],
        },
        process: {
          score: 24,
          feedback: "변경 후 테스트를 확인했습니다.",
          evidence: ["r1"],
        },
      },
    };
    return route.fulfill({ status: 201, json: data });
  });
  await page.goto("/enterprise/t1");
  await expect(page.getByText("null점")).toHaveCount(0);
  await page.getByRole("link", { name: /candidate.*과정 검토/ }).click();
  await expect(
    page.getByRole("heading", { name: "candidate · 바이브코딩 검토" }),
  ).toBeVisible();
  await expect(
    page.getByText("빈 검색어와 대소문자 테스트도 작성해 주세요."),
  ).toBeVisible();
  await expect(page.getByText("공백을 정규화하고 검증합니다.")).toBeVisible();
  await expect(page.getByLabel("변경 전 코드")).toContainText("fixed = false");
  await expect(page.getByLabel("선택한 버전 코드")).toContainText(
    "fixed = true",
  );
  await page.getByLabel("저장 버전").selectOption("0");
  await expect(page.getByLabel("선택한 버전 코드")).toContainText(
    "fixed = false",
  );
  await expect(
    page.getByText("제안 코드 · 적용됨"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "테스트 실행 기록 (1)" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "저장본 채점" }).click();
  await expect(
    page.getByRole("heading", { name: "응시 결과 · 89점" }),
  ).toBeVisible();
  await expect(page.getByText("요구사항이 명확합니다.")).toBeVisible();
  await expect(page.getByText(/GPT|medium|OpenAI/)).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator(".ent-review-controls select")).toHaveCount(2);
  expect(await page.locator(".ent-review-controls select").evaluateAll((selects) => selects.every((select) => select.getBoundingClientRect().right <= innerWidth))).toBe(true);
});

test("review access errors stay explicit and cannot expose stale candidate records", async ({
  page,
}) => {
  await setup(page);
  await page.route(
    "**/api/v1/enterprise/tests/t1/attempts/a1/vibe/v1",
    (route) =>
      route.fulfill({
        status: 404,
        json: { message: "응시 과제를 찾을 수 없습니다." },
      }),
  );
  await page.goto("/enterprise/t1/attempts/a1/vibe/v1");
  await expect(page.getByRole("alert")).toHaveText(
    "응시 과제를 찾을 수 없습니다.",
  );
  await expect(
    page.getByRole("heading", { name: "프롬프트와 답변" }),
  ).toHaveCount(0);
});
