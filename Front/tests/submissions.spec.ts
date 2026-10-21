import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi, problem, session } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("submission passes the source and polls through to the final verdict", async ({
  page,
}) => {
  await authenticate(page);
  const source = "print(sum(map(int, input().split())))";
  const submitted = {
    id: "submission-id",
    problem,
    language: "PYTHON",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 2,
    totalTestCases: 2,
    sourceCode: source,
    compileOutput: null,
    judgeMessage: null,
    createdAt: problem.createdAt,
  };
  await page.route(
    "**/api/v1/problems/problem-id/submissions",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        language: "PYTHON",
        sourceCode: source,
      });
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      await route.fulfill({
        status: 202,
        json: { ...submitted, status: "QUEUED" },
      });
    },
  );
  let reads = 0;
  await page.route("**/api/v1/submissions/submission-id", (route) => {
    const status = ["QUEUED", "JUDGING", "ACCEPTED"][Math.min(reads++, 2)];
    return route.fulfill({ json: { ...submitted, status } });
  });
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill(source);
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  // 화면을 옮기지 않고 코드 창 아래 채점 결과 패널에서 바로 확인한다.
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  await expect(panel.getByText("성공", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(panel.getByText("2 / 2", { exact: true })).toBeVisible();
  // 내 제출 목록과 달리 풀이 화면의 채점 결과 판정은 알약 모양이 그대로다.
  const pill = await panel
    .locator(".verdict")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return { radius: style.borderRadius, background: style.backgroundColor };
    });
  expect(pill.radius).toBe("999px");
  expect(pill.background).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.getByLabel("소스 코드")).toHaveValue(source);
  await page.waitForTimeout(2200); // One full polling period after the terminal response.
  expect(reads).toBe(3);
});

test("the my-submissions title column stays readable between 881 and 1100px", async ({
  page,
}) => {
  await authenticate(page);
  const item = (id: string) => ({
    id,
    problem: {
      id: `p-${id}`,
      slug: `p-${id}`,
      title: "최소 스패닝 트리와 위상 정렬",
    },
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 5,
    totalTestCases: 5,
    compileOutput: null,
    judgeMessage: null,
    createdAt: "2026-10-18T03:00:00Z",
    updatedAt: "2026-10-18T03:00:00Z",
  });
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: {
        items: [item("a"), item("b")],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      },
    }),
  );
  for (const width of [900, 1000, 1100]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/submissions");
    await expect(page.locator(".history-row")).toHaveCount(2);
    const title = (await page.locator(".history-title").first().boundingBox())!;
    // 이전에는 900px에서 60px대, 1000px에서 160px대까지 줄어 말줄임이 심했다.
    expect(title.width).toBeGreaterThanOrEqual(190);
  }
});

test("the grading result panel can be resized by dragging or with arrow keys, and remembers its height", async ({
  page,
}) => {
  await authenticate(page);
  const submitted = {
    id: "submission-id",
    problem,
    language: "PYTHON",
    status: "ACCEPTED",
    runtimeMs: 12,
    memoryKb: 8192,
    passedTestCases: 2,
    totalTestCases: 2,
    sourceCode: "print(1)",
    compileOutput: null,
    judgeMessage: null,
    createdAt: problem.createdAt,
  };
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({ status: 202, json: submitted }),
  );
  await page.route("**/api/v1/submissions/submission-id", (route) =>
    route.fulfill({ json: submitted }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(1)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel).toBeVisible();
  const handle = page.getByRole("separator", { name: "채점 결과 높이 조절" });
  const before = (await panel.boundingBox())!.height;

  // 위로 끌면 커지고, 아래로 끌면 줄어든다.
  const grip = (await handle.boundingBox())!;
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 80, { steps: 4 });
  await page.mouse.up();
  const taller = (await panel.boundingBox())!.height;
  expect(taller).toBeGreaterThan(before + 60);

  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const shorter = (await panel.boundingBox())!.height;
  expect(shorter).toBeLessThan(taller - 30);

  // 다시 열어도 마지막 높이를 기억한다.
  await page.reload();
  await page.getByLabel("소스 코드").fill("print(1)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  await expect(panel).toBeVisible();
  expect(
    Math.abs((await panel.boundingBox())!.height - shorter),
  ).toBeLessThanOrEqual(2);
});

test("my submissions can be searched, filtered and grouped by problem", async ({
  page,
}) => {
  await authenticate(page);
  const make = (
    id: string,
    title: string,
    status: string,
    language: string,
    at: string,
  ) => ({
    id,
    problem: { id: `p-${title}`, slug: title, title },
    language,
    status,
    runtimeMs: 10,
    memoryKb: 2048,
    passedTestCases: status === "ACCEPTED" ? 2 : 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    createdAt: at,
    updatedAt: at,
  });
  const items = [
    make("s4", "피보나치", "WRONG_ANSWER", "PYTHON", "2026-10-04T00:00:00Z"),
    make("s3", "피보나치", "ACCEPTED", "CPP", "2026-10-03T00:00:00Z"),
    make("s2", "정렬", "WRONG_ANSWER", "PYTHON", "2026-10-02T00:00:00Z"),
    make("s1", "정렬", "WRONG_ANSWER", "PYTHON", "2026-10-01T00:00:00Z"),
  ];
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, total: 4, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  await page.goto("/submissions");
  const rows = page.locator(".history-row");
  await expect(rows).toHaveCount(4);

  // 테스트 케이스 결과는 제목 아래가 아니라 '테스트' 열에 N/N 으로만 보이고, 끝 화살표는 없다.
  await expect(page.locator(".history-head")).toContainText("테스트");
  await expect(rows.first().locator(".history-tests")).toHaveText(/^\d+\/\d+$/);
  await expect(rows.locator(".row-arrow")).toHaveCount(0);
  await expect(page.locator(".history-title small")).toHaveCount(0);
  await expect(page.getByText("통과", { exact: false })).toHaveCount(0);
  // 제목을 뺀 열은 모두 오른쪽 정렬이고, 오른쪽 끝(제출 시각)이 목록 안쪽 여백에 닿는다.
  const rightGap = async (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const list = document
          .querySelector(".list-history")!
          .getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        return Math.round(list.right - range.getBoundingClientRect().right);
      });
  expect(await rightGap(".history-head span:last-child")).toBeLessThanOrEqual(
    26,
  );
  expect(await rightGap(".history-row .history-time")).toBeLessThanOrEqual(26);

  const verdicts = page.getByRole("group", { name: "판정 필터" });
  await verdicts.getByRole("button", { name: /^성공/ }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("피보나치");
  // 선택한 항목을 다시 누르면 전체로 돌아간다
  await verdicts.getByRole("button", { name: /^성공/ }).click();
  await expect(rows).toHaveCount(4);

  // ⌘/Ctrl+클릭으로 같은 종류 안에서 여러 개를 고른다(성공 + 틀림·오류 = 전부)
  await verdicts
    .getByRole("button", { name: /^성공/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(rows).toHaveCount(1);
  await verdicts
    .getByRole("button", { name: /^틀림/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(rows).toHaveCount(4);
  await expect(page).toHaveURL(/s=accepted%2Cwrong/);
  // '전체'는 수정자 키를 무시하고 단독 선택으로 돌아간다
  await verdicts
    .getByRole("button", { name: /^전체/ })
    .click({ modifiers: ["ControlOrMeta"] });
  await expect(page).not.toHaveURL(/s=/);
  await expect(verdicts.getByRole("button", { name: /^전체/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByLabel("제출한 문제 검색").fill("정렬");
  await expect(rows).toHaveCount(2);
  await page.getByLabel("제출한 문제 검색").fill("");
  await expect(rows).toHaveCount(4);

  await page
    .getByRole("radiogroup", { name: "보기 방식" })
    .getByText("문제별 최신")
    .click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("이 문제 2회 제출");
});

test("a rejected submission shows each public case with input, expected and actual output", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/by-slug/sum", (route) =>
    route.fulfill({
      json: {
        ...problem,
        samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
      },
    }),
  );
  await page.route("**/api/v1/submissions/wrong-id", (route) =>
    route.fulfill({
      json: {
        id: "wrong-id",
        problem: { id: problem.id, slug: "sum", title: problem.title },
        language: "PYTHON",
        status: "WRONG_ANSWER",
        runtimeMs: 10,
        memoryKb: 1000,
        passedTestCases: 0,
        totalTestCases: 2,
        compileOutput: null,
        judgeMessage: null,
        sourceCode: "print(0)",
        sampleTestCases: [
          { testCase: 1, input: "1 2\n", expectedOutput: "3\n" },
        ],
        debugOutputs: [
          {
            testCase: 1,
            stdout: "0\n",
            stderr: "",
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        ],
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
    }),
  );
  await page.route("**/api/v1/submissions", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/submissions/wrong-id");
  const result = page.locator(".case-result");
  await expect(result.getByText("예제 1")).toBeVisible();
  await expect(result.getByText("기대 출력과 달라요")).toBeVisible();
  await expect(result.locator(".io-block").nth(0)).toContainText("1 2");
  await expect(result.locator(".io-block").nth(1)).toContainText("3");
  await expect(result.locator(".io-block").nth(2)).toContainText("0");
  await expect(page.getByRole("link", { name: "코드 수정하기" })).toBeVisible();
  await expect(page.getByText("코드 수정하고 다시 풀기")).toHaveCount(0);
});

test("a rejected submission is shown under the editor with each example compared", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/by-slug/sum", (route) =>
    route.fulfill({
      json: {
        ...problem,
        samples: [{ input: "1 2\n", expectedOutput: "3\n" }],
      },
    }),
  );
  const rejected = {
    id: "wrong-inline",
    problem: { id: problem.id, slug: "sum", title: problem.title },
    language: "PYTHON",
    status: "WRONG_ANSWER",
    runtimeMs: 10,
    memoryKb: 1000,
    passedTestCases: 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    sourceCode: "print(0)",
    sampleTestCases: [{ testCase: 1, input: "1 2\n", expectedOutput: "3\n" }],
    debugOutputs: [
      {
        testCase: 1,
        stdout: "0\n",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    ],
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({ status: 202, json: { ...rejected, status: "QUEUED" } }),
  );
  await page.route("**/api/v1/submissions/wrong-inline", (route) =>
    route.fulfill({ json: rejected }),
  );
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(0)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  const panel = page.getByRole("region", { name: "채점 결과" });
  await expect(panel.getByText("기대 출력과 달라요")).toBeVisible();
  await expect(panel.locator(".io-block").nth(0)).toContainText("1 2");
  await expect(panel.locator(".io-block").nth(1)).toContainText("3");
  await expect(panel.locator(".io-block").nth(2)).toContainText("0");
  await expect(page).toHaveURL(/\/problems\/view\/sum$/);
  // 접고 닫을 수 있고, 코드는 그대로다.
  await panel.getByRole("button", { name: "접기" }).click();
  await expect(panel.locator(".case-result")).toHaveCount(0);
  await panel.getByRole("button", { name: "닫기" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("소스 코드")).toHaveValue("print(0)");
});

test("Ctrl/⌘+Enter pressed twice creates only one submission", async ({
  page,
}) => {
  await authenticate(page);
  let posts = 0;
  await page.route(
    "**/api/v1/problems/problem-id/submissions",
    async (route) => {
      posts += 1;
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({
        status: 429,
        json: { message: "잠시 후 다시 제출하세요." },
      });
    },
  );
  await page.goto("/problems/view/sum");
  const editor = page.getByLabel("소스 코드");
  await editor.fill("print(1)");
  await editor.press("ControlOrMeta+Enter");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByRole("alert")).toHaveText("잠시 후 다시 제출하세요.");
  expect(posts).toBe(1);
});

test("Ctrl/⌘+Enter does not submit whitespace-only code", async ({ page }) => {
  await authenticate(page);
  let posts = 0;
  await page.route("**/api/v1/problems/problem-id/submissions", (route) => {
    posts += 1;
    return route.fulfill({ status: 429, json: { message: "제출됨" } });
  });
  await page.goto("/problems/view/sum");
  const editor = page.getByLabel("소스 코드");
  await editor.fill("  \n\t\n");
  await editor.press("ControlOrMeta+Enter");
  // 이어서 실제 코드를 제출해 앞선 단축키가 요청을 보내지 않았는지 확인한다.
  await editor.fill("print(1)");
  await editor.press("ControlOrMeta+Enter");
  await expect(page.getByRole("alert")).toHaveText("제출됨");
  expect(posts).toBe(1);
});

test("submission API errors preserve the source and re-enable submission", async ({
  page,
}) => {
  await authenticate(page);
  await page.route("**/api/v1/problems/problem-id/submissions", (route) =>
    route.fulfill({
      status: 429,
      json: { message: "잠시 후 다시 제출하세요." },
    }),
  );
  await page.goto("/problems/view/sum");
  await page.getByLabel("소스 코드").fill("print(3)");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  await expect(page.getByRole("alert")).toHaveText("잠시 후 다시 제출하세요.");
  await expect(page.getByLabel("소스 코드")).toHaveValue("print(3)");
  await expect(
    page.getByRole("button", { name: "제출하고 채점하기 →" }),
  ).toBeEnabled();
});

test("the verdict in the my-submissions list is plain coloured text, not a pill", async ({
  page,
}) => {
  await authenticate(page);
  const statuses = [
    "ACCEPTED",
    "WRONG_ANSWER",
    "RUNTIME_ERROR",
    "COMPILE_ERROR",
    "TIME_LIMIT_EXCEEDED",
    "MEMORY_LIMIT_EXCEEDED",
    "OUTPUT_LIMIT_EXCEEDED",
    "SYSTEM_ERROR",
    "QUEUED",
    "JUDGING",
    "CANCELLED",
  ];
  const items = statuses.map((status, index) => ({
    id: `s${index}`,
    problem: { id: `p${index}`, slug: `p${index}`, title: `문제 ${index}` },
    language: "PYTHON",
    status,
    runtimeMs: 10,
    memoryKb: 2048,
    passedTestCases: status === "ACCEPTED" ? 2 : 0,
    totalTestCases: 2,
    compileOutput: null,
    judgeMessage: null,
    createdAt: "2026-10-04T00:00:00Z",
    updatedAt: "2026-10-04T00:00:00Z",
  }));
  await page.route("**/api/v1/submissions?*", (route) =>
    route.fulfill({
      json: { items, total: items.length, page: 1, limit: 100, totalPages: 1 },
    }),
  );
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/submissions");
    const verdicts = page.locator(".history-row .verdict");
    await expect(verdicts).toHaveCount(statuses.length);
    const styles = await verdicts.evaluateAll((elements) =>
      elements.map((el) => {
        const style = getComputedStyle(el);
        return {
          status: el.className,
          background: style.backgroundColor,
          radius: style.borderRadius,
          paddingLeft: style.paddingLeft,
          height: el.getBoundingClientRect().height,
          color: style.color,
        };
      }),
    );
    for (const style of styles) {
      expect(style.background).toBe("rgba(0, 0, 0, 0)");
      expect(style.radius).toBe("0px");
      expect(style.paddingLeft).toBe("0px");
      expect(style.height).toBeLessThan(28); // 알약의 높이(28px)보다 낮은 글줄 높이
    }
    // 색은 그대로 판정마다 다르게 입혀진다(성공은 초록 계열, 오답·오류는 빨강 계열)
    const colorOf = (name: string) =>
      styles.find((style) => style.status.includes(name))!.color;
    expect(colorOf("verdict-accepted")).not.toBe(
      colorOf("verdict-wrong_answer"),
    );
    expect(colorOf("verdict-wrong_answer")).toBe(
      colorOf("verdict-runtime_error"),
    );
    expect(colorOf("verdict-queued")).not.toBe(colorOf("verdict-wrong_answer"));
  }

  // 굵기·크기·줄 높이는 문제 목록의 난이도 글씨와 같다.
  const typography = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          weight: style.fontWeight,
          size: style.fontSize,
          lineHeight: style.lineHeight,
          family: style.fontFamily,
        };
      });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/submissions");
  await expect(page.locator(".history-row .verdict").first()).toBeVisible();
  const verdict = await typography(".history-row .verdict");
  await page.goto("/problems");
  await expect(page.locator(".data-list .difficulty").first()).toBeVisible();
  expect(verdict).toEqual(await typography(".data-list .difficulty"));
  expect(verdict.weight).toBe("700");
});
