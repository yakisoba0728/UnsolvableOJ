import { expect, test, type Page } from "@playwright/test";
import {
  authenticate,
  mockCommunityApi,
  mockProblemApi,
  mockProblemList,
  problem,
} from "./fixtures";

// 실사용 점검(judge.yaki.kr)에서 찾은 문제의 회귀 방지.

const items = Array.from({ length: 30 }, (_, index) => ({
  ...problem,
  id: `q-${index}`,
  slug: `qa-${index}`,
  title: `점검 ${index}`,
  difficulty: index % 2 ? ("HARD" as const) : ("BEGINNER" as const),
  tags: [] as string[],
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
}));

const rows = (page: Page) => page.locator("a.problem-row");
const chip = (page: Page, name: RegExp) =>
  page.getByRole("group", { name: "난이도 필터" }).getByRole("button", { name });

test.describe("problem list: changing a filter", () => {
  test.beforeEach(({ page }) => mockProblemApi(page));

  test("keeps the previous rows (dimmed, busy) until the new list arrives instead of emptying", async ({
    page,
  }) => {
    await mockProblemList(page, items);
    await page.goto("/problems");
    await expect(rows(page)).toHaveCount(20);

    // 어려움 조건의 응답을 붙잡아 두고 그 사이의 화면을 본다.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await page.route(
      (url) =>
        url.pathname === "/api/v1/problems" &&
        url.searchParams.get("difficulty") === "HARD",
      async (route) => {
        await gate;
        await route.fallback();
      },
    );
    // 목록 행 수가 0이 되는 순간이 한 번이라도 있는지 지켜본다.
    await page.evaluate(() => {
      const w = window as unknown as { __minRows: number };
      w.__minRows = 99;
      new MutationObserver(() => {
        w.__minRows = Math.min(
          w.__minRows,
          document.querySelectorAll("a.problem-row").length,
        );
      }).observe(document.body, { childList: true, subtree: true });
    });

    await chip(page, /^어려움/).click();
    await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
    // 받는 동안: 앞선 20개가 그대로 있고, 흐리게 표시되며, 스켈레톤은 없다.
    await expect(page.locator(".problem-list.is-refreshing")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(rows(page)).toHaveCount(20);
    await expect(page.locator(".skeleton-rows")).toHaveCount(0);

    release();
    await expect(page.locator(".total-count")).toHaveText("1 - 15/15");
    await expect(rows(page)).toHaveCount(15);
    await expect(page.locator(".problem-list.is-refreshing")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __minRows: number }).__minRows,
      ),
    ).toBeGreaterThan(0);
  });

  test("rapid filter clicks send one request for the last condition", async ({
    page,
  }) => {
    const requests = await mockProblemList(page, items);
    await page.goto("/problems");
    await expect(rows(page)).toHaveCount(20);
    requests.length = 0;

    await page.evaluate(async () => {
      const group = document.querySelector('[aria-label="난이도 필터"]')!;
      const click = (label: string) =>
        [...group.querySelectorAll("button")]
          .find((button) => button.textContent?.startsWith(label))!
          .click();
      // 매번 다른 칩을 누른다. 같은 칩을 다시 누르면 앞 클릭이 아직 그려지지 않은 느린 CI에서 '단독 선택 해제'로 읽혀 조건이 비워진다.
      for (const label of ["입문", "쉬움", "보통", "어려움"]) {
        click(label);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
    await expect(page.locator(".total-count")).toHaveText("1 - 15/15");
    await page.waitForTimeout(400);
    const filtered = requests.filter((params) => params.has("difficulty"));
    expect(filtered.map((params) => params.get("difficulty"))).toEqual(["HARD"]);
  });

  test("a failed request never leaves the previous list standing under the error", async ({
    page,
  }) => {
    await mockProblemList(page, items);
    await page.goto("/problems");
    await expect(rows(page)).toHaveCount(20);
    await page.route(
      (url) =>
        url.pathname === "/api/v1/problems" &&
        url.searchParams.get("difficulty") === "HARD",
      (route) => route.fulfill({ status: 500, json: { message: "서버 오류" } }),
    );
    await chip(page, /^어려움/).click();
    await expect(page.getByRole("alert")).toContainText("서버 오류");
    await expect(rows(page)).toHaveCount(0);
  });

  test("the search box says it also matches the problem address and has a form name", async ({
    page,
  }) => {
    await mockProblemList(page, items);
    await page.goto("/problems");
    const search = page.getByRole("searchbox", { name: "문제 검색" });
    await expect(search).toHaveAttribute("placeholder", "문제 제목·주소 검색");
    await expect(search).toHaveAttribute("name", "q");
  });
});

test.describe("solve page: source length", () => {
  test.beforeEach(({ page }) => mockProblemApi(page));

  test("a source over the server limit is stopped before sending, with the limit and the length shown", async ({
    page,
  }) => {
    await authenticate(page);
    let posted = 0;
    await page.route("**/api/v1/problems/problem-id/submissions", (route) => {
      posted += 1;
      return route.fulfill({ status: 400, json: { message: "too long" } });
    });
    await page.goto("/problems/view/sum");
    const editor = page.getByLabel("소스 코드");
    const submit = page.getByRole("button", { name: "제출하고 채점하기 →" });

    await editor.fill("x".repeat(200_000));
    await expect(submit).toBeEnabled();

    await editor.fill("x".repeat(200_001));
    await expect(submit).toBeDisabled();
    await expect(page.locator(".editor-note")).toContainText(
      "코드가 너무 길어요 · 200,001 / 200,000자",
    );
    // Ctrl/⌘+Enter는 버튼 비활성화를 거치지 않으므로 같은 가드가 막아야 한다.
    await editor.press("ControlOrMeta+Enter");
    await expect(page.getByRole("alert")).toContainText("200,000자 이하");
    await expect(page.getByRole("alert")).toContainText("200,001자");
    expect(posted).toBe(0);

    // 줄이면 다시 제출할 수 있다.
    await editor.fill("print(1)");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect.poll(() => posted).toBe(1);
  });
});

test.describe("community post headings", () => {
  test("# in a post or answer body never makes a second h1", async ({ page }) => {
    await mockCommunityApi(page, {
      posts: [
        {
          id: "h",
          title: "제목 레벨",
          body: "# 큰 제목\n## 중간\n###### 맨 아래",
          author: "other",
        },
      ],
      answers: [{ id: "h-a", postId: "h", body: "# 답변 제목", author: "other" }],
    });
    await page.goto("/community/h");
    await expect(page.locator(".post-body h1")).toHaveCount(0);
    await expect(page.locator(".post-body h2")).toHaveText(["큰 제목"]);
    await expect(page.locator(".post-body h3")).toHaveText(["중간"]);
    // 6단계를 넘기지 않는다.
    await expect(page.locator(".post-body h6")).toHaveText(["맨 아래"]);
    await expect(page.locator(".answer-body h1")).toHaveCount(0);
    await expect(page.locator(".answer-body h3")).toHaveText(["답변 제목"]);
    // 페이지 제목만 h1로 남는다.
    await expect(page.locator("main h1")).toHaveCount(1);
  });
});

test.describe("my submissions: date", () => {
  test.beforeEach(({ page }) => mockProblemApi(page));

  test("records from another year show the year; this year's do not; the title has the full date", async ({
    page,
  }) => {
    await authenticate(page);
    const make = (id: string, at: string) => ({
      id,
      problem: { ...problem, title: "날짜" },
      language: "PYTHON",
      status: "ACCEPTED",
      runtimeMs: 10,
      memoryKb: 2048,
      passedTestCases: 2,
      totalTestCases: 2,
      compileOutput: null,
      judgeMessage: null,
      createdAt: at,
      updatedAt: at,
    });
    const thisYear = new Date().getFullYear();
    await page.route("**/api/v1/submissions?*", (route) =>
      route.fulfill({
        json: {
          items: [
            make("d1", new Date(Date.UTC(thisYear, 5, 15, 3, 0)).toISOString()),
            make("d2", "2020-03-04T03:00:00Z"),
          ],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        },
      }),
    );
    await page.goto("/submissions");
    const times = page.locator(".history-row .history-time");
    await expect(times).toHaveCount(2);
    await expect(times.nth(0)).not.toContainText(String(thisYear));
    await expect(times.nth(1)).toContainText("2020");
    await expect(times.nth(0)).toHaveAttribute("title", new RegExp(String(thisYear)));
  });
});

test.describe("login form", () => {
  test("fields carry form names for password managers", async ({ page }) => {
    await mockProblemApi(page);
    await page.goto("/auth");
    await expect(page.getByLabel("이메일")).toHaveAttribute("name", "email");
    await expect(page.getByLabel("비밀번호")).toHaveAttribute("name", "password");
  });
});
