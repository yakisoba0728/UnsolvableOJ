import { expect, test } from "@playwright/test";
import {
  authenticate,
  mockCommunityApi,
  mockNotificationsApi,
} from "./fixtures";

test.describe("community reports and hidden content", () => {
  test("a post and an answer are reported once each through the dialog", async ({ page }) => {
    await authenticate(page);
    await mockNotificationsApi(page);
    const api = await mockCommunityApi(page, {
      posts: [{ id: "q-1", category: "question", title: "남의 질문", author: "other" }],
      answers: [{ id: "a-1", postId: "q-1", author: "other", body: "남의 답변입니다." }],
    });
    await page.goto("/community/q-1");
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "신고" }).click();
    const dialog = page.getByRole("dialog", { name: "글 신고" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("신고 사유")).toBeFocused();
    await dialog.getByRole("button", { name: "신고하기" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("신고 사유를 입력해 주세요.");
    await dialog.getByLabel("신고 사유").fill("광고 글입니다.");
    await dialog.getByRole("button", { name: "신고하기" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("status").filter({ hasText: "신고를 접수했어요" })).toBeVisible();
    expect(api.reports).toEqual([{ target: "q-1", reason: "광고 글입니다." }]);

    // 같은 글을 다시 신고하면 서버의 409를 안내하고 창을 열어 둔다.
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "신고" }).click();
    await dialog.getByLabel("신고 사유").fill("다시 신고");
    await dialog.getByRole("button", { name: "신고하기" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("이미 신고한 글이에요.");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.locator("#a-1").getByRole("button", { name: "답변 관리" }).click();
    await page.getByRole("menuitem", { name: "신고" }).click();
    const answerDialog = page.getByRole("dialog", { name: "답변 신고" });
    await answerDialog.getByLabel("신고 사유").fill("욕설이 있어요.");
    await answerDialog.getByRole("button", { name: "신고하기" }).click();
    await expect(answerDialog).toBeHidden();
    expect(api.reports.at(-1)).toEqual({ target: "a-1", reason: "욕설이 있어요." });
  });

  test("the author sees a hidden post and answer marked, and cannot vote on their own content", async ({ page }) => {
    await authenticate(page);
    await mockNotificationsApi(page);
    await mockCommunityApi(page, {
      posts: [{ id: "my-hidden", category: "question", title: "숨겨진 내 질문", hidden: true }],
      answers: [{ id: "my-answer", postId: "my-hidden", body: "숨겨진 내 답변", hidden: true }],
    });
    await page.goto("/community/my-hidden");
    await expect(page.getByText("관리자가 숨긴 글이에요.")).toBeVisible();
    await expect(page.locator("#my-answer .answer-hidden")).toHaveText("관리자가 숨긴 답변");
    await expect(page.locator(".post-vote")).toBeDisabled();
    await expect(page.locator("#my-answer .answer-vote")).toBeDisabled();
    // 내 글 메뉴에는 신고가 없다.
    await page.getByRole("button", { name: "글 관리" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["수정", "삭제"]);
  });
});

test("the following filter asks the server for followed authors only and shows follower counts", async ({ page }) => {
  await authenticate(page);
  await mockNotificationsApi(page);
  const api = await mockCommunityApi(page, {
    posts: [
      { id: "alice-post", title: "앨리스의 글", author: "alice" },
      { id: "bob-post", title: "밥의 글", author: "bob" },
    ],
    following: ["alice"],
  });
  await page.goto("/community");
  await expect(page.getByText("밥의 글")).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "작성자 필터" })
    .getByRole("radio", { name: "팔로잉" })
    .click();
  await expect(page).toHaveURL(/following=1/);
  await expect(page.getByText("밥의 글")).toHaveCount(0);
  await expect(page.getByText("앨리스의 글")).toBeVisible();
  const last = api.requests.filter((request) => request.path.startsWith("?")).at(-1);
  expect(last?.path).toContain("following=true");

  await page.getByText("앨리스의 글").click();
  await expect(page.locator(".post-author-text")).toContainText("팔로워 1 · 팔로잉 0");
});

test("signed-out visitors do not see the following filter or the bell", async ({ page }) => {
  await mockCommunityApi(page, { posts: [{ id: "p", title: "공개 글", author: "alice" }] });
  await page.goto("/community");
  await expect(page.getByText("공개 글")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "작성자 필터" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^알림/ })).toHaveCount(0);
});

test.describe("notification bell", () => {
  test("shows the unread badge, lists notifications with links and marks them read", async ({ page }) => {
    await authenticate(page);
    await mockCommunityApi(page, { posts: [{ id: "q-1", title: "내 질문" }] });
    const api = await mockNotificationsApi(page, [
      { id: "n-1", type: "ANSWER", actor: "alice", post: { id: "q-1", title: "내 질문" } },
      { id: "n-2", type: "JUDGED", submission: { id: "s-1", status: "ACCEPTED", problemTitle: "두 수의 합" } },
      { id: "n-3", type: "ACCEPTED", actor: "bob", post: { id: "q-9", title: "남의 질문" }, read: true },
    ]);
    await page.goto("/community");
    const bell = page.getByRole("button", { name: "알림, 안 읽음 2개" });
    await expect(bell.locator(".notification-badge")).toHaveText("2");
    await bell.click();
    const panel = page.getByRole("region", { name: "알림" });
    const links = panel.getByRole("link");
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toContainText("alice님이 내 글에 답변했어요 · 내 질문");
    await expect(links.nth(1)).toContainText("“두 수의 합” 채점 결과: 성공");
    await expect(links.nth(1)).toHaveAttribute("href", "/submissions/s-1");
    await expect(links.nth(2)).toContainText("bob님이 내 답변을 채택했어요");

    await links.nth(0).click();
    await expect(page).toHaveURL(/\/community\/q-1$/);
    await expect.poll(() => api.requests).toContain("PUT /n-1/read");
    await expect(page.getByRole("button", { name: "알림, 안 읽음 1개" })).toBeVisible();

    await page.getByRole("button", { name: "알림, 안 읽음 1개" }).click();
    await panel.getByRole("button", { name: "모두 읽음" }).click();
    await expect(page.getByRole("button", { name: "알림", exact: true })).toBeVisible();
    expect(api.requests).toContain("PUT /read-all");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("polls the unread count every minute only while the tab is visible", async ({ page }) => {
    await page.clock.install();
    await authenticate(page);
    await mockCommunityApi(page);
    const api = await mockNotificationsApi(page);
    const polls = () => api.requests.filter((request) => request === "GET /unread-count").length;
    await page.goto("/community");
    // 개발 모드(StrictMode)는 처음 효과를 두 번 실행하므로 첫 확인 횟수를 기준으로 센다.
    await expect.poll(polls).toBeGreaterThan(0);
    await page.clock.fastForward(1_000);
    const start = polls();
    await page.clock.fastForward(30_000);
    expect(polls()).toBe(start);
    await page.clock.fastForward(30_000);
    await expect.poll(polls).toBe(start + 1);

    const setHidden = (hidden: boolean) =>
      page.evaluate((hidden) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
    await setHidden(true);
    await page.clock.fastForward(180_000);
    expect(polls()).toBe(start + 1);
    // 탭으로 돌아오면 바로 한 번 확인하고 다시 1분 주기로 돈다.
    await setHidden(false);
    await expect.poll(polls).toBe(start + 2);
    await page.clock.fastForward(60_000);
    await expect.poll(polls).toBe(start + 3);
  });
});
