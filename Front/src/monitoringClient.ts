import { isEmailActionPath, redactTelemetry } from "./monitoringPrivacy.ts";

type MonitoringSdk = typeof import("./monitoringSdk");

/** Load optional telemetry only when configured, and check privacy again after loading. */
export function createMonitoringClient({
  dsn,
  environment,
  getPath,
  load,
}: {
  dsn?: string;
  environment: string;
  getPath: () => string;
  load: () => Promise<MonitoringSdk>;
}) {
  let initializing: Promise<MonitoringSdk | null> | undefined;
  const permitted = () => Boolean(dsn) && !isEmailActionPath(getPath());
  function client(): Promise<MonitoringSdk | null> {
    if (!permitted()) return Promise.resolve(null);
    return initializing ??= load()
      .then((sdk) => {
        // Navigation may have entered a bearer-token action page while the SDK loaded.
        if (!permitted()) {
          initializing = undefined;
          return null;
        }
        sdk.init({
          dsn,
          environment,
          tracesSampleRate: 0,
          beforeBreadcrumb: (breadcrumb) => permitted() ? redactTelemetry(breadcrumb) : null,
          beforeSend: (event) => permitted() ? redactTelemetry(event) : null,
          ignoreErrors: [
            "ResizeObserver loop limit exceeded",
            "ResizeObserver loop completed with undelivered notifications.",
          ],
          denyUrls: [/^chrome-extension:\/\//, /^moz-extension:\/\//],
        });
        return sdk;
      })
      .catch(() => {
        // A blocked telemetry download must not prevent the application from loading.
        initializing = undefined;
        return null;
      });
  }
  return {
    init() {
      void client();
    },
    report(error: unknown, componentStack?: string | null) {
      if (!permitted()) return;
      void client().then((sdk) => {
        if (sdk && permitted()) sdk.captureException(error, {
          contexts: componentStack ? { react: { componentStack } } : undefined,
        });
      }).catch(() => {});
    },
  };
}
