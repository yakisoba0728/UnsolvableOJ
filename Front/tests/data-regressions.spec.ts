import { expect, test, type Page } from "@playwright/test";
import type { Problem, Session, Submission } from "../src/types";

const storageKey = "unsolvable-oj-session-v1";
const session: Session = {
  accessToken: "data-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: {
    id: "data-owner",
    email: "owner@example.com",
    username: "data_owner",
    role: "USER",
    level: 1,
    xp: 123,
    rating: 0,
  },
};
const otherSession: Session = {
  ...session,
  accessToken: "other-data-token",
  user: { ...session.user, id: "other-owner", username: "other_owner" },
};
const problem: Problem = {
  id: "public-problem",
  slug: "public-sum",
  title: "공개된 합 문제",
  difficulty: "BEGINNER",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  status: "PUBLISHED",
  statementMarkdown: "두 수의 합",
  inputDescriptionMarkdown: "두 수",
  outputDescriptionMarkdown: "합",
  samples: [{ input: "1 2", expectedOutput: "3" }],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};
const submission: Submission = {
  id: "data-result",
  problem: { id: problem.id, slug: problem.slug, title: problem.title },
  language: "PYTHON",
  status: "WRONG_ANSWER",
  runtimeMs: 1,
  memoryKb: 1024,
  passedTestCases: 0,
  totalTestCases: 1,
  compileOutput: null,
  judgeMessage: null,
  sourceCode: "print(0)",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
};

function list<T>(items: T[]) {
  return { items, page: 1, limit: 1000, total: items.length, totalPages: 1 };
}

async function authenticate(page: Page, value = session, lifetime = 900_000) {
  await page.addInitScript(({ key, value, lifetime }) => {
    localStorage.setItem(key, JSON.stringify({ session: value, expiresAt: Date.now() + lifetime }));
  }, { key: storageKey, value, lifetime });
}

async function freeze(page: Page) {
  const time = Date.UTC(2026, 9, 20, 12);
  await page.clock.install({ time });
  await page.clock.pauseAt(time + 1000);
}

async function pauseClock(page: Page) {
  // HTTP-date Retry-After has whole-second precision.
  await page.clock.pauseAt(Math.ceil(await page.evaluate(() => Date.now() + 60_000) / 1000) * 1000);
}

async function readAll(page: Page) {
  return page.evaluate(async () => {
    const modulePath = "/src/pagination.ts";
    const { fetchAll } = await import(modulePath);
    return fetchAll("/data-pagination", new AbortController().signal);
  });
}

test.beforeEach(async ({ context }) => {
  await context.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/problems")
      return route.fulfill({ json: list([problem]) });
    if (path === "/api/v1/submissions")
      return route.fulfill({ json: list([submission]) });
    if (path === "/api/v1/submissions/data-result")
      return route.fulfill({ json: submission });
    if (path === "/api/v1/users/me")
      return route.fulfill({ json: { ...session.user, solvedCount: 0, createdAt: problem.createdAt } });
    if (path === "/api/v1/rankings")
      return route.fulfill({ json: [{ ...session.user, solvedCount: 0 }] });
    if (path === "/api/v1/auth/login")
      return route.fulfill({ json: session });
    return route.fulfill({ status: 404, json: { message: "not found" } });
  });
});

test("K09: another tab replaces the account and logs out this protected page", async ({ page, context }) => {
  await authenticate(page);
  await page.goto("/submissions");
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  const writer = await context.newPage();
  await writer.goto("/auth");
  await writer.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 }));
  }, { key: storageKey, value: otherSession });
  await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
  await writer.evaluate((key) => localStorage.removeItem(key), storageKey);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("K09: an old expiry timer cannot delete a newer persisted session", async ({ page }) => {
  await freeze(page);
  await authenticate(page, session, 5000);
  await page.goto("/submissions");
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  // Same-document storage writes deliberately deliver no storage event to the provider.
  await page.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 }));
  }, { key: storageKey, value: otherSession });
  await page.clock.runFor(5000);
  await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).session.user.id, storageKey))
    .toBe(otherSession.user.id);
});

for (const phase of ["expired", "invalid", "expiry"] as const) {
  test(`K09: ${phase} session reads never remove an interleaved new login`, async ({ page }) => {
    await freeze(page);
    await page.addInitScript(({ key, oldSession, newSession, phase }) => {
      const read = Storage.prototype.getItem;
      const write = Storage.prototype.setItem;
      const remove = Storage.prototype.removeItem;
      const expiresAt = Date.now() + (phase === "expiry" ? 5000 : -1);
      const initial = JSON.stringify(phase === "invalid"
        ? { session: {}, expiresAt: Date.now() + 900_000 }
        : { session: oldSession, expiresAt });
      const fresh = JSON.stringify({ session: newSession, expiresAt: Date.now() + 900_000 });
      const state = { reads: 0, removals: 0, replaced: false };
      (window as unknown as { sessionRace: typeof state }).sessionRace = state;
      write.call(localStorage, key, initial);
      const replace = () => {
        if (state.replaced) return;
        state.replaced = true;
        write.call(localStorage, key, fresh);
        window.dispatchEvent(new StorageEvent("storage", {
          key, newValue: fresh, storageArea: localStorage,
        }));
      };
      Storage.prototype.getItem = function (this: Storage, requested: string) {
        const value = read.call(this, requested);
        if (
          this === localStorage && requested === key && value === initial &&
          (phase !== "expiry" || Date.now() >= expiresAt)
        ) {
          state.reads += 1;
          // A second read simulates B writing after a stale comparison read, before removal.
          if (state.reads === 1) queueMicrotask(replace);
          else replace();
        }
        return value;
      };
      Storage.prototype.removeItem = function (this: Storage, requested: string) {
        if (this === localStorage && requested === key) state.removals += 1;
        remove.call(this, requested);
      };
    }, { key: storageKey, oldSession: session, newSession: otherSession, phase });
    await page.goto("/auth");
    if (phase === "expiry") {
      await expect(page.locator(".account-name")).toHaveText(session.user.username);
      await page.clock.runFor(5000);
    }
    await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
    const result = await page.evaluate((key) => ({
      ...(window as unknown as {
        sessionRace: { reads: number; removals: number; replaced: boolean };
      }).sessionRace,
      owner: JSON.parse(localStorage.getItem(key)!).session.user.id,
    }), storageKey);
    expect(result.reads).toBeGreaterThan(0);
    expect(result).toMatchObject({ removals: 0, replaced: true, owner: otherSession.user.id });
  });
}

test("K10: an abandoned login cannot write auth or navigate even when transport ignores abort", async ({ page }) => {
  await page.addInitScript((value) => {
    const original = window.fetch;
    window.fetch = (input, options) => {
      if (String(input).endsWith("/auth/login"))
        return new Promise<Response>((resolve) => {
          (window as unknown as { finishLogin: () => void }).finishLogin = () =>
            resolve(new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } }));
        });
      return original(input, options);
    };
  }, session);
  await page.goto("/auth");
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForFunction(() => typeof (window as unknown as { finishLogin?: unknown }).finishLogin === "function");
  await page.getByRole("link", { name: "← 문제 목록으로 돌아가기" }).click();
  await expect(page).toHaveURL(/\/problems$/);
  await page.evaluate(async () => {
    (window as unknown as { finishLogin: () => void }).finishLogin();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await expect(page).toHaveURL(/\/problems$/);
  expect(await page.evaluate((key) => localStorage.getItem(key), storageKey)).toBeNull();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

for (const { goBack, status, nativeFragment } of [
  { goBack: false, status: 200, nativeFragment: false },
  { goBack: true, status: 200, nativeFragment: false },
  { goBack: true, status: 503, nativeFragment: false },
  { goBack: false, status: 200, nativeFragment: true },
]) {
  const action = nativeFragment ? "native fragment default-key navigation" : `blocked lazy navigation${goBack ? " and back" : ""}`;
  test(`K10: ${action} cannot revive a stale login${status === 503 ? " error" : ""}`, async ({ page }) => {
    const staleError = "Abandoned login failure";
    await page.addInitScript(({ value, storageKey, status, staleError }) => {
      const original = window.fetch;
      window.fetch = (input, options) => {
        if (!String(input).endsWith("/auth/login")) return original(input, options);
        const originalPath = location.pathname;
        const originalHistoryKey = history.state?.key ?? null;
        const originalHash = location.hash;
        const signal = options?.signal;
        let responseReleased = false;
        return new Promise<Response>((resolve) => {
          let consumed!: () => void;
          const completed = new Promise<void>((finish) => { consumed = finish; });
          const response = new Response(JSON.stringify(status === 200 ? value : { message: staleError }), {
            status, headers: { "Content-Type": "application/json" },
          });
          const json = response.json.bind(response);
          response.json = async () => {
            const body = await json();
            // A message task runs after the API/submit promise continuations, without a fixed sleep.
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              channel.port1.close();
              channel.port2.close();
              consumed();
            };
            channel.port2.postMessage(null);
            return body;
          };
          (window as unknown as { loginProbe: {
            inspect: () => unknown;
            release: () => Promise<void>;
          } }).loginProbe = {
            inspect: () => ({
              originalPath, originalHistoryKey, originalHash, pathname: location.pathname, hash: location.hash,
              historyKey: history.state?.key ?? null, signalSeen: Boolean(signal),
              signalAborted: signal?.aborted ?? null,
              responseReleased,
              authFormPresent: Boolean(document.getElementById("auth-email")),
              hasSession: localStorage.getItem(storageKey) !== null,
            }),
            release: async () => { responseReleased = true; resolve(response); await completed; },
          };
        });
      };
    }, { value: session, storageKey, status, staleError });
    let releaseModule!: () => void;
    let moduleRequested!: () => void;
    const held = new Promise<void>((resolve) => { releaseModule = resolve; });
    const requested = new Promise<void>((resolve) => { moduleRequested = resolve; });
    await page.route("**/src/pages/CommunityPage.tsx*", async (route) => {
      moduleRequested();
      await held;
      await route.continue();
    });
    try {
      await page.goto("/auth");
      await page.getByLabel("이메일").fill(session.user.email);
      await page.getByLabel("비밀번호").fill("browser-password");
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page.waitForFunction(() => Boolean((window as unknown as { loginProbe?: unknown }).loginProbe));
      if (nativeFragment) {
        await page.evaluate(() => new Promise<void>((resolve) => {
          window.addEventListener("hashchange", () => resolve(), { once: true });
          location.hash = "k10-fragment";
        }));
        await expect(page).toHaveURL(/\/auth#k10-fragment$/);
      } else {
        await page.locator("header").getByRole("link", { name: "커뮤니티", exact: true }).click();
        await requested;
        await expect(page).toHaveURL(/\/community$/);
        if (goBack) {
          await page.goBack();
          await expect(page).toHaveURL(/\/auth$/);
          const login = page.getByRole("button", { name: "로그인", exact: true });
          await expect(login).toBeEnabled();
          const heldRequest = await page.evaluate(() => (window as unknown as { loginProbe: {
            inspect: () => { responseReleased: boolean; signalAborted: boolean | null };
          } }).loginProbe.inspect());
          expect(heldRequest.responseReleased).toBe(false);
          console.log("K10_ABA_LOGIN_READY", JSON.stringify({ ...heldRequest, buttonEnabled: await login.isEnabled() }));
        }
      }
      const observations = await page.evaluate(async () => {
        const probe = (window as unknown as { loginProbe: {
          inspect: () => { originalPath: string; originalHistoryKey: string | null; originalHash: string; pathname: string; hash: string;
            historyKey: string | null; signalSeen: boolean; signalAborted: boolean | null;
            responseReleased: boolean; authFormPresent: boolean; hasSession: boolean };
          release: () => Promise<void>;
        } }).loginProbe;
        const before = probe.inspect();
        await probe.release();
        return { before, after: probe.inspect() };
      });
      console.log("K10_BLOCKED_LAZY_RELEASE", JSON.stringify({ goBack, status, nativeFragment, ...observations }));
      expect(observations.before.originalPath).toBe("/auth");
      expect(observations.before.signalSeen).toBe(true);
      expect(observations.before.responseReleased).toBe(false);
      expect(observations.before.pathname).toBe(goBack || nativeFragment ? "/auth" : "/community");
      if (nativeFragment) {
        expect(observations.before.originalHash).toBe("");
        expect(observations.before.hash).toBe("#k10-fragment");
        expect(observations.before.historyKey).toBe(observations.before.originalHistoryKey);
        expect(observations.before.authFormPresent).toBe(true);
      }
      expect(observations.after.hasSession).toBe(false);
      await expect(page).toHaveURL(nativeFragment ? /\/auth#k10-fragment$/ : goBack ? /\/auth$/ : /\/community$/);
      await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
      if (status === 503) {
        await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
        await expect(page.getByText(staleError, { exact: true })).toHaveCount(0);
      }
    } finally {
      releaseModule();
    }
  });
}

test("K10: a synchronous session replacement owns auth before React cleanup", async ({ page }) => {
  await page.addInitScript((value) => {
    const original = window.fetch;
    window.fetch = (input, options) => {
      if (!String(input).endsWith("/auth/login")) return original(input, options);
      const signal = options?.signal;
      const response = new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
      const parsed = response.json();
      let consumed!: () => void;
      let signalAtBody: boolean | null = null;
      let authFormAtBody = false;
      const completed = new Promise<void>((resolve) => { consumed = resolve; });
      response.json = async () => {
        const body = await parsed;
        return new Promise<unknown>((resolve) => {
          (window as unknown as { sessionLoginProbe: {
            inspect: () => unknown; release: () => Promise<void>;
          } }).sessionLoginProbe = {
            inspect: () => ({ signalAborted: signal?.aborted ?? null, signalAtBody, authFormAtBody }),
            release: async () => { resolve(body); await completed; },
          };
        }).then((body) => {
          signalAtBody = signal?.aborted ?? null;
          authFormAtBody = Boolean(document.getElementById("auth-email"));
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            channel.port2.close();
            consumed();
          };
          channel.port2.postMessage(null);
          return body;
        });
      };
      return Promise.resolve(response);
    };
  }, session);
  await page.goto("/auth");
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForFunction(() => Boolean((window as unknown as { sessionLoginProbe?: unknown }).sessionLoginProbe));
  const result = await page.evaluate(async ({ key, next }) => {
    const probe = (window as unknown as { sessionLoginProbe: {
      inspect: () => { signalAborted: boolean | null; signalAtBody: boolean | null; authFormAtBody: boolean };
      release: () => Promise<void>;
    } }).sessionLoginProbe;
    const raw = JSON.stringify({ session: next, expiresAt: Date.now() + 900_000 });
    localStorage.setItem(key, raw);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: raw, storageArea: localStorage }));
    const before = probe.inspect();
    await probe.release();
    return { before, after: probe.inspect(), saved: JSON.parse(localStorage.getItem(key)!) };
  }, { key: storageKey, next: otherSession });
  console.log("K10_SESSION_RELEASE", JSON.stringify({ before: result.before, after: result.after,
    owner: result.saved.session.user.id, tokenRetained: result.saved.session.accessToken === otherSession.accessToken }));
  expect(result.before.signalAborted).toBe(false);
  expect(result.after.signalAtBody).toBe(false);
  expect(result.after.authFormAtBody).toBe(true);
  expect(result.saved.session.user.id).toBe(otherSession.user.id);
  expect(result.saved.session.accessToken).toBe(otherSession.accessToken);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
});

for (const failure of ["network", "429-seconds", "503-date"] as const) {
  test(`K17: pending results survive ${failure} and respect the next retry time`, async ({ page }) => {
    await page.clock.install();
    await authenticate(page);
    let calls = 0;
    let polling = false;
    await page.route("**/api/v1/submissions/data-result", async (route) => {
      if (!polling) {
        await pauseClock(page);
        return route.fulfill({ json: { ...submission, status: "JUDGING" } });
      }
      calls += 1;
      if (calls === 1) {
        if (failure === "network") return route.abort("failed");
        const retryAfter = failure === "429-seconds" ? "8"
          : new Date(await page.evaluate(() => Date.now()) + 8000).toUTCString();
        return route.fulfill({
          status: failure === "429-seconds" ? 429 : 503,
          headers: { "Retry-After": retryAfter },
          json: { message: "temporary result failure" },
        });
      }
      return route.fulfill({ json: { ...submission, status: "ACCEPTED" } });
    });
    await page.goto("/submissions/data-result");
    await expect(page.locator(".result-banner")).toContainText("채점 중");
    polling = true;
    await page.clock.runFor(2000);
    await expect(page.getByRole("alert")).toContainText("잠시 후 다시 확인합니다.");
    await expect(page.locator(".result-summary")).toBeVisible();
    const retryDelay = failure === "network" ? 2000 : 8000;
    await page.clock.runFor(retryDelay - 1);
    expect(calls).toBe(1);
    await page.clock.runFor(1);
    await expect(page.locator(".result-banner")).toContainText("성공");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.clock.runFor(60_000);
    expect(calls).toBe(2);
  });
}

for (const status of [401, 403, 404]) {
  test(`K17: permanent ${status} stops polling without losing the prior result`, async ({ page }) => {
    await page.clock.install();
    await authenticate(page);
    let calls = 0;
    let polling = false;
    await page.route("**/api/v1/submissions/data-result", async (route) => {
      if (!polling) {
        await pauseClock(page);
        return route.fulfill({ json: { ...submission, status: "QUEUED" } });
      }
      calls += 1;
      return route.fulfill({ status, json: { message: "permanent result failure" } });
    });
    await page.goto("/submissions/data-result");
    await expect(page.locator(".result-summary")).toBeVisible();
    polling = true;
    await page.clock.runFor(2000);
    await expect(page.getByRole("alert")).toContainText("permanent result failure");
    await expect(page.locator(".result-summary")).toBeVisible();
    await page.clock.runFor(120_000);
    expect(calls).toBe(1);
  });
}

test("K17: repeated transient errors exhaust a bounded backoff and unmount cancels polling", async ({ page }) => {
  await page.clock.install();
  await authenticate(page);
  let calls = 0;
  let polling = false;
  await page.route("**/api/v1/submissions/data-result", async (route) => {
    if (!polling) {
      await pauseClock(page);
      return route.fulfill({ json: { ...submission, status: "JUDGING" } });
    }
    calls += 1;
    return route.fulfill({ status: 503, json: { message: `unavailable ${calls}` } });
  });
  await page.goto("/submissions/data-result");
  await expect(page.locator(".result-summary")).toBeVisible();
  polling = true;
  let expectedCalls = 0;
  for (const delay of [2000, 2000, 4000, 8000, 16_000, 30_000]) {
    await page.clock.runFor(delay);
    expectedCalls += 1;
    await expect.poll(() => calls).toBe(expectedCalls);
    await expect(page.getByRole("alert")).toContainText(`unavailable ${expectedCalls}`);
  }
  await page.clock.runFor(120_000);
  expect(calls).toBe(6);
  await expect(page.getByRole("alert")).not.toContainText("잠시 후");
  await page.clock.resume();
  await page.getByRole("link", { name: "내 제출", exact: true }).first().click();
  await page.clock.runFor(120_000);
  expect(calls).toBe(6);
});

test("K17: leaving a pending result cancels its scheduled poll", async ({ page }) => {
  await page.clock.install();
  await authenticate(page);
  let calls = 0;
  await page.route("**/api/v1/submissions/data-result", async (route) => {
    calls += 1;
    if (calls === 1) await pauseClock(page);
    return route.fulfill({ json: { ...submission, status: "JUDGING" } });
  });
  await page.goto("/submissions/data-result");
  await expect(page.locator(".result-summary")).toBeVisible();
  await page.clock.resume();
  await page.getByRole("link", { name: "내 제출", exact: true }).first().click();
  await expect(page).toHaveURL(/\/submissions$/);
  await expect(page.locator(".result-summary")).toHaveCount(0);
  await expect(page.locator(".history-row")).toHaveCount(1);
  const initialCalls = calls;
  await pauseClock(page);
  await page.clock.runFor(60_000);
  expect(calls).toBe(initialCalls);
});

test("K18: pending problem search preserves newer difficulty and sort URL parameters", async ({ page }) => {
  await page.clock.install();
  await page.goto("/problems?sort=title&keep=1&page=2");
  await expect(page.getByRole("searchbox", { name: "문제 검색" })).toBeVisible();
  await pauseClock(page);
  await page.getByRole("searchbox", { name: "문제 검색" }).fill("합");
  await page.getByRole("button", { name: /쉬운 난이도로 시작하기/ }).click();
  await page.clock.runFor(250);
  await expect(page).toHaveURL(/q=/);
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ q: "합", d: "BEGINNER", sort: "title", keep: "1" });
  expect(params.has("page")).toBe(false);
});

test("K18: pending submission search preserves newer status and grouping URL parameters", async ({ page }) => {
  await page.clock.install();
  await authenticate(page);
  await page.goto("/submissions?l=PYTHON&keep=1&page=2");
  await expect(page.locator(".history-row")).toHaveCount(1);
  await pauseClock(page);
  await page.getByRole("searchbox", { name: "제출한 문제 검색" }).fill("합");
  await page.getByRole("group", { name: "판정 필터" }).getByRole("button", { name: /틀림·오류/ }).click();
  await page.getByRole("radiogroup", { name: "보기 방식" }).getByRole("radio", { name: /문제별 최신/ }).click();
  await page.clock.runFor(250);
  await expect(page).toHaveURL(/q=/);
  const params = new URL(page.url()).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ q: "합", s: "wrong", g: "problem", l: "PYTHON", keep: "1" });
  expect(params.has("page")).toBe(false);
});

test("K19: opaque cursors take precedence over changing page counts and deduplicate IDs", async ({ page }) => {
  const cursors: (string | null)[] = [];
  await page.route("**/api/v1/data-pagination?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const cursor = query.get("cursor");
    cursors.push(cursor);
    if (cursor === null) {
      expect(query.get("page")).toBe("1");
      return route.fulfill({ json: { ...list([{ id: "a" }, { id: "b" }]), nextCursor: "opaque +/&=" } });
    }
    expect(cursor).toBe("opaque +/&=");
    expect(query.has("page")).toBe(false);
    return route.fulfill({ json: { ...list([{ id: "b" }, { id: "c" }]), totalPages: 99, nextCursor: null } });
  });
  await page.goto("/auth");
  expect(await readAll(page)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
  expect(cursors).toEqual([null, "opaque +/&="]);
});

for (const brokenCursor of ["repeat", "missing", "empty"] as const) {
  test(`K19: a ${brokenCursor} cursor rejects instead of looping or returning partial data`, async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v1/data-pagination?*", (route) => {
      calls += 1;
      const response = { ...list([{ id: String(calls) }]), nextCursor: "one" };
      return route.fulfill({ json: calls === 1 ? response
        : brokenCursor === "missing" ? list([{ id: "two" }])
        : { ...response, nextCursor: brokenCursor === "empty" ? "" : "one" } });
    });
    await page.goto("/auth");
    await expect(readAll(page)).rejects.toThrow(/커서/);
    expect(calls).toBe(2);
  });
}

test("K19: legacy offset responses still deduplicate IDs without pretending to be a snapshot", async ({ page }) => {
  await page.route("**/api/v1/data-pagination?*", (route) => {
    const current = Number(new URL(route.request().url()).searchParams.get("page"));
    return route.fulfill({ json: { ...list(current === 1 ? [{ id: "a" }, { id: "b" }] : [{ id: "b" }, { id: "c" }]), page: current, totalPages: 2 } });
  });
  await page.goto("/auth");
  expect(await readAll(page)).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
});

for (const failed of ["profile", "rank"] as const) {
  test(`K28: a failed ${failed} does not block the other request or leave a sidebar skeleton`, async ({ page }) => {
    await authenticate(page);
    const path = failed === "profile" ? "users/me" : "rankings";
    await page.route(`**/api/v1/${path}`, (route) => route.fulfill({ status: 503, json: { message: `${failed} unavailable` } }));
    await page.goto("/problems");
    await expect(page.getByRole("alert")).toContainText(`${failed} unavailable`);
    await expect(page.locator('.standing-card[aria-busy="true"]')).toHaveCount(0);
    if (failed === "rank") {
      await expect(page.locator(".standing-card")).toContainText("123");
      await expect(page.locator(".standing-card")).toContainText("해결한 문제");
    }
    await expect(page.locator("a.problem-row")).toHaveCount(1);
  });
}

test("K29: forced login restores the complete protected deep link; explicit logout stays home", async ({ page }) => {
  await page.goto("/submissions/data-result?view=cases#case-2");
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/submissions\/data-result\?view=cases#case-2$/);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("K39: resume waits for the published catalog, uses its current slug, and retains hidden history", async ({ page }) => {
  await authenticate(page);
  const hidden = { ...submission, id: "hidden-attempt", problem: { id: "hidden", slug: "removed", title: "비공개 기록" } };
  const publicAttempt = { ...submission, problem: { ...submission.problem, slug: "old-slug" } };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/problems?*", async (route) => {
    await gate;
    await route.fulfill({ json: list([problem]) });
  });
  await page.route("**/api/v1/submissions?*", (route) => route.fulfill({ json: list([hidden, publicAttempt]) }));
  await page.goto("/problems");
  await expect(page.locator(".standing-card")).toContainText("123");
  await expect(page.locator(".standing-continue a")).toHaveCount(0);
  release();
  await expect(page.locator(".standing-continue a")).toHaveAttribute("href", `/problems/view/${problem.slug}`);
  await expect(page.locator(".standing-continue a")).toContainText("이어서 풀기");
  await page.getByRole("link", { name: "내 제출", exact: true }).first().click();
  await expect(page.locator(".history-row")).toHaveCount(2);
  await expect(page.locator(".history-row").first()).toContainText("비공개 기록");
});

test("form identity: changing owners on the same author route remounts the form", async ({ page, context }) => {
  await page.clock.setFixedTime(Date.UTC(2026, 9, 20, 12));
  await authenticate(page, { ...session, user: { ...session.user, role: "AUTHOR" } });
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill("owner A unsaved title");
  const writer = await context.newPage();
  await writer.goto("/auth");
  await writer.evaluate(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 }));
  }, { key: storageKey, value: { ...otherSession, user: { ...otherSession.user, role: "AUTHOR" } } });
  await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
  await expect(page).toHaveURL(/\/problems\/new$/);
});

test("form identity: navigating from an unchanged edit form to new does not reuse edit state", async ({ page }) => {
  await authenticate(page, { ...session, user: { ...session.user, role: "AUTHOR" } });
  await page.route(`**/api/v1/problems/${problem.id}/manage`, (route) => route.fulfill({ json: {
    ...problem,
    testCases: [{ input: "1 2", expectedOutput: "3", isSample: true, score: 1 }],
  } }));
  await page.goto(`/my-problems/${problem.id}/edit`);
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue(problem.title);
  await page.locator(".main-nav").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/problems\/new$/);
  await expect(page.getByLabel("제목", { exact: true })).toHaveValue("");
});

for (const path of ["/my-problems", "/profile", "/"] as const) {
  test(`owner identity: ${path} cannot retain A's private data when B's fetch fails`, async ({ page, context }) => {
    await authenticate(page, { ...session, user: { ...session.user, role: "AUTHOR" } });
    const privateTitle = "owner A private draft";
    const privateName = "owner_a_private_profile";
    const message = "owner B private fetch failed";
    await page.route("**/api/v1/problems/mine", (route) =>
      route.request().headers().authorization === `Bearer ${otherSession.accessToken}`
        ? route.fulfill({ status: 503, json: { message } })
        : route.fulfill({ json: [{
            ...problem, title: privateTitle, status: "DRAFT", currentVersion: 1,
          }] }),
    );
    await page.route("**/api/v1/users/me", (route) =>
      route.request().headers().authorization === `Bearer ${otherSession.accessToken}`
        ? route.fulfill({ status: 503, json: { message } })
        : route.fulfill({ json: {
            ...session.user, username: privateName, solvedCount: 0, createdAt: problem.createdAt,
          } }),
    );
    await page.goto(path);
    if (path === "/my-problems")
      await expect(page.locator(".my-problem-list")).toContainText(privateTitle);
    else if (path === "/profile")
      await expect(page.locator(".profile-card")).toContainText(privateName);
    else {
      await expect(page.locator(".stat-tile").first()).toContainText("123 XP");
      await expect(page.locator(".brand-art text")).toContainText(["Lv.1", "123 XP"]);
    }

    const writer = await context.newPage();
    await writer.goto("/auth");
    const failed = page.waitForResponse((response) =>
      response.url().endsWith(path === "/my-problems" ? "/problems/mine" : "/users/me") &&
      response.request().headers().authorization === `Bearer ${otherSession.accessToken}` &&
      response.status() === 503,
    );
    await writer.evaluate(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify({ session: value, expiresAt: Date.now() + 900_000 }));
    }, { key: storageKey, value: { ...otherSession, user: { ...otherSession.user, role: "AUTHOR" } } });
    await expect(page.locator(".account-name")).toHaveText(otherSession.user.username);
    await failed;
    if (path === "/my-problems") {
      await expect(page.getByRole("alert")).toHaveText(message);
      await expect(page.locator(".my-problem-row")).toHaveCount(0);
      await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0);
    } else if (path === "/profile") {
      await expect(page.getByRole("alert")).toHaveText(message);
      await expect(page.locator(".profile-card")).toHaveCount(0);
      await expect(page.getByText(`@${privateName}`, { exact: true })).toHaveCount(0);
    } else {
      await expect(page.locator('.stat-tiles[aria-busy="true"]')).toHaveCount(0);
      await expect(page.locator(".stat-tile")).toHaveCount(0);
      await expect(page.locator(".brand-art text")).toHaveCount(0);
    }
    expect(new URL(page.url()).pathname).toBe(path);
  });
}
