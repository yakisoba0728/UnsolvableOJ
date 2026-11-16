import { expect, test, type Page, type Route } from "@playwright/test";
import type { EnterpriseTest } from "../src/enterprise/model";
import type { Session } from "../src/types";
import { mockProblemApi, problem, session, storageKey } from "./fixtures";

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const exam = (id = "t1"): EnterpriseTest => ({
  id, title: `원래 시험 ${id}`, description: "원래 안내", startsAt: iso(86_400_000), endsAt: iso(172_800_000),
  durationMin: 60, problemIds: [problem.id], inviteCode: `invite-${id}`, inviteOnly: false, invitees: [],
  showScoreToCandidates: false, attemptCount: 0, createdAt: iso(-60_000), updatedAt: iso(-60_000),
});
const token = (generation: number, sid = "same-login") =>
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
  await page.route(/\/api\/v1\/enterprise\/tests\/t[12]$/, route => route.fulfill({ json: exam(route.request().url().split("/").at(-1)) }));
}

async function changeSession(page: Page, mode: "refresh" | "account" | "login") {
  const next: Session = mode === "account"
    ? { ...signedIn, accessToken: "second-account-token", user: { ...session.user, id: "second", username: "second" } }
    : { ...signedIn, accessToken: token(2, mode === "login" ? "new-login" : "same-login") };
  await page.evaluate(({ key, nextSession }) => {
    const oldValue = localStorage.getItem(key);
    const newValue = JSON.stringify({ session: nextSession, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage }));
  }, { key: storageKey, nextSession: next });
  await expect(page.locator(".account-name")).toHaveText(next.user.username);
}

test("ordinary token rotation preserves scheduled-test input during and after a delayed detail refresh", async ({ page }) => {
  await setup(page);
  let pending: Route | undefined;
  await page.route("**/api/v1/enterprise/tests/t1", route => {
    if (route.request().headers().authorization === `Bearer ${token(2)}`) { pending = route; return; }
    return route.fulfill({ json: exam() });
  });
  await page.goto("/enterprise/t1/edit");
  const title = page.getByLabel(/테스트 이름/);
  const description = page.getByLabel(/안내 문구/);
  const refreshVersions = page.getByRole("checkbox", { name: /선택한 일반 문제를 모두 최신 버전으로 갱신/ });
  await title.fill("저장하지 않은 시험 제목");
  await description.fill("저장하지 않은 안내 문구");
  await refreshVersions.check();
  await changeSession(page, "refresh");
  await expect.poll(() => Boolean(pending)).toBe(true);
  await expect(title).toHaveValue("저장하지 않은 시험 제목");
  await expect(description).toHaveValue("저장하지 않은 안내 문구");
  await expect(refreshVersions).toBeChecked();
  await pending!.fulfill({ json: exam() });
  await expect(title).toHaveValue("저장하지 않은 시험 제목");
  await expect(description).toHaveValue("저장하지 않은 안내 문구");
  await expect(refreshVersions).toBeChecked();
});

for (const mode of ["account", "login"] as const) {
  test(`a ${mode} change clears unsaved form data before its private request finishes`, async ({ page }) => {
    await setup(page);
    let pending: Route | undefined;
    await page.route("**/api/v1/enterprise/tests/t1", route => {
      if (route.request().headers().authorization !== `Bearer ${token(1)}`) { pending = route; return; }
      return route.fulfill({ json: exam() });
    });
    await page.goto("/enterprise/t1/edit");
    await page.getByLabel(/테스트 이름/).fill("이전 로그인에서 작성한 비공개 입력");
    await changeSession(page, mode);
    await expect.poll(() => Boolean(pending)).toBe(true);
    await expect(page.getByLabel(/테스트 이름/)).toHaveCount(0);
    await expect(page.locator(".ent-form")).toHaveCount(0);
    if (mode === "account") {
      await pending!.fulfill({ status: 404, json: { message: "테스트를 찾을 수 없습니다." } });
      await expect(page.getByLabel(/테스트 이름/)).toHaveCount(0);
    } else {
      await pending!.fulfill({ json: exam() });
      await expect(page.getByLabel(/테스트 이름/)).toHaveValue(exam().title);
    }
  });
}

test("changing the test id resets its form instead of retaining another test's draft", async ({ page }) => {
  await setup(page);
  await page.goto("/enterprise/t1/edit");
  await page.getByLabel(/테스트 이름/).fill("첫 시험의 저장하지 않은 입력");
  await page.evaluate(() => {
    history.pushState({ ...history.state, idx: history.state.idx + 1, key: "second-edit" }, "", "/enterprise/t2/edit");
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue(exam("t2").title);
});

test("a save keeps its request ownership through ordinary token refresh", async ({ page }) => {
  await setup(page);
  let save: Route | undefined;
  let reload: Route | undefined;
  let saved = false;
  await page.route("**/api/v1/enterprise/tests/t1", route => {
    if (route.request().method() === "PATCH") { save = route; return; }
    if (!saved && route.request().headers().authorization === `Bearer ${token(2)}`) { reload = route; return; }
    return route.fulfill({ json: exam() });
  });
  await page.goto("/enterprise/t1/edit");
  await page.getByLabel(/테스트 이름/).fill("갱신 중 저장한 제목");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect.poll(() => Boolean(save)).toBe(true);
  await changeSession(page, "refresh");
  await expect.poll(() => Boolean(reload)).toBe(true);
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue("갱신 중 저장한 제목");
  await expect(page.getByRole("button", { name: "저장하는 중…", exact: true })).toBeDisabled();
  await reload!.fulfill({ json: exam() });
  saved = true;
  await save!.fulfill({ json: { ...exam(), title: "갱신 중 저장한 제목" } });
  await expect(page).toHaveURL(/\/enterprise\/t1$/);
});
