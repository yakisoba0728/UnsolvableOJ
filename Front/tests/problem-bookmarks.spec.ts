import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticate, mockProblemApi, mockProblemList, problem, session, storageKey } from "./fixtures";

const control = (page: Page) => page.getByRole("group", { name: "문제 저장", exact: true });
const saveButton = (page: Page) => control(page).getByRole("button", { name: "문제 저장", exact: true });
const removeButton = (page: Page) => control(page).getByRole("button", { name: "문제 저장 취소", exact: true });
const endpoint = `**/api/v1/problems/${problem.id}/bookmark`;

async function setup(page: Page) {
  await authenticate(page);
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
}

async function changeAccount(page: Page) {
  await page.evaluate(({ key, original }) => {
    const next = JSON.stringify({
      session: { ...original, accessToken: "second-token", user: { ...original.user, id: "second", username: "second" } },
      expiresAt: Date.now() + 900_000,
    });
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: next, storageArea: localStorage }));
  }, { key: storageKey, original: session });
  await expect(page.locator(".account-name")).toHaveText("second");
}

test("a guest can sign in to save and return to the current problem", async ({ page }) => {
  await mockProblemApi(page);
  await page.goto("/problems/view/sum");
  await page.getByRole("link", { name: "로그인 후 저장" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => history.state.usr.from)).toBe("/problems/view/sum");
});

test("keyboard save survives a reload and can be removed", async ({ page }) => {
  await setup(page);
  let bookmarked = false;
  const methods: string[] = [];
  await page.route(endpoint, route => {
    const method = route.request().method();
    methods.push(method);
    if (method !== "GET") bookmarked = method === "PUT";
    return route.fulfill({ json: { bookmarked } });
  });
  await page.goto("/problems/view/sum");
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(removeButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(control(page).getByRole("status")).toHaveText("나만의 문제 목록에 저장했어요.");
  await page.reload();
  await expect(removeButton(page)).toBeEnabled();
  await removeButton(page).click();
  await expect(saveButton(page)).toHaveAttribute("aria-pressed", "false");
  expect(methods.filter(method => method === "PUT")).toHaveLength(1);
  expect(methods.filter(method => method === "DELETE")).toHaveLength(1);
});

test("failed bookmark loading keeps the toggle disabled and offers status retry", async ({ page }) => {
  await setup(page);
  let fail = true;
  await page.route(endpoint, route => fail
    ? route.fulfill({ status: 503, json: { message: "저장 상태를 불러오지 못했습니다." } })
    : route.fulfill({ json: { bookmarked: false } }));
  await page.goto("/problems/view/sum");
  await expect(control(page).getByRole("alert")).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  fail = false;
  await control(page).getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(saveButton(page)).toBeEnabled();
  await expect(control(page).getByRole("alert")).toHaveCount(0);
});

test("a lost mutation response is reconciled before another toggle", async ({ page }) => {
  await setup(page);
  let bookmarked = false;
  let saves = 0;
  await page.route(endpoint, route => {
    if (route.request().method() === "PUT") {
      bookmarked = true;
      saves++;
      return route.fulfill({ status: 503, json: { message: "응답을 확인하지 못했습니다." } });
    }
    return route.fulfill({ json: { bookmarked } });
  });
  await page.goto("/problems/view/sum");
  await saveButton(page).click();
  await expect(control(page).getByRole("alert")).toBeVisible();
  await expect(saveButton(page)).toBeDisabled();
  await control(page).getByRole("button", { name: "상태 다시 확인" }).click();
  await expect(removeButton(page)).toHaveAttribute("aria-pressed", "true");
  expect(saves).toBe(1);
});

test("rapid save activation sends only one mutation", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  let mutations = 0;
  await page.route(endpoint, route => {
    if (route.request().method() === "PUT") { pending = route; mutations++; return; }
    return route.fulfill({ json: { bookmarked: false } });
  });
  await page.goto("/problems/view/sum");
  await expect(saveButton(page)).toBeEnabled();
  await saveButton(page).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => Boolean(pending)).toBe(true);
  await pending!.fulfill({ json: { bookmarked: true } });
  await expect(removeButton(page)).toBeEnabled();
  expect(mutations).toBe(1);
});

for (const pendingMethod of ["GET", "PUT"]) {
  test(`a late ${pendingMethod} cannot transfer bookmark state to another account`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    await page.route(endpoint, route => {
      if (route.request().headers().authorization === "Bearer second-token")
        return route.fulfill({ json: { bookmarked: false } });
      if (route.request().method() === pendingMethod) { pending = route; return; }
      return route.fulfill({ json: { bookmarked: false } });
    });
    await page.goto("/problems/view/sum");
    if (pendingMethod === "PUT") await saveButton(page).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    await changeAccount(page);
    await expect(saveButton(page)).toBeEnabled();
    await pending!.fulfill({ json: { bookmarked: true } }).catch(() => {});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(saveButton(page)).toHaveAttribute("aria-pressed", "false");
    await expect(removeButton(page)).toHaveCount(0);
  });
}

test("saved filtering preserves search and resets the page without per-row bookmark requests", async ({ page }) => {
  await setup(page);
  const items = Array.from({ length: 25 }, (_, index) => ({ ...problem,
    id: `p-${index}`, slug: `p-${index}`, title: `문제 ${index}`, bookmarked: index < 2,
  }));
  const requests = await mockProblemList(page, items);
  let statusRequests = 0;
  await page.route(/\/api\/v1\/problems\/[^/]+\/bookmark$/, route => { statusRequests++; return route.fulfill({ json: { bookmarked: false } }); });
  await page.goto("/problems?q=문제&page=2");
  await expect(page.locator("a.problem-row")).toHaveCount(5);
  await page.getByRole("button", { name: "저장한 문제", exact: true }).click();
  await expect(page).toHaveURL(/[?&]saved=1/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(page.getByRole("searchbox", { name: "문제 검색" })).toHaveValue("문제");
  await expect(page.locator("a.problem-row")).toHaveCount(2);
  await expect(page.locator(".bookmark-indicator")).toHaveCount(2);
  expect(requests.some(query => query.get("bookmarked") === "true" && query.get("q") === "문제")).toBe(true);
  expect(statusRequests).toBe(0);
});

test("saved rows clear on account change while the next account's list is pending", async ({ page }) => {
  await setup(page);
  let next: Route | undefined;
  await page.route((url) => url.pathname === "/api/v1/problems", route => {
    const url = new URL(route.request().url());
    if (route.request().headers().authorization === "Bearer second-token" && url.searchParams.get("bookmarked") === "true") {
      next = route; return;
    }
    return route.fulfill({ json: { items: [{ ...problem, bookmarked: true }], total: 1, totalPages: 1, page: 1, limit: 20 } });
  });
  await page.goto("/problems?saved=1");
  await expect(page.locator(".bookmark-indicator")).toHaveCount(1);
  await changeAccount(page);
  await expect(page.locator(".bookmark-indicator")).toHaveCount(0);
  await expect(page.locator("a.problem-row")).toHaveCount(0);
  await expect.poll(() => Boolean(next)).toBe(true);
  await next!.fulfill({ json: { items: [], total: 0, totalPages: 0, page: 1, limit: 20 } });
  await expect(page.getByText("아직 저장한 문제가 없어요.")).toBeVisible();
});

test("returning from a problem tab refreshes saved items and empty state offers discovery", async ({ page }) => {
  await setup(page);
  const items = [{ ...problem, bookmarked: false }];
  await mockProblemList(page, items);
  await page.goto("/problems?saved=1");
  await expect(page.getByText("아직 저장한 문제가 없어요.")).toBeVisible();
  items[0].bookmarked = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  items[0].bookmarked = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("아직 저장한 문제가 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "전체 문제 둘러보기" }).click();
  await expect(page).not.toHaveURL(/[?&]saved=/);
  await expect(page.locator("a.problem-row")).toHaveCount(1);
});

for (const width of [320, 375, 1440]) {
  test(`bookmark control and saved filter fit at ${width}px`, async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/problems/view/sum");
    await expect(saveButton(page)).toBeEnabled();
    expect(await control(page).evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth;
    })).toBe(true);
    await control(page).getByRole("link", { name: "저장한 문제" }).click();
    const filter = page.getByRole("button", { name: "저장한 문제", exact: true });
    await expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(await filter.evaluate(element => element.getBoundingClientRect().right <= innerWidth)).toBe(true);
  });
}
