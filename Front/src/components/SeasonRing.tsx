interface SeasonRingProps {
  done: number;
  total: number;
  daysLeft: number;
  /** 시즌 이름(링 아래 첫 줄) */
  title: string;
}

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 이번 달 미션 달성 횟수를 원형 진행 링으로 보여 주고, 아래에 시즌 이름과 남은 일 수를 둔다. */
export function SeasonRing({ done, total, daysLeft, title }: SeasonRingProps) {
  const ratio = total ? Math.min(1, done / total) : 0;
  return (
    <section className="season-ring" aria-label="시즌 진행">
      <div
        className="season-ring-chart"
        role="img"
        aria-label={`이번 달 미션 달성 ${done} / ${total}회`}
      >
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle className="season-ring-track" cx="60" cy="60" r={RADIUS} />
          <circle
            className="season-ring-arc"
            cx="60"
            cy="60"
            r={RADIUS}
            transform="rotate(-90 60 60)"
            style={{ "--ring-full": CIRCUMFERENCE } as React.CSSProperties}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
          />
        </svg>
        <strong>{Math.round(ratio * 100)}%</strong>
      </div>
      <div className="season-ring-text">
        <h2>{title}</h2>
        <span>D-{daysLeft}</span>
      </div>
    </section>
  );
}
