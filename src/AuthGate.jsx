import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient, hasSupabaseConfig } from "./lib/supabaseClient.js";

const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap');";
const DEV_BYPASS_AUTH = import.meta.env.DEV && String(import.meta.env.VITE_DEV_BYPASS_AUTH || "").toLowerCase() === "true";
const DEV_BYPASS_USER = {
  email: import.meta.env.VITE_DEV_BYPASS_EMAIL || "dev@revcopack.local",
  name: import.meta.env.VITE_DEV_BYPASS_NAME || "PackPulse Dev",
  picture: "",
  access: { kind: "internal", domain: "revcopack.local", root_domain: "revcopack.local" },
};
const SESSION_USAGE_HEARTBEAT_MS = 15 * 60 * 1000;
const SESSION_USAGE_ACTIVE_WINDOW_MS = 5 * 60 * 1000;

function getRedirectUrl() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export default function AuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState("");
  const sessionUsageLoggedRef = useRef("");
  const lastInteractionRef = useRef(Date.now());
  const lastActivitySentRef = useRef(0);
  const lastExchangedTokenRef = useRef("");

  const checkSession = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    if (DEV_BYPASS_AUTH) {
      setUser(DEV_BYPASS_USER);
      setChecking(false);
      return { authenticated: true, user: DEV_BYPASS_USER };
    }
    if (!silent) setChecking(true);
    try {
      const r = await fetch("/api/auth/check", { credentials: "include" });
      const data = await r.json();
      if (data && data.authenticated) {
        setUser(data.user || null);
        setError("");
        setLinkSentTo("");
        return data;
      }
      if (!silent) setUser(null);
      return data;
    } catch (_) {
      if (!silent) setUser(null);
      return { authenticated: false };
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  const exchangeSupabaseSession = useCallback(async function(session) {
    if (DEV_BYPASS_AUTH || !session || !session.access_token) return false;
    if (lastExchangedTokenRef.current === session.access_token && user) return true;

    try {
      const res = await fetch("/api/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ access_token: session.access_token }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Magic link sign-in failed");
        try {
          await getSupabaseClient().auth.signOut();
        } catch (_) {}
        return false;
      }
      lastExchangedTokenRef.current = session.access_token;
      await checkSession({ silent: true });
      setUser({
        email: data.email,
        name: data.name,
        picture: data.picture,
        access: data.access || null,
      });
      setError("");
      setLinkSentTo("");
      return true;
    } catch (_) {
      setError("Connection error. Please try again.");
      return false;
    }
  }, [checkSession, user]);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  useEffect(() => {
    if (DEV_BYPASS_AUTH || checking || user || !hasSupabaseConfig()) return;
    let active = true;
    const supabase = getSupabaseClient();

    const tryExistingSession = async function() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        if (data && data.session && data.session.access_token) {
          await exchangeSupabaseSession(data.session);
        }
      } catch (_) {
        // Best effort only.
      }
    };

    const { data: subscription } = supabase.auth.onAuthStateChange(async function(event, session) {
      if (!active) return;
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") && session && session.access_token) {
        await exchangeSupabaseSession(session);
      }
      if (event === "SIGNED_OUT") {
        lastExchangedTokenRef.current = "";
      }
    });

    tryExistingSession();

    return () => {
      active = false;
      if (subscription && typeof subscription.subscription?.unsubscribe === "function") {
        subscription.subscription.unsubscribe();
      } else if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    };
  }, [checking, exchangeSupabaseSession, user]);

  const handleSendMagicLink = useCallback(async function(event) {
    event.preventDefault();
    setError("");
    const nextEmail = String(email || "").trim().toLowerCase();
    if (!nextEmail) {
      setError("Enter your work email.");
      return;
    }
    if (!hasSupabaseConfig()) {
      setError("Supabase auth is not configured.");
      return;
    }
    setSendingLink(true);
    try {
      const supabase = getSupabaseClient();
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: nextEmail,
        options: {
          emailRedirectTo: getRedirectUrl(),
        },
      });
      if (sendError) {
        setError(sendError.message || "Could not send magic link.");
        return;
      }
      setLinkSentTo(nextEmail);
    } catch (_) {
      setError("Connection error. Please try again.");
    } finally {
      setSendingLink(false);
    }
  }, [email]);

  const postUsageEvent = useCallback(async function(eventType) {
    if (DEV_BYPASS_AUTH) return;
    try {
      await fetch("/api/ops/user-logins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        keepalive: eventType === "session_refresh",
        body: JSON.stringify({ event_type: eventType }),
      });
    } catch (_) {
      // Best effort only. Activity logging should never block app usage.
    }
  }, []);

  useEffect(() => {
    if (user || checking) return;
    const refresh = () => checkSession({ silent: true });
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, 5000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(interval);
    };
  }, [user, checking, checkSession]);

  const handleLogout = useCallback(async () => {
    if (DEV_BYPASS_AUTH) {
      setUser(DEV_BYPASS_USER);
      return;
    }
    try {
      if (hasSupabaseConfig()) {
        await getSupabaseClient().auth.signOut();
      }
    } catch (_) {}
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    try {
      if (window.heap && typeof window.heap.resetIdentity === "function") {
        window.heap.resetIdentity();
      }
      window.__heapIdentifiedUser = "";
    } catch (_) {}
    setUser(null);
    setLinkSentTo("");
    setError("");
    sessionUsageLoggedRef.current = "";
    lastActivitySentRef.current = 0;
    lastExchangedTokenRef.current = "";
  }, []);

  useEffect(() => {
    if (!user || DEV_BYPASS_AUTH) return;
    var userEmail = user && user.email ? String(user.email).trim().toLowerCase() : "";
    if (!userEmail) return;
    if (sessionUsageLoggedRef.current === userEmail) return;
    sessionUsageLoggedRef.current = userEmail;
    lastInteractionRef.current = Date.now();
    lastActivitySentRef.current = Date.now();
    postUsageEvent("session_refresh");
  }, [user, postUsageEvent]);

  useEffect(() => {
    if (!user || DEV_BYPASS_AUTH) return;

    var markInteraction = function() {
      lastInteractionRef.current = Date.now();
    };

    var maybeLogActivity = function(force) {
      var now = Date.now();
      if (!force) {
        if (document.visibilityState === "hidden") return;
        if ((now - lastInteractionRef.current) > SESSION_USAGE_ACTIVE_WINDOW_MS) return;
        if ((now - lastActivitySentRef.current) < SESSION_USAGE_HEARTBEAT_MS) return;
      }
      lastActivitySentRef.current = now;
      postUsageEvent("activity");
    };

    var handleVisible = function() {
      if (document.visibilityState === "visible") {
        markInteraction();
        maybeLogActivity(false);
      }
    };

    var handleFocus = function() {
      markInteraction();
      maybeLogActivity(false);
    };

    var interval = setInterval(function() {
      maybeLogActivity(false);
    }, 60000);

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("pointerdown", markInteraction, { passive: true });
    window.addEventListener("keydown", markInteraction, { passive: true });
    window.addEventListener("scroll", markInteraction, { passive: true });
    window.addEventListener("touchstart", markInteraction, { passive: true });

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("pointerdown", markInteraction);
      window.removeEventListener("keydown", markInteraction);
      window.removeEventListener("scroll", markInteraction);
      window.removeEventListener("touchstart", markInteraction);
    };
  }, [user, postUsageEvent]);

  useEffect(() => {
    window.__ppUser = user || null;
    window.__ppLogout = user ? handleLogout : null;
  }, [user, handleLogout]);

  useEffect(() => {
    try {
      var userEmail = user && user.email ? String(user.email).trim() : "";
      if (!userEmail) return;
      if (!window.heap || typeof window.heap.identify !== "function") return;
      if (window.__heapIdentifiedUser === userEmail) return;
      window.heap.identify(userEmail);
      if (typeof window.heap.addUserProperties === "function") {
        window.heap.addUserProperties({
          email: userEmail,
          name: user && user.name ? String(user.name) : "",
        });
      }
      if (typeof window.heap.track === "function") {
        window.heap.track("PackPulse Authenticated", {
          email: userEmail,
        });
      }
      window.__heapIdentifiedUser = userEmail;
    } catch (_) {}
  }, [user]);

  if (checking) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <div style={{ color: "#6b7280", marginTop: 12, fontSize: 14 }}>Checking session...</div>
        </div>
        <style>{FONTS_CSS + spinnerCSS}</style>
      </div>
    );
  }

  if (!DEV_BYPASS_AUTH && !hasSupabaseConfig()) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#ef4444" }}>Configuration Error</div>
          <div style={{ color: "#6b7280", marginTop: 8, fontSize: 14 }}>
            `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are required for magic-link sign-in.
          </div>
        </div>
        <style>{FONTS_CSS}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", letterSpacing: -0.3 }}>PackPulse</div>
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 2, marginBottom: 24 }}>Email sign-in</div>
          <form onSubmit={handleSendMagicLink} style={{ display: "grid", gap: 12 }}>
            <input
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={function(e) { setEmail(e.target.value); }}
              style={styles.input}
            />
            <button type="submit" disabled={sendingLink} style={styles.button}>
              {sendingLink ? "Sending link..." : "Email Magic Link"}
            </button>
          </form>
          {linkSentTo && (
            <div style={styles.notice}>
              Check {linkSentTo} for your sign-in link. The link expires after the Supabase email-login window.
            </div>
          )}
          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}
        </div>
        <style>{FONTS_CSS + spinnerCSS}</style>
      </div>
    );
  }

  return children;
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f3f4f6",
    fontFamily: "'Inter', -apple-system, sans-serif",
  },
  card: {
    background: "#ffffff",
    borderRadius: 12,
    padding: "40px 36px",
    textAlign: "center",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 30px rgba(0,0,0,0.06)",
    border: "1px solid #e5e7eb",
    maxWidth: 420,
    width: "92%",
  },
  spinner: {
    display: "inline-block",
    width: 28,
    height: 28,
    border: "3px solid #e5e7eb",
    borderTopColor: "#3b6fd8",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  input: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    padding: "12px 14px",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    fontWeight: 600,
    fontSize: 15,
    padding: "12px 14px",
    cursor: "pointer",
  },
  notice: {
    marginTop: 16,
    padding: "10px 14px",
    borderRadius: 8,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    fontSize: 14,
    lineHeight: 1.45,
  },
  error: {
    marginTop: 16,
    padding: "10px 14px",
    borderRadius: 8,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#dc2626",
    fontSize: 14,
  },
};

const spinnerCSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
