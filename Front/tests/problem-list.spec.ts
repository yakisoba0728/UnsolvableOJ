import { expect, test } from "@playwright/test";
import type { Problem } from "../src/types";
import {
  authenticate,
  mockCommunityApi,
  mockProblemApi,
  mockProblemList,
  problem,
} from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

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
  // 서버가 쪽을 나눈다. 41문제 = 입문 16 + 어려움 25.
  const items = Array.from({ length: 41 }, (_, index) => ({
    ...problem,
    id: `problem-${index}`,
    slug: `problem-${index}`,
    title: `문제 ${index}`,
    difficulty: index < 16 ? ("BEGINNER" as const) : ("HARD" as const),
  }));
  await mockProblemList(page, items);
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
  await mockProblemList(page, [
    make("p-a", "가 문제", "HARD", "2026-09-01T00:00:00Z"),
    make("p-b", "나 문제", "BEGINNER", "2026-09-03T00:00:00Z"),
    make("p-c", "다 문제", "MEDIUM", "2026-09-02T00:00:00Z"),
  ]);
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
  // 슬러그마다 새 탭에서 앱을 처음부터 불러오므로, 워커가 많으면 기본 30초를 넘는다.
  test.slow();
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

test("the problem list and the community list show the page range the same way", async ({
  page,
}) => {
  await authenticate(page);
  await mockProblemList(
    page,
    Array.from({ length: 25 }, (_, index) => ({
      ...problem,
      id: `p-${index}`,
      slug: `p-${index}`,
      title: `문제 ${index + 1}`,
    })),
  );
  const posts = Array.from({ length: 12 }, (_, index) => ({
    id: `r-${index}`,
    title: `ZZ범위 ${index}`,
    author: "tester",
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
  }));
  await mockCommunityApi(page, { posts });
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

const many = Array.from({ length: 30 }, (_, index) => ({
  ...problem,
  id: `s-${index}`,
  slug: `search-${index}`,
  title: `탐색 ${index}`,
  difficulty: index % 2 ? ("HARD" as const) : ("BEGINNER" as const),
  tags: index % 3 ? [] : ["그래프"],
  createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(),
}));

test("search, filters and pages go to the server, debounced, and stay in the address", async ({
  page,
}) => {
  const requests = await mockProblemList(page, many);
  await page.goto("/problems");
  await expect(page.locator(".total-count")).toHaveText("1 - 20/30");
  // 전체를 한꺼번에 받지 않고 한 쪽만 받는다.
  expect(requests.at(-1)?.get("limit")).toBe("20");

  const search = page.getByRole("searchbox", { name: "문제 검색" });
  await search.pressSequentially("탐색 2", { delay: 20 });
  await expect(page).toHaveURL(/[?&]q=%ED%83%90%EC%83%89\+2(&|$)/);
  // 탐색 2, 탐색 20–29
  await expect(page.locator(".total-count")).toHaveText("1 - 11/11");
  // 입력이 멈춘 뒤에만 보낸다: 중간 글자로 보낸 검색은 없다.
  const sent = requests.map((params) => params.get("q")).filter(Boolean);
  expect(sent).toEqual(["탐색 2"]);

  await page
    .getByRole("group", { name: "난이도 필터" })
    .getByRole("button", { name: /^어려움/ })
    .click();
  await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
  await expect(page.locator(".total-count")).toHaveText("1 - 5/5");
  expect(requests.at(-1)?.get("difficulty")).toBe("HARD");
  expect(requests.at(-1)?.get("q")).toBe("탐색 2");
  // 칩 숫자는 서버가 센 값이다(검색어는 그대로, 난이도 조건만 빼고).
  await expect(
    page
      .getByRole("group", { name: "난이도 필터" })
      .getByRole("button", { name: /^입문/ }),
  ).toContainText("6");

  // 다른 화면에 갔다가 뒤로 오면 같은 조건과 결과가 돌아온다.
  await page.goto("/community");
  await page.goBack();
  await expect(page).toHaveURL(/[?&]d=HARD(&|$)/);
  await expect(search).toHaveValue("탐색 2");
  await expect(page.locator(".total-count")).toHaveText("1 - 5/5");

  // 결과보다 뒤의 쪽을 가리키는 주소는 마지막 쪽으로 옮긴다.
  await page.goto("/problems?page=9");
  await expect(page).toHaveURL(/[?&]page=2(&|$)/);
  await expect(page.locator(".total-count")).toHaveText("21 - 30/30");
});

test("a slow earlier response never replaces the newer filter's results", async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const requests = await mockProblemList(page, many);
  // 검색어만 있는 요청은 늦게 돌려준다. 그 사이 조건을 바꾸면 앞선 응답은 쓰이지 않아야 한다.
  await page.route(
    (url) =>
      url.pathname === "/api/v1/problems" &&
      url.searchParams.has("q") &&
      !url.searchParams.has("difficulty"),
    async (route) => {
      await gate;
      await route
        .fulfill({
          json: { items: [many[0]], page: 1, limit: 20, total: 1, totalPages: 1 },
        })
        .catch(() => undefined);
    },
  );
  await page.goto("/problems?q=%ED%83%90%EC%83%89");
  await expect(page.locator(".skeleton-rows")).toBeVisible();
  await page
    .getByRole("group", { name: "난이도 필터" })
    .getByRole("button", { name: /^어려움/ })
    .click();
  await expect(page.locator(".total-count")).toHaveText("1 - 15/15");
  release();
  await page.waitForTimeout(200);
  await expect(page.locator(".total-count")).toHaveText("1 - 15/15");
  expect(requests.at(-1)?.get("difficulty")).toBe("HARD");
});

test("solve-state filters are asked of the server for a signed-in user", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 0, nextCursor: null },
    }),
  );
  const requests = await mockProblemList(page, many, {
    "s-0": "solved",
    "s-1": "attempted",
  });
  await page.goto("/problems");
  const solve = page.getByRole("group", { name: "풀이 상태 필터" });
  await expect(solve.getByRole("button", { name: /^해결/ })).toContainText("1");
  await solve.getByRole("button", { name: /^미해결/ }).click();
  await expect(page).toHaveURL(/[?&]s=none(&|$)/);
  await expect(page.locator(".total-count")).toHaveText("1 - 20/28");
  expect(requests.at(-1)?.get("solve")).toBe("none");
});

test("a failed list request shows the error with a retry that keeps the conditions", async ({
  page,
}) => {
  let fail = true;
  const requests: string[] = [];
  await page.route(
    (url) => url.pathname === "/api/v1/problems",
    (route) => {
      requests.push(route.request().url());
      if (fail)
        return route.fulfill({
          status: 500,
          json: { message: "잠시 후 다시 시도해 주세요." },
        });
      return route.fulfill({
        json: { items: [problem], page: 1, limit: 20, total: 1, totalPages: 1 },
      });
    },
  );
  await page.goto("/problems?q=%ED%95%A9&d=BEGINNER");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("잠시 후 다시 시도해 주세요.");
  await expect(page.locator(".empty-state")).toHaveCount(0);
  fail = false;
  await alert.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  const last = new URL(requests.at(-1)!).searchParams;
  expect(last.get("q")).toBe("합");
  expect(last.get("difficulty")).toBe("BEGINNER");
});
