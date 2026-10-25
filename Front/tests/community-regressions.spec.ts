import { expect, test, type Page } from "@playwright/test";
import {
  mockCommunityApi,
  session,
  storageKey as sessionKey,
  type SeedPost,
} from "./fixtures";

const postDraftKey = "unsolvable-oj-community-draft-v2:solver:new";
const editDraftKey = "unsolvable-oj-community-draft-v2:solver:edit:my-question";
const answerDraftKey = "unsolvable-oj-community-answer-draft-v2:solver:my-question";
const mine: SeedPost = {
  id: "my-question",
  category: "question",
  title: "내 질문",
  body: "기존 질문 본문입니다.",
  author: "solver",
  createdAt: "2026-10-01T00:00:00Z",
  views: 1,
};
const other: SeedPost = {
  ...mine,
  id: "other",
  title: "다른 질문",
  author: "other",
};

/** 로그인하고 커뮤니티 API를 흉내 낸다. 돌려준 값으로 서버 쪽 글·답변을 확인하거나 요청을 실패시킨다. */
async function seed(
  page: Page,
  posts = [mine, other],
  voted: string[] = [],
  expiresAt = Date.now() + 900_000,
) {
  await page.addInitScript(({ sessionKey, saved }) => {
    if (localStorage.getItem("community-regressions-seeded")) return;
    localStorage.setItem("community-regressions-seeded", "true");
    localStorage.setItem(sessionKey, JSON.stringify(saved));
  }, { sessionKey, saved: { session, expiresAt } });
  return mockCommunityApi(page, {
    posts,
    answers: [{ id: "answer", postId: mine.id, author: "other", body: "기존 답변입니다." }],
    voted,
  });
}

/** 읽기는 두고 쓰기 요청만 실패시킨다(false면 되돌린다). */
const failWrites = (api: Awaited<ReturnType<typeof seed>>, blocked = true) => {
  api.fail = (method) => (blocked && method !== "GET" ? 503 : undefined);
};

const readStored = (page: Page, key: string) => page.evaluate(
  (key) => localStorage.getItem(key),
  key,
);

async function openEditor(page: Page) {
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "수정", exact: true }).click();
}

async function delayPageModule(page: Page, name: string) {
  let release!: () => void;
  let requested!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route(`**/src/pages/${name}.tsx*`, async (route) => {
    requested();
    await pending;
    await route.continue();
  });
  return { ready, release };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/problems") return route.fulfill({
      json: { items: [], page: 1, limit: 100, total: 0, totalPages: 1 },
    });
    return route.fulfill({ status: 404, json: { message: "Not found" } });
  });
});

for (const editing of [false, true]) {
  test(`K13/K15: failed ${editing ? "edit" : "publish"} retains the draft and retries once`, async ({ page }) => {
    const api = await seed(page);
    await page.goto(editing ? "/community/my-question/edit" : "/community/new");
    await page.getByLabel(/^제목/).fill("저장 실패 후 재시도");
    await page.getByLabel(/^본문/).fill("사라지면 안 되는 본문입니다.");
    await page.getByRole("button", { name: "임시 저장", exact: true }).click();
    const key = editing ? editDraftKey : postDraftKey;
    failWrites(api);
    const submit = page.getByRole("button", { name: editing ? "수정 저장" : "글 등록", exact: true });
    await submit.click();
    await expect(page.getByRole("alert")).toContainText("글을 저장하지 못했어요.");
    await expect(submit).toBeEnabled();
    await expect(page.getByLabel(/^제목/)).toHaveValue("저장 실패 후 재시도");
    await expect(page.getByLabel(/^본문/)).toHaveValue("사라지면 안 되는 본문입니다.");
    expect(JSON.parse((await readStored(page, key))!)).toMatchObject({
      title: "저장 실패 후 재시도",
      body: "사라지면 안 되는 본문입니다.",
    });
    expect(api.posts).toHaveLength(2);
    expect(api.posts.find((post) => post.id === "my-question")!.title).toBe(mine.title);
    await expect(page.getByText(/글을 (등록|수정)했어요\./)).toHaveCount(0);

    failWrites(api, false);
    await submit.click();
    await expect(page.getByRole("heading", { name: "저장 실패 후 재시도" })).toBeVisible();
    expect(api.posts.filter((post) => post.title === "저장 실패 후 재시도")).toHaveLength(1);
    expect(await readStored(page, key)).toBeNull();
    await page.goto(editing ? "/community/my-question/edit" : "/community/new");
    await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
    await expect(page.getByLabel(/^제목/)).toHaveValue(editing ? "저장 실패 후 재시도" : "");
  });
}

for (const editing of [false, true]) {
  test(`K13/K15: completed ${editing ? "edit" : "publish"} stays locked during lazy navigation`, async ({ page }) => {
    await page.clock.install();
    const api = await seed(page);
    const destination = await delayPageModule(page, "CommunityPostPage");
    try {
      await page.goto(editing ? "/community/my-question/edit" : "/community/new");
      await expect(page.getByLabel(/^제목/)).toBeVisible();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
      await page.getByLabel(/^제목/).fill("완료 후 다시 등록하면 안 되는 글");
      await page.getByLabel(/^본문/).fill("완료한 폼에서 다시 저장하면 안 되는 본문");
      await page.getByRole("button", { name: editing ? "수정 저장" : "글 등록", exact: true }).click();
      await destination.ready;
      await expect(page.locator(".write-form")).toBeVisible();
      await expect(page.getByRole("button", { name: editing ? "저장 중…" : "등록 중…", exact: true })).toBeDisabled();
      const key = editing ? editDraftKey : postDraftKey;
      expect(await readStored(page, key)).toBeNull();
      await page.clock.runFor(1_500);
      expect(await readStored(page, key)).toBeNull();
      await page.getByRole("button", { name: "임시 저장", exact: true }).click();
      await page.locator(".write-form").evaluate((form: HTMLFormElement) => {
        form.requestSubmit();
        form.requestSubmit();
      });
      await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
      expect(await readStored(page, key)).toBeNull();
      expect(api.posts.filter((post) => post.title === "완료 후 다시 등록하면 안 되는 글")).toHaveLength(1);
      await page.clock.resume();
      destination.release();
      await expect(page.getByRole("heading", { name: "완료 후 다시 등록하면 안 되는 글" })).toBeVisible();
      expect(await readStored(page, key)).toBeNull();
    } finally {
      destination.release();
    }
  });
}

test("K15: explicit discard cannot autosave or submit while its lazy destination is pending", async ({ page }) => {
  await page.clock.install();
  const api = await seed(page);
  const destination = await delayPageModule(page, "CommunityPage");
  try {
    await page.goto("/community/new");
    await expect(page.getByLabel(/^제목/)).toBeVisible();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
    await page.getByLabel(/^제목/).fill("버린 초안");
    await page.getByLabel(/^본문/).fill("버린 초안 본문입니다.");
    await page.getByRole("button", { name: "임시 저장", exact: true }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await destination.ready;
    await expect(page.locator(".write-form")).toBeVisible();
    expect(await readStored(page, postDraftKey)).toBeNull();
    await page.clock.runFor(1_500);
    await page.getByRole("button", { name: "임시 저장", exact: true }).click();
    await page.locator(".write-form").evaluate((form: HTMLFormElement) => form.requestSubmit());
    await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
    expect(await readStored(page, postDraftKey)).toBeNull();
    expect(api.posts).toHaveLength(2);
    await page.clock.resume();
    destination.release();
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.locator(".write-form")).toHaveCount(0);
    expect(await readStored(page, postDraftKey)).toBeNull();
  } finally {
    destination.release();
  }
});

test("K13: failed answer publication keeps the durable draft and creates no phantom answer", async ({ page }) => {
  const api = await seed(page);
  await page.goto("/community/my-question");
  await page.getByLabel("답변 내용").fill("다시 등록할 답변 내용입니다.");
  failWrites(api);
  await page.getByRole("button", { name: "답변 등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("답변을 저장하지 못했어요.");
  await expect(page.getByLabel("답변 내용")).toHaveValue("다시 등록할 답변 내용입니다.");
  expect(await readStored(page, answerDraftKey)).toBe("다시 등록할 답변 내용입니다.");
  expect(api.answers).toHaveLength(1);
  await expect(page.getByText("답변을 등록했어요.")).toHaveCount(0);
  failWrites(api, false);
  await page.getByRole("button", { name: "답변 등록", exact: true }).click();
  await expect(page.getByText("답변을 등록했어요.")).toBeVisible();
  await expect(page.getByLabel("답변 내용")).toHaveValue("");
  expect(api.answers).toHaveLength(2);
  expect(await readStored(page, answerDraftKey)).toBeNull();
});

test("K13: vote, follow, answer vote and acceptance failures show errors without changing activity", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const api = await seed(page);
  await page.goto("/community/other");
  await expect(page.locator(".post-vote")).toBeVisible();
  failWrites(api);
  await page.locator(".post-vote").click();
  await expect(page.getByRole("alert")).toContainText("저장하지 못했어요.");
  await expect(page.locator(".post-vote")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "+ 팔로우", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ 팔로우", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect([...api.voted, ...api.following]).toEqual([]);

  await page.goto("/community/my-question");
  await page.getByRole("button", { name: "답변 1", exact: true }).click();
  await page.locator(".answer-vote").click();
  await expect(page.locator(".answer-vote")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "채택하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("변경 내용을 저장하지 못했어요.");
  await expect(page.getByText("채택 완료", { exact: true })).toHaveCount(0);
  expect([...api.voted, ...api.following]).toEqual([]);
  expect(api.posts.find((post) => post.id === "my-question")!.accepted).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("K13: failed deletion stays on the post and does not clear answer or edit drafts", async ({ page }) => {
  const api = await seed(page);
  await page.goto("/community/my-question");
  await page.getByLabel("답변 내용").fill("삭제 실패에도 유지할 답변입니다.");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    category: "question", title: "수정 초안", body: "초안 본문", tags: [], savedAt: Date.now(),
  })), editDraftKey);
  failWrites(api);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/community\/my-question$/);
  await expect(page.getByRole("alert")).toContainText("글을 삭제하지 못했어요.");
  expect(api.posts).toHaveLength(2);
  expect(await readStored(page, answerDraftKey)).toBe("삭제 실패에도 유지할 답변입니다.");
  expect(JSON.parse((await readStored(page, editDraftKey))!).title).toBe("수정 초안");

  failWrites(api, false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  expect(api.posts.map((post) => post.id)).not.toContain("my-question");
  expect(await readStored(page, answerDraftKey)).toBeNull();
  expect(await readStored(page, editDraftKey)).toBeNull();
});

test("a notice passed on navigation shows once and does not return on reload or Back/Forward", async ({ page }) => {
  await seed(page);
  await page.goto("/community/my-question");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  const notice = page.getByRole("status").filter({ hasText: "글을 삭제했어요." });
  await expect(notice).toBeVisible();
  // 안내는 4초 뒤 저절로 사라지므로, 목록이 그려진 그 순간에 바로 센다(재시도하지 않음).
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "게시글 검색" })).toBeVisible();
  expect(await notice.count()).toBe(0);
  await page.goBack();
  await page.goForward();
  await expect(page.getByRole("searchbox", { name: "게시글 검색" })).toBeVisible();
  expect(await notice.count()).toBe(0);
});

test("the collapsed answers toggle controls the answer list only while it is rendered", async ({ page }) => {
  await seed(page);
  await page.goto("/community/my-question");
  const toggle = page.getByRole("button", { name: /^답변 1/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).not.toHaveAttribute("aria-controls", /.*/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-controls", "answer-list");
  await expect(page.locator("#answer-list")).toBeVisible();
});

test("the profile post scroller pages through the posts I upvoted", async ({ page }) => {
  const posts = [1, 2, 3, 4].map((n) => ({ ...other, id: `liked-${n}`, title: `추천 글 ${n}` }));
  await seed(page, posts, posts.map((post) => post.id));
  await page.route("**/api/v1/users/me", (route) => route.fulfill({
    json: { ...session.user, solvedCount: 0, createdAt: "2026-09-01T00:00:00Z" },
  }));
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/submissions?**", (route) => route.fulfill({
    json: { items: [], page: 1, limit: 100, total: 0, totalPages: 1 },
  }));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/profile");
  const scroller = page.getByRole("region", { name: "추천한 글" });
  const count = scroller.locator(".scroller-count");
  await expect(count).toHaveText("1–2 / 4");
  await scroller.getByRole("button", { name: "다음 글" }).click();
  await expect(count).toHaveText("2–3 / 4");
  await scroller.getByRole("button", { name: "다음 글" }).click();
  await expect(count).toHaveText("3–4 / 4");
  await expect(scroller.getByRole("button", { name: "다음 글" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "작성한 글" })).toContainText(
    "아직 작성한 글이 없어요.",
  );
});

test("K11: draft helpers isolate owners and posts, preserve ownerless legacy data and keep public posts shared", async ({ page }) => {
  await seed(page);
  await page.goto("/community");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/community/store.ts";
    const store = await import(modulePath);
    const legacyPost = JSON.stringify({ category: "question", title: "누군가의 비공개 초안", body: "비공개", tags: [], savedAt: 1 });
    const legacyAnswerKey = "unsolvable-oj-community-answer-draft-v1:mine";
    localStorage.setItem("unsolvable-oj-community-draft-v1", legacyPost);
    localStorage.setItem(legacyAnswerKey, "누군가의 비공개 답변");
    const before = [store.readDraft("owner:a"), store.readAnswerDraft("owner:a", "mine")];
    const draft = { category: "question", title: "계정 A 초안", body: "A 본문", tags: [], savedAt: 2 };
    store.writeDraft("owner:a", draft);
    store.writeDraft("owner:a", { ...draft, title: "A 수정" }, "mine");
    store.writeAnswerDraft("owner:a", "mine", "A 답변 초안");
    store.writeDraft("owner:b", { ...draft, title: "계정 B 초안" });
    store.writeAnswerDraft("owner:b", "mine", "B 답변 초안");
    return {
      before,
      a: store.readDraft("owner:a"),
      b: store.readDraft("owner:b"),
      edit: store.readDraft("owner:a", "mine"),
      otherPost: store.readDraft("owner:a", "other"),
      otherOwnerEdit: store.readDraft("owner:b", "mine"),
      answers: [store.readAnswerDraft("owner:a", "mine"), store.readAnswerDraft("owner:b", "mine"), store.readAnswerDraft("owner:a", "other")],
      legacy: [localStorage.getItem("unsolvable-oj-community-draft-v1"), localStorage.getItem(legacyAnswerKey)],
      legacyPost,
    };
  });
  expect(result.before).toEqual([null, ""]);
  expect(result.a.title).toBe("계정 A 초안");
  expect(result.b.title).toBe("계정 B 초안");
  expect(result.edit.title).toBe("A 수정");
  expect(result.otherPost).toBeNull();
  expect(result.otherOwnerEdit).toBeNull();
  expect(result.answers).toEqual(["A 답변 초안", "B 답변 초안", ""]);
  expect(result.legacy).toEqual([result.legacyPost, "누군가의 비공개 답변"]);

  await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
    key: sessionKey,
    saved: { session: { ...session, user: { ...session.user, id: "second", username: "second" } }, expiresAt: Date.now() + 900_000 },
  });
  await page.reload();
  await expect(page.locator(".post-title")).toHaveCount(2);
  await page.goto("/community/new");
  await expect(page.getByLabel(/^제목/)).toHaveValue("");
  await page.goto("/community/my-question");
  await expect(page.getByLabel("답변 내용")).toHaveValue("");
});

test("K15: SPA navigation can be rejected, accepted navigation recovers edits, explicit discard does not restore them", async ({ page }) => {
  await seed(page);
  await page.goto("/community/my-question/edit");
  await page.getByLabel(/^제목/).fill("가장 최근 수정 제목");
  await page.getByLabel(/^본문/).fill("가장 최근 수정 본문");
  await page.locator("#tag-input").fill("아직 확정하지 않은 태그");
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
    page.locator(".write-page .back-link").click(),
  ]);
  await expect(page).toHaveURL(/\/community\/my-question\/edit$/);
  await expect(page.getByLabel(/^제목/)).toHaveValue("가장 최근 수정 제목");

  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.locator(".write-page .back-link").click(),
  ]);
  await expect(page).toHaveURL(/\/community\/my-question$/);
  await openEditor(page);
  await expect(page.getByLabel(/^제목/)).toHaveValue("가장 최근 수정 제목");
  await expect(page.getByLabel(/^본문/)).toHaveValue("가장 최근 수정 본문");
  await expect(page.locator(".tag-chip")).toContainText("아직 확정하지 않은 태그");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/\/community\/my-question$/);
  expect(await readStored(page, editDraftKey)).toBeNull();
  await openEditor(page);
  await expect(page.getByLabel(/^제목/)).toHaveValue(mine.title);
  await expect(page.getByLabel(/^본문/)).toHaveValue(mine.body!);
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
});

test("K15: session expiry preserves the latest edit before the autosave delay", async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await seed(page, [mine, other], [], now + 60_000);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ json: session }));
  await page.goto("/community/my-question/edit");
  await expect(page.getByLabel(/^제목/)).toBeVisible();
  await page.clock.pauseAt(now + 59_000);
  await page.getByLabel(/^제목/).fill("만료 직전 제목");
  await page.getByLabel(/^본문/).fill("만료 직전 본문");
  await page.clock.runFor(1_001);
  expect(JSON.parse((await readStored(page, editDraftKey))!)).toMatchObject({ title: "만료 직전 제목", body: "만료 직전 본문" });
  await page.clock.resume();
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/community\/my-question\/edit$/);
  await expect(page.getByLabel(/^제목/)).toHaveValue("만료 직전 제목");
  await expect(page.getByLabel(/^본문/)).toHaveValue("만료 직전 본문");
});

test("K18: debounced community search rebases onto the latest filters and sort", async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await page.goto("/community?t=dp&future=keep&page=2");
  await page.getByRole("searchbox", { name: "게시글 검색" }).fill("질문");
  await page.getByRole("group", { name: "분류 필터" }).getByRole("button", { name: /^자유/ }).click();
  await page.getByRole("group", { name: "채택 상태 필터" }).getByRole("button", { name: /^채택 완료/ }).click();
  await page.getByRole("combobox", { name: "정렬", exact: true }).click();
  await page.getByRole("option", { name: "조회순", exact: true }).click();
  await page.clock.runFor(300);
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toEqual({ t: "dp", future: "keep", c: "free", s: "accepted", sort: "views", q: "질문" });
});

test("community search keeps the space typed before a pause", async ({ page }) => {
  await page.clock.install();
  await seed(page);
  await page.goto("/community");
  const search = page.getByRole("searchbox", { name: "게시글 검색" });
  await search.fill("two ");
  await page.clock.runFor(300);
  await expect(page).toHaveURL(/q=two/);
  await search.press("End");
  await page.keyboard.type("sum");
  await page.clock.runFor(300);
  await expect(search).toHaveValue("two sum");
  expect(new URL(page.url()).searchParams.get("q")).toBe("two sum");
});

test("K31: vote ordering uses the displayed count and still puts pinned notices first", async ({ page }) => {
  await seed(page, [
    { ...mine, upvotes: 5 },
    { ...other, upvotes: 5 },
    { ...mine, id: "notice", title: "고정 공지", category: "notice" },
  ], [other.id]);
  await page.goto("/community?sort=votes");
  await expect(page.locator(".post-title")).toHaveText(["고정 공지", "다른 질문", "내 질문"]);
  await expect(page.locator('.post-row[href="/community/other"] .post-num-up')).toContainText("6");
});

test("K32: comma and space tags round-trip through publishing, tag links, filters and reloads", async ({ page }) => {
  const api = await seed(page);
  await page.goto("/community/new");
  await page.getByLabel(/^제목/).fill("복합 태그 질문");
  await page.getByLabel(/^본문/).fill("쉼표와 공백이 있는 태그입니다.");
  await page.locator("#tag-input").fill("a,b");
  await page.locator("#tag-input").press("Enter");
  await page.locator("#tag-input").fill("dynamic programming");
  await page.locator("#tag-input").press("Enter");
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "복합 태그 질문" })).toBeVisible();
  expect(api.posts.find((post) => post.title === "복합 태그 질문")!.tags).toEqual(["a,b", "dynamic programming"]);
  await page.locator(".post-tags").getByRole("link", { name: "#a,b", exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("tag")).toEqual(["a,b"]);
  await expect(page.locator(".post-title")).toHaveText(["복합 태그 질문"]);
  await page.getByRole("searchbox", { name: "게시글 검색" }).fill("#dynamic programming");
  await page.getByRole("searchbox", { name: "게시글 검색" }).press("Enter");
  expect(new URL(page.url()).searchParams.getAll("tag")).toEqual(["a,b", "dynamic programming"]);
  await page.reload();
  await expect(page.locator(".search-tag")).toHaveText(["#a,b", "#dynamic programming"]);
  await expect(page.locator(".post-title")).toHaveText(["복합 태그 질문"]);
});

test("K32: old t=a,b links retain list semantics and unusual published tags are not rewritten", async ({ page }) => {
  const unusual = "C#,C++/100% & more";
  const api = await seed(page, [
    { ...mine, tags: ["a", "b", unusual] },
    { ...other, tags: ["a,b"] },
  ]);
  await page.goto("/community?t=a%2Cb");
  await expect(page.locator(".post-title")).toHaveText([mine.title]);
  await page.getByRole("link", { name: /내 질문/ }).click();
  await openEditor(page);
  await page.getByLabel(/^제목/).fill("태그 보존 수정");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "태그 보존 수정" })).toBeVisible();
  expect(api.posts.find((post) => post.id === mine.id)!.tags).toEqual(["a", "b", unusual]);
  await page.locator(".post-tags").getByRole("link", { name: `#${unusual}`, exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("tag")).toEqual([unusual]);
  await expect(page.locator(".post-title")).toHaveText(["태그 보존 수정"]);
});

test("relative time never reads 0년 전 for posts 360–364 days old", async ({ page }) => {
  await page.goto("/community");
  const labels = await page.evaluate(async () => {
    const modulePath = "/src/community/store.ts";
    const { relativeTime } = await import(modulePath);
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    return [359, 362, 365].map((days) => relativeTime(daysAgo(days)));
  });
  expect(labels).toEqual(["11개월 전", "1년 전", "1년 전"]);
});
