import { expect, test, type Page } from "@playwright/test";
import type { CommunityAnswer, CommunityPost } from "../src/community/types";
import type { Session } from "../src/types";

const activityKey = "unsolvable-oj-community-v1";
const sessionKey = "unsolvable-oj-session-v1";
const postDraftKey = "unsolvable-oj-community-draft-v2:solver:new";
const editDraftKey = "unsolvable-oj-community-draft-v2:solver:edit:mine";
const answerDraftKey = "unsolvable-oj-community-answer-draft-v2:solver:mine";
const session: Session = {
  accessToken: "community-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: {
    id: "solver",
    username: "solver",
    email: "solver@example.com",
    role: "USER",
    level: 1,
    xp: 0,
    rating: 0,
  },
};
const mine: CommunityPost = {
  id: "mine",
  category: "question",
  title: "내 질문",
  body: "기존 질문 본문입니다.",
  tags: [],
  author: { name: "solver", tier: "Bronze I" },
  createdAt: "2026-10-01T00:00:00Z",
  upvotes: 0,
  views: 1,
};
const other: CommunityPost = {
  ...mine,
  id: "other",
  title: "다른 질문",
  author: { name: "other", tier: "Bronze I" },
};
const answer: CommunityAnswer = {
  id: "answer",
  postId: mine.id,
  author: other.author,
  body: "기존 답변입니다.",
  createdAt: "2026-10-02T00:00:00Z",
  upvotes: 0,
};

async function seed(
  page: Page,
  posts = [mine, other],
  upvoted: string[] = [],
  expiresAt = Date.now() + 900_000,
) {
  await page.addInitScript(({ activityKey, sessionKey, activity, saved }) => {
    if (localStorage.getItem("community-regressions-seeded")) return;
    localStorage.setItem("community-regressions-seeded", "true");
    localStorage.setItem(activityKey, JSON.stringify(activity));
    localStorage.setItem(sessionKey, JSON.stringify(saved));
  }, {
    activityKey,
    sessionKey,
    activity: {
      posts,
      answers: [answer],
      upvoted,
      saved: [],
      followed: [],
      accepted: {},
      deleted: [],
    },
    saved: { session, expiresAt },
  });
}

async function failPersistence(page: Page, blocked = true) {
  await page.evaluate(({ key, blocked }) => {
    const target = window as Window & {
      communityOriginalSetItem?: Storage["setItem"];
    };
    target.communityOriginalSetItem ??= Storage.prototype.setItem;
    const original = target.communityOriginalSetItem;
    Storage.prototype.setItem = blocked
      ? function (this: Storage, name: string, value: string) {
          if (name === key) throw new DOMException("Full", "QuotaExceededError");
          original.call(this, name, value);
        }
      : original;
  }, { key: activityKey, blocked });
}

const readActivity = (page: Page) => page.evaluate(
  (key) => JSON.parse(localStorage.getItem(key)!),
  activityKey,
);
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

test("K12: resubscribing after another tab publishes preserves the new post", async ({ page, context }) => {
  await seed(page);
  await page.goto("/community");
  await expect(page.locator(".post-title")).toHaveCount(2);
  await page.locator('.main-nav a[href="/problems"]').click();
  await expect(page).toHaveURL(/\/problems$/);

  const second = await context.newPage();
  await second.goto("/community/new");
  await second.getByLabel(/^제목/).fill("다른 탭에서 등록한 글");
  await second.getByLabel(/^본문/).fill("다른 탭에서 등록한 본문입니다.");
  await second.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(second.getByRole("heading", { name: "다른 탭에서 등록한 글" })).toBeVisible();

  await page.locator('.main-nav a[href="/community"]').click();
  await expect(page.locator(".post-title")).toHaveCount(3);
  await page.getByRole("link", { name: /내 질문/ }).click();
  await page.locator(".post-vote").click();
  expect((await readActivity(page)).posts).toHaveLength(3);
  await second.close();
});

test("K12: edit fields initialize from storage before subscribing and later events keep dirty edits", async ({ page }) => {
  await seed(page);
  await page.goto("/community/mine");
  await page.getByRole("button", { name: "글 관리" }).click();
  // Same-tab writes deliberately omit the storage event to model a queued cross-tab event.
  await page.evaluate((key) => {
    const activity = JSON.parse(localStorage.getItem(key)!);
    activity.posts = activity.posts.map((post: CommunityPost) => post.id === "mine"
      ? { ...post, category: "solution", title: "최신 저장 제목", body: "최신 저장 본문", tags: ["latest,tag"] }
      : post);
    localStorage.setItem(key, JSON.stringify(activity));
  }, activityKey);
  await page.getByRole("menuitem", { name: "수정", exact: true }).click();
  await expect(page.getByLabel(/^제목/)).toHaveValue("최신 저장 제목");
  await expect(page.getByLabel(/^본문/)).toHaveValue("최신 저장 본문");
  await expect(page.getByRole("combobox", { name: "카테고리", exact: true })).toContainText("풀이 공유");
  await expect(page.locator(".tag-chip")).toContainText("latest,tag");

  await page.getByLabel(/^제목/).fill("내가 수정 중인 제목");
  await page.getByLabel(/^본문/).fill("내가 수정 중인 본문");
  await page.evaluate((key) => {
    const activity = JSON.parse(localStorage.getItem(key)!);
    activity.posts = activity.posts.map((post: CommunityPost) => post.id === "mine"
      ? { ...post, title: "뒤늦은 다른 탭 제목", body: "뒤늦은 다른 탭 본문", views: 73 }
      : post);
    const raw = JSON.stringify(activity);
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw, storageArea: localStorage }));
  }, activityKey);
  await expect(page.getByLabel(/^제목/)).toHaveValue("내가 수정 중인 제목");
  await expect(page.getByLabel(/^본문/)).toHaveValue("내가 수정 중인 본문");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내가 수정 중인 제목" })).toBeVisible();
  expect((await readActivity(page)).posts.find((post: CommunityPost) => post.id === "mine")).toMatchObject({
    title: "내가 수정 중인 제목", body: "내가 수정 중인 본문", views: 73,
  });
});

for (const deletion of ["missing", "deleted"] as const) {
  test(`K13: fresh-state ${deletion} targets reject edits and answers without touching drafts`, async ({ page }) => {
    await seed(page);
    await page.goto("/community/mine");
    const result = await page.evaluate(async ({ key, deletion }) => {
      const modulePath = "/src/community/store.ts";
      const store = await import(modulePath);
      const draft = { category: "question", title: "미완성 수정", body: "보관할 본문", tags: [], savedAt: 1 };
      store.writeDraft("solver", draft, "mine");
      store.writeAnswerDraft("solver", "mine", "보관할 답변 초안");
      const activity = JSON.parse(localStorage.getItem(key)!);
      if (deletion === "missing") {
        activity.posts = activity.posts.filter((post: CommunityPost) => post.id !== "mine");
      } else activity.deleted = ["mine"];
      const before = JSON.stringify(activity);
      localStorage.setItem(key, before);
      const messages = [];
      for (const mutate of [
        () => store.communityActions.updatePost("mine", draft),
        () => store.communityActions.addAnswer("mine", "고아가 되면 안 되는 답변", { name: "solver", tier: "Bronze I" }),
      ]) {
        try {
          mutate();
          messages.push("");
        } catch (cause) {
          messages.push(cause instanceof Error ? cause.message : String(cause));
        }
      }
      return {
        messages,
        before,
        after: localStorage.getItem(key),
        draft: store.readDraft("solver", "mine"),
        answerDraft: store.readAnswerDraft("solver", "mine"),
      };
    }, { key: activityKey, deletion });
    expect(result.messages).toEqual(["글이 삭제되었거나 존재하지 않아요.", "글이 삭제되었거나 존재하지 않아요."]);
    expect(result.after).toBe(result.before);
    expect(result.draft).toMatchObject({ title: "미완성 수정", body: "보관할 본문" });
    expect(result.answerDraft).toBe("보관할 답변 초안");
  });
}

for (const editing of [false, true]) {
  test(`K13/K15: failed ${editing ? "edit" : "publish"} retains the draft and retries once`, async ({ page }) => {
    await seed(page);
    await page.goto(editing ? "/community/mine/edit" : "/community/new");
    await page.getByLabel(/^제목/).fill("저장 실패 후 재시도");
    await page.getByLabel(/^본문/).fill("사라지면 안 되는 본문입니다.");
    await page.getByRole("button", { name: "임시 저장", exact: true }).click();
    const key = editing ? editDraftKey : postDraftKey;
    await failPersistence(page);
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
    expect((await readActivity(page)).posts).toHaveLength(2);
    expect((await readActivity(page)).posts.find((post: CommunityPost) => post.id === "mine").title).toBe(mine.title);
    await expect(page.getByText(/글을 (등록|수정)했어요\./)).toHaveCount(0);

    await failPersistence(page, false);
    await submit.click();
    await expect(page.getByRole("heading", { name: "저장 실패 후 재시도" })).toBeVisible();
    expect((await readActivity(page)).posts.filter((post: CommunityPost) => post.title === "저장 실패 후 재시도")).toHaveLength(1);
    expect(await readStored(page, key)).toBeNull();
    await page.goto(editing ? "/community/mine/edit" : "/community/new");
    await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
    await expect(page.getByLabel(/^제목/)).toHaveValue(editing ? "저장 실패 후 재시도" : "");
  });
}

for (const editing of [false, true]) {
  test(`K13/K15: completed ${editing ? "edit" : "publish"} stays locked during lazy navigation`, async ({ page }) => {
    await page.clock.install();
    await seed(page);
    const destination = await delayPageModule(page, "CommunityPostPage");
    try {
      await page.goto(editing ? "/community/mine/edit" : "/community/new");
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
      expect((await readActivity(page)).posts.filter((post: CommunityPost) => post.title === "완료 후 다시 등록하면 안 되는 글")).toHaveLength(1);
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
  await seed(page);
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
    expect((await readActivity(page)).posts).toHaveLength(2);
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
  await seed(page);
  await page.goto("/community/mine");
  await page.getByLabel("답변 내용").fill("다시 등록할 답변 내용입니다.");
  await failPersistence(page);
  await page.getByRole("button", { name: "답변 등록", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("답변을 저장하지 못했어요.");
  await expect(page.getByLabel("답변 내용")).toHaveValue("다시 등록할 답변 내용입니다.");
  expect(await readStored(page, answerDraftKey)).toBe("다시 등록할 답변 내용입니다.");
  expect((await readActivity(page)).answers).toHaveLength(1);
  await expect(page.getByText("답변을 등록했어요.")).toHaveCount(0);
  await failPersistence(page, false);
  await page.getByRole("button", { name: "답변 등록", exact: true }).click();
  await expect(page.getByText("답변을 등록했어요.")).toBeVisible();
  await expect(page.getByLabel("답변 내용")).toHaveValue("");
  expect((await readActivity(page)).answers).toHaveLength(2);
  expect(await readStored(page, answerDraftKey)).toBeNull();
});

test("K13: vote, follow, answer vote and acceptance failures show errors without changing activity", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await seed(page);
  await page.goto("/community/other");
  await failPersistence(page);
  const before = await readActivity(page);
  await page.locator(".post-vote").click();
  await expect(page.getByRole("alert")).toContainText("저장하지 못했어요.");
  await expect(page.locator(".post-vote")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "+ 팔로우", exact: true }).click();
  await expect(page.getByRole("button", { name: "+ 팔로우", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await readActivity(page)).toEqual(before);

  await page.goto("/community/mine");
  await failPersistence(page);
  await page.getByRole("button", { name: "답변 1", exact: true }).click();
  await page.locator(".answer-vote").click();
  await expect(page.locator(".answer-vote")).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "채택하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("변경 내용을 저장하지 못했어요.");
  await expect(page.getByText("채택 완료", { exact: true })).toHaveCount(0);
  expect(await readActivity(page)).toEqual(before);
  expect(pageErrors).toEqual([]);
});

test("K13: failed deletion stays on the post and does not clear answer or edit drafts", async ({ page }) => {
  await seed(page);
  await page.goto("/community/mine");
  await page.getByLabel("답변 내용").fill("삭제 실패에도 유지할 답변입니다.");
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({
    category: "question", title: "수정 초안", body: "초안 본문", tags: [], savedAt: Date.now(),
  })), editDraftKey);
  await failPersistence(page);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/community\/mine$/);
  await expect(page.getByRole("alert")).toContainText("저장하지 못했어요.");
  expect((await readActivity(page)).posts).toHaveLength(2);
  expect(await readStored(page, answerDraftKey)).toBe("삭제 실패에도 유지할 답변입니다.");
  expect(JSON.parse((await readStored(page, editDraftKey))!).title).toBe("수정 초안");

  await failPersistence(page, false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "글 관리" }).click();
  await page.getByRole("menuitem", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/community$/);
  expect((await readActivity(page)).deleted).toContain("mine");
  expect(await readStored(page, answerDraftKey)).toBeNull();
  expect(await readStored(page, editDraftKey)).toBeNull();
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
  await page.goto("/community/mine");
  await expect(page.getByLabel("답변 내용")).toHaveValue("");
});

test("K15: SPA navigation can be rejected, accepted navigation recovers edits, explicit discard does not restore them", async ({ page }) => {
  await seed(page);
  await page.goto("/community/mine/edit");
  await page.getByLabel(/^제목/).fill("가장 최근 수정 제목");
  await page.getByLabel(/^본문/).fill("가장 최근 수정 본문");
  await page.locator("#tag-input").fill("아직 확정하지 않은 태그");
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
    page.locator(".write-page .back-link").click(),
  ]);
  await expect(page).toHaveURL(/\/community\/mine\/edit$/);
  await expect(page.getByLabel(/^제목/)).toHaveValue("가장 최근 수정 제목");

  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.locator(".write-page .back-link").click(),
  ]);
  await expect(page).toHaveURL(/\/community\/mine$/);
  await openEditor(page);
  await expect(page.getByLabel(/^제목/)).toHaveValue("가장 최근 수정 제목");
  await expect(page.getByLabel(/^본문/)).toHaveValue("가장 최근 수정 본문");
  await expect(page.locator(".tag-chip")).toContainText("아직 확정하지 않은 태그");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/\/community\/mine$/);
  expect(await readStored(page, editDraftKey)).toBeNull();
  await openEditor(page);
  await expect(page.getByLabel(/^제목/)).toHaveValue(mine.title);
  await expect(page.getByLabel(/^본문/)).toHaveValue(mine.body);
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
});

test("K15: session expiry preserves the latest edit before the autosave delay", async ({ page }) => {
  const now = Date.now();
  await page.clock.install({ time: now });
  await seed(page, [mine, other], [], now + 60_000);
  await page.route("**/api/v1/auth/login", (route) => route.fulfill({ json: session }));
  await page.goto("/community/mine/edit");
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
  await expect(page).toHaveURL(/\/community\/mine\/edit$/);
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

test("K31: vote ordering uses the displayed count and still puts pinned notices first", async ({ page }) => {
  await seed(page, [
    { ...mine, upvotes: 5 },
    { ...other, upvotes: 5 },
    { ...mine, id: "notice", title: "고정 공지", category: "notice", pinned: true },
  ], [other.id]);
  await page.goto("/community?sort=votes");
  await expect(page.locator(".post-title")).toHaveText(["고정 공지", "다른 질문", "내 질문"]);
  await expect(page.locator('.post-row[href="/community/other"] .post-num-up')).toContainText("6");
});

test("K32: comma and space tags round-trip through publishing, tag links, filters and reloads", async ({ page }) => {
  await seed(page);
  await page.goto("/community/new");
  await page.getByLabel(/^제목/).fill("복합 태그 질문");
  await page.getByLabel(/^본문/).fill("쉼표와 공백이 있는 태그입니다.");
  await page.locator("#tag-input").fill("a,b");
  await page.locator("#tag-input").press("Enter");
  await page.locator("#tag-input").fill("dynamic programming");
  await page.locator("#tag-input").press("Enter");
  await page.getByRole("button", { name: "글 등록", exact: true }).click();
  await expect(page.getByRole("heading", { name: "복합 태그 질문" })).toBeVisible();
  expect((await readActivity(page)).posts.find((post: CommunityPost) => post.title === "복합 태그 질문").tags).toEqual(["a,b", "dynamic programming"]);
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
  await seed(page, [
    { ...mine, tags: ["a", "b", unusual] },
    { ...other, tags: ["a,b"] },
  ]);
  await page.goto("/community?t=a%2Cb");
  await expect(page.locator(".post-title")).toHaveText([mine.title]);
  await page.getByRole("link", { name: /내 질문/ }).click();
  await openEditor(page);
  await page.getByLabel(/^제목/).fill("태그 보존 수정");
  await page.getByRole("button", { name: "수정 저장", exact: true }).click();
  expect((await readActivity(page)).posts.find((post: CommunityPost) => post.id === mine.id).tags).toEqual(["a", "b", unusual]);
  await page.locator(".post-tags").getByRole("link", { name: `#${unusual}`, exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("tag")).toEqual([unusual]);
  await expect(page.locator(".post-title")).toHaveText(["태그 보존 수정"]);
});

test("K13: the currently unused saved-post action also propagates persistence failures", async ({ page }) => {
  await seed(page);
  await page.goto("/community");
  const before = await readActivity(page);
  await failPersistence(page);
  const threw = await page.evaluate(async () => {
    const modulePath = "/src/community/store.ts";
    const { communityActions } = await import(modulePath);
    try {
      communityActions.toggleSaved("mine");
      return false;
    } catch {
      return true;
    }
  });
  expect(threw).toBe(true);
  expect(await readActivity(page)).toEqual(before);
});
