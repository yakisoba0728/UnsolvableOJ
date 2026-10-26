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
