/** 학습 진입 카드용 작은 일러스트(코드 카드 + 성장 막대). Figma "학습 카드 / 표현 원칙" 자리. */
export function LearningIllustration() {
  return (
    <svg
      className="learning-illustration"
      viewBox="0 0 340 220"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="200" y="140" width="28" height="60" rx="8" fill="#c5d6fb" />
      <rect x="236" y="110" width="28" height="90" rx="8" fill="#7fa1f2" />
      <rect x="272" y="76" width="28" height="124" rx="8" fill="#3b6be0" />
      <rect x="308" y="36" width="28" height="164" rx="8" fill="#1d4fd8" />
      <path
        d="M206 118 L246 88 L282 58 L318 20"
        stroke="#137547"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M306 18 L320 18 L320 32" stroke="#137547" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="8" y="60" width="180" height="128" rx="16" fill="#fff" stroke="#c9d6f2" strokeWidth="2" />
      <rect x="8" y="60" width="180" height="26" rx="16" fill="#243247" />
      <rect x="8" y="76" width="180" height="10" fill="#243247" />
      <circle cx="26" cy="73" r="4" fill="#7f90a8" />
      <circle cx="40" cy="73" r="4" fill="#7f90a8" />
      <rect x="26" y="102" width="70" height="9" rx="4.5" fill="#1d4fd8" />
      <rect x="40" y="120" width="112" height="9" rx="4.5" fill="#c5d6fb" />
      <rect x="40" y="138" width="78" height="9" rx="4.5" fill="#c5d6fb" />
      <rect x="26" y="156" width="52" height="9" rx="4.5" fill="#1d4fd8" />
      <circle cx="160" cy="160" r="16" fill="#e3f7ec" />
      <path d="M152 160 L158 166 L169 153" stroke="#137547" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
