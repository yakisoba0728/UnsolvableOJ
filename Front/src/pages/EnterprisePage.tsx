import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { EnterpriseSchedule } from "../components/EnterpriseSchedule";
import {
  formatPeriod,
  formatStart,
  metaLine,
  sortTests,
  statusLabel,
  statusPillClass,
  testStatus,
  type EnterpriseTest,
  type TestStatus,
} from "../enterprise/model";
import { useEnterpriseTests } from "../enterprise/api";
import { useDocumentTitle, useNow } from "../hooks";

function periodCell(test: EnterpriseTest, status: TestStatus, now: number) {
  if (status === "scheduled")
    return <span>{formatStart(test, now)} 시작 예정</span>;
  return <span>{formatPeriod(test)}</span>;
}

export function EnterprisePage() {
  useDocumentTitle("기업 테스트");
  const { session } = useAuth();
  const now = useNow();
  const { data, loading, error, retry } = useEnterpriseTests(session);
  const tests = sortTests(data, now);
  const running = tests.filter((test) => testStatus(test, now) === "running").length;
  const scheduled = tests.filter((test) => testStatus(test, now) === "scheduled").length;
  const closed = tests.length - running - scheduled;
  const candidates = tests.reduce((sum, test) => sum + test.attemptCount, 0);

  const create = session ? (
    <Link className="button" to="/enterprise/new">
      + 새 테스트 만들기
    </Link>
  ) : null;

  return (
    <div className="page-width enterprise-page">
      <PageHeader
        title="기업 코드 테스트"
        description="문제와 일정을 정하고 응시 링크를 보내면, 응시자의 풀이와 점수를 모아 볼 수 있어요."
        aside={create}
      />

      {!session ? (
        <div className="empty-state ent-empty">
          <strong>로그인하고 코드 테스트를 만들어 보세요</strong>
          <p>
            공개된 문제 중에서 문제를 고르고, 응시 기간과 제한 시간을 정해
            응시 링크로 지원자에게 보낼 수 있어요.
          </p>
          <Link className="button" to="/auth" state={{ from: "/enterprise" }}>
            로그인하기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : error && !data.length ? (
        <div className="empty-state ent-empty" role="alert">
          <strong>{error}</strong>
          <button className="button" onClick={retry}>
            다시 시도
          </button>
        </div>
      ) : loading && !data.length ? (
        <div className="empty-state ent-empty" role="status">
          테스트를 불러오는 중…
        </div>
      ) : tests.length === 0 ? (
        <div className="empty-state ent-empty">
          <strong>아직 만든 테스트가 없어요</strong>
          <p>
            공개된 문제 중에서 문제를 고르고, 응시 기간과 제한 시간을 정해
            첫 테스트를 만들어 보세요.
          </p>
          <Link className="button" to="/enterprise/new">
            첫 테스트 만들기 <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <>
          <div className="stat-tiles ent-metrics" aria-label="테스트 지표">
            <div className="stat-tile">
              <small>진행 중 테스트</small>
              <strong>{running}</strong>
              <span>예정 {scheduled}건</span>
            </div>
            <div className="stat-tile">
              <small>총 응시자</small>
              <strong>{candidates}</strong>
              <span>모든 테스트 합계</span>
            </div>
            <div className="stat-tile">
              <small>마감된 테스트</small>
              <strong>{closed}</strong>
              <span>상세에서 결과 확인</span>
            </div>
          </div>

          <section aria-labelledby="ent-recent">
            <div className="section-heading compact">
              <h2 id="ent-recent">최근 테스트</h2>
              <span className="muted">
                {tests.length}건
              </span>
            </div>
            <table className="ent-table">
              <thead>
                <tr>
                  <th scope="col">테스트명</th>
                  <th scope="col">응시 기간</th>
                  <th scope="col">상태</th>
                  <th scope="col">관리</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((test) => {
                  const status = testStatus(test, now);
                  return (
                    <tr key={test.id}>
                      <td>
                        <Link className="ent-name" to={`/enterprise/${test.id}`}>
                          {test.title}
                        </Link>
                        <small>
                          {metaLine(test)} · 응시 {test.attemptCount}명
                        </small>
                      </td>
                      <td className="ent-period">{periodCell(test, status, now)}<EnterpriseSchedule test={test} compact /></td>
                      <td>
                        <span className={statusPillClass[status]}>
                          {statusLabel[status]}
                        </span>
                      </td>
                      <td>
                        <Link
                          className="button button-outline button-small"
                          to={
                            status === "scheduled"
                              ? `/enterprise/${test.id}/edit`
                              : `/enterprise/${test.id}`
                          }
                          aria-label={`${test.title} ${status === "scheduled" ? "편집" : "상세 보기"}`}
                        >
                          {status === "scheduled" ? "편집" : "상세 보기"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mission-note">
              예정된 테스트는 편집할 수 있어요. 응시 링크와 응시 결과는 상세
              화면에서 확인합니다.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
