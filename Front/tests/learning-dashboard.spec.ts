import { expect, test, type Page, type Route } from "@playwright/test";
import type { LearningDashboard, LearningDays } from "../src/learning/types";
import type { Session } from "../src/types";
import { mockProblemApi, problem, session, storageKey } from "./fixtures";

const endpoint = (url: URL) => url.pathname === "/api/v1/users/me/learning";
const token = (generation: number, sid = "learning-login") =>
  `e30.${Buffer.from(JSON.stringify({ sub: session.user.id, sid, tokenVersion: 0, generation })).toString("base64url")}.test`;
const signedIn: Session = { ...session, accessToken: token(1) };
const fixture = (days: LearningDays = 30): LearningDashboard => ({
  days, timeZone: "Asia/Seoul", generatedAt: "2026-11-16T03:00:00.000Z",
  summary: { submissions: 12, acceptedSubmissions: 3, solvedProblems: 2, attemptedProblems: 5, activeDays: 4 },
  activity: Array.from({ length: days }, (_, index) => ({
    date: new Date(Date.UTC(2026, 10, 16 - days + index + 1)).toISOString().slice(0, 10),
    submissions: index === days - 1 ? 12 : 0,
    acceptedSubmissions: index === days - 1 ? 3 : 0,
  })),
  difficulties: [
    { difficulty: "BEGINNER", attempted: 2, solved: 1 },
    { difficulty: "EASY", attempted: 3, solved: 1 },
    { difficulty: "MEDIUM", attempted: 0, solved: 0 },
    { difficulty: "HARD", attempted: 0, solved: 0 },
    { difficulty: "EXPERT", attempted: 0, solved: 0 },
  ],
  tags: [{ tag: "동적 계획법 & 문자열", attempted: 4, solved: 2 }], tagsTruncated: false,
  review: [{ id: problem.id, slug: "retry / 한글", title: "다시 풀 비공개 학습 제목", difficulty: "EASY", lastSubmittedAt: "2026-11-15T16:10:00.000Z", lastStatus: "WRONG_ANSWER", bookmarked: true }],
});
const empty = (days: LearningDays = 30): LearningDashboard => ({
  ...fixture(days), summary: { submissions: 0, acceptedSubmissions: 0, solvedProblems: 0, attemptedProblems: 0, activeDays: 0 },
  activity: fixture(days).activity.map(day => ({ ...day, submissions: 0, acceptedSubmissions: 0 })),
  difficulties: fixture(days).difficulties.map(item => ({ ...item, attempted: 0, solved: 0 })), tags: [], review: [],
});

async function setup(page: Page) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey, value: { session: signedIn, expiresAt: Date.now() + 900_000 },
  });
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
  await page.route(endpoint, route => route.fulfill({ json: fixture(Number(new URL(route.request().url()).searchParams.get("days")) as LearningDays) }));
}

async function changeSession(page: Page, mode: "account" | "login" | "refresh") {
  const next: Session = mode === "account"
    ? { ...signedIn, accessToken: "second-token", user: { ...session.user, id: "second", username: "second" } }
    : { ...signedIn, accessToken: token(2, mode === "login" ? "new-learning-login" : "learning-login") };
  await page.evaluate(({ key, value }) => {
    const oldValue = localStorage.getItem(key);
    const newValue = JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  }, { key: storageKey, value: next });
  return next;
}

test("private learning dashboard uses one bounded request and exposes exact daily data", async ({ page }) => {
  await setup(page);
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/v1/")) requests.push(new URL(request.url()).pathname); });
  await page.goto("/learning");
  await expect(page.getByRole("heading", { name: "학습 대시보드", exact: true })).toBeVisible();
  const summary = page.getByRole("definition");
  await expect(summary).toHaveCount(4);
  await expect(summary.nth(0)).toContainText("12건");
  await expect(summary.nth(1)).toContainText("2 / 시도 5문제");
  await expect(summary.nth(2)).toContainText("4 / 30일");
  await expect(summary.nth(3)).toContainText("25%");
  await expect(page.getByText("현재 공개된 일반 문제의 제출만 집계합니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("meter", { name: "입문 문제 해결" })).toHaveAttribute("aria-valuetext", "2문제 시도, 1문제 해결");
  await page.getByText("일별 기록 보기", { exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(31);
  await expect(page.getByRole("row").last()).toHaveText("2026-11-16123");
  expect(requests.filter(path => path === "/api/v1/users/me/learning")).toHaveLength(1);
  expect(requests).not.toContain("/api/v1/submissions");
});

test("a guest must authenticate before requesting private learning data", async ({ page }) => {
  await mockProblemApi(page);
  let reads = 0;
  await page.route(endpoint, route => { reads++; return route.fulfill({ json: fixture() }); });
  await page.goto("/learning?days=7");
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => history.state.usr.from)).toBe("/learning?days=7");
  expect(reads).toBe(0);
});

test("loading and request failures never display invented zero statistics and can retry", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route(endpoint, route => { pending = route; });
  await page.goto("/learning");
  await expect(page.getByText("최근 30일 학습 현황을 불러오는 중입니다", { exact: true })).toBeAttached();
  await expect(page.getByRole("definition")).toHaveCount(0);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending!.fulfill({ status: 503, json: { message: "학습 현황을 잠시 불러올 수 없습니다." } });
  await expect(page.getByRole("alert")).toContainText("학습 현황을 잠시 불러올 수 없습니다.");
  await expect(page.getByRole("definition")).toHaveCount(0);
  await page.route(endpoint, route => route.fulfill({ json: fixture() }));
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByRole("definition").first()).toContainText("12건");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("empty periods distinguish no submissions from failure and link to study actions", async ({ page }) => {
  await setup(page);
  await page.route(endpoint, route => route.fulfill({ json: empty() }));
  await page.goto("/learning");
  await expect(page.getByRole("heading", { name: "이 기간에는 아직 제출한 풀이가 없어요" })).toBeVisible();
  await expect(page.getByRole("definition").last()).toContainText("—");
  await expect(page.getByRole("link", { name: "풀 문제 찾기" })).toHaveAttribute("href", "/problems");
  await expect(page.getByRole("link", { name: "저장한 문제", exact: true })).toHaveAttribute("href", "/problems?saved=1");
  await expect(page.getByText("이 기간에 다시 도전할 문제가 없어요.")).toBeVisible();
  await expect(page.getByText("이 기간에 시도한 문제의 태그가 아직 없어요.")).toBeVisible();
});

test("the period selector is keyboard operable and late responses cannot relabel its data", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route(endpoint, route => {
    if (new URL(route.request().url()).searchParams.get("days") === "30") { pending = route; return; }
    const data = fixture(7); data.summary.submissions = 7;
    return route.fulfill({ json: data });
  });
  await page.goto("/learning");
  await expect.poll(() => Boolean(pending)).toBe(true);
  const week = page.getByRole("button", { name: "최근 7일", exact: true });
  await week.focus();
  await page.keyboard.press("Enter");
  await expect(week).toHaveAttribute("aria-pressed", "true");
  await expect(week).toBeFocused();
  await expect(page).toHaveURL(/days=7/);
  await expect(page.getByRole("definition").first()).toContainText("7건");
  await pending!.fulfill({ json: fixture() }).catch(() => {});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("definition").first()).toContainText("7건");
  await page.reload();
  await expect(page.getByRole("button", { name: "최근 7일", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("unsupported URL periods are normalized to the bounded default request", async ({ page }) => {
  await setup(page);
  const days: string[] = [];
  await page.route(endpoint, route => {
    days.push(new URL(route.request().url()).searchParams.get("days")!);
    return route.fulfill({ json: fixture() });
  });
  await page.goto("/learning?days=10000000000");
  await expect(page.getByRole("button", { name: "최근 30일", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("definition")).toHaveCount(4);
  expect(days).toEqual(["30"]);
});

for (const mode of ["account", "login"] as const) {
  test(`private learning data clears immediately for a different ${mode}`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    await page.route(endpoint, route => {
      if (route.request().headers().authorization !== `Bearer ${signedIn.accessToken}`) { pending = route; return; }
      return route.fulfill({ json: fixture() });
    });
    await page.goto("/learning");
    await expect(page.getByRole("link", { name: fixture().review[0].title, exact: true })).toBeVisible();
    await changeSession(page, mode);
    await expect.poll(() => Boolean(pending)).toBe(true);
    await expect(page.getByText(fixture().review[0].title, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("definition")).toHaveCount(0);
    await pending!.fulfill({ json: empty() });
    await expect(page.getByRole("heading", { name: "이 기간에는 아직 제출한 풀이가 없어요" })).toBeVisible();
  });
}

test("a late previous-account response is ignored after account switch", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route(endpoint, route => {
    if (route.request().headers().authorization === `Bearer ${signedIn.accessToken}`) { pending = route; return; }
    return route.fulfill({ json: empty() });
  });
  await page.goto("/learning");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await changeSession(page, "account");
  await expect(page.getByRole("heading", { name: "이 기간에는 아직 제출한 풀이가 없어요" })).toBeVisible();
  await pending!.fulfill({ json: fixture() }).catch(() => {});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText(fixture().review[0].title, { exact: true })).toHaveCount(0);
});

test("ordinary token rotation preserves the selected window and refetches using the fresh token", async ({ page }) => {
  await setup(page);
  const authorizations: string[] = [];
  await page.route(endpoint, route => {
    authorizations.push(route.request().headers().authorization);
    expect(new URL(route.request().url()).searchParams.get("days")).toBe("90");
    return route.fulfill({ json: fixture(90) });
  });
  await page.goto("/learning?days=90");
  await expect(page.getByRole("definition")).toHaveCount(4);
  const next = await changeSession(page, "refresh");
  await expect.poll(() => authorizations.at(-1)).toBe(`Bearer ${next.accessToken}`);
  await expect(page.getByRole("button", { name: "최근 90일", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("definition")).toHaveCount(4);
  await expect(page.locator(".learning-chart-column")).toHaveCount(30);
  await page.getByText("일별 기록 보기", { exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(91);
});

test("review and category links use encoded routes and truncated tag coverage stays explicit", async ({ page }) => {
  await setup(page);
  await page.route(endpoint, route => route.fulfill({ json: { ...fixture(), tagsTruncated: true } }));
  await page.goto("/learning");
  await expect(page.getByRole("link", { name: fixture().review[0].title, exact: true })).toHaveAttribute("href", "/problems/view/retry%20%2F%20%ED%95%9C%EA%B8%80");
  await expect(page.getByRole("link", { name: "쉬움 문제 둘러보기" })).toHaveAttribute("href", "/problems?d=EASY");
  await expect(page.locator(".learning-tag-list a")).toHaveAttribute("href", `/problems?t=${encodeURIComponent(fixture().tags[0].tag)}`);
  await expect(page.getByText("시도한 문제가 많은 상위 20개 태그를 보여 줍니다.")).toBeVisible();
  await expect(page.locator(".learning-review-description")).toContainText("최근 판정: 틀림");
  await expect(page.locator(".learning-review-description time")).toContainText("11월 16일");
});

for (const width of [320, 375, 1440]) {
  test(`learning dashboard and long content fit ${width}px without page overflow`, async ({ page }) => {
    await setup(page);
    const data = fixture(90);
    data.review[0].title = "a".repeat(180);
    data.tags[0].tag = "태그".repeat(70);
    await page.route(endpoint, route => route.fulfill({ json: data }));
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/learning?days=90");
    await expect(page.getByRole("definition")).toHaveCount(4);
    await page.getByText("일별 기록 보기", { exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "최근 90일", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: `${data.review[0].title} 이어 풀기`, exact: true })).toBeVisible();
    const first = page.getByRole("button", { name: "최근 7일", exact: true });
    await first.focus();
    expect(await first.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
}
