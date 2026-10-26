import { expect, test, type Page } from "@playwright/test";
import { mockCommunityApi } from "./fixtures";
import { mockMissions } from "./mission-fixtures";

const iso = (minutesAgo: number) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

async function seed(page: Page) {
  await mockMissions(page);
  await page.addInitScript(
    ({ session }) => {
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({ session, expiresAt: Date.now() + 900_000 }),
      );
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
    },
  );
  await mockCommunityApi(page, {
    posts: [
      {
        id: "p2",
        category: "question",
        title: "이분 탐색에서 mid 계산이 오버플로나는 이유",
        tags: ["이분탐색"],
        author: "kim",
        createdAt: iso(90),
        upvotes: 4,
        views: 1520,
      },
    ],
    answers: [
      { id: "a1", postId: "p2", author: "park", body: "답변", createdAt: iso(30) },
    ],
    following: ["kim"],
  });
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
  await expect.poll(() => hitsTarget(page, ".mission-start", 9)).toBe(true);

  await page.goto("/community/p2");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect.poll(() => hitsTarget(page, ".post-page .back-link", 9)).toBe(true);
  await expect.poll(() => hitsTarget(page, ".post-tags a", 7)).toBe(true);
  await page.locator(".answers-toggle").click();
  await expect.poll(() => hitsTarget(page, ".answer-vote", 8)).toBe(true);
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

test("community copy is plain Korean", async ({
  page,
}) => {
  await seed(page);
  await page.goto("/community");
  await expect(page.getByText("질문하고 풀이를 나누면 막힌 곳이 풀려요.")).toBeVisible();
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

// Bonus assignment/claims use server data; covered by server-missions.spec.ts.

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
