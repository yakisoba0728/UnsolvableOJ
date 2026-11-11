import { expect, test, type Page } from "@playwright/test";
import { mockProblemApi, session, storageKey } from "./fixtures";

const jwt = (userId: string, family: string, generation: number) =>
  `e30.${Buffer.from(JSON.stringify({ sub: userId, sid: family, tokenVersion: 0, generation })).toString("base64url")}.signature`;
const oldToken = jwt(session.user.id, "initial-family", 1);
const freshToken = jwt(session.user.id, "initial-family", 2);
const freshSession = {
  ...session,
  accessToken: freshToken,
  refreshToken: "rotated-refresh",
  refreshTokenExpiresAt: new Date(Date.now() + 12 * 3_600_000).toISOString(),
};

async function startProbe(page: Page, token = oldToken) {
  await page.evaluate(async (token) => {
    const modulePath = "/src/api.ts";
    const { api } = await import(modulePath);
    const result = { done: false, success: false };
    (window as unknown as { lineageProbe: typeof result }).lineageProbe =
      result;
    void api("/lineage-probe", { method: "POST" }, token)
      .then(() => {
        result.success = true;
      })
      .catch(() => {})
      .finally(() => {
        result.done = true;
      });
  }, token);
}

async function waitForProbe(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { lineageProbe: { done: boolean } })
            .lineageProbe.done,
      ),
    )
    .toBe(true);
}

async function seed(page: Page, expiresAt = Date.now() + 900_000) {
  await page.addInitScript(
    ({ key, saved }) => {
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(saved));
    },
    {
      key: storageKey,
      saved: {
        session: {
          ...freshSession,
          accessToken: oldToken,
          refreshToken: "initial-refresh",
        },
        expiresAt,
      },
    },
  );
  await mockProblemApi(page);
  await page.route("**/api/v1/auth/sessions", (route) =>
    route.fulfill({ json: [] }),
  );
}

test("a memory-only new login is not replaced by the older login left behind by a failed write", async ({
  page,
}) => {
  await mockProblemApi(page);
  const priorToken = jwt("prior-user", "prior-family", 1);
  await page.addInitScript(
    ({ key, base, token }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          session: {
            ...base,
            accessToken: token,
            user: { ...base.user, id: "prior-user", username: "prior" },
          },
          expiresAt: Date.now() + 900_000,
        }),
      );
      Storage.prototype.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
      Storage.prototype.removeItem = () => {
        throw new DOMException("blocked", "SecurityError");
      };
    },
    { key: storageKey, base: freshSession, token: priorToken },
  );
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      json: {
        ...freshSession,
        accessToken: oldToken,
        refreshToken: "initial-refresh",
      },
    }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ json: freshSession }),
  );
  await page.route("**/api/v1/lineage-probe", (route) =>
    route.fulfill(
      route.request().headers().authorization === `Bearer ${freshToken}`
        ? { json: { ok: true } }
        : { status: 401, json: { message: "다시 로그인해야 합니다." } },
    ),
  );
  await page.goto("/auth");
  await expect(page.locator(".account-name")).toHaveText("prior");
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  await startProbe(page);
  await waitForProbe(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { lineageProbe: { success: boolean } })
          .lineageProbe.success,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).session.accessToken,
      storageKey,
    ),
  ).toBe(priorToken);
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
});

for (const deliveryEnabled of [true, false]) {
  test(`an unsaved email selection survives automatic refresh and the preferences loading gap (delivery=${deliveryEnabled})`, async ({
    page,
  }) => {
    await seed(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writes: unknown[] = [];
    await page.route("**/api/v1/email/preferences", async (route) => {
      const refreshed =
        route.request().headers().authorization === `Bearer ${freshToken}`;
      if (refreshed) await gate;
      if (route.request().method() === "PATCH")
        writes.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          verified: true,
          enabled: !refreshed || deliveryEnabled,
          answer: false,
          accepted: false,
        },
      });
    });
    await page.route("**/api/v1/auth/refresh", (route) =>
      route.fulfill({ json: freshSession }),
    );
    await page.route("**/api/v1/lineage-probe", (route) =>
      route.fulfill(
        route.request().headers().authorization === `Bearer ${freshToken}`
          ? { json: { ok: true } }
          : { status: 401, json: { message: "다시 로그인해야 합니다." } },
      ),
    );
    await page.goto("/settings");
    const panel = page.getByRole("region", { name: "커뮤니티 이메일 알림" });
    await panel.getByRole("checkbox").first().check();
    await startProbe(page);
    await waitForProbe(page);
    await expect(panel).toContainText("이메일 설정을 불러오는 중입니다");
    release();
    const answer = panel.getByRole("checkbox").first();
    await expect(answer).toBeChecked();
    if (!deliveryEnabled) {
      await expect(
        panel.getByRole("button", { name: "이메일 알림 저장" }),
      ).toBeDisabled();
      await expect(answer).toBeEnabled();
      await answer.uncheck();
      await expect(answer).toBeDisabled();
      await panel.getByRole("button", { name: "이메일 알림 저장" }).click();
      await expect(panel.getByRole("status")).toContainText("저장했습니다");
      expect(writes).toEqual([{ answer: false, accepted: false }]);
    }
  });
}

test("a new login of the same user clears the old withdrawal password and confirmation", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/settings");
  await page.getByLabel("탈퇴 비밀번호").fill("old-login-password");
  await page.getByLabel("확인 문구").fill("회원 탈퇴");
  await page.evaluate(
    ({ key, base, token }) => {
      const saved = JSON.stringify({
        session: { ...base, accessToken: token },
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
    {
      key: storageKey,
      base: freshSession,
      token: jwt(session.user.id, "a-new-login", 1),
    },
  );
  await expect(page.getByLabel("탈퇴 비밀번호")).toHaveValue("");
  await expect(page.getByLabel("확인 문구")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "회원 탈퇴 확정" }),
  ).toBeDisabled();
});

for (const action of ["verify", "withdraw"] as const) {
  test(`${action} finishes after an automatic refresh of the same login`, async ({
    page,
  }) => {
    await seed(page);
    await page.route("**/api/v1/auth/refresh", (route) =>
      route.fulfill({ json: freshSession }),
    );
    const authorizations: string[] = [];
    const endpoint =
      action === "verify" ? "email/verification/confirm" : "auth/account";
    await page.route(`**/api/v1/${endpoint}`, (route) => {
      const authorization = route.request().headers().authorization;
      authorizations.push(authorization);
      return route.fulfill(
        authorization === `Bearer ${oldToken}`
          ? { status: 401, json: { message: "다시 로그인해야 합니다." } }
          : action === "withdraw"
            ? { status: 204 }
            : { json: { message: "완료" } },
      );
    });
    await page.goto(
      action === "verify"
        ? "/email/verify#token=verification-secret"
        : "/settings",
    );
    if (action === "verify") {
      await page.getByRole("button", { name: "이메일 인증 확정" }).click();
      await expect(page.getByRole("status")).toContainText(
        "이메일 인증이 완료",
      );
    } else {
      await page.getByLabel("탈퇴 비밀번호").fill("correct-password");
      await page.getByLabel("확인 문구").fill("회원 탈퇴");
      await page.getByRole("button", { name: "회원 탈퇴 확정" }).click();
      await expect(page).toHaveURL(/\/account\/withdrawn$/);
      await expect(page.getByRole("status")).toContainText("회원 탈퇴가 완료");
      expect(
        await page.evaluate((key) => localStorage.getItem(key), storageKey),
      ).toBeNull();
    }
    expect(authorizations).toEqual([
      `Bearer ${oldToken}`,
      `Bearer ${freshToken}`,
    ]);
  });
}

test("an old account request is never replayed with the newly signed-in account's token", async ({
  page,
}) => {
  await seed(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  let refreshes = 0;
  await page.route("**/api/v1/lineage-probe", async (route) => {
    requests++;
    await gate;
    await route.fulfill({
      status: 401,
      json: { message: "다시 로그인해야 합니다." },
    });
  });
  await page.route("**/api/v1/auth/refresh", (route) => {
    refreshes++;
    return route.fulfill({ json: freshSession });
  });
  await page.goto("/settings");
  await page.evaluate(async (token) => {
    const modulePath = "/src/api.ts";
    const { api } = await import(modulePath);
    const result = { done: false };
    (window as unknown as { lineageProbe: typeof result }).lineageProbe =
      result;
    void api("/lineage-probe", { method: "POST" }, token)
      .catch(() => {})
      .finally(() => {
        result.done = true;
      });
  }, oldToken);
  await expect.poll(() => requests).toBe(1);
  await page.evaluate(
    ({ key, base, token }) => {
      const saved = JSON.stringify({
        session: {
          ...base,
          accessToken: token,
          user: { ...base.user, id: "another-user", username: "another" },
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
    {
      key: storageKey,
      base: freshSession,
      token: jwt("another-user", "different-family", 1),
    },
  );
  await expect(page.locator(".account-name")).toHaveText("another");
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { lineageProbe: { done: boolean } })
            .lineageProbe.done,
      ),
    )
    .toBe(true);
  expect(requests).toBe(1);
  expect(refreshes).toBe(0);
  await expect(page.locator(".account-name")).toHaveText("another");
});

test("a refresh response arriving after logout cannot restore the previous session", async ({
  page,
}) => {
  await seed(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshes = 0;
  await page.route("**/api/v1/lineage-probe", (route) =>
    route.fulfill({
      status: 401,
      json: { message: "다시 로그인해야 합니다." },
    }),
  );
  await page.route("**/api/v1/auth/refresh", async (route) => {
    refreshes++;
    await gate;
    await route.fulfill({ json: freshSession });
  });
  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/settings");
  await page.evaluate(async (token) => {
    const modulePath = "/src/api.ts";
    const { api } = await import(modulePath);
    const result = { done: false };
    (window as unknown as { lineageProbe: typeof result }).lineageProbe =
      result;
    void api("/lineage-probe", {}, token)
      .catch(() => {})
      .finally(() => {
        result.done = true;
      });
  }, oldToken);
  await expect.poll(() => refreshes).toBe(1);
  await page
    .locator("header")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }).first(),
  ).toBeVisible();
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { lineageProbe: { done: boolean } })
            .lineageProbe.done,
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }).first(),
  ).toBeVisible();
});

test("a late withdrawal does not clear a new login of the same user with a different session family", async ({
  page,
}) => {
  await seed(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/auth/account", async (route) => {
    await gate;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/settings");
  await page.getByLabel("탈퇴 비밀번호").fill("correct-password");
  await page.getByLabel("확인 문구").fill("회원 탈퇴");
  await page.getByRole("button", { name: "회원 탈퇴 확정" }).click();
  await expect(
    page.getByRole("button", { name: "탈퇴 처리 중…" }),
  ).toBeDisabled();
  const nextToken = jwt(session.user.id, "explicit-new-login", 1);
  await page.evaluate(
    ({ key, base, token }) => {
      const saved = JSON.stringify({
        session: {
          ...base,
          accessToken: token,
          refreshToken: "explicit-new-refresh",
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
    { key: storageKey, base: freshSession, token: nextToken },
  );
  release();
  await expect(
    page.getByRole("button", { name: "회원 탈퇴 확정" }),
  ).toBeDisabled();
  await expect(page.getByLabel("탈퇴 비밀번호")).toHaveValue("");
  await expect(page.getByLabel("확인 문구")).toHaveValue("");
  await expect(page).toHaveURL(/\/settings$/);
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).session.accessToken,
      storageKey,
    ),
  ).toBe(nextToken);
});

for (const action of ["logout", "another-login"] as const) {
  test(`a refresh cannot overwrite another tab's ${action} when its storage event is delayed`, async ({
    page,
    context,
  }) => {
    // Withhold event delivery while preserving real shared localStorage, forcing
    // the post-refresh storage read to detect a change before the event arrives.
    await page.addInitScript(() => {
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (
        type,
        callback,
        options,
      ) {
        if (this === window && type === "storage") return;
        return add.call(this, type, callback, options);
      };
    });
    await seed(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshes = 0;
    await page.route("**/api/v1/lineage-probe", (route) =>
      route.fulfill({
        status: 401,
        json: { message: "다시 로그인해야 합니다." },
      }),
    );
    await page.route("**/api/v1/auth/refresh", async (route) => {
      refreshes++;
      await gate;
      await route.fulfill({ json: freshSession });
    });
    await page.goto("/settings");
    await startProbe(page);
    await expect.poll(() => refreshes).toBe(1);
    const other = await context.newPage();
    await mockProblemApi(other);
    await other.goto("/auth");
    const nextToken = jwt("different-user", "other-tab-family", 1);
    await other.evaluate(
      ({ key, base, action, token }) => {
        if (action === "logout") localStorage.removeItem(key);
        else
          localStorage.setItem(
            key,
            JSON.stringify({
              session: {
                ...base,
                accessToken: token,
                user: {
                  ...base.user,
                  id: "different-user",
                  username: "different",
                },
              },
              expiresAt: Date.now() + 900_000,
            }),
          );
      },
      { key: storageKey, base: freshSession, action, token: nextToken },
    );
    // The app still has its old view, so this is not just a normal event handler test.
    await expect(page.locator(".account-name")).toHaveText(
      session.user.username,
    );
    release();
    await waitForProbe(page);
    if (action === "logout") {
      expect(
        await page.evaluate((key) => localStorage.getItem(key), storageKey),
      ).toBeNull();
      await expect(
        page.getByRole("link", { name: "로그인", exact: true }).first(),
      ).toBeVisible();
    } else {
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).session.accessToken,
          storageKey,
        ),
      ).toBe(nextToken);
      await expect(page.locator(".account-name")).toHaveText("different");
    }
    await other.close();
  });
}

test("a timer refresh cannot resurrect logout when removeItem fails but getItem still reads the old login", async ({
  page,
}) => {
  await page.clock.install();
  await seed(page, Date.now() + 120_000);
  await page.addInitScript((key) => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (name) {
      if (name === key) throw new DOMException("blocked", "SecurityError");
      return remove.call(this, name);
    };
  }, storageKey);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let refreshes = 0;
  await page.route("**/api/v1/auth/refresh", async (route) => {
    refreshes++;
    await gate;
    await route.fulfill({ json: freshSession });
  });
  await page.route("**/api/v1/auth/logout", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.goto("/settings");
  await page.clock.fastForward(61_000);
  await expect.poll(() => refreshes).toBe(1);
  await page
    .locator("header")
    .getByRole("button", { name: "로그아웃", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).session.accessToken,
      storageKey,
    ),
  ).toBe(oldToken);
  const response = page.waitForResponse("**/api/v1/auth/refresh");
  release();
  await (await response).finished();
  await page.clock.runFor(100);
  await expect(
    page.getByRole("link", { name: "로그인", exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".account-name")).toHaveCount(0);
});

test("a memory-only login can refresh when setItem fails and getItem returns no stored session", async ({
  page,
}) => {
  await mockProblemApi(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
  });
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      json: {
        ...freshSession,
        accessToken: oldToken,
        refreshToken: "initial-refresh",
      },
    }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({ json: freshSession }),
  );
  const headers: string[] = [];
  await page.route("**/api/v1/lineage-probe", (route) => {
    const header = route.request().headers().authorization;
    headers.push(header);
    return route.fulfill(
      header === `Bearer ${freshToken}`
        ? { json: { ok: true } }
        : { status: 401, json: { message: "다시 로그인해야 합니다." } },
    );
  });
  await page.goto("/auth");
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호", { exact: true }).fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  await startProbe(page);
  await waitForProbe(page);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { lineageProbe: { success: boolean } })
          .lineageProbe.success,
    ),
  ).toBe(true);
  expect(headers).toEqual([`Bearer ${oldToken}`, `Bearer ${freshToken}`]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
});
