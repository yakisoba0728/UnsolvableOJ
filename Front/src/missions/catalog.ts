import { dayKey, solvedToday, streakDays, submissionsByDay } from "../hooks";
import type { Submission } from "../types";

export type MissionStatus = "idle" | "active" | "done";

export interface Mission {
  id: "daily" | "analysis" | "streak" | "weekly" | "night" | "community";
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
  /** 오늘 코드 분석에서 답을 확인한 문제 수 */
  analysisToday: number;
  /** 이번 달에 올린 풀이 공유 글 수 */
  communityPosts: number;
  now?: Date;
}

const NIGHT_END_HOUR = 6;

/** 이번 주 월요일 0시(로컬). */
function weekStart(now: Date) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const statusOf = (current: number, target: number): MissionStatus =>
  current >= target ? "done" : current > 0 ? "active" : "idle";

export function buildMissions({
  submissions,
  analysisToday,
  communityPosts,
  now = new Date(),
}: MissionInput): Mission[] {
  const weekFrom = weekStart(now).getTime();
  const weeklySolved = new Set(
    submissions
      .filter(
        (item) =>
          item.status === "ACCEPTED" &&
          new Date(item.createdAt).getTime() >= weekFrom,
      )
      .map((item) => item.problem.id),
  ).size;
  const today = dayKey(now);
  const night = submissions.filter((item) => {
    const at = new Date(item.createdAt);
    return dayKey(at) === today && at.getHours() < NIGHT_END_HOUR;
  }).length;
  const streak = streakDays(submissionsByDay(submissions));

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
        title: "일일 미션",
        description: "문제 5개 풀기",
        target: 5,
        reward: "+50 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      solvedToday(submissions),
    ),
    define(
      {
        id: "analysis",
        title: "코드 분석 워밍업",
        description: "분석 문제 5개",
        target: 5,
        reward: "+80 XP",
        action: { to: "/analysis", label: "코드 분석 하러 가기" },
      },
      analysisToday,
    ),
    define(
      {
        id: "streak",
        title: "연속 학습",
        description: "7일 연속 학습",
        target: 7,
        reward: "+120 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      streak,
    ),
    define(
      {
        id: "weekly",
        title: "주간 챌린지",
        description: "이번 주 문제 10개 해결",
        target: 10,
        reward: "+300 XP",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      weeklySolved,
    ),
    define(
      {
        id: "night",
        title: "심야 코더",
        description: "자정 이후 제출 3회",
        target: 3,
        reward: "+한정 배지",
        action: { to: "/problems", label: "문제 풀러 가기" },
      },
      night,
    ),
    define(
      {
        id: "community",
        title: "커뮤니티 기여",
        description: "풀이 글 2개 작성",
        target: 2,
        reward: "+150 XP",
        action: { to: "/community/new", label: "글 쓰러 가기" },
      },
      communityPosts,
    ),
  ];
}

/** 시즌은 달력 기준 한 달. 시즌 미션은 위 미션 전체다. */
export function seasonOf(missions: Mission[], now = new Date()) {
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    label: `${now.getMonth() + 1}월 시즌`,
    done: missions.filter((mission) => mission.status === "done").length,
    total: missions.length,
    daysLeft: lastDay - now.getDate(),
  };
}
