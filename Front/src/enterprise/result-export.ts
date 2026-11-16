import { api } from "../api";

export async function fetchResultCsv(token: string, id: string, signal: AbortSignal) {
  const csv = await api<string>(`/enterprise/tests/${id}/results/export`, {
    responseType: "text", signal, cache: "no-store", headers: { Accept: "text/csv" },
  }, token);
  // Reject an HTML fallback or a stale/incompatible download contract. Fetch
  // may strip the BOM during UTF-8 decoding; restore it in the saved file.
  if (typeof csv !== "string" || !csv.replace(/^\uFEFF/, "").startsWith('"username","started_at_utc","deadline_at_utc","finished_at_utc",'))
    throw new Error("내보내기 응답을 확인하지 못했어요. 다시 시도해 주세요.");
  return csv.startsWith("\uFEFF") ? csv : `\uFEFF${csv}`;
}

/** Call only after verifying the request still belongs to this account/route. */
export function downloadResultCsv(csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "enterprise-results.csv";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    // Revoke after the browser has consumed the click, including Safari.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
