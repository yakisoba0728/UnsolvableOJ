import { Link } from "react-router-dom";
import { useAnalysisAttempts } from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { SeasonRing } from "../components/SeasonRing";
import { MissionBody } from "../components/MissionBody";
import { WeekStrip } from "../components/WeekStrip";
import { XpBoostCard } from "../components/XpBoostCard";
import { remainingText } from "../enterprise/model";
import {
  dayKey,
  useDocumentTitle,
  useMyCommunityPosts,
  useNow,
  useSubmissionHistory,
  submissionsByDay,
} from "../hooks";
import {
  buildMissions,
  deadlineOf,
  seasonOf,
  type Mission,
  type MissionPeriod,
} from "../missions/catalog";

const deadlinePrefix: Record<MissionPeriod, string> = {
  day: "자정까지",
  week: "토요일 자정까지",
  month: "이번 달 말까지",
  streak: "",
};

function MissionCard({ mission }: { mission: Mission }) {
  return (
    <li className={`mission-card is-${mission.status}`}>
      <MissionBody mission={mission} />
    </li>
  );
}

export function MissionsPage() {
  useDocumentTitle("미션");
  const { session } = useAuth();
  const history = useSubmissionHistory(session);
  const attempts = useAnalysisAttempts();
  const communityPosts = useMyCommunityPosts(session);
  const tick = useNow();

  const now = new Date(tick);
  const userId = session?.user.id;
  const input = {
    submissions: history.submissions,
    analysis: userId ? attempts.filter((item) => item.userId === userId) : [],
    posts: communityPosts.data.written
      .filter((post) => post.category === "solution")
      .map((post) => post.createdAt),
    now,
  };
  const missions = buildMissions(input);
  const season = seasonOf(input);
  const seasonDone = Math.min(season.done, season.total);
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const accepted = history.submissions.filter((item) => item.status === "ACCEPTED");
  const solvedIds = new Set(accepted.map((item) => item.problem.id));
  const solvedBeforeToday = new Set(
    accepted
      .filter((item) => Date.parse(item.createdAt) < startOfToday)
      .map((item) => item.problem.id),
  );
  const byId = (id: Mission["id"]) =>
    missions.find((mission) => mission.id === id)!;
  const streak = byId("streak");

  const left = (period: MissionPeriod) => {
    const end = deadlineOf(period, now);
    return end ? `${deadlinePrefix[period]} ${remainingText(end.getTime() - tick)}` : "";
  };

  const groups: { period: MissionPeriod; title: string; items: Mission[] }[] = [
    {
      period: "day",
      title: "오늘",
      items: [byId("daily"), byId("analysis"), byId("night")],
    },
    { period: "week", title: "이번 주", items: [byId("weekly")] },
    { period: "month", title: "이번 달", items: [byId("community")] },
  ];

  const section = (group: (typeof groups)[number]) => (
    <section
      key={group.period}
      className={`mission-group mission-group-${group.period}`}
      aria-labelledby={`mission-${group.period}`}
    >
      <div className="section-heading compact">
        <h2 id={`mission-${group.period}`}>{group.title}</h2>
        <span className="muted mission-deadline">{left(group.period)}</span>
      </div>
      <ul className="mission-grid">
        {group.items.map((mission) => (
          <MissionCard key={mission.id} mission={mission} />
        ))}
      </ul>
    </section>
  );

  return (
    <div className="page-width missions-page">
      <PageHeader
        title="오늘의 도전"
        description="오늘 풀 문제부터 이번 달 목표까지 한곳에서 확인하세요."
      />

      {history.error ? (
        <p className="error-message" role="alert">
          {history.error}
        </p>
      ) : null}

      {session ? null : (
        <p className="mission-login">
          <Link to="/auth" state={{ from: "/missions" }}>
            로그인
          </Link>
          하면 내 제출·학습 기록으로 진행률을 계산해 드려요.
        </p>
      )}

      {session && (history.loading || communityPosts.loading) ? (
        <div className="empty-state">미션 진행률을 불러오는 중입니다…</div>
      ) : (
        <>
          <div className="mission-top">
            <SeasonRing
              title="알고리즘 마스터"
              done={seasonDone}
              total={season.total}
              daysLeft={season.daysLeft}
            />

            <section
              className={`mission-card mission-streak is-${streak.status}`}
              aria-label="연속 학습"
            >
              <div className="mission-streak-main">
                <MissionBody mission={streak} />
              </div>
              <div className="mission-streak-week">
                <WeekStrip counts={submissionsByDay(history.submissions)} />
                <small>하루에 제출을 1회 이상 하면 연속 학습이 이어져요.</small>
              </div>
            </section>

            <XpBoostCard
              solvedIds={solvedIds}
              solvedBeforeToday={solvedBeforeToday}
              day={dayKey(now)}
              userId={userId ?? "guest"}
            />
          </div>

          {groups.map(section)}

          <p className="mission-note">
            진행률은 내 제출, 코드 분석, 글 기록으로 계산해요. 시즌 숫자는
            미션을 달성할 때마다 1회씩 쌓이고, 일일 미션은 날마다 새로 세요.
            보상(XP·배지) 지급은 서버 연동 후에 열려요.
          </p>
        </>
      )}
    </div>
  );
}
