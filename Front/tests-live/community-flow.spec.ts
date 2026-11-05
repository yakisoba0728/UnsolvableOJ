import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type APIRequestContext } from "@playwright/test";

/** 회원가입 API로 계정을 만들고, 그 세션으로 로그인한 새 탭을 연다. */
async function signedInPage(browser: Browser, request: APIRequestContext) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const response = await request.post("/api/v1/auth/register", {
    data: {
      email: `community-${suffix}@example.com`,
      username: `community_${suffix}`,
      password: `community-${randomUUID()}`,
    },
  });
  expect(response.status()).toBe(201);
  const session = await response.json();
  const context = await browser.newContext();
  await context.addInitScript((saved) => {
    localStorage.setItem("unsolvable-oj-session-v1", JSON.stringify(saved));
  }, { session, expiresAt: Date.now() + 900_000 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { page, context, session, errors };
}

test("two real accounts write, answer, vote, follow, accept, edit and delete a community post", async ({
  browser,
  request,
}) => {
  const writer = await signedInPage(browser, request);
  const reader = await signedInPage(browser, request);
  const title = `실제 DB 커뮤니티 ${randomUUID().slice(0, 8)}`;
  let id = "";
  try {
    await writer.page.goto("/community/new");
    await writer.page.getByLabel(/^제목/).fill(title);
    await writer.page.getByLabel(/^본문/).fill("서버에 저장되는 질문입니다.");
    await writer.page.getByRole("button", { name: "글 등록", exact: true }).click();
    await expect(writer.page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    id = new URL(writer.page.url()).pathname.split("/").pop()!;

    // 다른 계정: 관리 메뉴는 없고, 답변 초안은 새로고침해도 남는다.
    const other = reader.page;
    await other.goto(`/community/${id}`);
    await expect(other.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "글 관리" })).toHaveCount(0);
    await other.getByLabel("답변 내용").fill("다른 사용자의 실제 답변입니다.");
    await other.reload();
    await expect(other.getByLabel("답변 내용")).toHaveValue("다른 사용자의 실제 답변입니다.");
    await other.getByRole("button", { name: "답변 등록", exact: true }).click();
    await expect(other.getByText("다른 사용자의 실제 답변입니다.", { exact: true })).toBeVisible();
    await other.locator(".post-vote").click();
    await expect(other.locator(".post-vote")).toHaveAttribute("aria-pressed", "true");
    await expect(other.locator(".post-vote")).toContainText("추천 1");
    await other.getByRole("button", { name: "+ 팔로우", exact: true }).click();
    await expect(other.getByRole("button", { name: "✓ 팔로잉", exact: true })).toBeVisible();
    await other.reload();
    await expect(other.locator(".post-vote")).toHaveAttribute("aria-pressed", "true");
    await expect(other.getByRole("button", { name: "✓ 팔로잉", exact: true })).toBeVisible();

    // 목록: 검색으로 이 글만 보고, 답변·추천 수와 팔로잉 표시를 확인한다.
    await other.goto(`/community?q=${encodeURIComponent(title)}`);
    const row = other.locator(`.post-row[href="/community/${id}"]`);
    await expect(row).toContainText("답변 1");
    await expect(row.locator(".post-num-up")).toHaveText("1");
    await expect(row.locator(".post-follow-badge")).toBeVisible();
    await other.goto("/profile");
    await expect(other.getByRole("region", { name: "추천한 글" })).toContainText(title);

    // 작성자: 답변을 채택하고, 글을 고친 뒤 지운다.
    await writer.page.reload();
    await writer.page.getByRole("button", { name: /^답변 1/ }).click();
    await writer.page.getByRole("button", { name: "채택하기", exact: true }).click();
    await expect(writer.page.getByText("채택된 답변", { exact: true })).toBeVisible();
    await writer.page.getByRole("button", { name: "글 관리" }).click();
    await writer.page.getByRole("menuitem", { name: "수정" }).click();
    await writer.page.getByLabel(/^제목/).fill(`${title} 수정`);
    await writer.page.getByRole("button", { name: "수정 저장", exact: true }).click();
    await expect(writer.page.getByRole("heading", { name: `${title} 수정`, exact: true })).toBeVisible();
    writer.page.once("dialog", (dialog) => dialog.accept());
    await writer.page.getByRole("button", { name: "글 관리" }).click();
    await writer.page.getByRole("menuitem", { name: "삭제" }).click();
    await expect(writer.page).toHaveURL(/\/community$/);
    expect((await request.get(`/api/v1/community/posts/${id}`)).status()).toBe(404);
    id = "";
    expect([...writer.errors, ...reader.errors]).toEqual([]);
  } finally {
    if (id)
      await request.delete(`/api/v1/community/posts/${id}`, {
        headers: { Authorization: `Bearer ${writer.session.accessToken}` },
      });
    await writer.context.close();
    await reader.context.close();
  }
});
