/** Mail action links are bearer secrets, including when a prior URL is a breadcrumb. */
export function isEmailActionPath(pathname: string) {
  return /^\/email\/(?:verify|unsubscribe)\/*$/i.test(pathname);
}

function containsSecret(value: string) {
  let decoded = value;
  // URL values in telemetry may already be encoded once by another integration.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      /\/email\/(?:verify|unsubscribe)(?:[/?#\s"']|$)/i.test(decoded) ||
      /["']?\b(?:token|password|authorization|cookie)["']?\s*[:=]/i.test(
        decoded,
      )
    )
      return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return false;
}

/** Scrub complete values rather than retaining a partially parsed secret URL/body. */
export function redactTelemetry<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (current: unknown, key = ""): unknown => {
    if (/token|password|authorization|cookie/i.test(key)) return "[redacted]";
    if (typeof current === "string")
      return containsSecret(current) ? "[redacted]" : current;
    if (!current || typeof current !== "object") return current;
    if (seen.has(current)) return "[circular]";
    seen.add(current);
    if (Array.isArray(current)) return current.map((item) => visit(item));
    return Object.fromEntries(
      Object.entries(current).map(([name, item]) => [name, visit(item, name)]),
    );
  };
  return visit(value) as T;
}
