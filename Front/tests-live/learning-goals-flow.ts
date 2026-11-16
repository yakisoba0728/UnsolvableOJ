import { expect, type Page } from "@playwright/test";
import type { LearningGoalResponse } from "../src/learning/types";

/** Reuse the real judge-flow learner: no extra registration or admission bypass. */
export async function exerciseLearningGoals(page: Page) {
  const endpoint = "/api/v1/users/me/learning-goal";
  const panel = page.getByRole("region", { name: "나의 학습 목표" });
  await expect(panel).toContainText("아직 학습 목표가 없어요");
  await panel.getByRole("button", { name: "목표 설정", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("2");
  await page.getByRole("combobox", { name: "목표 기간" }).selectOption("7");
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === "PUT");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  expect((await saved).status()).toBe(200);
  const created = await (await saved).json() as LearningGoalResponse;
  expect(created.goal).toMatchObject({ targetProblems: 2, days: 7, solvedProblems: 1, status: "ACTIVE" });
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuetext", "2문제 목표, 1문제 해결");
  await page.reload();
  await expect(panel).toContainText("1 / 2문제");
  await panel.getByRole("button", { name: "목표 변경", exact: true }).click();
  await page.getByRole("spinbutton", { name: "목표 문제 수" }).fill("1");
  await page.getByRole("button", { name: "목표 저장", exact: true }).click();
  await expect(panel).toContainText("목표 달성");
  await expect(panel).toContainText("1 / 1문제");
  await panel.getByRole("button", { name: "오늘부터 다시 시작", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "다시 시작", exact: true }).click();
  await expect(panel).toContainText("오늘부터 목표를 다시 시작합니다.");
  // A same-day restart retains the current day's distinct ordinary solve.
  await expect(panel).toContainText("1 / 1문제");
  await panel.getByRole("button", { name: "목표 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "목표 삭제", exact: true }).click();
  await expect(panel).toContainText("아직 학습 목표가 없어요");
  await page.reload();
  await expect(panel).toContainText("아직 학습 목표가 없어요");
  // Removing a goal never removes either existing real judged submission.
  await expect(page.getByRole("definition").first()).toContainText("2건");
  await expect(page.getByRole("definition").nth(1)).toContainText("1 / 시도 1문제");
}
