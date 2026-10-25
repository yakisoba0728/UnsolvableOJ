import { expect, test, type Page } from "@playwright/test";

const iso = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

const community = {
  posts: [
    {
      id: "p2",
      category: "question",
      title: "이분 탐색에서 mid 계산이 오버플로나는 이유",
      body: "본문",
      tags: ["이분탐색"],
      author: { name: "kim", tier: "SILVER" },
      createdAt: iso(90),
      upvotes: 4,
      views: 1520,
    },
  ],
  answers: [
    {
      id: "a1",
      postId: "p2",
      author: { name: "park", tier: "BRONZE" },
      body: "답변",
      createdAt: iso(30),
      upvotes: 1,
    },
  ],
  upvoted: [],
  saved: [],
  followed: ["kim"],
  accepted: {},
  deleted: [],
};

async function seed(page: Page) {
  await page.addInitScript(
    ({ session, data }) => {
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({ session, expiresAt: Date.now() + 900_000 }),
      );
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(data));
    },
    {
      session: {
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
      },
      data: community,
    },
  );
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 1 },
    }),
  );
}

/** 보이는 크기와 별개로, 요소 바깥 몇 픽셀을 눌러도 그 요소가 눌리는지 본다. */
async function hitsTarget(page: Page, selector: string, outsidePx: number) {
  return page.locator(selector).first().evaluate((el, gap) => {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const probe = (y: number) =>
      document.elementsFromPoint(x, y).some((hit) => el === hit || el.contains(hit));
    return probe(rect.top - gap) && probe(rect.bottom + gap);
  }, outsidePx);
}

test("mission links and community back links have a comfortable press area", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/missions");
  await expect(page.locator(".mission-start").first()).toBeVisible();
  expect(await hitsTarget(page, ".mission-start", 9)).toBe(true);

  await page.goto("/community/p2");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await hitsTarget(page, ".post-page .back-link", 9)).toBe(true);
  expect(await hitsTarget(page, ".post-tags a", 7)).toBe(true);
  await page.locator(".answers-toggle").click();
  expect(await hitsTarget(page, ".answer-vote", 8)).toBe(true);
});

test("community detail keeps heading levels in order and small badges stay readable", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/community/p2");
  const levels = await page
    .locator("h1, h2, h3")
    .evaluateAll((headings) => headings.map((h) => Number(h.tagName[1])));
  // h1 다음에 h3으로 건너뛰지 않는다.
  levels.forEach((level, index) => {
    if (index > 0) expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
  });
  await expect(page.getByRole("heading", { name: "답변 작성", level: 2 })).toBeVisible();

  await page.goto("/community");
  const badge = page.locator(".post-follow-badge").first();
  await expect(badge).toBeVisible();
  expect(
    await badge.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(12);
});

test("community copy is plain Korean and the list shows what the count counts", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/community");
  await expect(page.getByText("질문하고 풀이를 나누면 막힌 곳이 풀려요.")).toBeVisible();
  await expect(page.locator(".total-count")).toHaveText("글 1개");
  await expect(page.getByLabel("게시글 검색")).toHaveAttribute(
    "placeholder",
    "질문·풀이 검색 (#태그 + Enter)",
  );
});

test("the season ring respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page);
  await page.goto("/missions");
  const animation = await page
    .locator(".season-ring-arc")
    .evaluate((el) => getComputedStyle(el).animationName);
  expect(animation).toBe("none");
});

const problem = (n: number) => ({
  id: `prob-${n}`,
  slug: `problem-${n}`,
  title: `임시 문제 ${n}`,
  difficulty: "EASY",
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  createdAt: "2026-09-01T00:00:00Z",
});

const problemsRoute = (page: Page, items: ReturnType<typeof problem>[]) =>
  page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items, page: 1, limit: 1000, total: items.length, totalPages: 1 },
    }),
  );

test("the XP double card uses the same format as the mission cards and links to its problem", async ({
  page,
}) => {
  await seed(page);
  await problemsRoute(page, [problem(1), problem(2), problem(3)]);
  await page.goto("/missions");
  const card = page.locator(".xp-boost-card");
  await expect(card.getByRole("heading", { name: "XP 두 배 문제!" })).toBeVisible();
  // 알약 · 설명과 개수 · 진행 막대 · 보상 · 이동 링크가 다른 미션 카드와 같은 순서로 있다.
  await expect(card.locator(".mission-status")).toHaveText("시작 전");
  await expect(card.locator(".mission-count")).toHaveText("0 / 1");
  await expect(card.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "1");
  await expect(card.locator(".mission-reward")).toHaveText("XP 2배");
  const link = card.getByRole("link", { name: /시작하기/ });
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/problems\/view\/problem-[123]$/);
  const number = href!.split("-").pop()!;
  await expect(card).toContainText(`임시 문제 ${number} · 쉬움`);
  // 난이도는 난이도별 색 글자로 보인다(설명 글자색과 다르다).
  const level = card.locator(".difficulty");
  await expect(level).toHaveClass(/difficulty-easy/);
  const colors = await card.evaluate((el) => ({
    level: getComputedStyle(el.querySelector(".difficulty")!).color,
    text: getComputedStyle(el.querySelector(".mission-line p")!).color,
  }));
  expect(colors.level).not.toBe(colors.text);
  await link.click();
  await expect(page).toHaveURL(href!);
});

test("the XP double card skips problems already solved and turns done when all are solved", async ({
  page,
}) => {
  await seed(page);
  await problemsRoute(page, [problem(1), problem(2), problem(3)]);
  const accepted = (n: number) => ({
    id: `s${n}`,
    problem: { id: `prob-${n}`, slug: `problem-${n}`, title: `임시 문제 ${n}` },
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 1,
    memoryKb: 1,
    passedTestCases: 1,
    totalTestCases: 1,
    compileOutput: null,
    judgeMessage: null,
    createdAt: iso(60 * 24 * 5),
    updatedAt: iso(60 * 24 * 5),
  });
  const submissions = [accepted(1), accepted(2)];
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items: submissions, page: 1, limit: 1000, total: 2, totalPages: 1 },
    }),
  );
  await page.goto("/missions");
  // 안 푼 문제는 3번뿐이다.
  await expect(page.locator(".xp-boost-card")).toContainText("임시 문제 3");

  // 전부 풀었으면 어떤 문제를 골라도 달성으로 보인다.
  submissions.push(accepted(3));
  await page.reload();
  const card = page.locator(".xp-boost-card");
  await expect(card.locator(".mission-count")).toHaveText("1 / 1");
  await expect(card.locator(".mission-status")).toHaveText("달성");
  await expect(card.getByRole("link")).toHaveCount(0);
});

test("the XP double card falls back to the problem list when nothing can be picked", async ({
  page,
}) => {
  await seed(page);
  await problemsRoute(page, []);
  await page.goto("/missions");
  const card = page.locator(".xp-boost-card");
  await expect(card).toContainText("지금은 고를 수 있는 문제가 없어요.");
  await expect(card.getByRole("link", { name: /문제 목록 보기/ })).toHaveAttribute(
    "href",
    "/problems",
  );
});

test("the XP double card has the same width and height as the streak card", async ({
  page,
}) => {
  await seed(page);
  await problemsRoute(page, [problem(1)]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/missions");
  await expect(page.locator(".xp-boost-card .mission-start")).toBeVisible();
  const box = async (selector: string) => (await page.locator(selector).boundingBox())!;
  const streak = await box(".mission-streak");
  const xp = await box(".xp-boost-card");
  expect(Math.abs(streak.width - xp.width)).toBeLessThan(1);
  expect(Math.abs(streak.height - xp.height)).toBeLessThan(1);
  expect(Math.abs(streak.y - xp.y)).toBeLessThan(1);
  // 이 폭에서도 진행 막대 옆에 요일 기록이 가로로 놓인다.
  const week = await box(".mission-streak-week");
  const main = await box(".mission-streak-main");
  expect(week.x).toBeGreaterThan(main.x + main.width - 1);
});

test("buttons inside empty states keep readable text on their solid background", async ({
  page,
}) => {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/enterprise");
    const button = page.locator(".ent-empty .button");
    await expect(button).toBeVisible();
    const colors = await button.evaluate((el) => {
      const parse = (value: string) =>
        (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const luminance = ([r, g, b]: number[]) =>
        0.2126 * (r / 255) ** 2.2 + 0.7152 * (g / 255) ** 2.2 + 0.0722 * (b / 255) ** 2.2;
      const style = getComputedStyle(el);
      const text = luminance(parse(style.color));
      const fill = luminance(parse(style.backgroundColor));
      return { ratio: (Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05) };
    });
    // 파란 글자가 파란 버튼 위에 놓이면 대비가 1에 가깝다. 4.5 이상이어야 읽을 수 있다.
    expect(colors.ratio).toBeGreaterThan(4.5);
  }
});
