import { Link } from "react-router-dom";
import { useAnalysisAttempts } from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useActivity } from "../community/store";
import { dayKey, useDocumentTitle, useSubmissionHistory } from "../hooks";
import {
  buildMissions,
  seasonOf,
  type MissionStatus,
} from "../missions/catalog";

const statusLabel: Record<MissionStatus, string> = {
  idle: "시작 전",
  active: "진행 중",
  done: "달성",
};

const percent = (current: number, target: number) =>
  `${Math.min(100, (current / target) * 100)}%`;

export function MissionsPage() {
  useDocumentTitle("미션");
  const { session } = useAuth();
  const history = useSubmissionHistory(session);
  const attempts = useAnalysisAttempts();
  const activity = useActivity();

  const now = new Date();
  const userId = session?.user.id;
  // 같은 문제를 다시 풀어도 한 번만 센다.
  const analysisToday = userId
    ? new Set(
        attempts
          .filter(
            (item) =>
              item.userId === userId &&
              dayKey(new Date(item.at)) === dayKey(now),
          )
          .map((item) => item.questionId),
      ).size
    : 0;
  const communityPosts = session
    ? activity.posts.filter((post) => {
        const created = new Date(post.createdAt);
        return (
          post.category === "solution" &&
          post.author.name === session.user.username &&
          created.getFullYear() === now.getFullYear() &&
          created.getMonth() === now.getMonth()
        );
      }).length
    : 0;

  const missions = buildMissions({
    submissions: history.submissions,
    analysisToday,
    communityPosts,
    now,
  });
  const season = seasonOf(missions, now);

  return (
    <div className="page-width missions-page">
      <PageHeader
        title="오늘의 도전"
        description="작은 목표를 완성하고 다음 실력으로 나아가세요."
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
          하면 내 제출·학습 기록으로 미션 진행률이 집계됩니다.
        </p>
      )}

      {session && history.loading ? (
        <div className="empty-state">미션 진행률을 불러오는 중입니다…</div>
      ) : (
        <>
          <section className="season-card" aria-label="시즌 진행">
            <div className="season-main">
              <span className="pill pill-primary">{season.label}</span>
              <h2>알고리즘 마스터</h2>
              <p>
                시즌 미션 {season.done} / {season.total} 완료 ·{" "}
                {season.total - season.done}개 남음
              </p>
              <div
                className="mission-track season-track"
                role="progressbar"
                aria-label="시즌 미션 진행률"
                aria-valuemin={0}
                aria-valuemax={season.total}
                aria-valuenow={season.done}
              >
                <span style={{ width: percent(season.done, season.total) }} />
              </div>
            </div>
            <div className="season-badge" aria-hidden="true">
              {season.done} / {season.total}
            </div>
            <div className="season-dday">
              <strong>D-{season.daysLeft}</strong>
              <span>시즌 종료까지</span>
            </div>
          </section>

          <section aria-labelledby="my-missions">
            <div className="section-heading compact">
              <h2 id="my-missions">내 미션</h2>
              {season.done > 0 ? (
                <span className="pill pill-success">
                  달성한 미션 {season.done}
                </span>
              ) : null}
            </div>
            <ul className="mission-grid">
              {missions.map((mission) => (
                <li
                  key={mission.id}
                  className={`mission-card is-${mission.status}`}
                >
                  <span className="mission-status">
                    {statusLabel[mission.status]}
                  </span>
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
                    <span
                      style={{ width: percent(mission.current, mission.target) }}
                    />
                  </div>
                  <div className="mission-foot">
                    <span className="mission-reward">{mission.reward}</span>
                    {mission.status === "idle" ? (
                      <Link className="mission-start" to={mission.action.to}>
                        시작하기 <span aria-hidden="true">→</span>
                      </Link>
                    ) : null}
                    {mission.status === "done" ? (
                      <span className="mission-done">
                        달성 <span aria-hidden="true">✓</span>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="mission-note">
            진행률은 내 제출·코드 분석·글 작성 기록으로 집계됩니다. 달성 보상(XP·배지)
            지급은 서버 연동 후 열립니다.
          </p>
        </>
      )}
    </div>
  );
}
