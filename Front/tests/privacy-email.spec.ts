import { expect, test, type Page } from "@playwright/test";
import { authenticate, mockProblemApi, session, storageKey } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockProblemApi(page);
  await page.route("**/api/v1/auth/sessions", (route) =>
    route.fulfill({ json: [] }),
  );
});

async function navigateInApp(page: Page, path: string) {
  await page.evaluate((path) => {
    const idx = (history.state?.idx ?? 0) + 1;
    history.pushState(
      { ...history.state, key: `mail-link-${idx}`, idx },
      "",
      path,
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: history.state }),
    );
  }, path);
}

test("opening a different verification fragment in the same route confirms only the new link", async ({
  page,
}) => {
  await authenticate(page);
  const tokens: string[] = [];
  await page.route("**/api/v1/email/verification/confirm", (route) => {
    tokens.push(route.request().postDataJSON().token);
    return route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/verify#token=old-link");
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toBeVisible();
  await page.evaluate(() => {
    history.pushState(
      {
        ...history.state,
        key: "new-verification-link",
        idx: (history.state?.idx ?? 0) + 1,
      },
      "",
      "/email/verify#token=new-link",
    );
    window.dispatchEvent(
      new PopStateEvent("popstate", { state: history.state }),
    );
  });
  await expect(page).toHaveURL(/\/email\/verify$/);
  expect(tokens).toEqual([]);
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  expect(tokens).toEqual(["new-link"]);
});

test("changing only the current fragment replaces an already captured verification link", async ({
  page,
}) => {
  await authenticate(page);
  const tokens: string[] = [];
  await page.route("**/api/v1/email/verification/confirm", (route) => {
    tokens.push(route.request().postDataJSON().token);
    return route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/verify#token=initial-link");
  await expect(page).toHaveURL(/\/email\/verify$/);
  await page.evaluate(() => {
    window.location.hash = "token=changed-fragment";
  });
  await expect(page).toHaveURL(/\/email\/verify$/);
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  expect(tokens).toEqual(["changed-fragment"]);
});

test("back and forward do not recover stripped link secrets and reopening mail captures a fresh link", async ({
  page,
}) => {
  await authenticate(page);
  const requests: Array<{
    path: string;
    token: string;
    authorization?: string;
  }> = [];
  await page.route(
    /\/api\/v1\/email\/(verification\/confirm|unsubscribe)$/,
    (route) => {
      requests.push({
        path: new URL(route.request().url()).pathname,
        token: route.request().postDataJSON().token,
        authorization: route.request().headers().authorization,
      });
      return route.fulfill({ json: { message: "완료" } });
    },
  );
  await page.goto("/email/verify#token=first-verification");
  await expect(page).toHaveURL(/\/email\/verify$/);
  await navigateInApp(page, "/email/unsubscribe#token=second-unsubscribe");
  await expect(
    page.getByRole("button", { name: "이메일 수신 해제 확정" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/email\/unsubscribe$/);
  await page.goBack();
  await expect(page.getByRole("alert")).toContainText(
    "메일의 링크를 다시 열어",
  );
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("alert")).toContainText(
    "메일의 링크를 다시 열어",
  );
  await expect(
    page.getByRole("button", { name: "이메일 수신 해제 확정" }),
  ).toHaveCount(0);
  expect(requests).toEqual([]);

  await navigateInApp(page, "/email/verify#token=reopened-verification");
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  await navigateInApp(page, "/email/unsubscribe#token=reopened-unsubscribe");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "이메일 수신 해제 확정" }).click();
  await expect(page.getByRole("status")).toContainText("수신 해제 요청을 처리");
  expect(requests).toEqual([
    {
      path: "/api/v1/email/verification/confirm",
      token: "reopened-verification",
      authorization: `Bearer ${session.accessToken}`,
    },
    {
      path: "/api/v1/email/unsubscribe",
      token: "reopened-unsubscribe",
      authorization: undefined,
    },
  ]);
});

test("a new verification link aborts the previous request and cannot inherit its completion", async ({
  page,
}) => {
  await authenticate(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tokens: string[] = [];
  await page.route("**/api/v1/email/verification/confirm", async (route) => {
    const token = route.request().postDataJSON().token;
    tokens.push(token);
    if (token === "pending-link") await gate;
    await route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/verify#token=pending-link");
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("button", { name: "처리 중…" })).toBeDisabled();
  await navigateInApp(page, "/email/verify#token=replacement-link");
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toBeEnabled();
  release();
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  expect(tokens).toEqual(["pending-link", "replacement-link"]);
});

test("changing the login resets verification request and result state while retaining the current mail link", async ({
  page,
}) => {
  await authenticate(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Array<{ token: string; authorization: string }> = [];
  await page.route("**/api/v1/email/verification/confirm", async (route) => {
    const authorization = route.request().headers().authorization;
    requests.push({
      token: route.request().postDataJSON().token,
      authorization,
    });
    if (authorization === `Bearer ${session.accessToken}`) await gate;
    await route.fulfill({ json: { message: "완료" } });
  });
  async function switchLogin(accessToken: string) {
    await page.evaluate(
      ({ key, base, accessToken }) => {
        const saved = JSON.stringify({
          session: { ...base, accessToken },
          expiresAt: Date.now() + 900_000,
        });
        localStorage.setItem(key, saved);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key,
            newValue: saved,
            storageArea: localStorage,
          }),
        );
      },
      { key: storageKey, base: session, accessToken },
    );
  }
  await page.goto("/email/verify#token=retained-link");
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("button", { name: "처리 중…" })).toBeDisabled();
  await switchLogin("same-user-new-login");
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toBeEnabled();
  release();
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  await switchLogin("same-user-third-login");
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  expect(requests).toEqual([
    { token: "retained-link", authorization: `Bearer ${session.accessToken}` },
    { token: "retained-link", authorization: "Bearer same-user-new-login" },
    { token: "retained-link", authorization: "Bearer same-user-third-login" },
  ]);
});

test("privacy controls fit a mobile screen and remain keyboard reachable", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/v1/email/preferences", (route) =>
    route.fulfill({
      json: { verified: true, answer: false, accepted: false, enabled: true },
    }),
  );
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
  await panel.getByRole("checkbox").first().focus();
  await page.keyboard.press("Space");
  await expect(panel.getByRole("checkbox").first()).toBeChecked();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/privacy-settings-mobile.png",
    fullPage: true,
  });
});

test("email settings distinguish disabled transport, unverified email and verified opt-in", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
  await expect(panel).toContainText("이메일 발송이 준비되지 않았습니다");
  await expect(
    panel.getByRole("button", { name: "인증 메일 보내기" }),
  ).toBeDisabled();
  await expect(panel.getByRole("checkbox").first()).not.toBeChecked();
  await expect(panel.getByRole("checkbox").first()).toBeDisabled();

  let verified = false;
  let prefs = { answer: false, accepted: false };
  await page.route("**/api/v1/email/preferences", async (route) => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      prefs = route.request().postDataJSON();
    }
    await route.fulfill({ json: { ...prefs, verified, enabled: true } });
  });
  await page.reload();
  await expect(
    panel.getByRole("button", { name: "인증 메일 보내기" }),
  ).toBeEnabled();
  await expect(panel.getByRole("checkbox").first()).toBeDisabled();
  verified = true;
  await page.reload();
  await expect(panel.getByRole("checkbox").first()).toBeEnabled();
  await panel
    .getByRole("checkbox", { name: "내 글에 새 답변이 달렸을 때" })
    .check();
  await panel.getByRole("button", { name: "이메일 알림 저장" }).click();
  await expect(panel.getByRole("status")).toHaveText(
    "이메일 알림 설정을 저장했습니다.",
  );
  expect(prefs).toEqual({ answer: true, accepted: false });
  await page.reload();
  await expect(panel.getByRole("checkbox").first()).toBeChecked();
});

test("email preferences failure never fabricates progress and is retryable", async ({
  page,
}) => {
  await authenticate(page);
  let failed = true;
  await page.route("**/api/v1/email/preferences", (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { message: "잠시 후 다시 시도해 주세요." } }
        : {
            json: {
              verified: true,
              answer: false,
              accepted: false,
              enabled: true,
            },
          },
    ),
  );
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
  await expect(panel.getByRole("alert")).toContainText("잠시 후");
  await expect(
    panel.getByRole("button", { name: "이메일 알림 저장" }),
  ).toHaveCount(0);
  failed = false;
  await panel.getByRole("button", { name: "이메일 설정 다시 시도" }).click();
  await expect(panel.getByRole("checkbox").first()).toBeEnabled();
});

test("failed preference writes preserve chosen options and do not claim success", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/email/preferences", (route) =>
    route.fulfill(
      route.request().method() === "PATCH"
        ? { status: 503, json: { message: "저장 실패" } }
        : {
            json: {
              verified: true,
              answer: false,
              accepted: false,
              enabled: true,
            },
          },
    ),
  );
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
  await panel.getByRole("checkbox").first().check();
  await panel.getByRole("button", { name: "이메일 알림 저장" }).click();
  await expect(panel.getByRole("alert")).toHaveText("저장 실패");
  await expect(panel.getByRole("checkbox").first()).toBeChecked();
  await expect(panel.getByRole("status")).toHaveCount(0);
});

test("users can turn existing email subscriptions off while delivery is disabled", async ({
  page,
}) => {
  await authenticate(page);
  let prefs = { answer: true, accepted: true };
  await page.route("**/api/v1/email/preferences", (route) => {
    if (route.request().method() === "PATCH")
      prefs = route.request().postDataJSON();
    return route.fulfill({
      json: { ...prefs, verified: true, enabled: false },
    });
  });
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
  await panel.getByRole("checkbox").first().uncheck();
  await panel.getByRole("checkbox").nth(1).uncheck();
  await panel.getByRole("button", { name: "이메일 알림 저장" }).click();
  await expect(panel.getByRole("status")).toContainText("저장했습니다");
  expect(prefs).toEqual({ answer: false, accepted: false });
});

for (const verified of [true, false]) {
  test(`users can disable just one existing subscription without mail delivery (verified=${verified})`, async ({
    page,
  }) => {
    await authenticate(page);
    let prefs = { answer: true, accepted: true };
    const writes: unknown[] = [];
    await page.route("**/api/v1/email/preferences", (route) => {
      if (route.request().method() === "PATCH") {
        prefs = route.request().postDataJSON();
        writes.push(prefs);
      }
      return route.fulfill({ json: { ...prefs, verified, enabled: false } });
    });
    await page.goto("/settings");
    const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
    const answer = panel.getByRole("checkbox").first();
    await answer.uncheck();
    // Restoring an unsaved existing consent is not a new opt-in.
    await answer.check();
    await answer.uncheck();
    await expect(panel.getByRole("checkbox").nth(1)).toBeChecked();
    await panel.getByRole("button", { name: "이메일 알림 저장" }).click();
    await expect(panel.getByRole("status")).toContainText("저장했습니다");
    await expect(answer).not.toBeChecked();
    await expect(answer).toBeDisabled();
    await expect(panel.getByRole("checkbox").nth(1)).toBeChecked();
    expect(writes).toEqual([{ answer: false, accepted: true }]);
  });
}

test("verification request shows server failures and suppresses duplicate clicks", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/email/preferences", (route) =>
    route.fulfill({
      json: { verified: false, answer: false, accepted: false, enabled: true },
    }),
  );
  let sent = 0;
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/email/verification/request", async (route) => {
    sent++;
    expect(route.request().postDataJSON()).toEqual({});
    await gate;
    await route.fulfill({
      status: 503,
      json: { message: "메일 발송이 준비되지 않았습니다." },
    });
  });
  await page.goto("/settings");
  const button = page.getByRole("button", { name: "인증 메일 보내기" });
  await button.click();
  await expect(button).toBeDisabled();
  finish();
  await expect(page.getByRole("alert")).toContainText("발송이 준비되지");
  expect(sent).toBe(1);
});

test("withdrawal confirms exact intent, keeps a failed form, then clears the session on success", async ({
  page,
}) => {
  await authenticate(page);
  let succeed = false;
  const bodies: unknown[] = [];
  await page.route("**/api/v1/auth/account", (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.accessToken}`,
    );
    bodies.push(route.request().postDataJSON());
    return route.fulfill(
      succeed
        ? { status: 204 }
        : {
            status: 400,
            json: { message: "현재 비밀번호가 올바르지 않습니다." },
          },
    );
  });
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "회원 탈퇴", exact: true });
  await panel.getByLabel("탈퇴 비밀번호").fill("account-password");
  await panel.getByLabel("확인 문구").fill("탈퇴");
  await expect(
    panel.getByRole("button", { name: "회원 탈퇴 확정" }),
  ).toBeDisabled();
  await panel.getByLabel("확인 문구").fill("회원 탈퇴");
  await panel.getByRole("button", { name: "회원 탈퇴 확정" }).click();
  await expect(panel.getByRole("alert")).toContainText("현재 비밀번호");
  await expect(panel.getByLabel("탈퇴 비밀번호")).toHaveValue(
    "account-password",
  );
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  succeed = true;
  await panel.getByRole("button", { name: "회원 탈퇴 확정" }).click();
  await expect(page).toHaveURL(/\/account\/withdrawn$/);
  await expect(page.getByRole("status")).toHaveText(
    "회원 탈퇴가 완료됐습니다.",
  );
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  expect(bodies).toEqual([
    { currentPassword: "account-password", confirmation: "회원 탈퇴" },
    { currentPassword: "account-password", confirmation: "회원 탈퇴" },
  ]);
});

test("administrators cannot submit withdrawal from settings", async ({
  page,
}) => {
  await authenticate(page, "ADMIN");
  await page.goto("/settings");
  const panel = page.getByRole("region", { name: "회원 탈퇴", exact: true });
  await expect(panel).toContainText("관리자 계정은 바로 탈퇴할 수 없습니다");
  await expect(panel.getByRole("button")).toHaveCount(0);
});

test("a late withdrawal result does not sign out a different account", async ({
  page,
}) => {
  await authenticate(page);
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/v1/auth/account", async (route) => {
    await gate;
    await route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/settings");
  await page.getByLabel("탈퇴 비밀번호").fill("account-password");
  await page.getByLabel("확인 문구").fill("회원 탈퇴");
  await page.getByRole("button", { name: "회원 탈퇴 확정" }).click();
  await expect(
    page.getByRole("button", { name: "탈퇴 처리 중…" }),
  ).toBeDisabled();
  await page.evaluate(
    ({ key, session }) => {
      const saved = JSON.stringify({
        session: {
          ...session,
          accessToken: "other-token",
          user: { ...session.user, id: "other-user", username: "other" },
        },
        expiresAt: Date.now() + 900_000,
      });
      localStorage.setItem(key, saved);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: saved,
          storageArea: localStorage,
        }),
      );
    },
    { key: storageKey, session },
  );
  await expect(page.locator(".account-name")).toHaveText("other");
  finish();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.locator(".account-name")).toHaveText("other");
});

test("verification links remove their secret and mutate only after explicit confirmation", async ({
  page,
}) => {
  await authenticate(page);
  let sent = 0;
  await page.route("**/api/v1/email/verification/confirm", (route) => {
    sent++;
    expect(route.request().postDataJSON()).toEqual({
      token: "verification-secret",
    });
    expect(route.request().headers().authorization).toBe(
      `Bearer ${session.accessToken}`,
    );
    return route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/verify#token=verification-secret");
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/email\/verify$/);
  expect(sent).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "verification-secret",
  );
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("이메일 인증이 완료");
  expect(sent).toBe(1);
});

test("signed-out verification requires login and never automatically confirms", async ({
  page,
}) => {
  await page.goto("/email/verify#token=verification-secret");
  await expect(page.getByRole("link", { name: "로그인하기" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toHaveCount(0);
});

test("verification can resume after login without putting its secret in storage", async ({
  page,
}) => {
  let confirmed = 0;
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ json: session }),
  );
  await page.route("**/api/v1/email/verification/confirm", (route) => {
    confirmed++;
    expect(route.request().postDataJSON()).toEqual({
      token: "login-resume-secret",
    });
    return route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/verify#token=login-resume-secret");
  await page.getByRole("link", { name: "로그인하기" }).click();
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "이메일 인증 확정" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/email\/verify$/);
  expect(confirmed).toBe(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "login-resume-secret",
  );
  await page.getByRole("button", { name: "이메일 인증 확정" }).click();
  await expect(page.getByRole("status")).toContainText("인증이 완료");
  expect(confirmed).toBe(1);
});

test("password-change-required accounts can still unsubscribe without leaving a session token", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, session }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          session: {
            ...session,
            user: { ...session.user, mustChangePassword: true },
          },
          expiresAt: Date.now() + 900_000,
        }),
      ),
    { key: storageKey, session },
  );
  await page.route("**/api/v1/email/unsubscribe", (route) => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ json: { message: "완료" } });
  });
  await page.goto("/email/unsubscribe#token=unsubscribe-secret");
  await page.getByRole("button", { name: "이메일 수신 해제 확정" }).click();
  await expect(page.getByRole("status")).toContainText(
    "수신 해제 요청을 처리했습니다",
  );
});

test("unsubscribe works without a login and requires confirmation with retry on failure", async ({
  page,
}) => {
  let sent = 0;
  await page.route("**/api/v1/email/unsubscribe", (route) => {
    sent++;
    expect(route.request().headers().authorization).toBeUndefined();
    expect(route.request().postDataJSON()).toEqual({
      token: "unsubscribe-secret",
    });
    return route.fulfill(
      sent === 1
        ? { status: 400, json: { message: "유효하지 않은 링크입니다." } }
        : { json: { message: "완료" } },
    );
  });
  await page.goto("/email/unsubscribe#token=unsubscribe-secret");
  const button = page.getByRole("button", { name: "이메일 수신 해제 확정" });
  await expect(button).toBeVisible();
  expect(sent).toBe(0);
  await expect(page).toHaveURL(/\/email\/unsubscribe$/);
  await button.click();
  await expect(page.getByRole("alert")).toHaveText("유효하지 않은 링크입니다.");
  await button.click();
  await expect(page.getByRole("status")).toContainText(
    "수신 해제 요청을 처리했습니다",
  );
  expect(sent).toBe(2);
});
