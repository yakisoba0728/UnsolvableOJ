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

const rows = (page: Page) => page.locator(".problem-row");

async function solve(page: Page, option: number) {
  await page.locator(".analysis-option").nth(option).click();
  await page.getByRole("button", { name: "정답 확인" }).click();
}

test("code analysis: the page lists every question like the problem list", async ({
  page,
}) => {
  await page.goto("/analysis");
  await expect(page.getByRole("heading", { name: "코드 분석", level: 1 })).toBeVisible();
  await expect(rows(page)).toHaveCount(analysisQuestions.length);
  await expect(rows(page).first()).toContainText(analysisQuestions[0].title);
  await expect(page.getByLabel("풀이 상태 필터")).toBeVisible();
  await expect(page.getByLabel("난이도 필터")).toBeVisible();
  await expect(page.getByLabel("분류 필터")).toBeVisible();
  await expect(page.getByText("10문제 중 1–10")).toBeVisible();
  await expect(page.locator(".standing-card")).toContainText("0 / 10");
  await expect(page.getByRole("link", { name: /로그인/ }).last()).toBeVisible();
});

test("code analysis: search and filters narrow the list and are kept in the URL", async ({
  page,
}) => {
  await page.goto("/analysis");

  await page.getByLabel("문제 검색").fill("피보나치");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("재귀 피보나치 값");
  await expect(page).toHaveURL(/q=/);
  // 코드 안의 문구와 개념으로도 찾는다.
  await page.getByLabel("문제 검색").fill("슬라이싱");
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel("문제 검색").fill("없는 검색어 zzz");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText("조건에 맞는 문제가 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "필터 모두 지우기" }).click();
  await expect(rows(page)).toHaveCount(analysisQuestions.length);

  const topic = page.getByLabel("분류 필터");
  await topic.getByRole("button", { name: /^자료구조/ }).click();
  const dataStructures = analysisQuestions.filter((q) => q.topic === "자료구조");
  await expect(rows(page)).toHaveCount(dataStructures.length);
  await expect(page).toHaveURL(/t=/);

  const difficulty = page.getByLabel("난이도 필터");
  await difficulty.getByRole("button", { name: /^보통/ }).click();
  const medium = dataStructures.filter((q) => q.difficulty === "MEDIUM");
  await expect(rows(page)).toHaveCount(medium.length);
  await expect(rows(page).first()).toContainText(medium[0].title);

  // 주소를 그대로 열면 같은 목록이 복원된다.
  await page.reload();
  await expect(rows(page)).toHaveCount(medium.length);
});

test("code analysis: sort by difficulty and reverse the order", async ({ page }) => {
  await page.goto("/analysis?sort=difficulty");
  await expect(rows(page).first()).toContainText("입문");
  await page.getByRole("button", { name: "목록 순서 뒤집기" }).click();
  await expect(page).toHaveURL(/rev=1/);
  await expect(rows(page).first()).toContainText("보통");
  await page.getByRole("button", { name: "목록 순서 뒤집기" }).click();
  await expect(rows(page).first()).toContainText("입문");

  // 무작위는 다시 섞기 버튼으로 바뀌고, 같은 주소는 같은 순서를 만든다.
  await page.goto("/analysis?sort=random&seed=7");
  const titles = await rows(page).locator("strong").allInnerTexts();
  await expect(page.getByRole("button", { name: "무작위로 다시 섞기" })).toBeVisible();
  await page.reload();
  expect(await rows(page).locator("strong").allInnerTexts()).toEqual(titles);
});

test("code analysis: pick a question, confirm, read the explanation and move on", async ({
  page,
}) => {
  await page.goto("/analysis");
  await rows(page).first().click();
  const [first, second] = analysisQuestions;
  await expect(page).toHaveURL(`/analysis/${first.id}`);
  await expect(page.getByRole("heading", { name: first.title, level: 1 })).toBeVisible();
  const confirm = page.getByRole("button", { name: "정답 확인" });
  await expect(confirm).toBeDisabled();

  await page.locator(".analysis-option").nth(first.answer).click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole("heading", { name: "정답입니다" })).toBeVisible();
  await expect(page.locator(".analysis-option.is-correct")).toContainText("내 답 / 정답");
  await expect(page.getByLabel("관련 개념")).toContainText(first.concepts[0]);

  await page.getByRole("link", { name: /다음 문제/ }).click();
  await expect(page).toHaveURL(`/analysis/${second.id}`);
  await expect(page.getByRole("heading", { name: second.title, level: 1 })).toBeVisible();
  await expect(page.locator(".analysis-option.is-correct")).toHaveCount(0);
});

test("code analysis: a wrong answer shows the right one and the list marks it 풀이 중", async ({
  page,
}) => {
  const [first] = analysisQuestions;
  await page.goto(`/analysis/${first.id}`);
  const wrong = (first.answer + 1) % first.options.length;
  await solve(page, wrong);
  await expect(
    page.getByRole("heading", { name: `정답은 ${first.options[first.answer]}입니다` }),
  ).toBeVisible();
  await expect(page.locator(".analysis-option.is-wrong")).toContainText("내 답 / 오답");
  await expect(page.locator(".analysis-option.is-correct")).toContainText("· 정답");

  await page.getByRole("link", { name: "목록으로" }).click();
  await expect(rows(page).first().locator(".solve-badge")).toHaveText("풀이 중");
  await expect(page.getByLabel("풀이 상태 필터").getByRole("button", { name: /^풀이 중/ })).toContainText("1");
  await expect(page.getByRole("link", { name: /이어서 풀기/ })).toHaveAttribute(
    "href",
    `/analysis/${first.id}`,
  );
});

test("code analysis: coming back to a solved question keeps the result and allows solving again", async ({
  page,
}) => {
  const [first] = analysisQuestions;
  await page.goto(`/analysis/${first.id}`);
  await solve(page, first.answer);
  await expect(page.getByRole("heading", { name: "정답입니다" })).toBeVisible();

  // 다른 메뉴에 다녀오거나 새로고침해도 결과가 그대로다.
  await page.getByRole("link", { name: "미션", exact: true }).click();
  await expect(page.getByRole("heading", { name: "오늘의 도전" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "정답입니다" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".analysis-option.is-correct")).toContainText("내 답 / 정답");

  await page.getByRole("button", { name: "다시 풀기" }).click();
  await expect(page.locator(".analysis-option.is-correct")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "정답 확인" })).toBeDisabled();

  await page.goto("/analysis");
  await expect(rows(page).first().locator(".solve-badge")).toContainText("해결");
  await expect(page.locator(".standing-card")).toContainText("1 / 10");
  await expect(page.getByLabel("풀이 상태 필터").getByRole("button", { name: /^미해결/ })).toContainText("9");
});

test("code analysis: unknown question ids show a way back", async ({ page }) => {
  await page.goto("/analysis/not-a-question");
  await expect(page.getByRole("heading", { name: "문제를 찾을 수 없어요" })).toBeVisible();
  await page.getByRole("link", { name: /문제 목록으로/ }).click();
  await expect(page).toHaveURL("/analysis");
});

test("code analysis: records are kept per user and counted once per question for missions", async ({
  page,
}) => {
  const [first, second] = analysisQuestions;
  await page.goto(`/analysis/${first.id}`);
  await solve(page, first.answer);
  await page.getByRole("button", { name: "다시 풀기" }).click();
  await solve(page, first.answer);

  // 로그인한 사용자는 비로그인 풀이와 섞이지 않는다.
  await authenticate(page);
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({ json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 1 } }),
  );
  await page.goto("/analysis");
  await expect(rows(page).first().locator(".solve-badge")).toHaveCount(0);
  await expect(page.locator(".standing-card")).toContainText("0 / 10");

  await page.goto(`/analysis/${second.id}`);
  await solve(page, second.answer);
  await page.goto(`/analysis/${second.id}`);
  await page.getByRole("button", { name: "다시 풀기" }).click();
  await solve(page, second.answer);
  await page.goto("/missions");
  // 같은 문제를 두 번 풀어도 오늘 푼 문제는 1개로 센다.
  await expect(
    page.locator(".mission-card", { hasText: "코드 분석 워밍업" }),
  ).toContainText("1 / 5");
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
