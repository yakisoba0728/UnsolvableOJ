import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { analysisQuestions } from "../analysis/questions";
import {
  loadAnalysisSession,
  recordAnalysisAttempt,
  saveAnalysisSession,
  type AnalysisAnswer,
} from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";

const LETTERS = ["A", "B", "C", "D"];
const questions = analysisQuestions;
const total = questions.length;

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

const questionIds = questions.map((item) => item.id);

export function AnalysisPage() {
  const { session } = useAuth();
  const userId = session?.user.id ?? "guest";
  // 로그인·로그아웃으로 사용자가 바뀌면 그 사용자의 풀이로 새로 시작한다.
  return <AnalysisQuiz key={userId} userId={userId} signedIn={Boolean(session)} />;
}

function AnalysisQuiz({
  userId,
  signedIn,
}: {
  userId: string;
  signedIn: boolean;
}) {
  useDocumentTitle("코드 분석");
  const [saved] = useState(() => loadAnalysisSession(userId, questionIds));
  const [index, setIndex] = useState(saved?.index ?? 0);
  const [picked, setPicked] = useState<number | null>(saved?.picked ?? null);
  const [answers, setAnswers] = useState<(AnalysisAnswer | undefined)[]>(
    () => saved?.answers ?? Array(total).fill(undefined),
  );
  const [finished, setFinished] = useState(saved?.finished ?? false);
  const [elapsed, setElapsed] = useState(saved?.elapsed ?? 0);
  // 들어오자마자 시간이 흐르지 않도록, 소개 화면에서 시작·계속하기를 눌러야 풀이가 열린다.
  const [started, setStarted] = useState(false);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (finished || !started) return;
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [finished, started]);

  useEffect(() => {
    if (started) questionRef.current?.focus({ preventScroll: true });
  }, [started]);

  // 다른 메뉴에 다녀오거나 새로고침해도 이어 풀 수 있게 진행 상황을 저장한다.
  useEffect(() => {
    saveAnalysisSession(userId, {
      questionIds,
      index,
      picked,
      answers,
      finished,
      elapsed,
    });
  }, [userId, index, picked, answers, finished, elapsed]);

  // 문제가 바뀌면 키보드·스크린리더 사용자가 새 문제부터 읽도록 포커스를 옮긴다.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    questionRef.current?.focus({ preventScroll: true });
  }, [index]);

  const question = questions[index];
  const answer = answers[index];
  const confirmed = answer !== undefined;
  const selected = answer ? answer.selected : picked;
  const answeredCount = answers.filter(Boolean).length;
  const correctCount = answers.filter((item) => item?.correct).length;
  const isLast = index === total - 1;
  const rate = Math.round((correctCount / total) * 100);

  function confirm() {
    if (picked === null || confirmed) return;
    const correct = picked === question.answer;
    setAnswers((prev) =>
      prev.map((item, i) => (i === index ? { selected: picked, correct } : item)),
    );
    recordAnalysisAttempt(userId, question.id, correct);
  }

  function goTo(next: number) {
    setIndex(next);
    setPicked(null);
  }

  function restart() {
    setAnswers(Array(total).fill(undefined));
    setFinished(false);
    setElapsed(0);
    goTo(0);
    setStarted(true);
  }

  const hasProgress = answeredCount > 0 || index > 0 || picked !== null;

  if (!started) {
    return (
      <AnalysisIntro
        signedIn={signedIn}
        finished={finished}
        hasProgress={hasProgress}
        index={index}
        answeredCount={answeredCount}
        correctCount={correctCount}
        rate={rate}
        elapsed={elapsed}
        onStart={() => {
          if (!hasProgress && !finished) setElapsed(0);
          setStarted(true);
        }}
        onRestart={restart}
      />
    );
  }

  if (finished) {
    const wrongConcepts = [
      ...new Set(
        questions.flatMap((item, i) =>
          answers[i]?.correct ? [] : item.concepts,
        ),
      ),
    ];
    return (
      <div className="analysis-page">
        <div className="analysis-head">
          <strong>코드 분석 · 학습 결과</strong>
          <span>{clock(elapsed)} 소요</span>
        </div>
        <section className="analysis-result" aria-label="학습 결과">
          <div className="analysis-score-big">
            <strong>
              {correctCount} / {total}
            </strong>
            <span>정답률 {rate}%</span>
          </div>
          <ol className="analysis-review" aria-label="문제별 결과">
            {questions.map((item, i) => (
              <li key={item.id}>
                <span>문제 {i + 1}</span>
                <span className="analysis-review-concepts">
                  {item.concepts.join(" · ")}
                </span>
                <span
                  className={`pill ${answers[i]?.correct ? "pill-success" : "pill-warning"}`}
                >
                  {answers[i]?.correct ? "정답" : "오답"}
                </span>
              </li>
            ))}
          </ol>
          <div>
            <h2>다시 볼 개념</h2>
            {wrongConcepts.length ? (
              <ul className="analysis-chips">
                {wrongConcepts.map((concept) => (
                  <li key={concept}>{concept}</li>
                ))}
              </ul>
            ) : (
              <p className="muted">모두 맞혔어요. 다음은 직접 코드를 짜 볼까요?</p>
            )}
          </div>
          {signedIn ? null : (
            <p className="analysis-hint">
              <Link to="/auth">로그인</Link>하면 학습 기록이 미션 진행률에
              반영됩니다.
            </p>
          )}
          <div className="analysis-footer">
            <Link className="button button-outline" to="/problems">
              문제 풀러 가기
            </Link>
            <button className="button" onClick={restart}>
              다시 풀기
            </button>
          </div>
        </section>
      </div>
    );
  }

  const status = confirmed
    ? isLast && answeredCount === total
      ? "학습 완료"
      : "확인 완료"
    : clock(elapsed);
  const lines = question.code.split("\n");
  const rightLabel = (i: number) => {
    if (!confirmed) return null;
    if (i === question.answer)
      return answer.selected === i ? "내 답 / 정답" : "정답";
    return answer.selected === i ? "내 답 / 오답" : null;
  };
  const optionState = (i: number) => {
    if (confirmed) {
      if (i === question.answer) return "is-correct";
      if (i === answer.selected) return "is-wrong";
      return "";
    }
    return selected === i ? "is-selected" : "";
  };

  return (
    <div className="analysis-page">
      <div className="analysis-head">
        <strong>코드 분석 · {question.kind}</strong>
        <span>
          문제 {index + 1} / {total} · {status}
        </span>
      </div>
      <div
        className="analysis-progress"
        role="progressbar"
        aria-label="코드 분석 진행률"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={index + 1}
      >
        <span style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>
      <div className="analysis-code" role="group" aria-label="분석할 코드">
        <span className="analysis-code-gutter" aria-hidden="true">
          {lines.map((_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </span>
        <pre>
          <code>{question.code}</code>
        </pre>
      </div>
      <div
        role="radiogroup"
        aria-labelledby="analysis-question"
        className="analysis-choice"
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
            return (
              <label
                key={`${question.id}-${i}`}
                className={`analysis-option ${optionState(i)}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  name={`analysis-${question.id}`}
                  checked={selected === i}
                  disabled={confirmed}
                  onChange={() => setPicked(i)}
                />
                <span className="analysis-badge" aria-hidden="true">
                  {LETTERS[i]}
                </span>
                <span className="analysis-option-text">{text}</span>
                {note ? (
                  <span className="analysis-option-note">· {note}</span>
                ) : null}
              </label>
            );
          })}
        </div>
      </div>
      {confirmed ? (
        <section className="analysis-explain" aria-live="polite">
          <h2>
            {answer.correct
              ? "정답입니다"
              : `정답은 ${question.options[question.answer]}입니다`}
          </h2>
          <h3>해설</h3>
          <div className="analysis-explain-body">
            {question.explanation.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <ul className="analysis-chips" aria-label="관련 개념">
            {question.concepts.map((concept) => (
              <li key={concept}>{concept}</li>
            ))}
          </ul>
          <p className="analysis-score">
            {isLast && answeredCount === total
              ? `${total}문제 중 ${correctCount}문제 정답 · 정답률 ${rate}%`
              : `지금까지 ${answeredCount}문제 중 ${correctCount}문제 정답`}
          </p>
          <button
            className="button button-full"
            onClick={() => (isLast ? setFinished(true) : goTo(index + 1))}
          >
            {isLast ? "학습 결과 보기" : "다음 문제"}
          </button>
        </section>
      ) : (
        <>
          <p className="analysis-hint">
            답을 선택하면 정답을 확인할 수 있습니다.
          </p>
          <div className="analysis-footer">
            <button
              className="button button-outline"
              disabled={index === 0}
              onClick={() => goTo(index - 1)}
            >
              <span aria-hidden="true">←</span> 이전
            </button>
            <button
              className="button analysis-confirm"
              disabled={picked === null}
              onClick={confirm}
            >
              정답 확인
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface IntroProps {
  signedIn: boolean;
  finished: boolean;
  hasProgress: boolean;
  index: number;
  answeredCount: number;
  correctCount: number;
  rate: number;
  elapsed: number;
  onStart: () => void;
  onRestart: () => void;
}

function AnalysisIntro({
  signedIn,
  finished,
  hasProgress,
  index,
  answeredCount,
  correctCount,
  rate,
  elapsed,
  onStart,
  onRestart,
}: IntroProps) {
  return (
    <div className="analysis-page">
      <PageHeader
        title="코드 분석"
        description="모범 답안을 읽고 원리를 추론하는 학습 모드입니다."
      />
      <section
        className="analysis-result analysis-intro"
        aria-label="코드 분석 소개"
      >
        <ul className="analysis-chips" aria-label="구성">
          <li>{total}문제</li>
          <li>객관식</li>
          <li>출력값 추론</li>
        </ul>
        <div>
          <h2>이렇게 진행돼요</h2>
          <ol className="analysis-intro-steps">
            <li>코드를 읽고, 실행했을 때 나오는 값을 네 개의 보기에서 골라요.</li>
            <li>정답을 확인하면 바로 해설과 관련 개념을 볼 수 있어요.</li>
            <li>마지막에 정답률과 다시 볼 개념을 정리해 드려요.</li>
          </ol>
        </div>
        <p className="analysis-hint">
          시간은 시작한 뒤부터 재고, 다른 화면에 있는 동안에는 멈춰요.{" "}
          {signedIn ? (
            "오늘 푼 문제는 미션 ‘코드 분석 워밍업’에 반영돼요."
          ) : (
            <>
              <Link to="/auth" state={{ from: "/analysis" }}>
                로그인
              </Link>
              하면 푼 기록이 미션에 반영돼요.
            </>
          )}
        </p>
        {finished ? (
          <p className="analysis-intro-status">
            지난 결과 · {correctCount} / {total} · 정답률 {rate}%
          </p>
        ) : hasProgress ? (
          <p className="analysis-intro-status">
            진행 중 · 문제 {index + 1} / {total} · {answeredCount}문제 확인 ·{" "}
            {clock(elapsed)}
          </p>
        ) : null}
        <div className="analysis-intro-actions">
          <button className="button" onClick={onStart}>
            {finished ? "결과 보기" : hasProgress ? "계속하기" : "시작하기"}{" "}
            <span aria-hidden="true">→</span>
          </button>
          {finished || hasProgress ? (
            <button className="button button-outline" onClick={onRestart}>
              {finished ? "다시 풀기" : "처음부터 다시"}
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
