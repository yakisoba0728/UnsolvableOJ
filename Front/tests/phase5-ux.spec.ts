import { expect, test, type Page, type Route } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { authenticate, mockProblemApi } from "./fixtures";
import { checkoutProvenance } from "./checkout-provenance";

async function enterpriseForm(page: Page) {
  await mockProblemApi(page);
  await authenticate(page);
  await page.route("**/api/v1/problems/mine", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/vibe/challenges", route => route.fulfill({ json: { items: [], availability: { ai: false, runner: false } } }));
  await page.goto("/enterprise/new");
}

for (const action of ["hour-enter", "minute-enter", "done", "clear", "escape"] as const) {
  test(`date picker returns focus after ${action} without submitting the form`, async ({ page }) => {
    await enterpriseForm(page);
    let writes = 0;
    await page.route("**/api/v1/enterprise/tests", route => {
      if (route.request().method() === "POST") writes++;
      return route.fulfill({ json: [] });
    });
    const trigger = page.getByLabel("시작 일시", { exact: true });
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "날짜와 시간 선택" });
    await expect(dialog).toBeVisible();
    if (action === "hour-enter" || action === "minute-enter") {
      await dialog.getByRole("textbox", { name: action === "hour-enter" ? "시" : "분", exact: true }).press("Enter");
    } else if (action === "escape") {
      await dialog.getByRole("textbox", { name: "분", exact: true }).press("Escape");
    } else {
      const button = dialog.getByRole("button", { name: action === "done" ? "확인" : "삭제", exact: true });
      await button.focus();
      await button.press("Enter");
    }
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    if (action === "clear") await expect(trigger).toContainText("날짜와 시간을 선택하세요");
    expect(writes).toBe(0);
  });
}

test("date picker closes without reclaiming focus when the user moves to another field", async ({ page }) => {
  await enterpriseForm(page);
  const start = page.getByLabel("시작 일시", { exact: true });
  const end = page.getByLabel("종료 일시", { exact: true });
  await start.click();
  await end.focus();
  await expect(page.getByRole("dialog", { name: "날짜와 시간 선택" })).toHaveCount(0);
  await expect(end).toBeFocused();
  await expect(start).toHaveAttribute("aria-expanded", "false");
});

const goalResponse = {
  timeZone: "Asia/Seoul", generatedAt: "2026-11-16T03:00:00.000Z",
  goal: { targetProblems: 1000, days: 30, startDate: "2026-11-16", endDate: "2026-12-15",
    startsAt: "2026-11-15T15:00:00.000Z", endsAt: "2026-12-15T15:00:00.000Z",
    solvedProblems: 900, status: "ACTIVE", updatedAt: "2026-11-16T03:00:00.000Z" },
};

async function learningGeometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const rect = document.querySelector(selector)!.getBoundingClientRect();
      return { x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height };
    };
    return { goal: box(".learning-goal"), toolbar: box(".learning-toolbar"), summary: box("dl.learning-summary"),
      documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, fontStatus: document.fonts.status };
  });
}

for (const width of [320, 375, 768, 1440]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`goal refresh keeps known content and geometry at ${width}px in ${colorScheme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await mockProblemApi(page);
      await authenticate(page);
      await page.route(url => url.pathname === "/api/v1/users/me/learning", route => route.fulfill({ json: {
        days: 30, timeZone: "Asia/Seoul", generatedAt: "2026-11-16T03:00:00.000Z",
        summary: { submissions: 2, acceptedSubmissions: 1, solvedProblems: 1, attemptedProblems: 1, activeDays: 1 },
        activity: [], difficulties: [], tags: [], tagsTruncated: false, review: [],
      } }));
      let pending: Route | undefined;
      let reads = 0;
      await page.route(url => url.pathname === "/api/v1/users/me/learning-goal", route => {
        if (++reads > 1) { pending = route; return; }
        return route.fulfill({ json: goalResponse });
      });
      await page.goto("/learning");
      const goal = page.getByRole("region", { name: "나의 학습 목표" });
      await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
      await expect(goal).toContainText("900 / 1,000문제");
      await expect(page.getByRole("definition")).toHaveCount(4);
      // Match the screenshot's font wait before the first geometry sample;
      // otherwise only the second sample benefits from that wait.
      await page.evaluate(() => document.fonts.ready);
      const before = await learningGeometry(page);
      const evidenceDirectory = resolve("reports/phase5-ux");
      await mkdir(evidenceDirectory, { recursive: true });
      const evidencePrefix = `${testInfo.project.name}-${width}-${colorScheme}`;
      const readyCapture = await goal.screenshot();
      await writeFile(resolve(evidenceDirectory, `${evidencePrefix}-ready.png`), readyCapture);
      await testInfo.attach("goal-ready", { body: readyCapture, contentType: "image/png" });
      await goal.getByRole("button", { name: "목표 새로고침", exact: true }).click();
      await expect.poll(() => Boolean(pending)).toBe(true);
      await expect(goal).toHaveAttribute("aria-busy", "true");
      const during = await learningGeometry(page);
      const refreshingCapture = await goal.screenshot();
      await writeFile(resolve(evidenceDirectory, `${evidencePrefix}-refreshing.png`), refreshingCapture);
      await testInfo.attach("goal-refreshing", { body: refreshingCapture, contentType: "image/png" });
      // Record the original geometry even when a regression assertion below fails.
      const geometryReport = JSON.stringify({ fixture: "synthetic browser-routed API responses; not real server performance",
        checkout: checkoutProvenance(),
        browser: page.context().browser()?.version(), project: testInfo.project.name,
        width, colorScheme, before, during, toolbarShiftPx: during.toolbar.y - before.toolbar.y,
        summaryShiftPx: during.summary.y - before.summary.y }, null, 2);
      await writeFile(resolve(evidenceDirectory, `${evidencePrefix}-geometry.json`), `${geometryReport}\n`);
      await testInfo.attach("goal-refresh-geometry", { body: geometryReport, contentType: "application/json" });
      try {
        await expect(goal).toContainText("900 / 1,000문제");
        await expect(goal.getByRole("progressbar")).toHaveAttribute("value", "900");
        await expect(goal.getByRole("button", { name: "목표 변경", exact: true })).toBeDisabled();
        expect(Math.abs(during.toolbar.y - before.toolbar.y)).toBeLessThanOrEqual(1);
        expect(Math.abs(during.summary.y - before.summary.y)).toBeLessThanOrEqual(1);
        expect(during.documentWidth).toBeLessThanOrEqual(width + 1);
      } finally {
        await pending!.fulfill({ json: goalResponse });
      }
      await expect(goal).toHaveAttribute("aria-busy", "false");
      await expect(goal.getByRole("button", { name: "목표 변경", exact: true })).toBeEnabled();
      expect(reads).toBe(2);
    });
  }
}
