import { test, expect } from "@playwright/test";

// Run against an isolated, migrated PostgreSQL/Redis-backed API only.
// COMMUNITY_TEST_API=http://127.0.0.1:3108/api/v1; VITE_API_BASE_URL must match.
test("real API: two users create, answer, accept, vote, save, follow, edit and delete", async ({
  page,
  browser,
  request,
}) => {
  const api = process.env.COMMUNITY_TEST_API;
  test.skip(!api, "Set COMMUNITY_TEST_API for the isolated full-stack test");
  test.setTimeout(90000);
  const register = async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const res = await request.post(api + "/auth/register", {
      data: {
        email: `community-browser-${suffix}@example.com`,
        username: `cb_${suffix}`,
        password: "community-test-password",
      },
    });
    expect(res.status()).toBe(201);
    return res.json();
  };
  const writer = await register(),
    reader = await register();
  await page.addInitScript(
    (session) =>
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({ session, expiresAt: Date.now() + 900000 }),
      ),
    writer,
  );
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.addInitScript(
    (session) =>
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({ session, expiresAt: Date.now() + 900000 }),
      ),
    reader,
  );
  const title = "실제 DB 커뮤니티 " + crypto.randomUUID();
  let id = "";
  try {
    await page.goto("/community/new");
    await page.getByLabel("제목 · 필수").fill(title);
    await page.getByLabel("본문 · 필수").fill("서버에 저장되는 질문입니다.");
    await page.getByRole("button", { name: "글 등록", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    id = new URL(page.url()).pathname.split("/").pop()!;
    await other.goto(page.url());
    await expect(other.getByRole("button", { name: "글 삭제" })).toHaveCount(0);
    await other
      .getByLabel("답변 내용", { exact: true })
      .fill("다른 사용자의 실제 답변");
    await other.reload();
    await expect(other.getByLabel("답변 내용", { exact: true })).toHaveValue(
      "다른 사용자의 실제 답변",
    );
    await other.getByRole("button", { name: "답변 등록", exact: true }).click();
    await expect(
      other.getByText("다른 사용자의 실제 답변", { exact: true }),
    ).toBeVisible();
    await other.getByRole("button", { name: "▲ 추천 0" }).click();
    await expect(
      other.getByRole("button", { name: "▲ 추천 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    await other.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "저장됨", exact: true }),
    ).toBeVisible();
    await other.getByRole("button", { name: "+ 팔로우", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "✓ 팔로잉", exact: true }),
    ).toBeVisible();
    await other.reload();
    await expect(
      other.getByRole("button", { name: "저장됨", exact: true }),
    ).toBeVisible();
    await expect(
      other.getByRole("button", { name: "✓ 팔로잉", exact: true }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "채택하기", exact: true }).click();
    await expect(page.getByText("채택된 답변", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "test-results/community-live-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "다크 모드", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({
      path: "test-results/community-live-dark.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/community-live-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "▲ 0", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "▲ 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await other.reload();
    await expect(other.getByText("채택된 답변", { exact: true })).toBeVisible();
    await other.getByRole("button", { name: "답변 수정", exact: true }).click();
    await other.getByLabel("답변 수정 내용").fill("수정된 실제 답변");
    await other.getByRole("button", { name: "수정 저장", exact: true }).click();
    await expect(
      other.getByText("수정된 실제 답변", { exact: true }),
    ).toBeVisible();
    other.on("dialog", (d) => d.accept());
    await other.getByRole("button", { name: "답변 삭제", exact: true }).click();
    await expect(
      other.getByText("아직 답변이 없어요. 첫 답변을 남겨 보세요."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByText("채택된 답변", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "글 수정", exact: true }).click();
    await page.getByLabel("제목 · 필수").fill(title + " 수정");
    await page.getByRole("button", { name: "수정 완료" }).click();
    await expect(
      page.getByRole("heading", { name: title + " 수정", exact: true }),
    ).toBeVisible();
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "글 삭제", exact: true }).click();
    await expect(page).toHaveURL(/\/community$/);
    expect((await request.get(api + "/community/posts/" + id)).status()).toBe(
      404,
    );
  } finally {
    if (id)
      await request.delete(api + "/community/posts/" + id, {
        headers: { Authorization: "Bearer " + writer.accessToken },
      });
    await context.close();
  }
});
