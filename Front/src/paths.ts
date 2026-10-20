/** 문제 상세 화면 주소. 슬러그에 특수문자가 있어도 안전하게 인코딩한다. */
export const problemPath = (slug: string) =>
  `/problems/view/${encodeURIComponent(slug)}`;

/** 코드 분석 문제 화면 주소 */
export const analysisPath = (id: string) =>
  `/analysis/${encodeURIComponent(id)}`;
