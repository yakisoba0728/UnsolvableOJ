import { createMonitoringClient } from "./monitoringClient";

/** Optional error monitoring: no session replay, performance traces or user identification. */
const monitoring = createMonitoringClient({
  dsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  environment: import.meta.env.MODE,
  getPath: () => window.location.pathname,
  load: () => import("./monitoringSdk"),
});

export function initMonitoring() {
  monitoring.init();
}

export function reportError(error: unknown, componentStack?: string | null) {
  monitoring.report(error, componentStack);
}
