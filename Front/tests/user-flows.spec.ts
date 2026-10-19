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
  await expect(page).toHaveURL(/\/submissions\/submission-id$/);
  await expect(page.getByText("ACCEPTED", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await page.waitForTimeout(2200); // One full polling period after the terminal response.
  expect(reads).toBe(3);
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

  const verdicts = page.getByRole("group", { name: "판정 필터" });
  await verdicts.getByRole("button", { name: /^정답/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("피보나치");
  // 선택한 항목을 다시 누르면 전체로 돌아간다
  await verdicts.getByRole("button", { name: /^정답/ }).click();
  await expect(rows).toHaveCount(4);

  // ⌘/Ctrl+클릭으로 같은 종류 안에서 여러 개를 고른다(정답 + 오답·오류 = 전부)
  await verdicts
    .getByRole("button", { name: /^정답/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(rows).toHaveCount(1);
  await verdicts
    .getByRole("button", { name: /^오답/ })
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
