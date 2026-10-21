import { useCallback, useEffect, type RefObject } from "react";
import { useBlocker } from "react-router-dom";

export function useUnsavedChanges(
  dirty: boolean,
  bypass: RefObject<boolean>,
): void {
  const blocker = useBlocker(
    useCallback(() => dirty && !bypass.current, [dirty, bypass]),
  );

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (
      bypass.current ||
      window.confirm("저장하지 않은 내용이 있어요. 나갈까요?")
    )
      blocker.proceed();
    else blocker.reset();
  }, [blocker, bypass]);

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
}
