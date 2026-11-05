import { useRef } from "react";
import { Link } from "react-router-dom";
import { verdictLabel } from "../verdict";
import type { Submission } from "../types";
import {
  CaseResults,
  isJudging,
  ResultNotices,
  ResultSummary,
} from "./JudgeResult";

// 채점 결과 패널의 높이(px): 위쪽 손잡이를 끌거나 ↑↓ 키로 조절하고, 마지막 값을 기억한다.
const panelHeightKey = "unsolvable-oj-judge-height-v1";
const PANEL_MIN = 120;
const PANEL_DEFAULT = 260;
const PANEL_KEY_STEP = 24;

export function readPanelHeight() {
  try {
    const saved = Number(localStorage.getItem(panelHeightKey));
    return saved >= PANEL_MIN ? saved : PANEL_DEFAULT;
  } catch {
    return PANEL_DEFAULT;
  }
}

export function JudgePanel({
  result,
  error,
  open,
  height,
  onHeightChange,
  onToggle,
  onClose,
}: {
  result: Submission | null;
  error: string;
  open: boolean;
  height: number;
  onHeightChange: (height: number) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  // 코드 입력 칸이 최소한 남도록, 결과 패널은 코드 패널 높이에서 일정 부분을 뺀 만큼까지만 키운다.
  function clampPanelHeight(value: number) {
    const room = panelRef.current?.parentElement?.clientHeight ?? 800;
    return Math.round(
      Math.min(Math.max(PANEL_MIN, room - 200), Math.max(PANEL_MIN, value)),
    );
  }
  function savePanelHeight(value: number) {
    try {
      localStorage.setItem(panelHeightKey, String(value));
    } catch {
      /* 저장할 수 없어도 화면은 그대로 동작한다 */
    }
  }

  function startPanelResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = panelRef.current?.offsetHeight ?? height;
    let latest = startHeight;
    const move = (moveEvent: PointerEvent) => {
      latest = clampPanelHeight(startHeight + (startY - moveEvent.clientY));
      onHeightChange(latest);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      savePanelHeight(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }
  function resizePanelByKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta =
      event.key === "ArrowUp"
        ? PANEL_KEY_STEP
        : event.key === "ArrowDown"
          ? -PANEL_KEY_STEP
          : 0;
    if (!delta) return;
    event.preventDefault();
    const next = clampPanelHeight(height + delta);
    onHeightChange(next);
    savePanelHeight(next);
  }

  return (
    <section
      ref={panelRef}
      className="judge-panel"
      aria-label="채점 결과"
      style={open ? { height } : undefined}
    >
      {open ? (
        <div
          className="judge-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="채점 결과 높이 조절"
          aria-valuemin={PANEL_MIN}
          aria-valuenow={height}
          tabIndex={0}
          title="위아래로 끌어 높이를 조절해요 (↑↓ 키도 가능)"
          onPointerDown={startPanelResize}
          onKeyDown={resizePanelByKey}
        />
      ) : null}
      <div className="judge-panel-head">
        <strong>채점 결과</strong>
        {result ? (
          <span
            role="status"
            className={`verdict verdict-${result.status.toLowerCase()}`}
          >
            {verdictLabel(result.status)}
          </span>
        ) : null}
        <span className="judge-panel-actions">
          {result ? (
            <Link
              className="text-button"
              to={`/submissions/${result.id}`}
            >
              자세히 보기
            </Link>
          ) : null}
          <button
            type="button"
            className="text-button"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "접기" : "펼치기"}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onClose}
          >
            닫기
          </button>
        </span>
      </div>
      {open ? (
        <div className="judge-panel-body">
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          {!result ? (
            <p className="muted">채점을 시작하고 있어요…</p>
          ) : (
            <>
              {isJudging(result) ? (
                <p className="muted">
                  채점 중이에요. 끝나면 이 자리에 결과가 나타납니다.
                </p>
              ) : null}
              <ResultSummary submission={result} />
              <ResultNotices submission={result} />
              <CaseResults submission={result} />
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
