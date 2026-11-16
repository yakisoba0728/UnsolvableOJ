import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useConfirm } from "../components/ConfirmDialog";
import { api } from "../api";
import { useAuth } from "../auth";
import { PageHeader } from "../components/PageHeader";
import {
  formatPeriod,
  remainingText,
  statusLabel,
  statusPillClass,
  testStatus,
  type Attempt,
  type PublicTest,
} from "../enterprise/model";
import { useDocumentTitle, useNow, useRequest } from "../hooks";

interface JoinInfo {
  test: PublicTest;
  isOwner: boolean;
  attempt: Attempt | null;
}

/** 응시 링크로 들어온 사람이 시험 안내를 보고 응시를 시작하는 화면. */
export function EnterpriseJoinPage() {
  const { code = "" } = useParams();
  const { session } = useAuth();
  const navigate = useNavigate();
  const now = useNow(10_000);
  const [confirm, confirmDialog] = useConfirm();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const token = session?.accessToken;
  const { data, loading, error, retry } = useRequest<JoinInfo | null>(
    token ? (signal) => api(`/enterprise/join/${encodeURIComponent(code)}`, { signal }, token) : null,
    null,
    "응시 정보를 불러오지 못했어요.",
    [token, code],
  );
  useDocumentTitle(data?.test.title ?? "코드 테스트 응시");

  const frame = (children: React.ReactNode) => (
    <div className="page-width enterprise-page">
      {confirmDialog}
      <PageHeader title={data?.test.title ?? "코드 테스트 응시"} />
      <div className="empty-state ent-empty ent-join">{children}</div>
    </div>
  );

  if (!session)
    return frame(
      <>
        <strong>로그인하고 코드 테스트에 응시하세요</strong>
        <p>응시 기록과 제출은 로그인한 계정에 저장돼요.</p>
        <Link className="button" to="/auth" state={{ from: `/enterprise/join/${code}` }}>
          로그인하기 <span aria-hidden="true">→</span>
        </Link>
      </>,
    );
  if (!data && loading) return frame(<p role="status">응시 정보를 불러오는 중…</p>);
  if (!data)
    return frame(
      <>
        <strong role="alert">{error || "응시 정보를 불러오지 못했어요."}</strong>
        {/찾을 수 없|올바르지/.test(error) ? null : (
          <button className="button" onClick={retry}>
            다시 시도
          </button>
        )}
      </>,
    );

  const { test, attempt, isOwner } = data;
  const status = testStatus(test, now);

  async function start() {
    if (starting) return;
    if (
      !(await confirm({
        title: "응시를 시작할까요?",
        message: `시작하면 ${test.durationMin}분 타이머가 바로 시작되고 멈출 수 없어요.`,
        confirmLabel: "응시 시작",
      }))
    )
      return;
    setStarting(true);
    setStartError("");
    try {
      const started = await api<Attempt>(
        `/enterprise/join/${encodeURIComponent(code)}/start`,
        { method: "POST" },
        token,
      );
      navigate(`/enterprise/attempts/${started.id}`);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : "응시를 시작하지 못했어요.");
      setStarting(false);
    }
  }

  return frame(
    <>
      <span className={statusPillClass[status]}>{statusLabel[status]}</span>
      <dl className="ent-summary">
        <div>
          <dt>응시 기간</dt>
          <dd>{formatPeriod(test)}</dd>
        </div>
        <div>
          <dt>문항</dt>
          <dd>{test.problemCount}문제</dd>
        </div>
        <div>
          <dt>제한 시간</dt>
          <dd>{test.durationMin}분</dd>
        </div>
      </dl>
      {test.description ? <p className="ent-guide">{test.description}</p> : null}
      {startError ? (
        <p className="error-message" role="alert">
          {startError}
        </p>
      ) : null}
      {attempt ? (
        <Link className="button" to={`/enterprise/attempts/${attempt.id}`}>
          {attempt.finishedAt || Date.parse(attempt.deadlineAt) <= now ? "내 응시 기록 보기" : "응시 화면으로 돌아가기"}{" "}
          <span aria-hidden="true">→</span>
        </Link>
      ) : isOwner ? (
        <p className="muted">테스트를 만든 계정으로는 응시할 수 없어요. 결과는 기업 테스트 상세에서 확인하세요.</p>
      ) : status === "scheduled" ? (
        <p className="muted">시작까지 {remainingText(Date.parse(test.startsAt) - now)} 남았어요.</p>
      ) : status === "closed" ? (
        <p className="muted">응시 기간이 끝났어요.</p>
      ) : (
        <>
          <p className="muted">
            시작하면 {test.durationMin}분(응시 마감까지 남은 시간이 더 짧으면 그만큼) 안에 풀어야 해요.
            한 번만 응시할 수 있어요.
          </p>
          <button className="button" onClick={() => void start()} disabled={starting}>
            {starting ? "시작하는 중…" : "응시 시작"}
          </button>
        </>
      )}
    </>,
  );
}
