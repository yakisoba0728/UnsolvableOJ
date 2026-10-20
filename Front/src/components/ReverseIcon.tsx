/**
 * 순서 뒤집기(위아래 화살표) 아이콘. playKey가 바뀔 때마다 위쪽 화살표는 위로,
 * 아래쪽 화살표는 아래로 움직였다가 제자리로 돌아온다. 평소에는 정지한 아이콘이다.
 * 움직임은 CSS(.reverse-arrow-*)에 있고, 모션 감소 설정에서는 멈춘다.
 */
export function ReverseIcon({ playKey }: { playKey: number }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  // key를 바꿔 요소를 새로 만들면 애니메이션이 처음부터 다시 실행된다.
  return (
    <svg
      className="reverse-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      {...stroke}
    >
      <g key={`up-${playKey}`} className={playKey ? "reverse-arrow-up" : ""}>
        <path d="m3 8 4-4 4 4" />
        <path d="M7 4v16" />
      </g>
      <g
        key={`down-${playKey}`}
        className={playKey ? "reverse-arrow-down" : ""}
      >
        <path d="m21 16-4 4-4-4" />
        <path d="M17 20V4" />
      </g>
    </svg>
  );
}
