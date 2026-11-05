import { expect, test } from "@playwright/test";
import { authenticate, mockProblemApi, problem, session } from "./fixtures";

test.beforeEach(({ page }) => mockProblemApi(page));

test("the home illustration shows the level badge only for a signed-in user, with their own level and XP", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".brand-art").first()).toBeAttached();
  await expect(page.locator(".brand-art text")).toHaveCount(0);

  await authenticate(page);
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: {
        ...session.user,
        level: 4,
        xp: 372,
        createdAt: "2026-09-01T00:00:00Z",
        solvedCount: 5,
      },
    }),
  );
  await page.route("**/api/v1/rankings", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.goto("/");
  const badge = page.locator(".brand-art");
  await expect(badge.getByText("Lv.4")).toBeAttached();
  await expect(badge.getByText("372 XP")).toBeAttached();
});

test("home and profile do not show the never-computed rating", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/v1/users/me", (route) =>
    route.fulfill({
      json: { ...session.user, createdAt: "2026-09-01T00:00:00Z", solvedCount: 0 },
    }),
  );
  await page.route("**/api/v1/rankings", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/submissions?**", (route) =>
    route.fulfill({ json: { items: [], page: 1, limit: 100, total: 0, totalPages: 1 } }),
  );
  await page.goto("/");
  await expect(page.locator(".stat-tile")).toHaveCount(4);
  await expect(page.locator(".stat-tiles")).not.toContainText("레이팅");
  await expect(page.locator(".stat-tile").last()).toContainText("제출0회");
  await page.goto("/profile");
  await expect(page.locator(".profile-stats")).toContainText("해결한 문제");
  await expect(page.locator(".profile-stats")).not.toContainText("레이팅");
});

test("the home problem slider stays inside the page container and fades only on the side that has more cards", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1400 });
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 12,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/");
  const area = page.locator(".slider-area");
  const track = page.locator(".slider-track");
  await expect(track.locator(".problem-card").first()).toBeVisible();

  // 트랙은 화면 끝까지 퍼지지 않고, 위·아래 카드와 같은 컨테이너 폭에 머문다.
  const areaBox = (await area.boundingBox())!;
  const trackBox = (await track.boundingBox())!;
  expect(Math.abs(trackBox.x - areaBox.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(trackBox.width - areaBox.width)).toBeLessThanOrEqual(1);
  expect(trackBox.width).toBeLessThan(1440 - 100);

  // 처음에는 오른쪽만(더 볼 카드가 있는 쪽), 중간에서는 양쪽, 끝에서는 왼쪽만 흐려진다.
  await expect(area).toHaveClass(/can-forward/);
  await expect(area).not.toHaveClass(/can-back/);
  await track.evaluate((el) => {
    el.scrollLeft = el.scrollWidth / 3;
  });
  await expect(area).toHaveClass(/can-back/);
  await expect(area).toHaveClass(/can-forward/);
  await track.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(area).toHaveClass(/can-back/);
  await expect(area).not.toHaveClass(/can-forward/);
});

test("the collapsed menu opens as a full-width panel right under the header on narrow screens", async ({
  page,
}) => {
  await authenticate(page, "AUTHOR");
  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/");
    const nav = page.locator("#main-menu");
    await expect(nav).toBeHidden();
    await page.getByRole("button", { name: /메뉴/ }).first().click();
    await expect(nav).toBeVisible();
    const header = (await page.locator(".site-header").boundingBox())!;
    const box = (await nav.boundingBox())!;
    // 헤더 줄에 끼지 않고, 헤더 바로 아래에서 화면 전체 폭으로 펼쳐진다.
    expect(Math.abs(box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.width - width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(2);
    await expect(nav).toHaveCSS("position", "absolute");
    // 항목은 한 줄에 하나씩 쌓인다.
    const links = nav.locator("a");
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(7);
    let previousBottom = -1;
    for (let index = 0; index < count; index += 1) {
      const link = (await links.nth(index).boundingBox())!;
      expect(link.y).toBeGreaterThanOrEqual(previousBottom - 1);
      expect(link.width).toBeGreaterThan(width * 0.8);
      previousBottom = link.y + link.height;
    }
  }
});

test("the home slider shows a visible keyboard focus ring (the fade mask must not clip it)", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 8 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 8,
        totalPages: 1,
      },
    }),
  );
  await page.goto("/");
  const area = page.locator(".slider-area");
  await expect(area.locator(".problem-card").first()).toBeVisible();
  await page.locator(".slider-track").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator(".slider-track")).toBeFocused();
  // 링은 마스크가 없는 바깥 영역(.slider-area)에 그려진다.
  await expect(area).toHaveCSS("outline-style", "solid");
  await expect(area).toHaveCSS("outline-width", "3px");
});

test("only input fields show the text cursor; UI text uses the arrow and controls the pointer", async ({
  page,
}) => {
  await authenticate(page);
  await page.goto("/problems/view/sum");
  const cursorOf = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).cursor);
  const selectOf = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect);

  // 입력칸은 텍스트 커서
  expect(await cursorOf("textarea.code-editor")).toBe("text");
  // 제목·안내 문구는 화살표
  expect(await cursorOf("h1")).toBe("default");
  expect(await cursorOf(".editor-hints")).toBe("default");
  // 누르는 곳은 손가락, 조작용 글자는 드래그 선택이 안 된다
  expect(await cursorOf("button.text-button")).toBe("pointer");
  expect(await selectOf("button.text-button")).toBe("none");
  // 읽고 복사하는 본문은 텍스트 커서와 선택 가능
  expect(await cursorOf(".markdown")).toBe("text");
  expect(await selectOf(".markdown")).not.toBe("none");
  // 입력칸 안의 글은 선택 가능
  expect(await selectOf("textarea.code-editor")).toBe("text");

  await page.goto("/problems");
  expect(await cursorOf(".data-list .problem-title strong")).toBe("pointer");
  // WebKit reports auto on descendants: user-select is not an inherited property.
  expect(await selectOf(".data-list")).toBe("none");
  expect(await cursorOf(".total-count")).toBe("default");
});

test("the home problem slider does not snap cards into place after scrolling", async ({
  page,
}) => {
  await authenticate(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(/\/api\/v1\/problems(\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 12 }, (_, index) => ({
          ...problem,
          id: `p-${index}`,
          slug: `p-${index}`,
          title: `문제 ${index + 1}`,
        })),
        page: 1,
        limit: 100,
        total: 12,
        totalPages: 1,
      },
    }),
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    const track = page.locator(".slider-track");
    await expect(track.locator(".problem-card").first()).toBeVisible();
    // 위치 맞춤 규칙이 트랙에도 카드에도 없다
    const rules = await track.evaluate((el) => {
      const card = el.querySelector(".problem-card")!;
      return {
        type: getComputedStyle(el).scrollSnapType,
        align: getComputedStyle(card).scrollSnapAlign,
      };
    });
    expect(rules.type).toBe("none");
    expect(rules.align).toBe("none");
    // 카드 경계가 아닌 곳에 멈추면 그 자리에 그대로 있다(카드 시작 위치로 되돌려지지 않는다)
    for (const target of [37, 150, 301, 500]) {
      await track.evaluate((el, left) => {
        el.scrollLeft = left;
      }, target);
      await page.waitForTimeout(400);
      expect(
        Math.abs((await track.evaluate((el) => el.scrollLeft)) - target),
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("keyboard users can skip the header to the main content", async ({ page }) => {
  await page.goto("/problems");
  // WebKit은 기본 설정에서 Tab이 링크에 멈추지 않아 포커스를 직접 준다.
  const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
  await expect(skip).not.toBeInViewport();
  await skip.focus();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});
