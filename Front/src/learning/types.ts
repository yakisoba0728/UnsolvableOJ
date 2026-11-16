import type { Difficulty } from "../types";

export type LearningDays = 7 | 30 | 90;

export interface LearningGoalResponse {
  timeZone: "Asia/Seoul";
  generatedAt: string;
  goal: null | {
    targetProblems: number;
    days: LearningDays;
    startDate: string;
    endDate: string;
    startsAt: string;
    endsAt: string;
    solvedProblems: number;
    status: "ACTIVE" | "COMPLETED" | "EXPIRED";
    updatedAt: string;
  };
}

export interface LearningActivity {
  date: string;
  submissions: number;
  acceptedSubmissions: number;
}

/** Private, bounded GET /users/me/learning response. Every count uses the selected KST window. */
export interface LearningDashboard {
  days: LearningDays;
  timeZone: "Asia/Seoul";
  generatedAt: string;
  summary: {
    submissions: number;
    acceptedSubmissions: number;
    solvedProblems: number;
    attemptedProblems: number;
    activeDays: number;
  };
  activity: LearningActivity[];
  difficulties: { difficulty: Difficulty; attempted: number; solved: number }[];
  tags: { tag: string; attempted: number; solved: number }[];
  tagsTruncated: boolean;
  review: {
    id: string;
    slug: string;
    title: string;
    difficulty: Difficulty;
    lastSubmittedAt: string;
    lastStatus: string;
    bookmarked: boolean;
  }[];
}
