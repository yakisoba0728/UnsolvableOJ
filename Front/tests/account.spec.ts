import { expect, test, type Page } from "@playwright/test";
import {
  authenticate,
  mockCommunityApi,
  mockProblemApi,
  problem,
  session,
  storageKey,
} from "./fixtures";

const entry = (rank: number, username = `user${rank}`) => ({
  id: username,
  username,
  level: 2,
  xp: 1000 - rank,
  rating: 0,
  solvedCount: rank,
  rank,
});

const otherProfile = {
  id: "other-id",
  username: "other",
  level: 3,
  xp: 250,
  rank: 7,
  solvedCount: 3,
  createdAt: "2026-09-01T00:00:00Z",
  badges: [{ badge: "night-coder", awardedAt: "2026-10-01T00:00:00Z" }],
  solvedProblems: [
    { id: problem.id, slug: problem.slug, title: problem.title, difficulty: "BEGINNER", solvedAt: "2026-10-01T00:00:00Z" },
  ],
};

async function mockRankingPages(page: Page) {
  const requested: string[] = [];
  await page.route("**/api/v1/rankings?**", (route) => {
    const url = new URL(route.request().url());
    requested.push(url.search);
    const current = Number(url.searchParams.get("page"));
    const limit = Number(url.searchParams.get("limit"));
    const items =
      current === 1
        ? [entry(1), entry(2, session.user.username)]
        : [entry(limit + 1, "late")];
    return route.fulfill({
      json: { items, page: current, limit, total: limit + 1, totalPages: 2 },
    });
  });
  return requested;
}

test.beforeEach(({ page }) => mockProblemApi(page));

test("the rankings page pages through the server, highlights me and links to profiles", async ({ page }) => {
  await authenticate(page);
  const requested = await mockRankingPages(page);
  await page.goto("/rankings");

  const mine = page.locator(".ranking-row.current");
  await expect(mine).toHaveCount(1);
  await expect(mine).toHaveAttribute("aria-current", "true");
  await expect(mine).toContainText(`${session.user.username} · 나`);
  await expect(page.getByRole("link", { name: "user1" })).toHaveAttribute("href", "/users/user1");

  await page.getByRole("button", { name: "2페이지" }).click();
  await expect(page).toHaveURL(/\/rankings\?page=2$/);
  await expect(page.locator(".ranking-row")).toHaveCount(1);
  await expect(page.locator(".ranking-position")).toHaveText("51");
  await expect(page.locator(".ranking-row.current")).toHaveCount(0);
  // 개발 모드 StrictMode는 첫 요청을 두 번 보낼 수 있어 종류만 확인한다.
  expect([...new Set(requested)]).toEqual(["?page=1&limit=50", "?page=2&limit=50"]);
});

test("the home ranking card links to the full rankings and to each public profile", async ({ page }) => {
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [entry(1, "top")] }));
  await page.goto("/");
  const card = page.locator(".ranking-card");
  await expect(card.getByRole("link", { name: "top" })).toHaveAttribute("href", "/users/top");
  await mockRankingPages(page);
  await card.getByRole("link", { name: "전체 보기" }).click();
  await expect(page).toHaveURL(/\/rankings$/);
  await expect(page.getByRole("heading", { level: 1, name: "랭킹" })).toBeVisible();
});

test("a public profile shows level, rank, badges and public solved problems without private fields", async ({ page }) => {
  await page.route("**/api/v1/users/other", (route) => route.fulfill({ json: otherProfile }));
  await page.route("**/api/v1/users/ghost", (route) =>
    route.fulfill({ status: 404, json: { message: "사용자를 찾을 수 없습니다." } }),
  );
  await page.goto("/users/other");
  await expect(page.getByRole("heading", { level: 1, name: "other" })).toBeVisible();
  await expect(page.locator(".profile-stats")).toContainText("해결한 문제3");
  await expect(page.locator(".profile-stats")).toContainText("#7");
  await expect(page.locator(".profile-card")).toContainText("Lv.3");
  await expect(page.locator(".profile-card")).toContainText("심야 코더");
  await expect(page.getByRole("link", { name: problem.title })).toHaveAttribute("href", "/problems/view/sum");
  // 다른 사람의 프로필에는 계정 설정이 없다.
  await expect(page.getByRole("link", { name: "계정 설정" })).toHaveCount(0);

  await page.goto("/users/ghost");
  await expect(page.getByRole("alert")).toContainText("사용자를 찾을 수 없습니다.");
});

test("community post and answer authors link to their public profile", async ({ page }) => {
  await mockCommunityApi(page, {
    posts: [{ id: "q1", title: "질문입니다", category: "question", author: "other" }],
    answers: [{ id: "a1", postId: "q1", author: "helper" }],
  });
  await page.goto("/community/q1");
  await expect(page.locator(".post-author-text").getByRole("link", { name: "other" })).toHaveAttribute("href", "/users/other");
  await expect(page.locator(".answer-head").getByRole("link", { name: "helper" })).toHaveAttribute("href", "/users/helper");
});

test("settings requires sign-in", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/auth$/);
});

test("settings changes the username and password and keeps the session in sync", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/auth/sessions", (route) => route.fulfill({ json: [] }));
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/v1/auth/username", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().headers().authorization).toBe(`Bearer ${session.accessToken}`);
    if (body.username === "taken")
      return route.fulfill({ status: 409, json: { message: "이미 사용 중인 사용자 이름입니다." } });
    return route.fulfill({
      json: { ...session, accessToken: "renamed-token", user: { ...session.user, username: body.username } },
    });
  });
  await page.route("**/api/v1/auth/password", async (route) => {
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (body.currentPassword !== "old-password-1")
      // 틀린 현재 비밀번호는 401이 아니라 400이라 로그아웃되지 않는다.
      return route.fulfill({ status: 400, json: { message: "현재 비밀번호가 올바르지 않습니다." } });
    return route.fulfill({ json: { ...session, accessToken: "new-password-token", user: { ...session.user, username: "renamed" } } });
  });
  await page.goto("/settings");

  const name = page.getByLabel("새 사용자 이름");
  await expect(name).toHaveValue(session.user.username);
  await name.fill("bad name");
  await page.getByRole("button", { name: "이름 변경" }).click();
  await expect(page.getByRole("alert")).toContainText("영문, 숫자, 밑줄");
  await name.fill("taken");
  await page.getByRole("button", { name: "이름 변경" }).click();
  await expect(page.getByRole("alert")).toContainText("이미 사용 중인 사용자 이름입니다.");
  await name.fill("renamed");
  await page.getByRole("button", { name: "이름 변경" }).click();
  await expect(page.getByRole("status").filter({ hasText: "사용자 이름을 바꿨습니다." })).toBeVisible();
  await expect(page.locator(".account-name")).toHaveText("renamed");

  await page.getByLabel("현재 비밀번호").fill("wrong-password");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("new-password-2");
  await page.getByLabel("새 비밀번호 확인").fill("different-password");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByRole("alert")).toContainText("새 비밀번호가 서로 다릅니다.");
  await page.getByLabel("새 비밀번호 확인").fill("new-password-2");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByRole("alert")).toContainText("현재 비밀번호가 올바르지 않습니다.");
  await expect(page.locator(".account-name")).toHaveText("renamed");

  await page.getByLabel("현재 비밀번호").fill("old-password-1");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByRole("status").filter({ hasText: "비밀번호를 바꿨습니다." })).toBeVisible();
  await expect(page.getByLabel("현재 비밀번호")).toHaveValue("");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
  expect(saved.session.accessToken).toBe("new-password-token");
  expect(bodies.at(-1)).toEqual({ currentPassword: "old-password-1", newPassword: "new-password-2" });
});

test("settings lists login devices and signs out one or all other devices", async ({ page }) => {
  await authenticate(page);
  let devices = [
    { id: "this", createdAt: "2026-11-01T00:00:00Z", lastUsedAt: "2026-11-09T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z", remember: true, current: true },
    { id: "phone", createdAt: "2026-11-02T00:00:00Z", lastUsedAt: "2026-11-08T00:00:00Z", expiresAt: "2026-11-09T12:00:00Z", remember: false, current: false },
    { id: "laptop", createdAt: "2026-11-03T00:00:00Z", lastUsedAt: "2026-11-07T00:00:00Z", expiresAt: "2026-11-09T12:00:00Z", remember: false, current: false },
  ];
  const deletes: string[] = [];
  await page.route("**/api/v1/auth/sessions**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET") return route.fulfill({ json: devices });
    deletes.push(path);
    expect(route.request().headers().authorization).toBe(`Bearer ${session.accessToken}`);
    devices =
      path.endsWith("/sessions") ? devices.filter((device) => device.current) : devices.filter((device) => !path.endsWith(`/${device.id}`));
    return route.fulfill({ status: 204 });
  });
  await page.goto("/settings");
  const list = page.locator(".session-list li");
  await expect(list).toHaveCount(3);
  await expect(list.first()).toContainText("이 기기");
  await expect(list.first()).toContainText("로그인 유지");
  await expect(list.first().getByRole("button", { name: "로그아웃" })).toHaveCount(0);

  await list.nth(1).getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("status").filter({ hasText: "그 기기에서 로그아웃했습니다." })).toBeVisible();
  await expect(list).toHaveCount(2);
  await page.getByRole("button", { name: "다른 기기 모두 로그아웃" }).click();
  await expect(page.getByRole("status").filter({ hasText: "다른 기기에서 모두 로그아웃했습니다." })).toBeVisible();
  await expect(list).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다른 기기 모두 로그아웃" })).toBeDisabled();
  expect(deletes).toEqual(["/api/v1/auth/sessions/phone", "/api/v1/auth/sessions"]);
  // 기기 로그아웃의 204는 오류가 아니고, 지금 로그인은 그대로다.
  await expect(page.getByRole("button", { name: "로그아웃" }).first()).toBeVisible();
});

test("a temporary-password login stays on settings until the password is changed", async ({ page }) => {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    {
      key: storageKey,
      saved: { session: { ...session, user: { ...session.user, mustChangePassword: true } }, expiresAt: Date.now() + 900_000 },
    },
  );
  await page.route("**/api/v1/auth/sessions", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/auth/password", (route) =>
    route.fulfill({ json: { ...session, accessToken: "changed-token", user: { ...session.user, mustChangePassword: false } } }),
  );
  await page.goto("/problems");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("alert")).toContainText("임시 비밀번호로 로그인했습니다");
  await page.getByRole("link", { name: "문제" }).first().click();
  await expect(page).toHaveURL(/\/settings$/);

  await page.getByLabel("현재 비밀번호").fill("temporary-pass");
  await page.getByLabel("새 비밀번호", { exact: true }).fill("chosen-password-1");
  await page.getByLabel("새 비밀번호 확인").fill("chosen-password-1");
  await page.getByRole("button", { name: "비밀번호 변경" }).click();
  await expect(page.getByRole("status").filter({ hasText: "비밀번호를 바꿨습니다." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  // 초기화 스크립트가 다시 넣지 않도록 새로 고치지 않고 이동한다.
  await page.getByRole("link", { name: "문제" }).first().click();
  await expect(page).toHaveURL(/\/problems$/);
});
