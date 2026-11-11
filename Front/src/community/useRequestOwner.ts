import { useAuth } from "../auth";
import { useMountedRef } from "../hooks";

/**
 * 요청을 보낼 때 begin()을 부르고, 응답이 오면 돌려받은 함수로 아직 이 요청의 주인인지 확인한다.
 * 화면을 벗어났거나(언마운트·다른 주소로 이동) 계정이 바뀌었으면 늦게 온 응답을 버린다.
 */
export function useRequestOwner(getNavigationVersion: () => number) {
  const { getSessionVersion } = useAuth();
  const mounted = useMountedRef();
  return function begin() {
    const navigationVersion = getNavigationVersion();
    const sessionVersion = getSessionVersion();
    return () =>
      mounted.current &&
      getNavigationVersion() === navigationVersion &&
      getSessionVersion() === sessionVersion;
  };
}
