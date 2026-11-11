import { ApiError } from "./api";

export const invalidResourceIdMessage =
  "주소 형식이 올바르지 않습니다. 목록에서 다시 선택해 주세요.";

/** 400 전체가 아니라 UUID 경로 검증 오류만 영구적인 주소 오류로 구분한다. */
export function isInvalidResourceId(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 400 &&
    /uuid is expected/i.test(error.message)
  );
}
