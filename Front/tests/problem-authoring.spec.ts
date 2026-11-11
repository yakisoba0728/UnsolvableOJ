import { expect, test, type Route } from "@playwright/test";
import { authenticate, mockProblemApi, problem, session, storageKey } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("status changes lock every row, reject repeated clicks and unlock after failure", async ({ page }) => {
  await authenticate(page, "ADMIN");
  const pending: Route[] = [];
  await page.route("**/api/v1/problems/mine", (route) => route.fulfill({ json: [
    { ...problem, id: "a", title: "문제 A", currentVersion: 1 },
    { ...problem, id: "b", title: "문제 B", currentVersion: 1 },
  ] }));
  await page.route("**/api/v1/problems/*/status", (route) => { pending.push(route); });
  await page.goto("/my-problems");
  const a = page.locator(".my-problem-row", { hasText: "문제 A" });
  const b = page.locator(".my-problem-row", { hasText: "문제 B" });
  await a.getByRole("button", { name: "비공개로 전환" }).click();
  await expect.poll(() => pending.length).toBe(1);
  await expect(a.getByRole("button", { name: "비공개로 전환" })).toBeDisabled();
  await expect(b.getByRole("button", { name: "비공개로 전환" })).toBeDisabled();
  // 일반 포인터 클릭은 disabled 버튼에서 요청을 만들지 않아야 한다.
  for (const row of [b, a]) {
    const box = await row.getByRole("button", { name: "비공개로 전환" }).boundingBox();
    if (!box) throw new Error("상태 버튼을 찾지 못했습니다.");
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }
  expect(pending).toHaveLength(1);
  await pending[0].fulfill({ status: 403, json: { message: "상태 변경 권한이 없습니다." } });
  await expect(page.getByRole("alert")).toHaveText("상태 변경 권한이 없습니다.");
  await expect(a).toContainText("공개 중");
  await expect(a.getByRole("button", { name: "비공개로 전환" })).toBeEnabled();
  await expect(b.getByRole("button", { name: "비공개로 전환" })).toBeEnabled();
  await b.getByRole("button", { name: "비공개로 전환" }).click();
  await expect.poll(() => pending.length).toBe(2);
  expect(pending[1].request().url()).toContain("/problems/b/status");
  expect(pending[1].request().postDataJSON()).toEqual({ status: "DRAFT" });
  await pending[1].fulfill({ json: { id: "b", status: "DRAFT", currentVersion: 1 } });
  await expect(b).toContainText("초안 · 검수 대기");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(a.getByRole("button", { name: "비공개로 전환" })).toBeEnabled();
  await a.getByRole("button", { name: "비공개로 전환" }).click();
  await expect.poll(() => pending.length).toBe(3);
  await pending[2].fulfill({ json: { id: "a", status: "DRAFT", currentVersion: 1 } });
  await expect(a).toContainText("초안 · 검수 대기");
  await expect(a.getByRole("button", { name: "공개하기", exact: true })).toBeEnabled();
});

test("authors archive a problem only after confirming and can unarchive it back to a draft", async ({ page }) => {
  await authenticate(page, "AUTHOR");
  await page.route("**/api/v1/problems/mine", (route) => route.fulfill({ json: [
    { ...problem, id: "a", title: "문제 A", currentVersion: 1 },
  ] }));
  const sent: unknown[] = [];
  await page.route("**/api/v1/problems/a/status", async (route) => {
    const body = route.request().postDataJSON() as { status: string };
    sent.push(body);
    await route.fulfill({ json: { id: "a", status: body.status, currentVersion: 1 } });
  });
  await page.goto("/my-problems");
  const row = page.locator(".my-problem-row", { hasText: "문제 A" });
  const dialogs: string[] = [];
  let accept = false;
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await row.getByRole("button", { name: "보관", exact: true }).click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain("문제 A");
  expect(sent).toHaveLength(0);
  await expect(row).toContainText("공개 중");

  accept = true;
  await row.getByRole("button", { name: "보관", exact: true }).click();
  await expect(row).toContainText("보관됨");
  expect(sent).toEqual([{ status: "ARCHIVED" }]);
  await expect(page.getByRole("status")).toHaveText("문제를 보관했어요.");
  await expect(row.getByRole("link", { name: "문제 보기" })).toHaveCount(0);

  accept = false;
  await row.getByRole("button", { name: "보관 해제" }).click();
  await expect.poll(() => dialogs.length).toBe(3);
  expect(dialogs[2]).toContain("보관을 해제할까요?");
  expect(sent).toHaveLength(1);
  await expect(row).toContainText("보관됨");

  accept = true;
  await row.getByRole("button", { name: "보관 해제" }).click();
  await expect(row).toContainText("초안 · 검수 대기");
  expect(sent).toEqual([{ status: "ARCHIVED" }, { status: "DRAFT" }]);
  await expect(page.getByRole("status")).toHaveText("보관을 해제했어요. 초안으로 돌아왔어요.");
  expect(dialogs).toHaveLength(4);
});

for (const boundary of ["token", "account", "page"] as const) {
  test(`late status responses cannot overwrite a newer result after a ${boundary} change`, async ({ page }) => {
    await authenticate(page, "ADMIN");
    let serverStatus: "DRAFT" | "PUBLISHED" = "PUBLISHED";
    let first: Route | undefined;
    let requests = 0;
    await page.route("**/api/v1/problems/mine", (route) => route.fulfill({
      json: [{ ...problem, status: serverStatus, currentVersion: 1 }],
    }));
    await page.route(`**/api/v1/problems/${problem.id}/status`, async (route) => {
      requests += 1;
      serverStatus = (route.request().postDataJSON() as { status: typeof serverStatus }).status;
      if (requests === 1) first = route;
      else await route.fulfill({ json: { id: problem.id, status: serverStatus, currentVersion: 1 } });
    });
    await page.goto("/my-problems");
    await page.getByRole("button", { name: "비공개로 전환" }).click();
    await expect.poll(() => requests).toBe(1);
    expect(serverStatus).toBe("DRAFT");
    if (boundary === "page") {
      await page.getByRole("link", { name: /문제 목록/ }).first().click();
      await expect(page).toHaveURL(/\/problems$/);
      await expect(page.getByRole("heading", { name: "문제 목록", exact: true })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/my-problems$/);
    } else {
      await page.evaluate(({ key, saved }) => {
        localStorage.setItem(key, JSON.stringify(saved));
        window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
      }, { key: storageKey, saved: {
        session: { ...session, accessToken: "replacement-admin-token", user: {
          ...session.user, role: "ADMIN", id: boundary === "account" ? "other-admin" : session.user.id,
        } },
        expiresAt: Date.now() + 900_000,
      } });
    }
    await expect(page.getByRole("button", { name: "공개하기", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "공개하기", exact: true }).click();
    await expect(page.locator(".my-problem-row")).toContainText("공개 중");
    await expect(page.getByRole("status")).toHaveText("문제를 공개했어요.");
    expect(requests).toBe(2);
    expect(serverStatus).toBe("PUBLISHED");
    const old = first!;
    const finished = page.waitForEvent("requestfinished", { predicate: (request) => request === old.request() });
    await old.fulfill(boundary === "account"
      ? { status: 403, json: { message: "이전 계정의 늦은 오류" } }
      : { json: { id: problem.id, status: "DRAFT", currentVersion: 1 } });
    await finished;
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(page.locator(".my-problem-row")).toContainText("공개 중");
    await expect(page.getByRole("button", { name: "공개하기", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "비공개로 전환" })).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText("문제를 공개했어요.");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(serverStatus).toBe("PUBLISHED");
  });
}

test("any signed-in user can open the author form; signed-out visitors are sent to login", async ({ page }) => {
  await page.goto("/problems/new");
  await expect(page).toHaveURL(/\/auth$/);
  await authenticate(page);
  await page.goto("/problems");
  await page.locator(".problem-authoring").getByRole("link", { name: "문제 만들기", exact: true }).click();
  await expect(page).toHaveURL(/\/problems\/new$/);
  await expect(page.getByLabel("제목", { exact: true })).toBeVisible();
});

test("an enterprise-only problem is saved as a private draft even by an admin", async ({ page }) => {
  await authenticate(page, "ADMIN");
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/v1/problems/by-slug/company", (route) =>
    route.fulfill({ status: 404, json: { message: "Not found" } }),
  );
  await page.route("**/api/v1/problems", async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ...problem, ...submitted, status: "DRAFT" } });
  });
  await page.goto("/problems/new?private=1");
  await expect(page.getByLabel("기업 테스트 전용 문제")).toBeChecked();
  await page.getByLabel("제목", { exact: true }).fill(problem.title);
  await page.getByLabel("주소용 slug").fill("company");
  await page.getByLabel("문제 본문 (Markdown)").fill(problem.statementMarkdown);
  await page.getByLabel("입력 설명").fill("두 정수");
  await page.getByLabel("출력 설명").fill("합");
  await page.getByLabel("입력", { exact: true }).fill("1 2");
  await page.getByLabel("기대 출력", { exact: true }).fill("3");
  await page.getByRole("button", { name: /저장하기 →|게시하기 →/ }).click();
  await expect.poll(() => submitted).toMatchObject({ isPrivate: true, status: "DRAFT" });
});

for (const role of ["USER", "AUTHOR", "ADMIN"] as const) {
  test(`${role} creates a problem with the appropriate publication status`, async ({
    page,
  }) => {
    await authenticate(page, role);
    let submitted: Record<string, unknown> | undefined;
    // A new slug must not exist during the debounced duplicate check. Once
    // created, ADMIN's redirect can read the published problem at this URL.
    await page.route("**/api/v1/problems/by-slug/new", (route) =>
      submitted
        ? route.fulfill({ json: { ...problem, ...submitted } })
        : route.fulfill({ status: 404, json: { message: "Not found" } }),
    );
    await page.route("**/api/v1/problems", async (route) => {
      submitted = route.request().postDataJSON();
      expect(route.request().headers().authorization).toBe(
        `Bearer ${session.accessToken}`,
      );
      await route.fulfill({ status: 201, json: { ...problem, ...submitted } });
    });
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill(problem.title);
    const slugChecked = page.waitForResponse("**/api/v1/problems/by-slug/new");
    await page.getByLabel("주소용 slug").fill("new");
    await page
      .getByLabel("문제 본문 (Markdown)")
      .fill(problem.statementMarkdown);
    await page.getByLabel("입력 설명").fill("두 정수");
    await page.getByLabel("출력 설명").fill("합");
    await page.getByLabel("입력", { exact: true }).fill("1 2");
    await page.getByLabel("기대 출력", { exact: true }).fill("3");
    expect((await slugChecked).status()).toBe(404);
    await page
      .getByRole("button", {
        name: role !== "ADMIN" ? "초안 저장하기 →" : "문제 게시하기 →",
      })
      .click();
    if (role !== "ADMIN") {
      await expect(
        page.getByRole("heading", { name: "초안을 저장했습니다." }),
      ).toBeVisible();
      await expect(page).toHaveURL(/\/problems\/new$/);
    } else {
      await expect(page).toHaveURL(/\/problems\/view\/new$/);
      await expect(
        page.getByRole("heading", { name: problem.title, exact: true }),
      ).toBeVisible();
    }
    expect(submitted).toMatchObject({
      status: role !== "ADMIN" ? "DRAFT" : "PUBLISHED",
      timeLimitMs: 1000,
      memoryLimitMb: 256,
    });
  });
}

test.describe("problem editor", () => {
  test("empty form shows field errors and does not call the API", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    let posted = false;
    await page.route("**/api/v1/problems", (route) => {
      posted = true;
      return route.fulfill({ status: 201, json: problem });
    });
    await page.goto("/problems/new");
    await page.getByRole("button", { name: "초안 저장하기 →" }).click();
    await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("문제 본문을 입력해 주세요.")).toBeVisible();
    await expect(page.getByText("출력 형식을 설명해 주세요.")).toBeVisible();
    await expect(page.getByText("기대 출력을 입력해 주세요.")).toHaveCount(0);
    expect(posted).toBe(false);
  });

  test("slug follows an English title until edited by hand", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill("Sum Of Two");
    await expect(page.getByLabel("주소용 slug")).toHaveValue("sum-of-two");
    await page.getByLabel("주소용 slug").fill("my-sum");
    await page.getByLabel("제목", { exact: true }).fill("Sum Of Three");
    await expect(page.getByLabel("주소용 slug")).toHaveValue("my-sum");
  });

  test("preview tab renders the markdown", async ({ page }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("문제 본문 (Markdown)").fill("**굵게** 설명");
    await page.getByRole("tab", { name: "미리보기" }).first().click();
    await expect(page.locator(".md-preview strong")).toHaveText("굵게");
  });

  test("test cases can be duplicated and switched between sample and hidden", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await expect(page.getByText("예제 1개", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "복제" }).click();
    await expect(page.getByText("예제 2개", { exact: true })).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "테스트 2 공개 여부" })
      .getByText("숨김", { exact: true })
      .click();
    await expect(page.getByText("예제 1개", { exact: true })).toBeVisible();
    await expect(page.getByText("숨김 1개", { exact: true })).toBeVisible();
  });

  test("a test case's input and expected output can be loaded from text files within the size limit", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    const file = (name: string, text: string) => ({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(text),
    });
    await page
      .getByLabel("테스트 1 입력 파일에서 불러오기")
      .setInputFiles(file("1.in", "3 4\n"));
    await page
      .getByLabel("테스트 1 기대 출력 파일에서 불러오기")
      .setInputFiles(file("1.out", "7\n"));
    const [input, output] = [0, 1].map((at) => page.locator(".case-editor textarea").nth(at));
    await expect(input).toHaveValue("3 4\n");
    await expect(output).toHaveValue("7\n");

    await page
      .getByLabel("테스트 1 입력 파일에서 불러오기")
      .setInputFiles(file("big.in", "x".repeat(1_000_001)));
    await expect(page.getByRole("alert")).toHaveText(
      "big.in 파일이 1MB(1,000,000바이트)를 넘어 불러오지 않았어요.",
    );
    await expect(input).toHaveValue("3 4\n");
  });

  test("the form opens and autosaves without crypto.randomUUID (plain HTTP)", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Crypto.prototype, "randomUUID");
    });
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await expect(page.getByLabel("제목", { exact: true })).toBeVisible();
    await page.getByLabel("제목", { exact: true }).fill("HTTP에서 만든 문제");
    await expect(page.getByText(/임시 저장됨/)).toBeVisible();
  });

  test("an unsaved draft is restored after reload", async ({ page }) => {
    await authenticate(page, "AUTHOR");
    await page.goto("/problems/new");
    await page.getByLabel("제목", { exact: true }).fill("임시 저장 문제");
    await expect(page.getByText(/임시 저장됨/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByText("작성 중이던 문제를 불러왔어요."),
    ).toBeVisible();
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
      "임시 저장 문제",
    );
  });

  test("an author can unpublish their own problem but not publish a draft", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    const row = {
      slug: problem.slug,
      title: problem.title,
      difficulty: problem.difficulty,
      currentVersion: 1,
      updatedAt: problem.updatedAt,
    };
    await page.route("**/api/v1/problems/mine", (route) =>
      route.fulfill({
        json: [
          { ...row, id: "live", status: "PUBLISHED" },
          { ...row, id: "draft", slug: "draft", status: "DRAFT" },
        ],
      }),
    );
    let changed: unknown;
    await page.route("**/api/v1/problems/live/status", async (route) => {
      changed = route.request().postDataJSON();
      await route.fulfill({ json: { id: "live", status: "DRAFT", currentVersion: 1 } });
    });
    await page.goto("/my-problems");
    await expect(page.getByRole("button", { name: "공개하기" })).toHaveCount(0);
    await page.getByRole("button", { name: "비공개로 전환" }).click();
    await expect(page.getByRole("status")).toHaveText("문제를 비공개로 전환했어요.");
    expect(changed).toEqual({ status: "DRAFT" });
    await expect(page.getByRole("button", { name: "비공개로 전환" })).toHaveCount(0);
  });

  test("author edits an existing problem from the my problems list", async ({
    page,
  }) => {
    await authenticate(page, "AUTHOR");
    const managed = {
      ...problem,
      status: "PUBLISHED",
      statementMarkdown: "본문\n\n## 힌트\n작은 수부터",
      testCases: [
        { input: "1 2\n", expectedOutput: "3\n", isSample: true, score: 1 },
        { input: "5 5\n", expectedOutput: "10\n", isSample: false, score: 1 },
      ],
    };
    let patched: Record<string, unknown> | undefined;
    await page.route("**/api/v1/problems/mine", (route) =>
      route.fulfill({
        json: [
          {
            id: problem.id,
            slug: problem.slug,
            title: problem.title,
            status: "PUBLISHED",
            difficulty: problem.difficulty,
            currentVersion: 1,
            updatedAt: problem.updatedAt,
          },
        ],
      }),
    );
    await page.route(`**/api/v1/problems/${problem.id}/manage`, (route) =>
      route.fulfill({ json: managed }),
    );
    await page.route(`**/api/v1/problems/${problem.id}`, async (route) => {
      patched = route.request().postDataJSON();
      await route.fulfill({ json: managed });
    });
    await page.goto("/my-problems");
    await page.getByRole("link", { name: "수정" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/my-problems/${problem.id}/edit$`),
    );
    await expect(page.getByLabel("제목", { exact: true })).toHaveValue(
      problem.title,
    );
    await expect(page.getByLabel("주소용 slug")).toHaveAttribute(
      "readonly",
      "",
    );
    await expect(page.getByText("숨김 1개", { exact: true })).toBeVisible();
    await page.getByLabel("제목", { exact: true }).fill("수정한 제목");
    await page.getByRole("button", { name: "수정 저장하기 →" }).click();
    await expect(page).toHaveURL(/\/my-problems$/);
    await expect(page.getByText(/초안으로 돌아가며/)).toBeVisible();
    expect(patched).toMatchObject({ title: "수정한 제목" });
    expect(String(patched?.statementMarkdown)).toContain("## 힌트");
    expect(patched).not.toHaveProperty("slug");
  });
});
