const labels: Record<string, string> = {
  QUEUED: "채점 대기",
  JUDGING: "채점 중",
  ACCEPTED: "성공",
  WRONG_ANSWER: "틀림",
  TIME_LIMIT_EXCEEDED: "시간 초과",
  MEMORY_LIMIT_EXCEEDED: "메모리 초과",
  RUNTIME_ERROR: "런타임 에러",
  COMPILE_ERROR: "컴파일 실패",
  OUTPUT_LIMIT_EXCEEDED: "출력 초과",
  SYSTEM_ERROR: "시스템 오류",
  CANCELLED: "취소됨",
};

export const verdictLabel = (status: string) =>
  labels[status] ?? status.replaceAll("_", " ");
