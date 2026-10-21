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
    // 새 탭은 이 페이지에 건 모킹이 적용되지 않으므로 컨텍스트 단위로도 상세 응답을 준다.
    await page
      .context()
      .route(`**/api/v1/problems/by-slug/${slug}`, (route) =>
        route.fulfill({ json: { ...problem, slug } }),
      );
    await page.goto("/problems");
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: new RegExp(problem.title) }).click(),
    ]);
    // 목록은 그대로 두고 문제는 새 탭에서 열린다.
    await expect(page).toHaveURL(/\/problems$/);
    await expect(popup).toHaveURL(new RegExp(`/problems/view/${slug}$`));
    await expect(
      popup.getByRole("heading", { name: problem.title, exact: true }),
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
  // 내 제출 목록과 달리 풀이 화면의 채점 결과 판정은 알약 모양이 그대로다.
  const pill = await panel
    .locator(".verdict")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { radius: style.borderRadius, background: style.backgroundColor };
    });
  expect(pill.radius).toBe("999px");
  expect(pill.background).not.toBe("rgba(0, 0, 0, 0)");
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

test("write page tags: commas split into separate tags, a lone # is dropped, an emptied form forgets its draft", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/community/new");
  const tagInput = page.locator("#tag-input");
  const title = page.locator('input[placeholder^="예:"]');

  // 쉼표가 든 입력은 태그 하나가 아니라 여러 개로 나뉜다(쉼표는 검색 주소의 태그 구분자이기도 하다).
  await tagInput.fill("a,b, #c");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveText(["#a✕", "#b✕", "#c✕"]);
  await expect(tagInput).toHaveValue("");

  // 규칙에 어긋나는 조각이 하나라도 있으면 아무것도 등록하지 않고 안내한다.
  await tagInput.fill("ok,two words");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(3);
  await expect(
    page.getByText("태그는 띄어쓰기 없이 한 단어로 입력해 주세요."),
  ).toBeVisible();
  await tagInput.fill("");

  // 최대 개수(5개)를 넘기면 일부만 조용히 넣지 않고, 전부 거절하고 안내한다.
  await tagInput.fill("d,e,f,g");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(3);
  await expect(
    page.getByText("태그는 최대 5개까지 넣을 수 있어요."),
  ).toBeVisible();
  await tagInput.fill("d,e,c");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(5);
  for (let remaining = 5; remaining > 3; remaining -= 1) {
    await page.locator(".tag-chip button").last().click();
    await expect(page.locator(".tag-chip")).toHaveCount(remaining - 1);
  }

  // '#'만 입력하고 떠나면 입력 칸이 비워진다(안내 없이 남아 있지 않는다).
  await tagInput.fill("#");
  await title.click();
  await expect(tagInput).toHaveValue("");

  // 입력을 전부 지우면 이전에 자동 저장된 초안이 다시 살아나지 않는다.
  await title.fill("임시 저장될 제목");
  await expect(page.getByText(/임시 저장됨/)).toBeVisible({ timeout: 5000 });
  // 제목을 지우기 전에 칩을 먼저 지운다(제목 칸을 떠나는 순간 오류 문구가 생겨 레이아웃이 밀리기 때문).
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    await page.locator(".tag-chip button").first().click();
    await expect(page.locator(".tag-chip")).toHaveCount(remaining - 1);
  }
  await title.fill("");
  await expect(page.getByText(/임시 저장됨/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
  await expect(title).toHaveValue("");
});

test("saving an empty form keeps a consistent state: the draft is not wiped on the next visit", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/community/new");
  // 빈 폼에서 임시 저장을 눌러도 안내와 저장 상태가 어긋나지 않는다(다음 방문에서 초안이 조용히 지워지지 않는다).
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(page.getByText(/임시 저장됨/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toBeVisible();
  await expect(page.getByText(/임시 저장됨/)).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem("unsolvable-oj-community-draft-v1"),
  );
  expect(stored).not.toBeNull();
});

test("the home slider shows a visible keyboard focus ring (the fade mask must not clip it)", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 8 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 8,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/");
  const area = page.locator(".slider-area");
  await expect(area.locator(".problem-card").first()).toBeVisible();
  await page.locator(".slider-track").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(".slider-track")).toBeFocused();
  // 링은 마스크가 없는 바깥 영역(.slider-area)에 그려진다.
  await expect(area).toHaveCSS("outline-style", "solid");
  await expect(area).toHaveCSS("outline-width", "3px");
});

test("the my-submissions title column stays readable between 881 and 1100px", async ({
  page,
}) => {
  await authenticate(page);
  const item = (id: string) => ({
    id,
    problem: {
      id: `p-${id}`,
      slug: `p-${id}`,
      title: "최소 스패닝 트리와 위상 정렬",
    },
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 5,
    totalTestCases: 5,
    compileOutput: null,
    judgeMessage: null,
    createdAt: "2026-10-18T03:00:00Z",
    updatedAt: "2026-10-18T03:00:00Z",
  });
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [item("a"), item("b")],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    }),
  );
  for (const width of [900, 1000, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/submissions");
    await expect(page.locator(".history-row")).toHaveCount(2);
    const title = (await page.locator(".history-title").first().boundingBox())!;
    // 이전에는 900px에서 60px대, 1000px에서 160px대까지 줄어 말줄임이 심했다.
    expect(title.width).toBeGreaterThanOrEqual(190);
  }
});

test("the solve page has no back-to-list breadcrumb and the list opens problems in a new tab", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/problems/view/sum");
  await expect(
    page.getByRole("heading", { name: problem.title, exact: true }),
  ).toBeVisible();
  // 문제는 새 탭에서 열리므로 풀이 화면 위에 '문제 목록 / 슬러그' 뒤로가기 경로를 두지 않는다.
  await expect(page.locator(".solve-heading .breadcrumb")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "현재 위치" })).toHaveCount(
    0,
  );

  // 목록의 문제 링크는 새 탭 속성을 가진다(스크린리더에는 '새 탭에서 열려요'로 안내).
  await page.goto("/problems");
  const row = page.locator("a.problem-row").first();
  await expect(row).toHaveAttribute("target", "_blank");
  await expect(row).toHaveAttribute("rel", /noopener/);
  await expect(row).toContainText("새 탭에서 열려요");
});

test("problem links open in a new tab for unusual slugs: encoded, never dropped or reinterpreted", async ({
  page,
}) => {
  await authenticate(page);
  // 실제 슬러그 규칙에는 없을 값까지: 한글·공백·구분자(/ ? # %)·이모지·HTML·javascript:·아주 긴 값.
  const slugs = [
    "한글-슬러그",
    "a b",
    "a/b",
    "a?b#c",
    "100%",
    "%2e%2e",
    "😀-emoji",
    "<script>alert(1)</script>",
    "javascript:alert(1)",
    "x".repeat(300),
  ];
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: slugs.map((slug, index) => ({
          ...problem,
          id: `p-${index}`,
          slug,
          title: `문제 ${index}`,
        })),
        page: 1,
        limit: 100,
        total: slugs.length,
        totalPages: 1,
      },
    }),
  );
  await page.context().route("**/api/v1/problems/by-slug/**", (route) => {
    const requested = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/by-slug/")[1] ?? "",
    );
    return route.fulfill({
      json: { ...problem, slug: requested, title: "열린 문제" },
    });
  });
  await page.goto("/problems");
  const rows = page.locator("a.problem-row");
  await expect(rows).toHaveCount(slugs.length);

  for (const [index, slug] of slugs.entries()) {
    const row = rows.nth(index);
    // 주소는 항상 인코딩되고, 새 탭 속성이 있으며, javascript: 같은 값이 주소로 해석되지 않는다.
    const href = (await row.getAttribute("href"))!;
    expect(href).toBe(`/problems/view/${encodeURIComponent(slug)}`);
    expect(href.startsWith("/problems/view/")).toBe(true);
    await expect(row).toHaveAttribute("target", "_blank");
    await expect(row).toHaveAttribute("rel", /noopener/);
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      row.click(),
    ]);
    await popup.waitForLoadState("domcontentloaded");
    // 새 탭도 같은 문제로 열린다(경로 구분자가 들어 있어도 다른 화면으로 새지 않는다).
    expect(new URL(popup.url()).pathname).toBe(href.split("?")[0]);
    await expect(
      popup.getByRole("heading", { name: "열린 문제", exact: true }),
    ).toBeVisible();
    await popup.close();
    // 목록 탭은 그대로다.
    await expect(page).toHaveURL(/\/problems$/);
  }
});

test("each tab takes the draft from the moment it opened and does not sync live with other tabs of the same problem", async ({
  page,
}) => {
  await authenticate(page);
  await page
    .context()
    .route("**/api/v1/problems/by-slug/sum", (route) =>
      route.fulfill({ json: problem }),
    );
  await page.goto("/problems/view/sum");
  const first = page.getByLabel("소스 코드");
  await first.fill("print(1)");

  // 두 번째 탭은 열린 시점의 초안(첫 탭이 그때까지 쓴 내용)을 가져온다.
  const second = await page.context().newPage();
  await second.goto("/problems/view/sum");
  const secondEditor = second.getByLabel("소스 코드");
  await expect(secondEditor).toHaveValue("print(1)");

  // 그 뒤의 변경은 서로에게 실시간으로 전해지지 않는다(저장 이벤트가 도착할 시간을 충분히 준다).
  const settle = () => page.waitForTimeout(400);
  await first.fill("print(2)");
  await settle();
  await expect(secondEditor).toHaveValue("print(1)");
  await secondEditor.fill("print('B')");
  await settle();
  await expect(first).toHaveValue("print(2)");

  // 극단적인 값(빈 값, 아주 긴 값, 이모지, HTML·따옴표·제어 문자)도 다른 탭을 바꾸지 않는다.
  const extremes = [
    "",
    "x".repeat(60_000),
    "😀 한글 \u202e RTL ✓",
    '</textarea><script>alert("x")</script>\n\'quote\' "double" `tick`\t\\',
  ];
  for (const value of extremes) {
    await first.fill(value);
    await settle();
    await expect(secondEditor).toHaveValue("print('B')");
  }

  // 새로고침하면 그 시점에 저장돼 있던 초안(마지막으로 저장한 첫 탭의 값)을 가져온다.
  const last = extremes[extremes.length - 1];
  await second.reload();
  await expect(second.getByLabel("소스 코드")).toHaveValue(last);

  // 첫 탭의 '초기화'는 열려 있는 두 번째 탭에는 영향을 주지 않고, 새로 열면 초기 코드로 시작한다.
  await page.getByRole("button", { name: "초기화", exact: true }).click();
  await settle();
  await expect(second.getByLabel("소스 코드")).toHaveValue(last);
  await second.reload();
  await expect(second.getByLabel("소스 코드")).toHaveValue(/def solution\(\):/);
  await second.close();
});

test("every language starter is tidy: no input-example comment, consistent indentation, and a hint line", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/problems/view/sum");
  const labels = [
    "Python 3",
    "C++ 20",
    "C 17",
    "Java 21",
    "JavaScript",
    "TypeScript",
    "Go",
    "Rust",
  ];
  let previousValue = "";
  for (const [index, label] of labels.entries()) {
    if (index > 0) {
      await page.getByRole("combobox", { name: "언어", exact: true }).click();
      await page.getByRole("option", { name: label, exact: true }).click();
    }
    const editor = page.getByRole("textbox", { name: `${label} 소스 코드` });
    // 언어를 바꾼 직후에는 이름표만 먼저 바뀌고 내용은 잠깐 이전 언어일 수 있어, 내용이 바뀐 뒤에 읽는다.
    if (index > 0)
      await expect.poll(() => editor.inputValue()).not.toBe(previousValue);
    const value = await editor.inputValue();
    previousValue = value;
    expect(value, label).not.toContain("입력 예시");
    expect(value, label).toContain("여기에 코드를 작성하세요.");
    // 들여쓰기는 한 단계(JS·TS는 2칸, 나머지는 4칸)의 배수이고, 열린 블록 없이 깊어지지 않는다.
    const step = label === "JavaScript" || label === "TypeScript" ? 2 : 4;
    let previous: { indent: number; text: string } | null = null;
    for (const line of value.split("\n")) {
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      expect(indent % step, `${label}: ${JSON.stringify(line)}`).toBe(0);
      if (previous && indent > previous.indent) {
        expect(
          /[{(:]$/.test(previous.text.trimEnd()),
          `${label}: 열린 블록 없이 깊어짐 ${JSON.stringify(line)}`,
        ).toBe(true);
        expect(indent - previous.indent, label).toBeLessThanOrEqual(step);
      }
      previous = { indent, text: line };
    }
  }
});

test("the font-size and reset buttons in the editor toolbar stay visible, readable and unbroken at every width", async ({
  page,
}) => {
  await authenticate(page);
  for (const width of [320, 360, 390, 650, 651, 900, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/problems/view/sum");
    const toolbar = page.locator(".code-toolbar");
    await expect(toolbar).toBeVisible();
    const buttons = [
      page.getByRole("button", { name: "글꼴 작게" }),
      page.getByRole("button", { name: "글꼴 크게" }),
      page.getByRole("button", { name: "초기화", exact: true }),
    ];
    for (const button of buttons) {
      // 버튼으로 보이도록 테두리가 있고, 글자가 한 줄로 유지되며(높이 30px), 누르기 쉬운 크기다.
      await expect(button).toHaveCSS("border-top-width", "1px");
      await expect(button).toHaveCSS("white-space", "nowrap");
      const box = (await button.boundingBox())!;
      expect(box.height, `${width}px`).toBeGreaterThanOrEqual(30);
      expect(box.height, `${width}px`).toBeLessThanOrEqual(32);
      expect(box.width, `${width}px`).toBeGreaterThanOrEqual(34);
    }
    // 툴바가 가로로 넘치지 않고, 저장 상태 문구가 글자 하나씩 세로로 쪼개지지 않는다.
    const overflow = await toolbar.evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
    const saveState = (await page.locator(".save-state").boundingBox())!;
    expect(saveState.height, `${width}px`).toBeLessThan(24);
    // 글자색은 툴바 바탕과 충분히 대비된다(밝은 글자).
    const color = await buttons[0].evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = color.match(/\d+/g)!.map(Number);
    expect(r + g + b, color).toBeGreaterThan(600);
  }

  // 글꼴 크기 한계: 최소·최대에서 해당 버튼이 비활성이 되고 숫자가 한계를 넘지 않는다.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/problems/view/sum");
  const smaller = page.getByRole("button", { name: "글꼴 작게" });
  const larger = page.getByRole("button", { name: "글꼴 크게" });
  const size = () => page.locator(".font-size").innerText();
  for (let index = 0; index < 20; index += 1) {
    if (await smaller.isDisabled()) break;
    await smaller.click();
  }
  await expect(smaller).toBeDisabled();
  await expect(smaller).toHaveCSS("opacity", "0.4");
  expect(Number(await size())).toBe(11);
  for (let index = 0; index < 20; index += 1) {
    if (await larger.isDisabled()) break;
    await larger.click();
  }
  await expect(larger).toBeDisabled();
  expect(Number(await size())).toBe(20);
});

test.describe("Tab indentation is removed one level at a time, typed spaces one at a time", () => {
  const SP4 = "    ";
  type Editor = import("@playwright/test").Locator;
  const open = async (page: import("@playwright/test").Page) => {
    await authenticate(page);
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    await editor.fill("");
    await editor.focus();
    return editor;
  };
  // Home/End/Ctrl+End는 운영체제마다 커서를 옮기지 않는 경우가 있어(macOS), 커서 위치를 직접 지정한다.
  const caretAt = (editor: Editor, index: number) =>
    editor.evaluate((el: HTMLTextAreaElement, position: number) => {
      el.focus();
      el.setSelectionRange(position, position);
    }, index);
  const caretEnd = (editor: Editor) =>
    editor.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  const spaces = async (editor: Editor, count: number) => {
    for (let index = 0; index < count; index += 1) await editor.press("Space");
  };

  test("a Tab-made level goes with one Backspace; four typed spaces need four", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // 같은 네 칸이라도 직접 친 공백은 한 글자씩 지워진다
    await spaces(editor, 4);
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("   ");
    await editor.press("Backspace");
    await expect(editor).toHaveValue("  ");

    // Tab으로 넣은 단계 뒤에 글자를 쓰면: 글자는 한 글자, 그다음 단계는 한 번에
    await editor.fill("");
    await editor.press("Tab");
    await editor.pressSequentially("x");
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");
  });

  test("levels are separated even when spaces typed by hand sit next to them", async ({
    page,
  }) => {
    const editor = await open(page);
    // Tab 한 단계 뒤에 직접 친 공백 네 칸: 뒤의 네 칸은 한 글자씩, 그다음 Tab 단계는 한 번에
    await editor.press("Tab");
    await spaces(editor, 4);
    await expect(editor).toHaveValue(SP4 + SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4 + "   ");
    for (let index = 0; index < 3; index += 1) await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // Tab 두 번: 한 번 누를 때마다 한 단계씩
    await editor.press("Tab");
    await editor.press("Tab");
    await expect(editor).toHaveValue(SP4 + SP4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(SP4);
  });

  test("the remembered level follows edits made before it and stays in sync with the text", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("y");
    await caretAt(editor, 0);
    await editor.pressSequentially("Q");
    await expect(editor).toHaveValue(`Q${SP4}y`);
    // 단계 바로 뒤(y 앞)에서 지우면 앞에 글자가 생겼어도 한 단계가 한 번에 지워진다
    await caretAt(editor, 5);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("Qy");

    // 단계의 가운데 글자를 지우면 더는 한 단계가 아니다: 남은 공백은 한 글자씩
    await editor.fill("");
    await editor.press("Tab");
    await caretAt(editor, 2);
    await editor.press("Delete"); // 가운데 공백 하나를 직접 지움(단위가 깨진다)
    await expect(editor).toHaveValue("   ");
    await caretEnd(editor);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("  ");
  });

  test("Delete removes a whole level that starts at the caret", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("z");
    await caretAt(editor, 0);
    await editor.press("Delete");
    await expect(editor).toHaveValue("z");
    // 직접 친 공백은 Delete도 한 글자씩
    await editor.fill("");
    await spaces(editor, 4);
    await caretAt(editor, 0);
    await editor.press("Delete");
    await expect(editor).toHaveValue("   ");
  });

  test("auto-indent after an opening bracket and carried indentation are levels too", async ({
    page,
  }) => {
    const editor = await open(page);
    // '{'를 치면 '}'가 같이 들어가므로, Enter는 닫는 괄호를 아래 줄로 내리고 안쪽 줄에 한 단계를 만든다
    await editor.pressSequentially("if (x) {");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`if (x) {\n${SP4}\n}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("if (x) {\n\n}");

    // (글자를 치면 자동완성 제안이 떠서 Enter가 제안 선택이 되므로, 제안이 뜨지 않는 숫자를 쓴다)
    // Tab으로 들여쓴 줄에서 Enter: 새 줄이 이어받은 들여쓰기도 한 단계씩 지워진다
    await editor.fill("");
    await editor.press("Tab");
    await editor.press("Tab");
    await editor.pressSequentially("1");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n${SP4}${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}${SP4}1\n`);

    // 직접 친 공백으로 들여쓴 줄에서 Enter: 이어받은 들여쓰기는 한 글자씩
    await editor.fill("");
    await spaces(editor, 4);
    await editor.pressSequentially("2");
    await editor.press("Enter");
    await expect(editor).toHaveValue(`${SP4}2\n${SP4}`);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}2\n   `);
  });

  test("indenting several selected lines marks every line, and outdenting forgets them", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.fill("a\n\nb");
    await editor.press("ControlOrMeta+a");
    await editor.press("Tab");
    await expect(editor).toHaveValue(`${SP4}a\n\n${SP4}b`);
    // 마지막 줄의 한 단계(7~11번 칸) 바로 뒤에서 지운다
    await caretAt(editor, 11);
    await editor.press("Backspace");
    await expect(editor).toHaveValue(`${SP4}a\n\nb`);
    // 첫 줄의 한 단계도 같다
    await caretAt(editor, 4);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("a\n\nb");

    // 다시 들여쓴 뒤 Shift+Tab으로 내어쓰면 단계가 사라지고 글은 원래대로
    await editor.press("ControlOrMeta+a");
    await editor.press("Tab");
    await editor.press("ControlOrMeta+a");
    await editor.press("Shift+Tab");
    await expect(editor).toHaveValue("a\n\nb");
  });

  test("the remembered levels survive a reload together with the draft", async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.press("Tab");
    await editor.pressSequentially("q");
    await page.reload();
    const again = page.getByLabel("소스 코드");
    await expect(again).toHaveValue(`${SP4}q`);
    await caretEnd(again);
    await again.press("Backspace");
    await again.press("Backspace");
    await expect(again).toHaveValue("");

    // 직접 친 공백은 새로고침 뒤에도 한 글자씩
    await spaces(again, 4);
    await page.reload();
    const typed = page.getByLabel("소스 코드");
    await expect(typed).toHaveValue(SP4);
    await caretEnd(typed);
    await typed.press("Backspace");
    await expect(typed).toHaveValue("   ");
  });

  test("many levels, undo, pasted text and tab characters never corrupt the text", async ({
    page,
  }) => {
    const editor = await open(page);
    // 100번 Tab → 100번 Backspace로 정확히 비워진다
    for (let index = 0; index < 100; index += 1) await editor.press("Tab");
    await expect(editor).toHaveValue(SP4.repeat(100));
    for (let index = 0; index < 100; index += 1)
      await editor.press("Backspace");
    await expect(editor).toHaveValue("");

    // 실행 취소 뒤에도 글이 망가지지 않고 Backspace가 정상 동작한다
    await editor.press("Tab");
    await editor.press("Backspace");
    await editor.press("ControlOrMeta+z");
    await editor.press("Backspace");
    expect((await editor.inputValue()).trim()).toBe("");

    // 진짜 탭 문자(붙여넣기)는 한 글자로 지워진다
    await editor.fill("\t\t");
    await caretEnd(editor);
    await editor.press("Backspace");
    await expect(editor).toHaveValue("\t");

    // 아주 긴 값 뒤에서도 기억이 어긋나지 않는다
    await editor.fill("x".repeat(50_000));
    await caretEnd(editor);
    await editor.press("Tab");
    await editor.press("Backspace");
    expect((await editor.inputValue()).length).toBe(50_000);

    // 이모지·한글·HTML 사이에서도 한 단계 단위가 지켜진다
    await editor.fill("😀한글<b>");
    await caretEnd(editor);
    await editor.press("Tab");
    await editor.pressSequentially("끝");
    await editor.press("Backspace");
    await editor.press("Backspace");
    await expect(editor).toHaveValue("😀한글<b>");
  });
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
  // Enter로도 새 탭에서 열린다(목록 탭은 그대로 남는다).
  await page
    .context()
    .route("**/api/v1/problems/by-slug/sum", (route) =>
      route.fulfill({ json: problem }),
    );
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.keyboard.press("Enter"),
  ]);
  await expect(popup).toHaveURL(/\/problems\/view\/sum$/);
  await expect(page).toHaveURL(/\/problems$/);
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
  // WebKit reports auto on descendants: user-select is not an inherited property.
  expect(await selectOf(".data-list")).toBe("none");
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
    // 풀이 화면에는 뒤로가기 링크가 없으니 머리글 메뉴의 '문제'로 목록에 돌아간다.
    await page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "문제", exact: true })
      .click();
    // 목록의 문제는 새 탭에서 열리고, 같은 문제의 마지막 입력이 그대로 복원된다.
    await page
      .context()
      .route("**/api/v1/problems/by-slug/sum", (route) =>
        route.fulfill({ json: problem }),
      );
    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("link", { name: new RegExp(problem.title) }).click(),
    ]);
    await expect(popup.getByLabel("소스 코드")).toHaveValue("print(333)");
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
  await expect(page.locator(".total-count")).not.toContainText("0/0");
  await expect(page.locator(".toggle-count:not(.skeleton)")).toHaveCount(0);
  release();
  await expect(page.locator(".skeleton-rows")).toHaveCount(0);
  await expect(page.locator(".total-count")).toHaveText("1 - 1/1");
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

test.describe("solve page: resizable statement | code split", () => {
  const SPLIT_KEY = "unsolvable-oj-solve-split-v1";
  type Page = import("@playwright/test").Page;
  const open = async (page: Page, stored?: string) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await authenticate(page);
    if (stored !== undefined)
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [SPLIT_KEY, stored],
      );
    await page.goto("/problems/view/sum");
    await expect(page.locator(".solve-grid")).toBeVisible();
  };
  const widths = (page: Page) =>
    page.evaluate(() => {
      const width = (selector: string) => {
        const el = document.querySelector<HTMLElement>(selector)!;
        return el.offsetParent === null
          ? 0
          : Math.round(el.getBoundingClientRect().width);
      };
      return {
        statement: width(".statement-panel"),
        code: width(".code-panel"),
        grid: width(".solve-grid"),
      };
    });
  const handle = (page: Page) =>
    page.getByRole("separator", { name: "문제 설명과 코드 작성 크기 조절" });
  const dragTo = async (page: Page, x: number) => {
    const box = (await handle(page).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 8 });
    await page.mouse.up();
  };

  test("dragging the handle resizes both panels, and a reload starts from the default again", async ({
    page,
  }) => {
    await open(page);
    const before = await widths(page);
    await dragTo(page, 800);
    const after = await widths(page);
    expect(after.statement).toBeGreaterThan(before.statement + 100);
    expect(after.code).toBeLessThan(before.code - 100);
    await page.reload();
    await expect(page.getByLabel("소스 코드")).toBeVisible();
    expect(
      Math.abs((await widths(page)).statement - before.statement),
    ).toBeLessThan(3);
    // 아무것도 저장하지 않는다
    expect(
      await page.evaluate((key) => window.localStorage.getItem(key), SPLIT_KEY),
    ).toBeNull();
  });

  test("just before a panel vanishes it stops at its minimum width; only a further drag removes it", async ({
    page,
  }) => {
    await open(page);
    // 격자는 페이지 왼쪽에서 24px, 손잡이 중심은 문제 설명 폭 + 8px 지점
    await dragTo(page, 24 + 260 + 8); // 최소 폭에 딱 맞는 위치
    const atMin = (await widths(page)).statement;
    expect(atMin).toBeGreaterThanOrEqual(255);
    expect(atMin).toBeLessThanOrEqual(265);
    await dragTo(page, 24 + 260 + 8 - 50); // 여유 구간 안: 최소 폭에서 멈춘다
    expect(Math.abs((await widths(page)).statement - atMin)).toBeLessThan(3);
    await dragTo(page, 24 + 260 + 8 - 100); // 여유 구간을 넘으면 사라진다
    expect((await widths(page)).statement).toBe(0);

    // 코드 작성 쪽도 같다(격자 폭 1392, 손잡이 16, 코드 최소 380)
    await dragTo(page, 700);
    const codeEdge = 24 + (1392 - 16 - 380) + 8;
    await dragTo(page, codeEdge + 30);
    const codeAtMin = (await widths(page)).code;
    expect(codeAtMin).toBeGreaterThanOrEqual(375);
    expect(codeAtMin).toBeLessThanOrEqual(385);
    await dragTo(page, codeEdge + 60);
    expect(Math.abs((await widths(page)).code - codeAtMin)).toBeLessThan(3);
    await dragTo(page, codeEdge + 110);
    expect((await widths(page)).code).toBe(0);
  });

  test("dragging far left hides the statement, far right hides the code, and typed code survives both", async ({
    page,
  }) => {
    await open(page);
    const editor = page.getByLabel("소스 코드");
    await editor.fill("12345");
    await dragTo(page, 2);
    let now = await widths(page);
    expect(now.statement).toBe(0);
    expect(now.code).toBeGreaterThan(1300);
    await expect(editor).toHaveValue("12345");

    await dragTo(page, 700);
    now = await widths(page);
    expect(now.statement).toBeGreaterThan(200);
    await dragTo(page, 1438);
    now = await widths(page);
    expect(now.code).toBe(0);
    expect(now.statement).toBeGreaterThan(1300);
    await dragTo(page, 700);
    await expect(editor).toHaveValue("12345");
    expect((await widths(page)).code).toBeGreaterThan(300);
  });

  test("keyboard: arrows, Home/End and Enter; double-click resets", async ({
    page,
  }) => {
    await open(page);
    const start = (await widths(page)).statement;
    await handle(page).focus();
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(start);
    await page.keyboard.press("Home");
    expect((await widths(page)).statement).toBe(0);
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(200);
    await page.keyboard.press("End");
    expect((await widths(page)).code).toBe(0);
    await page.keyboard.press("ArrowLeft");
    expect((await widths(page)).code).toBeGreaterThan(300);
    await page.keyboard.press("Home");
    await handle(page).dblclick();
    expect(Math.abs((await widths(page)).statement - start)).toBeLessThan(3);
    await page.keyboard.press("Escape");
    await page.keyboard.press("a");
    expect(Math.abs((await widths(page)).statement - start)).toBeLessThan(3);
  });

  test("hidden panel is not focusable or visible", async ({ page }) => {
    await open(page);
    await dragTo(page, 2);
    await expect(page.locator(".statement-panel")).toBeHidden();
    await dragTo(page, 1438);
    await expect(page.locator(".code-panel")).toBeHidden();
    await expect(page.getByLabel("소스 코드")).toBeHidden();
  });

  test("old or odd saved values are ignored: the page always opens at the default", async ({
    page,
  }) => {
    await open(page);
    const base = await widths(page);
    for (const bad of [
      JSON.stringify({ ratio: 0.7, collapsed: "statement" }),
      JSON.stringify({ ratio: 0.2, collapsed: "code" }),
      "not json",
      '{"ratio":1e999}',
      "<script>alert(1)</script>",
      "😀".repeat(2000),
    ]) {
      await open(page, bad);
      const now = await widths(page);
      expect(Math.abs(now.statement - base.statement)).toBeLessThan(3);
      expect(Math.abs(now.code - base.code)).toBeLessThan(3);
    }
  });

  test("a narrower window hides a panel that no longer fits", async ({
    page,
  }) => {
    await open(page);
    await dragTo(page, 1058); // 코드 작성을 최소 폭(380)까지 줄인다
    expect((await widths(page)).code).toBeGreaterThan(370);
    await page.setViewportSize({ width: 1110, height: 900 });
    await expect.poll(async () => (await widths(page)).code).toBe(0);
  });

  // 실제 서버처럼 문제마다 id가 다르게 내려오도록 한다
  const distinctProblems = (page: Page) =>
    page.route("**/api/v1/problems/by-slug/*", async (route) => {
      const slug = new URL(route.request().url()).pathname.split("/").at(-1)!;
      await route.fulfill({
        json: { ...problem, id: `id-${slug}`, slug, title: `문제 ${slug}` },
      });
    });
  const goInApp = (page: Page, path: string) =>
    page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);

  test("moving to another problem starts again from the default size", async ({
    page,
  }) => {
    await distinctProblems(page);
    await open(page);
    const base = await widths(page);
    await dragTo(page, 1438); // 코드 작성을 숨긴다
    expect((await widths(page)).code).toBe(0);
    await goInApp(page, "/problems/view/other");
    await expect(
      page.getByRole("heading", { name: "문제 other" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        Math.abs((await widths(page)).statement - base.statement),
      )
      .toBeLessThan(3);
    expect((await widths(page)).code).toBeGreaterThan(300);
  });

  test("leaving the problem in the middle of a drag leaves no stuck drag state", async ({
    page,
  }) => {
    await distinctProblems(page);
    await open(page);
    const box = (await handle(page).boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 40, { steps: 4 });
    await goInApp(page, "/problems/view/other");
    await expect(
      page.getByRole("heading", { name: "문제 other" }),
    ).toBeVisible();
    await page.mouse.up();
    await expect(page.locator(".solve-grid")).not.toHaveClass(/is-dragging/);
    // 코드 입력창이 다시 눌리고 입력된다
    const editor = page.getByLabel("소스 코드");
    await editor.click();
    await editor.fill("12345");
    await expect(editor).toHaveValue("12345");
  });

  test("grabbing the handle focuses it, so the arrow keys work right after a drag", async ({
    page,
  }) => {
    await open(page);
    await page.getByLabel("소스 코드").click();
    await dragTo(page, 700);
    await expect(handle(page)).toBeFocused();
    const before = (await widths(page)).statement;
    await page.keyboard.press("ArrowRight");
    expect((await widths(page)).statement).toBeGreaterThan(before);
  });

  test("releasing the pointer outside the grid still ends the drag", async ({
    page,
  }) => {
    await open(page);
    await dragTo(page, 800);
    await page.mouse.move(100, 400);
    const stable = await widths(page);
    await page.mouse.move(1000, 400);
    expect(await widths(page)).toEqual(stable);
  });
});

test.describe("community filter counts include pinned notices where they belong", () => {
  // 배포용 저장소에는 화면 구동용 샘플 글이 섞이므로, 이 테스트가 넣은 글만 걸러 보도록 제목에 "ZZ"를 붙이고 검색한다.
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
    tags: [] as string[],
    author,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 1,
    views: 10,
    ...(pinned ? { pinned: true } : {}),
  });
  const open = async (page: import("@playwright/test").Page, query = "ZZ") => {
    await page.addInitScript(
      (posts) =>
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify({
            posts,
            answers: [],
            upvoted: [],
            saved: [],
            followed: [],
            accepted: {},
            deleted: [],
          }),
        ),
      [
        post("n-1", "notice", "ZZ고정 공지", true),
        post("n-2", "notice", "ZZ일반 공지"),
        post("q-1", "question", "ZZ질문 하나"),
        post("q-2", "question", "ZZ질문 둘"),
        post("f-1", "free", "ZZ자유 글"),
      ],
    );
    await page.goto(`/community?q=${encodeURIComponent(query)}`);
  };
  const count = async (
    page: import("@playwright/test").Page,
    group: string,
    name: RegExp,
  ) => {
    const text =
      (await page
        .getByRole("group", { name: group })
        .getByRole("button", { name })
        .textContent()) ?? "";
    return Number(text.replace(/\D/g, ""));
  };
  const total = (page: import("@playwright/test").Page) =>
    page.locator(".total-count");

  test("the notice chip counts the pinned notice, the all chip and total match, other chips do not", async ({
    page,
  }) => {
    await open(page);
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2); // 고정 1 + 일반 1
    await expect.poll(() => count(page, "분류 필터", /^질문/)).toBe(2);
    await expect.poll(() => count(page, "분류 필터", /^자유/)).toBe(1);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(5);
    await expect(total(page)).toHaveText("1 - 5/5");

    // 질문만 고르면 공지 칩 개수는 그대로이고(칩은 눌렀을 때의 결과 수), 목록 머리글은 실제로 나열된 줄(질문 2 + 항상 보이는 고정 공지 1)을 센다
    await page
      .getByRole("group", { name: "분류 필터" })
      .getByRole("button", { name: /^질문/ })
      .click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2);
    await expect(total(page)).toHaveText("1 - 3/3");
    // 고정 공지는 그대로 목록 맨 위에 보인다
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);
  });

  test("the pinned notice follows keyword searches in the counts", async ({
    page,
  }) => {
    await open(page, "ZZ고정");
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(1);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(1);
    await expect(total(page)).toHaveText("1 - 1/1");
    // 아무 글도 맞지 않는 검색어(이모지 포함): 모든 개수가 0
    await page.goto("/community?q=ZZzzzzzz%F0%9F%98%80");
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(0);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(0);
    await expect(total(page)).toHaveText("0/0");
  });

  test("notices count as not accepted in the status chips, and the pinned one stays visible under every status", async ({
    page,
  }) => {
    await open(page);
    const status = (name: RegExp) => count(page, "채택 상태 필터", name);
    // 필터를 걸기 전: 공지도 글이므로 전체에 들어가고, 채택된 답변이 없으니 "채택 전"에 들어간다
    await expect.poll(() => status(/^전체/)).toBe(5);
    await expect.poll(() => status(/^채택 전/)).toBe(5);
    await expect.poll(() => status(/^채택 완료/)).toBe(0);

    const statusGroup = page.getByRole("group", { name: "채택 상태 필터" });
    await statusGroup.getByRole("button", { name: /^채택 전/ }).click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2);
    await expect(total(page)).toHaveText("1 - 5/5");
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);

    // 채택 완료만 고르면 맞는 글이 없어 칩 개수는 0이지만, 고정 공지는 여전히 맨 위에 보이므로 머리글은 그 한 줄을 센다
    await statusGroup.getByRole("button", { name: /^채택 완료/ }).click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(0);
    await expect(total(page)).toHaveText("1 - 1/1");
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);
  });
});

test("the home problem slider does not snap cards into place after scrolling", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
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
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const track = page.locator(".slider-track");
    await expect(track.locator(".problem-card").first()).toBeVisible();
    // 위치 맞춤 규칙이 트랙에도 카드에도 없다
    const rules = await track.evaluate((el) => {
      const card = el.querySelector(".problem-card")!;
      return {
        type: getComputedStyle(el).scrollSnapType,
        align: getComputedStyle(card).scrollSnapAlign,
      };
    });
    expect(rules.type).toBe("none");
    expect(rules.align).toBe("none");
    // 카드 경계가 아닌 곳에 멈추면 그 자리에 그대로 있다(카드 시작 위치로 되돌려지지 않는다)
    for (const target of [37, 150, 301, 500]) {
      await track.evaluate((el, left) => {
        el.scrollLeft = left;
      }, target);
      await page.waitForTimeout(400);
      expect(
        Math.abs((await track.evaluate((el) => el.scrollLeft)) - target),
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("the verdict in the my-submissions list is plain coloured text, not a pill", async ({
  page,
}) => {
  await authenticate(page);
  const statuses = [
    "ACCEPTED",
    "WRONG_ANSWER",
    "RUNTIME_ERROR",
    "COMPILE_ERROR",
    "TIME_LIMIT_EXCEEDED",
    "MEMORY_LIMIT_EXCEEDED",
    "OUTPUT_LIMIT_EXCEEDED",
    "SYSTEM_ERROR",
    "QUEUED",
    "JUDGING",
    "CANCELLED",
  ];
  const items = statuses.map((status, index) => ({
    id: `s${index}`,
    problem: { id: `p${index}`, slug: `p${index}`, title: `문제 ${index}` },
    language: "PYTHON",
    status,
    runtimeMs: 10,
    memoryKb: 2048,
    passedTestCases: status === "ACCEPTED" ? 2 : 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
  }));
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, total: items.length, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/submissions");
    const verdicts = page.locator(".history-row .verdict");
    await expect(verdicts).toHaveCount(statuses.length);
    const styles = await verdicts.evaluateAll((elements) =>
      elements.map((el) => {
        const style = getComputedStyle(el);
        return {
          status: el.className,
          background: style.backgroundColor,
          radius: style.borderRadius,
          paddingLeft: style.paddingLeft,
          height: el.getBoundingClientRect().height,
          color: style.color,
        };
      }),
    );
    for (const style of styles) {
      expect(style.background).toBe("rgba(0, 0, 0, 0)");
      expect(style.radius).toBe("0px");
      expect(style.paddingLeft).toBe("0px");
      expect(style.height).toBeLessThan(28); // 알약의 높이(28px)보다 낮은 글줄 높이
    }
    // 색은 그대로 판정마다 다르게 입혀진다(성공은 초록 계열, 오답·오류는 빨강 계열)
    const colorOf = (name: string) =>
      styles.find((style) => style.status.includes(name))!.color;
    expect(colorOf("verdict-accepted")).not.toBe(
      colorOf("verdict-wrong_answer"),
    );
    expect(colorOf("verdict-wrong_answer")).toBe(
      colorOf("verdict-runtime_error"),
    );
    expect(colorOf("verdict-queued")).not.toBe(colorOf("verdict-wrong_answer"));
  }

  // 굵기·크기·줄 높이는 문제 목록의 난이도 글씨와 같다.
  const typography = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          weight: style.fontWeight,
          size: style.fontSize,
          lineHeight: style.lineHeight,
          family: style.fontFamily,
        };
      });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/submissions");
  await expect(page.locator(".history-row .verdict").first()).toBeVisible();
  const verdict = await typography(".history-row .verdict");
  await page.goto("/problems");
  await expect(page.locator(".data-list .difficulty").first()).toBeVisible();
  expect(verdict).toEqual(await typography(".data-list .difficulty"));
  expect(verdict.weight).toBe("700");
});

test("the problem list and the community list show the page range the same way", async ({
  page,
}) => {
  await authenticate(page);
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 25 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 25,
        totalPages: 1,
      },
    }),
  );
  const posts = Array.from({ length: 12 }, (_, index) => ({
    id: `r-${index}`,
    category: "free",
    title: `ZZ범위 ${index}`,
    body: "본문",
    tags: [] as string[],
    author: { name: "tester", tier: "브론즈" },
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
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
  const label = page.locator(".total-count");
  const look = () =>
    label.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        weight: style.fontWeight,
        size: style.fontSize,
        color: style.color,
        family: style.fontFamily,
      };
    });

  await page.goto("/problems");
  await expect(label).toHaveText("1 - 20/25");
  const problemLook = await look();
  await page.goto("/problems?page=2");
  await expect(label).toHaveText("21 - 25/25");
  // 아무것도 맞지 않는 검색: 0/0
  await page.goto("/problems?q=zzzzzz%F0%9F%98%80");
  await expect(label).toHaveText("0/0");

  await page.goto("/community?q=ZZ");
  await expect(label).toHaveText("1 - 10/12");
  const communityLook = await look();
  await page.goto("/community?q=ZZ&page=2");
  await expect(label).toHaveText("11 - 12/12");
  await page.goto("/community?q=ZZzzzzzz%F0%9F%98%80");
  await expect(label).toHaveText("0/0");

  // 글씨 모양도 같다
  expect(communityLook).toEqual(problemLook);
});

test("an odd page number in the address never shifts the list off a page boundary, and the range has a spoken form", async ({
  page,
}) => {
  await authenticate(page);
  const posts = Array.from({ length: 16 }, (_, index) => ({
    id: `o-${index}`,
    category: "free",
    title: `ZZ홀수 ${index}`,
    body: "본문",
    tags: [] as string[],
    author: { name: "tester", tier: "브론즈" },
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
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
  const label = page.locator(".total-count");
  // 소수·0·음수·글자·아주 큰 수: 어느 쪽이든 쪽 경계에 맞는 범위가 나온다
  const expected: Record<string, string> = {
    "1.5": "1 - 10/16",
    "2.9": "11 - 16/16",
    "0": "1 - 10/16",
    "-3": "1 - 10/16",
    abc: "1 - 10/16",
    "99": "11 - 16/16",
    "1e9": "11 - 16/16",
  };
  for (const [value, text] of Object.entries(expected)) {
    await page.goto(`/community?q=ZZ&page=${encodeURIComponent(value)}`);
    await expect(label, `page=${value}`).toHaveText(text);
  }
  // 보이는 글씨는 스크린리더에서 가리고, 풀어쓴 문장을 따로 읽어 준다("1 빼기 10 슬래시 16"로 읽히지 않게)
  await page.goto("/community?q=ZZ");
  await expect(label).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".total-count + .sr-only")).toHaveText(
    "전체 16개 중 1번부터 10번째까지",
  );
  await page.goto("/community?q=ZZzzzzzz%F0%9F%98%80");
  await expect(page.locator(".total-count + .sr-only")).toHaveText(
    "표시할 항목이 없어요",
  );
});
