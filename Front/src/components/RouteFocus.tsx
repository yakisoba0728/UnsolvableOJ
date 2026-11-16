import { useLayoutEffect, type RefObject } from "react";

/** Focus the destination only after its lazy route commits. Filtering/search,
 * hash navigation and token refresh do not take focus out of an active control.
 * preventScroll keeps the shell's push/pop scroll policy separate from focus.
 */
export function RouteFocus({
  pathname,
  hash,
  target,
  committedPath,
}: {
  pathname: string;
  hash: string;
  target: RefObject<HTMLElement | null>;
  committedPath: RefObject<string>;
}) {
  useLayoutEffect(() => {
    const changed = committedPath.current !== pathname;
    committedPath.current = pathname;
    if (!changed || hash) return;
    target.current?.focus({ preventScroll: true });
  }, [pathname, hash, target, committedPath]);
  return null;
}
