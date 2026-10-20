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
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "로그인" }).first(),
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
    // A new slug must not exist during the debounced duplicate check. Once
    // created, ADMIN's redirect can read the published problem at this URL.
    await page.route("**/api/v1/problems/by-slug/new", (route) =>
      submitted
        ? route.fulfill({ json: { ...problem, ...submitted } })
        : route.fulfill({ status: 404, json: { message: "Not found" } }),
    );
    await page.route("**/api/v1/problems", async (route) => {
      submitted = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      await route.fulfill({ status: 201, json: { ...problem, ...submitted } });
    });
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill(problem.title);
    const slugChecked = page.waitForResponse("**/api/v1/problems/by-slug/new");
    await page.getByLabel("주소용 slug").fill("new");
    await page
      .getByLabel("문제 본문 (Markdown)")
      .fill(problem.statementMarkdown);
    await page.getByLabel("입력 설명").fill("두 정수");
    await page.getByLabel("출력 설명").fill("합");
    await page.getByLabel("입력", { exact: true }).fill("1 2");
    await page.getByLabel("기대 출력").fill("3");
    expect((await slugChecked).status()).toBe(404);
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

test.describe("problem editor", () => {
  test("empty form shows field errors and does not call the API", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    let posted = false;
    await page.route("**/api/v1/problems", (route) => {
      posted = true;
      return route.fulfill({ status: 201, json: problem });
    });
    await page.goto("/problems/new");
    await page.getByRole("button", { name: "초안 저장하기 →" }).click();
    await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("문제 본문을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("출력 형식을 설명해 주세요.")).toBeVisible();
    await expect(page.getByText("기대 출력을 입력해 주세요.")).toBeVisible();
    expect(posted).toBe(false);
  });

  test("slug follows an English title until edited by hand", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill("Sum Of Two");
    await expect(page.getByLabel("주소용 slug")).toHaveValue("sum-of-two");
    await page.getByLabel("주소용 slug").fill("my-sum");
    await page.getByLabel("제목", { exact: true }).fill("Sum Of Three");
    await expect(page.getByLabel("주소용 slug")).toHaveValue("my-sum");
  });

  test("preview tab renders the markdown", async ({ page }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("문제 본문 (Markdown)").fill("**굵게** 설명");
    await page.getByRole("tab", { name: "미리보기" }).first().click();
    await expect(page.locator(".md-preview strong")).toHaveText("굵게");
  });

  test("test cases can be duplicated and switched between sample and hidden", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await expect(page.getByText("예제 1개", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "복제" }).click();
    await expect(page.getByText("예제 2개", { exact: true })).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "테스트 2 공개 여부" })
      .getByText("숨김", { exact: true })
      .click();
    await expect(page.getByText("예제 1개", { exact: true })).toBeVisible();
    await expect(page.getByText("숨김 1개", { exact: true })).toBeVisible();
  });

  test("an unsaved draft is restored after reload", async ({ page }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill("임시 저장 문제");
    await expect(page.getByText(/임시 저장됨/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("작성 중이던 문제를 불러왔어요."),
    ).toBeVisible();
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
      "임시 저장 문제",
    );
  });

  test("author edits an existing problem from the my problems list", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    const managed = {
      ...problem,
      status: "PUBLISHED",
      statementMarkdown: "본문\n\n## 힌트\n작은 수부터",
      testCases: [
        { input: "1 2\n", expectedOutput: "3\n", isSample: true, score: 1 },
        { input: "5 5\n", expectedOutput: "10\n", isSample: false, score: 1 },
      ],
    };
    let patched: Record<string, unknown> | undefined;
    await page.route("**/api/v1/problems/mine", (route) =>
      route.fulfill({
        json: [
          {
            id: problem.id,
            slug: problem.slug,
            title: problem.title,
            status: "PUBLISHED",
            difficulty: problem.difficulty,
            currentVersion: 1,
            updatedAt: problem.updatedAt,
          },
        ],
      }),
    );
    await page.route(`**/api/v1/problems/${problem.id}/manage`, (route) =>
      route.fulfill({ json: managed }),
    );
    await page.route(`**/api/v1/problems/${problem.id}`, async (route) => {
      patched = route.request().postDataJSON();
      await route.fulfill({ json: managed });
    });
    await page.goto("/my-problems");
    await page.getByRole("link", { name: "수정" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/my-problems/${problem.id}/edit$`),
    );
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
      problem.title,
    );
    await expect(page.getByLabel("주소용 slug")).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(page.getByText("숨김 1개", { exact: true })).toBeVisible();
    await page.getByLabel("제목", { exact: true }).fill("수정한 제목");
    await page.getByRole("button", { name: "수정 저장하기 →" }).click();
    await expect(page).toHaveURL(/\/my-problems$/);
    await expect(page.getByText(/초안으로 돌아가며/)).toBeVisible();
    expect(patched).toMatchObject({ title: "수정한 제목" });
    expect(String(patched?.statementMarkdown)).toContain("## 힌트");
    expect(patched).not.toHaveProperty("slug");
  });
});

for (const slug of ["new", "mine"]) {
  test(`public slug ${slug} opens from the problem list`, async ({ page }) => {
    await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
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
  await page
    .getByRole("group", { name: "난이도 필터" })
    .getByRole("button", { name: /^어려움/ })
    .click();
  await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
  await expect(page).not.toHaveURL(/[?&]page=/);
  await expect(
    page.getByRole("button", { name: "이전", exact: true }),
  ).toBeDisabled();
  // 선택된 필터를 다시 누르면 전체로 돌아가고, 필터 초기화 버튼은 없다.
  await page
    .getByRole("group", { name: "난이도 필터" })
    .getByRole("button", { name: /^어려움/ })
    .click();
  await expect(page).not.toHaveURL(/[?&]d=/);
  await expect(
    page
      .getByRole("group", { name: "난이도 필터" })
      .getByRole("button", { name: /^전체/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "필터 초기화" })).toHaveCount(
    0,
  );
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
  // 화면을 옮기지 않고 코드 창 아래 채점 결과 패널에서 바로 확인한다.
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  await expect(panel.getByText("성공", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(panel.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(page.getByLabel("소스 코드")).toHaveValue(source);
  await page.waitForTimeout(2200); // One full polling period after the terminal response.
  expect(reads).toBe(3);
});

test("the home illustration shows the level badge only for a signed-in user, with their own level and XP", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".brand-art").first()).toBeAttached();
  await expect(page.locator(".brand-art text")).toHaveCount(0);

  await authenticate(page);
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        ...session.user,
        level: 4,
        xp: 372,
        createdAt: "2026-09-01T00:00:00Z",
        solvedCount: 5,
      },
    }),
  );
  await page.route("**/api/v1/rankings", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  const badge = page.locator(".brand-art");
  await expect(badge.getByText("Lv.4")).toBeAttached();
  await expect(badge.getByText("372 XP")).toBeAttached();
});

test("the problem list has a reverse-order button that is replaced by the shuffle button in random order", async ({
  page,
}) => {
  const make = (
    id: string,
    title: string,
    difficulty: Problem["difficulty"],
    at: string,
  ) => ({
    ...problem,
    id,
    slug: id,
    title,
    difficulty,
    createdAt: at,
  });
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: {
        items: [
          make("p-a", "가 문제", "HARD", "2026-09-01T00:00:00Z"),
          make("p-b", "나 문제", "BEGINNER", "2026-09-03T00:00:00Z"),
          make("p-c", "다 문제", "MEDIUM", "2026-09-02T00:00:00Z"),
        ],
        page: 1,
        limit: 100,
        total: 3,
        totalPages: 1,
      },
    }),
  );
  // 화면이 다시 그려질 때까지 자동으로 기다리며 순서를 확인한다.
  const expectTitles = (expected: string[]) =>
    expect(page.locator(".problem-row .problem-title strong")).toHaveText(
      expected,
    );
  const reverse = page.getByRole("button", { name: "목록 순서 뒤집기" });

  await page.goto("/problems");
  await expectTitles(["나 문제", "다 문제", "가 문제"]); // 최신순
  await reverse.click();
  // 위·아래 화살표가 각자 방향으로 움직이는 애니메이션이 실행된다.
  await expect(reverse.locator(".reverse-arrow-up")).toHaveCount(1);
  await expect(reverse.locator(".reverse-arrow-down")).toHaveCount(1);
  await expect(reverse).toHaveAttribute("aria-pressed", "true");
  await expectTitles(["가 문제", "다 문제", "나 문제"]);
  await reverse.click();
  await expectTitles(["나 문제", "다 문제", "가 문제"]);

  await page.goto("/problems?sort=difficulty");
  await expectTitles(["나 문제", "다 문제", "가 문제"]); // 쉬운 순
  await reverse.click();
  await expectTitles(["가 문제", "다 문제", "나 문제"]);
  // 옛 주소도 같은 목록을 보여 준다.
  await page.goto("/problems?sort=hard");
  await expectTitles(["가 문제", "다 문제", "나 문제"]);

  await page.goto("/problems?sort=random&seed=3");
  await expect(
    page.getByRole("button", { name: "무작위로 다시 섞기" }),
  ).toBeVisible();
  await expect(reverse).toHaveCount(0);
});

test("typing #word and pressing Enter in the community search makes a tag pill that filters posts", async ({
  page,
}) => {
  const post = (id: string, title: string, tags: string[], at: string) => ({
    id,
    category: "question",
    title,
    body: `${title} 본문`,
    author: { name: "other", tier: "Bronze I" },
    tags,
    createdAt: at,
    views: 1,
    upvotes: 0,
  });
  await page.addInitScript(
    (value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    },
    {
      posts: [
        post("t-1", "그리디 질문", ["greedy", "dp"], "2026-10-03T00:00:00Z"),
        post("t-2", "다이나믹 질문", ["dp"], "2026-10-02T00:00:00Z"),
        post("t-3", "태그 없는 질문", [], "2026-10-01T00:00:00Z"),
      ],
      answers: [],
      upvoted: [],
      saved: [],
      followed: [],
      accepted: {},
      deleted: [],
    },
  );
  await page.goto("/community?q=");
  const search = page.getByRole("searchbox", { name: "게시글 검색" });
  const rows = page.locator(".post-row .post-title");
  const pills = page.locator(".search-tag");

  // 일반 검색어는 제목에서만 찾는다: 태그에만 있는 단어('greedy')나 본문에만 있는 단어는 걸리지 않는다.
  await search.fill("greedy");
  await expect(rows).toHaveCount(0);
  await search.fill("본문");
  await expect(rows).toHaveCount(0);
  await search.fill("그리디");
  await expect(rows).toHaveCount(1);
  await search.fill("");
  await expect(rows).toHaveCount(3);

  // 띄어쓰기가 있으면 태그가 아니라 일반 검색어로 남는다.
  await search.fill("#dp 질문");
  await search.press("Enter");
  await expect(pills).toHaveCount(0);

  // '#' 만으로는 태그가 되지 않는다.
  await search.fill("#");
  await search.press("Enter");
  await expect(pills).toHaveCount(0);

  await search.fill("#dp");
  await search.press("Enter");
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toHaveText("#dp");
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/[?&]t=dp/);
  await expect(rows.filter({ hasText: "태그 없는 질문" })).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  // 태그를 하나 더 고르면 두 태그를 모두 가진 글만 남는다. 같은 태그는 중복되지 않는다.
  await search.fill("#GREEDY");
  await search.press("Enter");
  await search.fill("#dp");
  await search.press("Enter");
  await expect(pills).toHaveCount(2);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText("그리디 질문");

  // 입력칸이 비어 있을 때 Backspace로 마지막 태그를 지운다.
  await search.press("Backspace");
  await expect(pills).toHaveCount(1);
  await expect(rows).toHaveCount(2);

  // × 버튼으로도 지울 수 있다.
  await page.getByRole("button", { name: "태그 #dp 지우기" }).click();
  await expect(pills).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]t=/);
});

test("the write page puts tags and a narrow category on one row and the save hint with the buttons on one line", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community/new");
  // 글꼴이 다 불러와져 줄 높이가 안정된 뒤에 위치를 잰다(전체 테스트를 함께 돌릴 때 간헐적으로 어긋나던 것을 막는다).
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".tag-input")).toBeVisible();
  await expect(page.locator(".field-category .select-button")).toBeVisible();
  const box = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!;
  const tag = await box(".tag-input");
  const category = await box(".field-category .select-button");
  // 같은 행: 세로 위치(상·하)가 같고, 카테고리는 태그 오른쪽에서 훨씬 좁다.
  expect(Math.abs(tag.y - category.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(tag.height - category.height)).toBeLessThanOrEqual(2);
  expect(category.x).toBeGreaterThan(tag.x + tag.width);
  expect(category.width).toBeLessThan(tag.width / 3);

  // 임시 저장 안내와 취소·임시 저장·글 등록 버튼은 한 줄에서 세로 가운데가 같다.
  const centerY = async (selector: string) => {
    const b = await box(selector);
    return b.y + b.height / 2;
  };
  const hint = await centerY(".write-hint");
  for (const name of ["취소", "임시 저장", "글 등록"]) {
    const b = (await page
      .getByRole("button", { name, exact: true })
      .last()
      .boundingBox())!;
    expect(Math.abs(b.y + b.height / 2 - hint)).toBeLessThanOrEqual(2);
  }
});

test("the write page shows field problems while typing like sign-up, has a tall body and a markdown preview", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community/new");
  const title = page.locator('input[placeholder^="예:"]');
  const body = page.locator("#body-input");
  const tagInput = page.locator("#tag-input");

  // 본문 칸은 기본으로 크다.
  expect((await body.boundingBox())!.height).toBeGreaterThanOrEqual(450);

  // 건드리기 전에는 안내가 없고, 비운 채 떠나면 안내가 뜬다(회원가입과 같은 방식).
  await expect(page.getByText("제목을 입력해 주세요.")).toHaveCount(0);
  await title.focus();
  await title.blur();
  await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await title.fill("제목");
  await expect(page.getByText("제목을 입력해 주세요.")).toHaveCount(0);

  // 태그는 띄어쓰기 없이 한 단어만: 어긋나면 안내하고 등록하지 않는다.
  await tagInput.fill("a b");
  await expect(
    page.getByText("태그는 띄어쓰기 없이 한 단어로 입력해 주세요."),
  ).toBeVisible();
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(0);
  await tagInput.fill("dp");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(1);

  // 필수인 본문을 비운 채 등록하면 안내가 뜨고 본문으로 이동한다.
  await page.getByRole("button", { name: "글 등록" }).click();
  await expect(page.getByText("본문을 입력해 주세요.")).toBeVisible();
  await expect(body).toBeFocused();

  // 미리보기: 코드 블록과 굵은 글씨가 글 상세와 같은 방식으로 그려진다.
  await body.fill("설명 **굵게** 와 *기울임*\n\n```js\nconst a = 1;\n```\n");
  await expect(page.getByText("본문을 입력해 주세요.")).toHaveCount(0);
  await page.getByRole("tab", { name: "미리보기" }).click();
  const preview = page.locator(".write-body-preview .markdown");
  await expect(preview.locator("strong")).toHaveText("굵게");
  // 기울임: 글꼴에 이탤릭이 없어도 비스듬히 그려지도록 합성을 허용한다(전역 설정은 none).
  await expect(preview.locator("em")).toHaveCount(1);
  await expect(preview.locator("em")).toHaveCSS("font-synthesis", /style/);
  await expect(preview.locator("pre code")).toContainText("const a = 1;");
  await page.getByRole("tab", { name: "작성" }).click();
  await expect(body).toHaveValue(/const a = 1;/);
});

test("the home problem slider stays inside the page container and fades only on the side that has more cards", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 12,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/");
  const area = page.locator(".slider-area");
  const track = page.locator(".slider-track");
  await expect(track.locator(".problem-card").first()).toBeVisible();

  // 트랙은 화면 끝까지 퍼지지 않고, 위·아래 카드와 같은 컨테이너 폭에 머문다.
  const areaBox = (await area.boundingBox())!;
  const trackBox = (await track.boundingBox())!;
  expect(Math.abs(trackBox.x - areaBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(trackBox.width - areaBox.width)).toBeLessThanOrEqual(1);
  expect(trackBox.width).toBeLessThan(1440 - 100);

  // 처음에는 오른쪽만(더 볼 카드가 있는 쪽), 중간에서는 양쪽, 끝에서는 왼쪽만 흐려진다.
  await expect(area).toHaveClass(/can-forward/);
  await expect(area).not.toHaveClass(/can-back/);
  await track.evaluate((el) => {
    el.scrollLeft = el.scrollWidth / 3;
  });
  await expect(area).toHaveClass(/can-back/);
  await expect(area).toHaveClass(/can-forward/);
  await track.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(area).toHaveClass(/can-back/);
  await expect(area).not.toHaveClass(/can-forward/);
});

test("the collapsed menu opens as a full-width panel right under the header on narrow screens", async ({
  page,
}) => {
  await authenticate(page, "AUTHOR");
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    const nav = page.locator("#main-menu");
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: /메뉴/ }).first().click();
    await expect(nav).toBeVisible();
    const header = (await page.locator(".site-header").boundingBox())!;
    const box = (await nav.boundingBox())!;
    // 헤더 줄에 끼지 않고, 헤더 바로 아래에서 화면 전체 폭으로 펼쳐진다.
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(2);
    await expect(nav).toHaveCSS("position", "absolute");
    // 항목은 한 줄에 하나씩 쌓인다.
    const links = nav.locator("a");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(7);
    let previousBottom = -1;
    for (let index = 0; index < count; index += 1) {
      const link = (await links.nth(index).boundingBox())!;
      expect(link.y).toBeGreaterThanOrEqual(previousBottom - 1);
      expect(link.width).toBeGreaterThan(width * 0.8);
      previousBottom = link.y + link.height;
    }
  }
});

test("community list: the vote and view columns are right-aligned like the problem list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(
    (value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    },
    {
      posts: [
        {
          id: "c-1",
          category: "question",
          title: "정렬 확인",
          body: "본문",
          author: { name: "other", tier: "Bronze I" },
          tags: [],
          createdAt: "2026-10-03T00:00:00Z",
          views: 1234,
          upvotes: 5,
        },
      ],
      answers: [],
      upvoted: [],
      saved: [],
      followed: [],
      accepted: {},
      deleted: [],
    },
  );
  await page.goto("/community?q=%EC%A0%95%EB%A0%AC");
  await expect(page.locator(".post-row")).toHaveCount(1);
  // 글자(범위) 기준으로 목록 오른쪽 끝에서 얼마나 떨어졌는지 잰다.
  const gap = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const list = document
          .querySelector(".list-posts")!
          .getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(list.right - range.getBoundingClientRect().right);
      });
  // 마지막 열(조회 수)은 안쪽 여백(24px + 테두리 1px)에 닿고, 머리글과 값의 오른쪽 끝이 같다.
  expect(await gap(".post-head span:last-child")).toBeLessThanOrEqual(26);
  expect(await gap(".post-row .post-num-view")).toBeLessThanOrEqual(26);
  // 추천 열도 머리글과 값의 오른쪽 끝이 같다(열 폭 72px 안에서 오른쪽에 붙는다).
  const headVote = await gap(".post-head span:nth-child(3)");
  const rowVote = await gap(".post-row .post-num-up");
  expect(Math.abs(headVote - rowVote)).toBeLessThanOrEqual(2);
});

test("the problem list side cards are 291px wide and fit their content", async ({
  page,
}) => {
  await authenticate(page, "AUTHOR");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/problems");
  await expect(page.locator(".problem-row")).toHaveCount(1);
  const side = (await page.locator(".side-stack").boundingBox())!;
  const list = (await page.locator(".list-layout > section").boundingBox())!;
  // 오른쪽 카드 열은 예전 320px과 줄였던 262px의 중간인 291px이고, 그만큼 목록이 넓어진다.
  expect(Math.round(side.width)).toBe(291);
  expect(list.width).toBeGreaterThan(850);
  // 카드 안의 어떤 요소도 카드 밖으로 넘치지 않는다.
  const overflowing = await page.locator(".side-stack").evaluate((root) => {
    const limit = root.getBoundingClientRect().right + 1;
    return [...root.querySelectorAll("*")].filter(
      (element) => element.getBoundingClientRect().right > limit,
    ).length;
  });
  expect(overflowing).toBe(0);
});

test("the grading result panel can be resized by dragging or with arrow keys, and remembers its height", async ({
  page,
}) => {
  await authenticate(page);
  const submitted = {
    id: "submission-id",
    problem,
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 2,
    totalTestCases: 2,
    sourceCode: "print(1)",
    compileOutput: null,
    judgeMessage: null,
    createdAt: problem.createdAt,
  };
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({ status: 202, json: submitted }),
  );
  await page.route("**/api/v1/submissions/submission-id", (route) =>
    route.fulfill({ json: submitted }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(1)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel).toBeVisible();
  const handle = page.getByRole("separator", { name: "채점 결과 높이 조절" });
  const before = (await panel.boundingBox())!.height;

  // 위로 끌면 커지고, 아래로 끌면 줄어든다.
  const grip = (await handle.boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 4 });
  await page.mouse.up();
  const taller = (await panel.boundingBox())!.height;
  expect(taller).toBeGreaterThan(before + 60);

  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const shorter = (await panel.boundingBox())!.height;
  expect(shorter).toBeLessThan(taller - 30);

  // 다시 열어도 마지막 높이를 기억한다.
  await page.reload();
  await page.getByLabel("소스 코드").fill("print(1)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  await expect(panel).toBeVisible();
  expect(
    Math.abs((await panel.boundingBox())!.height - shorter),
  ).toBeLessThanOrEqual(2);
});

test("my submissions can be searched, filtered and grouped by problem", async ({
  page,
}) => {
  await authenticate(page);
  const make = (
    id: string,
    title: string,
    status: string,
    language: string,
    at: string,
  ) => ({
    id,
    problem: { id: `p-${title}`, slug: title, title },
    language,
    status,
    runtimeMs: 10,
    memoryKb: 2048,
    passedTestCases: status === "ACCEPTED" ? 2 : 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    createdAt: at,
    updatedAt: at,
  });
  const items = [
    make("s4", "피보나치", "WRONG_ANSWER", "PYTHON", "2026-10-04T00:00:00Z"),
    make("s3", "피보나치", "ACCEPTED", "CPP", "2026-10-03T00:00:00Z"),
    make("s2", "정렬", "WRONG_ANSWER", "PYTHON", "2026-10-02T00:00:00Z"),
    make("s1", "정렬", "WRONG_ANSWER", "PYTHON", "2026-10-01T00:00:00Z"),
  ];
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, total: 4, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  await page.goto("/submissions");
  const rows = page.locator(".history-row");
  await expect(rows).toHaveCount(4);

  // 테스트 케이스 결과는 제목 아래가 아니라 '테스트' 열에 N/N 으로만 보이고, 끝 화살표는 없다.
  await expect(page.locator(".history-head")).toContainText("테스트");
  await expect(rows.first().locator(".history-tests")).toHaveText(/^\d+\/\d+$/);
  await expect(rows.locator(".row-arrow")).toHaveCount(0);
  await expect(page.locator(".history-title small")).toHaveCount(0);
  await expect(page.getByText("통과", { exact: false })).toHaveCount(0);
  // 제목을 뺀 열은 모두 오른쪽 정렬이고, 오른쪽 끝(제출 시각)이 목록 안쪽 여백에 닿는다.
  const rightGap = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const list = document
          .querySelector(".list-history")!
          .getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        return Math.round(list.right - range.getBoundingClientRect().right);
      });
  expect(await rightGap(".history-head span:last-child")).toBeLessThanOrEqual(
    26,
  );
  expect(await rightGap(".history-row .history-time")).toBeLessThanOrEqual(26);

  const verdicts = page.getByRole("group", { name: "판정 필터" });
  await verdicts.getByRole("button", { name: /^성공/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("피보나치");
  // 선택한 항목을 다시 누르면 전체로 돌아간다
  await verdicts.getByRole("button", { name: /^성공/ }).click();
  await expect(rows).toHaveCount(4);

  // ⌘/Ctrl+클릭으로 같은 종류 안에서 여러 개를 고른다(성공 + 틀림·오류 = 전부)
  await verdicts
    .getByRole("button", { name: /^성공/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(rows).toHaveCount(1);
  await verdicts
    .getByRole("button", { name: /^틀림/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(rows).toHaveCount(4);
  await expect(page).toHaveURL(/s=accepted%2Cwrong/);
  // '전체'는 수정자 키를 무시하고 단독 선택으로 돌아간다
  await verdicts
    .getByRole("button", { name: /^전체/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page).not.toHaveURL(/s=/);
  await expect(verdicts.getByRole("button", { name: /^전체/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("제출한 문제 검색").fill("정렬");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("제출한 문제 검색").fill("");
  await expect(rows).toHaveCount(4);

  await page
    .getByRole("radiogroup", { name: "보기 방식" })
    .getByText("문제별 최신")
    .click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("이 문제 2회 제출");
});

test("list rows are whole-row links reachable and openable with the keyboard", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items: [problem], total: 1, totalPages: 1, page: 1, limit: 20 },
    }),
  );
  await page.goto("/problems");
  const row = page.locator("a.problem-row").first();
  await expect(row).toHaveAttribute("href", /\/problems\/view\/sum$/);
  await row.focus();
  await expect(row).toBeFocused();
  const outline = await row.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
});

test("filter toggles allow ⌘/Ctrl+click multi-select within one group only", async ({
  page,
}) => {
  // 샘플 글이 없는 환경에서도 같은 결과가 나오도록 이 테스트가 쓸 글을 저장소에 직접 넣어 둔다.
  const author = { name: "tester", tier: "브론즈" };
  const post = (
    id: string,
    category: string,
    title: string,
    pinned = false,
  ) => ({
    id,
    category,
    title,
    body: "본문",
    tags: [],
    author,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 1,
    views: 10,
    ...(pinned ? { pinned: true } : {}),
  });
  await page.addInitScript(
    (posts) => {
      localStorage.setItem(
        "unsolvable-oj-community-v1",
        JSON.stringify({
          posts,
          answers: [],
          upvoted: [],
          saved: [],
          followed: [],
          accepted: {},
        }),
      );
    },
    [
      post("t-notice", "notice", "고정 공지", true),
      post("t-q1", "question", "질문 하나"),
      post("t-q2", "question", "질문 둘"),
      post("t-f1", "free", "자유 글"),
      post("t-s1", "solution", "풀이 공유 글"),
    ],
  );
  await page.goto("/community");
  const category = page.getByRole("group", { name: "분류 필터" });
  const status = page.getByRole("group", { name: "채택 상태 필터" });
  const modifier = { modifiers: ["ControlOrMeta" as const] };

  await category.getByRole("button", { name: /^질문/ }).click(modifier);
  await category.getByRole("button", { name: /^자유/ }).click(modifier);
  await expect(page).toHaveURL(/c=question%2Cfree/);
  const labels = await page
    .locator(".post-row:not(.pinned) .post-category")
    .allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((text) => text === "질문" || text === "자유")).toBe(true);
  await expect(category.getByRole("button", { name: /^질문/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(category.getByRole("button", { name: /^자유/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(category.getByRole("button", { name: /^전체/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // 다른 종류(상태) 필터는 영향을 받지 않는다
  await status.getByRole("button", { name: /^채택 완료/ }).click();
  await expect(page).toHaveURL(/s=accepted/);
  await expect(page).toHaveURL(/c=question%2Cfree/);

  // 평범한 클릭은 그 하나만 선택하고, ⌘/Ctrl+클릭으로 다시 누르면 해제된다
  await category.getByRole("button", { name: /^질문/ }).click(modifier);
  await expect(page).toHaveURL(/c=free(&|$)/);
  await category.getByRole("button", { name: /^공지/ }).click();
  await expect(page).toHaveURL(/c=notice/);
  await expect(category.getByRole("button", { name: /^자유/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // '전체'는 수정자 키를 무시한다
  await category.getByRole("button", { name: /^전체/ }).click(modifier);
  await expect(page).not.toHaveURL(/c=/);
  await expect(page).toHaveURL(/s=accepted/);
});

test("opening a post from a scrolled community list starts at the top", async ({
  page,
}) => {
  const author = { name: "tester", tier: "브론즈" };
  const posts = Array.from({ length: 8 }, (_, index) => ({
    id: `scroll-${index}`,
    category: "free",
    title: `스크롤 확인 글 ${index}`,
    body: "본문",
    tags: [],
    author,
    createdAt: `2030-01-0${index + 1}T00:00:00Z`,
    upvotes: 0,
    views: 1,
  }));
  await page.addInitScript((value) => {
    localStorage.setItem(
      "unsolvable-oj-community-v1",
      JSON.stringify({
        posts: value,
        answers: [],
        upvoted: [],
        saved: [],
        followed: [],
        accepted: {},
        deleted: [],
      }),
    );
  }, posts);
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto("/community");
  const target = page.getByRole("link", { name: /스크롤 확인 글 7/ });
  await expect(target).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
  await target.click();
  await expect(page).toHaveURL(/\/community\/scroll-7$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("community post: delete own post and answer layout", () => {
  const author = { name: "solver", tier: "Bronze I" };
  const other = { name: "다른사람", tier: "Bronze I" };
  const mk = (id: string, title: string, who: typeof author) => ({
    id,
    category: "question",
    title,
    body: "본문 내용입니다",
    tags: [],
    author: who,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 0,
    views: 3,
  });
  const seedStore = {
    posts: [
      mk("mine-1", "내가 쓴 글", author),
      mk("other-1", "남이 쓴 글", other),
    ],
    answers: [
      {
        id: "a-1",
        postId: "mine-1",
        author: other,
        body: "첫 답변입니다",
        createdAt: "2026-10-02T00:00:00Z",
        upvotes: 0,
      },
    ],
    upvoted: [],
    saved: [],
    followed: [],
    accepted: {},
    deleted: [],
  };

  test("the answer editor and the answer list are separate cards, editor first, with no separate write-answer button", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    }, seedStore);
    await page.goto("/community/other-1");
    await expect(
      page.getByRole("button", { name: "답변 작성", exact: true }),
    ).toHaveCount(0);
    const writeCard = page.locator(".answer-write-card");
    const listCard = page.locator(".answers-card");
    await expect(writeCard.locator(".answer-editor")).toBeVisible();
    await expect(listCard.locator(".answer-editor")).toHaveCount(0);
    const writeTop = (await writeCard.boundingBox())!.y;
    const listTop = (await listCard.boundingBox())!.y;
    expect(writeTop).toBeLessThan(listTop);
    // 남의 글에는 글 관리(⋮) 메뉴가 없다
    await expect(page.getByRole("button", { name: "글 관리" })).toHaveCount(0);
    // 조회수는 아이콘과 숫자로 보인다
    await expect(page.getByLabel("조회 3")).toBeVisible();
  });

  test("the author can delete their own post and it disappears from the list", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      if (!localStorage.getItem("unsolvable-oj-community-v1"))
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify(value),
        );
    }, seedStore);
    await page.goto("/community/mine-1");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();
    await expect(
      page.getByRole("heading", { name: "내가 쓴 글" }),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.getByText("글을 삭제했어요.")).toBeVisible();
    // 샘플 글이 있는 환경에서는 목록이 여러 쪽이라, 검색으로 두 글의 상태를 확인한다.
    await page.goto(`/community?q=${encodeURIComponent("쓴 글")}`);
    await expect(page.getByText("남이 쓴 글")).toBeVisible();
    await expect(page.getByText("내가 쓴 글")).toHaveCount(0);
    await page.goto("/community/mine-1");
    await expect(page.getByText("글을 찾을 수 없어요.")).toBeVisible();
  });

  test("author info and the follow button sit in the post header, not in a separate side card", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    }, seedStore);
    await page.goto("/community/other-1");
    const header = page.locator(".post-byline");
    await expect(header).toContainText("다른사람");
    await expect(header).toContainText("채택 답변 0");
    await expect(header).toContainText("작성 글 1");
    await expect(page.locator(".author-card")).toHaveCount(0);
    const follow = header.getByRole("button", { name: "+ 팔로우" });
    await follow.click();
    await expect(
      header.getByRole("button", { name: "✓ 팔로잉" }),
    ).toHaveAttribute("aria-pressed", "true");
    // 내 글에는 팔로우 버튼이 없다
    await page.goto("/community/mine-1");
    await expect(page.locator(".post-byline")).toContainText("solver");
    await expect(page.getByRole("button", { name: /팔로/ })).toHaveCount(0);
  });

  test("the author edits their own post from the ⋮ menu; the menu closes with Esc", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      if (!localStorage.getItem("unsolvable-oj-community-v1"))
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify(value),
        );
    }, seedStore);
    await page.goto("/community/mine-1");
    const trigger = page.getByRole("button", { name: "글 관리" });
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "수정" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.click();
    await page.getByRole("menuitem", { name: "수정" }).click();
    await expect(page).toHaveURL(/\/community\/mine-1\/edit$/);
    await expect(page.getByLabel(/^제목/)).toHaveValue("내가 쓴 글");
    await page.getByLabel(/^제목/).fill("고친 제목");
    await page.getByRole("button", { name: "수정 저장" }).click();
    await expect(page).toHaveURL(/\/community\/mine-1$/);
    await expect(page.getByText("글을 수정했어요.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "고친 제목" }),
    ).toBeVisible();
  });
});

test("only input fields show the text cursor; UI text uses the arrow and controls the pointer", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/problems/view/sum");
  const cursorOf = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).cursor);
  const selectOf = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect);

  // 입력칸은 텍스트 커서
  expect(await cursorOf("textarea.code-editor")).toBe("text");
  // 제목·안내 문구는 화살표
  expect(await cursorOf("h1")).toBe("default");
  expect(await cursorOf(".editor-hints")).toBe("default");
  // 누르는 곳은 손가락, 조작용 글자는 드래그 선택이 안 된다
  expect(await cursorOf("button.text-button")).toBe("pointer");
  expect(await selectOf("button.text-button")).toBe("none");
  // 읽고 복사하는 본문은 텍스트 커서와 선택 가능
  expect(await cursorOf(".markdown")).toBe("text");
  expect(await selectOf(".markdown")).not.toBe("none");
  // 입력칸 안의 글은 선택 가능
  expect(await selectOf("textarea.code-editor")).toBe("text");

  await page.goto("/problems");
  expect(await cursorOf(".data-list .problem-title strong")).toBe("pointer");
  expect(await selectOf(".data-list .problem-row")).toBe("none");
  expect(await cursorOf(".total-count")).toBe("default");
});

test.describe("code editor basics on the solve page", () => {
  test("switching languages immediately keeps each language's latest draft", async ({
    page,
  }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      localStorage.setItem(
        "unsolvable-oj-draft-v1:problem-id:PYTHON",
        "print(111)",
      );
      localStorage.setItem(
        "unsolvable-oj-draft-v1:problem-id:CPP",
        "int main() {}",
      );
    });
    await page.goto("/problems/view/sum");
    const python = page.getByRole("textbox", { name: "Python 3 소스 코드" });
    await expect(python).toHaveValue("print(111)");
    await python.fill("print(222)");
    await page.getByRole("combobox", { name: "언어", exact: true }).click();
    await page.getByRole("option", { name: "C++ 20", exact: true }).click();
    const cpp = page.getByRole("textbox", { name: "C++ 20 소스 코드" });
    await expect(cpp).toHaveValue("int main() {}");
    await cpp.fill("int main() { return 0; }");
    await page.getByRole("combobox", { name: "언어", exact: true }).click();
    await page.getByRole("option", { name: "Python 3", exact: true }).click();
    await expect(python).toHaveValue("print(222)");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("unsolvable-oj-draft-v1:problem-id:CPP"),
      ),
    ).toBe("int main() { return 0; }");
  });

  test("leaving the solve page immediately preserves the latest input", async ({
    page,
  }) => {
    await page.clock.install();
    await page.goto("/problems/view/sum");
    await page.getByLabel("소스 코드").fill("print(333)");
    await page.getByRole("link", { name: "문제 목록", exact: true }).click();
    await page.getByRole("link", { name: new RegExp(problem.title) }).click();
    await expect(page.getByLabel("소스 코드")).toHaveValue("print(333)");
  });

  test("reset removes the saved draft without restoring it on reload", async ({
    page,
  }) => {
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const starter = await editor.inputValue();
    await editor.fill("print(444)");
    await page.getByRole("button", { name: "초기화", exact: true }).click();
    await expect(editor).toHaveValue(starter);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("unsolvable-oj-draft-v1:problem-id:PYTHON"),
      ),
    ).toBeNull();
    await page.reload();
    await expect(page.getByLabel("소스 코드")).toHaveValue(starter);
  });

  test("typing a quoted string works and Enter on a blank line adds no indentation", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.pressSequentially('"hello"');
    await expect(editor).toHaveValue('"hello"');
    await editor.fill("    ");
    await editor.press("Enter");
    await expect(editor).toHaveValue("    \n");
  });

  test("moving the caret dismisses suggestions from the previous word", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("wh\n");
    await editor.pressSequentially("fo");
    const list = page.getByRole("listbox", { name: "자동완성 제안" });
    await expect(
      list.getByRole("option", { name: /^for/ }).first(),
    ).toBeVisible();
    await editor.evaluate((el: HTMLTextAreaElement) =>
      el.setSelectionRange(3, 3),
    );
    await editor.press("ArrowLeft");
    await expect(list).toHaveCount(0);
    await editor.press("Tab");
    await expect(editor).toHaveValue("wh    \nfo");
  });

  test("auto indent, bracket pairing, undo, comment toggle and Shift+Tab work as typed", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.focus();

    // 파이썬: ':' 뒤 Enter는 한 단계 들여쓴다
    await page.keyboard.type("def f():");
    await page.keyboard.press("Enter");
    await page.keyboard.type("print(");
    // 여는 괄호는 짝과 함께 들어가고, 닫는 괄호를 치면 건너뛴다
    await expect(editor).toHaveValue("def f():\n    print()");
    await page.keyboard.type("1)");
    await expect(editor).toHaveValue("def f():\n    print(1)");

    // 실행 취소(Ctrl/⌘+Z)가 자동 입력까지 되돌린다
    await page.keyboard.press("ControlOrMeta+z");
    await expect(editor).not.toHaveValue("def f():\n    print(1)");

    await editor.fill("a\nb");
    await editor.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(editor).toHaveValue("# a\n# b");
    await page.keyboard.press("ControlOrMeta+/");
    await expect(editor).toHaveValue("a\nb");

    await editor.press("ControlOrMeta+a");
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("    a\n    b");
    await page.keyboard.press("Shift+Tab");
    await expect(editor).toHaveValue("a\nb");
  });

  test("autocomplete: functions, snippet placeholders, member completion and Ctrl+Space", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const list = page.getByRole("listbox", { name: "자동완성 제안" });
    await editor.fill("");
    await editor.focus();

    // 함수는 괄호까지 넣고 커서를 괄호 안에 둔다
    await page.keyboard.type("pri");
    await expect(list.getByRole("option", { name: /^print/ })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("print()");
    await page.keyboard.type("1");
    await expect(editor).toHaveValue("print(1)");
    await expect(list).toHaveCount(0);

    // Esc로 닫으면 Enter는 평소처럼 줄바꿈이다
    await editor.fill("");
    await page.keyboard.type("whi");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    // 스니펫: 칸을 고른 채 시작하고 Tab으로 다음 칸으로 간다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("for");
    await expect(
      list.getByRole("option", { name: /^for/ }).first(),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue("for i in range(n):\n    ");
    await page.keyboard.type("k");
    await expect(editor).toHaveValue("for k in range(n):\n    ");
    await page.keyboard.press("Tab");
    await page.keyboard.type("5");
    await expect(editor).toHaveValue("for k in range(5):\n    ");
    await page.keyboard.press("Tab");
    await page.keyboard.type("x");
    await expect(editor).toHaveValue("for k in range(5):\n    x");

    // 멤버 완성: 변수 타입을 짐작해 그 타입의 메서드만 보여 준다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("s = input()");
    await page.keyboard.press("Enter");
    await page.keyboard.type("s.sp");
    await expect(list.getByRole("option").first()).toContainText("split");
    await expect(list.getByRole("option", { name: /append/ })).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(editor).toHaveValue("s = input()\ns.split()");

    // 문자열 안에서는 제안하지 않는다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type('x = "pri');
    await expect(list).toHaveCount(0);

    // Ctrl+Space로 직접 부른다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.press("Control+Space");
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toHaveCount(0);

    // ↑↓로 고른다
    await editor.fill("");
    await editor.focus();
    await page.keyboard.type("pr");
    await expect(list).toBeVisible();
    await page.keyboard.press("ArrowDown");
    const picked = await list
      .getByRole("option", { selected: true })
      .locator(".suggestion-label")
      .innerText();
    await page.keyboard.press("Enter");
    await expect(editor).toHaveValue(new RegExp(`^${picked}`));
  });

  test("font size changes the editor and is remembered; the cursor position is shown", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const size = () => editor.evaluate((el) => getComputedStyle(el).fontSize);
    expect(await size()).toBe("13px");
    await page.getByRole("button", { name: "글꼴 크게" }).click();
    await page.getByRole("button", { name: "글꼴 크게" }).click();
    expect(await size()).toBe("15px");
    await page.reload();
    expect(await size()).toBe("15px");
    await page.getByRole("button", { name: "글꼴 작게" }).click();
    expect(await size()).toBe("14px");

    await editor.fill("ab\ncde");
    await expect(page.getByText("줄 2, 열 4")).toBeVisible();
  });
});

test("a rejected submission shows each public case with input, expected and actual output", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/by-slug/sum", (route) =>
    route.fulfill({
      json: {
        ...problem,
        samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
      },
    }),
  );
  await page.route("**/api/v1/submissions/wrong-id", (route) =>
    route.fulfill({
      json: {
        id: "wrong-id",
        problem: { id: problem.id, slug: "sum", title: problem.title },
        language: "PYTHON",
        status: "WRONG_ANSWER",
        runtimeMs: 10,
        memoryKb: 1000,
        passedTestCases: 0,
        totalTestCases: 2,
        compileOutput: null,
        judgeMessage: null,
        sourceCode: "print(0)",
        sampleTestCases: [
          { testCase: 1, input: "1 2\n", expectedOutput: "3\n" },
        ],
        debugOutputs: [
          {
            testCase: 1,
            stdout: "0\n",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        ],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/submissions", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/submissions/wrong-id");
  const result = page.locator(".case-result");
  await expect(result.getByText("예제 1")).toBeVisible();
  await expect(result.getByText("기대 출력과 달라요")).toBeVisible();
  await expect(result.locator(".io-block").nth(0)).toContainText("1 2");
  await expect(result.locator(".io-block").nth(1)).toContainText("3");
  await expect(result.locator(".io-block").nth(2)).toContainText("0");
  await expect(page.getByRole("link", { name: "코드 수정하기" })).toBeVisible();
  await expect(page.getByText("코드 수정하고 다시 풀기")).toHaveCount(0);
});

test("a rejected submission is shown under the editor with each example compared", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/by-slug/sum", (route) =>
    route.fulfill({
      json: {
        ...problem,
        samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
      },
    }),
  );
  const rejected = {
    id: "wrong-inline",
    problem: { id: problem.id, slug: "sum", title: problem.title },
    language: "PYTHON",
    status: "WRONG_ANSWER",
    runtimeMs: 10,
    memoryKb: 1000,
    passedTestCases: 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    sourceCode: "print(0)",
    sampleTestCases: [{ testCase: 1, input: "1 2\n", expectedOutput: "3\n" }],
    debugOutputs: [
      {
        testCase: 1,
        stdout: "0\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({ status: 202, json: { ...rejected, status: "QUEUED" } }),
  );
  await page.route("**/api/v1/submissions/wrong-inline", (route) =>
    route.fulfill({ json: rejected }),
  );
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(0)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel.getByText("기대 출력과 달라요")).toBeVisible();
  await expect(panel.locator(".io-block").nth(0)).toContainText("1 2");
  await expect(panel.locator(".io-block").nth(1)).toContainText("3");
  await expect(panel.locator(".io-block").nth(2)).toContainText("0");
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  // 접고 닫을 수 있고, 코드는 그대로다.
  await panel.getByRole("button", { name: "접기" }).click();
  await expect(panel.locator(".case-result")).toHaveCount(0);
  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("소스 코드")).toHaveValue("print(0)");
});

test("lists show skeletons instead of zero placeholders while the server responds", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/v1/problems?*", async (route) => {
    await gate;
    await route.fulfill({
      json: { page: 1, limit: 100, total: 1, totalPages: 1, items: [problem] },
    });
  });
  await page.goto("/problems");
  await expect(page.locator(".skeleton-rows")).toBeVisible();
  await expect(page.locator(".total-count")).not.toContainText("0문제");
  await expect(page.locator(".toggle-count:not(.skeleton)")).toHaveCount(0);
  release();
  await expect(page.locator(".skeleton-rows")).toHaveCount(0);
  await expect(page.locator(".total-count")).toContainText("1문제");
  await expect(page.locator("a.problem-row")).toHaveCount(1);
});

test("Ctrl/⌘+Enter pressed twice creates only one submission", async ({
  page,
}) => {
  await authenticate(page);
  let posts = 0;
  await page.route(
    "**/api/v1/problems/problem-id/submissions",
    async (route) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 429,
        json: { message: "잠시 후 다시 제출하세요." },
      });
    },
  );
  await page.goto("/problems/view/sum");
  const editor = page.getByLabel("소스 코드");
  await editor.fill("print(1)");
  await editor.press("ControlOrMeta+Enter");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByRole("alert")).toHaveText("잠시 후 다시 제출하세요.");
  expect(posts).toBe(1);
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
