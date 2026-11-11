import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await authenticate(page);
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", (route) =>
    route.fulfill({ json: { count: 3 } }),
  );
});

for (const theme of ["light", "dark"]) {
  test(`mobile header keeps every visible control inside the viewport (${theme})`, async ({
    page,
  }) => {
    for (const width of [320, 390, 480, 481, 768, 1101, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/problems");
      await expect(
        page.getByRole("heading", { name: "문제 목록", exact: true }),
      ).toBeVisible();
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page
        .locator("header button:visible,header a:visible")
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return (
                r.left < 0 || r.right > document.documentElement.clientWidth + 1
              );
            })
            .map((el) => el.getAttribute("aria-label") || el.textContent),
        );
      expect(overflow, `width=${width}`).toEqual([]);
      if (width <= 480) {
        const menu = page.getByRole("button", { name: "메뉴", exact: true });
        await expect(
          page.getByRole("button", { name: "로그아웃", exact: true }),
        ).toHaveCount(0);
        await menu.click();
        await expect(
          page.getByRole("button", { name: "로그아웃", exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(menu).toBeFocused();
      }
    }
  });
}

test("mobile logout remains available through the menu", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/problems");
  await page.getByRole("button", { name: "메뉴", exact: true }).click();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "메뉴", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});

for (const value of [
  "999999999999999999999",
  "1000001",
  "Infinity",
  "1e309",
  "NaN",
  "-3",
  "0",
]) {
  test(`bad page ${value} resets before an invalid API request is sent`, async ({
    page,
  }) => {
    const requests: URL[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname === "/api/v1/problems") requests.push(url);
    });
    await page.goto(
      `/problems?q=${encodeURIComponent("두")}&d=BEGINNER&page=${encodeURIComponent(value)}`,
    );
    await expect(page.locator(".problem-row")).toHaveCount(1);
    await expect(page).not.toHaveURL(/[?&]page=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe("두");
    expect(url.searchParams.get("d")).toBe("BEGINNER");
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const pageNumber = Number(request.searchParams.get("page") ?? "1");
      expect(
        Number.isSafeInteger(pageNumber) &&
          pageNumber >= 1 &&
          pageNumber <= 1_000_000,
      ).toBe(true);
    }
  });
}

test("fractional page canonicalization preserves valid legacy rounding", async ({
  page,
}) => {
  await page.goto("/analysis?page=1.5&q=zz");
  await expect(
    page.getByRole("heading", { name: "코드 분석", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]page=/);
  expect(new URL(page.url()).searchParams.get("q")).toBe("zz");
});

for (const resource of ["submissions", "enterprise", "enterprise-edit"]) {
  test(`${resource}: malformed UUID has a translated explanation and no pointless retry`, async ({
    page,
  }) => {
    let reads = 0;
    const enterprise = resource.startsWith("enterprise");
    const endpoint = enterprise ? "enterprise/tests" : "submissions";
    await page.route(`**/api/v1/${endpoint}/not-a-uuid`, (route) => {
      reads++;
      return route.fulfill({
        status: 400,
        json: { message: "Validation failed (uuid is expected)" },
      });
    });
    await page.goto(
      resource === "enterprise-edit"
        ? "/enterprise/not-a-uuid/edit"
        : `/${resource}/not-a-uuid`,
    );
    await expect(page.getByRole("alert")).toContainText(
      "주소 형식이 올바르지 않습니다.",
    );
    await expect(page.locator("main")).not.toContainText("uuid is expected");
    await expect(
      page.getByRole("button", { name: /^(다시 확인|다시 시도)$/ }),
    ).toHaveCount(0);
    const link = enterprise
      ? page.getByRole("link", { name: "기업 테스트로", exact: true })
      : page.getByRole("link", { name: "내 제출로", exact: true });
    await expect(link).toHaveAttribute(
      "href",
      enterprise ? "/enterprise" : "/submissions",
    );
    // 최초 StrictMode 재마운트 요청은 허용하되 자동 폴링이 예약되지 않았는지 확인한다.
    const before = reads;
    await page.clock.install();
    await page.clock.fastForward(60_000);
    expect(reads).toBe(before);
  });
}

test("a different 400 error remains retryable and is not misclassified as a bad UUID", async ({
  page,
}) => {
  await page.route("**/api/v1/submissions/valid-fixture", (route) =>
    route.fulfill({ status: 400, json: { message: "다른 입력 오류" } }),
  );
  await page.goto("/submissions/valid-fixture");
  await expect(page.getByRole("alert")).toContainText("다른 입력 오류");
  await expect(
    page.getByRole("button", { name: "다시 확인", exact: true }),
  ).toBeVisible();
});
