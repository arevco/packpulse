import "./storage-shim.js";
import "@fontsource/inter/index.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import AuthGate from "./AuthGate.jsx";
import App from "./App.jsx";

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENV || "production",
    enabled: import.meta.env.PROD,
    sampleRate: 1.0,
    tracesSampleRate: 0.2,
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif", color: "#888" }}>Something went wrong. Please refresh the page.</div>}>
      <AuthGate>
        <App />
      </AuthGate>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
