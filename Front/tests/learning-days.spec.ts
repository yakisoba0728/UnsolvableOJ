import { expect, test } from "@playwright/test";
import type { Submission } from "../src/types";

const submission = (status: string, at: string): Submission => ({
  id: `${status}:${at}`, problem: { id: status }, language: "PYTHON", status,
  runtimeMs: null, memoryKb: null, passedTestCases: 0, totalTestCases: 1,
  compileOutput: null, judgeMessage: null, createdAt: at, updatedAt: at,
});

for (const timezoneId of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test("KST learning boundaries exclude pending/system/cancelled states without changing activity counts", async ({ page }) => {
      await page.goto("/");
      const rows = [submission("WRONG_ANSWER", "2026-11-01T14:59:59.999Z"), submission("COMPILE_ERROR", "2026-11-01T15:00:00Z"),
        ...["QUEUED", "JUDGING", "SYSTEM_ERROR", "CANCELLED"].map((status) => submission(status, "2026-11-02T15:00:00Z"))];
      const result = await page.evaluate(async (rows) => {
        const hooksPath = "/src/hooks.ts";
        const catalogPath = "/src/missions/catalog.ts";
        const { koreanDayKey, learningByDay, streakDays, submissionsByDay } = await import(hooksPath);
        const { buildMissions, deadlineOf, weekStart } = await import(catalogPath);
        const now = new Date("2026-11-02T14:59:59Z");
        const missions = buildMissions({ submissions: rows, analysis: [], posts: [], now });
        return {
          keys: rows.slice(0, 2).map((row) => koreanDayKey(new Date(row.createdAt))),
          days: [...learningByDay(rows)],
          streaks: [now, new Date("2026-11-02T15:00:00Z"), new Date("2026-11-03T15:00:00Z")].map((at) => streakDays(learningByDay(rows), at)),
          activityTotal: [...submissionsByDay(rows).values()].reduce((a: number, b) => a + Number(b), 0),
          streak: missions.find((m: { id: string }) => m.id === "streak")?.current,
          night: missions.find((m: { id: string }) => m.id === "night")?.current,
          deadline: deadlineOf("day", now)?.toISOString(),
          week: weekStart(now).toISOString(),
        };
      }, rows);
      expect(result).toEqual({ keys: ["2026-11-1", "2026-11-2"], days: [["2026-11-1", 1], ["2026-11-2", 1]], streaks: [2, 2, 0], activityTotal: 6, streak: 2, night: 1, deadline: "2026-11-02T15:00:00.000Z", week: "2026-10-31T15:00:00.000Z" });
    });
  });
}

test("all seven completed learning verdicts count, unknown status does not", async ({ page }) => {
  await page.goto("/");
  const statuses = ["ACCEPTED", "WRONG_ANSWER", "COMPILE_ERROR", "RUNTIME_ERROR", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED", "OUTPUT_LIMIT_EXCEEDED"];
  const result = await page.evaluate(async (rows) => {
    const path = "/src/hooks.ts";
    const { learningByDay } = await import(path);
    return [...learningByDay(rows).values()];
  }, [...statuses, "UNKNOWN"].map((s) => submission(s, "2026-11-01T15:00:00Z")));
  expect(result).toEqual([7]);
});

test('retained learning keeps the middle of a 15-day streak through rejudge without counting first-time pending rows', async ({ page }) => {
  await page.goto('/');
  const rows = Array.from({ length: 15 }, (_, index) => ({
    ...submission('WRONG_ANSWER', new Date(Date.UTC(2026, 9, index + 1, 3)).toISOString()),
    completedForLearning: true,
  }));
  const result = await page.evaluate(async (rows) => {
    const hooksPath = '/src/hooks.ts';
    const catalogPath = '/src/missions/catalog.ts';
    const { learningByDay, streakDays } = await import(hooksPath);
    const { buildMissions } = await import(catalogPath);
    const now = new Date('2026-10-15T04:00:00Z');
    return ['QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED', 'WRONG_ANSWER', 'ACCEPTED'].map((status) => {
      const rejudged = rows.map((row, i) => i === 7 ? { ...row, status } : row);
      const initial = { ...rows[7], status, completedForLearning: false };
      return {
        streak: streakDays(learningByDay(rejudged), now),
        mission: buildMissions({ submissions: rejudged, posts: [], analysis: [], now }).find((m: { id: string }) => m.id === 'streak')?.current,
        initial: [...learningByDay([initial]).values()],
      };
    });
  }, rows);
  expect(result).toEqual(['QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED', 'WRONG_ANSWER', 'ACCEPTED'].map((status) => ({
    streak: 15, mission: 7, initial: ['WRONG_ANSWER', 'ACCEPTED'].includes(status) ? [1] : [],
  })));
});
