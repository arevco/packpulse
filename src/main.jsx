import "./storage-shim.js";
import "@fontsource/inter/index.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate.jsx";
import App from "./App.jsx";
import AppErrorBoundary from "./components/AppErrorBoundary.jsx";
import { scheduleSentryClientBoot } from "./lib/sentryClient.js";
import { initSupabaseClient } from "./lib/supabaseClient.js";

window.addEventListener("vite:preloadError", function(event) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  var key = "__pp_chunk_reload_once__";
  try {
    var alreadyReloaded = sessionStorage.getItem(key) === "1";
    if (!alreadyReloaded) {
      sessionStorage.setItem(key, "1");
      window.location.reload();
    }
  } catch (_) {
    window.location.reload();
  }
});

initSupabaseClient();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <AuthGate>
        <App />
      </AuthGate>
    </AppErrorBoundary>
  </React.StrictMode>
);

scheduleSentryClientBoot();
