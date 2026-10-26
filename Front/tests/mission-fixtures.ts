import type { Page } from "@playwright/test";
import { analysisQuestions } from "../src/analysis/questions";
import type { MissionDashboard } from "../src/missions/api";

export function dashboard(): MissionDashboard {
  const now = new Date().toISOString();
  return {
    serverTime: now,
    timezone: "Asia/Seoul",
    badges: [],
    season: { done: 0, total: 15, daysLeft: 5 },
    items: [
      ...(
        [
          ["daily", "day", "일일 미션", 5, 50, "/problems"],
          ["analysis", "day", "코드 분석 워밍업", 5, 80, "/analysis"],
          ["night", "day", "심야 코더", 3, 0, "/problems"],
          ["weekly", "week", "주간 챌린지", 10, 300, "/problems"],
          ["community", "month", "커뮤니티 기여", 2, 150, "/community/new"],
          ["streak", "streak", "연속 학습", 7, 120, "/problems"],
        ] as const
      ).map(([id, period, title, target, xp, to]) => ({
        id,
        period,
        title,
        target,
        current: 0,
        status: "idle" as const,
        reward: `+${xp} XP`,
        description: title,
        action: { to, label: "시작하기" },
        stateId: id,
        available: true,
        claimedAt: null,
        completedAt: null,
        expiresAt: now,
      })),
      {
        id: "bonus",
        period: "day",
        title: "오늘의 보너스 문제",
        description: "서버 지정 문제 · 오늘 첫 정답 보너스",
        target: 1,
        current: 0,
        status: "idle",
        reward: "+20 XP",
        action: { to: "/problems/view/assigned", label: "문제 풀러 가기" },
        stateId: "bonus",
        available: true,
        claimedAt: null,
        completedAt: null,
        expiresAt: now,
      },
    ],
  };
}
export async function mockMissions(page: Page, data = dashboard()) {
  const attempts: {
    userId: string;
    questionId: string;
    selected: number;
    correct: boolean;
    at: string;
  }[] = [];
  await page.route("**/api/v1/missions", (route) =>
    route.fulfill({ json: data }),
  );
  await page.route("**/api/v1/missions/analysis/attempts", (route) =>
    route.fulfill({ json: attempts }),
  );
  await page.route("**/api/v1/missions/analysis/*/attempts", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const q = analysisQuestions.find((q) => q.id === id)!;
    const { selected } = route.request().postDataJSON();
    const item = {
      userId: "solver",
      questionId: id,
      selected,
      correct: selected === q.answer,
      at: new Date().toISOString(),
    };
    const index = attempts.findIndex((a) => a.questionId === id);
    if (index >= 0) attempts[index] = item;
    else attempts.push(item);
    data.items.find((m) => m.id === "analysis")!.current = attempts.length;
    await route.fulfill({ json: item });
  });
  return { data, attempts };
}
