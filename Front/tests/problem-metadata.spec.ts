import { expect, test, type Page } from "@playwright/test";
import { authenticate, mockProblemApi, problem } from "./fixtures";

const tagged = {
  ...problem,
  tags: ["그래프", "구현"],
  editorialMarkdown: "## 풀이\nBFS로 푼다.",
  solverCount: 12,
  acceptanceRate: 41.5,
};

async function mockDetail(page: Page, accepted: boolean) {
  await mockProblemApi(page);
  await page.route("**/api/v1/problems/by-slug/sum", (route) =>
    route.fulfill({ json: tagged }),
  );
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "s1",
            problem: { id: problem.id },
            status: accepted ? "ACCEPTED" : "WRONG_ANSWER",
            createdAt: problem.createdAt,
          },
        ],
        page: 1,
        limit: 1000,
        total: 1,
        totalPages: 1,
      },
    }),
  );
}

test("problem list filters by tag from the URL-backed tag select", async ({
  page,
}) => {
  await mockProblemApi(page);
  const items = [
    { ...problem, id: "a", slug: "a", title: "그래프 문제", tags: ["그래프"] },
    { ...problem, id: "b", slug: "b", title: "수학 문제", tags: ["수학"] },
    { ...problem, id: "c", slug: "c", title: "태그 없는 문제" },
  ];
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items, total: 3, totalPages: 1, page: 1, limit: 1000 },
    }),
  );
  await page.goto("/problems");
  await page.getByRole("combobox", { name: "태그 필터" }).click();
  await page.getByRole("option", { name: "그래프 (1)", exact: true }).click();
  await expect(page).toHaveURL(/[?&]t=%EA%B7%B8%EB%9E%98%ED%94%84(&|$)/);
  await expect(page.getByRole("link", { name: /그래프 문제/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /수학 문제/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /태그 없는 문제/ })).toHaveCount(0);
});

test("problem page shows stats and tags, and gates the editorial behind a spoiler", async ({
  page,
}) => {
  await mockDetail(page, false);
  await page.goto("/problems/view/sum");
  const meta = page.locator(".meta-strip");
  await expect(meta).toContainText("푼 사람 12명");
  await expect(meta).toContainText("정답률 41.5%");
  await expect(page.getByRole("link", { name: "#그래프" })).toHaveAttribute(
    "href",
    "/problems?t=%EA%B7%B8%EB%9E%98%ED%94%84",
  );
  await page.getByRole("tab", { name: "해설" }).click();
  await expect(page.getByText("아직 이 문제를 해결하지 않았어요.")).toBeVisible();
  await expect(page.getByText("BFS로 푼다.")).toHaveCount(0);
  await page.getByRole("button", { name: "스포일러 보기" }).click();
  await expect(page.getByText("BFS로 푼다.")).toBeVisible();
});

test("a solver sees the editorial without the spoiler gate", async ({ page }) => {
  await authenticate(page);
  await mockDetail(page, true);
  await page.goto("/problems/view/sum");
  await page.getByRole("tab", { name: "해설" }).click();
  await expect(page.getByText("BFS로 푼다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "스포일러 보기" })).toHaveCount(0);
});

test("problems without an editorial have no editorial tab", async ({ page }) => {
  await mockProblemApi(page);
  await page.goto("/problems/view/sum");
  await expect(page.getByRole("tab", { name: "문제 설명" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "해설" })).toHaveCount(0);
});

test("authors save deduplicated tags and the editorial", async ({ page }) => {
  await authenticate(page, "ADMIN");
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/problems/by-slug/new", (route) =>
    submitted
      ? route.fulfill({ json: { ...problem, ...submitted } })
      : route.fulfill({ status: 404, json: { message: "Not found" } }),
  );
  await page.route("**/api/v1/problems", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ...problem, ...submitted } });
  });
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill(problem.title);
  await page.getByLabel("주소용 slug").fill("new");
  await page.getByLabel("태그 (선택)").fill(" 구현, 수학,구현 ,");
  await page.getByLabel("문제 본문 (Markdown)").fill("본문");
  await page.getByLabel("입력 설명").fill("두 정수");
  await page.getByLabel("출력 설명").fill("합");
  await page.getByText("해설 (선택)").click();
  await page.getByLabel("해설 (Markdown)").fill("## 풀이");
  await page.getByLabel("입력", { exact: true }).fill("1 2");
  await page.getByLabel("기대 출력").fill("3");
  await page.getByRole("button", { name: "문제 게시하기 →" }).click();
  await expect(page).toHaveURL(/\/problems\/view\/new$/);
  expect(submitted).toMatchObject({
    tags: ["구현", "수학"],
    editorialMarkdown: "## 풀이",
  });
});

test("too many tags block saving with a field error", async ({ page }) => {
  await authenticate(page, "ADMIN");
  let posted = false;
  await page.route("**/api/v1/problems", (route) => {
    posted = true;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.goto("/problems/new");
  await page
    .getByLabel("태그 (선택)")
    .fill(Array.from({ length: 11 }, (_, i) => `t${i}`).join(","));
  await page.getByRole("button", { name: "문제 게시하기 →" }).click();
  await expect(page.getByText("태그는 10개까지 붙일 수 있어요.")).toBeVisible();
  expect(posted).toBe(false);
});
