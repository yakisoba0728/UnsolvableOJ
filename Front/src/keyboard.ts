import type { KeyboardEvent } from "react";

/**
 * 한국어 입력 조합을 확정하는 키 입력인지 알려 준다. 이때의 Enter는 글자 확정이지 제출이 아니다.
 * Safari는 조합이 끝난 뒤의 Enter를 isComposing=false, keyCode=229로 보내므로
 * 일반 입력까지 막지 않도록 keyCode는 Enter일 때만 본다.
 */
export const isImeEnter = (event: KeyboardEvent) =>
  event.nativeEvent.isComposing ||
  (event.key === "Enter" && event.keyCode === 229);
