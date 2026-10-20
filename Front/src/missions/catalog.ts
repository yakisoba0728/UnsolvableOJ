import { dayKey, submissionsByDay } from "../hooks";
import type { Submission } from "../types";

export type MissionStatus = "idle" | "active" | "done";

/** 미션이 새로 시작되는 주기. streak은 끊기기 전까지 이어지는 미션이다. */
export type MissionPeriod = "day" | "week" | "month" | "streak";

export interface Mission {
  id: "daily" | "analysis" | "streak" | "weekly" | "night" | "community";
  period: MissionPeriod;
  title: string;
  description: string;
  target: number;
  /** target을 넘지 않게 맞춘 현재 값 */
  current: number;
  status: MissionStatus;
  reward: string;
  action: { to: string; label: string };
}

export interface MissionInput {
  submissions: Submission[];
  /** 코드 분석에서 답을 확인한 기록 */
  analysis: { questionId: string; at: string }[];
  /** 내가 올린 풀이 공유 글의 작성 시각 */
  posts: string[];
  now?: Date;
}

const NIGHT_END_HOUR = 6;
/** 이번 달 시즌 목표: 미션을 달성한 횟수 */
export const SEASON_TARGET = 15;

/** 이번 주 일요일 0시(로컬). 주 시작은 학습 기록 막대(WeekStrip)와 같다. */
export function weekStart(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - start.getDay());
  return start;
}

/** 주기별 마감 시각(다음 주기 시작). streak에는 마감이 없다. */
export function deadlineOf(period: MissionPeriod, now: Date) {
  if (period === "day")
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (period === "week") {
    const end = weekStart(now);
    end.setDate(end.getDate() + 7);
    return end;
  }
  if (period === "month")
    return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return null;
}

const statusOf = (current: number, target: number): MissionStatus =>
  current >= target ? "done" : current > 0 ? "active" : "idle";

/** now 기준으로 오늘(없으면 어제)부터 거꾸로 이어진 연속 제출 일수. */
export function streakAt(counts: Map<string, number>, now: Date) {
  const cursor = new Date(now);
  if (!counts.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (counts.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function buildMissions({
  submissions,
  analysis,
  posts,
  now = new Date(),
}: MissionInput): Mission[] {
  const today = dayKey(now);
  const weekFrom = weekStart(now).getTime();
  const solvedIds = (from: (at: Date) => boolean) =>
    new Set(
      submissions
        .filter(
          (item) => item.status === "ACCEPTED" && from(new Date(item.createdAt)),
        )
        .map((item) => item.problem.id),
    ).size;

  const solvedToday = solvedIds((at) => dayKey(at) === today);
  const weeklySolved = solvedIds(
    (at) => at.getTime() >= weekFrom && at.getTime() <= now.getTime(),
  );
  const night = submissions.filter((item) => {
    const at = new Date(item.createdAt);
    return dayKey(at) === today && at.getHours() < NIGHT_END_HOUR;
  }).length;
  // 같은 문제를 다시 풀어도 한 번만 센다.
  const analysisToday = new Set(
    analysis
      .filter((item) => dayKey(new Date(item.at)) === today)
      .map((item) => item.questionId),
  ).size;
  const communityPosts = posts.filter((at) => {
    const created = new Date(at);
    return (
      created.getFullYear() === now.getFullYear() &&
      created.getMonth() === now.getMonth()
    );
  }).length;
  const streak = streakAt(submissionsByDay(submissions), now);

  const define = (
    mission: Omit<Mission, "current" | "status">,
    value: number,
  ): Mission => {
    const current = Math.min(value, mission.target);
    return { ...mission, current, status: statusOf(current, mission.target) };
  };

  return [
    define(
      {
        id: "daily",
        period: "day",
        title: "일일 미션",
        description: "오늘 문제 5개 해결하기",
        target: 5,
        reward: "+50 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      solvedToday,
    ),
    define(
      {
        id: "analysis",
        period: "day",
        title: "코드 분석 워밍업",
        description: "오늘 분석 문제 5개 풀기",
        target: 5,
        reward: "+80 XP",
        action: { to: "/analysis", label: "코드 분석 하러 가기" },
      },
      analysisToday,
    ),
    define(
      {
        id: "night",
        period: "day",
        title: "심야 코더",
        description: "자정~새벽 6시에 제출 3회",
        target: 3,
        reward: "+한정 배지",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      night,
    ),
    define(
      {
        id: "weekly",
        period: "week",
        title: "주간 챌린지",
        description: "이번 주 문제 10개 해결하기",
        target: 10,
        reward: "+300 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      weeklySolved,
    ),
    define(
      {
        id: "community",
        period: "month",
        title: "커뮤니티 기여",
        description: "이번 달 풀이 글 2개 쓰기",
        target: 2,
        reward: "+150 XP",
        action: { to: "/community/new", label: "글 쓰러 가기" },
      },
      communityPosts,
    ),
    define(
      {
        id: "streak",
        period: "streak",
        title: "연속 학습",
        description: "제출한 날이 7일 연속 이어지기",
        target: 7,
        reward: "+120 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      streak,
    ),
  ];
}

const endOfDay = (year: number, month: number, day: number) =>
  new Date(year, month, day, 23, 59, 59, 999);

/** at 시점까지의 기록만으로 계산한 미션 상태(지난 날의 달성 여부를 다시 만드는 데 쓴다). */
function missionsAt(input: MissionInput, at: Date) {
  const cut = at.getTime();
  return buildMissions({
    submissions: input.submissions.filter(
      (item) => new Date(item.createdAt).getTime() <= cut,
    ),
    analysis: input.analysis.filter((item) => new Date(item.at).getTime() <= cut),
    posts: input.posts.filter((created) => new Date(created).getTime() <= cut),
    now: at,
  });
}

/**
 * 시즌은 달력 기준 한 달이고, 이번 달에 미션을 달성한 횟수를 누적한다.
 * 일일 미션은 날마다 새로 시작하므로 매일 달성할 때마다 1회, 주간·월간·연속은 달성된 순간 1회로 센다.
 * (오늘의 달성 개수를 그대로 쓰면 내일 일일 미션이 초기화되면서 시즌 진행이 줄어든다.)
 */
export function seasonOf({
  submissions,
  analysis,
  posts,
  now = new Date(),
}: MissionInput) {
  const input = { submissions, analysis, posts };
  const year = now.getFullYear();
  const month = now.getMonth();
  let previous = missionsAt(input, endOfDay(year, month, 0));
  let done = 0;
  for (let day = 1; day <= now.getDate(); day += 1) {
    const at = day === now.getDate() ? now : endOfDay(year, month, day);
    const current = missionsAt(input, at);
    current.forEach((mission, index) => {
      const wasDone = previous[index].status === "done";
      if (mission.status === "done" && (mission.period === "day" || !wasDone))
        done += 1;
    });
    previous = current;
  }
  const lastDay = new Date(year, month + 1, 0).getDate();
  return {
    label: `${month + 1}월 시즌`,
    done,
    total: SEASON_TARGET,
    daysLeft: lastDay - now.getDate(),
  };
}
