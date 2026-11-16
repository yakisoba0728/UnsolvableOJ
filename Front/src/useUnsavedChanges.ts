import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useBlocker } from "react-router-dom";
import { useConfirm } from "./components/ConfirmDialog";

/**
 * 저장하지 않은 내용이 있을 때 화면 안 이동(링크·뒤로 가기)을 막고 확인 창으로 묻는다.
 * 반환값(확인 창)을 화면 어딘가에 그려 둬야 한다. 탭 닫기·새로고침은 브라우저가 정한 기본 안내를 쓴다(웹페이지가 모양을 바꿀 수 없다).
 */
export function useUnsavedChanges(
  dirty: boolean,
  bypass: RefObject<boolean>,
): ReactNode {
  const [confirm, dialog] = useConfirm();
  const blocker = useBlocker(
    useCallback(() => dirty && !bypass.current, [dirty, bypass]),
  );
  const asking = useRef(false);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (bypass.current) {
      blocker.proceed();
      return;
    }
    // 확인 창이 떠 있는 동안 blocker가 다시 그려져도 같은 질문을 겹쳐 열지 않는다.
    if (asking.current) return;
    asking.current = true;
    void confirm({
      title: "저장하지 않은 내용이 있어요",
      message: "지금 나가면 저장하지 않은 내용이 사라져요. 나갈까요?",
      confirmLabel: "나가기",
      danger: true,
    }).then((leave) => {
      asking.current = false;
      if (leave) blocker.proceed();
      else blocker.reset();
    });
  }, [blocker, bypass, confirm]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (bypass.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, bypass]);

  return dialog;
}
