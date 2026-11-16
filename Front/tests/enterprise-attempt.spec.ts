import { expect, test, type Page } from "@playwright/test";
import { answerConfirm } from "./fixtures";
import type { Session } from "../src/types";
import type { AttemptView, PublicTest } from "../src/enterprise/model";

const session: Session = {
  accessToken: "browser-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: { id: "cand", email: "cand@example.com", username: "cand", role: "USER", level: 1, xp: 0, rating: 0 },
};
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const publicTest = (patch: Partial<PublicTest> = {}): PublicTest => ({
  title: "백엔드 채용 1차",
  description: "30분 안에 풀어 주세요.",
  startsAt: iso(-60_000),
  endsAt: iso(3_600_000),
  durationMin: 30,
  problemCount: 1,
  ...patch,
});
const attemptView = (patch: Partial<AttemptView> = {}): AttemptView => ({
  id: "a1",
  startedAt: iso(-60_000),
  deadlineAt: iso(29 * 60_000),
  finishedAt: null,
  test: publicTest(),
  problems: [
    {
      id: "p1",
      title: "두 수의 합",
      difficulty: "BEGINNER",
      statementMarkdown: "두 정수의 합을 출력하세요.",
      inputDescriptionMarkdown: "A B",
      outputDescriptionMarkdown: "A+B",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
      solved: false,
      lastSubmissionId: null,
      lastStatus: null,
    },
  ],
  result: null,
  ...patch,
});

async function signIn(page: Page) {
  await page.addInitScript(
    (saved) => localStorage.setItem("unsolvable-oj-session-v1", JSON.stringify(saved)),
    { session, expiresAt: Date.now() + 900_000 },
  );
}

test("a candidate opens the invite link, starts, submits and sees the problem marked solved", async ({ page }) => {
  await signIn(page);
  let solved = false;
  let started = false;
  await page.route("**/api/v1/enterprise/join/abc", (route) =>
    route.fulfill({ json: { test: publicTest(), isOwner: false, attempt: null } }),
  );
  await page.route("**/api/v1/enterprise/join/abc/start", (route) => {
    started = true;
    return route.fulfill({ status: 201, json: { id: "a1", startedAt: iso(0), deadlineAt: iso(30 * 60_000), finishedAt: null } });
  });
  await page.route("**/api/v1/enterprise/attempts/a1", (route) =>
    route.fulfill({
      json: attemptView({
        problems: [{ ...attemptView().problems[0], solved, lastSubmissionId: solved ? "s1" : null }],
      }),
    }),
  );
  let body: unknown;
  await page.route("**/api/v1/enterprise/attempts/a1/problems/p1/submissions", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ status: 202, json: { id: "s1", status: "QUEUED" } });
  });
  await page.route("**/api/v1/submissions/s1", (route) => {
    solved = true;
    return route.fulfill({
      json: {
        id: "s1",
        problem: { id: "p1" },
        language: "PYTHON",
        status: "ACCEPTED",
        isTest: true,
        passedTestCases: 1,
        totalTestCases: 1,
        runtimeMs: 10,
        memoryKb: 1000,
        createdAt: iso(0),
        updatedAt: iso(0),
      },
    });
  });

  await page.goto("/enterprise/join/abc");
  await expect(page.getByRole("heading", { name: "백엔드 채용 1차" })).toBeVisible();
  await expect(page.getByText("30분 안에 풀어 주세요.")).toBeVisible();
  await page.getByRole("button", { name: "응시 시작" }).click();
  await answerConfirm(page, true, "응시 시작");
  await expect(page).toHaveURL(/\/enterprise\/attempts\/a1$/);
  expect(started).toBe(true);

  await expect(page.getByRole("timer")).toContainText("남은 시간");
  await expect(page.getByText("두 정수의 합을 출력하세요.")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "아직 이 문제에 제출하지 않았어요." })).toBeVisible();
  await page.getByRole("button", { name: "제출", exact: true }).click();
  await expect(page.getByText("최근 제출: 성공")).toBeVisible();
  expect(body).toMatchObject({ language: "PYTHON" });
  await expect(page.getByText("맞힌 문제 1개")).toBeVisible();
  await expect(page.getByRole("button", { name: /두 수의 합 ✓ 정답/ })).toBeVisible();
});

test("a finished attempt is read-only and the invite page sends the candidate back to it", async ({ page }) => {
  await signIn(page);
  const done = { id: "a1", startedAt: iso(-3_600_000), deadlineAt: iso(-1_800_000), finishedAt: iso(-1_900_000) };
  await page.route("**/api/v1/enterprise/join/abc", (route) =>
    route.fulfill({ json: { test: publicTest(), isOwner: false, attempt: done } }),
  );
  await page.route("**/api/v1/enterprise/attempts/a1", (route) => route.fulfill({ json: attemptView(done) }));

  await page.goto("/enterprise/join/abc");
  await expect(page.getByRole("button", { name: "응시 시작" })).toHaveCount(0);
  await page.getByRole("link", { name: /내 응시 기록 보기/ }).click();
  await expect(page.getByRole("timer")).toHaveText("응시 종료");
  await expect(page.getByText("응시가 끝났어요.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "제출", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "시험 종료" })).toHaveCount(0);
});

test("the invite page explains when the test has not started, has closed, or belongs to the viewer", async ({ page }) => {
  await signIn(page);
  let info: { test: PublicTest; isOwner: boolean; attempt: null } = {
    test: publicTest({ startsAt: iso(2 * 3_600_000), endsAt: iso(5 * 3_600_000) }),
    isOwner: false,
    attempt: null,
  };
  await page.route("**/api/v1/enterprise/join/abc", (route) => route.fulfill({ json: info }));
  await page.goto("/enterprise/join/abc");
  await expect(page.getByText(/시작까지 .* 남았어요/)).toBeVisible();
  await expect(page.getByRole("button", { name: "응시 시작" })).toHaveCount(0);

  info = { test: publicTest({ startsAt: iso(-5 * 3_600_000), endsAt: iso(-3_600_000) }), isOwner: false, attempt: null };
  await page.reload();
  await expect(page.getByText("응시 기간이 끝났어요.")).toBeVisible();

  info = { test: publicTest(), isOwner: true, attempt: null };
  await page.reload();
  await expect(page.getByText("테스트를 만든 계정으로는 응시할 수 없어요.", { exact: false })).toBeVisible();
});

test("a wrong invite link says so without a retry button, and a guest is asked to log in", async ({ page }) => {
  await page.goto("/enterprise/join/abc");
  await expect(page.getByRole("link", { name: /로그인하기/ })).toBeVisible();

  await signIn(page);
  await page.route("**/api/v1/enterprise/join/nope", (route) =>
    route.fulfill({ status: 404, json: { message: "응시 링크가 올바르지 않거나 삭제된 테스트예요." } }),
  );
  await page.goto("/enterprise/join/nope");
  await expect(page.getByRole("alert")).toHaveText("응시 링크가 올바르지 않거나 삭제된 테스트예요.");
  await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
});

test("a finished candidate sees their own score only when the owner shares it", async ({ page }) => {
  await signIn(page);
  const done = { id: "a1", startedAt: iso(-3_600_000), deadlineAt: iso(-1_800_000), finishedAt: iso(-1_900_000) };
  const second = { ...attemptView().problems[0], id: "p2", title: "수 정렬하기", lastSubmissionId: "s2" };
  const view = attemptView({
    ...done,
    problems: [{ ...attemptView().problems[0], solved: true, lastSubmissionId: "s1" }, second],
    result: { solved: 1, total: 2, score: 50 },
  });
  await page.route("**/api/v1/enterprise/attempts/a1", (route) => route.fulfill({ json: view }));
  await page.route("**/api/v1/submissions/*", (route) => route.fulfill({ status: 404, json: { statusCode: 404, message: "없음" } }));
  await page.goto("/enterprise/attempts/a1");
  const card = page.getByRole("region", { name: "내 결과" });
  await expect(card).toContainText("50점");
  await expect(card).toContainText("2문제 중 1문제 정답");
  await expect(card.getByRole("listitem").nth(0)).toContainText("두 수의 합 — 정답");
  await expect(card.getByRole("listitem").nth(1)).toContainText("수 정렬하기 — 미해결");
  await expect(page.getByText("점수는 테스트를 만든 담당자에게 전달돼요", { exact: false })).toHaveCount(0);
});
