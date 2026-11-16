import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { DifficultyBadge } from "../components/DifficultyBadge";
import { PageHeader } from "../components/PageHeader";
import { Skeleton, SkeletonRegion } from "../components/Skeleton";
import { difficultyLabel } from "../difficulty";
import { useDocumentTitle, useRequest } from "../hooks";
import type { LearningActivity, LearningDashboard, LearningDays } from "../learning/types";
import { problemPath } from "../paths";
import { verdictLabel } from "../verdict";
import "../learning/learning.css";

const periods: LearningDays[] = [7, 30, 90];
const dateLabel = (value: string) => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`;
const lastSubmittedLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

export function LearningPage() {
  useDocumentTitle("학습 대시보드");
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("days"));
  const days: LearningDays = periods.includes(requested as LearningDays) ? requested as LearningDays : 30;
  const selectPeriod = (next: LearningDays) => {
    const query = new URLSearchParams(params);
    query.set("days", String(next));
    setParams(query, { replace: true });
  };

  return (
    <div className="page-width page-body learning-page">
      <PageHeader
        title="학습 대시보드"
        description="어떤 문제를 풀었는지 살펴보고, 다음 도전을 이어가세요."
        aside={<div className="account-links">
          <Link className="button button-small button-outline" to="/problems?saved=1">저장한 문제</Link>
          <Link className="button button-small button-outline" to="/profile">내 학습 기록</Link>
        </div>}
      />
      <div className="learning-toolbar">
        <div className="learning-periods" role="group" aria-label="학습 기간">
          {periods.map(period => <button type="button" key={period} aria-pressed={days === period}
            onClick={() => selectPeriod(period)}>최근 {period}일</button>)}
        </div>
        <p className="muted">한국 시간 기준 · 오늘 포함</p>
      </div>
      {/* A period owns its data. A late older response cannot relabel a different window. */}
      <DashboardContent key={days} days={days} />
    </div>
  );
}

function DashboardContent({ days }: { days: LearningDays }) {
  const { session } = useAuth();
  const { data, loading, error, retry } = useRequest<LearningDashboard | null>(
    session ? signal => api(`/users/me/learning?days=${days}`, { signal }, session.accessToken) : null,
    null,
    "학습 현황을 불러오지 못했습니다.",
    [days, session?.accessToken],
  );

  if (loading) return <SkeletonRegion className="learning-loading" label={`최근 ${days}일 학습 현황을 불러오는 중입니다`}>
    <div className="learning-summary">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={108} radius={10} />)}</div>
    <Skeleton height={270} radius={10} />
    <Skeleton height={250} radius={10} />
  </SkeletonRegion>;

  if (error || !data) return <div className="learning-error" role="alert">
    <p>{error || "학습 현황을 불러오지 못했습니다."}</p>
    <button type="button" className="button button-outline" onClick={retry}>다시 시도</button>
  </div>;

  const summary = data.summary;
  const accuracy = summary.submissions ? Math.round(summary.acceptedSubmissions / summary.submissions * 100) : null;
  return <>
    <p className="learning-scope muted">현재 공개된 일반 문제의 제출만 집계합니다. 테스트 실행과 기업 시험은 제외됩니다.</p>
    <p className="sr-only" role="status">최근 {days}일 학습 현황을 불러왔습니다.</p>
    <dl className="learning-summary" aria-label={`최근 ${days}일 학습 요약`}>
      <div><dt>제출</dt><dd>{summary.submissions.toLocaleString("ko-KR")}<small>건</small></dd></div>
      <div><dt>해결한 문제</dt><dd>{summary.solvedProblems.toLocaleString("ko-KR")}<small> / 시도 {summary.attemptedProblems.toLocaleString("ko-KR")}문제</small></dd></div>
      <div><dt>학습한 날</dt><dd>{summary.activeDays}<small> / {days}일</small></dd></div>
      <div><dt>성공한 제출 비율</dt><dd>{accuracy === null ? "—" : `${accuracy}%`}<small>{summary.acceptedSubmissions.toLocaleString("ko-KR")}건 성공</small></dd></div>
    </dl>

    {!summary.submissions ? <section className="learning-panel learning-welcome" aria-labelledby="learning-empty-title">
      <h2 id="learning-empty-title">이 기간에는 아직 제출한 풀이가 없어요</h2>
      <p className="muted">공개 문제에 풀이를 제출하면 학습 흐름과 유형별 현황을 여기에서 확인할 수 있어요.</p>
      <Link className="button" to="/problems">풀 문제 찾기</Link>
    </section> : null}

    <section className="learning-panel" aria-labelledby="learning-activity-title">
      <div className="learning-heading"><div><h2 id="learning-activity-title">문제 해결 흐름</h2><p className="muted">전체 제출과 성공한 제출을 날짜별로 살펴보세요.</p></div>
        <span className="learning-legend"><span>전체 제출</span><span>성공한 제출</span></span></div>
      <ActivityChart activity={data.activity} />
    </section>

    <div className="learning-breakdowns">
      <section className="learning-panel" aria-labelledby="learning-difficulty-title">
        <div className="learning-heading"><div><h2 id="learning-difficulty-title">난이도별 학습</h2><p className="muted">기간 내 해결 / 시도한 문제 수</p></div></div>
        <ul className="learning-breakdown-list">
          {data.difficulties.map(item => <li key={item.difficulty}>
            <Link to={`/problems?d=${encodeURIComponent(item.difficulty)}`} aria-label={`${difficultyLabel(item.difficulty)} 문제 둘러보기`}>
              <DifficultyBadge difficulty={item.difficulty} />
            </Link>
            <meter min={0} max={Math.max(1, item.attempted)} value={item.solved}
              aria-label={`${difficultyLabel(item.difficulty)} 문제 해결`} aria-valuetext={`${item.attempted}문제 시도, ${item.solved}문제 해결`} />
            <span>{item.solved} / {item.attempted}</span>
          </li>)}
        </ul>
      </section>
      <section className="learning-panel" aria-labelledby="learning-tags-title">
        <div className="learning-heading"><div><h2 id="learning-tags-title">유형별 학습</h2><p className="muted">기간 내 해결 / 시도한 문제 수 · 태그는 중복 집계</p></div></div>
        {data.tags.length ? <ul className="learning-tag-list">
          {data.tags.map(item => <li key={item.tag}><Link to={`/problems?t=${encodeURIComponent(item.tag)}`}>
            <span>{item.tag}</span><strong>{item.solved} / {item.attempted}<span className="sr-only">문제 해결 / 시도</span></strong>
          </Link></li>)}
        </ul> : <p className="learning-empty muted">이 기간에 시도한 문제의 태그가 아직 없어요.</p>}
        {data.tagsTruncated ? <p className="muted">시도한 문제가 많은 상위 20개 태그를 보여 줍니다.</p> : null}
      </section>
    </div>

    <section className="learning-panel" aria-labelledby="learning-review-title">
      <div className="learning-heading"><div><h2 id="learning-review-title">다시 도전하기</h2><p className="muted">이 기간에 시도했지만 아직 해결하지 못한 공개 문제 · 최근 제출 순, 최대 10개</p></div>
        <Link className="inline-button" to="/problems?s=attempted">풀이 중인 문제 모두 보기 →</Link></div>
      {data.review.length ? <ol className="learning-review-list">
        {data.review.map(item => <li key={item.id}>
          <div className="learning-review-description">
            <span className="learning-review-meta"><DifficultyBadge difficulty={item.difficulty} />{item.bookmarked ? <span className="pill">저장한 문제</span> : null}</span>
            <Link className="learning-problem-title" to={problemPath(item.slug)}>{item.title}</Link>
            <p className="muted">최근 판정: {verdictLabel(item.lastStatus)} · <time dateTime={item.lastSubmittedAt}>{lastSubmittedLabel(item.lastSubmittedAt)}</time></p>
          </div>
          <Link className="button button-small button-outline" to={problemPath(item.slug)} aria-label={`${item.title} 이어 풀기`}>이어서 풀기 →</Link>
        </li>)}
      </ol> : <div className="learning-empty"><p>이 기간에 다시 도전할 문제가 없어요.</p><Link className="inline-button" to="/problems?s=none">새 문제 찾아보기 →</Link></div>}
    </section>
  </>;
}

function ActivityChart({ activity }: { activity: LearningActivity[] }) {
  // Ninety days use three-day groups so the visual fits small screens. The table retains every day.
  const groupSize = activity.length > 30 ? 3 : 1;
  const buckets = Array.from({ length: Math.ceil(activity.length / groupSize) }, (_, index) => {
    const days = activity.slice(index * groupSize, (index + 1) * groupSize);
    return { submissions: days.reduce((n, day) => n + day.submissions, 0), accepted: days.reduce((n, day) => n + day.acceptedSubmissions, 0) };
  });
  const maximum = Math.max(1, ...buckets.map(item => item.submissions));
  return <>
    <p className="learning-chart-note muted">{groupSize === 1 ? "막대 하나는 하루입니다." : "막대 하나는 3일의 합계입니다."} 정확한 수치는 아래 일별 기록에서 확인하세요.</p>
    <div className="learning-chart" aria-hidden="true">
      {buckets.map((item, index) => <span className="learning-chart-column" key={index}>
        <span className="learning-chart-total" style={{ height: `${item.submissions / maximum * 100}%` }} />
        <span className="learning-chart-accepted" style={{ height: `${item.accepted / maximum * 100}%` }} />
      </span>)}
    </div>
    {activity.length ? <div className="learning-chart-axis" aria-hidden="true"><span>{dateLabel(activity[0].date)}</span><span>{dateLabel(activity.at(-1)!.date)}</span></div> : null}
    <details className="learning-activity-details">
      <summary>일별 기록 보기</summary>
      <div className="learning-table-scroll" tabIndex={0} role="region" aria-label="일별 학습 기록 표">
        <table><caption>한국 시간 기준 일별 제출 기록</caption><thead><tr><th scope="col">날짜</th><th scope="col">전체 제출</th><th scope="col">성공한 제출</th></tr></thead>
          <tbody>{activity.map(item => <tr key={item.date}><th scope="row"><time dateTime={item.date}>{item.date}</time></th><td>{item.submissions}</td><td>{item.acceptedSubmissions}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </>;
}
