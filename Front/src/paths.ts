export const problemPath = (slug: string) =>
  `/problems/view/${encodeURIComponent(slug)}`;

/** 코드 분석 문제 화면 주소 */
export const analysisPath = (id: string) =>
  `/analysis/${encodeURIComponent(id)}`;
