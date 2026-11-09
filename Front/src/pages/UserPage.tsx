import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { difficultyLabel } from "../difficulty";
import { useDocumentTitle, useRequest } from "../hooks";
import { problemPath } from "../paths";
import { BADGE_LABELS, type PublicProfile } from "../types";

const joinedDate = (at: string) =>
  new Date(at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

/** 다른 사람도 볼 수 있는 공개 프로필. 이메일·역할은 서버가 보내지 않는다. */
export function UserPage() {
  const { username = "" } = useParams();
  const { session } = useAuth();
  const { data: profile, loading, error } = useRequest<PublicProfile | null>(
    (signal) => api<PublicProfile>(`/users/${encodeURIComponent(username)}`, { signal }),
    null,
    "프로필을 불러오지 못했습니다.",
    [username],
  );
  useDocumentTitle(profile?.username ?? username);

  if (loading)
    return (
      <div className="page-width profile-page">
        <SkeletonRegion className="profile-skeleton" label="프로필을 불러오는 중입니다">
          <div className="profile-skeleton-card">
            <Skeleton width={72} height={72} radius="50%" />
            <div className="profile-skeleton-lines">
              <Skeleton width={180} height={22} />
              <Skeleton width={240} height={14} />
            </div>
          </div>
        </SkeletonRegion>
      </div>
    );
  if (error || !profile)
    return (
      <div className="page-width profile-page">
        <PageHeader title={username} back={{ to: "/rankings", label: "랭킹" }} />
        <div className="empty-state" role="alert">
          <strong>{error || "사용자를 찾을 수 없습니다."}</strong>
        </div>
      </div>
    );

  const mine = profile.id === session?.user.id;
  return (
    <div className="page-width profile-page">
      <PageHeader
        title={profile.username}
        description={`${joinedDate(profile.createdAt)} 가입`}
        back={{ to: "/rankings", label: "랭킹" }}
        aside={
          mine ? (
            <Link className="button button-small button-outline" to="/settings">
              계정 설정
            </Link>
          ) : null
        }
      />
      <section className="profile-card">
        <div className="avatar avatar-large" aria-hidden="true">
          {profile.username.slice(0, 1).toUpperCase()}
        </div>
        <div className="profile-main">
          <h2>
            {profile.username} <small>@{profile.username}</small>
          </h2>
          <div aria-label="획득한 배지">
            {profile.badges.map((b) => (
              <span className="pill" key={b.badge}>
                {BADGE_LABELS[b.badge] ?? b.badge}
              </span>
            ))}
          </div>
          <div className="profile-level">
            <span className="pill pill-warning">Lv.{profile.level}</span>
            <span className="muted">{profile.xp.toLocaleString()} XP</span>
          </div>
        </div>
        <dl className="profile-stats">
          <div>
            <dt>해결한 문제</dt>
            <dd>{profile.solvedCount}</dd>
          </div>
          <div>
            <dt>전체 랭킹</dt>
            <dd>#{profile.rank}</dd>
          </div>
        </dl>
      </section>

      <section className="panel solved-panel">
        <div className="section-heading compact">
          <h2>해결한 문제</h2>
        </div>
        {profile.solvedProblems.length ? (
          <ul className="solved-list">
            {profile.solvedProblems.map((problem) => (
              <li key={problem.id}>
                <Link to={problemPath(problem.slug)}>{problem.title}</Link>
                <span className="muted">{difficultyLabel(problem.difficulty)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">아직 해결한 공개 문제가 없습니다.</p>
        )}
      </section>
    </div>
  );
}
