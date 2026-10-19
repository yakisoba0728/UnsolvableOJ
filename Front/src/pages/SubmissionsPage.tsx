import { useEffect, useMemo, useRef, useState } from "react";
import { verdictLabel } from "../verdict";
import { fetchAll, useDocumentTitle } from "../hooks";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { Pagination } from "../components/Pagination";
import { Select } from "../components/Select";
import { SlideToggle } from "../components/SlideToggle";
import { Skeleton, SkeletonRows } from "../components/Skeleton";
import type { Submission } from "../types";

const languageLabels: Record<string, string> = {
  C: "C",
  CPP: "C++",
  JAVA: "Java",
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  TYPESCRIPT: "TypeScript",
  GO: "Go",
  RUST: "Rust",
};

const PAGE_SIZE = 20;

type StatusGroup = "" | "accepted" | "wrong" | "pending";
const groupOf = (status: string): StatusGroup =>
  status === "ACCEPTED"
    ? "accepted"
    : status === "QUEUED" || status === "JUDGING"
      ? "pending"
      : "wrong";
const statusChips: { value: StatusGroup; label: string }[] = [
  { value: "", label: "전체" },
  { value: "accepted", label: "정답" },
  { value: "wrong", label: "오답·오류" },
  { value: "pending", label: "채점 중" },
];

export function SubmissionsPage() {
  useDocumentTitle("내 제출");
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const [all, setAll] = useState<Submission[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  const urlQuery = params.get("q") ?? "";
  const statuses = (params.get("s") ?? "")
    .split(",")
    .filter((value): value is StatusGroup =>
      ["accepted", "wrong", "pending"].includes(value),
    );
  const language = params.get("l") ?? "";
  const grouped = params.get("g") === "problem";
  const page = Math.max(1, Number(params.get("page")) || 1);

  function update(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    if (resetPage && !("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  }

  // 검색어: 입력은 즉시 반영하고 URL에는 잠시 멈춘 뒤 저장한다(한글 입력 중 끊김 방지)
  const [queryText, setQueryText] = useState(urlQuery);
  const lastWritten = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastWritten.current) {
      lastWritten.current = urlQuery;
      setQueryText(urlQuery);
    }
  }, [urlQuery]);
  useEffect(() => {
    if (queryText === urlQuery) return;
    const timer = setTimeout(() => {
      lastWritten.current = queryText;
      update({ q: queryText || null });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryText]);

  // 서버가 문제명·판정·언어 검색을 지원하지 않아, 전체 이력을 받아 이 화면에서 거른다.
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchAll<Submission>("/submissions", controller.signal, session.accessToken)
      .then(setAll)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "제출을 불러오지 못했습니다.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  const keyword = urlQuery.trim().toLowerCase();
  const matchesBase = (item: Submission) =>
    (!language || item.language === language) &&
    (!keyword || (item.problem.title ?? "").toLowerCase().includes(keyword));
  // 칩의 숫자는 "그 칩을 눌렀을 때의 결과 수"가 되도록 상태 조건만 빼고 센다.
  const statusCount = (value: StatusGroup) =>
    all.filter(
      (item) => matchesBase(item) && (!value || groupOf(item.status) === value),
    ).length;

  const languages = useMemo(
    () => [...new Set(all.map((item) => item.language))],
    [all],
  );

  const { rows, filteredCount } = useMemo(() => {
    const filtered = all.filter(
      (item) =>
        matchesBase(item) &&
        (!statuses.length || statuses.includes(groupOf(item.status))),
    );
    if (!grouped)
      return {
        rows: filtered.map((item) => ({ item, count: 0 })),
        filteredCount: filtered.length,
      };
    const counts = new Map<string, number>();
    for (const item of filtered)
      counts.set(item.problem.id, (counts.get(item.problem.id) ?? 0) + 1);
    const seen = new Set<string>();
    const latest = filtered
      .filter((item) => !seen.has(item.problem.id) && seen.add(item.problem.id))
      .map((item) => ({ item, count: counts.get(item.problem.id) ?? 1 }));
    return { rows: latest, filteredCount: latest.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, statuses.join(","), language, keyword, grouped]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const hasFilter = Boolean(statuses.length || language || keyword);

  return (
    <div className="page-width page-body">
      <PageHeader
        title="내 제출"
        badge={
          loading ? (
            <Skeleton width={48} height={24} radius={999} />
          ) : (
            <span className="pill">{filteredCount}건</span>
          )
        }
        description="제출한 코드와 판정을 확인하세요."
      />
      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder="문제 제목 검색"
              aria-label="제출한 문제 검색"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </div>
          <Select
            ariaLabel="언어 필터"
            value={language}
            options={[
              { value: "", label: "모든 언어" },
              ...languages.map((value) => ({
                value,
                label: languageLabels[value] ?? value,
              })),
            ]}
            onChange={(next) => update({ l: next || null })}
          />
        </div>
        <div className="filter-groups">
          <div className="filter-bar">
            <span className="filter-label">판정</span>
            <SlideToggle
              multiple
              ariaLabel="판정 필터"
              countsLoading={loading}
              values={statuses}
              options={statusChips.map((item) => ({
                value: item.value,
                label: item.label,
                count: statusCount(item.value),
              }))}
              defaultValue=""
              onChangeValues={(next) => update({ s: next.join(",") || null })}
            />
          </div>
          <div className="filter-bar">
            <span className="filter-label">보기</span>
            <SlideToggle
              ariaLabel="보기 방식"
              value={grouped ? "problem" : ""}
              options={[
                { value: "", label: "전체 제출" },
                { value: "problem", label: "문제별 최신" },
              ]}
              defaultValue=""
              onChange={(next) => update({ g: next || null })}
            />
          </div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {loading ? "" : `${filteredCount}건`}
      </p>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <SkeletonRows count={8} columns={5} />
      ) : visible.length ? (
        <div className="problem-list data-list list-history">
          <div className="history-head" aria-hidden="true">
            <span>문제</span>
            <span>판정</span>
            <span>언어</span>
            <span>실행 결과</span>
            <span>제출 시각</span>
          </div>
          {visible.map(({ item, count }) => (
            <Link
              className="history-row"
              to={`/submissions/${item.id}`}
              key={item.id}
            >
              <span className="history-title">
                <strong>{item.problem.title ?? "문제"}</strong>
                <small>
                  {item.passedTestCases} / {item.totalTestCases} 통과
                  {grouped ? ` · 이 문제 ${count}회 제출` : ""}
                </small>
              </span>
              <span className={`verdict verdict-${item.status.toLowerCase()}`}>
                {verdictLabel(item.status)}
              </span>
              <span className="history-lang">
                {languageLabels[item.language] ?? item.language}
              </span>
              <span className="history-metrics">
                {item.runtimeMs === null ? "—" : `${item.runtimeMs}ms`}
                {" · "}
                {item.memoryKb === null
                  ? "—"
                  : `${(item.memoryKb / 1024).toFixed(1)}MB`}
              </span>
              <time className="history-time" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString("ko-KR", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <span className="row-arrow" aria-hidden="true">
                ›
              </span>
            </Link>
          ))}
        </div>
      ) : hasFilter ? (
        <div className="empty-state">
          <strong>조건에 맞는 제출이 없어요.</strong>
          <p>검색어나 필터를 바꿔 보세요.</p>
        </div>
      ) : (
        <div className="empty-state">
          아직 제출이 없습니다.{" "}
          <Link to="/problems">첫 문제를 골라보세요.</Link>
        </div>
      )}
      {!loading ? (
        <Pagination
          page={current}
          totalPages={totalPages}
          onChange={(next) =>
            update(
              { page: next === 1 ? null : String(next) },
              { resetPage: false },
            )
          }
        />
      ) : null}
    </div>
  );
}
