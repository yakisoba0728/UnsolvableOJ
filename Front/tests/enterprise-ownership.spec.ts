import { expect, test, type Page, type Route } from "@playwright/test";
import type { AttemptView, EnterpriseTest } from "../src/enterprise/model";
import type { Session } from "../src/types";
import { answerConfirm, mockProblemApi, problem, session, storageKey } from "./fixtures";

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const exam = (): EnterpriseTest => ({
  id: "t1", title: "첫 계정의 비공개 채용", description: "담당자만 보는 안내",
  startsAt: iso(86_400_000), endsAt: iso(172_800_000), durationMin: 60,
  problemIds: [problem.id], inviteCode: "abc", inviteOnly: true, invitees: ["private@example.com"],
  showScoreToCandidates: false, attemptCount: 0, createdAt: iso(-60_000), updatedAt: iso(-60_000),
});
const attempt = (id = "a1"): AttemptView => ({
  id, startedAt: iso(-60_000), deadlineAt: iso(1_740_000), finishedAt: null,
  test: { title: `응시 ${id}`, description: "", startsAt: iso(-60_000), endsAt: iso(3_600_000), durationMin: 30, problemCount: 1 },
  problems: [{ ...problem, solved: false, lastSubmissionId: null, lastStatus: null }],
  result: null,
});
const token = (generation: number, sid = "login-family") =>
  `e30.${Buffer.from(JSON.stringify({ sub: session.user.id, sid, tokenVersion: 0, generation })).toString("base64url")}.test`;
const signedIn: Session = { ...session, accessToken: token(1) };

async function setup(page: Page) {
  await page.addInitScript(({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)), {
    key: storageKey, saved: { session: signedIn, expiresAt: Date.now() + 900_000 },
  });
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
  await page.route("**/api/v1/problems/mine", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/vibe/challenges", route => route.fulfill({ json: { items: [], availability: { ai: false, runner: false } } }));
  await page.route("**/api/v1/enterprise/tests", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/enterprise/tests/t1", route => route.fulfill({ json: exam() }));
  await page.route("**/api/v1/enterprise/join/abc", route => route.fulfill({ json: { test: attempt().test, isOwner: false, attempt: null } }));
  await page.route(/\/api\/v1\/enterprise\/attempts\/a[12]$/, route => route.fulfill({ json: attempt(route.request().url().split("/").at(-1)) }));
}

async function changeSession(page: Page, mode: "account" | "login" | "refresh" = "account") {
  const next: Session = mode === "account"
    ? { ...signedIn, accessToken: "second-token", user: { ...session.user, id: "second", username: "second" } }
    : { ...signedIn, accessToken: token(2, mode === "login" ? "new-login-family" : "login-family") };
  await page.evaluate(({ key, nextSession }) => {
    const oldValue = localStorage.getItem(key);
    const newValue = JSON.stringify({ session: nextSession, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  }, { key: storageKey, nextSession: next });
  await expect(page.locator(".account-name")).toHaveText(next.user.username);
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function goToProblems(page: Page) {
  await page.locator(".main-nav a[href='/problems']").click();
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByRole("searchbox", { name: "문제 검색" })).toBeVisible();
}

test("a late test deletion cannot navigate away from the page the user selected", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route("**/api/v1/enterprise/tests/t1", route => {
    if (route.request().method() === "DELETE") { pending = route; return; }
    return route.fulfill({ json: exam() });
  });
  await page.goto("/enterprise/t1");
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await answerConfirm(page, true, "삭제");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await goToProblems(page);
  await pending!.fulfill({ json: { id: "t1" } });
  await settle(page);
  await expect(page).toHaveURL(/\/problems$/);
});

for (const mode of ["account", "login"] as const) {
  test(`a late start from the previous ${mode} cannot open its attempt`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    await page.route("**/api/v1/enterprise/join/abc/start", route => { pending = route; });
    await page.goto("/enterprise/join/abc");
    await page.getByRole("button", { name: "응시 시작", exact: true }).click();
    await answerConfirm(page, true, "응시 시작");
    await expect.poll(() => Boolean(pending)).toBe(true);
    await changeSession(page, mode);
    await expect(page.getByRole("button", { name: "응시 시작", exact: true })).toBeEnabled();
    await pending!.fulfill({ status: 201, json: attempt() });
    await settle(page);
    await expect(page).toHaveURL(/\/enterprise\/join\/abc$/);
  });
}

test("changing accounts dismisses a pending confirmation without starting an exam", async ({ page }) => {
  await setup(page);
  let starts = 0;
  await page.route("**/api/v1/enterprise/join/abc/start", route => { starts++; return route.fulfill({ json: attempt() }); });
  await page.goto("/enterprise/join/abc");
  await page.getByRole("button", { name: "응시 시작", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await changeSession(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "응시 시작", exact: true })).toBeEnabled();
  expect(starts).toBe(0);
});

for (const path of ["/enterprise", "/enterprise/t1"]) {
  test(`private data at ${path} clears while a different account loads`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    const detail = path !== "/enterprise";
    await page.route(`**/api/v1/enterprise/tests${detail ? "/t1" : ""}`, route => {
      if (route.request().headers().authorization === "Bearer second-token") { pending = route; return; }
      return route.fulfill({ json: detail ? exam() : [exam()] });
    });
    await page.goto(path);
    await expect(page.getByText(exam().title, { exact: true }).first()).toBeVisible();
    await changeSession(page);
    await expect.poll(() => Boolean(pending)).toBe(true);
    await expect(page.getByText(exam().title, { exact: true })).toHaveCount(0);
    await expect(page.getByText("private@example.com", { exact: true })).toHaveCount(0);
    await pending!.fulfill(detail
      ? { status: 404, json: { message: "테스트를 찾을 수 없습니다." } }
      : { json: [] });
    await expect(page.getByText(exam().title, { exact: true })).toHaveCount(0);
  });
}

test("a new attempt route starts at its first problem and clears the previous local editor state", async ({ page }) => {
  await setup(page);
  const first = attempt();
  first.problems.push({ ...first.problems[0], id: "second-problem", title: "두 번째 문제" });
  await page.route("**/api/v1/enterprise/attempts/a1", route => route.fulfill({ json: first }));
  await page.goto("/enterprise/attempts/a1");
  await page.getByRole("button", { name: "2. 두 번째 문제", exact: true }).click();
  await page.getByLabel("소스 코드").fill("print('first attempt draft')");
  // A genuine client-side parameter change; page.goto would recreate all React state.
  await page.evaluate(() => {
    history.pushState({ ...history.state, idx: history.state.idx + 1, key: "second-attempt" }, "", "/enterprise/attempts/a2");
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await expect(page.getByRole("heading", { name: "응시 a2", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `1. ${problem.title}`, exact: true })).toHaveAttribute("aria-current", "true");
  await expect(page.getByLabel("소스 코드")).toBeVisible();
  await expect(page.getByLabel("소스 코드")).not.toHaveValue("print('first attempt draft')");
});

test("a late workspace creation cannot redirect after leaving the attempt", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route("**/api/v1/enterprise/attempts/a1", route => route.fulfill({ json: {
    ...attempt(), vibeTasks: [{ challengeId: "challenge", title: "API 과제", id: null, submittedAt: null, score: null, status: "PENDING" }],
  } }));
  await page.route("**/api/v1/enterprise/attempts/a1/vibe/challenge", route => { pending = route; });
  await page.goto("/enterprise/attempts/a1");
  await page.getByRole("button", { name: "과제 시작", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await goToProblems(page);
  await pending!.fulfill({ json: { id: "old-workspace" } });
  await settle(page);
  await expect(page).toHaveURL(/\/problems$/);
});

test("normal token rotation preserves an in-progress submission and editor draft", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route(`**/api/v1/enterprise/attempts/a1/problems/${problem.id}/submissions`, route => { pending = route; });
  await page.route("**/api/v1/submissions/s1", route => route.fulfill({ json: {
    id: "s1", problem: { id: problem.id }, language: "PYTHON", status: "ACCEPTED", isTest: true,
    passedTestCases: 1, totalTestCases: 1, runtimeMs: 1, memoryKb: 1, createdAt: iso(0), updatedAt: iso(0),
  } }));
  await page.goto("/enterprise/attempts/a1");
  const editor = page.getByLabel("소스 코드");
  await editor.fill("print('draft survives refresh')");
  await page.getByRole("button", { name: "제출", exact: true }).click();
  await expect.poll(() => Boolean(pending)).toBe(true);
  await changeSession(page, "refresh");
  await expect(editor).toHaveValue("print('draft survives refresh')");
  await expect(page.getByRole("button", { name: "제출하는 중…", exact: true })).toBeDisabled();
  await pending!.fulfill({ status: 202, json: { id: "s1", status: "QUEUED" } });
  await expect(page.getByText("최근 제출: 성공", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "제출", exact: true })).toBeEnabled();
});

for (const transition of ["navigation", "account"] as const) {
  test(`a late form save cannot change the current page after ${transition}`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    await page.route("**/api/v1/enterprise/tests", route => {
      if (route.request().method() === "POST") { pending = route; return; }
      return route.fulfill({ json: [] });
    });
    await page.goto("/enterprise/new");
    await page.getByLabel(/테스트 이름/).fill("이전 계정이 작성한 테스트");
    await page.getByRole("checkbox", { name: new RegExp(problem.title) }).check();
    await page.getByRole("button", { name: "테스트 만들기", exact: true }).click();
    await expect.poll(() => Boolean(pending)).toBe(true);
    if (transition === "navigation") await goToProblems(page);
    else {
      await changeSession(page);
      await expect(page.getByLabel(/테스트 이름/)).toHaveValue("");
      await expect(page.getByRole("button", { name: "테스트 만들기", exact: true })).toBeEnabled();
    }
    await pending!.fulfill({ status: 201, json: exam() });
    await settle(page);
    await expect(page).toHaveURL(transition === "navigation" ? /\/problems$/ : /\/enterprise\/new$/);
  });
}
