import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Code2,
  GitCompareArrows,
  MessageSquare,
  Play,
} from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";
import { useDocumentTitle, useRequest } from "../hooks";
import { PageHeader } from "../components/PageHeader";
import { SkeletonRows } from "../components/Skeleton";
import type { VibeAttempt, VibeCatalog, VibeSummary } from "../vibe/types";
import "../vibe.css";

export function VibePage() {
  useDocumentTitle("바이브코딩");
  const { session } = useAuth();
  const catalog = useRequest<VibeCatalog | null>(
    (signal) => api("/vibe/challenges", { signal }),
    null,
    "과제를 불러오지 못했습니다.",
    [],
  );
  const history = useRequest<VibeSummary[]>(
    session
      ? (signal) => api("/vibe/attempts", { signal }, session.accessToken)
      : null,
    [],
    "연습 기록을 불러오지 못했습니다.",
    [session?.user.id],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function start(challengeId: string) {
    if (!session || pending) return;
    setPending(true);
    setError("");
    // 문제 목록처럼 연습은 새 탭에서 연다. 요청이 끝난 뒤에 열면 팝업으로 막히므로
    // 클릭 안에서 빈 탭을 먼저 열어 두고 주소를 채운다(막혔다면 이 탭에서 이동한다).
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const attempt = await api<VibeAttempt>(
        `/vibe/challenges/${challengeId}/attempts`,
        { method: "POST" },
        session.accessToken,
      );
      const path = `/vibe/attempts/${attempt.id}`;
      // 기다리는 사이 빈 탭을 닫았다면 연습은 만들어졌으니 오류 없이 목록에 남는다(최근 연습에서 이어 연다).
      if (tab) {
        if (!tab.closed) tab.location.href = `${window.location.origin}${path}`;
      } else window.location.assign(path);
    } catch (cause) {
      tab?.close();
      setError(
        cause instanceof Error ? cause.message : "연습을 시작하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="page-width page-body vibe-page">
      <PageHeader
        title="바이브코딩"
        description="프로젝트를 읽고, 코드를 고치고, 테스트로 확인하세요. 결과물·프롬프트·검증 과정을 함께 돌아봅니다."
      />
      <section className="vibe-intro" aria-label="진행 방식">
        <ol className="vibe-steps">
          {[
            {
              icon: Code2,
              title: "프로젝트 파악",
              text: "기존 코드와 요구사항 읽기",
            },
            {
              icon: MessageSquare,
              title: "파트너와 협업",
              text: "질문하고 변경안 검토하기",
            },
            {
              icon: Play,
              title: "직접 검증",
              text: "실행 결과로 가설 확인하기",
            },
            {
              icon: GitCompareArrows,
              title: "제출과 회고",
              text: "결과·대화·변경 기록 돌아보기",
            },
          ].map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <Icon size={20} aria-hidden="true" />
              <div>
                <strong>{title}</strong>
                <span>{text}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
      {catalog.error ? (
        <p className="error-message" role="alert">
          {catalog.error}{" "}
          <button className="inline-button" onClick={catalog.retry}>
            다시 시도
          </button>
        </p>
      ) : null}
      {catalog.loading ? (
        <SkeletonRows count={2} />
      ) : (
        catalog.data?.items.map((item) => (
          <section className="vibe-challenge" key={item.id}>
            <div className="vibe-challenge-body">
              <h2>{item.title}</h2>
              <div className="meta-strip vibe-meta">
                <span>
                  <strong>언어</strong> {item.stack}
                </span>
                <span>
                  <strong>유형</strong> {item.difficulty}
                </span>
                <span>
                  <strong>제한시간</strong> {item.durationMin}분
                </span>
              </div>
              <p>{item.summary}</p>
              <ul>
                {item.requirements.slice(0, 3).map((requirement) => (
                  <li key={requirement}>{requirement}</li>
                ))}
              </ul>
            </div>
            <div className="vibe-challenge-start">
              <dl>
                {item.rubric.map((rule) => (
                  <div key={rule.label}>
                    <dt>{rule.label}</dt>
                    <dd>
                      {rule.max}
                      <small>점</small>
                    </dd>
                  </div>
                ))}
              </dl>
              {session ? (
                <button
                  className="button"
                  disabled={pending}
                  onClick={() => void start(item.id)}
                >
                  {pending ? "준비 중…" : "연습 시작 / 이어하기"}
                  <span className="sr-only">(새 탭에서 열려요)</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              ) : (
                <Link className="button" to="/auth" state={{ from: "/vibe" }}>
                  로그인하고 연습하기
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              )}
              <p>
                코드와 대화는 응답·평가를 위해 외부 서비스에 전송되고, 연습
                기록은 서버에 저장됩니다.
              </p>
            </div>
          </section>
        ))
      )}
      {catalog.data &&
      (!catalog.data.availability.ai || !catalog.data.availability.runner) ? (
        <p className="notice-inline" role="status">
          {!catalog.data.availability.ai
            ? "대화 기능이 아직 준비되지 않았습니다. "
            : ""}
          {!catalog.data.availability.runner
            ? "프로젝트 실행기가 아직 준비되지 않았습니다. "
            : ""}
          연습을 열고 코드를 작성할 수 있으며, 연결이 준비되면 대화와 실행을
          사용할 수 있습니다.
        </p>
      ) : null}
      {session ? (
        <section className="vibe-history">
          <h2>최근 연습</h2>
          {history.error ? (
            <p className="error-message" role="alert">
              {history.error}{" "}
              <button className="inline-button" onClick={history.retry}>
                다시 시도
              </button>
            </p>
          ) : history.loading ? (
            <SkeletonRows count={2} />
          ) : history.data.length ? (
            history.data.map((item) => (
              <Link
                key={item.id}
                to={`/vibe/attempts/${item.id}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <div>
                  <strong>게시글 검색 API 개선하기</strong>
                  <span className="sr-only">(새 탭에서 열려요)</span>
                  <span>
                    {new Date(item.startedAt).toLocaleString("ko-KR")} ·{" "}
                    {item.submittedAt
                      ? "제출 완료"
                      : Date.parse(item.deadlineAt) > Date.now()
                        ? "연습 중"
                        : "시간 종료"}
                  </span>
                </div>
                <span>
                  {item.report
                    ? `결과물 ${item.report.outcome}/40`
                    : "이어서 보기"}{" "}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
              </Link>
            ))
          ) : (
            <p className="empty-state">
              첫 연습을 시작하면 여기에 기록이 남아요.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
