import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import type { Session } from "../src/types";

async function account(browser: Browser, request: APIRequestContext) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const registered = await request.post("/api/v1/auth/register", {
    data: { email: `exam-${suffix}@example.invalid`, username: `exam_${suffix}`, password: `test-${randomUUID()}` },
  });
  expect(registered.status()).toBe(201);
  const session = await registered.json() as Session;
  const context = await browser.newContext();
  await context.addInitScript((saved) => {
    localStorage.setItem("unsolvable-oj-session-v1", JSON.stringify(saved));
  }, { session, expiresAt: Date.now() + 900_000 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return { session, context, page, errors, headers: { Authorization: `Bearer ${session.accessToken}` } };
}

test("real assessment selection, explicit refresh, frozen candidate content, Judge and owner results", async ({ browser, request }) => {
  // Together with the two existing live flows this uses five registrations,
  // within the real five/minute admission budget. No API response is mocked.
  const owner = await account(browser, request);
  const candidate = await account(browser, request);
  const suffix = randomUUID().slice(0, 8);
  const examTitle = `고정 버전 시험 ${suffix}`;
  const secondTitle = `선택한 두 번째 버전 ${suffix}`;
  const thirdTitle = `나중에 바뀐 세 번째 버전 ${suffix}`;
  const hidden = `PRIVATE_CASE_${suffix}`;
  const editorial = `STAFF_EDITORIAL_${suffix}`;
  const minutes = (value: number) => new Date(Date.now() + value * 60_000).toISOString();
  try {
    const created = await request.post("/api/v1/problems", {
      headers: owner.headers,
      data: {
        slug: `exam-${suffix}`, title: `첫 번째 버전 ${suffix}`, difficulty: "BEGINNER", isPrivate: true,
        statementMarkdown: "42를 출력하세요.", inputDescriptionMarkdown: "입력은 무시하세요.",
        outputDescriptionMarkdown: "지정된 정수", editorialMarkdown: editorial,
        timeLimitMs: 1000, memoryLimitMb: 128,
        testCases: [{ input: "", expectedOutput: "42", isSample: true }, { input: hidden, expectedOutput: "42", isSample: false }],
      },
    });
    expect(created.status()).toBe(201);
    const problem = await created.json();
    const selected = await request.post("/api/v1/enterprise/tests", {
      headers: owner.headers,
      data: { title: examTitle, startsAt: minutes(10), endsAt: minutes(60), durationMin: 30,
        problemIds: [problem.id], showScoreToCandidates: true },
    });
    expect(selected.status()).toBe(201);
    const assessment = await selected.json();
    expect(assessment.problemVersions).toEqual([{ problemId: problem.id, version: 1 }]);

    const revised = await request.patch(`/api/v1/problems/${problem.id}`, {
      headers: owner.headers, data: { title: secondTitle, statementMarkdown: "43을 출력하세요.", timeLimitMs: 1500,
        testCases: [{ input: "", expectedOutput: "43", isSample: true }, { input: hidden, expectedOutput: "43", isSample: false }] },
    });
    expect(revised.status()).toBe(200);
    const saveResponse = () => owner.page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/enterprise/tests/${assessment.id}` && response.request().method() === "PATCH");
    await owner.page.goto(`/enterprise/${assessment.id}/edit`);
    const refresh = owner.page.getByRole("checkbox", { name: /선택한 일반 문제를 모두 최신 버전으로 갱신/ });
    await expect(refresh).not.toBeChecked();
    await owner.page.getByLabel(/테스트 이름/).fill(`${examTitle} 확정`);
    const retainedResponse = saveResponse();
    await owner.page.getByRole("button", { name: "변경 저장", exact: true }).click();
    const retained = await retainedResponse;
    expect(retained.status()).toBe(200);
    expect((await retained.json()).problemVersions).toEqual([{ problemId: problem.id, version: 1 }]);

    await owner.page.goto(`/enterprise/${assessment.id}/edit`);
    await refresh.check();
    const refreshedResponse = saveResponse();
    await owner.page.getByRole("button", { name: "변경 저장", exact: true }).click();
    const refreshed = await refreshedResponse;
    expect(refreshed.status()).toBe(200);
    expect((await refreshed.json()).problemVersions).toEqual([{ problemId: problem.id, version: 2 }]);

    expect((await request.patch(`/api/v1/problems/${problem.id}`, {
      headers: owner.headers, data: { title: thirdTitle, statementMarkdown: "44를 출력하세요.", timeLimitMs: 2500, memoryLimitMb: 256,
        testCases: [{ input: "", expectedOutput: "44", isSample: true }, { input: hidden, expectedOutput: "44", isSample: false }] },
    })).status()).toBe(200);
    const invitation = await request.get(`/api/v1/enterprise/join/${assessment.inviteCode}`, { headers: candidate.headers });
    expect(invitation.status()).toBe(200);
    const invitationBody = await invitation.json();
    expect(Object.keys(invitationBody.test).sort()).toEqual(["description", "durationMin", "endsAt", "problemCount", "startsAt", "title"]);
    expect(JSON.stringify(invitationBody)).not.toContain(secondTitle);
    expect(JSON.stringify(invitationBody)).not.toContain(thirdTitle);
    expect(JSON.stringify(invitationBody)).not.toContain(hidden);
    expect(JSON.stringify(invitationBody)).not.toContain(editorial);
    expect((await request.patch(`/api/v1/enterprise/tests/${assessment.id}`, {
      headers: owner.headers, data: { startsAt: minutes(-1), endsAt: minutes(60) },
    })).status()).toBe(200);

    const page = candidate.page;
    await page.goto(`/enterprise/join/${assessment.inviteCode}`);
    await page.getByRole("button", { name: "응시 시작", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "응시 시작", exact: true }).click();
    await expect(page).toHaveURL(/\/enterprise\/attempts\/[a-f0-9-]+$/);
    await expect(page.getByRole("heading", { name: `1. ${secondTitle}`, exact: true })).toBeVisible();
    await expect(page.locator(".problem-content")).toContainText("43을 출력하세요.");
    await expect(page.locator(".problem-content")).toContainText("1500ms");
    const attemptId = new URL(page.url()).pathname.split("/").pop()!;
    const candidateView = await request.get(`/api/v1/enterprise/attempts/${attemptId}`, { headers: candidate.headers });
    expect(candidateView.status()).toBe(200);
    const candidateBody = await candidateView.json();
    expect(candidateBody.problems).toHaveLength(1);
    expect(candidateBody.problems[0]).toMatchObject({
      id: problem.id, problemVersion: 2, title: secondTitle, statementMarkdown: "43을 출력하세요.",
      timeLimitMs: 1500, memoryLimitMb: 128, samples: [{ input: "", expectedOutput: "43" }],
    });
    // Inspect the candidate's actual payload, not the authorized creator's source response.
    for (const withheld of [thirdTitle, hidden, editorial])
      expect(JSON.stringify(candidateBody)).not.toContain(withheld);
    expect(await page.content()).not.toContain(thirdTitle);
    expect(await page.content()).not.toContain(hidden);
    expect(await page.content()).not.toContain(editorial);
    await page.getByRole("combobox", { name: "언어", exact: true }).click();
    await page.getByRole("option", { name: "Python 3", exact: true }).click();
    await page.getByLabel("소스 코드").fill("print(43)");
    const submissionResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith(`/problems/${problem.id}/submissions`));
    await page.getByRole("button", { name: "제출", exact: true }).click();
    const submitted = await submissionResponse;
    expect(submitted.status()).toBe(202);
    const submission = await submitted.json();
    expect(submission.problemVersion).toBe(2);
    await expect(page.locator(".ent-verdict")).toHaveText("최근 제출: 성공", { timeout: 30_000 });
    const finalResult = await request.get(`/api/v1/submissions/${submission.id}`, { headers: candidate.headers });
    expect(finalResult.status()).toBe(200);
    const finalBody = await finalResult.json();
    expect(finalBody).toMatchObject({
      id: submission.id, status: "ACCEPTED", problemVersion: 2, passedTestCases: 2, totalTestCases: 2,
      problem: { id: problem.id, title: secondTitle },
    });
    for (const withheld of [thirdTitle, hidden, editorial])
      expect(JSON.stringify(finalBody)).not.toContain(withheld);
    await page.getByRole("button", { name: "시험 종료", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "시험 종료", exact: true }).click();
    await expect(page.getByRole("region", { name: "내 결과" })).toContainText("100점");
    await page.reload();
    await expect(page.getByRole("heading", { name: `1. ${secondTitle}`, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "내 결과" })).toContainText("100점");

    await owner.page.goto(`/enterprise/${assessment.id}`);
    const selectedProblems = owner.page.getByRole("region", { name: "출제 문제", exact: true });
    await expect(selectedProblems).toContainText(secondTitle);
    await expect(selectedProblems).toContainText("고정 v2");
    await expect(selectedProblems).toContainText("1500ms · 128MB");
    await expect(selectedProblems).not.toContainText(thirdTitle);
    await expect(owner.page.getByRole("columnheader", { name: new RegExp(`1번.*${secondTitle}.*고정 v2`) })).toBeVisible();
    const row = owner.page.locator(".ent-result-table tbody tr").filter({ hasText: candidate.session.user.username });
    await expect(row).toContainText("100점");
    await expect(row).toContainText("정답");
    await expect(row).toContainText("종료");
    await owner.page.reload();
    await expect(row).toContainText("100점");
    await expect(selectedProblems).toContainText(secondTitle);
    expect([...owner.errors, ...candidate.errors]).toEqual([]);
  } finally {
    await owner.context.close();
    await candidate.context.close();
  }
});
