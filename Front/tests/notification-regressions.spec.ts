import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticate, mockProblemApi, session, storageKey } from "./fixtures";

const notification = (id: string, title = id) => ({
  id,
  type: "ANSWER",
  readAt: null,
  createdAt: new Date().toISOString(),
  commentId: null,
  actor: { id: "author", username: "author" },
  post: { id, title },
  submission: null,
});
const pageOf = (items: ReturnType<typeof notification>[], page = 1, totalPages = 1) => ({
  items, page, totalPages, unread: items.length,
});
async function changeAccount(page: Page) {
  await page.evaluate(({ key, original }) => {
    const next = JSON.stringify({
      session: {
        ...original,
        accessToken: "second-account-token",
        user: { ...original.user, id: "second", username: "second" },
      },
      expiresAt: Date.now() + 900_000,
    });
    const oldValue = localStorage.getItem(key);
    localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: next, storageArea: localStorage }));
  }, { key: storageKey, original: session });
  await expect(page.locator(".account-name")).toHaveText("second");
}
async function setup(page: Page) {
  await authenticate(page);
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 1 } }));
}
const bell = (page: Page) => page.getByRole("button", { name: /^알림(?:,|$)/ });
const panel = (page: Page) => page.getByRole("region", { name: "알림", exact: true });

test("notification contents are cleared immediately when another tab changes accounts", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/notifications?*", route => route.fulfill({ json: pageOf([
    notification("n1", route.request().headers().authorization === "Bearer second-account-token" ? "두 번째 계정 알림" : "이전 계정 비공개 알림"),
  ]) }));
  await page.goto("/problems");
  await bell(page).click();
  await expect(panel(page)).toContainText("이전 계정 비공개 알림");
  await changeAccount(page);
  await expect(page.getByText("이전 계정 비공개 알림", { exact: false })).toHaveCount(0);
  await bell(page).click();
  await expect(panel(page)).toContainText("두 번째 계정 알림");
});

test("a delayed notification response cannot populate a different account", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route("**/api/v1/notifications?*", async route => {
    if (route.request().headers().authorization === "Bearer second-account-token")
      return route.fulfill({ json: pageOf([notification("second", "새 계정 알림")]) });
    pending = route;
  });
  await page.goto("/problems");
  await bell(page).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await changeAccount(page);
  if (await panel(page).isVisible()) await bell(page).click();
  await bell(page).click();
  await expect(panel(page)).toContainText("새 계정 알림");
  await pending!.fulfill({ json: pageOf([notification("old", "이전 계정 늦은 알림")]) }).catch(() => {});
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(panel(page)).not.toContainText("이전 계정 늦은 알림");
  await expect(panel(page)).toContainText("새 계정 알림");
});

test("rapid load-more activation sends one request and appends a page once", async ({ page }) => {
  await setup(page);
  let pageTwoRequests = 0;
  const pending: Route[] = [];
  await page.route("**/api/v1/notifications?*", route => {
    const pageNumber = new URL(route.request().url()).searchParams.get("page");
    if (pageNumber === "2") {
      pageTwoRequests += 1;
      pending.push(route);
      return;
    }
    return route.fulfill({ json: pageOf([notification("first")], 1, 2) });
  });
  await page.goto("/problems");
  await bell(page).click();
  const more = panel(page).getByRole("button", { name: "더 보기" });
  await more.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect.poll(() => pageTwoRequests).toBeGreaterThan(0);
  // Let the event handler microtasks settle before resolving all observed requests.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  for (const route of pending) await route.fulfill({ json: pageOf([notification("second")], 2, 2) });
  await expect(panel(page).getByRole("link")).toHaveCount(2);
  expect(pageTwoRequests).toBe(1);
});

test("a failed notification load offers a working retry without closing the panel", async ({ page }) => {
  await setup(page);
  let fail = true;
  await page.route("**/api/v1/notifications?*", route => fail
    ? route.fulfill({ status: 503, json: { message: "temporary" } })
    : route.fulfill({ json: pageOf([notification("recovered", "복구한 알림")]) }));
  await page.goto("/problems");
  await bell(page).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  fail = false;
  await panel(page).getByRole("button", { name: "다시 시도" }).click();
  await expect(panel(page)).toContainText("복구한 알림");
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});


test("a failed read request retains the unread badge", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/notifications?*", route => route.fulfill({ json: pageOf([notification("first")]) }));
  let completed = false;
  await page.route("**/api/v1/notifications/first/read", async route => {
    await route.fulfill({ status: 503, json: { message: "temporary" } });
    completed = true;
  });
  await page.goto("/problems");
  await bell(page).click();
  await panel(page).getByRole("link").click();
  await expect.poll(() => completed).toBe(true);
  await expect(bell(page)).toHaveAccessibleName("알림, 안 읽음 1개");
});

test("a delayed unread poll cannot undo marking all notifications read", async ({ page }) => {
  await setup(page);
  await page.route("**/api/v1/notifications?*", route => route.fulfill({ json: pageOf([notification("first")]) }));
  await page.route("**/api/v1/notifications/read-all", route => route.fulfill({ json: { unread: 0 } }));
  await page.goto("/problems");
  await bell(page).click();
  await expect(panel(page).getByRole("link")).toHaveCount(1);
  let pending: Route | undefined;
  await page.route("**/api/v1/notifications/unread-count", route => { pending = route; });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => Boolean(pending)).toBe(true);
  await panel(page).getByRole("button", { name: "모두 읽음" }).click();
  await expect(bell(page)).toHaveAccessibleName("알림");
  await pending!.fulfill({ json: { unread: 1 } });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(bell(page)).toHaveAccessibleName("알림");
});
