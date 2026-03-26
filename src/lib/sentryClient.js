function isHeapNetworkFailure(event, hint) {
  var value = String(
    event &&
    event.exception &&
    Array.isArray(event.exception.values) &&
    event.exception.values[0] &&
    event.exception.values[0].value || ""
  );
  var message = String(event && event.message || "");
  var original = hint && hint.originalException;
  var originalMessage = String(
    original && (original.message || original.toString && original.toString()) || ""
  );
  var combined = [value, message, originalMessage].join(" ").toLowerCase();
  return combined.indexOf("heap-api.com") !== -1 || combined.indexOf(" heap ") !== -1 && combined.indexOf("failed to fetch") !== -1;
}

var sentryModulePromise = null;
var sentryInitPromise = null;
var sentryBootScheduled = false;

function loadSentryModule() {
  if (!import.meta.env.VITE_SENTRY_DSN) return Promise.resolve(null);
  if (!sentryModulePromise) {
    sentryModulePromise = import("@sentry/react")
      .then(function(mod) {
        return mod || null;
      })
      .catch(function() {
        return null;
      });
  }
  return sentryModulePromise;
}

function initSentryClient() {
  if (!import.meta.env.VITE_SENTRY_DSN) return Promise.resolve(null);
  if (!sentryInitPromise) {
    sentryInitPromise = loadSentryModule().then(function(Sentry) {
      if (!Sentry) return null;
      Sentry.init({
        dsn: import.meta.env.VITE_SENTRY_DSN,
        environment: import.meta.env.VITE_SENTRY_ENV || "production",
        enabled: import.meta.env.PROD,
        sampleRate: 1.0,
        tracesSampleRate: 0.2,
        beforeSend: function(event, hint) {
          if (isHeapNetworkFailure(event, hint)) return null;
          return event;
        },
      });
      return Sentry;
    });
  }
  return sentryInitPromise;
}

export function scheduleSentryClientBoot() {
  if (typeof window === "undefined" || !import.meta.env.VITE_SENTRY_DSN || sentryBootScheduled) return;
  sentryBootScheduled = true;

  var boot = function() {
    initSentryClient();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(boot, { timeout: 2500 });
    return;
  }

  window.setTimeout(boot, 1500);
}

export function captureClientException(error, context) {
  return initSentryClient()
    .then(function(Sentry) {
      if (Sentry && typeof Sentry.captureException === "function") {
        Sentry.captureException(error, context);
      }
    })
    .catch(function() {});
}
