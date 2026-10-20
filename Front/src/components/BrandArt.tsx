import { useId, type CSSProperties } from "react";
import logo from "../assets/logo.png";

const fill = (value: string): CSSProperties => ({ fill: value });
const line = (value: string, width: number): CSSProperties => ({
  stroke: value,
  strokeWidth: width,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  fill: "none",
});

/** 네 갈래 별(반짝임) */
function Sparkle({ x, y, size, color, className }: { x: number; y: number; size: number; color: string; className: string }) {
  const s = size;
  return (
    <path
      className={className}
      d={`M${x} ${y - s} C${x + s * 0.15} ${y - s * 0.15} ${x + s * 0.15} ${y - s * 0.15} ${x + s} ${y} C${x + s * 0.15} ${y + s * 0.15} ${x + s * 0.15} ${y + s * 0.15} ${x} ${y + s} C${x - s * 0.15} ${y + s * 0.15} ${x - s * 0.15} ${y + s * 0.15} ${x - s} ${y} C${x - s * 0.15} ${y - s * 0.15} ${x - s * 0.15} ${y - s * 0.15} ${x} ${y - s}Z`}
      style={fill(color)}
    />
  );
}

/**
 * 사이트 정체성(문제 풀이 · 채점 · 레벨 성장)을 한 장면으로 보여주는 그림.
 * 사이트 로고, 코드 창(정답 체크), 레벨·XP 배지(로그인했을 때만), 상승 막대, 반짝이는 별로 구성한다.
 * 색은 테마 토큰을 따르고, 움직임은 prefers-reduced-motion에서 멈춘다.
 */
export function BrandArt({
  className = "",
  standing,
}: {
  className?: string;
  /** 로그인한 사용자 본인의 레벨·XP. 없으면(로그아웃) 레벨 배지를 그리지 않는다. */
  standing?: { level: number; xp: number } | null;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      className={`brand-art ${className}`}
      viewBox="0 0 380 250"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: "var(--color-primary)", stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${id}-xp`} x1="0" x2="1">
          <stop offset="0%" style={{ stopColor: "var(--heat-2)" }} />
          <stop offset="100%" style={{ stopColor: "var(--heat-4)" }} />
        </linearGradient>
      </defs>

      {/* 빛 번짐 */}
      <ellipse cx="200" cy="130" rx="170" ry="118" fill={`url(#${id}-glow)`} />

      {/* 상승 막대 */}
      <g className="float d3">
        <rect x="288" y="150" width="26" height="62" rx="8" style={fill("var(--heat-1)")} />
        <rect x="320" y="118" width="26" height="94" rx="8" style={fill("var(--heat-2)")} />
        <rect x="352" y="82" width="26" height="130" rx="8" style={fill("var(--heat-3)")} />
        <path d="M292 128 L326 100 L352 74 L376 40" style={line("var(--color-success)", 4.5)} />
        <path d="M365 38 L377 38 L377 50" style={line("var(--color-success)", 4.5)} />
      </g>

      {/* 코드 창 */}
      <g className="float">
        <rect x="70" y="86" width="204" height="132" rx="16" style={{ fill: "var(--color-surface)", stroke: "var(--color-feature-border)", strokeWidth: 2 }} />
        <rect x="70" y="86" width="204" height="28" rx="16" style={fill("var(--color-code)")} />
        <rect x="70" y="100" width="204" height="14" style={fill("var(--color-code)")} />
        <circle cx="90" cy="100" r="4.5" style={fill("#7f90a8")} />
        <circle cx="105" cy="100" r="4.5" style={fill("#7f90a8")} />
        <circle cx="120" cy="100" r="4.5" style={fill("#7f90a8")} />
        <rect x="88" y="128" width="78" height="9" rx="4.5" style={fill("var(--color-button)")} />
        <rect x="104" y="146" width="120" height="9" rx="4.5" style={fill("var(--heat-1)")} />
        <rect x="104" y="164" width="86" height="9" rx="4.5" style={fill("var(--heat-1)")} />
        <rect x="88" y="182" width="58" height="9" rx="4.5" style={fill("var(--color-button)")} />
        <circle cx="238" cy="190" r="19" style={fill("var(--color-success-soft)")} />
        <path d="M229 190 L236 197 L248 183" style={line("var(--color-success)", 4.5)} />
      </g>

      {/* 로고 타일 */}
      <g className="float d2" transform="rotate(-8 80 62)">
        <image href={logo} x="38" y="22" width="84" height="84" />
      </g>

      {/* 레벨 · XP 배지: 로그인한 사용자 본인의 값 (서버 규칙: level = 1 + xp / 100) */}
      {standing ? (
        <g className="float d2">
          <rect x="190" y="26" width="150" height="50" rx="16" style={{ fill: "var(--color-surface)", stroke: "var(--color-feature-border)", strokeWidth: 2 }} />
          <text x="206" y="48" style={{ fontFamily: "var(--font-sans)", fontWeight: 700, fontSize: 14, fill: "var(--color-ink-900)" }}>Lv.{standing.level}</text>
          <text x="324" y="48" textAnchor="end" style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12, fill: "var(--color-ink-600)" }}>{standing.xp.toLocaleString()} XP</text>
          <rect x="206" y="57" width="118" height="8" rx="4" style={fill("var(--color-disabled)")} />
          <rect x="206" y="57" width={Math.max(8, (118 * (standing.xp % 100)) / 100)} height="8" rx="4" fill={`url(#${id}-xp)`} />
        </g>
      ) : null}

      {/* 반짝임 */}
      <Sparkle className="twinkle" x={30} y={150} size={11} color="var(--color-star)" />
      <Sparkle className="twinkle t2" x={168} y={24} size={9} color="var(--color-primary)" />
      <Sparkle className="twinkle t3" x={338} y={22} size={12} color="var(--color-star)" />
      <Sparkle className="twinkle t2" x={284} y={236} size={8} color="var(--color-primary)" />
      <circle className="twinkle t3" cx="52" cy="206" r="5" style={fill("var(--heat-2)")} />
      <circle className="twinkle" cx="360" cy="236" r="4" style={fill("var(--color-success)")} />
      <rect className="twinkle t2" x="14" y="104" width="12" height="5" rx="2.5" transform="rotate(-30 20 106)" style={fill("var(--color-success)")} />
    </svg>
  );
}
