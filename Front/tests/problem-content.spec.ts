import { expect, test } from "@playwright/test";

test("renders imported tables and math while removing active HTML", async ({ page }) => {
  await page.route("**/api/v1/problems/by-slug/boj-content-test", (route) => route.fulfill({ json: {
    id: "imported", slug: "boj-content-test", title: "한국어 문제", difficulty: "MEDIUM",
    timeLimitMs: 1000, memoryLimitMb: 128, status: "PUBLISHED", samples: [],
    statementMarkdown: '한글 $a_i < b$\n\n$$\n\\sum_i a_i\n$$\n\n<table><tr><td rowspan="2"><code class="math-inline">n_1</code></td><td>x<sup>2</sup></td></tr><tr><td>값</td></tr></table>\n\n<script>window.bojInjected=true</script><img src="/missing.png" onerror="window.bojInjected=true"><a href="javascript:alert(1)">위험 링크</a>',
    inputDescriptionMarkdown: "정수 한 개", outputDescriptionMarkdown: "정답", createdAt: "2026-09-28T00:00:00Z",
  } }));
  await page.goto("/problems/view/boj-content-test");
  await expect(page.getByRole("heading", { name: "한국어 문제", exact: true })).toBeVisible();
  await expect(page.locator(".katex")).toHaveCount(3);
  await expect(page.locator("table td[rowspan='2'] .katex")).toBeVisible();
  await expect(page.locator("table sup")).toHaveText("2");
  await expect(page.locator(".problem-content script, .problem-content [onerror], .problem-content a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => "bojInjected" in window)).toBe(false);
});
