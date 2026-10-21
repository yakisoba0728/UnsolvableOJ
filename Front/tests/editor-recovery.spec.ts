import { expect, test, type Page } from "@playwright/test";
import type { Problem, Session } from "../src/types";

const sessionKey = "unsolvable-oj-session-v1";
const author: Session = {
  accessToken: "editor-token", tokenType: "Bearer", expiresIn: "15m",
  user: { id: "author-a", email: "author@example.com", username: "author", role: "AUTHOR", level: 1, xp: 0, rating: 0 },
};
const problem: Problem = {
  id: "managed-a", slug: "sum", title: "Server title", difficulty: "BEGINNER",
  timeLimitMs: 1000, memoryLimitMb: 256, status: "PUBLISHED",
  statementMarkdown: "Statement", inputDescriptionMarkdown: "Input", outputDescriptionMarkdown: "Output",
  samples: [], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
};

async function seedSession(page: Page, expiresAt = Date.now() + 900_000, session = author) {
  await page.addInitScript(({ session, expiresAt, sessionKey }) => {
    if (!localStorage.getItem(sessionKey))
      localStorage.setItem(sessionKey, JSON.stringify({ session, expiresAt }));
  }, { session, expiresAt, sessionKey });
}

async function replaceSession(page: Page, session = author) {
  await page.evaluate(({ sessionKey, session }) => {
    localStorage.setItem(sessionKey, JSON.stringify({ session, expiresAt: Date.now() + 900_000 }));
  }, { sessionKey, session });
}

async function fillProblem(page: Page, title = "New title") {
  await page.getByLabel("제목", { exact: true }).fill(title);
  await page.getByLabel("주소용 slug").fill("new-draft");
  await page.getByLabel("문제 본문 (Markdown)").fill("Statement");
  await page.getByLabel("입력 설명").fill("Input");
  await page.getByLabel("출력 설명").fill("No output");
}

test.beforeEach(async ({ context }) => {
  await context.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/manage"))
      return route.fulfill({ json: { ...problem, testCases: [{ input: "", expectedOutput: "", isSample: false, score: 1 }] } });
    if (path === "/api/v1/problems/mine") return route.fulfill({ json: [] });
    if (path === "/api/v1/problems" && route.request().method() === "POST")
      return route.fulfill({ status: 201, json: { ...problem, ...route.request().postDataJSON(), status: "DRAFT" } });
    if (path.startsWith("/api/v1/problems/by-slug/")) {
      if (path.endsWith("/sum")) return route.fulfill({ json: problem });
      return route.fulfill({ status: 404, json: { message: "Not found" } });
    }
    if (path === "/api/v1/problems")
      return route.fulfill({ json: { items: [problem], page: 1, limit: 20, total: 1, totalPages: 1 } });
    return route.fulfill({ status: 404, json: { message: "Unexpected editor fixture request" } });
  });
});

for (const output of ["", " \n\t"]) {
  test(`hidden-only creation accepts ${output ? "whitespace" : "empty"} expected output`, async ({ page }) => {
    await seedSession(page);
    let sent: Record<string, unknown> | undefined;
    await page.route("**/api/v1/problems", async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { ...problem, ...sent, status: "DRAFT" } });
    });
    await page.goto("/problems/new");
    await fillProblem(page);
    await page.getByRole("radiogroup", { name: "테스트 1 공개 여부" }).getByText("숨김", { exact: true }).click();
    await page.getByLabel("기대 출력").fill(output);
    await expect(page.getByText(/공개 예제가 없어요/)).toBeVisible();
    await page.getByRole("button", { name: "초안 저장하기 →" }).click();
    await expect(page.getByRole("heading", { name: "초안을 저장했습니다." })).toBeVisible();
    expect(sent?.testCases).toEqual([{ input: "", expectedOutput: output, isSample: false, score: 1 }]);
    expect(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
    await page.reload();
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
  });
}

test("author SPA exits can be cancelled, accepted exits recover, and explicit discard stays cleared", async ({ page }) => {
  await seedSession(page);
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill("Keep this work");
  expect(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(false);
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
    page.getByRole("link", { name: "← 문제 목록", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/problems\/new$/);
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.getByRole("link", { name: "← 문제 목록", exact: true }).click(),
  ]);
  await expect(page).toHaveURL(/\/problems$/);
  await page.locator("header").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("Keep this work");
  await page.getByRole("button", { name: "지우고 새로 시작" }).click();
  expect(await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await page.getByRole("link", { name: "← 문제 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.locator("header").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
  await page.getByLabel("제목", { exact: true }).fill("New work after discard");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("New work after discard");
});

test("erasing new work back to the default form does not revive an older autosave", async ({ page }) => {
  await seedSession(page);
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill("Temporary title");
  await page.getByLabel("제목", { exact: true }).fill("");
  await page.reload();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
  await expect(page.getByText("작성 중이던 문제를 불러왔어요.")).toHaveCount(0);
});

test("session expiry preserves edit recovery by account and problem without adopting legacy data", async ({ page }) => {
  await page.clock.install();
  await seedSession(page, Date.now() + 10_000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.addInitScript(() => localStorage.setItem("unsolvable-oj-problem-draft-v1", "legacy-ownerless-data"));
  await page.goto("/my-problems/managed-a/edit");
  await page.getByLabel("제목", { exact: true }).fill("Private latest edit");
  await page.clock.fastForward(10_001);
  await expect(page.getByLabel("제목", { exact: true })).toHaveCount(0);
  await replaceSession(page);
  await page.goto("/my-problems/managed-a/edit");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("Private latest edit");
  await page.goto("/my-problems/managed-b/edit");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(problem.title);
  await replaceSession(page, { ...author, user: { ...author.user, id: "author-b" } });
  await page.goto("/my-problems/managed-a/edit");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(problem.title);
  await page.goto("/problems/new");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => localStorage.getItem("unsolvable-oj-problem-draft-v1"))).toBe("legacy-ownerless-data");
  await replaceSession(page);
  await page.goto("/my-problems/managed-a/edit");
  await page.getByRole("button", { name: "복구 내용 버리기" }).click();
  await page.reload();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(problem.title);
});

test("hidden-only existing problems save and successful edits do not resurrect recovery", async ({ page }) => {
  await seedSession(page);
  let sent: Record<string, unknown> | undefined;
  await page.route("**/api/v1/problems/managed-a", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: problem });
  });
  await page.goto("/my-problems/managed-a/edit");
  await page.getByLabel("제목", { exact: true }).fill("Saved edit");
  await page.getByRole("button", { name: "수정 저장하기 →" }).click();
  await expect(page).toHaveURL(/\/my-problems$/);
  expect(sent?.testCases).toEqual([{ input: "", expectedOutput: "", isSample: false, score: 1 }]);
  await page.goto("/my-problems/managed-a/edit");
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(problem.title);
});

test("a pending creation disables editing and cannot clear another tab's recoverable work", async ({ page, context }) => {
  await seedSession(page);
  await page.goto("/problems/new");
  await fillProblem(page, "First tab");
  const second = await context.newPage();
  second.on("dialog", (dialog) => dialog.accept());
  await second.goto("/problems/new");
  await expect(second.getByLabel("제목", { exact: true })).toHaveValue("");
  await fillProblem(second, "Other tab latest");
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/v1/problems", async (route) => {
    await waiting;
    await route.fulfill({ status: 201, json: { ...problem, status: "DRAFT" } });
  });
  await page.getByRole("button", { name: "초안 저장하기 →" }).click();
  await expect(page.getByLabel("제목", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("문제 본문 (Markdown)")).toBeDisabled();
  await second.getByLabel("제목", { exact: true }).fill("Other tab even newer");
  finish();
  await expect(page.getByRole("heading", { name: "초안을 저장했습니다." })).toBeVisible();
  await second.reload();
  await expect(second.getByLabel("제목", { exact: true })).toHaveValue("Other tab even newer");
});

test("an abandoned POST cannot navigate away from or clear a newer creation", async ({ page }) => {
  await seedSession(page, undefined, { ...author, user: { ...author.user, role: "ADMIN" } });
  page.on("dialog", (dialog) => dialog.accept());
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/v1/problems", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await waiting;
    await route.fulfill({ status: 201, json: { ...problem, slug: "published-old", status: "PUBLISHED" } });
  });
  await page.goto("/problems/new");
  await fillProblem(page, "Submitted earlier");
  await page.getByRole("button", { name: "문제 게시하기 →" }).click();
  await expect(page.getByLabel("제목", { exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "← 문제 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.locator("header").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await page.getByLabel("제목", { exact: true }).fill("Newer unsent work");
  const oldResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/v1/problems"));
  finish();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(page).toHaveURL(/\/problems\/new$/);
  await page.reload();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("Newer unsent work");
});

test("author storage failure is honest and memory recovery survives an immediate SPA exit", async ({ page }) => {
  await seedSession(page);
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("unsolvable-oj-problem-draft-v2:")) throw new Error("quota");
      return set.call(this, key, value);
    };
  });
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill("Memory only latest");
  await expect(page.getByText(/임시 저장소를 읽거나 저장하지 못했어요/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "← 문제 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.locator("header").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("Memory only latest");
  await page.getByRole("button", { name: "지우고 새로 시작" }).click();
  await page.getByRole("link", { name: "← 문제 목록", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.locator("header").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
});

test("source storage failure keeps the latest draft across languages and visits, while reset clears memory", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("unsolvable-oj-draft-v1:managed-a:PYTHON", "stale stored source");
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("unsolvable-oj-draft-v1:")) throw new Error("quota");
      return set.call(this, key, value);
    };
  });
  await page.goto("/problems/view/sum");
  const editor = page.getByLabel("소스 코드");
  await editor.fill("print('memory latest')");
  await expect(page.getByText(/초안을 읽거나 저장하지 못했어요/)).toBeVisible();
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "C++ 20", exact: true }).click();
  await editor.fill("cpp memory latest");
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "Python 3", exact: true }).click();
  await expect(editor).toHaveValue("print('memory latest')");
  await page.locator("header").getByRole("link", { name: "문제", exact: true }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.goBack();
  await expect(editor).toHaveValue("print('memory latest')");
  await page.getByRole("button", { name: "초기화", exact: true }).click();
  await expect(editor).not.toHaveValue("print('memory latest')");
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "C++ 20", exact: true }).click();
  await expect(editor).toHaveValue("cpp memory latest");
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "Python 3", exact: true }).click();
  await expect(editor).not.toHaveValue("stale stored source");
});

test("mirrored snippet input survives an execCommand no-op in the actual editor", async ({ page }) => {
  await page.goto("/problems/view/sum");
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "Java 21", exact: true }).click();
  const editor = page.getByLabel("소스 코드");
  // 언어를 바꾸면 시작 코드가 한 번 더 그린 뒤에 들어오므로, 들어온 것을 확인하고 비운다.
  await expect(editor).toHaveValue(/public class Main/);
  await editor.fill("");
  await editor.pressSequentially("fori");
  await page.getByRole("listbox", { name: "자동완성 제안" }).getByRole("option", { name: /^fori/ }).click();
  await expect(editor).toHaveValue("for (int i = 0; i < n; i++) {\n    \n}");
  await page.evaluate(() => { document.execCommand = () => true; });
  await page.keyboard.type("j");
  await expect(editor).toHaveValue("for (int j = 0; j < n; j++) {\n    \n}");
  await page.keyboard.type("k");
  await expect(editor).toHaveValue("for (int jk = 0; jk < n; jk++) {\n    \n}");
  expect(await page.evaluate(() => localStorage.getItem("unsolvable-oj-draft-v1:managed-a:JAVA"))).toBe("for (int jk = 0; jk < n; jk++) {\n    \n}");
});

test("source drafts: returning to Python restores another tab's latest work before editing", async ({ page, context }) => {
  const key = `unsolvable-oj-draft-v1:${problem.id}:PYTHON`;
  const old = "print('tab A old')";
  const latest = "print('tab B latest')";
  await page.goto("/problems/view/sum");
  const editor = page.getByLabel("소스 코드");
  await editor.fill(old);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(old);
  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "C++ 20", exact: true }).click();
  await expect(editor).toHaveValue(/#include/);

  const second = await context.newPage();
  await second.goto("/problems/view/sum");
  const secondEditor = second.getByLabel("소스 코드");
  await expect(secondEditor).toHaveValue(old);
  await secondEditor.fill(latest);
  expect(await second.evaluate((key) => localStorage.getItem(key), key)).toBe(latest);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(latest);

  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "Python 3", exact: true }).click();
  await expect(editor).toHaveValue(latest);
  await editor.press("End");
  await editor.press("Enter");
  await editor.pressSequentially("print('tab A continuation')");
  const edited = `${latest}\nprint('tab A continuation')`;
  await expect(editor).toHaveValue(edited);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(edited);
  expect(await second.evaluate((key) => localStorage.getItem(key), key)).toBe(edited);
});
