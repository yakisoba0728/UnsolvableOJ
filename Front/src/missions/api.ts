import type { Mission } from "./types";
export interface ServerMission extends Omit<Mission, "id"> {
  id: Mission["id"] | "bonus";
  stateId: string;
  available: boolean;
  completedAt: string | null;
  claimedAt: string | null;
  expiresAt: string | null;
}
export interface MissionDashboard {
  items: ServerMission[];
  serverTime: string;
  timezone: string;
  badges: { badge: string; name: string; awardedAt: string }[];
  season: { done: number; total: number; daysLeft: number };
}
