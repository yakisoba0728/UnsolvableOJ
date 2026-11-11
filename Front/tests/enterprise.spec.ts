import { expect, test, type Page, type Route } from "@playwright/test";
import type { Session } from "../src/types";
import type { EnterpriseTest, TestResults } from "../src/enterprise/model";
import { answerConfirm } from "./fixtures";

const sessionKey = "unsolvable-oj-session-v1";
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

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const noonToday = new Date().setHours(12, 0, 0, 0);
const atNoon = (offsetMs: number) => new Date(noonToday + offsetMs).toISOString();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function signIn(page: Page) {
  await page.addInitScript(
    ({ key, saved }) => localStorage.setItem(key, JSON.stringify(saved)),
    {
      key: sessionKey,
      // 브라우저 시각을 오늘 정오로 고정하는 스펙이 있어, 정오 전에 돌려도 세션이 만료되지 않게 둘 중 늦은 때를 기준으로 한다.
      saved: { session, expiresAt: Math.max(Date.now(), noonToday) + 900_000 },
    },
  );
}

async function mockProblems(page: Page) {
  await page.route("**/api/v1/vibe/challenges", (route) => route.fulfill({ json: { items: [], availability: { ai: false, runner: false } } }));
  await page.route("**/api/v1/problems/mine", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: { items: problems, page: 1, limit: 1000, total: 3, totalPages: 1 },
    }),
  );
}

const enterpriseTest = (patch: Partial<EnterpriseTest> & Pick<EnterpriseTest, "id" | "title">): EnterpriseTest => ({
  description: "",
  startsAt: iso(DAY),
  endsAt: iso(3 * DAY),
  durationMin: 60,
  problemIds: ["p1"],
  inviteCode: `invite-${patch.id}`,
  inviteOnly: false,
  invitees: [],
  showScoreToCandidates: false,
  attemptCount: 0,
  createdAt: iso(-DAY),
  updatedAt: iso(-DAY),
  ...patch,
});

const fail = (route: Route, status: number, message: string | string[]) =>
  route.fulfill({ status, json: { statusCode: status, message } });

/**
 * 서버의 /enterprise/tests API를 메모리 목록으로 흉내 낸다. 받은 요청은 `requests`에 남는다.
 * 특정 요청을 실패시키려면 이 뒤에 page.route를 더 걸고 나머지는 route.fallback()으로 넘긴다.
 */
async function mockEnterprise(page: Page, initial: EnterpriseTest[] = [], results: Record<string, TestResults> = {}) {
  const tests = [...initial];
  const requests: { method: string; path: string; body: unknown }[] = [];
  await page.route(/\/api\/v1\/enterprise\/tests(\/|\?|$)/, (route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, "");
    const body = request.postDataJSON();
    requests.push({ method, path, body });
    const [, id, sub] = /^\/enterprise\/tests(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path)!;
    const index = tests.findIndex((item) => item.id === id);
    if (!id && method === "GET") return route.fulfill({ json: tests });
    if (!id && method === "POST") {
      const now = new Date().toISOString();
      const created = enterpriseTest({ ...body, id: `t-new-${tests.length + 1}`, createdAt: now, updatedAt: now });
      tests.unshift(created);
      return route.fulfill({ status: 201, json: created });
    }
    if (index < 0) return fail(route, 404, "테스트를 찾을 수 없습니다.");
    if (sub === "results")
      return route.fulfill({
        json: results[id] ?? {
          test: tests[index],
          summary: { candidates: tests[index].attemptCount, averageScore: null, perfect: 0 },
          candidates: [],
        },
      });
    if (method === "GET") return route.fulfill({ json: tests[index] });
    if (method === "PATCH") {
      tests[index] = { ...tests[index], ...body, updatedAt: new Date().toISOString() };
      return route.fulfill({ json: tests[index] });
    }
    if (method === "DELETE") {
      tests.splice(index, 1);
      return route.fulfill({ json: { id } });
    }
    return fail(route, 405, "지원하지 않는 요청");
  });
  return { tests, requests };
}

async function setup(page: Page, initial: EnterpriseTest[] = [], results: Record<string, TestResults> = {}) {
  await signIn(page);
  await mockProblems(page);
  return mockEnterprise(page, initial, results);
}

test("signed-out visitors see a login prompt instead of tests", async ({ page }) => {
  await page.goto("/enterprise");
  await expect(page.getByRole("heading", { name: "기업 코드 테스트" })).toBeVisible();
  await expect(page.getByText("로그인하고 코드 테스트를 만들어 보세요")).toBeVisible();
  await expect(page.getByRole("button", { name: /새 테스트 만들기/ })).toHaveCount(0);
  await expect(page.locator(".ent-table")).toHaveCount(0);
  await page.goto("/enterprise/new");
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => history.state?.usr?.from)).toBe("/enterprise/new");
});

test("empty state invites the first test", async ({ page }) => {
  const { requests } = await setup(page);
  await page.goto("/enterprise");
  await expect(page.getByText("아직 만든 테스트가 없어요")).toBeVisible();
  expect(requests).toContainEqual(expect.objectContaining({ method: "GET", path: "/enterprise/tests" }));
  await page.getByRole("link", { name: /첫 테스트 만들기/ }).click();
  await expect(page).toHaveURL(/\/enterprise\/new$/);
});

test("dashboard groups tests by status, totals candidates and offers the right management action", async ({
  page,
}) => {
  // 하루짜리 테스트(진행 중 공채)가 자정을 넘지 않도록 브라우저 시각을 오늘 정오로 고정한다.
  await page.clock.install({ time: noonToday });
  await setup(page, [
    enterpriseTest({ id: "t-closed", title: "지난 인턴 선발", startsAt: atNoon(-2 * DAY), endsAt: atNoon(-DAY), problemIds: ["p1", "p2"], attemptCount: 5 }),
    enterpriseTest({ id: "t-soon", title: "다음 주 공채", startsAt: atNoon(DAY), endsAt: atNoon(3 * DAY), durationMin: 90 }),
    enterpriseTest({ id: "t-live", title: "진행 중 공채", startsAt: atNoon(-HOUR), endsAt: atNoon(HOUR), durationMin: 30, problemIds: ["p1", "p2", "p3"], attemptCount: 3 }),
  ]);
  await page.goto("/enterprise");

  const tiles = page.getByLabel("테스트 지표").locator(".stat-tile");
  await expect(tiles.nth(0)).toContainText("진행 중 테스트");
  await expect(tiles.nth(0)).toContainText("1");
  await expect(tiles.nth(0)).toContainText("예정 1건");
  await expect(tiles.nth(1)).toContainText("총 응시자");
  await expect(tiles.nth(1).locator("strong")).toHaveText("8");
  await expect(tiles.nth(2)).toContainText("마감된 테스트");
  await expect(tiles.nth(2).locator("strong")).toHaveText("1");

  const rows = page.locator(".ent-table tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("진행 중 공채");
  await expect(rows.nth(0)).toContainText("3문항 · 30분 · 응시 3명");
  // 응시 기간 줄에는 기간 글자만 있고 진행 막대는 없다.
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  // 하루 안에 끝나는 테스트(진행 중 공채)만 시간이 붙고, 여러 날에 걸친 테스트는 날짜만 보인다.
  await expect(rows.nth(0).locator(".ent-period")).toContainText(/\d{2}:\d{2}부터, \d{2}:\d{2}까지/);
  await expect(rows.nth(1).locator(".ent-period > span")).not.toContainText(/\d{2}:\d{2}/);
  await expect(rows.nth(2).locator(".ent-period > span")).not.toContainText(/\d{2}:\d{2}/);
  await expect(rows.nth(0).getByRole("link", { name: /상세 보기/ })).toBeVisible();
  await expect(rows.nth(1)).toContainText("다음 주 공채");
  await expect(rows.nth(1)).toContainText("시작 예정");
  await expect(rows.nth(1)).toContainText("응시 0명");
  await expect(rows.nth(1).getByRole("link", { name: /편집/ })).toHaveAttribute("href", "/enterprise/t-soon/edit");
  await expect(rows.nth(2)).toContainText("지난 인턴 선발");
  await expect(rows.nth(2)).toContainText("마감");
  await expect(page.getByText("3건", { exact: true })).toBeVisible();
  await expect(page.getByText(/이 브라우저/)).toHaveCount(0);

  // 시작된 테스트는 수정할 수 없다.
  await page.goto("/enterprise/t-live/edit");
  await expect(page.getByText("시작된 테스트는 수정할 수 없어요")).toBeVisible();
});

test("create, edit and delete a test through the server", async ({ page }) => {
  const { requests } = await setup(page);
  await page.goto("/enterprise/new");

  // 비어 있는 채로 저장하면 이유를 알려 주고 첫 오류로 이동한다. 서버에는 보내지 않는다.
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page.getByText("테스트 이름을 입력해 주세요.")).toBeVisible();
  await expect(page.getByText("출제할 문제를 하나 이상 골라 주세요.")).toBeVisible();
  await expect(page.getByLabel(/테스트 이름/)).toBeFocused();

  await page.getByLabel(/테스트 이름/).fill("  백엔드 신입 공채 1차 ");
  await page.getByLabel(/안내 문구/).fill("노트북 반입 금지");
  await page.getByLabel("문제 검색").fill("정렬");
  await expect(page.locator(".ent-problem")).toHaveCount(1);
  await page.getByLabel("문제 검색").fill("");
  await page.getByRole("checkbox", { name: /수 정렬하기/ }).check();
  await page.getByRole("checkbox", { name: /두 수의 합/ }).check();
  await expect(page.getByText("2 / 20개 선택")).toBeVisible();
  await expect(page.getByText("테스트 이름을 입력해 주세요.")).toHaveCount(0);

  // 제한 시간이 범위를 벗어나면 막는다.
  await page.getByLabel("제한 시간 (분)").fill("9");
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page.getByText(/10~600분 사이의 정수/)).toBeVisible();
  await page.getByLabel("제한 시간 (분)").fill("120");
  expect(requests.filter((item) => item.method !== "GET")).toEqual([]);

  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page).toHaveURL(/\/enterprise\/t-new-1$/);
  const post = requests.find((item) => item.method === "POST")!;
  expect(post.path).toBe("/enterprise/tests");
  // 선택한 순서대로, 다듬은 값으로 보낸다.
  expect(post.body).toMatchObject({
    title: "백엔드 신입 공채 1차",
    description: "노트북 반입 금지",
    durationMin: 120,
    problemIds: ["p2", "p1"],
  });
  const { startsAt, endsAt } = post.body as { startsAt: string; endsAt: string };
  expect(new Date(startsAt).toISOString()).toBe(startsAt);
  expect(Date.parse(endsAt) - Date.parse(startsAt)).toBe(7 * DAY);

  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 1차" })).toBeVisible();
  await expect(page.getByText("2문항 · 120분", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("예정", { exact: true })).toBeVisible();
  const order = page.locator(".ent-problem-list li .ent-problem-title");
  await expect(order.nth(0)).toHaveText("수 정렬하기");
  await expect(order.nth(1)).toHaveText("두 수의 합");
  await expect(page.getByText("노트북 반입 금지")).toBeVisible();
  await expect(page.getByRole("link", { name: "두 수의 합 문제 보기" })).toHaveAttribute("href", "/problems/view/two-sum");

  // 예정 상태에서는 편집할 수 있고, 변경은 PATCH로 보낸다.
  await page.getByRole("link", { name: "편집" }).click();
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue("백엔드 신입 공채 1차");
  await page.getByLabel(/테스트 이름/).fill("백엔드 신입 공채 2차");
  await page.getByRole("checkbox", { name: /두 수의 합/ }).uncheck();
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page).toHaveURL(/\/enterprise\/t-new-1$/);
  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 2차" })).toBeVisible();
  const patch = requests.find((item) => item.method === "PATCH")!;
  expect(patch.path).toBe("/enterprise/tests/t-new-1");
  expect(patch.body).toMatchObject({ title: "백엔드 신입 공채 2차", problemIds: ["p2"], durationMin: 120 });

  await page.goto("/enterprise");
  await expect(page.locator(".ent-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ent-table")).toContainText("백엔드 신입 공채 2차");

  // 삭제는 확인을 거친다.
  await page.locator(".ent-name").click();
  await page.getByRole("button", { name: "삭제" }).click();
  await answerConfirm(page, false);
  await expect(page.getByRole("heading", { name: "백엔드 신입 공채 2차" })).toBeVisible();
  expect(requests.some((item) => item.method === "DELETE")).toBe(false);
  await page.getByRole("button", { name: "삭제" }).click();
  await answerConfirm(page, true);
  await expect(page).toHaveURL(/\/enterprise$/);
  expect(requests.find((item) => item.method === "DELETE")?.path).toBe("/enterprise/tests/t-new-1");
  await expect(page.getByText("아직 만든 테스트가 없어요")).toBeVisible();
});

test("server rejections are shown while the inputs and the saved test stay put", async ({ page }) => {
  const saved = enterpriseTest({ id: "t-edit", title: "기존 테스트", description: "원래 안내" });
  const { tests } = await setup(page, [saved]);
  let failCreate = true;
  await page.route("**/api/v1/enterprise/tests", (route) => {
    if (route.request().method() !== "POST" || !failCreate) return route.fallback();
    failCreate = false;
    return fail(route, 400, ["title must be shorter than or equal to 60 characters"]);
  });
  await page.route("**/api/v1/enterprise/tests/t-edit", (route) => {
    const method = route.request().method();
    if (method === "PATCH") return fail(route, 409, "시작된 테스트는 수정할 수 없어요.");
    if (method === "DELETE") return fail(route, 409, "응시 기록이 있는 테스트는 삭제할 수 없어요.");
    return route.fallback();
  });

  // 만들기 실패: 서버 이유를 보여 주고 입력을 그대로 둔 채 다시 시도할 수 있다.
  await page.goto("/enterprise/new");
  await page.getByLabel(/테스트 이름/).fill("저장 실패에도 남을 이름");
  await page.getByLabel(/안내 문구/).fill("남을 입력");
  await page.getByRole("checkbox", { name: /두 수의 합/ }).check();
  await page.getByRole("button", { name: "테스트 만들기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("title must be shorter than or equal to 60 characters");
  await expect(page.getByRole("alert")).toContainText("입력한 내용은 유지했어요");
  await expect(page).toHaveURL(/\/enterprise\/new$/);
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue("저장 실패에도 남을 이름");
  await expect(page.getByLabel(/안내 문구/)).toHaveValue("남을 입력");
  await expect(page.getByRole("checkbox", { name: /두 수의 합/ })).toBeChecked();
  await page.getByRole("button", { name: "테스트 만들기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "저장 실패에도 남을 이름" })).toBeVisible();
  expect(tests).toHaveLength(2);

  // 편집 실패(예: 그 사이 시작됨): 이유를 보여 주고 이동하지 않는다.
  await page.goto("/enterprise/t-edit/edit");
  await page.getByLabel(/테스트 이름/).fill("실패한 수정");
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("시작된 테스트는 수정할 수 없어요.");
  await expect(page).toHaveURL(/\/enterprise\/t-edit\/edit$/);
  await expect(page.getByLabel(/테스트 이름/)).toHaveValue("실패한 수정");
  expect(tests.find((item) => item.id === "t-edit")?.title).toBe("기존 테스트");

  // 삭제 실패: 상세에 남아 이유를 보여 준다.
  await page.getByRole("link", { name: /테스트 상세/ }).click();
  await expect(page.getByRole("heading", { name: "기존 테스트" })).toBeVisible();
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await answerConfirm(page, true);
  await expect(page.getByRole("alert")).toContainText("응시 기록이 있는 테스트는 삭제할 수 없어요.");
  await expect(page).toHaveURL(/\/enterprise\/t-edit$/);
});

test("a failed list load shows the reason and retries", async ({ page }) => {
  await setup(page, [enterpriseTest({ id: "t-1", title: "다시 불러온 테스트" })]);
  let failing = true;
  await page.route("**/api/v1/enterprise/tests", (route) =>
    failing ? fail(route, 503, "잠시 후 다시 시도해 주세요.") : route.fallback(),
  );
  await page.goto("/enterprise");
  await expect(page.getByRole("alert")).toContainText("잠시 후 다시 시도해 주세요.");
  failing = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".ent-table")).toContainText("다시 불러온 테스트");
});

test("missing tests show a not-found notice on the detail and edit pages", async ({ page }) => {
  await setup(page);
  await page.goto("/enterprise/t-gone");
  await expect(page.getByText("테스트를 찾을 수 없어요")).toBeVisible();
  await page.goto("/enterprise/t-gone/edit");
  await expect(page.getByText("테스트를 찾을 수 없어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "변경 저장" })).toHaveCount(0);
});

test("the detail shows the invite link with a copy button and allows deleting before anyone attempts", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void ((window as unknown as { copied: string }).copied = text) },
    });
  });
  const { requests } = await setup(page, [
    enterpriseTest({ id: "t-1", title: "링크 테스트", inviteCode: "AbC_123", problemIds: ["company-only", "p1"] }),
  ]);
  await page.route("**/api/v1/problems/mine", (route) =>
    route.fulfill({
      json: [{
        id: "company-only", slug: "company-only", title: "사내 전용 문제", status: "DRAFT", isPrivate: true,
        difficulty: "MEDIUM", timeLimitMs: 2000, memoryLimitMb: 256, currentVersion: 1,
        createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
      }],
    }),
  );
  await page.goto("/enterprise/t-1");
  const origin = new URL(page.url()).origin;
  const link = `${origin}/enterprise/join/AbC_123`;
  await expect(page.locator(".ent-invite code")).toHaveText(link);
  await page.getByRole("button", { name: "링크 복사" }).click();
  await expect(page.getByText("복사했어요.")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { copied: string }).copied)).toBe(link);

  // 기업 전용 문제는 공개 화면이 없어 출제 화면으로 연다.
  const item = page.locator(".ent-problem-list li", { hasText: "사내 전용 문제" });
  await expect(item).toContainText("기업 전용");
  await expect(item.getByRole("link", { name: "사내 전용 문제 문제 보기" })).toHaveAttribute("href", "/my-problems/company-only/edit");

  await expect(page.getByText("아직 응시한 사람이 없어요")).toBeVisible();
  await expect(page.locator(".ent-summary")).toContainText("0명");
  // 시작 전인 테스트는 결과를 따로 부르지 않는다.
  expect(requests.some((item) => item.path.endsWith("/results"))).toBe(false);
  await expect(page.getByRole("button", { name: "삭제", exact: true })).toBeVisible();
});

test("a test with candidates hides delete and lists scores with per-problem results", async ({ page }) => {
  const test1 = enterpriseTest({
    id: "t-done", title: "마감된 공채", startsAt: iso(-3 * DAY), endsAt: iso(-DAY),
    problemIds: ["p1", "p2", "p3"], attemptCount: 2,
  });
  const attempt = (id: string, finished: boolean) => ({
    id, startedAt: iso(-2 * DAY), deadlineAt: finished ? iso(-2 * DAY + HOUR) : iso(HOUR),
    finishedAt: finished ? iso(-2 * DAY + HOUR / 2) : null,
  });
  const results: TestResults = {
    test: test1,
    summary: { candidates: 2, averageScore: 67, perfect: 1 },
    candidates: [
      {
        ...attempt("a-1", true), user: { id: "u-alice", username: "alice" }, solved: 1, score: 33,
        problems: [
          { problemId: "p1", solved: true, submissions: 2, submissionId: "s-a1" },
          { problemId: "p2", solved: false, submissions: 1, submissionId: "s-a2" },
        ],
      },
      {
        ...attempt("a-2", false), user: { id: "u-bob", username: "bob" }, solved: 3, score: 100,
        problems: ["p1", "p2", "p3"].map((problemId) => ({ problemId, solved: true, submissions: 1, submissionId: `s-b-${problemId}` })),
      },
    ],
  };
  const { requests } = await setup(page, [test1], { "t-done": results });
  await page.goto("/enterprise/t-done");
  await expect(page.getByRole("heading", { name: "마감된 공채" })).toBeVisible();
  await expect(page.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "편집", exact: true })).toHaveCount(0);

  const summary = page.locator(".ent-summary");
  await expect(summary).toContainText("응시자2명");
  await expect(summary).toContainText("평균 점수67점");
  await expect(summary).toContainText("전부 맞힌 사람1명");

  const rows = page.locator(".ent-result-table tbody tr");
  await expect(rows).toHaveCount(2);
  const alice = rows.nth(0);
  await expect(alice.getByRole("link", { name: "alice", exact: true })).toHaveAttribute("href", "/users/alice");
  await expect(alice).toContainText("33점");
  await expect(alice).toContainText("(1/3)");
  const first = alice.getByRole("link", { name: "alice 1번 제출 보기" });
  await expect(first).toHaveText("정답 · 2회");
  await expect(first).toHaveAttribute("href", "/submissions/s-a1");
  await expect(alice.getByRole("link", { name: "alice 2번 제출 보기" })).toHaveText("미해결 · 1회");
  await expect(alice.getByRole("link", { name: "alice 2번 제출 보기" })).toHaveAttribute("href", "/submissions/s-a2");
  await expect(alice.locator("td").nth(4)).toHaveText("미제출");
  await expect(alice.locator("td").last()).toHaveText("종료");
  const bob = rows.nth(1);
  await expect(bob).toContainText("100점");
  await expect(bob).toContainText("(3/3)");
  await expect(bob.getByRole("link", { name: "bob 3번 제출 보기" })).toHaveAttribute("href", "/submissions/s-b-p3");
  await expect(bob.locator("td").last()).toHaveText("응시 중");
  expect(requests.some((item) => item.path === "/enterprise/tests/t-done/results")).toBe(true);
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

test("period text hides clock times unless the test fits within one day", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/enterprise/model.ts";
    const model = await import(modulePath);
    const at = (month: number, day: number, hour: number, minute = 0) =>
      new Date(2026, month - 1, day, hour, minute).toISOString();
    const days = { startsAt: at(10, 18, 20, 51), endsAt: at(10, 23, 20, 51) };
    const oneDay = { startsAt: at(10, 20, 14, 0), endsAt: at(10, 20, 18, 30) };
    const overnight = { startsAt: at(10, 20, 22, 0), endsAt: at(10, 21, 2, 0) };
    const now = new Date(2026, 9, 20, 9, 0).getTime();
    const start = (month: number, day: number, hour: number, minute = 0) =>
      model.formatStart({ startsAt: at(month, day, hour, minute), endsAt: at(month, 30, 23) }, now);
    return {
      relative: [start(10, 20, 19), start(10, 21, 14), start(10, 21, 9, 30), start(10, 21, 0), start(10, 21, 12), start(10, 22, 14)],
      days: [model.formatPeriod(days), model.formatStart(days, now), model.formatEnd(days)],
      oneDay: [model.formatPeriod(oneDay), model.formatStart(oneDay, now), model.formatEnd(oneDay)],
      overnight: model.formatPeriod(overnight),
    };
  });
  // 오늘·내일 시작하면 말로 쓰고, 그 뒤로는 날짜만 보인다.
  expect(result.relative).toEqual([
    "오늘 오후 7시",
    "내일 오후 2시",
    "내일 오전 9시 30분",
    "내일 오전 12시",
    "내일 오후 12시",
    "10월22일",
  ]);
  // 여러 날에 걸친 테스트는 날짜만 보인다.
  expect(result.days).toEqual(["10월18일부터, 10월23일까지", "10월18일", "10월23일"]);
  // 같은 날 안에서 끝나는 테스트만 시간이 붙는다.
  expect(result.oneDay).toEqual(["10월20일 14:00부터, 18:30까지", "오늘 오후 2시", "10월20일 18:30"]);
  // 자정을 넘기면 하루짜리가 아니다.
  expect(result.overnight).toBe("10월20일부터, 10월21일까지");
});

test("logging in from an edit link returns to that edit page", async ({ page }) => {
  await page.goto("/enterprise/t-1/edit");
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => (history.state?.usr as { from?: string } | undefined)?.from)).toBe(
    "/enterprise/t-1/edit",
  );
});

test("the date picker gives its days one tab stop, moves with arrow keys and closes when focus leaves", async ({ page, browserName }) => {
  test.skip(browserName === "webkit", "WebKit은 기본 설정에서 Tab으로 버튼에 포커스를 주지 않는다");
  await signIn(page);
  await mockProblems(page);
  await page.goto("/enterprise/new");
  const start = page.getByLabel("시작 일시");
  await start.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "날짜와 시간 선택" });
  await page.keyboard.press("Tab"); // 이전 달
  await page.keyboard.press("Tab"); // 다음 달
  await page.keyboard.press("Tab"); // 날짜 칸 중 Tab이 멈추는 곳은 선택된 날 하나뿐
  const selected = dialog.locator(".dtp-day.selected");
  await expect(selected).toBeFocused();
  const [sy, sm, sd] = (await selected.getAttribute("data-date"))!.split("-").map(Number);
  const target = new Date(sy, sm, sd + 8);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", {
      name: `${target.getFullYear()}년 ${target.getMonth() + 1}월 ${target.getDate()}일`,
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("textbox", { name: "시" })).toBeFocused();
  await expect(start).toContainText(`${target.getFullYear()}. ${pad(target.getMonth() + 1)}. ${pad(target.getDate())}.`);

  await page.getByLabel("종료 일시").focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(1);
});

test("enterprise tests can include the company's own private problems alongside public ones", async ({ page }) => {
  await signIn(page);
  await mockProblems(page);
  const mine = (id: string, title: string, isPrivate: boolean) => ({
    id, slug: id, title, status: "DRAFT", isPrivate, difficulty: "MEDIUM",
    timeLimitMs: 2000, memoryLimitMb: 256, currentVersion: 1,
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z",
  });
  await page.route("**/api/v1/problems/mine", (route) =>
    route.fulfill({ json: [mine("company-only", "사내 전용 문제", true), mine("plain-draft", "일반 초안", false)] }),
  );
  await page.goto("/enterprise/new");
  await expect(page.locator(".ent-problem", { hasText: "사내 전용 문제" })).toContainText("기업 전용");
  await expect(page.locator(".ent-problem", { hasText: "두 수의 합" })).toBeVisible();
  // 검수 전 일반 초안은 기업 테스트 후보가 아니다.
  await expect(page.locator(".ent-problem", { hasText: "일반 초안" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "기업 전용 문제로 만들어" })).toHaveAttribute(
    "href", "/problems/new?private=1",
  );
});

test("the test detail shows the remaining time as text without a progress bar", async ({ page }) => {
  await setup(page, [enterpriseTest({ id: "t1", title: "진행 중 공채", startsAt: iso(-DAY), endsAt: iso(2 * DAY), problemIds: [] })]);
  await page.goto("/enterprise/t1");
  await expect(page.getByRole("heading", { name: "응시 현황" })).toBeVisible();
  await expect(page.locator(".ent-time")).toContainText("마감까지 2일");
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("the list says when a scheduled test starts today or tomorrow", async ({ page }) => {
  // 로컬 시간 기준: 오늘 낮 12시를 현재로 고정한다.
  await page.clock.install({ time: new Date(2026, 9, 20, 12, 0) });
  const local = (day: number, hour: number) => new Date(2026, 9, day, hour, 0).toISOString();
  await setup(page, [
    enterpriseTest({ id: "t-today", title: "오늘 저녁 시작", startsAt: local(20, 19), endsAt: local(25, 19) }),
    enterpriseTest({ id: "t-tomorrow", title: "내일 오후 시작", startsAt: local(21, 14), endsAt: local(26, 14) }),
    enterpriseTest({ id: "t-later", title: "다음 주 시작", startsAt: local(27, 9), endsAt: local(30, 9) }),
  ]);
  await page.goto("/enterprise");
  const period = (title: string) =>
    page.locator(".ent-table tbody tr", { hasText: title }).locator(".ent-period > span");
  await expect(period("오늘 저녁 시작")).toHaveText("오늘 오후 7시 시작 예정");
  await expect(period("내일 오후 시작")).toHaveText("내일 오후 2시 시작 예정");
  await expect(period("다음 주 시작")).toHaveText("10월27일 시작 예정");
});

test("an invite-only test sends its invitees and score sharing, and the detail shows how many were invited", async ({ page }) => {
  const { requests } = await setup(page);
  await page.goto("/enterprise/new");
  await page.getByLabel(/테스트 이름/).fill("초대 전용 공채");
  await page.getByRole("checkbox", { name: /두 수의 합/ }).check();
  await page.getByRole("radio", { name: "초대한 사람만" }).check();
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page.getByText("초대할 사람의 사용자 이름이나 이메일을 적어 주세요.")).toBeVisible();
  await expect(page.getByLabel("초대할 사람")).toBeFocused();

  // 줄바꿈·쉼표로 나누고, 대소문자만 다른 중복은 한 번만 보낸다.
  await page.getByLabel("초대할 사람").fill("kim_dev, lee@example.com\nKIM_DEV\n");
  await expect(page.getByText("2 / 200명")).toBeVisible();
  await page.getByRole("checkbox", { name: /자기 점수와 문제별 정답 여부/ }).check();
  await page.getByRole("button", { name: "테스트 만들기" }).click();
  await expect(page).toHaveURL(/\/enterprise\/t-new-1$/);
  expect(requests.find((item) => item.method === "POST")?.body).toMatchObject({
    inviteOnly: true,
    invitees: ["kim_dev", "lee@example.com"],
    showScoreToCandidates: true,
  });
  await expect(page.getByText("초대한 2명만 이 링크로 한 번 응시할 수 있어요.", { exact: false })).toBeVisible();
  await page.getByText("초대 목록 보기").click();
  await expect(page.getByRole("listitem").filter({ hasText: "lee@example.com" })).toBeVisible();

  // 편집하면 저장된 목록을 그대로 보여 주고, 누구나로 바꾸면 목록을 비워 보낸다.
  await page.getByRole("link", { name: "편집" }).click();
  await expect(page.getByLabel("초대할 사람")).toHaveValue("kim_dev\nlee@example.com");
  await page.getByRole("radio", { name: "링크를 아는 로그인 사용자 누구나" }).check();
  await expect(page.getByLabel("초대할 사람")).toHaveCount(0);
  await page.getByRole("button", { name: "변경 저장" }).click();
  await expect(page).toHaveURL(/\/enterprise\/t-new-1$/);
  expect(requests.find((item) => item.method === "PATCH")?.body).toMatchObject({ inviteOnly: false, invitees: [] });
});

test("a running test's results refresh every 30 seconds while the tab is visible", async ({ page }) => {
  const running = enterpriseTest({ id: "t-live", title: "진행 중 공채", startsAt: iso(-HOUR), endsAt: iso(DAY), problemIds: ["p1"] });
  await setup(page, [running]);
  let candidates: TestResults["candidates"] = [];
  await page.route("**/api/v1/enterprise/tests/t-live/results", (route) =>
    route.fulfill({
      json: {
        test: running,
        summary: { candidates: candidates.length, averageScore: candidates.length ? 100 : null, perfect: candidates.length },
        candidates,
      } satisfies TestResults,
    }),
  );
  await page.clock.install();
  await page.goto("/enterprise/t-live");
  // 응시자 0명으로 열어도 결과를 받아 두고, 응시가 생기면 다음 갱신에 보인다.
  await expect(page.getByRole("button", { name: "새로고침" })).toBeVisible();
  await expect(page.getByText("아직 응시한 사람이 없어요")).toBeVisible();

  candidates = [{
    id: "a-1", startedAt: iso(-60_000), deadlineAt: iso(HOUR), finishedAt: null,
    user: { id: "u-alice", username: "alice" }, solved: 1, score: 100,
    problems: [{ problemId: "p1", solved: true, submissions: 1, submissionId: "s-1" }],
  }];
  await page.clock.fastForward(30_000);
  await expect(page.locator(".ent-result-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".ent-summary")).toContainText("응시자1명");
  await expect(page.getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);

  // 탭이 숨겨지면 쉬고, 돌아오면 바로 받는다.
  let fetched = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/results")) fetched += 1;
  });
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => true }));
  await page.clock.fastForward(60_000);
  expect(fetched).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => fetched).toBe(1);
});
