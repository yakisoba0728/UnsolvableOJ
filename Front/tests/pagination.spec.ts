import { expect, test } from "@playwright/test";
import { readAll } from "./fixtures";

test("all imported problems remain searchable beyond five pages", async ({
  page,
}) => {
  const total = 9744;
  const requested = new Set<number>();
  await page.route("**/api/v1/problems?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const current = Number(query.get("page"));
    const limit = Number(query.get("limit"));
    requested.add(current);
    const start = (current - 1) * limit;
    return route.fulfill({
      json: {
        page: current,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        items: Array.from(
          { length: Math.min(limit, total - start) },
          (_, offset) => ({
            id: `p-${start + offset}`,
            slug: `problem-${start + offset}`,
            title:
              start + offset === total - 1
                ? "마지막문제"
                : `문제 ${start + offset}`,
            difficulty: "BEGINNER",
            timeLimitMs: 1000,
            memoryLimitMb: 256,
            createdAt: "2026-09-28T00:00:00Z",
          }),
        ),
      },
    });
  });
  await page.goto("/problems");
  await expect(page.locator(".total-count")).toHaveText("1 - 20/9744");
  expect([...requested].sort((a, b) => a - b)).toEqual(
    Array.from({ length: 10 }, (_, i) => i + 1),
  );
  await page.getByRole("searchbox", { name: "문제 검색" }).fill("마지막문제");
  await expect(page.locator("a.problem-row")).toHaveCount(1);
  await expect(page.locator("a.problem-row")).toContainText("마지막문제");
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
