import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Mission, MissionStatus } from "../missions/catalog";

/** 미션 카드 한 장에 필요한 값. 시즌 미션이 아니어도(예: XP 두 배 문제) 같은 틀로 그릴 수 있다. */
export type MissionCardData = Pick<
  Mission,
  "title" | "target" | "current" | "status" | "reward" | "action"
> & {
  /** 설명 줄. 문자열 말고 색 글자 같은 화면 조각도 넣을 수 있다. */
  description: ReactNode;
  /** 이동 링크 문구. 없으면 상태에 따라 "시작하기" 또는 "이어서 하기" */
  cta?: string;
};

const statusLabel: Record<MissionStatus, string> = {
  idle: "시작 전",
  active: "진행 중",
  done: "달성",
};

export const percent = (current: number, target: number) =>
  `${Math.min(100, (current / target) * 100)}%`;

/** 상태 알약 · 제목 · 설명과 개수 · 진행 막대 · 보상과 이동 링크. 모든 미션 카드가 공유한다. */
export function MissionBody({ mission }: { mission: MissionCardData }) {
  const cta =
    mission.cta ?? (mission.status === "idle" ? "시작하기" : "이어서 하기");
  return (
    <>
      <span className="mission-status">{statusLabel[mission.status]}</span>
      <h3>{mission.title}</h3>
      <div className="mission-line">
        <p>{mission.description}</p>
        <span className="mission-count">
          {mission.current} / {mission.target}
        </span>
      </div>
      <div
        className="mission-track"
        role="progressbar"
        aria-label={`${mission.title} 진행률`}
        aria-valuemin={0}
        aria-valuemax={mission.target}
        aria-valuenow={mission.current}
      >
        <span style={{ width: percent(mission.current, mission.target) }} />
      </div>
      <div className="mission-foot">
        <span className="mission-reward">{mission.reward}</span>
        {mission.status === "done" ? (
          <span className="mission-done">
            달성 <span aria-hidden="true">✓</span>
          </span>
        ) : (
          <Link
            className="mission-start"
            to={mission.action.to}
            aria-label={`${mission.title} ${cta}`}
          >
            {cta} <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
    </>
  );
}
