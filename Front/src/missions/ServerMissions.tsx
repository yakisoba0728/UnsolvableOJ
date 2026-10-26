import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { SeasonRing } from "../components/SeasonRing";
import { MissionBody } from "../components/MissionBody";
import { useDocumentTitle, useRequest } from "../hooks";
import { buildMissions } from "./catalog";
import type { MissionDashboard, ServerMission } from "./api";

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
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [claimError, setClaimError] = useState("");
  const busy = useRef(false);
  const mounted = useRef(true);
  const { data, loading, error } = useRequest<MissionDashboard | null>(
    token ? (signal) => api("/missions", { signal }, token) : null,
    null,
    "미션을 불러오지 못했습니다.",
    [token, revision],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!token) return;
    const refresh = () => {
      if (!busy.current) setRevision((v) => v + 1);
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [token]);

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
        setRevision((v) => v + 1);
      }
    }
  }

  const card = (mission: ServerMission, top = false) => {
    const Tag = top ? "section" : "li";
    return (
      <Tag
        key={mission.stateId}
        className={`mission-card is-${mission.status} ${top ? (mission.id === "bonus" ? "xp-boost-card" : "mission-streak") : ""}`}
      >
        <MissionBody mission={mission} />
        {mission.expiresAt && (
          <small>
            마감:{" "}
            {new Intl.DateTimeFormat("ko-KR", {
              timeZone: "Asia/Seoul",
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(new Date(mission.expiresAt))}{" "}
            (한국 시간)
          </small>
        )}
        {mission.claimedAt ? (
          <p className="mission-done">보상 수령 완료 ✓</p>
        ) : (
          <button
            className="button"
            disabled={
              Boolean(pending) ||
              mission.status !== "done" ||
              !mission.available
            }
            onClick={() => void claim(mission)}
            aria-label={`${mission.title} 보상 받기`}
          >
            {pending === mission.stateId ? "지급 중…" : "보상 받기"}
          </button>
        )}
      </Tag>
    );
  };

  return (
    <div className="page-width missions-page">
      <PageHeader
        title="오늘의 도전"
        description="오늘 풀 문제부터 이번 달 목표까지 한곳에서 확인하세요."
      />
      {message && <p role="status">{message}</p>}
      {claimError && (
        <p className="error-message" role="alert">
          {claimError}
        </p>
      )}
      {error && (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button className="button" onClick={() => setRevision((v) => v + 1)}>
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
            하면 서버에 저장된 진행률을 확인하고 보상을 받을 수 있어요.
          </p>
          <ul className="mission-grid">
            {buildMissions({ submissions: [], analysis: [], posts: [] }).map(
              (m) => (
                <li key={m.id} className="mission-card">
                  <MissionBody mission={m} />
                </li>
              ),
            )}
          </ul>
        </>
      ) : loading ? (
        <div className="empty-state">미션 진행률을 불러오는 중입니다…</div>
      ) : (
        data && (
          <>
            <div className="mission-top">
              <SeasonRing
                title="이번 달 보상 수령"
                done={Math.min(data.season.done, data.season.total)}
                total={data.season.total}
                daysLeft={data.season.daysLeft}
              />
              {data.items
                .filter((m) => m.id === "streak" || m.id === "bonus")
                .map((m) => card(m, true))}
            </div>
            {(["day", "week", "month"] as const).map((period) => (
              <section
                key={period}
                className={`mission-group mission-group-${period}`}
              >
                <h2>
                  {
                    {
                      day: "오늘",
                      week: "이번 주",
                      month: "이번 달",
                      streak: "연속 학습",
                    }[period]
                  }
                </h2>
                <ul className="mission-grid">
                  {data.items
                    .filter((m) => m.period === period && m.id !== "bonus")
                    .map((m) => card(m))}
                </ul>
              </section>
            ))}
            <section aria-label="획득한 배지">
              <h2>획득한 배지</h2>
              {data.badges.length ? (
                data.badges.map((b) => (
                  <span className="pill" key={b.badge}>
                    {b.name}
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
        )
      )}
    </div>
  );
}
