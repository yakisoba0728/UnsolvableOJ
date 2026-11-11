import { useState, type ReactNode } from "react";
import type { SolveState } from "./ProblemStatus";
import { ReverseIcon } from "./ReverseIcon";
import { ShuffleIcon } from "./ShuffleIcon";

/** 문제 목록·코드 분석 목록이 함께 쓰는 정렬·바로가기 조각 */

/** 무작위일 때는 다시 섞기, 아니면 순서 뒤집기. 누를 때마다 아이콘 애니메이션을 처음부터 다시 튼다. */
export function OrderButton({
  random,
  reversed,
  disabled,
  onShuffle,
  onReverse,
}: {
  random: boolean;
  reversed: boolean;
  disabled: boolean;
  onShuffle: () => void;
  onReverse: () => void;
}) {
  // 키가 바뀌면 애니메이션이 처음부터 다시 실행된다.
  const [spinKey, setSpinKey] = useState(0);
  const [reverseKey, setReverseKey] = useState(0);
  return random ? (
    <button
      type="button"
      className="shuffle-icon-button"
      aria-label="무작위로 다시 섞기"
      title="무작위로 다시 섞기"
      onClick={() => {
        setSpinKey((key) => key + 1);
        onShuffle();
      }}
      disabled={disabled}
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
        onReverse();
      }}
      disabled={disabled}
    >
      <ReverseIcon playKey={reverseKey} />
    </button>
  );
}

/** 목록 제목 옆 "무작위 순서" 표시와 기본 순서로 돌아가는 버튼 */
export function RandomOrderNotice({ onReset }: { onReset: () => void }) {
  return (
    <>
      <span className="pill pill-primary">무작위 순서</span>
      <button type="button" className="inline-button" onClick={onReset}>
        기본 순서로
      </button>
    </>
  );
}

export type FilterChange = Record<string, string | null>;

/**
 * 자주 쓰는 조건을 한 번에 거는 바로가기. 이미 그 조건이면 눌린 상태로 보인다.
 * showUnsolved가 거짓이면(로그인 전 등) '안 푼 문제만' 바로가기를 숨긴다. children은 목록 아래에 붙는다.
 */
export function FinderGuide({
  difficulties,
  statuses,
  showUnsolved = true,
  onPick,
  children,
}: {
  difficulties: readonly string[];
  statuses: readonly SolveState[];
  showUnsolved?: boolean;
  onPick: (change: FilterChange) => void;
  children?: ReactNode;
}) {
  const only = <T,>(values: readonly T[], value: T) =>
    values.length === 1 && values[0] === value;
  const shortcuts = [
    {
      title: "쉬운 난이도로 시작하기",
      hint: "부담 없는 문제부터 차근차근",
      pressed: only(difficulties, "BEGINNER"),
      change: { d: "BEGINNER" } as FilterChange,
    },
    {
      title: "보통 난이도에 도전하기",
      hint: "익숙해졌다면 한 단계 위로",
      pressed: only(difficulties, "MEDIUM"),
      change: { d: "MEDIUM" } as FilterChange,
    },
    ...(showUnsolved
      ? [
          {
            title: "아직 안 푼 문제만 보기",
            hint: "새로운 문제에 집중해요",
            pressed: only(statuses, "none") && !difficulties.length,
            change: { s: "none", d: null } as FilterChange,
          },
        ]
      : []),
  ];
  return (
    <div className="guide-card">
      <h2>나에게 맞는 문제 찾기</h2>
      <ol>
        {shortcuts.map((item) => (
          <li key={item.title}>
            <button aria-pressed={item.pressed} onClick={() => onPick(item.change)}>
              <strong>{item.title}</strong>
              <span>{item.hint}</span>
              <i className="row-chevron" aria-hidden="true">
                ›
              </i>
            </button>
          </li>
        ))}
      </ol>
      {children}
    </div>
  );
}
