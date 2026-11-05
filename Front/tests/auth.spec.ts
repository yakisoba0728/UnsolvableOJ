import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi, session, storageKey } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("login returns to the problem and logout removes the saved session", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: session.user.email,
      password: "browser-password",
    });
    await route.fulfill({ json: session });
  });
  await page.goto("/problems/view/sum");
  await page.getByRole("link", { name: "로그인하고 풀기" }).click();
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  await expect(page.getByLabel("소스 코드")).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "로그인" }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("login and logout still work when the browser refuses to store the session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ json: session }),
  );
  await page.goto("/problems/view/sum");
  await page.getByRole("link", { name: "로그인하고 풀기" }).click();
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  await expect(page.locator(".account-name")).toHaveText(session.user.username);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "로그인" }).first(),
  ).toBeVisible();
});

test("registration sends the username and starts a session", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/register", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: session.user.email,
      username: "new_solver",
      password: "browser-password",
    });
    await route.fulfill({ status: 201, json: session });
  });
  await page.goto("/auth");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("사용자 이름").fill("new_solver");
  await page.getByLabel("비밀번호").fill("browser-password");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
});

test("registration shows format problems while typing, before submitting", async ({
  page,
}) => {
  let called = false;
  await page.route("**/api/v1/auth/register", (route) => {
    called = true;
    return route.fulfill({ status: 201, json: session });
  });
  await page.goto("/auth");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  const email = page.getByLabel("이메일");
  const username = page.getByLabel("사용자 이름");
  const password = page.getByLabel("비밀번호");

  // 아직 아무것도 입력하지 않았다면 오류를 보이지 않는다
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);

  await email.pressSequentially("abc");
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("이메일 형식이 올바르지 않아요")).toBeVisible();
  await email.fill("user@example.com");
  await expect(email).not.toHaveAttribute("aria-invalid", "true");

  await username.fill("a b");
  await expect(
    page.getByText("영문, 숫자, 밑줄(_)만 사용할 수 있어요."),
  ).toBeVisible();
  await username.fill("ab");
  await expect(page.getByText("3~30자로 입력해 주세요.")).toBeVisible();
  await username.fill("good_name");
  await expect(username).not.toHaveAttribute("aria-invalid", "true");

  await password.fill("short");
  await expect(page.getByText("10자 이상 입력해 주세요.")).toBeVisible();
  await password.fill("long-enough-password");
  await expect(password).not.toHaveAttribute("aria-invalid", "true");

  // 비워 둔 채 떠난 칸도 안내하고, 잘못된 값으로는 제출되지 않는다
  await password.fill("");
  await email.focus();
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(password).toBeFocused();
  expect(called).toBe(false);
});

test("invalid credentials show the API error and allow retry", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({
      status: 401,
      json: { message: "비밀번호가 올바르지 않습니다." },
    }),
  );
  await page.goto("/auth");
  await page.getByLabel("이메일").fill(session.user.email);
  await page.getByLabel("비밀번호").fill("invalid-password");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "비밀번호가 올바르지 않습니다.",
  );
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeEnabled();
});

test("expired sessions stay signed out without deleting the retained record", async ({ page }) => {
  const expiresAt = Date.now() - 1000;
  const authorizationHeaders: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.headers().authorization)
      authorizationHeaders.push(request.headers().authorization);
  });
  await authenticate(page, "USER", expiresAt);
  await page.goto("/submissions");
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
  await page.goto("/problems");
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  await page.reload();
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  expect(authorizationHeaders).toEqual([]);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBe(JSON.stringify({ session, expiresAt }));
});

for (const path of [
  "/profile",
  "/submissions",
  "/community/new",
  "/problems",
  "/community",
]) {
  test(`logout on ${path} lands on the home page signed out`, async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto(path);
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("link", { name: "로그인" }).first(),
    ).toBeVisible();
  });
}
