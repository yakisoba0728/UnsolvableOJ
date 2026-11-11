import { expect, test, type Page } from "@playwright/test";
import type { AdminAuditEvent, AdminUser } from "../src/types";
import { authenticate } from "./fixtures";

const user = (id: string, username: string, extra: Partial<AdminUser> = {}): AdminUser => ({
  id,
  email: `${username}@example.com`,
  username,
  role: "USER",
  level: 1,
  xp: 0,
  rating: 0,
  suspendedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  ...extra,
});
const users = [
  user("solver", "solver", { role: "ADMIN" }),
  user("u-alice", "alice"),
  user("u-bob", "bob", { role: "AUTHOR", suspendedAt: "2026-10-01T00:00:00Z" }),
];
const event = (id: string, action: string, extra: Partial<AdminAuditEvent> = {}): AdminAuditEvent => ({
  id,
  actorId: "solver",
  actorUsername: "solver",
  action,
  targetType: "user",
  targetId: "u-alice",
  targetUsername: "alice",
  details: {},
  createdAt: "2026-10-02T00:00:00Z",
  ...extra,
});

/** 관리자 API를 흉내 낸다. 받은 요청(경로+쿼리, 본문)을 돌려줘 화면이 보낸 값을 확인한다. */
async function mockAdminApi(page: Page) {
  const requests: { url: URL; body: unknown }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    requests.push({ url, body });
    const path = url.pathname.replace("/api/v1", "");
    const patch = /^\/admin\/users\/([^/]+)\/(role|suspension)$/.exec(path);
    if (path === "/admin/users") {
      const q = url.searchParams.get("q")?.toLowerCase() ?? "";
      const role = url.searchParams.get("role");
      const items = users.filter(
        (item) =>
          (item.username.includes(q) || item.email.includes(q)) &&
          (!role || item.role === role),
      );
      return route.fulfill({
        json: { items, page: 1, limit: 20, total: items.length, totalPages: 1, nextCursor: null },
      });
    }
    if (patch && route.request().method() === "PATCH") {
      const [, id, kind] = patch;
      return route.fulfill({
        json:
          kind === "role"
            ? { id, role: (body as { role: string }).role }
            : { id, suspendedAt: (body as { suspended: boolean }).suspended ? "2026-11-01T00:00:00Z" : null },
      });
    }
    if (path === "/admin/audit") {
      const pageNumber = Number(url.searchParams.get("page") ?? 1);
      const items = [
        event(`e${pageNumber}`, url.searchParams.get("action") ?? "user.role", {
          details: { from: "USER", to: "AUTHOR" },
        }),
      ];
      return route.fulfill({
        json: { items, page: pageNumber, limit: 20, total: 41, totalPages: 3, nextCursor: "next" },
      });
    }
    if (path === "/admin/ops")
      return route.fulfill({
        json: {
          queue: { waiting: 3, active: 1, delayed: 0, failed: 2, completed: 9 },
          submissions: [{ status: "ACCEPTED", count: 7 }],
          workers: [],
          recentFailedJobs: [{ id: "job-1", failedReason: "boom", attemptsMade: 3 }],
          timestamp: "2026-11-01T00:00:00Z",
        },
      });
    return route.fulfill({ status: 404, json: { message: `Unexpected test request: ${path}` } });
  });
  return requests;
}

test("non-admins see no admin link and cannot open the console", async ({ page }) => {
  await authenticate(page, "AUTHOR");
  const requests = await mockAdminApi(page);
  await page.goto("/admin/users");
  await expect(page.getByRole("link", { name: "관리", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "관리", exact: true })).toHaveCount(0);
  expect(requests.some(({ url }) => url.pathname.startsWith("/api/v1/admin"))).toBe(false);
});

test("admins search users, change roles, and suspend with confirmation", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const requests = await mockAdminApi(page);
  await page.goto("/");
  await page.getByRole("link", { name: "관리", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  const rows = page.locator(".admin-table tbody tr");
  await expect(rows).toHaveCount(3);
  // 자기 계정은 역할을 바꾸거나 정지할 수 없다.
  await expect(page.getByRole("combobox", { name: "solver 역할" })).toBeDisabled();
  await expect(rows.first().getByRole("button", { name: "정지" })).toHaveCount(0);

  await page.getByLabel("사용자 검색").fill("ali");
  await expect(rows).toHaveCount(1);
  expect(requests.at(-1)!.url.searchParams.get("q")).toBe("ali");
  await page.getByLabel("사용자 검색").fill("");
  await page.getByRole("combobox", { name: "역할 필터" }).click();
  await page.getByRole("option", { name: "작성자" }).click();
  await expect(rows).toHaveCount(1);
  await expect(page).toHaveURL(/role=AUTHOR/);
  await expect(rows.first().getByText("정지됨")).toBeVisible();

  // 확인 창을 취소하면 아무것도 보내지 않는다.
  page.once("dialog", (dialog) => dialog.dismiss());
  await rows.first().getByRole("button", { name: "정지 해제" }).click();
  expect(requests.some(({ url }) => url.pathname.endsWith("/suspension"))).toBe(false);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("bob의 정지를 해제할까요?");
    return dialog.accept();
  });
  await rows.first().getByRole("button", { name: "정지 해제" }).click();
  await expect(rows.first().getByText("정상")).toBeVisible();
  expect(requests.at(-1)!.body).toEqual({ suspended: false });

  await page.getByRole("combobox", { name: "역할 필터" }).click();
  await page.getByRole("option", { name: "모든 역할" }).click();
  await expect(rows).toHaveCount(3);
  const alice = rows.filter({ hasText: "alice" });
  page.once("dialog", (dialog) => dialog.accept());
  await alice.getByRole("button", { name: "정지", exact: true }).click();
  await expect(alice.getByText("정지됨")).toBeVisible();
  expect(requests.at(-1)!.url.pathname).toBe("/api/v1/admin/users/u-alice/suspension");
  expect(requests.at(-1)!.body).toEqual({ suspended: true });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("combobox", { name: "alice 역할" }).click();
  await page.getByRole("option", { name: "작성자" }).click();
  await expect(page.getByRole("combobox", { name: "alice 역할" })).toHaveText(/작성자/);
  expect(requests.at(-1)!.url.pathname).toBe("/api/v1/admin/users/u-alice/role");
  expect(requests.at(-1)!.body).toEqual({ role: "AUTHOR" });

  await alice.getByRole("link", { name: "alice 관련 기록" }).click();
  await expect(page).toHaveURL(/\/admin\/audit\?targetId=u-alice$/);
  await expect(page.getByRole("button", { name: "대상 조건 지우기" })).toHaveText(/alice/);
});

test("audit log filters by action and actor and pages through results", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const requests = await mockAdminApi(page);
  await page.goto("/admin/audit");
  const audits = () => requests.filter(({ url }) => url.pathname === "/api/v1/admin/audit");
  await expect(page.getByText("기록 41건")).toBeVisible();
  await expect(page.getByText('{"from":"USER","to":"AUTHOR"}')).toBeVisible();

  await page.getByRole("combobox", { name: "동작 필터" }).click();
  await page.getByRole("option", { name: "계정 정지" }).click();
  await expect(page.locator(".admin-table tbody td").nth(1)).toHaveText("계정 정지");
  expect(audits().at(-1)!.url.searchParams.get("action")).toBe("user.suspend");

  await page.locator(".admin-table tbody").getByRole("button", { name: "solver" }).click();
  await expect(page.getByRole("button", { name: "수행자 조건 지우기" })).toBeVisible();
  // 칩은 URL 상태로 먼저 그려지므로 요청이 기록될 때까지 기다린다.
  await expect.poll(() => audits().at(-1)!.url.searchParams.get("actorId")).toBe("solver");

  await page.getByRole("button", { name: "2페이지" }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect.poll(() => audits().at(-1)!.url.searchParams.get("page")).toBe("2");
  expect(audits().at(-1)!.url.searchParams.get("action")).toBe("user.suspend");

  // 조건을 지우면 첫 쪽으로 돌아간다.
  await page.getByRole("button", { name: "수행자 조건 지우기" }).click();
  await expect.poll(() => audits().at(-1)!.url.searchParams.has("actorId")).toBe(false);
  expect(audits().at(-1)!.url.searchParams.get("page")).toBe("1");
});

test("ops view shows queue counts, missing workers, and failed jobs", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const requests = await mockAdminApi(page);
  await page.goto("/admin/ops");
  const queue = page.getByLabel("채점 큐");
  await expect(queue.getByText("큐 대기")).toBeVisible();
  await expect(queue.locator(".stat-tile").first()).toContainText("3");
  await expect(page.getByRole("alert")).toHaveText("최근 30초 안에 응답한 채점 워커가 없습니다.");
  await expect(page.getByText("boom")).toBeVisible();
  const reads = () => requests.filter(({ url }) => url.pathname === "/api/v1/admin/ops").length;
  const before = reads();
  await page.getByRole("button", { name: "새로고침" }).click();
  await expect.poll(reads).toBe(before + 1);
});
