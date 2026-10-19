import { expect, test } from "@playwright/test";

for (const example of [
  { name: "submitted snapshot", actual: "3\n", expected: "3\n", matches: true },
  {
    name: "internal line whitespace",
    actual: "3 \n4\n",
    expected: "3\n4\n",
    matches: false,
  },
  {
    name: "internal CRLF",
    actual: "3\r\n4\r\n",
    expected: "3\n4\n",
    matches: false,
  },
  {
    name: "non-ASCII whitespace",
    actual: "3\u00a0",
    expected: "3",
    matches: false,
  },
  {
    name: "truncated output",
    actual: "3",
    expected: "3",
    truncated: true,
    matches: null,
  },
  {
    name: "missing snapshot",
    actual: "3",
    expected: "3",
    missing: true,
    matches: null,
  },
]) {
  test(`public output comparison uses ${example.name}`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "unsolvable-oj-session-v1",
        JSON.stringify({
          expiresAt: Date.now() + 900_000,
          session: {
            accessToken: "solver-token",
            tokenType: "Bearer",
            expiresIn: "15m",
            user: {
              id: "solver",
              username: "solver",
              email: "solver@example.com",
              role: "USER",
              level: 1,
              xp: 0,
              rating: 0,
            },
          },
        }),
      );
    });
    let latestProblemReads = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/v1/submissions/old-result")
        return route.fulfill({
          json: {
            id: "old-result",
            problem: { id: "sum", slug: "sum", title: "수정된 문제" },
            problemVersion: 1,
            language: "PYTHON",
            status: "WRONG_ANSWER",
            runtimeMs: 1,
            memoryKb: 100,
            passedTestCases: 0,
            totalTestCases: 2,
            compileOutput: null,
            judgeMessage: null,
            sourceCode: "print(3)",
            sampleTestCases: example.missing
              ? []
              : [
                  {
                    testCase: 2,
                    input: "old input",
                    expectedOutput: example.expected,
                  },
                ],
            debugOutputs: [
              {
                testCase: 2,
                stdout: example.actual,
                stderr: "",
                stdoutTruncated: example.truncated ?? false,
                stderrTruncated: false,
              },
            ],
            createdAt: "2026-09-01T00:00:00Z",
            updatedAt: "2026-09-01T00:00:00Z",
          },
        });
      if (path.startsWith("/api/v1/problems/")) {
        latestProblemReads += 1;
        return route.fulfill({
          json: {
            samples: [{ input: "NEW input", expectedOutput: "NEW answer" }],
          },
        });
      }
      return route.fulfill({
        json: { items: [], page: 1, limit: 1000, total: 0, totalPages: 0 },
      });
    });
    await page.goto("/submissions/old-result");
    const result = page.locator(".case-result");
    await expect(result.getByRole("heading", { name: "예제 1" })).toBeVisible();
    if (!example.missing) await expect(result).toContainText("old input");
    await expect(result).not.toContainText("NEW input");
    if (example.matches === null)
      await expect(result.locator(".case-pill")).toHaveCount(0);
    else
      await expect(result.locator(".case-pill")).toHaveText(
        example.matches ? "기대 출력과 같아요" : "기대 출력과 달라요",
      );
    expect(latestProblemReads).toBe(0);
  });
}
