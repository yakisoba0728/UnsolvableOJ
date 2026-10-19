import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 제목 옆 배지(개수 등) */
  badge?: ReactNode;
  /** 오른쪽 정렬 영역(주요 행동, 상태 등) */
  aside?: ReactNode;
  /** 상위 화면으로 돌아가는 링크 */
  back?: { to: string; label: string };
  /** 보조 문구 아래 추가 요소 */
  children?: ReactNode;
}

/** 모든 일반 화면이 공유하는 머리글: [뒤로] 제목(32/700) + 설명(14) + 오른쪽 영역 */
export function PageHeader({
  title,
  description,
  badge,
  aside,
  back,
  children,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      {back ? (
        <Link className="back-link" to={back.to}>
          ← {back.label}
        </Link>
      ) : null}
      <div className="page-header-row">
        <div className="page-header-main">
          <div className="page-title-line">
            <h1>{title}</h1>
            {badge}
          </div>
          {description ? <p>{description}</p> : null}
          {children}
        </div>
        {aside ? <div className="page-header-aside">{aside}</div> : null}
      </div>
    </header>
  );
}
