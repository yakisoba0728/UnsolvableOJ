import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { analysisQuestions } from "../analysis/questions";
import {
  analysisStatus,
  recordAnalysisAttempt,
  useAnalysisAttempts,
} from "../analysis/progress";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../hooks";
import { analysisPath } from "../paths";
import { difficultyLabel } from "./ProblemsPage";

const LETTERS = ["A", "B", "C", "D"];
const total = analysisQuestions.length;

export function AnalysisQuestionPage() {
  const { id } = useParams();
  const { session } = useAuth();
  const userId = session?.user.id ?? "guest";
  const index = analysisQuestions.findIndex((item) => item.id === id);
  useDocumentTitle(index >= 0 ? analysisQuestions[index].title : "코드 분석");

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
      index={index}
    />
  );
}

function AnalysisQuestion({
  userId,
  signedIn,
  index,
}: {
  userId: string;
  signedIn: boolean;
  index: number;
}) {
  const question = analysisQuestions[index];
  const attempts = useAnalysisAttempts();
  const previous = analysisStatus(attempts, userId).latest.get(question.id);
  // 이미 푼 문제를 다시 열면 지난 결과를 그대로 보여 주고, 원하면 다시 풀 수 있다.
  const [answer, setAnswer] = useState<{
    selected: number;
    correct: boolean;
  } | null>(
    previous && previous.selected !== undefined
      ? { selected: previous.selected, correct: previous.correct }
      : null,
  );
  const [picked, setPicked] = useState<number | null>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    questionRef.current?.focus({ preventScroll: true });
  }, []);

  const confirmed = answer !== null;
  const selected = answer ? answer.selected : picked;
  const nextQuestion = analysisQuestions[index + 1];

  function confirm() {
    if (picked === null || confirmed) return;
    const correct = picked === question.answer;
    setAnswer({ selected: picked, correct });
    recordAnalysisAttempt(userId, question.id, correct, picked);
  }

  function solveAgain() {
    setAnswer(null);
    setPicked(null);
    questionRef.current?.focus({ preventScroll: true });
  }

  const lines = question.code.split("\n");
  const rightLabel = (i: number) => {
    if (!answer) return null;
    if (i === question.answer)
      return answer.selected === i ? "내 답 / 정답" : "정답";
    return answer.selected === i ? "내 답 / 오답" : null;
  };
  const optionState = (i: number) => {
    if (answer) {
      if (i === question.answer) return "is-correct";
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
          <span
            className={`difficulty difficulty-${question.difficulty.toLowerCase()}`}
          >
            {difficultyLabel(question.difficulty)}
          </span>
        }
        description={`${question.kind} · ${question.language} · ${question.topic}`}
        back={{ to: "/analysis", label: "코드 분석" }}
      />
      <div className="analysis-head">
        <strong>
          문제 {index + 1} / {total}
        </strong>
        <span>{answer ? (answer.correct ? "정답" : "오답") : "풀이 전"}</span>
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
      {answer ? (
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
          {signedIn ? null : (
            <p className="analysis-hint">
              <Link to="/auth" state={{ from: analysisPath(question.id) }}>
                로그인
              </Link>
              하면 푼 기록이 내 계정의 미션에 반영됩니다.
            </p>
          )}
          <div className="analysis-footer">
            <Link className="button button-outline" to="/analysis">
              목록으로
            </Link>
            <button className="button button-outline" onClick={solveAgain}>
              다시 풀기
            </button>
            {nextQuestion ? (
              <Link className="button" to={analysisPath(nextQuestion.id)}>
                다음 문제 <span aria-hidden="true">→</span>
              </Link>
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <p className="analysis-hint">
            답을 선택하면 정답을 확인할 수 있습니다.
          </p>
          <div className="analysis-footer">
            <Link className="button button-outline" to="/analysis">
              <span aria-hidden="true">←</span> 목록으로
            </Link>
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
