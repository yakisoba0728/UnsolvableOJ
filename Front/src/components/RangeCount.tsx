import { pageRange, pageRangeTitle } from "../pageRange";
import { Skeleton } from "./Skeleton";

/**
 * 목록 머리의 "1–10 / 32" 같은 쪽 범위. 화면 낭독기에는 풀어 쓴 문장을 따로 읽어 준다.
 * withTitle이면 마우스를 올렸을 때도 풀어 쓴 문장을 보인다.
 */
export function RangeCount({
  loading,
  first,
  count,
  total,
  withTitle = false,
}: {
  loading: boolean;
  /** 이 쪽 첫 항목의 0부터 센 위치 */
  first: number;
  count: number;
  total: number;
  withTitle?: boolean;
}) {
  if (loading)
    return (
      <span className="total-count">
        <Skeleton width={80} height={14} />
      </span>
    );
  const title = pageRangeTitle(first, count, total);
  return (
    <>
      <span
        className="total-count"
        aria-hidden="true"
        title={withTitle ? title : undefined}
      >
        {pageRange(first, count, total)}
      </span>
      <span className="sr-only">{title}</span>
    </>
  );
}
