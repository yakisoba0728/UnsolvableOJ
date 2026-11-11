import { expect, test, type Page, type Route } from "@playwright/test";
import { authenticate, mockProblemApi } from "./fixtures";
import type { VibeAttempt, VibeCatalog } from "../src/vibe/types";

const id = "70000000-0000-4000-8000-000000000001";
const messageId = "70000000-0000-4000-8000-000000000002";
const runId = "70000000-0000-4000-8000-000000000003";
const challenge = {
  id: "post-search-v1",
  title: "게시글 검색 API 개선하기",
  summary: "검색 누락을 고치고 태그 필터를 추가하세요.",
  difficulty: "입문 · 실무형",
  stack: "TypeScript · Node.js",
  durationMin: 45,
  requirements: [
    "검색어의 대소문자와 앞뒤 공백을 무시합니다.",
    "태그가 일치하는 게시글만 반환합니다.",
    "입력 배열을 바꾸지 않습니다.",
  ],
  rubric: [
    { label: "결과물", max: 40, description: "기능 테스트" },
    { label: "프롬프트", max: 30, description: "맥락과 요구사항" },
    { label: "협업·검증", max: 30, description: "테스트와 수정 과정" },
  ],
};
const initialFiles = {
  "README.md": "# 검색 API\n요구사항을 읽어 주세요.",
  "src/search.ts": "export const searchPosts = () => [];\n",
  "src/tags.ts": "export const matchesTag = () => true;\n",
  "tests/search.test.ts": 'console.log("test");\n',
};
const makeAttempt = (): VibeAttempt => ({
  id,
  challenge,
  revision: 0,
  startedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 2700000).toISOString(),
  submittedAt: null,
  busyUntil: null,
  files: { ...initialFiles },
  editablePaths: ["src/search.ts", "src/tags.ts", "tests/search.test.ts"],
  messages: [],
  events: [],
  runs: [],
  report: null,
  canUndo: false,
  remainingAiRequests: 20,
  remainingRuns: 20,
  availability: { ai: true, runner: true },
  limits: {
    aiRequests: 20,
    runs: 20,
    dailyAttempts: 5,
    fileBytes: 30000,
    minutes: 45,
  },
});
async function mockVibe(page: Page) {
  await mockProblemApi(page);
  let state = makeAttempt();
  let undo = state.files;
  const requests: string[] = [];
  let failSave = false;
  const handleVibe = async (route: Route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = route.request().postDataJSON() ?? {};
    requests.push(`${method} ${path}`);
    if (path.endsWith("/challenges"))
      return route.fulfill({
        json: {
          items: [challenge],
          availability: state.availability,
        } satisfies VibeCatalog,
      });
    if (path.endsWith("/challenges/post-search-v1/attempts"))
      return route.fulfill({ json: state });
    if (path.endsWith("/attempts")) return route.fulfill({ json: [] });
    if (path.endsWith("/files")) {
      if (failSave)
        return route.fulfill({
          status: 503,
          json: { message: "테스트 저장 오류" },
        });
      undo = { ...state.files };
      state.files = { ...state.files, ...body.files };
      state.revision++;
      state.canUndo = true;
    } else if (path.endsWith("/messages")) {
      state.messages.push({
        id: crypto.randomUUID(),
        role: "user",
        text: body.prompt,
        createdAt: new Date().toISOString(),
        baseRevision: state.revision,
      });
      state.messages.push({
        id: messageId,
        role: "assistant",
        text: "태그 비교를 정확히 적용하는 변경안을 만들었습니다.",
        createdAt: new Date().toISOString(),
        baseRevision: state.revision,
        files: {
          "src/tags.ts":
            "export const matchesTag = (tags, tag) => !tag || tags.includes(tag);\n",
        },
      });
    } else if (path.endsWith("/apply")) {
      undo = { ...state.files };
      state.files = { ...state.files, ...state.messages.at(-1)!.files };
      state.revision++;
      state.canUndo = true;
    } else if (path.endsWith("/undo")) {
      state.files = undo;
      state.revision++;
      state.canUndo = false;
    } else if (path.endsWith("/runs"))
      state.runs.push({
        id: runId,
        revision: state.revision,
        createdAt: new Date().toISOString(),
        checks: [
          { name: "제목 검색", passed: true },
          { name: "태그 필터", passed: false, detail: "기대 결과와 다릅니다." },
        ],
      });
    else if (path.endsWith("/submit")) {
      state.submittedAt = new Date().toISOString();
      state.report = {
        outcome: 32,
        passed: 9,
        total: 11,
        evaluationStatus: "complete",
        reflection: body.reflection,
        checks: [{ name: "제목 검색", passed: true }],
        prompt: {
          score: 25,
          feedback: "조건을 구체적으로 전달했습니다.",
          evidence: [],
        },
        process: {
          score: 24,
          feedback: "테스트를 실행하고 결과를 확인했습니다.",
          evidence: [runId],
        },
      };
    }
    return route.fulfill({ json: structuredClone(state) });
  };
  // 연습은 새 탭에서 열리므로 팝업에서도 같은 응답을 받도록 브라우저 문맥에도 건다.
  await page.route("**/api/v1/vibe/**", handleVibe);
  await page.context().route("**/api/v1/vibe/**", handleVibe);
  return {
    requests,
    get state() {
      return state;
    },
    set state(next) {
      state = next;
    },
    failSave: (value: boolean) => {
      failSave = value;
    },
  };
}

test("a visitor discovers vibe practice and is sent to login before opening a workspace", async ({
  page,
}) => {
  await mockVibe(page);
  await page.goto("/vibe");
  await expect(page.getByRole("heading", { name: "바이브코딩" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/GPT-|Luna|medium/);
  await page.getByRole("link", { name: "로그인하고 연습하기" }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await page.goto(`/vibe/attempts/${id}`);
  await expect(page).toHaveURL(/\/auth$/);
});

test("practice saves files, reviews and applies AI proposals, runs tests and shows all three scores", async ({
  page: listPage,
}) => {
  let page = listPage;
  const mock = await mockVibe(listPage);
  await authenticate(listPage);
  await listPage.goto("/vibe");
  // 문제 목록처럼 연습은 새 탭에서 열리고, 목록 탭은 그대로 남는다.
  const [workspace] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "연습 시작 / 이어하기" }).click(),
  ]);
  await expect(workspace).toHaveURL(new RegExp(`/vibe/attempts/${id}$`));
  await expect(page).toHaveURL(/\/vibe$/);
  page = workspace;
  const editor = page.getByRole("textbox", { name: "TypeScript 소스 코드" });
  await editor.fill("export const searchPosts = () => [1];\n");
  await expect(
    page.getByRole("status").filter({ hasText: "서버에 저장됨" }),
  ).toBeVisible();
  expect(mock.state.files["src/search.ts"]).toContain("[1]");
  await page
    .getByLabel("파트너에게 보낼 메시지")
    .fill("태그 필터가 정확하게 동작하도록 수정해 주세요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(
    page.getByText("태그 비교를 정확히 적용하는 변경안"),
  ).toBeVisible();
  await page.getByRole("button", { name: "변경안 보기", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "현재 코드", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".vibe-diff")).toContainText("tags.includes(tag)");
  expect(mock.state.files["src/tags.ts"]).not.toContain("tags.includes");
  await page.getByRole("button", { name: "적용", exact: true }).click();
  await page.getByRole("tab", { name: "src/tags.ts" }).click();
  await expect(editor).toHaveValue(/tags.includes/);
  await page.getByRole("button", { name: "테스트 실행", exact: true }).click();
  await expect(page.getByText("r2의 실행 결과")).toBeVisible();
  await expect(page.locator("#vibe-dock-panel")).toContainText("태그 필터");
  await page.getByRole("tab", { name: /회고/ }).click();
  await page
    .getByLabel("제출 전 짧은 회고")
    .fill("태그 필터를 수정하고 테스트의 실패 원인을 확인했습니다.");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "최종 제출", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "81점, 다음 시도를 위한 기록" }),
  ).toBeVisible();
  await expect(page.locator(".vibe-score-grid")).toContainText("32/40");
  await expect(page.locator(".vibe-score-grid")).toContainText("25/30");
  await expect(page.locator(".vibe-score-grid")).toContainText("24/30");
  await expect(
    page.getByRole("button", { name: "보내기", exact: true }),
  ).toHaveCount(0);
  await expect(editor).toHaveCount(0);
});

test("a failed save retains work and stops AI from receiving unsaved stale code", async ({
  page,
}) => {
  const mock = await mockVibe(page);
  await authenticate(page);
  mock.failSave(true);
  await page.goto(`/vibe/attempts/${id}`);
  const editor = page.getByRole("textbox", { name: "TypeScript 소스 코드" });
  await editor.fill('const unsaved = "keep this work";\n');
  await page
    .getByLabel("파트너에게 보낼 메시지")
    .fill("현재 변경을 검토해 주세요.");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("테스트 저장 오류");
  await expect(editor).toHaveValue('const unsaved = "keep this work";\n');
  expect(mock.requests.some((path) => path.endsWith("/messages"))).toBe(false);
  mock.failSave(false);
  // 저장 오류 뒤 1초 자동 저장이 먼저 성공하면 '저장' 버튼이 꺼진다. 아직 켜져 있을 때만 직접 누른다.
  const save = page.getByRole("button", { name: "저장", exact: true });
  const saved = page.getByRole("status").filter({ hasText: "서버에 저장됨" });
  await expect(async () => {
    if (await save.isEnabled()) await save.click({ timeout: 1_000 });
    await expect(saved).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await page.reload();
  await expect(editor).toHaveValue('const unsaved = "keep this work";\n');
});

test("a stale tab recovery copy stays readable without overwriting a newer server revision", async ({
  page,
}) => {
  const mock = await mockVibe(page);
  await authenticate(page);
  mock.state = { ...mock.state, revision: 1 };
  await page.addInitScript(
    ({ id, files }) =>
      sessionStorage.setItem(
        `unsolvable-vibe-draft:solver:${id}`,
        JSON.stringify({ revision: 0, files }),
      ),
    {
      id,
      files: {
        ...initialFiles,
        "src/search.ts": 'const recoveredWork = "keep this";\n',
      },
    },
  );
  await page.goto(`/vibe/attempts/${id}`);
  await page.locator(".vibe-recovery summary").click();
  await expect(page.getByLabel("src/search.ts 복구 사본")).toHaveValue(
    'const recoveredWork = "keep this";\n',
  );
  await expect(
    page.getByRole("textbox", { name: "TypeScript 소스 코드" }),
  ).toHaveValue(initialFiles["src/search.ts"]);
  expect(mock.requests.some((request) => request.startsWith("PATCH"))).toBe(
    false,
  );
});

test("evaluation outages keep outcome points visible without presenting a false total", async ({
  page,
}) => {
  const mock = await mockVibe(page);
  await authenticate(page);
  mock.state = {
    ...mock.state,
    submittedAt: new Date().toISOString(),
    report: {
      outcome: 40,
      passed: 11,
      total: 11,
      evaluationStatus: "unavailable",
      reflection: "",
      prompt: null,
      process: null,
      checks: [],
    },
  };
  await page.goto(`/vibe/attempts/${id}`);
  await expect(page.locator(".vibe-score-grid")).toContainText("40/40");
  await expect(page.locator(".vibe-total")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "과정 평가 다시 받기" }),
  ).toBeVisible();
});

for (const width of [375, 1440])
  test(`workspace controls and file editor fit at ${width}px`, async ({
    page,
  }) => {
    await mockVibe(page);
    await authenticate(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/vibe/attempts/${id}`);
    await expect(
      page.getByRole("button", { name: "최종 제출", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "TypeScript 소스 코드" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("tab", { name: /README\.md/ }).click();
    await expect(page.getByLabel("README.md 코드")).toContainText(
      "요구사항을 읽어 주세요.",
    );
    await expect(
      page.getByRole("textbox", { name: "TypeScript 소스 코드" }),
    ).toHaveCount(0);
  });

test("file tabs move with arrow keys and mark the read-only file", async ({
  page,
}) => {
  await mockVibe(page);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/vibe/attempts/${id}`);
  const tabs = page.getByRole("tablist", { name: "프로젝트 파일" });
  await expect(tabs.getByRole("tab")).toHaveCount(4);
  await expect(tabs.getByRole("tab", { name: /README\.md/ })).toContainText(
    "읽기 전용",
  );
  const search = tabs.getByRole("tab", { name: "src/search.ts" });
  await expect(search).toHaveAttribute("aria-selected", "true");
  await search.focus();
  await page.keyboard.press("ArrowRight");
  const tags = tabs.getByRole("tab", { name: "src/tags.ts" });
  await expect(tags).toBeFocused();
  await expect(tags).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("textbox", { name: "TypeScript 소스 코드" })).toHaveValue(
    /matchesTag/,
  );
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: "tests/search.test.ts" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: /README\.md/ })).toBeFocused();
  await expect(page.getByLabel("README.md 코드")).toBeVisible();
  // 해야 할 일 패널에는 파일 목록이 없다
  await expect(
    page.locator("#vibe-task-panel").getByRole("tab"),
  ).toHaveCount(0);
});

test("the remaining time sits in the header and warns before the deadline", async ({
  page,
}) => {
  const mock = await mockVibe(page);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  mock.state = {
    ...mock.state,
    deadlineAt: new Date(Date.now() + 9 * 60_000).toISOString(),
  };
  await page.goto(`/vibe/attempts/${id}`);
  const timer = page.getByRole("timer");
  await expect(timer).toContainText("남은 시간");
  await expect(timer).toContainText(/0[89]:\d\d/);
  await expect(timer).toHaveClass(/is-warn/);
  await expect(page.getByRole("status").filter({ hasText: "10분 이하" })).toHaveCount(1);
  expect(
    await timer.evaluate((node) => parseFloat(getComputedStyle(node.querySelector("strong")!).fontSize)),
  ).toBeGreaterThanOrEqual(20);
  mock.state = {
    ...mock.state,
    deadlineAt: new Date(Date.now() + 3 * 60_000).toISOString(),
  };
  await page.reload();
  await expect(page.getByRole("timer")).toHaveClass(/is-danger/);
  await expect(page.getByRole("status").filter({ hasText: "5분 이하" })).toHaveCount(1);
  mock.state = {
    ...mock.state,
    deadlineAt: new Date(Date.now() - 1000).toISOString(),
  };
  await page.reload();
  await expect(page.getByRole("timer")).toContainText("시간 종료");
});

test("panels resize by drag and keys, fold when squeezed and reset on double click", async ({
  page,
}) => {
  await mockVibe(page);
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/vibe/attempts/${id}`);
  const tasks = page.locator("#vibe-task-panel");
  const chat = page.locator("#vibe-chat-panel");
  const width = async (locator: typeof tasks) =>
    Math.round((await locator.boundingBox())!.width);
  expect(await width(tasks)).toBe(260);
  expect(await width(chat)).toBe(360);

  const left = page.getByRole("separator", { name: "해야 할 일과 코드 작성 크기 조절" });
  await left.focus();
  await page.keyboard.press("ArrowRight");
  expect(await width(tasks)).toBe(284);
  // 끌어서 넓힌다
  const box = (await left.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect(await width(tasks)).toBeGreaterThan(340);
  // 끝까지 좁히면 접히고, 다시 끌면 열린다
  await page.keyboard.press("Home");
  await expect(tasks).toBeHidden();
  // 왼쪽이 접혀도 코드 작성 칸은 넓은 가운데 열을 그대로 쓴다
  expect(await width(page.locator("#vibe-code-panel"))).toBeGreaterThan(600);
  await page.keyboard.press("ArrowRight");
  await expect(tasks).toBeVisible();
  await left.dblclick();
  expect(await width(tasks)).toBe(260);

  const right = page.getByRole("separator", { name: "코드 작성과 코딩 파트너 크기 조절" });
  await right.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await width(chat)).toBe(384);
  await page.keyboard.press("Home");
  await expect(chat).toBeHidden();
  await page.keyboard.press("Enter");
  expect(await width(chat)).toBe(360);

  const dock = page.getByRole("separator", { name: "코드 편집기와 실행·회고 크기 조절" });
  const body = page.locator("#vibe-dock");
  const height = async () => Math.round((await body.boundingBox())!.height);
  expect(await height()).toBe(240);
  await dock.focus();
  await page.keyboard.press("ArrowUp");
  expect(await height()).toBe(264);
  await page.keyboard.press("Home");
  await expect(page.locator("#vibe-dock-panel")).toBeHidden();
  expect(await height()).toBe(48);
  // 접힌 상태에서 탭을 누르면 펴진다
  await page.getByRole("tab", { name: /회고/ }).click();
  await expect(page.getByLabel("제출 전 짧은 회고")).toBeVisible();
  await dock.dblclick();
  expect(await height()).toBe(240);
  // 회고에 적은 글은 탭을 오가도 남는다
  await page.getByLabel("제출 전 짧은 회고").fill("메모");
  await page.getByRole("tab", { name: "실행과 테스트" }).click();
  await page.getByRole("tab", { name: /회고/ }).click();
  await expect(page.getByLabel("제출 전 짧은 회고")).toHaveValue("메모");
  await expect(page.getByRole("tab", { name: /회고/ })).toContainText("작성 중");
});
