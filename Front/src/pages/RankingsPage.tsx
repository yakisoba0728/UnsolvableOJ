import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { SkeletonRows } from "../components/Skeleton";
import { useDocumentTitle, useRequest } from "../hooks";
import { userPath } from "../paths";
import type { Page, RankingEntry } from "../types";

const LIMIT = 50;

/** 전체 랭킹. 쪽 번호는 주소(?page=)에 두어 새로고침·뒤로 가기에도 유지한다. */
export function RankingsPage() {
  useDocumentTitle("랭킹");
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Math.floor(Number(params.get("page"))) || 1);
  const { data, loading, error } = useRequest<Page<RankingEntry> | null>(
    (signal) =>
      api<Page<RankingEntry>>(`/rankings?page=${page}&limit=${LIMIT}`, { signal }),
    null,
    "랭킹을 불러오지 못했습니다.",
    [page],
  );

  return (
    <div className="page-width rankings-page">
      <PageHeader
        title="랭킹"
        description="XP가 많은 순서이며, 같으면 먼저 가입한 사람이 앞섭니다."
        back={{ to: "/", label: "홈" }}
      />
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : loading ? (
        <SkeletonRows count={8} columns={3} />
      ) : data?.items.length ? (
        <section className="ranking-card" aria-label={`랭킹 ${page}페이지`}>
          <ol className="ranking-list">
            {data.items.map((entry, index) => {
              const mine = entry.id === session?.user.id;
              return (
                <li
                  key={entry.id}
                  className={mine ? "ranking-row current" : "ranking-row"}
                  aria-current={mine ? "true" : undefined}
                >
                  <span className="ranking-position">
                    {entry.rank ?? (page - 1) * LIMIT + index + 1}
                  </span>
                  <span className="ranking-name">
                    <Link to={userPath(entry.username)}>{entry.username}</Link>
                    {mine ? " · 나" : ""}
                    <small>Lv.{entry.level}</small>
                  </span>
                  <span className="ranking-solved muted">
                    해결 {entry.solvedCount}
                  </span>
                  <span className="ranking-xp">
                    {entry.xp.toLocaleString()} XP
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <p className="empty-state">랭킹 정보가 아직 없습니다.</p>
      )}
      {data ? (
        <Pagination
          page={page}
          totalPages={data.totalPages}
          onChange={(next) => setParams(next === 1 ? {} : { page: String(next) })}
        />
      ) : null}
    </div>
  );
}
