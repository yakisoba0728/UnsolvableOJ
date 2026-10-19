import { expect, test, type Page } from "@playwright/test";
import { analysisQuestions } from "../src/analysis/questions";
import type { Session, Submission } from "../src/types";

const storageKey = "unsolvable-oj-session-v1";
const session: Session = {
  accessToken: "browser-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: {
    id: "solver",
    email: "solver@example.com",
    username: "solver",
    role: "USER",
    level: 1,
    xp: 0,
    rating: 0,
  },
};

async function authenticate(page: Page) {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key: storageKey, saved: { session, expiresAt: Date.now() + 900_000 } },
  );
}

const startButton = (page: Page) =>
  page.getByRole("button", { name: /^(시작하기|계속하기|결과 보기)/ });

/** 소개 화면에서 시작·계속하기를 눌러 풀이로 들어간다. */
async function startAnalysis(page: Page) {
  await startButton(page).click();
}

async function clockSeconds(page: Page, locator: string) {
  const text = await page.locator(locator).innerText();
  const [, m, s] = /(\d{2}):(\d{2})/.exec(text) ?? [];
  return Number(m) * 60 + Number(s);
}

test("code analysis: the intro explains the mode and the timer waits for the start button", async ({
  page,
}) => {
  await page.goto("/analysis");
  await expect(page.getByRole("heading", { name: "코드 분석", level: 1 })).toBeVisible();
  await expect(page.getByText("이렇게 진행돼요")).toBeVisible();
  await expect(page.getByLabel("구성")).toContainText("10문제");
  await expect(page.getByText("시간은 시작한 뒤부터 재고")).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인", exact: true }).last()).toBeVisible();
  // 소개 화면에는 문제도 시간도 없다.
  await expect(page.locator(".analysis-code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /처음부터 다시|다시 풀기/ })).toHaveCount(0);

  await page.waitForTimeout(2200);
  await startAnalysis(page);
  await expect(page.getByText("문제 1 / 10")).toBeVisible();
  expect(await clockSeconds(page, ".analysis-head span")).toBeLessThanOrEqual(1);
});

test("code analysis: select, confirm, read the explanation, finish with a result", async ({
  page,
}) => {
  await page.goto("/analysis");
  await startAnalysis(page);
  const confirm = page.getByRole("button", { name: "정답 확인" });
  await expect(page.getByText("문제 1 / 10")).toBeVisible();
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("button", { name: /이전/ })).toBeDisabled();

  for (const [index, question] of analysisQuestions.entries()) {
    await expect(page.getByText(`문제 ${index + 1} / 10`)).toBeVisible();
    await page.locator(".analysis-option").nth(question.answer).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page.getByRole("heading", { name: "정답입니다" })).toBeVisible();
    await expect(page.locator(".analysis-option.is-correct")).toContainText(
      "내 답 / 정답",
    );
    const last = index === analysisQuestions.length - 1;
    await page
      .getByRole("button", { name: last ? "학습 결과 보기" : "다음 문제" })
      .click();
  }

  await expect(page.getByText("10 / 10")).toBeVisible();
  await expect(page.getByText("정답률 100%")).toBeVisible();
  await expect(page.getByText("모두 맞혔어요")).toBeVisible();
});

test("code analysis: a wrong answer shows the right one and what to review", async ({
  page,
}) => {
  await page.goto("/analysis");
  await startAnalysis(page);
  const [first] = analysisQuestions;
  const wrong = (first.answer + 1) % first.options.length;
  await page.locator(".analysis-option").nth(wrong).click();
  await page.getByRole("button", { name: "정답 확인" }).click();
  await expect(
    page.getByRole("heading", {
      name: `정답은 ${first.options[first.answer]}입니다`,
    }),
  ).toBeVisible();
  await expect(page.locator(".analysis-option.is-wrong")).toContainText(
    "내 답 / 오답",
  );
  await expect(page.locator(".analysis-option.is-correct")).toContainText(
    "· 정답",
  );
  await expect(page.getByLabel("관련 개념")).toContainText(first.concepts[0]);
});

test("code analysis: leaving for another menu offers to continue with answers and time kept", async ({
  page,
}) => {
  await page.goto("/analysis");
  await startAnalysis(page);
  const [first] = analysisQuestions;
  await page.locator(".analysis-option").nth(first.answer).click();
  await page.getByRole("button", { name: "정답 확인" }).click();
  await page.getByRole("button", { name: "다음 문제" }).click();
  await expect(page.getByText("문제 2 / 10")).toBeVisible();
  await page.locator(".analysis-option").nth(0).click();

  const seconds = () => clockSeconds(page, ".analysis-head span");
  await expect.poll(seconds).toBeGreaterThanOrEqual(2);
  const before = await seconds();

  await page.getByRole("link", { name: "미션", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘의 도전" })).toBeVisible();
  await page.waitForTimeout(2500); // 떠나 있는 동안 시간은 흐르지 않는다
  await page.getByRole("link", { name: "코드 분석", exact: true }).click();

  // 돌아오면 바로 시간이 가지 않고, 이어서 풀지 선택하게 한다.
  const status = page.locator(".analysis-intro-status");
  await expect(status).toContainText("진행 중 · 문제 2 / 10 · 1문제 확인");
  await page.waitForTimeout(1500);
  const shown = await clockSeconds(page, ".analysis-intro-status");
  expect(shown).toBeGreaterThanOrEqual(before);
  expect(shown).toBeLessThanOrEqual(before + 1);
  await expect(page.getByRole("button", { name: "처음부터 다시" })).toBeVisible();

  await startButton(page).click();
  await expect(page.getByText("문제 2 / 10")).toBeVisible();
  await expect(page.locator(".analysis-option").nth(0)).toHaveClass(/is-selected/);

  // 새로고침해도 같은 자리에서 이어지고, 이미 푼 문제는 그대로 확인된다.
  await page.reload();
  await expect(status).toContainText("문제 2 / 10");
  await startButton(page).click();
  await expect(page.locator(".analysis-option").nth(0)).toHaveClass(/is-selected/);
  await page.getByRole("button", { name: /이전/ }).click();
  await expect(page.getByText("문제 1 / 10")).toBeVisible();
  await expect(page.locator(".analysis-option.is-correct")).toContainText(
    "내 답 / 정답",
  );
});

test("code analysis: restarting from the intro clears the progress", async ({
  page,
}) => {
  await page.goto("/analysis");
  await startAnalysis(page);
  await page.locator(".analysis-option").nth(0).click();
  await page.getByRole("button", { name: "정답 확인" }).click();
  await page.reload();
  await page.getByRole("button", { name: "처음부터 다시" }).click();
  await expect(page.getByText("문제 1 / 10")).toBeVisible();
  await expect(page.locator(".analysis-option.is-selected, .analysis-option.is-correct, .analysis-option.is-wrong")).toHaveCount(0);
  expect(await clockSeconds(page, ".analysis-head span")).toBeLessThanOrEqual(1);
});

test("code analysis: the finished result is offered again and progress is kept per user", async ({
  page,
}) => {
  await page.goto("/analysis");
  await startAnalysis(page);
  for (const [index, question] of analysisQuestions.entries()) {
    await page.locator(".analysis-option").nth(question.answer).click();
    await page.getByRole("button", { name: "정답 확인" }).click();
    await page
      .getByRole("button", {
        name: index === analysisQuestions.length - 1 ? "학습 결과 보기" : "다음 문제",
      })
      .click();
  }
  await expect(page.getByText("정답률 100%")).toBeVisible();
  await page.reload();
  await expect(page.locator(".analysis-intro-status")).toContainText(
    "지난 결과 · 10 / 10 · 정답률 100%",
  );
  await page.getByRole("button", { name: "결과 보기" }).click();
  await expect(page.getByText("정답률 100%")).toBeVisible();
  await page.getByRole("button", { name: "다시 풀기" }).click();
  await expect(page.getByText("문제 1 / 10")).toBeVisible();

  // 다른 사용자(로그인)는 비로그인 풀이와 섞이지 않는다.
  await authenticate(page);
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({ json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 1 } }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "시작하기" })).toBeVisible();
  await expect(page.getByText("오늘 푼 문제는 미션")).toBeVisible();
  await startAnalysis(page);
  await expect(page.getByText("문제 1 / 10")).toBeVisible();
  await expect(page.locator(".analysis-option.is-selected")).toHaveCount(0);
});

test("mission progress is computed from real submissions and learning records", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/missions/catalog.ts";
    const { buildMissions, seasonOf } = await import(modulePath);
    const now = new Date();
    const day = (offset: number, hour?: number) => {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      if (hour !== undefined) at.setHours(hour, 0, 0, 0);
      return at.toISOString();
    };
    const make = (id: string, status: string, createdAt: string) => ({
      id: `s-${id}`,
      problem: { id: `p-${id}`, slug: id, title: id },
      language: "PYTHON",
      status,
      createdAt,
    });
    const submissions = [
      // 오늘 서로 다른 문제 6개 해결
      ...Array.from({ length: 6 }, (_, i) => make(`today${i}`, "ACCEPTED", now.toISOString())),
      // 오늘 자정 이후(02시) 오답 제출 3회
      ...Array.from({ length: 3 }, (_, i) => make(`night${i}`, "WRONG_ANSWER", day(0, 2))),
      // 어제·그제도 학습
      make("y1", "WRONG_ANSWER", day(1, 12)),
      make("y2", "WRONG_ANSWER", day(2, 12)),
    ];
    const missions = buildMissions({ submissions, analysisToday: 2, communityPosts: 0, now });
    const season = seasonOf(missions, now);
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return {
      byId: Object.fromEntries(
        missions.map((m: { id: string; current: number; target: number; status: string }) => [
          m.id,
          [m.current, m.target, m.status],
        ]),
      ),
      season,
      expectedDaysLeft: lastDay - now.getDate(),
    };
  });

  expect(result.byId.daily).toEqual([5, 5, "done"]); // 6개 해결해도 목표(5)를 넘지 않는다
  expect(result.byId.analysis).toEqual([2, 5, "active"]);
  expect(result.byId.streak).toEqual([3, 7, "active"]);
  expect(result.byId.weekly).toEqual([6, 10, "active"]);
  expect(result.byId.night).toEqual([3, 3, "done"]);
  expect(result.byId.community).toEqual([0, 2, "idle"]);
  expect(result.season.done).toBe(2);
  expect(result.season.total).toBe(6);
  expect(result.season.daysLeft).toBe(result.expectedDaysLeft);
});

test("missions page shows the signed-in user's progress", async ({ page }) => {
  await authenticate(page);
  const at = new Date().toISOString();
  const items = Array.from({ length: 2 }, (_, i) => ({
    id: `s${i}`,
    problem: { id: `p${i}`, slug: `p${i}`, title: `문제 ${i}` },
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 1,
    memoryKb: 1,
    passedTestCases: 1,
    totalTestCases: 1,
    compileOutput: null,
    judgeMessage: null,
    createdAt: at,
    updatedAt: at,
  })) satisfies Submission[];
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, page: 1, limit: 1000, total: 2, totalPages: 1 },
    }),
  );
  await page.goto("/missions");

  const daily = page.locator(".mission-card", { hasText: "일일 미션" });
  await expect(daily).toContainText("2 / 5");
  await expect(daily).toContainText("진행 중");
  const community = page.locator(".mission-card", { hasText: "커뮤니티 기여" });
  await expect(community).toContainText("시작 전");
  await expect(
    community.getByRole("link", { name: /시작하기/ }),
  ).toHaveAttribute("href", "/community/new");
  await expect(page.getByText("보상(XP·배지) 지급은 서버 연동 후")).toBeVisible();
});

test("signed-out visitors can open missions and are asked to log in", async ({
  page,
}) => {
  await page.goto("/missions");
  await expect(page.getByRole("heading", { name: "오늘의 도전" })).toBeVisible();
  await expect(page.getByRole("link", { name: "로그인", exact: true }).first()).toBeVisible();
  await expect(page.locator(".mission-card")).toHaveCount(6);
  await expect(
    page.locator(".mission-card", { hasText: "일일 미션" }),
  ).toContainText("0 / 5");
});
