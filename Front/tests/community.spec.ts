import { test, expect, type Page } from "@playwright/test";

const uid = "aaee46eb-c931-461e-9f31-fbe4a7a1d641";
const pid = "e611dc17-5e63-4385-a496-a71db37aa7d0";
const post = {
  id: pid,
  authorId: uid,
  author: { id: uid, username: "writer", level: 2 },
  category: "QUESTION",
  title: "연결 테스트 질문",
  body: "질문 본문",
  tags: ["알고리즘"],
  views: 3,
  code: "",
  language: "",
  problem: null,
  problemId: null,
  acceptedCommentId: null,
  voteCount: 0,
  commentCount: 0,
  createdAt: "2026-10-06T09:00:00Z",
};
async function login(page: Page) {
  await page.addInitScript(
    ({ uid }) =>
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({
          expiresAt: Date.now() + 900000,
          session: {
            accessToken: "mock-token",
            expiresIn: "15m",
            tokenType: "Bearer",
            user: { id: uid, username: "writer", role: "USER", level: 2 },
          },
        }),
      ),
    { uid },
  );
}
test("teammate layout: filter/search/sort requests, loading failure and retry", async ({
  page,
}) => {
  let query = "";
  let fail = true;
  await page.route("**/api/v1/community/posts?**", (r) => {
    query = r.request().url();
    return fail
      ? r.fulfill({ status: 503, json: { message: "연결 재시도 테스트" } })
      : r.fulfill({
          json: { items: [post], total: 1, totalPages: 1, page: 1 },
        });
  });
  await page.goto("/community");
  await expect(page.getByRole("alert")).toContainText("연결 재시도 테스트");
  fail = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByText(post.title)).toBeVisible();
  await expect(page.getByText("좋은 질문은")).toBeVisible();
  await page.getByRole("button", { name: "코드 리뷰", exact: true }).click();
  await expect.poll(() => query).toContain("category=REVIEW");
  await page.getByLabel("커뮤니티 검색").fill("태그검색");
  await expect.poll(() => decodeURIComponent(query)).toContain("q=태그검색");
  await page.getByLabel("정렬", { exact: true }).selectOption("votes");
  await expect.poll(() => query).toContain("sort=votes");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("review draft survives reload; failure preserves text; successful create and edit persist code/tags", async ({
  page,
}) => {
  test.setTimeout(60000);
  await login(page);
  let fail = true;
  let current = { ...post };
  await page.route("**/api/v1/community/posts**", async (r) => {
    const url = new URL(r.request().url()),
      method = r.request().method();
    if (url.pathname.endsWith("/interaction"))
      return r.fulfill({
        json: {
          voted: false,
          saved: false,
          following: false,
          commentVotes: [],
        },
      });
    if (url.pathname.endsWith("/author-stats"))
      return r.fulfill({ json: { posts: 1, acceptedAnswers: 0 } });
    if (url.pathname.endsWith("/comments"))
      return r.fulfill({
        json: { items: [], total: 0, totalPages: 0, page: 1 },
      });
    if (url.pathname.endsWith("/view")) return r.fulfill({ json: current });
    if (method === "POST" || method === "PUT") {
      if (fail)
        return r.fulfill({
          status: 503,
          json: { message: "저장 실패 테스트" },
        });
      const input = r.request().postDataJSON();
      expect(input.tags).toEqual(["최적화"]);
      expect(input.code).toBe("print(1)");
      current = { ...current, ...input };
      return r.fulfill({
        status: method === "POST" ? 201 : 200,
        json: current,
      });
    }
    return r.fulfill({
      json: url.pathname.endsWith(pid)
        ? current
        : { items: [], total: 0, totalPages: 0, page: 1 },
    });
  });
  await page.goto("/community/new?c=review");
  await page.getByLabel("제목 · 필수").fill("코드 리뷰 요청");
  await page.getByLabel("본문 · 필수").fill("시간 복잡도 개선 부탁드립니다.");
  await page.getByLabel("코드 언어 · 필수").fill("Python");
  await page.getByLabel("공유할 코드 · 필수").fill("print(1)");
  await page.getByLabel("태그", { exact: true }).fill("최적화");
  await page.getByLabel("태그", { exact: true }).press("Enter");
  await page.reload();
  await expect(page.getByLabel("공유할 코드 · 필수")).toHaveValue("print(1)");
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장 실패 테스트");
  await expect(page.getByLabel("제목 · 필수")).toHaveValue("코드 리뷰 요청");
  fail = false;
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "코드 리뷰 요청", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("print(1)", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "글 수정", exact: true }).click();
  await expect(page.getByLabel("제목 · 필수")).toHaveValue("코드 리뷰 요청");
  await page.getByLabel("제목 · 필수").fill("수정된 리뷰");
  await page.getByRole("button", { name: "수정 완료" }).click();
  await expect(
    page.getByRole("heading", { name: "수정된 리뷰" }),
  ).toBeVisible();
});

test("solution spoiler, escaped HTML and anonymous permissions", async ({
  page,
}) => {
  await page.route("**/api/v1/community/posts**", (r) => {
    const path = new URL(r.request().url()).pathname;
    if (path.endsWith("/author-stats"))
      return r.fulfill({ json: { posts: 1, acceptedAnswers: 0 } });
    if (path.endsWith("/comments"))
      return r.fulfill({
        json: { items: [], total: 0, page: 1, totalPages: 0 },
      });
    if (path.endsWith("/posts"))
      return r.fulfill({
        json: { items: [], total: 0, page: 1, totalPages: 0 },
      });
    return r.fulfill({
      json: {
        ...post,
        category: "SOLUTION",
        body: "핵심 풀이\n\n<script>window.hacked=true</script>",
        code: "<script>alert(1)</script>",
      },
    });
  });
  await page.goto("/community/" + pid);
  await page.getByText("풀이 스포일러 펼치기").waitFor();
  await expect(page.getByText("핵심 풀이", { exact: true })).not.toBeVisible();
  await page.getByText("풀이 스포일러 펼치기").click();
  await expect(page.getByText("핵심 풀이", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => "hacked" in window)).toBe(false);
  await expect(page.getByRole("link", { name: "글 수정" })).toHaveCount(0);
  await page.getByRole("button", { name: "▲ 추천 0" }).click();
  await expect(page).toHaveURL(/\/auth/);
});
