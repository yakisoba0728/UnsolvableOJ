import { expect, test, type Page } from "@playwright/test";
import {
  authenticate,
  mockCommunityApi,
  mockProblemApi,
  problem,
  session,
} from "./fixtures";
import { mockMissions } from "./mission-fixtures";
import { calendarDate, parseCalendarDate } from "../src/calendar";

const now = new Date();
const submission = {
  id: "h1",
  problem,
  language: "CPP",
  status: "WRONG_ANSWER",
  runtimeMs: 10,
  memoryKb: 14336,
  passedTestCases: 0,
  totalTestCases: 1,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  compileOutput: null,
  judgeMessage: null,
  sourceCode: "int main() {}",
  sampleTestCases: [{ testCase: 1, input: "1 2\n", expectedOutput: "3\n" }],
  debugOutputs: [
    {
      testCase: 1,
      stdout: "4\n",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  ],
};
const items = Array.from({ length: 6 }, (_, i) => ({
  ...submission,
  id: `h${i}`,
  status: i === 2 ? "SYSTEM_ERROR" : i % 2 ? "ACCEPTED" : "WRONG_ANSWER",
  problem: { ...problem, id: i % 2 ? "other" : problem.id },
  createdAt: new Date(
    now.getTime() - (i < 4 ? i * 1000 : 86_400_000),
  ).toISOString(),
}));

async function mockHistory(page: Page) {
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, total: items.length, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  await page.route("**/api/v1/submissions/h1", (route) =>
    route.fulfill({ json: submission }),
  );
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: { ...session.user, solvedCount: 1, createdAt: now.toISOString() },
    }),
  );
  await page.route("**/api/v1/rankings*", (route) =>
    route.fulfill({ json: [] }),
  );
}

test.beforeEach(async ({ page }) => {
  await authenticate(page);
  await mockProblemApi(page);
  await mockCommunityApi(page, {
    posts: [{ id: "harmony", title: "질문", author: "other" }],
    answers: [{ id: "a1", postId: "harmony", body: "이미 있는 답변입니다." }],
  });
  await mockHistory(page);
});

test("calendar values reject impossible dates and retain local date boundaries", () => {
  expect(calendarDate(new Date(2026, 0, 2))).toBe("2026-01-02");
  for (const value of ["2026-02-30", "2026-2-01", "not-a-date"])
    expect(parseCalendarDate(value)).toBeNull();
  expect(parseCalendarDate("2024-02-29")?.getDate()).toBe(29);
});

test("PR focus/input/error styles work in light and dark without a disabled text cursor", async ({
  page,
}) => {
  await page.goto("/community/new");
  const input = page.locator("input").first();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (theme) => (document.documentElement.dataset.theme = theme),
      theme,
    );
    await input.evaluate((el) => el.setAttribute("aria-invalid", "true"));
    await input.focus();
    expect(
      await input.evaluate((el) => getComputedStyle(el).boxShadow),
    ).not.toBe("none");
    expect(
      await input.evaluate(
        (el) => getComputedStyle(el, "::placeholder").opacity,
      ),
    ).toBe("1");
    await input.evaluate((el: HTMLInputElement) => {
      el.disabled = true;
    });
    expect(await input.evaluate((el) => getComputedStyle(el).cursor)).toBe(
      "not-allowed",
    );
    await input.evaluate((el: HTMLInputElement) => {
      el.disabled = false;
    });
  }
});

test("Select lists have names and pagination buttons have explicit type and page names", async ({
  page,
}) => {
  await page.route("**/api/v1/problems?*", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 45 }, (_, i) => ({
          ...problem,
          id: `p${i}`,
          slug: `p${i}`,
        })),
        total: 45,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/problems");
  const select = page.getByRole("combobox").first();
  const name = await select.getAttribute("aria-label");
  await select.click();
  await expect(page.getByRole("listbox")).toHaveAttribute("aria-label", name!);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "2페이지", exact: true }),
  ).toHaveAttribute("type", "button");
});

test("ErrorBoundary focuses its heading once and offers a real home escape", async ({
  page,
}) => {
  await page.route("**/api/v1/submissions/broken", (route) =>
    route.fulfill({ json: { ...submission, problem: undefined } }),
  );
  await page.goto("/submissions/broken");
  await expect(
    page.getByRole("heading", { name: "화면을 표시하지 못했어요." }),
  ).toBeFocused();
  const home = page.getByRole("link", { name: "홈으로", exact: true });
  await home.focus();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(home).toBeFocused();
  await home.click();
  await expect(page).toHaveURL(/\/$/);
});

test("reduced motion disables shimmer, smooth scrolling and long transitions", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/problems");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe("auto");
  const values = await page.evaluate(() => {
    const node = document.createElement("div");
    node.className = "skeleton";
    document.body.append(node);
    const value = {
      animation: getComputedStyle(node).animationName,
      transition: getComputedStyle(node).transitionDuration,
    };
    node.remove();
    return value;
  });
  expect(values.animation).toBe("none");
  expect(parseFloat(values.transition)).toBeLessThan(0.001);
});

test("system errors have their own filter, and grouped counts distinguish submissions from problems", async ({
  page,
}) => {
  await page.goto("/submissions?s=system");
  await expect(page.locator(".history-row")).toHaveCount(1);
  await expect(page.locator(".submission-count-summary")).toHaveText(
    "전체 제출 6건 · 조건 일치 1건",
  );
  await page.goto("/submissions?s=wrong");
  await expect(page.locator(".history-row")).toHaveCount(2);
  await page.goto("/submissions?g=problem");
  await expect(page.locator(".submission-count-summary")).toContainText(
    "조건 일치 6건 · 표시 2문제",
  );
});

test("the fifth verdict stays keyboard-reachable on a tiny screen without widening the page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/submissions");
  const group = page.getByRole("group", { name: "판정 필터", exact: true });
  await group.getByRole("button", { name: /^전체/ }).focus();
  await page.keyboard.press("ArrowLeft");
  const system = group.getByRole("button", { name: /^시스템 오류/ });
  await expect(system).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".history-row")).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("PR verdict glyphs and tabular numbers do not replace the accessible verdict text", async ({
  page,
}) => {
  await page.goto("/submissions");
  const system = page.locator(".verdict-system_error");
  await expect(system).toHaveText("시스템 오류");
  expect(
    await system.evaluate((el) => getComputedStyle(el, "::before").content),
  ).toContain("✕");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.body).fontVariantNumeric,
    ),
  ).toBe("tabular-nums");
  await page.goto("/community/new");
  expect(
    await page
      .locator(".md-tabs button")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(32);
});

test("a genuinely empty history offers a clear first action rather than a filter reset", async ({
  page,
}) => {
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items: [], total: 0, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  await page.goto("/submissions");
  await expect(
    page.getByText("아직 제출한 풀이가 없어요.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "문제 둘러보기", exact: true }),
  ).toHaveAttribute("href", "/problems");
});

test("profile heatmap has one tab stop, arrow navigation and a working date-filter destination", async ({
  page,
}) => {
  await page.goto("/profile");
  const active = page.locator('.heatmap button[tabindex="0"]');
  await expect(active).toHaveCount(1);
  await active.focus();
  const before = await active.getAttribute("data-day");
  await page.keyboard.press("ArrowLeft");
  await expect(active).toBeFocused();
  expect(await active.getAttribute("data-day")).not.toBe(before);
  await page.getByText("일별 활동 목록 (히트맵 대안)", { exact: true }).click();
  await page.getByLabel("활동 날짜 (기기 현지 시간)").fill(calendarDate(now));
  const link = page.locator(".day-more");
  await expect(link).toHaveAttribute(
    "href",
    `/submissions?date=${calendarDate(now)}`,
  );
  await link.click();
  await expect(page.locator("#submission-date")).toHaveValue(calendarDate(now));
  await expect(page.locator(".history-row")).toHaveCount(4);
  await page.getByRole("button", { name: "날짜 해제", exact: true }).click();
  await expect(page.locator(".history-row")).toHaveCount(6);
});

test("answers are visible before the composer, and the shortcut preserves the draft and focuses writing", async ({
  page,
}) => {
  await page.goto("/community/harmony");
  await expect(
    page.getByText("이미 있는 답변입니다.", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".answers-card")
      .evaluate((el) =>
        Boolean(
          el.compareDocumentPosition(
            document.querySelector(".answer-write-card")!,
          ) & Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await page.getByLabel("답변 내용").fill("유지할 답변 초안입니다.");
  await page
    .getByRole("button", { name: "답변 작성으로 이동 ↓", exact: true })
    .click();
  await expect(page.getByLabel("답변 내용")).toBeFocused();
  await expect(page.getByLabel("답변 내용")).toHaveValue(
    "유지할 답변 초안입니다.",
  );
});

test("post cards with one post do not reserve a second slide or show dead navigation", async ({
  page,
}) => {
  await page.goto("/profile");
  const card = page.getByRole("region", { name: "작성한 글", exact: true });
  // The fixture answer author is me, but the post is another account's; use a self-authored post.
  await mockCommunityApi(page, {
    posts: [{ id: "mine", title: "내 글", author: session.user.username }],
  });
  await page.reload();
  await expect(card.locator(".scroller-title")).toHaveText("내 글");
  await expect(
    card.getByRole("button", { name: "다음 글", exact: true }),
  ).toHaveCount(0);
  expect(
    await card
      .locator(".scroller-view")
      .evaluate((el) => el.getBoundingClientRect().height),
  ).toBeLessThan(200);
});

test("result memory uses the list unit and copy preserves trailing newlines", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/submissions/h1");
  await expect(page.locator(".result-stats")).toContainText("C++");
  await expect(page.locator(".result-stats")).toContainText("14.0MB");
  await page.getByRole("button", { name: "입력 복사", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "1 2\n",
  );
});

test("clipboard rejection keeps the input and gives a usable fallback", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      value: () => Promise.reject(new Error("Denied")),
    }),
  );
  await page.goto("/submissions/h1");
  await page.getByRole("button", { name: "입력 복사", exact: true }).click();
  await expect(
    page.getByText("복사하지 못했어요. 내용을 직접 선택해 복사해 주세요."),
  ).toBeVisible();
  await expect(page.locator(".io-block").first().locator("pre")).toHaveText(
    "1 2\n",
  );
});

test("a stopped poll keeps the last result and manual retry only reads without resubmission", async ({
  page,
}) => {
  let fail = false;
  let recovered = false;
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/submissions"))
      writes.push(request.url());
  });
  await page.route("**/api/v1/submissions/h1", (route) =>
    route.fulfill(
      fail && !recovered
        ? { status: 403, json: { message: "결과 갱신 중단" } }
        : {
            json: { ...submission, status: recovered ? "ACCEPTED" : "JUDGING" },
          },
    ),
  );
  await page.goto("/submissions/h1");
  await expect(page.locator(".result-banner strong")).toHaveText("채점 중");
  fail = true;
  await expect(
    page.getByRole("button", { name: "다시 확인", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-banner strong")).toHaveText("채점 중");
  await expect(
    page.getByText("표시된 결과는 마지막 확인 당시 상태입니다."),
  ).toBeVisible();
  recovered = true;
  await page.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(page.locator(".result-banner strong")).toHaveText("성공");
  expect(writes).toEqual([]);
});

test("enterprise shows exact dates and the time zone while keeping the compact summary", async ({
  page,
}) => {
  const record = {
    id: "schedule",
    title: "정확한 일정",
    description: "",
    startsAt: "2026-12-01T10:00:00Z",
    endsAt: "2026-12-03T14:30:00Z",
    durationMin: 60,
    problemIds: [problem.id],
    inviteCode: "invite-code-0001",
    attemptCount: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  // 기업 테스트는 서버에 저장되므로 목록·상세 API를 흉내 낸다.
  await page.route("**/api/v1/enterprise/tests", (route) => route.fulfill({ json: [record] }));
  await page.route("**/api/v1/enterprise/tests/schedule", (route) => route.fulfill({ json: record }));
  await page.goto("/enterprise");
  await expect(page.locator(".ent-period > span")).not.toContainText(
    /\d{2}:\d{2}/,
  );
  await page.getByText("정확한 일시·시간대", { exact: true }).click();
  await expect(page.locator("time").first()).toHaveAttribute(
    "dateTime",
    record.startsAt,
  );
  await expect(page.locator(".schedule-zone")).toContainText(
    "이 기기의 현지 시간",
  );
  await page.goto("/enterprise/schedule");
  await expect(
    page.getByRole("region", { name: "정확한 테스트 일정" }),
  ).toBeVisible();
});

test("guest enterprise authoring preserves a complete deep link through authentication", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.removeItem("unsolvable-oj-session-v1"),
  );
  await page.goto("/enterprise/new?from=calendar#schedule");
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => history.state?.usr?.from)).toBe(
    "/enterprise/new?from=calendar#schedule",
  );
});

test("server missions retain real claims, with daily actions before the season panel", async ({
  page,
}) => {
  await mockMissions(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/missions");
  await expect(
    page.getByRole("button", { name: "일일 미션 보상 받기", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".missions-page")).not.toContainText("보상 미지급");
  expect(
    await page
      .locator(".mission-group-day")
      .evaluate((el) =>
        Boolean(
          el.compareDocumentPosition(document.querySelector(".mission-top")!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  expect(
    await page
      .locator(".season-ring-chart")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(80);
});

test("analysis storage descriptions distinguish accounts from guest browser records", async ({
  page,
}) => {
  await mockMissions(page);
  await page.goto("/analysis");
  await expect(page.locator(".analysis-hint")).toContainText("계정에 저장");
  await expect(page.locator(".analysis-hint")).not.toContainText(
    "이 브라우저에 저장되고",
  );
});

test("harmonized pages fit narrow and intermediate widths and keep editor focus visible", async ({
  page,
}) => {
  await mockMissions(page);
  for (const width of [320, 390, 768, 1101, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      "/problems",
      "/profile",
      "/community/harmony",
      "/missions",
      "/submissions",
      "/enterprise/new",
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
        `${path}:${width}`,
      ).toBeLessThanOrEqual(1);
    }
  }
  await page.goto("/problems/view/sum");
  await page.locator("textarea.code-editor").focus();
  expect(
    await page
      .locator(".editor-frame")
      .evaluate((el) => getComputedStyle(el).boxShadow),
  ).not.toBe("none");
});
