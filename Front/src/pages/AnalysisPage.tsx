import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  analysisQuestions,
  analysisTopics,
  type AnalysisQuestion,
  type AnalysisTopic,
} from "../analysis/questions";
import { analysisStatus, useAnalysisAttempts } from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import {
  ProblemStatus,
  solveState,
  type SolveState,
} from "../components/ProblemStatus";
import { Pagination } from "../components/Pagination";
import { ReverseIcon } from "../components/ReverseIcon";
import { Select } from "../components/Select";
import { ShuffleIcon } from "../components/ShuffleIcon";
import { SlideToggle } from "../components/SlideToggle";
import { useDocumentTitle, useStickyTop } from "../hooks";
import { analysisPath } from "../paths";
import { newSeed, seededShuffle } from "../shuffle";
import type { Difficulty } from "../types";
import { difficultyLabel } from "./ProblemsPage";

const difficultyOptions: Difficulty[] = [
  "BEGINNER",
  "EASY",
  "MEDIUM",
  "HARD",
  "EXPERT",
];
// 문제 은행에 실제로 있는 난이도만 필터에 보여 준다.
const difficulties = difficultyOptions.filter((value) =>
  analysisQuestions.some((item) => item.difficulty === value),
);

const PAGE_SIZE = 20;

const sorts = [
  { value: "default", label: "출제순" },
  { value: "difficulty", label: "난이도순" },
  { value: "title", label: "제목순" },
  { value: "random", label: "무작위" },
];

const statusChips: { value: "" | SolveState; label: string }[] = [
  { value: "", label: "전체" },
  { value: "none", label: "미해결" },
  { value: "attempted", label: "풀이 중" },
  { value: "solved", label: "해결" },
];

const total = analysisQuestions.length;

/**
 * 문제 목록과 같은 방식: 검색어·난이도·분류·상태·정렬·순서 뒤집기·페이지를 URL에 저장해
 * 문제를 열었다가 뒤로 가도 같은 목록이 복원된다.
 */
export function AnalysisPage() {
  useDocumentTitle("코드 분석");
  const { session } = useAuth();
  const userId = session?.user.id ?? "guest";
  const attempts = useAnalysisAttempts();
  const { solved, attempted } = useMemo(
    () => analysisStatus(attempts, userId),
    [attempts, userId],
  );
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const urlQuery = params.get("q") ?? "";
  const picked = <T extends string>(key: string, allowed: readonly T[]) =>
    (params.get(key) ?? "")
      .split(",")
      .filter((value): value is T => allowed.includes(value as T));
  const selectedDifficulties = picked<Difficulty>("d", difficulties);
  const selectedTopics = picked<AnalysisTopic>("t", analysisTopics);
  const statuses = picked<SolveState>("s", ["solved", "attempted", "none"]);
  const sort = sorts.some((item) => item.value === params.get("sort"))
    ? (params.get("sort") as string)
    : "default";
  // 기본 순서(출제순, 쉬운 난이도 먼저, 제목 가나다순)를 뒤집은 상태
  const reversed = params.get("rev") === "1";
  const seed = Number(params.get("seed")) || 1;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [announce, setAnnounce] = useState("");
  // 아이콘 애니메이션은 키가 바뀔 때마다 처음부터 다시 실행된다.
  const [spinKey, setSpinKey] = useState(0);
  const [reverseKey, setReverseKey] = useState(0);
  const sideRef = useRef<HTMLElement>(null);
  useStickyTop(sideRef);

  // 지연된 호출(검색어 디바운스)이 오래된 주소로 다른 필터를 덮어쓰지 않도록 최신 값에서 계산한다.
  function update(
    patch: Record<string, string | null>,
    { resetPage = true }: { resetPage?: boolean } = {},
  ) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (resetPage && !("page" in patch)) next.delete("page");
        return next;
      },
      { replace: true },
    );
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
  }, [queryText, urlQuery]);

  // "/" 키로 검색창에 바로 이동
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
        return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const keyword = urlQuery.trim().toLowerCase();
  const isSingle = (value: string) =>
    selectedDifficulties.length === 1 && selectedDifficulties[0] === value;
  const stateOf = (item: AnalysisQuestion) =>
    solveState(item.id, solved, attempted);

  // skip: 해당 그룹의 조건만 빼고 센다 → 칩의 숫자가 "그 칩을 눌렀을 때의 결과 수"가 된다
  const matches = (
    item: AnalysisQuestion,
    skip: "difficulty" | "topic" | "status" | null,
  ) =>
    (skip === "difficulty" ||
      !selectedDifficulties.length ||
      selectedDifficulties.includes(item.difficulty)) &&
    (skip === "topic" ||
      !selectedTopics.length ||
      selectedTopics.includes(item.topic)) &&
    (skip === "status" ||
      !statuses.length ||
      statuses.includes(stateOf(item))) &&
    // 검색어는 문제 목록·커뮤니티처럼 제목에서만 찾는다.
    (!keyword || item.title.toLowerCase().includes(keyword));

  const filtered = useMemo(() => {
    // 무작위: 전체를 한 번 섞은 뒤 필터를 적용한다. 필터를 바꿔도 상대 순서가 유지된다.
    const base =
      sort === "random"
        ? seededShuffle(analysisQuestions, seed)
        : [...analysisQuestions];
    const dir = reversed ? -1 : 1;
    if (sort === "difficulty")
      base.sort(
        (a, b) =>
          (difficultyOptions.indexOf(a.difficulty) -
            difficultyOptions.indexOf(b.difficulty)) *
          dir,
      );
    else if (sort === "title")
      base.sort((a, b) => a.title.localeCompare(b.title, "ko") * dir);
    else if (sort === "default" && reversed) base.reverse();
    return base.filter((item) => matches(item, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, reversed, seed, params, solved, attempted]);

  const count = (
    skip: "difficulty" | "topic" | "status",
    test: (item: AnalysisQuestion) => boolean,
  ) => analysisQuestions.filter((item) => matches(item, skip) && test(item)).length;

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = filtered.slice(
    (current - 1) * PAGE_SIZE,
    current * PAGE_SIZE,
  );
  const hasFilter = Boolean(
    selectedDifficulties.length ||
      selectedTopics.length ||
      statuses.length ||
      keyword,
  );

  const mine = attempts.filter((item) => item.userId === userId);
  const rate = mine.length
    ? Math.round((mine.filter((item) => item.correct).length / mine.length) * 100)
    : null;
  // 이어 풀 문제(시도했지만 아직 못 맞힌 첫 문제). 없으면 아직 안 푼 첫 문제.
  const next =
    analysisQuestions.find((item) => attempted.has(item.id) && !solved.has(item.id)) ??
    analysisQuestions.find((item) => !attempted.has(item.id));
  const resuming = next ? attempted.has(next.id) : false;

  // 목록을 무작위 순서로 섞는다(이동하지 않는다). 선택한 조건 안에서 섞인다.
  function shuffle() {
    update({ sort: "random", seed: String(newSeed()) });
    setAnnounce("문제 목록을 무작위로 섞었어요.");
  }

  // 현재 목록의 순서를 거꾸로 뒤집는다(같은 정렬 안에서의 방향만 바뀐다).
  function reverseOrder() {
    update({
      sort: sort === "default" ? null : sort,
      rev: reversed ? null : "1",
    });
    setAnnounce(
      reversed ? "목록 순서를 원래대로 되돌렸어요." : "목록 순서를 뒤집었어요.",
    );
  }

  function changeSort(value: string) {
    update({
      rev: null,
      sort: value === "default" ? null : value,
      // 무작위를 고를 때마다 새 순서를 만든다.
      seed: value === "random" ? String(newSeed()) : null,
    });
  }

  return (
    <div className="page-width problems-page">
      <PageHeader
        title="코드 분석"
        description="코드를 읽고 실행 결과를 추론해 보세요. 풀면 바로 해설을 볼 수 있어요."
      />

      <div className="filter-card">
        <div className="filter-row">
          <div className="search-field">
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              placeholder="문제 제목 검색"
              aria-label="문제 검색"
              aria-keyshortcuts="/"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
            />
          </div>
          <Select
            ariaLabel="정렬"
            value={sort}
            options={sorts}
            onChange={changeSort}
          />
        </div>

        <div className="filter-groups">
          <div className="filter-bar">
            <span className="filter-label">상태</span>
            <SlideToggle
              multiple
              ariaLabel="풀이 상태 필터"
              values={statuses}
              options={statusChips.map((item) => ({
                value: item.value,
                label: item.label,
                count: count(
                  "status",
                  (q) => !item.value || stateOf(q) === item.value,
                ),
              }))}
              defaultValue=""
              onChangeValues={(values) => update({ s: values.join(",") || null })}
            />
          </div>
          <div className="filter-bar">
            <span className="filter-label">난이도</span>
            <SlideToggle
              multiple
              ariaLabel="난이도 필터"
              values={selectedDifficulties}
              options={[
                {
                  value: "",
                  label: "전체",
                  count: count("difficulty", () => true),
                },
                ...difficulties.map((value) => ({
                  value,
                  label: difficultyLabel(value),
                  count: count("difficulty", (q) => q.difficulty === value),
                })),
              ]}
              defaultValue=""
              onChangeValues={(values) => update({ d: values.join(",") || null })}
            />
          </div>
          <div className="filter-bar">
            <span className="filter-label">분류</span>
            <SlideToggle
              multiple
              ariaLabel="분류 필터"
              values={selectedTopics}
              options={[
                { value: "", label: "전체", count: count("topic", () => true) },
                ...analysisTopics.map((value) => ({
                  value,
                  label: value,
                  count: count("topic", (q) => q.topic === value),
                })),
              ]}
              defaultValue=""
              onChangeValues={(values) => update({ t: values.join(",") || null })}
            />
          </div>
          {sort === "random" ? (
            <button
              type="button"
              className="shuffle-icon-button"
              aria-label="무작위로 다시 섞기"
              title="무작위로 다시 섞기"
              onClick={() => {
                setSpinKey((key) => key + 1);
                shuffle();
              }}
              disabled={filtered.length < 2}
            >
              <ShuffleIcon playKey={spinKey} />
            </button>
          ) : (
            <button
              type="button"
              className="shuffle-icon-button reverse-icon-button"
              aria-label="목록 순서 뒤집기"
              aria-pressed={reversed}
              title="목록 순서 뒤집기"
              onClick={() => {
                setReverseKey((key) => key + 1);
                reverseOrder();
              }}
              disabled={filtered.length < 2}
            >
              <ReverseIcon playKey={reverseKey} />
            </button>
          )}
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>
      <div className="list-layout">
        <section aria-label="코드 분석 문제 목록">
          <div className="section-heading compact">
            <div className="title-line">
              <h2>{hasFilter ? "검색 결과" : "전체 문제"}</h2>
              {sort === "random" ? (
                <>
                  <span className="pill pill-primary">무작위 순서</span>
                  <button
                    type="button"
                    className="inline-button"
                    onClick={() => changeSort("default")}
                  >
                    기본 순서로
                  </button>
                </>
              ) : null}
            </div>
            <span className="total-count">
              {filtered.length}문제
              {filtered.length
                ? ` 중 ${(current - 1) * PAGE_SIZE + 1}–${(current - 1) * PAGE_SIZE + visible.length}`
                : ""}
            </span>
          </div>
          {visible.length ? (
            <div className="problem-list data-list list-problems">
              <div className="problem-head" aria-hidden="true">
                <span>문제</span>
                <span>난이도</span>
                <span>분류</span>
                <span>언어</span>
              </div>
              {visible.map((item) => (
                <div className="problem-row-wrap" key={item.id}>
                  <Link className="problem-row" to={analysisPath(item.id)}>
                    <span className="problem-title">
                      <span className="post-title-line">
                        <strong title={item.title}>{item.title}</strong>
                        {stateOf(item) === "none" ? null : (
                          <ProblemStatus state={stateOf(item)} />
                        )}
                      </span>
                    </span>
                    <span
                      className={`difficulty difficulty-${item.difficulty.toLowerCase()}`}
                    >
                      {difficultyLabel(item.difficulty)}
                    </span>
                    <span className="problem-limit" data-label="분류">
                      {item.topic}
                    </span>
                    <span className="problem-limit" data-label="언어">
                      {item.language}
                    </span>
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <strong>조건에 맞는 문제가 없어요.</strong>
              <p>
                {keyword ? `‘${urlQuery.trim()}’ 검색어와 ` : ""}선택한 필터를
                유지한 채 결과가 없습니다. 조건을 줄여 다시 찾아보세요.
              </p>
              <button
                type="button"
                className="button button-outline"
                onClick={() => {
                  setQueryText("");
                  update({ q: null, d: null, t: null, s: null });
                }}
              >
                필터 모두 지우기
              </button>
            </div>
          )}
          <Pagination
            page={current}
            totalPages={totalPages}
            onChange={(value) =>
              update(
                { page: value === 1 ? null : String(value) },
                { resetPage: false },
              )
            }
          />
        </section>

        <aside className="side-stack" ref={sideRef}>
          <div className="standing-card">
            <h2>내 학습</h2>
            <dl>
              <div>
                <dt>해결한 문제</dt>
                <dd>
                  {solved.size} / {total}
                </dd>
              </div>
              <div>
                <dt>풀어 본 문제</dt>
                <dd>{attempted.size}개</dd>
              </div>
              <div>
                <dt>정답률</dt>
                <dd>{rate === null ? "—" : `${rate}%`}</dd>
              </div>
            </dl>
            {next ? (
              <div className="standing-continue">
                <div className="standing-continue-title">
                  <strong>{next.title}</strong>
                  <span
                    className={`difficulty difficulty-${next.difficulty.toLowerCase()}`}
                  >
                    {difficultyLabel(next.difficulty)}
                  </span>
                </div>
                <Link
                  className="button"
                  to={analysisPath(next.id)}
                  title={`${next.title} · ${resuming ? "이어서 풀기" : "다음 문제 풀기"}`}
                >
                  {resuming ? "이어서 풀기" : "다음 문제 풀기"}{" "}
                  <span aria-hidden="true">→</span>
                </Link>
              </div>
            ) : (
              <p className="muted analysis-all-done">
                모든 문제를 해결했어요. 이번에는 직접 코드를 짜 볼까요?
              </p>
            )}
          </div>
          <div className="guide-card">
            <h2>나에게 맞는 문제 찾기</h2>
            <ol>
              <li>
                <button
                  aria-pressed={isSingle("BEGINNER")}
                  onClick={() => update({ d: "BEGINNER" })}
                >
                  <strong>쉬운 난이도로 시작하기</strong>
                  <span>부담 없는 문제부터 차근차근</span>
                  <i className="row-chevron" aria-hidden="true">
                    ›
                  </i>
                </button>
              </li>
              <li>
                <button
                  aria-pressed={isSingle("MEDIUM")}
                  onClick={() => update({ d: "MEDIUM" })}
                >
                  <strong>보통 난이도에 도전하기</strong>
                  <span>익숙해졌다면 한 단계 위로</span>
                  <i className="row-chevron" aria-hidden="true">
                    ›
                  </i>
                </button>
              </li>
              <li>
                <button
                  aria-pressed={
                    statuses.length === 1 &&
                    statuses[0] === "none" &&
                    !selectedDifficulties.length
                  }
                  onClick={() => update({ s: "none", d: null })}
                >
                  <strong>아직 안 푼 문제만 보기</strong>
                  <span>새로운 문제에 집중해요</span>
                  <i className="row-chevron" aria-hidden="true">
                    ›
                  </i>
                </button>
              </li>
            </ol>
            <p className="analysis-hint">
              푼 기록은 이 브라우저에 저장되고, 오늘 푼 문제는 미션 ‘코드 분석
              워밍업’에 반영돼요.{" "}
              {session ? null : (
                <>
                  <Link to="/auth" state={{ from: "/analysis" }}>
                    로그인
                  </Link>
                  하면 내 계정의 미션에 이어져요.
                </>
              )}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
