import { expect, test } from "@playwright/test";
import { mockProblemList, readAll } from "./fixtures";

test("the problem list asks the server for one page and searches all imported problems there", async ({
  page,
}) => {
  const total = 9744;
  const items = Array.from({ length: total }, (_, index) => ({
    id: `p-${index}`,
    slug: `problem-${index}`,
    title: index === total - 1 ? "마지막문제" : `문제 ${index}`,
    difficulty: "BEGINNER" as const,
    timeLimitMs: 1000,
    memoryLimitMb: 256,
    createdAt: "2026-09-28T00:00:00Z",
  }));
  const requests = await mockProblemList(page, items);
  await page.goto("/problems");
  await expect(page.locator(".total-count")).toHaveText("1 - 20/9744");
  // 전체를 이어 읽지 않는다: 첫 쪽 20개만 받는다(개발 모드 StrictMode는 같은 요청을 한 번 더 보내고 앞의 것을 취소한다).
  expect(
    new Set(requests.map((query) => `${query.get("page")}/${query.get("limit")}`)),
  ).toEqual(new Set(["1/20"]));
  await page.getByRole("searchbox", { name: "문제 검색" }).fill("마지막문제");
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  await expect(page.locator("a.problem-row")).toContainText("마지막문제");
  expect(requests.at(-1)?.get("q")).toBe("마지막문제");
});

test("paginated history reads beyond page five with authentication", async ({
  page,
}) => {
  const total = 6001;
  await page.route("**/api/v1/pagination-test?*", (route) => {
    expect(route.request().headers().authorization).toBe("Bearer test-token");
    const query = new URL(route.request().url()).searchParams;
    const current = Number(query.get("page"));
    const limit = Number(query.get("limit"));
    const start = (current - 1) * limit;
    return route.fulfill({
      json: {
        items: Array.from(
          { length: Math.min(limit, total - start) },
          (_, i) => start + i,
        ),
        page: current,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  });
  await page.goto("/auth");
  const items = await readAll(page, "/pagination-test", "test-token");
  expect(items).toHaveLength(total);
  expect(items.at(-1)).toBe(6000);
});

test("rate limits retry the same page without duplicating or dropping items", async ({
  page,
}) => {
  const requested: number[] = [];
  await page.route("**/api/v1/pagination-test?*", (route) => {
    const current = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    requested.push(current);
    if (current === 2 && requested.filter((value) => value === 2).length === 1)
      return route.fulfill({
        status: 429,
        headers: {
          "Retry-After": "0",
          "Access-Control-Expose-Headers": "Retry-After",
        },
        json: { message: "retry" },
      });
    return route.fulfill({
      json: {
        items: [current],
        page: current,
        limit: 1,
        total: 3,
        totalPages: 3,
      },
    });
  });
  await page.goto("/auth");
  expect(await readAll(page, "/pagination-test", "test-token")).toEqual([1, 2, 3]);
  expect(requested).toEqual([1, 2, 2, 3]);
});

test("aborting a rate-limit wait cancels the request instead of returning partial history", async ({
  page,
}) => {
  await page.route("**/api/v1/pagination-test?*", (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "60" },
      json: { message: "retry" },
    }),
  );
  await page.goto("/auth");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/pagination.ts";
    const { fetchAll } = await import(modulePath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 100);
    try {
      await fetchAll("/pagination-test", controller.signal);
      return "unexpected success";
    } catch (error) {
      return error instanceof Error ? error.name : "unknown";
    } finally {
      clearTimeout(timer);
    }
  });
  expect(result).toBe("AbortError");
});

test("a failed later page never returns an apparently complete partial list", async ({
  page,
}) => {
  await page.route("**/api/v1/pagination-test?*", (route) => {
    const current = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    return current === 6
      ? route.fulfill({ status: 503, json: { message: "history unavailable" } })
      : route.fulfill({
          json: {
            items: [current],
            page: current,
            limit: 1,
            total: 6,
            totalPages: 6,
          },
        });
  });
  await page.goto("/auth");
  await expect(readAll(page, "/pagination-test", "test-token")).rejects.toThrow("history unavailable");
});
