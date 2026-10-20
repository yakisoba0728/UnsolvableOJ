import type { CSSProperties } from "react";

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  /** 알약·원 모양이 필요할 때 */
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}

/** 서버 값을 기다리는 동안 자리를 채우는 로딩 표시. 0 같은 임시 값 대신 쓴다. */
export function Skeleton({
  width = "100%",
  height = 14,
  radius,
  className = "",
  style,
}: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** 불러오는 영역을 감싼다. 시각적으로는 skeleton을 보이고, 보조기기에는 한 번만 알린다. */
export function SkeletonRegion({
  label = "불러오는 중입니다",
  className = "",
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className} aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

/** 목록(data-list) 행 모양 로딩 표시 */
export function SkeletonRows({
  count = 6,
  columns = 4,
}: {
  count?: number;
  columns?: number;
}) {
  return (
    <SkeletonRegion className="skeleton-rows data-list">
      {Array.from({ length: count }, (_, row) => (
        <div className="skeleton-row" key={row}>
          <span className="skeleton-title">
            <Skeleton width={`${55 + ((row * 17) % 35)}%`} height={16} />
            <Skeleton width="30%" height={12} />
          </span>
          {Array.from({ length: columns - 1 }, (_, column) => (
            <Skeleton key={column} width="60%" height={14} />
          ))}
        </div>
      ))}
    </SkeletonRegion>
  );
}
