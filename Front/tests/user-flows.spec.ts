import { expect, test, type Page } from "@playwright/test";
import type { Problem, Role, Session } from "../src/types";

const storageKey = "unsolvable-oj-session-v1";
const session: Session = {
  accessToken: "browser-test-token",
  tokenType: "Bearer",
  expiresIn: "15m",
  user: {
    id: "solver",
    email: "solver@example.com",
    username: "solver",
    role: "USER",
    level: 1,
    xp: 0,
    rating: 0,
  },
};
const problem: Problem = {
  id: "problem-id",
  slug: "sum",
  title: "두 수의 합",
  difficulty: "BEGINNER",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  status: "PUBLISHED",
  statementMarkdown: "두 정수를 더하세요.",
  inputDescriptionMarkdown: "두 정수",
  outputDescriptionMarkdown: "합",
  samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

async function authenticate(
  page: Page,
  role: Role = "USER",
  expiresAt = Date.now() + 900_000,
) {
  await page.addInitScript(
    ({ key, saved }) => {
      localStorage.setItem(key, JSON.stringify(saved));
    },
    {
      key: storageKey,
      saved: {
        session: { ...session, user: { ...session.user, role } },
        expiresAt,
      },
    },
  );
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/problems") {
      await route.fulfill({
        json: { items: [problem], page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    } else if (path.startsWith("/api/v1/problems/by-slug/")) {
      await route.fulfill({
        json: { ...problem, slug: path.split("/").at(-1) },
      });
    } else {
      await route.fulfill({
        status: 404,
        json: { message: `Unexpected test request: ${path}` },
      });
    }
  });
});

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
  await expect(
    page.getByRole("link", { name: "로그인하고 풀기" }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
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

test("expired sessions cannot access submissions", async ({ page }) => {
  await authenticate(page, "USER", Date.now() - 1000);
  await page.goto("/submissions");
  await expect(page).toHaveURL(/\/auth$/);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), storageKey),
  ).toBeNull();
});

test("regular users cannot open the author form", async ({ page }) => {
  await authenticate(page);
  await page.goto("/problems/new");
  await expect(page).toHaveURL(/\/problems$/);
  await expect(page.getByRole("link", { name: "문제 만들기" })).toHaveCount(0);
});

for (const role of ["AUTHOR", "ADMIN"] as const) {
  test(`${role} creates a problem with the appropriate publication status`, async ({
    page,
  }) => {
    await authenticate(page, role);
    let submitted: Record<string, unknown> | undefined;
    await page.route("**/api/v1/problems", async (route) => {
      submitted = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      await route.fulfill({ status: 201, json: { ...problem, ...submitted } });
    });
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill(problem.title);
    await page.getByLabel("주소용 slug").fill("new");
    await page
      .getByLabel("문제 본문 (Markdown)")
      .fill(problem.statementMarkdown);
    await page.getByLabel("입력", { exact: true }).fill("1 2");
    await page.getByLabel("기대 출력").fill("3");
    await page
      .getByRole("button", {
        name: role === "AUTHOR" ? "초안 저장하기 →" : "문제 게시하기 →",
      })
      .click();
    if (role === "AUTHOR") {
      await expect(
        page.getByRole("heading", { name: "초안을 저장했습니다." }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/problems\/new$/);
    } else {
      await expect(page).toHaveURL(/\/problems\/view\/new$/);
      await expect(
        page.getByRole("heading", { name: problem.title, exact: true }),
      ).toBeVisible();
    }
    expect(submitted).toMatchObject({
      status: role === "AUTHOR" ? "DRAFT" : "PUBLISHED",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    });
  });
}

for (const slug of ["new", "mine"]) {
  test(`public slug ${slug} opens from the problem list`, async ({ page }) => {
    await page.route("**/api/v1/problems?*", (route) =>
      route.fulfill({
        json: {
          items: [{ ...problem, slug }],
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 20,
        },
      }),
    );
    await page.goto("/problems");
    await page.getByRole("link", { name: new RegExp(problem.title) }).click();
    await expect(page).toHaveURL(new RegExp(`/problems/view/${slug}$`));
    await expect(
      page.getByRole("heading", { name: problem.title, exact: true }),
    ).toBeVisible();
  });
}

test("difficulty changes reset pagination", async ({ page }) => {
  // 목록은 공개 문제를 모두 받아 브라우저에서 나눈다. 41문제 = 입문 16 + 어려움 25.
  const items = Array.from({ length: 41 }, (_, index) => ({
    ...problem,
    id: `problem-${index}`,
    slug: `problem-${index}`,
    title: `문제 ${index}`,
    difficulty: index < 16 ? "BEGINNER" : "HARD",
  }));
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items, total: items.length, totalPages: 1, page: 1, limit: 100 },
    }),
  );
  await page.goto("/problems");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await page.getByRole("button", { name: /^어려움/ }).click();
  await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(
    page.getByRole("button", { name: "이전", exact: true }),
  ).toBeDisabled();
});

test("submission passes the source and polls through to the final verdict", async ({
  page,
}) => {
  await authenticate(page);
  const source = "print(sum(map(int, input().split())))";
  const submitted = {
    id: "submission-id",
    problem,
    language: "PYTHON",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 2,
    totalTestCases: 2,
    sourceCode: source,
    compileOutput: null,
    judgeMessage: null,
    createdAt: problem.createdAt,
  };
  await page.route(
    "**/api/v1/problems/problem-id/submissions",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        language: "PYTHON",
        sourceCode: source,
      });
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      await route.fulfill({
        status: 202,
        json: { ...submitted, status: "QUEUED" },
      });
    },
  );
  let reads = 0;
  await page.route("**/api/v1/submissions/submission-id", (route) => {
    const status = ["QUEUED", "JUDGING", "ACCEPTED"][Math.min(reads++, 2)];
    return route.fulfill({ json: { ...submitted, status } });
  });
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill(source);
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  await expect(page).toHaveURL(/\/submissions\/submission-id$/);
  await expect(page.getByText("ACCEPTED", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await page.waitForTimeout(2200); // One full polling period after the terminal response.
  expect(reads).toBe(3);
});

test("submission API errors preserve the source and re-enable submission", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({
      status: 429,
      json: { message: "잠시 후 다시 제출하세요." },
    }),
  );
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(3)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  await expect(page.getByRole("alert")).toHaveText("잠시 후 다시 제출하세요.");
  await expect(page.getByLabel("소스 코드")).toHaveValue("print(3)");
  await expect(
    page.getByRole("button", { name: "제출하고 채점하기 →" }),
  ).toBeEnabled();
});
