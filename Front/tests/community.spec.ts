import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("typing #word and pressing Enter in the community search makes a tag pill that filters posts", async ({
  page,
}) => {
  const post = (id: string, title: string, tags: string[], at: string) => ({
    id,
    category: "question",
    title,
    body: `${title} 본문`,
    author: { name: "other", tier: "Bronze I" },
    tags,
    createdAt: at,
    views: 1,
    upvotes: 0,
  });
  await page.addInitScript(
    (value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    },
    {
      posts: [
        post("t-1", "그리디 질문", ["greedy", "dp"], "2026-10-03T00:00:00Z"),
        post("t-2", "다이나믹 질문", ["dp"], "2026-10-02T00:00:00Z"),
        post("t-3", "태그 없는 질문", [], "2026-10-01T00:00:00Z"),
      ],
      answers: [],
      upvoted: [],
      saved: [],
      followed: [],
      accepted: {},
      deleted: [],
    },
  );
  await page.goto("/community?q=");
  const search = page.getByRole("searchbox", { name: "게시글 검색" });
  const rows = page.locator(".post-row .post-title");
  const pills = page.locator(".search-tag");

  // 일반 검색어는 제목에서만 찾는다: 태그에만 있는 단어('greedy')나 본문에만 있는 단어는 걸리지 않는다.
  await search.fill("greedy");
  await expect(rows).toHaveCount(0);
  await search.fill("본문");
  await expect(rows).toHaveCount(0);
  await search.fill("그리디");
  await expect(rows).toHaveCount(1);
  await search.fill("");
  await expect(rows).toHaveCount(3);

  // 공백이 있는 태그도 한 개로 보존한다.
  await search.fill("#dp 질문");
  await search.press("Enter");
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toHaveText("#dp 질문");
  await page.getByRole("button", { name: "태그 #dp 질문 지우기" }).click();
  await expect(pills).toHaveCount(0);

  // '#' 만으로는 태그가 되지 않는다.
  await search.fill("#");
  await search.press("Enter");
  await expect(pills).toHaveCount(0);

  await search.fill("#dp");
  await search.press("Enter");
  await expect(pills).toHaveCount(1);
  await expect(pills.first()).toHaveText("#dp");
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/[?&]tag=dp/);
  await expect(rows.filter({ hasText: "태그 없는 질문" })).toHaveCount(0);
  await expect(rows).toHaveCount(2);

  // 태그를 하나 더 고르면 두 태그를 모두 가진 글만 남는다. 같은 태그는 중복되지 않는다.
  await search.fill("#GREEDY");
  await search.press("Enter");
  await search.fill("#dp");
  await search.press("Enter");
  await expect(pills).toHaveCount(2);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveText("그리디 질문");

  // 입력칸이 비어 있을 때 Backspace로 마지막 태그를 지운다.
  await search.press("Backspace");
  await expect(pills).toHaveCount(1);
  await expect(rows).toHaveCount(2);

  // × 버튼으로도 지울 수 있다.
  await page.getByRole("button", { name: "태그 #dp 지우기" }).click();
  await expect(pills).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]tag=/);
});

test("the write page puts tags and a narrow category on one row and the save hint with the buttons on one line", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community/new");
  // 글꼴이 다 불러와져 줄 높이가 안정된 뒤에 위치를 잰다(전체 테스트를 함께 돌릴 때 간헐적으로 어긋나던 것을 막는다).
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".tag-input")).toBeVisible();
  await expect(page.locator(".field-category .select-button")).toBeVisible();
  const box = async (selector: string) =>
    (await page.locator(selector).first().boundingBox())!;
  const tag = await box(".tag-input");
  const category = await box(".field-category .select-button");
  // 같은 행: 세로 위치(상·하)가 같고, 카테고리는 태그 오른쪽에서 훨씬 좁다.
  expect(Math.abs(tag.y - category.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(tag.height - category.height)).toBeLessThanOrEqual(2);
  expect(category.x).toBeGreaterThan(tag.x + tag.width);
  expect(category.width).toBeLessThan(tag.width / 3);

  // 임시 저장 안내와 취소·임시 저장·글 등록 버튼은 한 줄에서 세로 가운데가 같다.
  const centerY = async (selector: string) => {
    const b = await box(selector);
    return b.y + b.height / 2;
  };
  const hint = await centerY(".write-hint");
  for (const name of ["취소", "임시 저장", "글 등록"]) {
    const b = (await page
      .getByRole("button", { name, exact: true })
      .last()
      .boundingBox())!;
    expect(Math.abs(b.y + b.height / 2 - hint)).toBeLessThanOrEqual(2);
  }
});

test("the write page shows field problems while typing like sign-up, has a tall body and a markdown preview", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/community/new");
  const title = page.locator('input[placeholder^="예:"]');
  const body = page.locator("#body-input");
  const tagInput = page.locator("#tag-input");

  // 본문 칸은 기본으로 크다.
  expect((await body.boundingBox())!.height).toBeGreaterThanOrEqual(450);

  // 건드리기 전에는 안내가 없고, 비운 채 떠나면 안내가 뜬다(회원가입과 같은 방식).
  await expect(page.getByText("제목을 입력해 주세요.")).toHaveCount(0);
  await title.focus();
  await title.blur();
  await expect(page.getByText("제목을 입력해 주세요.")).toBeVisible();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  await title.fill("제목");
  await expect(page.getByText("제목을 입력해 주세요.")).toHaveCount(0);

  // 태그가 20자를 넘으면 안내하고 등록하지 않는다.
  await tagInput.fill("a".repeat(21));
  await expect(page.getByText("태그는 20자 이하로 입력해 주세요.")).toBeVisible();
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(0);
  await tagInput.fill("dp");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveCount(1);

  // 필수인 본문을 비운 채 등록하면 안내가 뜨고 본문으로 이동한다.
  await page.getByRole("button", { name: "글 등록" }).click();
  await expect(page.getByText("본문을 입력해 주세요.")).toBeVisible();
  await expect(body).toBeFocused();

  // 미리보기: 코드 블록과 굵은 글씨가 글 상세와 같은 방식으로 그려진다.
  await body.fill("설명 **굵게** 와 *기울임*\n\n```js\nconst a = 1;\n```\n");
  await expect(page.getByText("본문을 입력해 주세요.")).toHaveCount(0);
  await page.getByRole("tab", { name: "미리보기" }).click();
  const preview = page.locator(".write-body-preview .markdown");
  await expect(preview.locator("strong")).toHaveText("굵게");
  // 기울임: 글꼴에 이탤릭이 없어도 비스듬히 그려지도록 합성을 허용한다(전역 설정은 none).
  await expect(preview.locator("em")).toHaveCount(1);
  await expect(preview.locator("em")).toHaveCSS("font-synthesis", /style/);
  await expect(preview.locator("pre code")).toContainText("const a = 1;");
  await page.getByRole("tab", { name: "작성" }).click();
  await expect(body).toHaveValue(/const a = 1;/);
});

test("community list: the vote and view columns are right-aligned like the problem list", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(
    (value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    },
    {
      posts: [
        {
          id: "c-1",
          category: "question",
          title: "정렬 확인",
          body: "본문",
          author: { name: "other", tier: "Bronze I" },
          tags: [],
          createdAt: "2026-10-03T00:00:00Z",
          views: 1234,
          upvotes: 5,
        },
      ],
      answers: [],
      upvoted: [],
      saved: [],
      followed: [],
      accepted: {},
      deleted: [],
    },
  );
  await page.goto("/community?q=%EC%A0%95%EB%A0%AC");
  await expect(page.locator(".post-row")).toHaveCount(1);
  // 글자(범위) 기준으로 목록 오른쪽 끝에서 얼마나 떨어졌는지 잰다.
  const gap = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const list = document
          .querySelector(".list-posts")!
          .getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(element);
        return Math.round(list.right - range.getBoundingClientRect().right);
      });
  // 마지막 열(조회 수)은 안쪽 여백(24px + 테두리 1px)에 닿고, 머리글과 값의 오른쪽 끝이 같다.
  expect(await gap(".post-head span:last-child")).toBeLessThanOrEqual(26);
  expect(await gap(".post-row .post-num-view")).toBeLessThanOrEqual(26);
  // 추천 열도 머리글과 값의 오른쪽 끝이 같다(열 폭 72px 안에서 오른쪽에 붙는다).
  const headVote = await gap(".post-head span:nth-child(3)");
  const rowVote = await gap(".post-row .post-num-up");
  expect(Math.abs(headVote - rowVote)).toBeLessThanOrEqual(2);
});

test("write page tags: commas and spaces stay inside one tag, a full list locks the input, a lone # is dropped, an emptied form forgets its draft", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/community/new");
  const tagInput = page.locator("#tag-input");
  const title = page.locator('input[placeholder^="예:"]');

  // 쉼표와 공백도 태그의 일부이며 Enter로 확정한다. 대소문자만 다른 태그는 다시 넣지 않는다.
  await tagInput.fill("a,b");
  await tagInput.press("Enter");
  await tagInput.fill("#dynamic programming");
  await tagInput.press("Enter");
  await tagInput.fill("A,B");
  await tagInput.press("Enter");
  await expect(page.locator(".tag-chip")).toHaveText([
    "#a,b✕",
    "#dynamic programming✕",
  ]);
  await expect(tagInput).toHaveValue("");

  // 최대 개수(5개)를 채우면 입력 칸이 잠긴다.
  for (const tag of ["c", "d", "e"]) {
    await tagInput.fill(tag);
    await tagInput.press("Enter");
  }
  await expect(page.locator(".tag-chip")).toHaveCount(5);
  await expect(tagInput).toBeDisabled();
  for (let remaining = 5; remaining > 3; remaining -= 1) {
    await page.locator(".tag-chip button").last().click();
    await expect(page.locator(".tag-chip")).toHaveCount(remaining - 1);
  }

  // '#'만 입력하고 떠나면 입력 칸이 비워진다(안내 없이 남아 있지 않는다).
  await tagInput.fill("#");
  await title.click();
  await expect(tagInput).toHaveValue("");

  // 입력을 전부 지우면 이전에 자동 저장된 초안이 다시 살아나지 않는다.
  await title.fill("임시 저장될 제목");
  await expect(page.getByText(/임시 저장됨/)).toBeVisible({ timeout: 5000 });
  // 제목을 지우기 전에 칩을 먼저 지운다(제목 칸을 떠나는 순간 오류 문구가 생겨 레이아웃이 밀리기 때문).
  for (let remaining = 3; remaining > 0; remaining -= 1) {
    await page.locator(".tag-chip button").first().click();
    await expect(page.locator(".tag-chip")).toHaveCount(remaining - 1);
  }
  await title.fill("");
  await expect(page.getByText(/임시 저장됨/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toHaveCount(0);
  await expect(title).toHaveValue("");
});

test("saving an empty form keeps a consistent state: the draft is not wiped on the next visit", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/community/new");
  // 빈 폼에서 임시 저장을 눌러도 안내와 저장 상태가 어긋나지 않는다(다음 방문에서 초안이 조용히 지워지지 않는다).
  await page.getByRole("button", { name: "임시 저장", exact: true }).click();
  await expect(page.getByText(/임시 저장됨/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("작성 중이던 초안을 불러왔어요.")).toBeVisible();
  await expect(page.getByText(/임시 저장됨/)).toBeVisible();
  const stored = await page.evaluate(() =>
    localStorage.getItem("unsolvable-oj-community-draft-v2:solver:new"),
  );
  expect(stored).not.toBeNull();
});

test("filter toggles allow ⌘/Ctrl+click multi-select within one group only", async ({
  page,
}) => {
  // 샘플 글이 없는 환경에서도 같은 결과가 나오도록 이 테스트가 쓸 글을 저장소에 직접 넣어 둔다.
  const author = { name: "tester", tier: "브론즈" };
  const post = (
    id: string,
    category: string,
    title: string,
    pinned = false,
  ) => ({
    id,
    category,
    title,
    body: "본문",
    tags: [],
    author,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 1,
    views: 10,
    ...(pinned ? { pinned: true } : {}),
  });
  await page.addInitScript(
    (posts) => {
      localStorage.setItem(
        "unsolvable-oj-community-v1",
        JSON.stringify({
          posts,
          answers: [],
          upvoted: [],
          saved: [],
          followed: [],
          accepted: {},
        }),
      );
    },
    [
      post("t-notice", "notice", "고정 공지", true),
      post("t-q1", "question", "질문 하나"),
      post("t-q2", "question", "질문 둘"),
      post("t-f1", "free", "자유 글"),
      post("t-s1", "solution", "풀이 공유 글"),
    ],
  );
  await page.goto("/community");
  const category = page.getByRole("group", { name: "분류 필터" });
  const status = page.getByRole("group", { name: "채택 상태 필터" });
  const modifier = { modifiers: ["ControlOrMeta" as const] };

  await category.getByRole("button", { name: /^질문/ }).click(modifier);
  await category.getByRole("button", { name: /^자유/ }).click(modifier);
  await expect(page).toHaveURL(/c=question%2Cfree/);
  const labels = await page
    .locator(".post-row:not(.pinned) .post-category")
    .allTextContents();
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.every((text) => text === "질문" || text === "자유")).toBe(true);
  await expect(category.getByRole("button", { name: /^질문/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(category.getByRole("button", { name: /^자유/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(category.getByRole("button", { name: /^전체/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // 다른 종류(상태) 필터는 영향을 받지 않는다
  await status.getByRole("button", { name: /^채택 완료/ }).click();
  await expect(page).toHaveURL(/s=accepted/);
  await expect(page).toHaveURL(/c=question%2Cfree/);

  // 평범한 클릭은 그 하나만 선택하고, ⌘/Ctrl+클릭으로 다시 누르면 해제된다
  await category.getByRole("button", { name: /^질문/ }).click(modifier);
  await expect(page).toHaveURL(/c=free(&|$)/);
  await category.getByRole("button", { name: /^공지/ }).click();
  await expect(page).toHaveURL(/c=notice/);
  await expect(category.getByRole("button", { name: /^자유/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  // '전체'는 수정자 키를 무시한다
  await category.getByRole("button", { name: /^전체/ }).click(modifier);
  await expect(page).not.toHaveURL(/c=/);
  await expect(page).toHaveURL(/s=accepted/);
});

test("opening a post from a scrolled community list starts at the top", async ({
  page,
}) => {
  const author = { name: "tester", tier: "브론즈" };
  const posts = Array.from({ length: 8 }, (_, index) => ({
    id: `scroll-${index}`,
    category: "free",
    title: `스크롤 확인 글 ${index}`,
    body: "본문",
    tags: [],
    author,
    createdAt: `2030-01-0${index + 1}T00:00:00Z`,
    upvotes: 0,
    views: 1,
  }));
  await page.addInitScript((value) => {
    localStorage.setItem(
      "unsolvable-oj-community-v1",
      JSON.stringify({
        posts: value,
        answers: [],
        upvoted: [],
        saved: [],
        followed: [],
        accepted: {},
        deleted: [],
      }),
    );
  }, posts);
  await page.setViewportSize({ width: 1280, height: 420 });
  await page.goto("/community");
  const target = page.getByRole("link", { name: /스크롤 확인 글 7/ });
  await expect(target).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
  await target.click();
  await expect(page).toHaveURL(/\/community\/scroll-7$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe("community post: delete own post and answer layout", () => {
  const author = { name: "solver", tier: "Bronze I" };
  const other = { name: "다른사람", tier: "Bronze I" };
  const mk = (id: string, title: string, who: typeof author) => ({
    id,
    category: "question",
    title,
    body: "본문 내용입니다",
    tags: [],
    author: who,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 0,
    views: 3,
  });
  const seedStore = {
    posts: [
      mk("mine-1", "내가 쓴 글", author),
      mk("other-1", "남이 쓴 글", other),
    ],
    answers: [
      {
        id: "a-1",
        postId: "mine-1",
        author: other,
        body: "첫 답변입니다",
        createdAt: "2026-10-02T00:00:00Z",
        upvotes: 0,
      },
    ],
    upvoted: [],
    saved: [],
    followed: [],
    accepted: {},
    deleted: [],
  };

  test("the answer editor and the answer list are separate cards, editor first, with no separate write-answer button", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    }, seedStore);
    await page.goto("/community/other-1");
    await expect(
      page.getByRole("button", { name: "답변 작성", exact: true }),
    ).toHaveCount(0);
    const writeCard = page.locator(".answer-write-card");
    const listCard = page.locator(".answers-card");
    await expect(writeCard.locator(".answer-editor")).toBeVisible();
    await expect(listCard.locator(".answer-editor")).toHaveCount(0);
    const writeTop = (await writeCard.boundingBox())!.y;
    const listTop = (await listCard.boundingBox())!.y;
    expect(writeTop).toBeLessThan(listTop);
    // 남의 글에는 글 관리(⋮) 메뉴가 없다
    await expect(page.getByRole("button", { name: "글 관리" })).toHaveCount(0);
    // 조회수는 아이콘과 숫자로 보인다
    await expect(page.getByLabel("조회 3")).toBeVisible();
  });

  test("the author can delete their own post and it disappears from the list", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      if (!localStorage.getItem("unsolvable-oj-community-v1"))
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify(value),
        );
    }, seedStore);
    await page.goto("/community/mine-1");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();
    await expect(
      page.getByRole("heading", { name: "내가 쓴 글" }),
    ).toBeVisible();

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "글 관리" }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();
    await expect(page).toHaveURL(/\/community$/);
    await expect(page.getByText("글을 삭제했어요.")).toBeVisible();
    // 샘플 글이 있는 환경에서는 목록이 여러 쪽이라, 검색으로 두 글의 상태를 확인한다.
    await page.goto(`/community?q=${encodeURIComponent("쓴 글")}`);
    await expect(page.getByText("남이 쓴 글")).toBeVisible();
    await expect(page.getByText("내가 쓴 글")).toHaveCount(0);
    await page.goto("/community/mine-1");
    await expect(page.getByText("글을 찾을 수 없어요.")).toBeVisible();
  });

  test("author info and the follow button sit in the post header, not in a separate side card", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      localStorage.setItem("unsolvable-oj-community-v1", JSON.stringify(value));
    }, seedStore);
    await page.goto("/community/other-1");
    const header = page.locator(".post-byline");
    await expect(header).toContainText("다른사람");
    await expect(header).toContainText("채택 답변 0");
    await expect(header).toContainText("작성 글 1");
    await expect(page.locator(".author-card")).toHaveCount(0);
    const follow = header.getByRole("button", { name: "+ 팔로우" });
    await follow.click();
    await expect(
      header.getByRole("button", { name: "✓ 팔로잉" }),
    ).toHaveAttribute("aria-pressed", "true");
    // 내 글에는 팔로우 버튼이 없다
    await page.goto("/community/mine-1");
    await expect(page.locator(".post-byline")).toContainText("solver");
    await expect(page.getByRole("button", { name: /팔로/ })).toHaveCount(0);
  });

  test("the author edits their own post from the ⋮ menu; the menu closes with Esc", async ({
    page,
  }) => {
    await authenticate(page);
    await page.addInitScript((value) => {
      if (!localStorage.getItem("unsolvable-oj-community-v1"))
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify(value),
        );
    }, seedStore);
    await page.goto("/community/mine-1");
    const trigger = page.getByRole("button", { name: "글 관리" });
    await trigger.click();
    await expect(page.getByRole("menuitem", { name: "수정" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await trigger.click();
    await page.getByRole("menuitem", { name: "수정" }).click();
    await expect(page).toHaveURL(/\/community\/mine-1\/edit$/);
    await expect(page.getByLabel(/^제목/)).toHaveValue("내가 쓴 글");
    await page.getByLabel(/^제목/).fill("고친 제목");
    await page.getByRole("button", { name: "수정 저장" }).click();
    await expect(page).toHaveURL(/\/community\/mine-1$/);
    await expect(page.getByText("글을 수정했어요.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "고친 제목" }),
    ).toBeVisible();
  });
});

test.describe("community filter counts include pinned notices where they belong", () => {
  // 배포용 저장소에는 화면 구동용 샘플 글이 섞이므로, 이 테스트가 넣은 글만 걸러 보도록 제목에 "ZZ"를 붙이고 검색한다.
  const author = { name: "tester", tier: "브론즈" };
  const post = (
    id: string,
    category: string,
    title: string,
    pinned = false,
  ) => ({
    id,
    category,
    title,
    body: "본문",
    tags: [] as string[],
    author,
    createdAt: "2026-10-01T00:00:00Z",
    upvotes: 1,
    views: 10,
    ...(pinned ? { pinned: true } : {}),
  });
  const open = async (page: import("@playwright/test").Page, query = "ZZ") => {
    await page.addInitScript(
      (posts) =>
        localStorage.setItem(
          "unsolvable-oj-community-v1",
          JSON.stringify({
            posts,
            answers: [],
            upvoted: [],
            saved: [],
            followed: [],
            accepted: {},
            deleted: [],
          }),
        ),
      [
        post("n-1", "notice", "ZZ고정 공지", true),
        post("n-2", "notice", "ZZ일반 공지"),
        post("q-1", "question", "ZZ질문 하나"),
        post("q-2", "question", "ZZ질문 둘"),
        post("f-1", "free", "ZZ자유 글"),
      ],
    );
    await page.goto(`/community?q=${encodeURIComponent(query)}`);
  };
  const count = async (
    page: import("@playwright/test").Page,
    group: string,
    name: RegExp,
  ) => {
    const text =
      (await page
        .getByRole("group", { name: group })
        .getByRole("button", { name })
        .textContent()) ?? "";
    return Number(text.replace(/\D/g, ""));
  };
  const total = (page: import("@playwright/test").Page) =>
    page.locator(".total-count");

  test("the notice chip counts the pinned notice, the all chip and total match, other chips do not", async ({
    page,
  }) => {
    await open(page);
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2); // 고정 1 + 일반 1
    await expect.poll(() => count(page, "분류 필터", /^질문/)).toBe(2);
    await expect.poll(() => count(page, "분류 필터", /^자유/)).toBe(1);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(5);
    await expect(total(page)).toHaveText("1 - 5/5");

    // 질문만 고르면 공지 칩 개수는 그대로이고(칩은 눌렀을 때의 결과 수), 목록 머리글은 실제로 나열된 줄(질문 2 + 항상 보이는 고정 공지 1)을 센다
    await page
      .getByRole("group", { name: "분류 필터" })
      .getByRole("button", { name: /^질문/ })
      .click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2);
    await expect(total(page)).toHaveText("1 - 3/3");
    // 고정 공지는 그대로 목록 맨 위에 보인다
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);
  });

  test("the pinned notice follows keyword searches in the counts", async ({
    page,
  }) => {
    await open(page, "ZZ고정");
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(1);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(1);
    await expect(total(page)).toHaveText("1 - 1/1");
    // 아무 글도 맞지 않는 검색어(이모지 포함): 모든 개수가 0
    await page.goto("/community?q=ZZzzzzzz%F0%9F%98%80");
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(0);
    await expect.poll(() => count(page, "분류 필터", /^전체/)).toBe(0);
    await expect(total(page)).toHaveText("0/0");
  });

  test("notices count as not accepted in the status chips, and the pinned one stays visible under every status", async ({
    page,
  }) => {
    await open(page);
    const status = (name: RegExp) => count(page, "채택 상태 필터", name);
    // 필터를 걸기 전: 공지도 글이므로 전체에 들어가고, 채택된 답변이 없으니 "채택 전"에 들어간다
    await expect.poll(() => status(/^전체/)).toBe(5);
    await expect.poll(() => status(/^채택 전/)).toBe(5);
    await expect.poll(() => status(/^채택 완료/)).toBe(0);

    const statusGroup = page.getByRole("group", { name: "채택 상태 필터" });
    await statusGroup.getByRole("button", { name: /^채택 전/ }).click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(2);
    await expect(total(page)).toHaveText("1 - 5/5");
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);

    // 채택 완료만 고르면 맞는 글이 없어 칩 개수는 0이지만, 고정 공지는 여전히 맨 위에 보이므로 머리글은 그 한 줄을 센다
    await statusGroup.getByRole("button", { name: /^채택 완료/ }).click();
    await expect.poll(() => count(page, "분류 필터", /^공지/)).toBe(0);
    await expect(total(page)).toHaveText("1 - 1/1");
    await expect(page.locator(".post-row.pinned")).toHaveCount(1);
  });
});

test("an odd page number in the address never shifts the list off a page boundary, and the range has a spoken form", async ({
  page,
}) => {
  await authenticate(page);
  const posts = Array.from({ length: 16 }, (_, index) => ({
    id: `o-${index}`,
    category: "free",
    title: `ZZ홀수 ${index}`,
    body: "본문",
    tags: [] as string[],
    author: { name: "tester", tier: "브론즈" },
    createdAt: `2026-10-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
    upvotes: 0,
    views: 1,
  }));
  await page.addInitScript((value) => {
    localStorage.setItem(
      "unsolvable-oj-community-v1",
      JSON.stringify({
        posts: value,
        answers: [],
        upvoted: [],
        saved: [],
        followed: [],
        accepted: {},
        deleted: [],
      }),
    );
  }, posts);
  const label = page.locator(".total-count");
  // 소수·0·음수·글자·아주 큰 수: 어느 쪽이든 쪽 경계에 맞는 범위가 나온다
  const expected: Record<string, string> = {
    "1.5": "1 - 10/16",
    "2.9": "11 - 16/16",
    "0": "1 - 10/16",
    "-3": "1 - 10/16",
    abc: "1 - 10/16",
    "99": "11 - 16/16",
    "1e9": "11 - 16/16",
  };
  for (const [value, text] of Object.entries(expected)) {
    await page.goto(`/community?q=ZZ&page=${encodeURIComponent(value)}`);
    await expect(label, `page=${value}`).toHaveText(text);
  }
  // 보이는 글씨는 스크린리더에서 가리고, 풀어쓴 문장을 따로 읽어 준다("1 빼기 10 슬래시 16"로 읽히지 않게)
  await page.goto("/community?q=ZZ");
  await expect(label).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".total-count + .sr-only")).toHaveText(
    "전체 16개 중 1번부터 10번째까지",
  );
  await page.goto("/community?q=ZZzzzzzz%F0%9F%98%80");
  await expect(page.locator(".total-count + .sr-only")).toHaveText(
    "표시할 항목이 없어요",
  );
});
