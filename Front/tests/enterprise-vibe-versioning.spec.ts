import { expect, test, type Page } from "@playwright/test";
import type { EnterpriseTestDetail } from "../src/enterprise/model";
import { authenticate, mockProblemApi, problem } from "./fixtures";

const iso = (offset: number) => new Date(Date.now() + offset).toISOString();
const pinned = { id: "vibe-one", version: "a".repeat(64), title: "처음 고정한 과제", difficulty: "EASY", stack: "JavaScript", durationMin: 30 };
const current = { id: pinned.id, title: "나중에 바뀐 과제", difficulty: "HARD", stack: "JavaScript", durationMin: 60, summary: "new source", requirements: [], rubric: [] };
const exam = (running = false): EnterpriseTestDetail => ({
  id: "t-vibe-version", title: "바이브 버전 시험", description: "",
  startsAt: iso(running ? -60_000 : 86_400_000), endsAt: iso(172_800_000), durationMin: 60,
  problemIds: [problem.id], selectedProblems: [], vibeChallengeIds: [pinned.id],
  vibeChallengeVersions: [{ challengeId: pinned.id, version: pinned.version }], vibeVersionPolicy: "ON_SELECTION",
  selectedVibeChallenges: [pinned], inviteCode: "vibe-version", inviteOnly: false, invitees: [],
  showScoreToCandidates: false, attemptCount: 0, createdAt: iso(-60_000), updatedAt: iso(-60_000),
});

async function setup(page: Page, options: { running?: boolean; missing?: boolean } = {}) {
  await authenticate(page);
  await mockProblemApi(page);
  await page.route("**/api/v1/notifications/unread-count", route => route.fulfill({ json: { unread: 0 } }));
  await page.route("**/api/v1/problems/mine", route => route.fulfill({ json: [] }));
  await page.route("**/api/v1/vibe/challenges", route => route.fulfill({ json: { items: options.missing ? [] : [current], availability: { ai: false, runner: false } } }));
  await page.route("**/api/v1/enterprise/tests/t-vibe-version", route => route.fulfill({ json: exam(options.running) }));
  await page.route("**/api/v1/enterprise/tests/t-vibe-version/results*", route => route.fulfill({ json: {
    test: exam(options.running), summary: { candidates: 0, averageScore: null, perfect: 0 },
    pagination: { page: 1, limit: 50, total: 0, totalPages: 0 }, candidates: [],
  } }));
}

test("owner detail labels the selected Vibe snapshot rather than the changing catalog", async ({ page }) => {
  await setup(page);
  await page.goto("/enterprise/t-vibe-version");
  const selected = page.getByRole("region", { name: "출제 문제", exact: true });
  await expect(selected).toContainText(pinned.title);
  await expect(selected).toContainText("선택 시 고정");
  await expect(selected).not.toContainText(current.title);
  await expect(selected).not.toContainText(pinned.version);
});

for (const refresh of [false, true]) {
  test(`Vibe refresh is separate and explicit when saving (${refresh})`, async ({ page }) => {
    await setup(page);
    const updates: Record<string, unknown>[] = [];
    await page.route("**/api/v1/enterprise/tests/t-vibe-version", route => {
      if (route.request().method() === "PATCH") updates.push(route.request().postDataJSON());
      return route.fulfill({ json: exam() });
    });
    await page.goto("/enterprise/t-vibe-version/edit");
    await expect(page.getByRole("checkbox", { name: new RegExp(pinned.title) })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: new RegExp(current.title) })).toHaveCount(0);
    const control = page.getByRole("checkbox", { name: /선택한 바이브코딩 과제를 모두 최신 버전으로 갱신/ });
    await expect(control).not.toBeChecked();
    if (refresh) {
      await control.check();
      await expect(page.getByRole("checkbox", { name: new RegExp(current.title) })).toBeChecked();
    }
    await page.getByRole("button", { name: "변경 저장", exact: true }).click();
    await expect.poll(() => updates.length).toBe(1);
    expect(updates[0]).toMatchObject({ vibeChallengeIds: [pinned.id], refreshVibeVersions: refresh, refreshProblemVersions: false });
  });
}

test("a selected task removed from the catalog retains its pinned description and can be removed", async ({ page }) => {
  await setup(page, { missing: true });
  await page.goto("/enterprise/t-vibe-version/edit");
  const selected = page.getByRole("checkbox", { name: new RegExp(pinned.title) });
  await expect(selected).toBeChecked();
  await expect(page.getByText("현재 목록에 없는 고정 과제", { exact: true })).toBeVisible();
  await selected.uncheck();
  await expect(selected).not.toBeChecked();
  await expect(selected).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: /선택한 바이브코딩 과제를 모두 최신 버전으로 갱신/ })).toHaveCount(0);
});

test("a started assessment cannot offer the Vibe refresh control", async ({ page }) => {
  await setup(page, { running: true });
  await page.goto("/enterprise/t-vibe-version/edit");
  await expect(page.getByText("시작된 테스트는 수정할 수 없어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /최신 버전으로 갱신/ })).toHaveCount(0);
});
