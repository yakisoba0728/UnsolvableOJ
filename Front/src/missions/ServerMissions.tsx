import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { SeasonRing } from "../components/SeasonRing";
import { MissionBody } from "../components/MissionBody";
import { useDocumentTitle, useMountedRef, useRequest } from "../hooks";
import { buildMissions } from "./catalog";
import type { MissionDashboard, ServerMission } from "./api";
import type { MissionPeriod } from "./types";

const REFRESH_MS = 60_000;

/** 기간별 묶음의 제목. 연속 학습은 묶음 없이 맨 위 카드로 보인다. */
const groupTitles: Record<Exclude<MissionPeriod, "streak">, string> = {
  day: "오늘",
  week: "이번 주",
  month: "이번 달",
};
const groupPeriods = Object.keys(groupTitles) as (keyof typeof groupTitles)[];

/** 맨 위(시즌 옆)에 크게 보이는 미션 */
const isFeatured = (mission: ServerMission) =>
  mission.id === "streak" || mission.id === "bonus";

const deadlineFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 로그인 전에 보여 줄, 진행률이 0인 미션 목록 */
const guestMissions = buildMissions({ submissions: [], analysis: [], posts: [] });

export function MissionsPage() {
  useDocumentTitle("미션");
  const { session } = useAuth();
  return (
    <MissionDashboardView
      key={session?.accessToken ?? "guest"}
      token={session?.accessToken}
    />
  );
}

function MissionDashboardView({ token }: { token?: string }) {
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [claimError, setClaimError] = useState("");
  const busy = useRef(false);
  const mounted = useMountedRef();
  const {
    data,
    loading,
    error,
    retry: reload,
  } = useRequest<MissionDashboard | null>(
    token ? (signal) => api("/missions", { signal }, token) : null,
    null,
    "미션을 불러오지 못했습니다.",
    [token],
  );
  // 마감·초기화를 놓치지 않도록 1분마다, 그리고 창으로 돌아올 때 다시 받는다(보상을 받는 중에는 건너뛴다).
  useEffect(() => {
    if (!token) return;
    const refresh = () => {
      if (!busy.current) reload();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [token, reload]);

  async function claim(mission: ServerMission) {
    if (!token || busy.current) return;
    busy.current = true;
    setPending(mission.stateId);
    setMessage("");
    setClaimError("");
    try {
      const result = await api<{ alreadyClaimed: boolean; awardedXp: number }>(
        `/missions/${encodeURIComponent(mission.stateId)}/claim`,
        { method: "POST" },
        token,
      );
      if (mounted.current)
        setMessage(
          result.alreadyClaimed
            ? "이미 받은 보상입니다."
            : `${mission.title} 보상을 받았어요.${result.awardedXp ? ` +${result.awardedXp} XP` : ""}`,
        );
    } catch (cause) {
      if (mounted.current)
        setClaimError(
          cause instanceof Error
            ? cause.message
            : "보상을 받지 못했습니다. 다시 시도해 주세요.",
        );
    } finally {
      busy.current = false;
      if (mounted.current) {
        setPending("");
        reload();
      }
    }
  }

  const card = (mission: ServerMission, featured = false) => (
    <MissionCard
      key={mission.stateId}
      mission={mission}
      featured={featured}
      pending={pending}
      onClaim={() => void claim(mission)}
    />
  );

  // 오늘 미션은 시즌 링 위에, 이번 주·이번 달은 아래에 둔다.
  const missionGroup = (period: (typeof groupPeriods)[number]) => (
    <section key={period} className={`mission-group mission-group-${period}`}>
      <h2>{groupTitles[period]}</h2>
      <ul className="mission-grid">
        {data?.items
          .filter(
            (mission) => mission.period === period && mission.id !== "bonus",
          )
          .map((mission) => card(mission))}
      </ul>
    </section>
  );

  return (
    <div className="page-width missions-page">
      <PageHeader
        title="오늘의 도전"
        description="오늘 풀 문제부터 이번 달 목표까지 한곳에서 확인하세요."
      />
      <p className="mission-goal-note muted">홈의 하루 1문제는 기본 목표이며, 일일 미션은 별도의 추가 도전입니다. 보상은 아래 수령 상태를 확인해 주세요.</p>
      {message && <p role="status">{message}</p>}
      {claimError && (
        <p className="error-message" role="alert">
          {claimError}
        </p>
      )}
      {error && (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button className="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      )}
      {!token ? (
        <>
          <p className="mission-login">
            <Link to="/auth" state={{ from: "/missions" }}>
              로그인
            </Link>
            하면 계정에 저장된 진행률을 확인하고 보상을 받을 수 있어요. 아래
            진행률은 미션 안내를 위한 예시이며, 로그인 전 풀이 기록은 계정
            미션에 반영되지 않아요.
          </p>
          <ul className="mission-grid">
            {guestMissions.map((mission) => (
              <li key={mission.id} className="mission-card">
                <MissionBody mission={mission} />
              </li>
            ))}
          </ul>
        </>
      ) : loading && !data ? (
        <div className="empty-state">미션 진행률을 불러오는 중입니다…</div>
      ) : data ? (
        <>
          {missionGroup("day")}
          <div className="mission-top">
            <SeasonRing
              title="이번 달 보상 수령"
              done={Math.min(data.season.done, data.season.total)}
              total={data.season.total}
              daysLeft={data.season.daysLeft}
            />
            {data.items.filter(isFeatured).map((mission) => card(mission, true))}
          </div>
          {(["week", "month"] as const).map(missionGroup)}
          <section aria-label="획득한 배지">
            <h2>획득한 배지</h2>
            {data.badges.length ? (
              data.badges.map((badge) => (
                <span className="pill" key={badge.badge}>
                  {badge.name}
                </span>
              ))
            ) : (
              <p>미션을 달성하고 배지를 받아 보세요.</p>
            )}
          </section>
          <p className="mission-note">
            한국 시간 기준으로 일일·주간(일요일 시작)·월간 미션을 계산해요.
            기간이 끝나기 전에 보상을 받아 주세요. 연속 학습 보상은 한 번의
            연속 기록에서 1회 지급돼요. 수령한 보상은 이후 재채점·글 삭제로
            회수하지 않아요. 시즌 진행은 이번 달 보상 수령 횟수예요.
          </p>
        </>
      ) : null}
    </div>
  );
}

/** 미션 카드. featured는 시즌 옆에 크게 놓는 카드(연속 학습·오늘의 보너스)다. */
function MissionCard({
  mission,
  featured,
  pending,
  onClaim,
}: {
  mission: ServerMission;
  featured: boolean;
  /** 보상을 받는 중인 미션의 stateId (없으면 빈 문자열) */
  pending: string;
  onClaim: () => void;
}) {
  const Tag = featured ? "section" : "li";
  const variant = featured
    ? mission.id === "bonus"
      ? "xp-boost-card"
      : "mission-streak"
    : "";
  return (
    <Tag className={`mission-card is-${mission.status} ${variant}`}>
      <MissionBody mission={mission} />
      {mission.expiresAt && (
        <small>
          마감: {deadlineFormat.format(new Date(mission.expiresAt))} (한국 시간)
        </small>
      )}
      {mission.claimedAt ? (
        <p className="mission-done">보상 수령 완료 ✓</p>
      ) : (
        <button
          className="button"
          disabled={
            Boolean(pending) || mission.status !== "done" || !mission.available
          }
          onClick={onClaim}
          aria-label={`${mission.title} 보상 받기`}
        >
          {pending === mission.stateId ? "지급 중…" : "보상 받기"}
        </button>
      )}
    </Tag>
  );
}
