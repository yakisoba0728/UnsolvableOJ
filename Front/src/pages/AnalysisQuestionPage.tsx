import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  useAnalysisQuestions,
  type AnalysisQuestion as Question,
  type AnalysisReveal,
} from "../analysis/questions";
import {
  analysisStatus,
  recordAnalysisAttempt,
  useAnalysisHistory,
} from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";
import { analysisPath } from "../paths";
import { api } from "../api";
import { DifficultyBadge } from "../components/DifficultyBadge";

const LETTERS = ["A", "B", "C", "D"];
// 문제 풀이 화면의 에디터와 같은 값을 써서 글꼴 크기가 두 화면에서 이어진다.
const fontKey = "unsolvable-oj-editor-font-v1";
const FONT_MIN = 11;
const FONT_MAX = 20;

type Result = { selected: number; correct: boolean } & AnalysisReveal;
// 서버가 정답·해설을 함께 준 기록만 결과로 되살린다(예전 비로그인 기록에는 없다).
const resultOf = (
  item?: {
    selected?: number;
    correct: boolean;
  } & Partial<AnalysisReveal>,
): Result | null =>
  item?.selected !== undefined &&
  item.answer !== undefined &&
  item.explanation &&
  item.concepts
    ? {
        selected: item.selected,
        correct: item.correct,
        answer: item.answer,
        explanation: item.explanation,
        concepts: item.concepts,
      }
    : null;

export function AnalysisQuestionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id ?? "guest";
  const { questions, loading, error, retry } = useAnalysisQuestions();
  const index = questions.findIndex((item) => item.id === id);
  useDocumentTitle(index >= 0 ? questions[index].title : "코드 분석");

  if (index < 0 && (loading || error))
    return (
      <div className="page-width">
        <PageHeader
          title="코드 분석"
          back={{ to: "/analysis", label: "코드 분석" }}
        />
        {loading ? (
          <p role="status">문제를 불러오는 중…</p>
        ) : (
          <div className="empty-state">
            <p role="alert">{error}</p>
            <button
              type="button"
              className="button button-outline"
              onClick={retry}
            >
              다시 시도
            </button>
          </div>
        )}
      </div>
    );
  if (index < 0)
    return (
      <div className="page-width">
        <PageHeader
          title="문제를 찾을 수 없어요"
          back={{ to: "/analysis", label: "코드 분석" }}
        />
        <div className="empty-state ent-empty">
          <p>주소가 바뀌었거나 없는 문제입니다.</p>
          <Link className="button" to="/analysis">
            문제 목록으로 <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    );
  // 문제나 사용자가 바뀌면 그 문제의 풀이로 새로 시작한다.
  return (
    <AnalysisQuestion
      key={`${userId}:${id}`}
      userId={userId}
      signedIn={Boolean(session)}
      questions={questions}
      index={index}
    />
  );
}

function AnalysisQuestion({
  userId,
  signedIn,
  questions,
  index,
}: {
  userId: string;
  signedIn: boolean;
  questions: Question[];
  index: number;
}) {
  const question = questions[index];
  const total = questions.length;
  const { session } = useAuth();
  const { attempts, loading, error: historyError } = useAnalysisHistory();
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const interacted = useRef(false);
  const alive = useRef(true);
  const previous = analysisStatus(attempts, userId).latest.get(question.id);
  // 이미 푼 문제를 다시 열면 지난 결과를 그대로 보여 주고, 원하면 다시 풀 수 있다.
  const [answer, setAnswer] = useState<Result | null>(() => resultOf(previous));
  // 다시 풀기로 접는 동안에도 해설이 보이도록 마지막 결과를 남겨 둔다.
  const [shown, setShown] = useState<Result | null>(answer);
  const reveal = (result: Result | null) => {
    setAnswer(result);
    if (result) setShown(result);
  };
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const result = resultOf(previous);
    if (!interacted.current && result) reveal(result);
  }, [previous]);
  const [fontSize, setFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(fontKey));
      return saved >= FONT_MIN && saved <= FONT_MAX ? saved : 13;
    } catch {
      return 13;
    }
  });
  function changeFont(step: number) {
    const next = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + step));
    setFontSize(next);
    try {
      localStorage.setItem(fontKey, String(next));
    } catch {
      /* 저장소를 쓸 수 없어도 이번 방문에는 적용한다 */
    }
  }
  const questionRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const confirmed = answer !== null;
  const selected = answer ? answer.selected : picked;
  const nextQuestion = questions[index + 1];

  async function confirm() {
    if (picked === null || confirmed || savingRef.current || loading) return;
    interacted.current = true;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      // 정답은 서버만 안다. 로그인하면 기록·미션에 반영하고, 비로그인 연습은 판정만 받아 이 브라우저에 남긴다.
      const path = `/missions/analysis/${encodeURIComponent(question.id)}`;
      const { correct, answer, explanation, concepts } = await api<Result>(
        session ? `${path}/attempts` : `${path}/check`,
        { method: "POST", body: JSON.stringify({ selected: picked }) },
        session?.accessToken,
      );
      const result = {
        selected: picked,
        correct,
        answer,
        explanation,
        concepts,
      };
      if (session) window.dispatchEvent(new Event("analysis-saved"));
      else recordAnalysisAttempt(userId, question.id, correct, picked, result);
      if (!alive.current) return;
      reveal(result);
    } catch (cause) {
      if (alive.current)
        setSaveError(
          cause instanceof Error
            ? cause.message
            : "기록을 저장하지 못했습니다. 다시 시도해 주세요.",
        );
      return;
    } finally {
      savingRef.current = false;
      if (alive.current) setSaving(false);
    }
    // 확인 버튼이 사라지므로 포커스를 결과 안내로 옮겨 읽어 주고, 다음 Tab은 아래 버튼으로 이어진다.
    requestAnimationFrame(() =>
      statusRef.current?.focus({ preventScroll: true }),
    );
  }

  // 보기 영역에서 1~4로 고르고 Enter로 확인한다.
  function onChoiceKeyDown(event: React.KeyboardEvent) {
    if (
      confirmed ||
      saving ||
      loading ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    const n = Number(event.key);
    if (n >= 1 && n <= question.options.length) {
      setPicked(n - 1);
      interacted.current = true;
      event.preventDefault();
    } else if (event.key === "Enter" && picked !== null) {
      confirm();
      event.preventDefault();
    }
  }

  function solveAgain() {
    interacted.current = true;
    reveal(null);
    setPicked(null);
    questionRef.current?.focus({ preventScroll: true });
  }

  const lines = question.code.split("\n");
  const rightLabel = (i: number) => {
    if (!answer) return null;
    if (i === answer.answer)
      return answer.selected === i ? "내 답 / 정답" : "정답";
    return answer.selected === i ? "내 답 / 오답" : null;
  };
  const optionState = (i: number) => {
    if (answer) {
      if (i === answer.answer) return "is-correct";
      if (i === answer.selected) return "is-wrong";
      return "";
    }
    return selected === i ? "is-selected" : "";
  };

  return (
    <div className="analysis-page">
      <PageHeader
        title={question.title}
        badge={
          <DifficultyBadge difficulty={question.difficulty} />
        }
        description={`${question.kind} · ${question.language} · ${question.topic}`}
      />
      <div className="analysis-head">
        <strong>
          문제 {index + 1} / {total}
        </strong>
      </div>
      <div className="analysis-split">
        <div className="analysis-code-wrap">
          <div className="analysis-code-bar">
            <span className="analysis-code-lang">{question.language}</span>
            <span className="font-controls" role="group" aria-label="글꼴 크기">
              <button
                type="button"
                className="font-button"
                aria-label="글꼴 작게"
                disabled={fontSize <= FONT_MIN}
                onClick={() => changeFont(-1)}
              >
                A−
              </button>
              <span className="font-size" aria-hidden="true">
                {fontSize}
              </span>
              <button
                type="button"
                className="font-button"
                aria-label="글꼴 크게"
                disabled={fontSize >= FONT_MAX}
                onClick={() => changeFont(1)}
              >
                A+
              </button>
            </span>
          </div>
          <div
            className="analysis-code"
            role="group"
            aria-label="분석할 코드"
            style={
              { "--analysis-font": `${fontSize}px` } as React.CSSProperties
            }
          >
            <span className="analysis-code-gutter" aria-hidden="true">
              {lines.map((_, i) => (
                <span key={i}>{i + 1}</span>
              ))}
            </span>
            <pre>
              <code>{question.code}</code>
            </pre>
          </div>
        </div>
        <div className="analysis-side">
          <div
            role="radiogroup"
            aria-labelledby="analysis-question"
            className="analysis-choice"
            onKeyDown={onChoiceKeyDown}
          >
            <p
              id="analysis-question"
              className="analysis-question"
              ref={questionRef}
              tabIndex={-1}
            >
              Q. {question.prompt}
            </p>
            <div className="analysis-options">
              {question.options.map((text, i) => {
                const note = rightLabel(i);
                const isAnswer = i === answer?.answer;
                return (
                  <div
                    key={`${question.id}-${i}`}
                    className={`analysis-item${answer && isAnswer ? " is-open" : ""}`}
                  >
                    <label className={`analysis-option ${optionState(i)}`}>
                      <input
                        type="radio"
                        className="sr-only"
                        name={`analysis-${question.id}`}
                        checked={selected === i}
                        disabled={confirmed || saving || loading}
                        onChange={() => {
                          interacted.current = true;
                          setPicked(i);
                        }}
                      />
                      <span className="analysis-badge" aria-hidden="true">
                        {LETTERS[i]}
                      </span>
                      <span className="analysis-option-text">{text}</span>
                      {note ? (
                        <span className="analysis-option-note">{note}</span>
                      ) : null}
                    </label>
                    {/* 정답 보기는 답을 확인해야 알 수 있으니, 모든 보기에 접힌 칸을 두어 펼침 애니메이션을 살린다. */}
                    <div
                      className="analysis-reveal"
                      data-open={isAnswer ? "true" : "false"}
                      aria-hidden={!isAnswer}
                    >
                      {shown?.answer === i ? (
                        <div className="analysis-reveal-inner">
                          <div className="analysis-reveal-body">
                            <div className="analysis-explain-body">
                              {shown.explanation.map((paragraph) => (
                                <p key={paragraph}>{paragraph}</p>
                              ))}
                            </div>
                            <ul
                              className="analysis-chips"
                              aria-label="관련 개념"
                            >
                              {shown.concepts.map((concept) => (
                                <li key={concept}>{concept}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p ref={statusRef} role="status" className="sr-only" tabIndex={-1}>
            {answer
              ? answer.correct
                ? "정답입니다."
                : `오답입니다. 정답은 ${LETTERS[answer.answer]}, ${question.options[answer.answer]}입니다.`
              : ""}
          </p>
          {answer ? (
            signedIn ? null : (
              <p className="analysis-hint">
                <Link to="/auth" state={{ from: analysisPath(question.id) }}>
                  로그인
                </Link>
                후 답을 확인한 문제부터 계정 미션에 반영됩니다. 로그인 전 풀이
                기록은 이 브라우저에만 저장됩니다.
              </p>
            )
          ) : null}
          <div className="analysis-footer">
            {saveError || historyError ? (
              <p role="alert" className="error-message">
                {saveError || historyError}
              </p>
            ) : null}
            {answer ? (
              <>
                <Link className="button button-outline" to="/analysis">
                  목록으로
                </Link>
                <button
                  key="again"
                  className="button button-outline"
                  onClick={solveAgain}
                >
                  다시 풀기
                </button>
                {nextQuestion ? (
                  <Link className="button" to={analysisPath(nextQuestion.id)}>
                    다음 문제 <span aria-hidden="true">→</span>
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <Link className="button button-outline" to="/analysis">
                  <span aria-hidden="true">←</span> 목록으로
                </Link>
                <button
                  key="confirm"
                  className="button analysis-confirm"
                  disabled={picked === null || saving || loading}
                  onClick={confirm}
                >
                  정답 확인
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
