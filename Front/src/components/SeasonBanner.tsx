interface SeasonBannerProps {
  label: string;
  done: number;
  total: number;
  daysLeft: number;
}

/**
 * 시즌 카드(알림 띠) 보관본: 제목과 원형 달성 횟수, D-day를 한 카드에 가로로 놓은 이전 배치.
 * 지금은 미션 화면에서 쓰지 않고(SeasonRing으로 대체) 스타일(.season-card 등)과 함께 남겨 둔다.
 */
export function SeasonBannerLegacy({
  label,
  done,
  total,
  daysLeft,
}: SeasonBannerProps) {
  return (
    <section className="season-card" aria-label="시즌 진행">
      <div className="season-main">
        <span className="pill pill-primary">{label}</span>
        <h2>알고리즘 마스터</h2>
      </div>
      <div className="season-stats">
        <div
          className="season-badge"
          role="img"
          aria-label={`이번 달 미션 달성 ${done} / ${total}회`}
        >
          {done} / {total}
        </div>
        <div className="season-dday">
          <strong>D-{daysLeft}</strong>
          <span>시즌 종료까지</span>
        </div>
      </div>
    </section>
  );
}
