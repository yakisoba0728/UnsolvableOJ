import { Link } from "react-router-dom";
import { PageHeader } from "./PageHeader";

interface ComingSoonProps {
  title: string;
  description: string;
  points: string[];
  cta: { to: string; label: string };
}

/** 백엔드가 아직 없는 메뉴: 가짜 데이터 대신 계획된 내용과 지금 할 수 있는 행동을 안내한다. */
export function ComingSoonPage({
  title,
  description,
  points,
  cta,
}: ComingSoonProps) {
  return (
    <div className="page-width soon-page">
      <PageHeader title={title} description={description} />
      <div className="soon-card">
        <span className="soon-badge">준비 중</span>
        <h2>이런 기능이 들어옵니다</h2>
        <ul>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <Link className="button" to={cta.to}>
          {cta.label} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
