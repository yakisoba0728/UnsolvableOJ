import { expect, test, type Page, type Route } from "@playwright/test";
import type { LearningDashboard, LearningGoalResponse } from "../src/learning/types";
import type { Session } from "../src/types";
import { mockProblemApi, session, storageKey } from "./fixtures";

const endpoint = (url: URL) => url.pathname.startsWith("/api/v1/users/me/learning-goal");
const token = (generation: number, sid = "goal-login") => `e30.${Buffer.from(JSON.stringify({ sub: session.user.id, sid, tokenVersion: 0, generation })).toString("base64url")}.test`;
const signedIn: Session = { ...session, accessToken: token(1) };
const response = (goal: LearningGoalResponse["goal"] = null): LearningGoalResponse => ({ goal, timeZone: "Asia/Seoul", generatedAt: "2026-11-16T03:00:00.000Z" });
const goal = (overrides: Partial<NonNullable<LearningGoalResponse["goal"]>> = {}): NonNullable<LearningGoalResponse["goal"]> => ({
  targetProblems: 10, days: 7, startDate: "2026-11-16", endDate: "2026-11-22", startsAt: "2026-11-15T15:00:00.000Z", endsAt: "2026-11-22T15:00:00.000Z",
  solvedProblems: 3, status: "ACTIVE", updatedAt: "2026-11-16T03:00:00.000Z", ...overrides,
});
const dashboard: LearningDashboard = {
  days: 30, timeZone: "Asia/Seoul", generatedAt: "2026-11-16T03:00:00.000Z",
  summary: { submissions: 0, acceptedSubmissions: 0, solvedProblems: 0, attemptedProblems: 0, activeDays: 0 },
  activity: [], difficulties: [], tags: [], tagsTruncated: false, review: [],
};
async function setup(page: Page, initial: LearningGoalResponse["goal"] = null) {
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey, value: { session: signedIn, expiresAt: Date.now() + 900_000 },
  });
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
  await page.route(url => url.pathname === "/api/v1/users/me/learning", route => route.fulfill({ json: dashboard }));
  const state = { value: initial, requests: [] as { method: string; path: string; body: unknown }[] };
  await page.route(endpoint, route => {
    const request = route.request();
    const method = request.method(), path = new URL(request.url()).pathname;
    const body = request.postData() ? request.postDataJSON() : null;
    state.requests.push({ method, path, body });
    if (method === "PUT") state.value = goal({ targetProblems: body.targetProblems, days: body.days });
    if (method === "POST") state.value = goal({ ...state.value, startDate: "2026-11-16", endDate: "2026-11-22" });
    if (method === "DELETE") state.value = null;
    return route.fulfill({ json: response(state.value) });
  });
  return state;
}
const panel = (page: Page) => page.getByRole("region", { name: "나의 학습 목표" });
async function changeSession(page: Page, mode: "account" | "refresh") {
  const next = mode === "account" ? { ...signedIn, accessToken: "different-token", user: { ...session.user, id: "different", username: "different" } }
    : { ...signedIn, accessToken: token(2) };
  await page.evaluate(({ key, value }) => {
    const oldValue = localStorage.getItem(key), newValue = JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  }, { key: storageKey, value: next });
}

test("creates, reloads, changes, restarts and removes a private persisted goal", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/learning");
  await expect(panel(page)).toContainText("아직 학습 목표가 없어요");
  await panel(page).getByRole("button", { name: "목표 설정", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("20");
  await page.getByRole("combobox", { name: "목표 기간" }).selectOption("7");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  await expect(panel(page).getByRole("progressbar")).toHaveAttribute("aria-valuetext", "20문제 목표, 3문제 해결");
  expect(state.requests.find(item => item.method === "PUT")?.body).toEqual({ targetProblems: 20, days: 7 });
  await page.reload();
  await expect(panel(page)).toContainText("3 / 20문제");
  await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("30");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  await expect(panel(page)).toContainText("3 / 30문제");
  await panel(page).getByRole("button", { name: "오늘부터 다시 시작", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("오늘 해결한 문제도 포함");
  await page.getByRole("dialog").getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(panel(page)).toContainText("오늘부터 목표를 다시 시작합니다.");
  await panel(page).getByRole("button", { name: "목표 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "목표 삭제", exact: true }).click();
  await expect(panel(page)).toContainText("아직 학습 목표가 없어요");
  expect(state.requests.filter(item => item.method === "POST")).toHaveLength(1);
  expect(state.requests.filter(item => item.method === "DELETE")).toHaveLength(1);
});

test("the fixed goal stays independent of the rolling dashboard period", async ({ page }) => {
  const state = await setup(page, goal());
  await page.goto("/learning");
  await expect(panel(page)).toContainText("2026-11-16 ~ 2026-11-22");
  await page.getByRole("button", { name: "최근 90일", exact: true }).click();
  await expect(panel(page)).toContainText("한국 시간 기준 7일");
  await expect(panel(page)).toContainText("3 / 10문제");
  expect(state.requests).toHaveLength(1);
});

test("native validation and keyboard confirmation prevent unintended mutations", async ({ page }) => {
  const state = await setup(page, goal());
  await page.goto("/learning");
  await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
  const target = page.getByRole("spinbutton", { name: "목표 문제 수" });
  await expect(target).toBeFocused();
  await target.fill("0");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  expect(state.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  await target.fill("1001");
  await target.press("Enter");
  expect(state.requests.filter(item => item.method === "PUT")).toHaveLength(0);
  await target.fill("12");
  await target.press("Tab");
  await expect(page.getByRole("combobox", { name: "목표 기간" })).toBeFocused();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  const remove = panel(page).getByRole("button", { name: "목표 삭제", exact: true });
  await remove.click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "취소", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(remove).toBeFocused();
  expect(state.requests.filter(item => item.method === "DELETE")).toHaveLength(0);
});

test("a failed or lost mutation response requires authoritative recovery before another write", async ({ page }) => {
  const state = await setup(page, goal());
  await page.route(endpoint, route => {
    if (route.request().method() !== "PUT") return route.fallback();
    state.value = goal({ targetProblems: 22 }); // Server committed, response was lost.
    return route.abort("failed");
  });
  await page.goto("/learning");
  await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("22");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("변경 결과가 확인되지 않았습니다");
  await expect(page.getByRole("button", { name: "목표 저장", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "목표 다시 불러오기", exact: true }).click();
  await expect(panel(page)).toContainText("3 / 22문제");
  await expect(page.getByRole("button", { name: "목표 저장", exact: true })).toBeEnabled();
});

test("goal read failure is separate from empty goals and can retry", async ({ page }) => {
  await setup(page);
  let fail = true;
  await page.route(endpoint, route => fail ? route.fulfill({ status: 503, json: { message: "목표 조회 실패" } }) : route.fallback());
  await page.goto("/learning");
  await expect(panel(page).getByRole("alert")).toContainText("목표 조회 실패");
  await expect(panel(page)).not.toContainText("아직 학습 목표가 없어요");
  await expect(panel(page).getByRole("button", { name: "목표 설정", exact: true })).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "목표 다시 불러오기", exact: true }).click();
  await expect(panel(page)).toContainText("아직 학습 목표가 없어요");
});

for (const method of ["GET", "PUT"] as const) {
  test(`a late ${method} from the prior account cannot overwrite the new account goal`, async ({ page }) => {
    await setup(page, goal());
    let pending: Route | undefined;
    await page.route(endpoint, route => {
      if (route.request().headers().authorization !== `Bearer ${signedIn.accessToken}`) return route.fulfill({ json: response() });
      if (route.request().method() === method) { pending = route; return; }
      return route.fallback();
    });
    await page.goto("/learning");
    if (method === "PUT") {
      await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
      await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("999");
      await page.getByRole("button", { name: "목표 저장", exact: true }).click();
    }
    await expect.poll(() => Boolean(pending)).toBe(true);
    await changeSession(page, "account");
    await expect(panel(page)).toContainText("아직 학습 목표가 없어요");
    await pending!.fulfill({ json: response(goal({ targetProblems: 999 })) }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(panel(page)).not.toContainText("999");
    await expect(page.getByRole("spinbutton", { name: "목표 문제 수" })).toHaveCount(0);
  });
}

test("ordinary token refresh preserves an unsaved goal draft", async ({ page }) => {
  await setup(page, goal());
  await page.goto("/learning");
  await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("33");
  await page.getByRole("combobox", { name: "목표 기간" }).selectOption("90");
  await changeSession(page, "refresh");
  await expect(page.getByRole("spinbutton", { name: "목표 문제 수" })).toHaveValue("33");
  await expect(page.getByRole("combobox", { name: "목표 기간" })).toHaveValue("90");
  await expect(page.getByRole("button", { name: "목표 저장", exact: true })).toBeEnabled();
});

test("token rotation keeps an in-flight goal save owned until its committed response arrives", async ({ page }) => {
  const state = await setup(page, goal());
  let pending: Route | undefined;
  await page.route(endpoint, route => {
    if (route.request().method() === "PUT") { pending = route; return; }
    return route.fallback();
  });
  await page.goto("/learning");
  await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("33");
  const reads = state.requests.filter(item => item.method === "GET").length;
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await changeSession(page, "refresh");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("button", { name: "저장 중…", exact: true })).toBeDisabled();
  expect(state.requests.filter(item => item.method === "GET")).toHaveLength(reads);
  await pending!.fulfill({ json: response(goal({ targetProblems: 33 })) });
  await expect(panel(page)).toContainText("3 / 33문제");
  await expect(panel(page)).toContainText("학습 목표를 저장했습니다.");
});

for (const status of ["COMPLETED", "EXPIRED"] as const) {
  test(`shows ${status} using the server's result and keeps honest progress`, async ({ page }) => {
    await setup(page, goal({ status, solvedProblems: status === "COMPLETED" ? 12 : 3 }));
    await page.goto("/learning");
    await expect(panel(page)).toContainText(status === "COMPLETED" ? "목표 달성" : "기간 종료");
    await expect(panel(page).getByRole("progressbar")).toHaveAttribute("value", status === "COMPLETED" ? "10" : "3");
    await expect(panel(page)).toContainText(status === "COMPLETED" ? "12 / 10문제" : "3 / 10문제");
  });
}

for (const width of [320, 375, 1440]) {
  test(`goal controls fit a ${width}px screen and remain labelled`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, goal({ targetProblems: 1000, solvedProblems: 900 }));
    await page.goto("/learning");
    await panel(page).getByRole("button", { name: "목표 변경", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "목표 문제 수" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "목표 기간" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  });
}
