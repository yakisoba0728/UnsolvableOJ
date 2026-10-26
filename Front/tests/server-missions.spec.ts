import { expect, test } from "@playwright/test";
import { authenticate } from "./fixtures";
import { dashboard, mockMissions } from "./mission-fixtures";

test('mission cards fit mobile screens and preserve keyboard access', async ({page}) => {
  await authenticate(page); await mockMissions(page);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/missions');
  await expect(page.locator('.mission-card')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const link=page.locator('.mission-start').first(); await link.focus(); await expect(link).toBeFocused();
  await page.screenshot({path:'test-results/missions-mobile.png',fullPage:true});
});

test("server progress overrides forged browser data, claims once and reloads persistent receipts", async ({
  page,
}) => {
  await authenticate(page);
  const data = dashboard();
  const daily = data.items.find((m) => m.id === "daily")!;
  daily.current = 5;
  daily.status = "done";
  daily.completedAt = data.serverTime;
  const analysis = data.items.find((m) => m.id === "analysis")!;
  await mockMissions(page, data);
  await page.addInitScript(() =>
    localStorage.setItem(
      "unsolvable-oj-analysis-v1",
      JSON.stringify([
        {
          userId: "solver",
          questionId: "fake",
          correct: true,
          at: new Date().toISOString(),
        },
      ]),
    ),
  );
  let calls = 0;
  await page.route("**/api/v1/missions/daily/claim", async (route) => {
    calls++;
    daily.claimedAt = new Date().toISOString();
    data.season.done = 1;
    await route.fulfill({ json: { awardedXp: 50, alreadyClaimed: false } });
  });
  await page.goto("/missions");
  await expect(
    page.locator(".mission-card", { hasText: "코드 분석 워밍업" }),
  ).toContainText(`${analysis.current} / 5`);
  await expect(
    page.getByRole("button", { name: "코드 분석 워밍업 보상 받기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "일일 미션 보상 받기" }).click();
  await expect(page.getByRole("status")).toContainText("+50 XP");
  await expect(
    page.locator(".mission-card", { hasText: "일일 미션" }),
  ).toContainText("보상 수령 완료");
  await page.reload();
  await expect(
    page.locator(".mission-card", { hasText: "일일 미션" }),
  ).toContainText("보상 수령 완료");
  expect(calls).toBe(1);
  await expect(page.getByLabel("시즌 진행")).toContainText("이번 달 보상 수령");
});

test("failed claims stay retryable and show the server rejection", async ({
  page,
}) => {
  await authenticate(page);
  const data = dashboard();
  Object.assign(data.items[0], {
    current: 5,
    status: "done",
    completedAt: data.serverTime,
  });
  await mockMissions(page, data);
  await page.route("**/api/v1/missions/daily/claim", (route) =>
    route.fulfill({
      status: 409,
      json: { message: "미션 기간이 끝났습니다." },
    }),
  );
  await page.goto("/missions");
  await page.getByRole("button", { name: "일일 미션 보상 받기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "미션 기간이 끝났습니다.",
  );
  await expect(
    page.getByRole("button", { name: "일일 미션 보상 받기" }),
  ).toBeEnabled();
  await expect(page.getByText("보상 수령 완료")).toHaveCount(0);
});

test("server failure does not render fabricated zero progress and can recover", async ({
  page,
}) => {
  await authenticate(page);
  let failed = true;
  await page.route("**/api/v1/missions", (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { message: "일시적으로 사용할 수 없습니다." } }
        : { json: dashboard() },
    ),
  );
  await page.goto("/missions");
  await expect(page.getByRole("alert")).toContainText("일시적으로");
  await expect(page.locator(".mission-card")).toHaveCount(0);
  failed = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".mission-card")).toHaveCount(7);
});

test("analysis saves checked answers on server and preserves choices on a failed save", async ({
  page,
}) => {
  await authenticate(page);
  await mockMissions(page);
  await page.route("**/api/v1/missions/analysis/slice/attempts", (route) =>
    route.fulfill({ status: 503, json: { message: "저장 실패" } }),
  );
  await page.goto("/analysis/slice");
  await page.locator(".analysis-option").nth(2).click();
  await page.getByRole("button", { name: "정답 확인" }).click();
  await expect(page.getByRole("alert")).toContainText("저장 실패");
  await expect(page.locator("input[type=radio]").nth(2)).toBeChecked();
  await expect(page.getByRole("button", { name: "정답 확인" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "다시 풀기" })).toHaveCount(0);
});

test("bonus assignment and empty assignment use server choices, with no fake reward", async ({
  page,
}) => {
  await authenticate(page);
  const { data } = await mockMissions(page);
  await page.goto("/missions");
  await expect(page.locator(".xp-boost-card a")).toHaveAttribute(
    "href",
    "/problems/view/assigned",
  );
  const bonus = data.items.find((m) => m.id === "bonus")!;
  Object.assign(bonus, {
    available: false,
    description: "새로 풀 수 있는 공개 문제가 없어요.",
    action: { to: "/problems", label: "문제 풀러 가기" },
  });
  await page.reload();
  await expect(page.locator(".xp-boost-card")).toContainText(
    "공개 문제가 없어요",
  );
  await expect(
    page.getByRole("button", { name: "오늘의 보너스 문제 보상 받기" }),
  ).toBeDisabled();
});
