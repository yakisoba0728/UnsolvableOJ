import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi, session, storageKey } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockProblemApi(page);
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [] }));
});

test("pathname navigation moves focus into the new page, while search edits keep their focus", async ({ page }) => {
  await page.goto("/");
  const problems = page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "문제", exact: true });
  await problems.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.locator("main")).toBeFocused();
  await expect(page).toHaveTitle("문제 목록 | 못풀준");

  const search = page.getByRole("searchbox").first();
  await search.fill("두 수");
  await expect(page).toHaveURL(/q=/);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("두 수");

  await page.getByRole("link", { name: "못풀준 홈" }).click();
  await expect(page.locator("main")).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/problems\?q=/);
  await expect(page.locator("main")).toBeFocused();
});

test("the first document load does not move focus away from the browser or a page's own controls", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByLabel("이메일")).toBeVisible();
  await expect(page.locator("main")).not.toBeFocused();
  await page.getByLabel("이메일").fill("draft@example.com");
  await expect(page.getByLabel("이메일")).toBeFocused();
});

test("a pending route module announces loading and focuses only after its new content commits", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/src\/pages\/AnalysisPage\.tsx(?:\?.*)?$/, async (route) => {
    await held;
    await route.continue();
  });
  // Cold direct navigation exercises the Suspense fallback deterministically.
  await page.goto("/analysis", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("status")).toContainText("화면을 불러오는 중입니다");
  release();
  await expect(page).toHaveTitle("코드 분석 | 못풀준");
  await expect(page.getByText("화면을 불러오는 중입니다…", { exact: true })).toHaveCount(0);
  await expect(page.locator("main")).not.toBeFocused();

  await page.getByRole("link", { name: "못풀준 홈" }).click();
  await expect(page.locator("main")).toBeFocused();
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "코드 분석", exact: true }).click();
  await expect(page.locator("main")).toBeFocused();
});

for (const width of [390, 900]) {
  test(`the ${width}px menu exposes links to the keyboard and returns focus on Escape or current-route activation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/problems");
    const toggle = page.getByRole("button", { name: "메뉴", exact: true });
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "홈", exact: true })).toBeFocused();
    // WebKit's default Tab preference skips links; focusing a link above still
    // verifies that opening the disclosure puts every engine inside the panel.
    await page.keyboard.press("Escape");
    await expect(toggle).toBeFocused();
    await expect(nav).toBeHidden();

    await page.keyboard.press("Enter");
    await nav.getByRole("link", { name: "문제", exact: true }).click();
    await expect(nav).toBeHidden();
    await expect(toggle).toBeFocused();

    await page.keyboard.press("Enter");
    await nav.getByRole("link", { name: "홈", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(nav).toBeHidden();
    await expect(page.locator("main")).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("resizing cannot leave keyboard focus inside the hidden menu or on a hidden toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/problems");
  const toggle = page.getByRole("button", { name: "메뉴", exact: true });
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await toggle.focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav.locator('a[aria-current="page"]')).toBeFocused();
  await expect(toggle).toBeHidden();
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(nav).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  // Wait for the observable desktop transition. WebKit may coalesce an
  // immediate desktop/mobile round trip before delivering matchMedia events.
  await expect(page.locator(".menu-button")).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeHidden();
  await page.setViewportSize({ width: 390, height: 760 });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();
});

test("an account replacement on the same route closes the mobile menu and removes old role links", async ({ page }) => {
  await authenticate(page, "ADMIN");
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/problems");
  const toggle = page.getByRole("button", { name: "메뉴", exact: true });
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await toggle.click();
  await nav.getByRole("link", { name: "관리", exact: true }).focus();
  await page.evaluate(({ key, next }) => {
    const value = JSON.stringify({ session: next, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value, storageArea: localStorage }));
  }, { key: storageKey, next: { ...session, user: { ...session.user, id: "second", username: "second" } } });
  await expect(page.locator(".account-name")).toHaveText("second");
  await expect(nav).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(nav.getByRole("link", { name: "관리", exact: true })).toHaveCount(0);
});
