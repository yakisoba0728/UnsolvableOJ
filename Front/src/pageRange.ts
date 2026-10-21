/**
 * 목록 머리글의 "현재 페이지 범위 / 총 개수" 표시. 문제 목록과 커뮤니티 목록이 같은 형식을 쓴다.
 * - `offset`: 이 페이지 앞에 있는 항목 수, `shown`: 이 페이지에 나열된 항목 수, `total`: 전체 항목 수
 * - 예: 1 - 10/16, 11 - 16/16, 비었으면 0/0
 */
export function pageRange(offset: number, shown: number, total: number) {
  const ok = (value: number) => Number.isFinite(value) && value >= 0;
  if (!ok(offset) || !ok(shown) || !ok(total) || shown === 0 || total === 0)
    return "0/0";
  const first = Math.floor(offset) + 1;
  const last = Math.floor(offset) + Math.floor(shown);
  return `${first} - ${Math.min(last, Math.floor(total))}/${Math.floor(total)}`;
}

/** 스크린리더·툴팁용 풀어쓴 설명. */
export function pageRangeTitle(offset: number, shown: number, total: number) {
  if (pageRange(offset, shown, total) === "0/0") return "표시할 항목이 없어요";
  const label = pageRange(offset, shown, total);
  const [range, all] = label.split("/");
  return `전체 ${all}개 중 ${range.replace(" - ", "번부터 ")}번째까지`;
}
