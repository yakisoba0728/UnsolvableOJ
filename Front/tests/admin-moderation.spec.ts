import { expect, test, type Page } from "@playwright/test";
import type { Submission } from "../src/types";
import { answerConfirm, authenticate } from "./fixtures";

const report = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  reason: `사유 ${id}`,
  createdAt: "2026-10-02T00:00:00Z",
  resolvedAt: null,
  targetType: "POST",
  reporter: { id: "u-alice", username: "alice" },
  author: { id: "u-bob", username: "bob" },
  post: { id: "p-1", title: "광고 글", hidden: false },
  comment: null,
  ...extra,
});
const submission = (status: string): Submission => ({
  id: "s-1",
  problem: { id: "problem-id", slug: "sum", title: "두 수의 합" },
  language: "PYTHON",
  status,
  runtimeMs: 10,
  memoryKb: 1000,
  passedTestCases: 1,
  totalTestCases: 1,
  compileOutput: null,
  judgeMessage: null,
  sourceCode: "print(1)",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

/** 신고·재채점·임시 비밀번호 API를 흉내 내고 받은 요청(메서드, 경로+쿼리, 본문)을 돌려준다. */
async function mockApi(page: Page) {
  const requests: { method: string; url: URL; body: unknown }[] = [];
  let hidden = false;
  let rejudged = false;
  await page.route("**/api/v1/**", async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const body = route.request().postDataJSON();
    requests.push({ method, url, body });
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/admin/users")
      return route.fulfill({
        json: {
          items: [
            { id: "solver", email: "solver@example.com", username: "solver", role: "ADMIN", level: 1, xp: 0, rating: 0, suspendedAt: null, createdAt: "2026-09-01T00:00:00Z" },
            { id: "u-alice", email: "alice@example.com", username: "alice", role: "USER", level: 1, xp: 0, rating: 0, suspendedAt: null, createdAt: "2026-09-01T00:00:00Z" },
          ],
          page: 1, limit: 20, total: 2, totalPages: 1,
        },
      });
    if (path === "/admin/users/u-alice/temporary-password" && method === "POST")
      return route.fulfill({ json: { temporaryPassword: "Tmp-9fQ2-xyz" } });
    if (path === "/admin/community/reports") {
      const items =
        url.searchParams.get("status") === "resolved"
          ? [report("r-3", { resolvedAt: "2026-10-03T00:00:00Z" })]
          : [
              report("r-1", { post: { id: "p-1", title: "광고 글", hidden } }),
              report("r-2", {
                targetType: "COMMENT",
                comment: { id: "c-9", body: "욕설 답변", hidden: false },
              }),
            ];
      return route.fulfill({ json: { items, page: 1, limit: 20, total: items.length, totalPages: 1 } });
    }
    if (path === "/admin/community/posts/p-1/hidden") {
      hidden = method === "PUT";
      return route.fulfill({ json: { ok: true, hidden } });
    }
    if (path === "/admin/community/reports/r-2/resolved" && method === "PUT")
      return route.fulfill({ json: { ok: true } });
    if (path === "/submissions/s-1")
      return route.fulfill({ json: submission(rejudged ? "QUEUED" : "ACCEPTED") });
    if (path === "/submissions/s-1/rejudge" && method === "POST") {
      rejudged = true;
      return route.fulfill({ status: 202, json: submission("QUEUED") });
    }
    if (path === "/problems/mine")
      return route.fulfill({
        json: [
          { id: "problem-id", slug: "sum", title: "두 수의 합", status: "PUBLISHED", difficulty: "BEGINNER", currentVersion: 2, updatedAt: "2026-10-01T00:00:00Z" },
        ],
      });
    if (path === "/problems/problem-id/rejudge" && method === "POST")
      return route.fulfill({
        status: 202,
        json: (body as { after?: string }).after
          ? { requeued: 3, skipped: 0, remaining: 0, next: null }
          : { requeued: 198, skipped: 2, remaining: 3, next: "s-200" },
      });
    return route.fulfill({ status: 404, json: { message: `Unexpected test request: ${path}` } });
  });
  return requests;
}

test("admins review community reports, resolve them, and hide targets", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const requests = await mockApi(page);
  await page.goto("/admin/users");
  await page.getByRole("link", { name: "신고", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/community$/);
  const rows = page.locator(".admin-table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("link", { name: "광고 글" })).toHaveAttribute("href", "/community/p-1");
  await expect(rows.nth(1).getByRole("link", { name: "답변: 욕설 답변" })).toHaveAttribute("href", "/community/p-1#c-9");
  await expect(rows.first()).toContainText("신고자 alice");

  const reads = () => requests.filter(({ url }) => url.pathname === "/api/v1/admin/community/reports").length;
  // 확인 창을 취소하면 보내지 않는다.
  await rows.first().getByRole("button", { name: "글 숨기기" }).click();
  await answerConfirm(page, false);
  expect(requests.some(({ url }) => url.pathname.endsWith("/hidden"))).toBe(false);

  const before = reads();
  await rows.first().getByRole("button", { name: "글 숨기기" }).click();
  await answerConfirm(page, true, "숨기기");
  await expect(rows.first().getByRole("button", { name: "글 숨김 해제" })).toBeVisible();
  await expect(rows.first().getByText("숨김", { exact: true })).toBeVisible();
  expect(requests.find(({ url }) => url.pathname === "/api/v1/admin/community/posts/p-1/hidden")!.method).toBe("PUT");
  expect(reads()).toBe(before + 1);

  await rows.first().getByRole("button", { name: "글 숨김 해제" }).click();
  await answerConfirm(page, true, "숨김 해제");
  await expect(rows.first().getByRole("button", { name: "글 숨기기" })).toBeVisible();
  expect(requests.filter(({ url }) => url.pathname.endsWith("/p-1/hidden")).at(-1)!.method).toBe("DELETE");

  await rows.nth(1).getByRole("button", { name: "처리 완료" }).click();
  await answerConfirm(page, true, "처리 완료");
  await expect.poll(() => requests.some(({ method, url }) => method === "PUT" && url.pathname.endsWith("/reports/r-2/resolved"))).toBe(true);

  await page.getByRole("combobox", { name: "신고 상태 필터" }).click();
  await page.getByRole("option", { name: "처리됨" }).click();
  await expect(page).toHaveURL(/status=resolved/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByText("처리됨")).toBeVisible();
  await expect(rows.first().getByRole("button", { name: "처리 완료" })).toHaveCount(0);
});

test("admins issue a one-time temporary password, never for themselves", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const requests = await mockApi(page);
  await page.goto("/admin/users");
  const rows = page.locator(".admin-table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByRole("button", { name: "임시 비밀번호" })).toHaveCount(0);

  await rows.nth(1).getByRole("button", { name: "임시 비밀번호" }).click();
  await answerConfirm(page, false);
  expect(requests.some(({ url }) => url.pathname.endsWith("/temporary-password"))).toBe(false);

  await rows.nth(1).getByRole("button", { name: "임시 비밀번호" }).click();
  await expect(page.getByRole("dialog")).toContainText("모든 로그인이 끊깁니다");
  await answerConfirm(page, true, "발급");
  const panel = page.locator(".admin-issued");
  await expect(panel.locator("code")).toHaveText("Tmp-9fQ2-xyz");
  await expect(panel).toContainText("사용자에게 안전하게 전달하고 로그인 후 바꾸게 하세요");
  await expect(panel.getByRole("button", { name: "복사" })).toBeVisible();
  expect(requests.find(({ url }) => url.pathname.endsWith("/temporary-password"))!.method).toBe("POST");
  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(page.getByText("Tmp-9fQ2-xyz")).toHaveCount(0);
});

test("problem authors rejudge one submission after confirming", async ({ page }) => {
  await authenticate(page, "AUTHOR");
  const requests = await mockApi(page);
  await page.goto("/submissions/s-1");
  const button = page.getByRole("button", { name: "다시 채점" });
  await expect(button).toBeVisible();
  await button.click();
  await answerConfirm(page, false);
  expect(requests.some(({ url }) => url.pathname.endsWith("/rejudge"))).toBe(false);
  await button.click();
  await answerConfirm(page, true, "다시 채점");
  await expect(page.getByText("채점 대기").first()).toBeVisible();
  expect(requests.find(({ url }) => url.pathname.endsWith("/rejudge"))!.url.pathname).toBe("/api/v1/submissions/s-1/rejudge");
});

test("users who do not own the problem see no rejudge button", async ({ page }) => {
  await authenticate(page, "USER");
  const requests = await mockApi(page);
  await page.goto("/submissions/s-1");
  await expect(page.getByRole("heading", { name: "두 수의 합" })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 채점" })).toHaveCount(0);
  expect(requests.some(({ url }) => url.pathname.endsWith("/problems/mine"))).toBe(false);
});

test("bulk rejudge continues from the next cursor until nothing remains", async ({ page }) => {
  await authenticate(page, "AUTHOR");
  const requests = await mockApi(page);
  await page.goto("/my-problems");
  const rejudges = () => requests.filter(({ url }) => url.pathname === "/api/v1/problems/problem-id/rejudge");
  await page.getByRole("button", { name: "전체 재채점" }).click();
  await answerConfirm(page, false);
  expect(rejudges()).toHaveLength(0);

  await page.getByRole("button", { name: "전체 재채점" }).click();
  await answerConfirm(page, true, "모두 다시 채점");
  const notice = page.locator(".my-problem-rejudge");
  await expect(notice).toContainText("198건");
  await expect(notice).toContainText("남은 제출 3건");
  expect(rejudges()[0].body).toEqual({});

  await notice.getByRole("button", { name: "계속" }).click();
  await expect(notice).toContainText("201건");
  await expect(notice).not.toContainText("남은 제출");
  await expect(notice.getByRole("button", { name: "계속" })).toHaveCount(0);
  expect(rejudges()[1].body).toEqual({ after: "s-200" });
});
