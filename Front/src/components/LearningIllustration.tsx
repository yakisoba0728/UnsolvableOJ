import type { CSSProperties } from "react";

const fill = (value: string): CSSProperties => ({ fill: value });
const stroke = (value: string, width = 5): CSSProperties => ({
  stroke: value,
  strokeWidth: width,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
});

/** 학습 진입 카드용 작은 일러스트(코드 카드 + 성장 막대). 색은 테마 토큰을 따른다. */
export function LearningIllustration() {
  return (
    <svg
      className="learning-illustration"
      viewBox="0 0 340 220"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="200" y="140" width="28" height="60" rx="8" style={fill("var(--heat-1)")} />
      <rect x="236" y="110" width="28" height="90" rx="8" style={fill("var(--heat-2)")} />
      <rect x="272" y="76" width="28" height="124" rx="8" style={fill("var(--heat-3)")} />
      <rect x="308" y="36" width="28" height="164" rx="8" style={fill("var(--heat-4)")} />
      <path d="M206 118 L246 88 L282 58 L318 20" style={stroke("var(--color-success)")} />
      <path d="M306 18 L320 18 L320 32" style={stroke("var(--color-success)")} />
      <rect
        x="8"
        y="60"
        width="180"
        height="128"
        rx="16"
        style={{ fill: "var(--color-surface)", stroke: "var(--color-feature-border)", strokeWidth: 2 }}
      />
      <rect x="8" y="60" width="180" height="26" rx="16" style={fill("var(--color-code)")} />
      <rect x="8" y="76" width="180" height="10" style={fill("var(--color-code)")} />
      <circle cx="26" cy="73" r="4" style={fill("#7f90a8")} />
      <circle cx="40" cy="73" r="4" style={fill("#7f90a8")} />
      <rect x="26" y="102" width="70" height="9" rx="4.5" style={fill("var(--color-primary)")} />
      <rect x="40" y="120" width="112" height="9" rx="4.5" style={fill("var(--heat-1)")} />
      <rect x="40" y="138" width="78" height="9" rx="4.5" style={fill("var(--heat-1)")} />
      <rect x="26" y="156" width="52" height="9" rx="4.5" style={fill("var(--color-primary)")} />
      <circle cx="160" cy="160" r="16" style={fill("var(--color-success-soft)")} />
      <path d="M152 160 L158 166 L169 153" style={stroke("var(--color-success)", 4)} />
    </svg>
  );
}
