import * as Sentry from "@sentry/react";

/**
 * 버그 모니터링(Sentry). VITE_SENTRY_DSN이 없으면 아무것도 하지 않는다.
 * 오류만 수집하고, 세션 녹화·성능 추적은 켜지 않으며 사용자 식별 정보는 보내지 않는다.
 */
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export const monitoringEnabled = Boolean(dsn);

export function initMonitoring() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment:
      (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) ??
      import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    tracesSampleRate: 0,
    // 브라우저 확장 프로그램이나 네트워크 일시 오류처럼 우리 코드와 무관한 잡음 제외
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
    ],
    denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//],
  });
}

export function reportError(error: unknown, componentStack?: string | null) {
  if (!dsn) return;
  Sentry.captureException(error, {
    contexts: componentStack ? { react: { componentStack } } : undefined,
  });
}
