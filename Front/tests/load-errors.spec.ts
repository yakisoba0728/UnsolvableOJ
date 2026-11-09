import { expect, test, type Page } from "@playwright/test";
import { authenticate, mockProblemApi, problem, session } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

/** path 요청을 처음에는 네트워크 오류로 끊고, 돌려준 함수를 부르면 그다음부터는 앞서 등록한 응답으로 넘긴다. */
async function dropUntilRestored(page: Page, path: string) {
  let down = true;
  await page.route(
    (url) => url.pathname === path,
    (route) => (down ? route.abort("failed") : route.fallback()),
  );
  return () => {
    down = false;
  };
}

test("home explains a network failure in Korean, never shows a fake 0 count, and retries", async ({
  page,
}) => {
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [] }));
  const restore = await dropUntilRestored(page, "/api/v1/problems");
  await page.goto("/");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("서버에 연결하지 못했습니다");
  await expect(alert).not.toContainText(/fetch|NetworkError|Load failed/i);
  const count = page
    .locator(".highlight-stats li", { hasText: "공개 문제" })
    .locator("strong");
  await expect(count).toHaveText("—");
  restore();
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(count).toHaveText("1");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("problem list retries after a network failure without claiming there are no problems", async ({
  page,
}) => {
  const restore = await dropUntilRestored(page, "/api/v1/problems");
  await page.goto("/problems");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("서버에 연결하지 못했습니다");
  await expect(page.getByText("공개된 문제가 아직 없습니다.")).toHaveCount(0);
  restore();
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("my submissions retry after a network failure", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "s1",
            problem: { id: problem.id, slug: problem.slug, title: problem.title },
            language: "PYTHON",
            status: "ACCEPTED",
            runtimeMs: 1,
            memoryKb: 1024,
            passedTestCases: 1,
            totalTestCases: 1,
            createdAt: problem.createdAt,
          },
        ],
        page: 1,
        limit: 1000,
        total: 1,
        totalPages: 1,
      },
    }),
  );
  const restore = await dropUntilRestored(page, "/api/v1/submissions");
  await page.goto("/submissions");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("서버에 연결하지 못했습니다");
  await expect(page.getByText("아직 제출한 풀이가 없어요.")).toHaveCount(0);
  restore();
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("profile retries a failed profile request", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({ json: { ...session.user, solvedCount: 0, createdAt: problem.createdAt } }),
  );
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({ json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 0 } }),
  );
  await page.route("**/api/v1/community/posts/mine", (route) =>
    route.fulfill({ json: { written: [], voted: [], saved: [], following: [] } }),
  );
  const restore = await dropUntilRestored(page, "/api/v1/users/me");
  await page.goto("/profile");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("서버에 연결하지 못했습니다");
  restore();
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".profile-card")).toContainText(session.user.username);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
