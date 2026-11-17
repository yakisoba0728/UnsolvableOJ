import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test, type Page } from "@playwright/test";
import type { VibeAttempt, VibeCatalog } from "../src/vibe/types";

// Real registration/session traffic must not enter a retained network trace.
// This spec writes only the sanitized receipt and result-region screenshot.
test.use({ trace: "off" });

let admissionWaitMs = 0;
test.beforeAll(async () => {
  // The other three real flows use five registrations/minute. Preserve that
  // public limit and wait for its window; do not mutate Redis or spoof an IP.
  const started = performance.now();
  const deadline = started + 61_000;
  while (performance.now() < deadline) await delay(Math.min(1000, deadline - performance.now()));
  admissionWaitMs = performance.now() - started;
});

test("real Vibe new-tab editing, nginx mTLS native grading and persisted private result", async ({ page }, testInfo) => {
  const started = performance.now();
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const checkout = git("rev-parse", "HEAD");
  const event = process.env.GITHUB_EVENT_PATH
    ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8")) as { pull_request?: { head?: { sha?: string }; base?: { sha?: string } } }
    : undefined;
  const receiptPath = process.env.LIVE_VIBE_GATEWAY_RECEIPT ?? "";
  expect(basename(receiptPath)).toBe("gateway-receipt.json");
  expect(basename(dirname(receiptPath))).toMatch(/^unsolvable-e2e-[a-f0-9]{12}-/);
  const gateway = JSON.parse(await readFile(receiptPath, "utf8"));
  expect(gateway.status).toBe("PREFLIGHT_PASS");
  expect(gateway.started).toBe(true);
  expect(gateway.fixture.mode).toBe("dedicated");
  expect(gateway.fixture.applicationSandboxNetwork).toBe(false);
  expect(gateway.probes.positive.status).toBe(200);
  const report: Record<string, unknown> = {
    schemaVersion: 1, status: "FAIL", startedAt: new Date().toISOString(),
    source: { checkout, tree: git("rev-parse", "HEAD^{tree}"),
      sourceHead: event?.pull_request?.head?.sha ?? checkout, base: event?.pull_request?.base?.sha ?? null,
      workflowRunId: process.env.GITHUB_RUN_ID ?? null, workflowAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      trackedTreeClean: git("status", "--porcelain", "--untracked-files=no") === "" },
    environment: { browser: page.context().browser()?.browserType().name(), version: page.context().browser()?.version() },
    protocol: { admissionWaitMs, mainTestTimeoutMs: testInfo.timeout, publicRuns: 1, finalSubmissions: 1,
      registrations: 2, paidProviderCalls: 0, browserApiMocks: 0 },
    gateway,
    limitations: ["Owned same-host disposable Compose fixture; no production host, firewall, certificate rotation or provider-quality certification.",
      "Existing algorithm native sandbox is reused sequentially; its token is a synthetic shared fixture capability, not a recommended production credential arrangement.",
      "No long-duration editor-memory or field INP result is collected; the finite deadline is reserved for the real end-to-end chain."],
  };
  let workspace: Page | undefined;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    await page.goto("/auth");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByLabel("이메일").fill(`vibe-browser-${suffix}@example.invalid`);
    await page.getByLabel("사용자 이름").fill(`vibe_${suffix}`);
    // Reporter API steps can retain fill arguments even with network tracing
    // disabled. Keep this disposable secret wholly inside the browser.
    await page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>("#auth-password");
      if (!input) throw new Error("Registration password input missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
        .call(input, `owned-vibe-${crypto.randomUUID()}`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const registered = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/auth/register");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    const registration = await registered;
    expect(registration.status()).toBe(201);
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();

    const catalogResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/vibe/challenges");
    await page.goto("/vibe");
    const catalog = await catalogResponse;
    expect(catalog.status()).toBe(200);
    expect((await catalog.json() as VibeCatalog).availability).toEqual({ ai: false, runner: true });
    const popup = page.waitForEvent("popup");
    const createdResponse = page.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/vibe/challenges/post-search-v1/attempts");
    await page.locator(".vibe-challenge").filter({ hasText: "게시글 검색 API 개선하기" })
      .getByRole("button", { name: /연습 시작 \/ 이어하기/ }).click();
    workspace = await popup;
    workspace.on("pageerror", error => errors.push(error.message));
    const created = await createdResponse;
    expect(created.status()).toBe(201);
    const attempt = await created.json() as VibeAttempt;
    await expect(workspace).toHaveURL(new RegExp(`/vibe/attempts/${attempt.id}$`));
    await expect(workspace.getByLabel("파트너에게 보낼 메시지")).toBeDisabled();
    const source = `export function searchPosts(posts: {id:number;title:string;slug:string;tags:string[]}[], query='', tag='') {
  const q = query.trim().toLowerCase();
  return posts.filter(post => (post.title.toLowerCase().includes(q) || post.slug.toLowerCase().includes(q)) && (!tag || post.tags.includes(tag)));
}\n`;
    const path = `/api/v1/vibe/attempts/${attempt.id}`;
    const savedResponse = workspace.waitForResponse(response => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === `${path}/files`);
    const editor = workspace.getByRole("textbox", { name: "TypeScript 소스 코드", exact: true });
    await editor.fill(source);
    // Exercise the real editor's normal one-second autosave, without racing it
    // against a manually clicked button that may become disabled after saving.
    const saved = await savedResponse;
    expect(saved.status()).toBe(200);
    const savedAttempt = await saved.json() as VibeAttempt;
    expect(savedAttempt.files["src/search.ts"]).toBe(source);
    await expect(workspace.getByText("서버에 저장됨", { exact: true })).toBeVisible();
    await workspace.getByRole("tab", { name: "src/tags.ts", exact: true }).click();
    await expect(editor).toHaveValue(savedAttempt.files["src/tags.ts"]);
    await workspace.getByRole("tab", { name: "src/search.ts", exact: true }).click();
    await expect(editor).toHaveValue(source);

    const publicResponse = workspace.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `${path}/runs`);
    const publicStarted = performance.now();
    await workspace.getByRole("button", { name: "테스트 실행", exact: true }).click();
    const publicRun = await publicResponse;
    expect(publicRun.status()).toBe(201);
    const ran = await publicRun.json() as VibeAttempt;
    report.publicRunElapsedMs = performance.now() - publicStarted;
    expect(ran.runs).toHaveLength(1);
    expect(ran.runs[0].revision).toBe(savedAttempt.revision);
    expect(ran.runs[0].checks).toHaveLength(6);
    expect(ran.runs[0].checks.every(check => check.passed)).toBe(true);
    await expect(workspace.locator("#vibe-dock-panel .vibe-checks .passed")).toHaveCount(6);
    await expect(workspace.locator("#vibe-dock-panel .vibe-checks .failed")).toHaveCount(0);

    const finalResponse = workspace.waitForResponse(response => response.request().method() === "POST"
      && new URL(response.url()).pathname === `${path}/submit`);
    const finalStarted = performance.now();
    await workspace.getByRole("button", { name: "최종 제출", exact: true }).click();
    await workspace.getByRole("dialog").getByRole("button", { name: "최종 제출", exact: true }).click();
    const final = await finalResponse;
    expect(final.status()).toBe(201);
    const submitted = await final.json() as VibeAttempt;
    report.finalSubmitElapsedMs = performance.now() - finalStarted;
    expect(submitted.report).toMatchObject({ passed: 11, total: 11, outcome: 40, evaluationStatus: "unavailable", prompt: null, process: null });
    expect(submitted.challengeVersion).toBe(attempt.challengeVersion);
    expect(submitted.submittedAt).not.toBeNull();
    expect(/hiddenChecks|assistSystem|reviewSystem|VIBE_SANDBOX_TOKEN/.test(JSON.stringify(submitted))).toBe(false);
    await expect(workspace.getByRole("region", { name: "결과물 채점을 완료했어요." })).toContainText("기능 테스트 11/11개 통과");
    await expect(workspace.getByRole("button", { name: "과정 평가 다시 받기" })).toBeDisabled();
    await workspace.reload();
    const result = workspace.getByRole("region", { name: "결과물 채점을 완료했어요." });
    await expect(result).toContainText("결과물 40/40");
    await expect(result).toContainText("기능 테스트 11/11개 통과");
    await expect(workspace.getByLabel("src/search.ts 코드", { exact: true })).toHaveText(source);
    await expect(workspace.getByRole("region", { name: "코드 작업", exact: true }).getByRole("textbox")).toHaveCount(0);
    const reloaded = await workspace.evaluate(async path => {
      const saved = JSON.parse(localStorage.getItem("unsolvable-oj-session-v1") ?? "null") as
        { session?: { accessToken?: string } } | null;
      const token = saved?.session?.accessToken;
      if (!token) throw new Error("Owned browser session missing");
      const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { status: response.status, report: null, challengeVersion: null };
      const attempt = await response.json() as VibeAttempt;
      return { status: response.status, report: attempt.report, challengeVersion: attempt.challengeVersion };
    }, path);
    expect(reloaded.status).toBe(200);
    expect(reloaded.report).toEqual(submitted.report);
    expect(reloaded.challengeVersion).toBe(attempt.challengeVersion);

    const outsider = await workspace.evaluate(async path => {
      const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
      const registered = await fetch("/api/v1/auth/register", { method: "POST",
        headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ email: `vibe-outsider-${suffix}@example.invalid`, username: `vibe_other_${suffix}`,
          password: `owned-other-${crypto.randomUUID()}` }) });
      if (registered.status !== 201) return { registrationStatus: registered.status, deniedStatus: null };
      const account = await registered.json() as { accessToken: string };
      const denied = await fetch(path, { headers: { Authorization: `Bearer ${account.accessToken}` }, signal: AbortSignal.timeout(5000) });
      await denied.body?.cancel();
      return { registrationStatus: registered.status, deniedStatus: denied.status };
    }, path);
    expect(outsider.registrationStatus).toBe(201);
    expect(outsider.deniedStatus).toBe(404);
    expect(errors).toEqual([]);
    report.assessment = { publicChecks: ran.runs[0].checks.length, passed: submitted.report!.passed,
      total: submitted.report!.total, outcome: submitted.report!.outcome, evaluationStatus: submitted.report!.evaluationStatus,
      challengeVersion: attempt.challengeVersion, persistedReloadEqual: true, outsiderDenied: true, sourceRestoredInReadOnlyEditor: true };
    await mkdir(resolve("reports"), { recursive: true });
    await result.screenshot({ path: resolve("reports/phase5-vibe-browser.png") });
    report.status = "PASS";
  } finally {
    report.elapsedMainTestMs = performance.now() - started;
    report.pageErrorCount = errors.length;
    try {
      await workspace?.close();
    } catch (error) {
      report.status = "FAIL";
      throw error;
    } finally {
      await mkdir(resolve("reports"), { recursive: true });
      const output = resolve("reports/phase5-vibe-browser.json");
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
      await testInfo.attach("phase5-vibe-browser", { path: output, contentType: "application/json" });
    }
  }
});
