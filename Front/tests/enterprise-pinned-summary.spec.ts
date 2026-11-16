import { expect, test, type Page } from "@playwright/test";
import type { EnterpriseTestDetail } from "../src/enterprise/model";
import { authenticate, problem } from "./fixtures";

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const selected = {
  id: problem.id, version: 2, title: "선택한 두 번째 버전", difficulty: "HARD",
  timeLimitMs: 1500, memoryLimitMb: 128,
};

async function setup(page: Page, sourceVisible = true) {
  const saved: EnterpriseTestDetail = {
    id: "t-summary", title: "고정 요약 시험", description: "",
    startsAt: iso(-3_600_000), endsAt: iso(3_600_000), durationMin: 60,
    problemIds: [problem.id], problemVersions: [{ problemId: problem.id, version: 2 }],
    selectedProblems: [selected], inviteCode: "summary", inviteOnly: false,
    invitees: [], showScoreToCandidates: true, attemptCount: 1,
    createdAt: iso(-86_400_000), updatedAt: iso(-60_000),
  };
  await authenticate(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
  await page.route("**/api/v1/vibe/challenges", route => route.fulfill({ json: { items: [], availability: { ai: false, runner: false } } }));
  await page.route("**/api/v1/problems/mine", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/problems?*", route => route.fulfill({ json: {
    items: sourceVisible ? [{
      ...problem, title: "나중에 바뀐 세 번째 원본", difficulty: "EXPERT",
      timeLimitMs: 9000, memoryLimitMb: 512,
    }] : [],
    page: 1, limit: 1000, total: sourceVisible ? 1 : 0, totalPages: sourceVisible ? 1 : 0,
  } }));
  await page.route("**/api/v1/enterprise/tests/t-summary", route => route.fulfill({ json: saved }));
  await page.route("**/api/v1/enterprise/tests/t-summary/results*", route => {
    const { selectedProblems: _selectedProblems, ...summary } = saved;
    return route.fulfill({ json: {
      test: summary, summary: { candidates: 1, averageScore: 100, perfect: 1 },
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      candidates: [{
        id: "a-summary", startedAt: iso(-3_600_000), deadlineAt: iso(3_600_000), finishedAt: iso(-1000),
        user: { id: "candidate", username: "candidate" }, solved: 1, score: 100,
        problems: [{ problemId: problem.id, solved: true, submissions: 1, submissionId: "s-summary" }],
      }],
    } });
  });
}

test("owner detail and result headings retain the selected revision after the live source changes", async ({ page }) => {
  await setup(page);
  await page.goto("/enterprise/t-summary");
  const selection = page.getByRole("region", { name: "출제 문제", exact: true });
  await expect(selection).toContainText(selected.title);
  await expect(selection).toContainText("고정 v2");
  await expect(selection).toContainText("어려움");
  await expect(selection).toContainText("1500ms · 128MB");
  await expect(selection).not.toContainText("세 번째 원본");
  await expect(selection).not.toContainText("9000ms");
  await expect(selection.getByRole("link", { name: `${selected.title} 현재 원본 보기` })).toHaveAttribute("href", `/problems/view/${problem.slug}`);
  await expect(page.getByRole("columnheader", { name: /1번.*선택한 두 번째 버전.*고정 v2/ })).toBeVisible();
  await page.reload();
  await expect(selection).toContainText(selected.title);
  await expect(selection).not.toContainText("세 번째 원본");
});

test("selected metadata remains available when the current source is no longer in the authorized catalog", async ({ page }) => {
  await setup(page, false);
  const catalog = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/problems");
  await page.goto("/enterprise/t-summary");
  await catalog;
  const selection = page.getByRole("region", { name: "출제 문제", exact: true });
  await expect(selection).toContainText(selected.title);
  await expect(selection).toContainText("고정 v2");
  await expect(selection).toContainText("1500ms · 128MB");
  await expect(selection.getByRole("link", { name: /현재 원본 보기/ })).toHaveCount(0);
  await expect(selection).not.toContainText("비공개 또는 삭제된 문제");
});
