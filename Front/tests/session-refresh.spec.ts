import { expect, test, type Page, type Route } from "@playwright/test";
import { mockProblemApi, session, storageKey } from "./fixtures";

const later = () => new Date(Date.now() + 12 * 3_600_000).toISOString();
const refreshed = (accessToken: string, refreshToken: string) => ({
  ...session,
  accessToken,
  refreshToken,
  refreshTokenExpiresAt: later(),
  remember: true,
});

/** 저장소에 세션이 없을 때만 넣는다(새로 고침·새 탭이 갱신된 세션을 덮지 않게). */
async function seed(page: Page, expiresAt: number) {
  await page.context().addInitScript(
    ({ key, saved }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
    },
    {
      key: storageKey,
      saved: { session: refreshed("old-access", "r1"), expiresAt },
    },
  );
}

/** 홈의 내 프로필 요청(/users/me): 새 access token만 받아 준다. 받은 Authorization 헤더를 모은다. */
async function mockAuthorizedApi(page: Page, headers: string[]) {
  await mockProblemApi(page);
  await page.route("**/api/v1/users/me", (route: Route) => {
    const authorization = route.request().headers().authorization ?? "";
    headers.push(authorization);
    return authorization === "Bearer new-access"
      ? route.fulfill({ json: { ...session.user, rank: 1, solvedCount: 0, createdAt: "2026-09-01T00:00:00Z" } })
      : route.fulfill({ status: 401, json: { message: "다시 로그인해야 합니다." } });
  });
}

const saved = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), storageKey);

test("remember-me login asks for a 30-day refresh token and logout revokes it", async ({ page }) => {
  await mockProblemApi(page);
  await page.route("**/api/v1/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: session.user.email,
      password: "browser-password",
      remember: true,
    });
    await route.fulfill({ json: refreshed("new-access", "r1") });
  });
  const logouts: unknown[] = [];
  await page.route("**/api/v1/auth/logout", (route) => {
    logouts.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });
  await page.goto("/auth");
  await expect(page.getByText("관리자에게 임시 비밀번호를 요청하세요")).toBeVisible();
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByLabel("로그인 유지").check();
  await expect(page.getByText("30일 동안 로그인 상태를 유지합니다", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  expect((await saved(page)).session).toMatchObject({ refreshToken: "r1", remember: true });

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("link", { name: "로그인" }).first()).toBeVisible();
  await expect.poll(() => logouts).toEqual([{ refreshToken: "r1" }]);
  expect(await saved(page)).toBeNull();
});

test("a 401 refreshes the session once and retries the request with the new token", async ({ page }) => {
  await seed(page, Date.now() + 900_000);
  const headers: string[] = [];
  await mockAuthorizedApi(page, headers);
  const refreshBodies: unknown[] = [];
  await page.route("**/api/v1/auth/refresh", (route) => {
    refreshBodies.push(route.request().postDataJSON());
    return route.fulfill({ json: refreshed("new-access", "r2") });
  });
  await page.goto("/");
  await expect.poll(() => headers).toContain("Bearer new-access");
  expect(headers[0]).toBe("Bearer old-access");
  expect(refreshBodies).toEqual([{ refreshToken: "r1" }]);
  expect((await saved(page)).session).toMatchObject({
    accessToken: "new-access",
    refreshToken: "r2",
  });
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});

test("a rejected refresh signs the user out", async ({ page }) => {
  await seed(page, Date.now() + 900_000);
  await mockAuthorizedApi(page, []);
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ status: 401, json: { message: "다시 로그인해야 합니다." } }),
  );
  await page.goto("/");
  await expect(page.getByRole("link", { name: "로그인" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  expect(await saved(page)).toBeNull();
});

test("tabs refreshing an expired access token at once share one rotation", async ({ page }) => {
  await seed(page, Date.now() - 1000);
  const second = await page.context().newPage();
  let calls = 0;
  for (const tab of [page, second]) {
    await mockAuthorizedApi(tab, []);
    // 서버처럼 쓴 refresh token이 다시 오면 거절한다. 두 탭이 같은 토큰을 보내면 한쪽이 로그아웃된다.
    await tab.route("**/api/v1/auth/refresh", async (route) => {
      calls += 1;
      const { refreshToken } = route.request().postDataJSON() as { refreshToken: string };
      await new Promise((resolve) => setTimeout(resolve, 300));
      return refreshToken === "r1" && calls === 1
        ? route.fulfill({ json: refreshed("new-access", "r2") })
        : route.fulfill({ status: 401, json: { message: "다시 로그인해야 합니다." } });
    });
  }
  await Promise.all([page.goto("/"), second.goto("/")]);
  for (const tab of [page, second]) {
    await expect(tab.getByRole("button", { name: "로그아웃" })).toBeVisible();
    await expect.poll(async () => (await saved(tab))?.session.accessToken).toBe("new-access");
  }
  expect(calls).toBe(1);
});
