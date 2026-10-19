import { expect, test, type Page } from "@playwright/test";
import type { Session } from "../src/types";

const sessionKey = "unsolvable-oj-session-v1";
const testsKey = "unsolvable-oj-enterprise-v1";
const session: Session = {
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
};
const problems = [
  ["p1", "two-sum", "두 수의 합", "BEGINNER"],
  ["p2", "sort", "수 정렬하기", "EASY"],
  ["p3", "lis", "가장 긴 증가하는 부분 수열", "MEDIUM"],
].map(([id, slug, title, difficulty]) => ({
  id,
  slug,
  title,
  difficulty,
  timeLimitMs: 1000,
  memoryLimitMb: 256,
  createdAt: "2026-09-01T00:00:00Z",
}));

async function signIn(page: Page) {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    { key: sessionKey, saved: { session, expiresAt: Date.now() + 900_000 } },
  );
}

async function mockProblems(page: Page) {
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items: problems, page: 1, limit: 1000, total: 3, totalPages: 1 },
    }),
  );
}

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("signed-out visitors see a login prompt instead of tests", async ({ page }) => {
  await page.goto("/enterprise");
  await expect(page.getByRole("heading", { name: "기업 코드 테스트" })).toBeVisible();
  await expect(page.getByText("로그인하고 코드 테스트를 만들어 보세요")).toBeVisible();
  await expect(page.getByRole("button", { name: /새 테스트 만들기/ })).toHaveCount(0);
  await expect(page.locator(".ent-table")).toHaveCount(0);
  await page.goto("/enterprise/new");
  await expect(page.getByText("로그인하고 코드 테스트를 만들어 보세요")).toBeVisible();
});

test("empty state invites the first test", async ({ page }) => {
  await signIn(page);
  await page.goto("/enterprise");
  await expect(page.getByText("아직 만든 테스트가 없어요")).toBeVisible();
  await page.getByRole("link", { name: /첫 테스트 만들기/ }).click();
  await expect(page).toHaveURL(/\/enterprise\/new$/);
});

test("dashboard groups tests by status and offers the right management action", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    {
      key: testsKey,
      saved: {
        solver: [
          { id: "t-closed", title: "지난 인턴 선발", description: "", startsAt: iso(-2 * DAY), endsAt: iso(-DAY), durationMin: 60, problemIds: ["p1", "p2"], createdAt: iso(-3 * DAY), updatedAt: iso(-3 * DAY) },
          { id: "t-soon", title: "다음 주 공채", description: "", startsAt: iso(DAY), endsAt: iso(3 * DAY), durationMin: 90, problemIds: ["p1"], createdAt: iso(-HOUR), updatedAt: iso(-HOUR) },
          { id: "t-live", title: "진행 중 공채", description: "", startsAt: iso(-HOUR), endsAt: iso(HOUR), durationMin: 30, problemIds: ["p1", "p2", "p3"], createdAt: iso(-DAY), updatedAt: iso(-DAY) },
        ],
        other: [
          { id: "t-other", title: "남의 테스트", description: "", startsAt: iso(-HOUR), endsAt: iso(HOUR), durationMin: 30, problemIds: ["p1"], createdAt: iso(-DAY), updatedAt: iso(-DAY) },
        ],
      },
    },
  );
  await signIn(page);
  await page.goto("/enterprise");

  const tiles = page.getByLabel("테스트 지표");
  await expect(tiles.locator(".stat-tile").first()).toContainText("진행 중 테스트");
  await expect(tiles.locator(".stat-tile").first()).toContainText("1");
  await expect(tiles.locator(".stat-tile").first()).toContainText("예정 1건");
  await expect(tiles).toContainText("응시 기능 연동 후");

  const rows = page.locator(".ent-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("진행 중 공채");
  await expect(rows.nth(0)).toContainText("3문항 · 30분");
  await expect(rows.nth(0).getByRole("progressbar")).toBeVisible();
  await expect(rows.nth(0).getByRole("link", { name: /상세 보기/ })).toBeVisible();
  await expect(rows.nth(1)).toContainText("다음 주 공채");
  await expect(rows.nth(1)).toContainText("시작 예정");
  await expect(rows.nth(1).getByRole("link", { name: /편집/ })).toBeVisible();
  await expect(rows.nth(2)).toContainText("지난 인턴 선발");
  await expect(rows.nth(2)).toContainText("마감");
  await expect(page.getByText("남의 테스트")).toHaveCount(0); // 계정별로 따로 보관
  await expect(page.getByText("3건 · 지표는 전체 테스트 집계 기준")).toBeVisible();

  // 시작된 테스트는 수정할 수 없다.
  await page.goto("/enterprise/t-live/edit");
  await expect(page.getByText("시작된 테스트는 수정할 수 없어요")).toBeVisible();
});

test("create, edit and delete a test", async ({ page }) => {
  await signIn(page);
  await mockProblems(page);
  await page.goto("/enterprise/new");

  // 비어 있는 채로 저장하면 이유를 알려 주고 첫 오류로 이동한다.
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page.getByText("테스트 이름을 입력해 주세요.")).toBeVisible();
  await expect(page.getByText("출제할 문제를 하나 이상 골라 주세요.")).toBeVisible();
  await expect(page.getByLabel(/테스트 이름/)).toBeFocused();

  await page.getByLabel(/테스트 이름/).fill("백엔드 신입 공채 1차");
  await page.getByLabel(/안내 문구/).fill("노트북 반입 금지");
  await page.getByLabel("문제 검색").fill("정렬");
  await expect(page.locator(".ent-problem")).toHaveCount(1);
  await page.getByLabel("문제 검색").fill("");
  await page.getByRole("checkbox", { name: /수 정렬하기/ }).check();
  await page.getByRole("checkbox", { name: /두 수의 합/ }).check();
  await expect(page.getByText("2 / 20개 선택")).toBeVisible();
  await expect(page.getByText("테스트 이름을 입력해 주세요.")).toHaveCount(0);

  // 제한 시간이 응시 기간보다 길면 막는다.
  await page.getByLabel("제한 시간 (분)").fill("9");
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page.getByText(/10~600분 사이의 정수/)).toBeVisible();
  await page.getByLabel("제한 시간 (분)").fill("120");

  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page).toHaveURL(/\/enterprise\/t-/);
  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 1차" })).toBeVisible();
  await expect(page.getByText("2문항 · 120분")).toBeVisible();
  await expect(page.getByText("예정", { exact: true })).toBeVisible();
  // 선택한 순서대로 출제된다.
  const order = page.locator(".ent-problem-list li .ent-problem-title");
  await expect(order.nth(0)).toHaveText("수 정렬하기");
  await expect(order.nth(1)).toHaveText("두 수의 합");
  await expect(page.getByText("노트북 반입 금지")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "두 수의 합 문제 보기" }),
  ).toHaveAttribute("href", "/problems/view/two-sum");

  // 예정 상태에서는 편집할 수 있다.
  await page.getByRole("link", { name: "편집" }).click();
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue("백엔드 신입 공채 1차");
  await page.getByLabel(/테스트 이름/).fill("백엔드 신입 공채 2차");
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 2차" })).toBeVisible();

  await page.goto("/enterprise");
  await expect(page.locator(".ent-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ent-table")).toContainText("백엔드 신입 공채 2차");

  // 삭제는 확인을 거친다.
  await page.locator(".ent-name").click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 2차" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "삭제" }).click();
  await expect(page).toHaveURL(/\/enterprise$/);
  await expect(page.getByText("아직 만든 테스트가 없어요")).toBeVisible();
});

test("test rules: status boundaries, validation and ordering", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/enterprise/model.ts";
    const model = await import(modulePath);
    const t0 = Date.parse("2026-10-20T00:00:00Z");
    const t1 = Date.parse("2026-10-21T00:00:00Z");
    const range = { startsAt: new Date(t0).toISOString(), endsAt: new Date(t1).toISOString() };
    const draft = (patch: object) => ({
      title: "t", description: "", startsAt: "2026-10-20T09:00", endsAt: "2026-10-21T09:00",
      durationMin: "90", problemIds: ["p1"], ...patch,
    });
    const now = new Date("2026-10-20T00:00").getTime();
    return {
      status: [t0 - 1, t0, t1 - 1, t1].map((time) => model.testStatus(range, time)),
      progress: [t0, (t0 + t1) / 2, t1].map((time) => model.periodProgress(range, time)),
      ok: model.validateDraft(draft({}), now),
      empty: Object.keys(model.validateDraft(draft({ title: "  ", problemIds: [], durationMin: "" }), now)).sort(),
      reversed: model.validateDraft(draft({ endsAt: "2026-10-20T08:00" }), now).endsAt,
      past: model.validateDraft(draft({ startsAt: "2026-10-01T09:00", endsAt: "2026-10-02T09:00" }), now).endsAt,
      tooLong: model.validateDraft(draft({ durationMin: "2000" }), now).durationMin,
      longerThanWindow: model.validateDraft(draft({ endsAt: "2026-10-20T10:00", durationMin: "90" }), now).durationMin,
      tooMany: model.validateDraft(draft({ problemIds: Array.from({ length: 21 }, (_, i) => String(i)) }), now).problemIds,
      remaining: [90_000, 3_600_000 * 5 + 60_000 * 7, 86_400_000 * 2 + 3_600_000 * 3].map(model.remainingText),
      sorted: model.sortTests([
        { id: "closed-old", ...range, startsAt: new Date(t0 - 4e9).toISOString(), endsAt: new Date(t0 - 3e9).toISOString() },
        { id: "soon-late", startsAt: new Date(t1 + 2e9).toISOString(), endsAt: new Date(t1 + 3e9).toISOString() },
        { id: "closed-new", startsAt: new Date(t0 - 2e9).toISOString(), endsAt: new Date(t0 - 1e9).toISOString() },
        { id: "live", ...range },
        { id: "soon-early", startsAt: new Date(t1 + 1e9).toISOString(), endsAt: new Date(t1 + 3e9).toISOString() },
      ], (t0 + t1) / 2).map((item: { id: string }) => item.id),
    };
  });
  expect(result.status).toEqual(["scheduled", "running", "running", "closed"]);
  expect(result.progress).toEqual([0, 0.5, 1]);
  expect(result.ok).toEqual({});
  expect(result.empty).toEqual(["durationMin", "problemIds", "title"]);
  expect(result.reversed).toContain("시작 일시보다 늦어야");
  expect(result.past).toContain("지금보다 이후");
  expect(result.tooLong).toContain("10~600분");
  expect(result.longerThanWindow).toContain("응시 기간보다 길 수 없어요");
  expect(result.tooMany).toContain("최대 20개");
  expect(result.remaining).toEqual(["2분", "5시간 7분", "2일 3시간"]);
  expect(result.sorted).toEqual(["live", "soon-early", "soon-late", "closed-new", "closed-old"]);
});
