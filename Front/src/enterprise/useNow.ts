import { useEffect, useState } from "react";

/** 상태(예정·진행 중·마감)가 시간에 따라 바뀌므로 주기적으로 현재 시각을 갱신한다. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
