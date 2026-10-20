import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";

test("real signup, publication, judging, XP and logout through nginx", async ({ page }) => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `browser-${suffix}@example.com`;
  const password = `browser-${randomUUID()}`;
  const slug = `browser-${suffix}`;
  const title = `브라우저 검증 ${suffix}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/auth");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("사용자 이름").fill(`browser_${suffix}`);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();

  // Use the real operator CLI only inside the disposable Compose project.
  await promisify(execFile)("docker", [
    "compose", "--project-name", process.env.COMPOSE_PROJECT_NAME!,
    "exec", "-T", "back", "node", "scripts/bootstrap-admin.mjs", email,
  ]);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.goto("/auth");
  await page.getByLabel("이메일").fill(email);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("link", { name: "문제 만들기", exact: true })).toBeVisible();
  await page.goto("/problems/new");
  await page.getByLabel("제목", { exact: true }).fill(title);
  const available = page.waitForResponse((response) => response.url().endsWith(`/problems/by-slug/${slug}`));
  await page.getByLabel("주소용 slug").fill(slug);
  await page.getByLabel("문제 본문 (Markdown)").fill("두 정수를 더하세요.");
  await page.getByLabel("입력 설명").fill("두 정수 a, b");
  await page.getByLabel("출력 설명").fill("a + b");
  await page.getByLabel("입력", { exact: true }).fill("1 2");
  await page.getByLabel("기대 출력").fill("3");
  await page.getByRole("button", { name: "+ 숨김 케이스 추가", exact: true }).click();
  await page.getByRole("textbox", { name: "입력", exact: true }).nth(1).fill("5 7");
  await page.getByRole("textbox", { name: "기대 출력", exact: true }).nth(1).fill("12");
  expect((await available).status()).toBe(404);
  await page.getByRole("button", { name: "문제 게시하기 →" }).click();
  await expect(page).toHaveURL(new RegExp(`/problems/view/${slug}$`));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "언어", exact: true }).click();
  await page.getByRole("option", { name: "Python 3", exact: true }).click();
  await page.getByLabel("소스 코드").fill("print(sum(map(int,input().split())))");
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  const panel = page.getByRole("region", { name: "채점 결과", exact: true });
  await expect(panel.getByRole("status")).toHaveText("성공", { timeout: 30_000 });
  await expect(page.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(page.locator(".case-result")).toHaveCount(1);
  await expect(page.locator(".case-result")).not.toContainText("5 7");
  await panel.getByRole("link", { name: "자세히 보기" }).click();
  await expect(page).toHaveURL(/\/submissions\/[a-f0-9-]+$/);
  await page.reload();
  await expect(page.getByText("성공", { exact: true })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByText("10 / 100 XP", { exact: false })).toBeVisible();
  await expect(page.locator(".profile-stats")).toContainText("해결한 문제");
  await page.goto(`/problems/view/${slug}`);
  await page.getByLabel("소스 코드").fill("print(0)");
  const wrongRequest = page.waitForRequest((request) =>
    request.method() === "POST" && new URL(request.url()).pathname.endsWith("/submissions"),
  );
  await page.getByRole("button", { name: "제출하고 채점하기 →" }).click();
  expect((await wrongRequest).postDataJSON()).toEqual({ language: "PYTHON", sourceCode: "print(0)" });
  try {
    await expect(panel.getByRole("status")).toHaveText("틀림", { timeout: 30_000 });
  } catch (error) {
    // Only this disposable test's public outputs; never dump sessions or request headers.
    console.error("Actual judging details:", await panel.innerText());
    throw error;
  }
  await page.goto(`/problems?q=${slug}`);
  const row = page.getByRole("link").filter({ hasText: title });
  await expect(row).toContainText("1명");
  await expect(row).toContainText("50%");
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/submissions");
  await expect(page).toHaveURL(/\/auth$/);
  expect(errors).toEqual([]);
});
