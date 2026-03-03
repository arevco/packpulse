import { useState, useEffect, useCallback, useRef } from "react";

const FONTS_CSS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Roboto+Mono:wght@400;500;700&display=swap');";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DEV_BYPASS_AUTH = import.meta.env.DEV && String(import.meta.env.VITE_DEV_BYPASS_AUTH || "").toLowerCase() === "true";
const DEV_BYPASS_USER = {
  email: import.meta.env.VITE_DEV_BYPASS_EMAIL || "dev@revcopack.local",
  name: import.meta.env.VITE_DEV_BYPASS_NAME || "PackPulse Dev",
  picture: "",
};

export default function AuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const btnRef = useRef(null);
  const initializedRef = useRef(false);

  const checkSession = useCallback(async (opts = {}) => {
    const silent = !!opts.silent;
    if (DEV_BYPASS_AUTH) {
      setUser(DEV_BYPASS_USER);
      setChecking(false);
      return;
    }
    if (!silent) setChecking(true);
    try {
      const r = await fetch("/api/auth/check", { credentials: "include" });
      const data = await r.json();
      if (data && data.authenticated) {
        setUser(data.user || null);
        setError("");
      } else if (!silent) {
        setUser(null);
      }
    } catch (_) {
      if (!silent) setUser(null);
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  // Check existing session on mount
  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const handleCredentialResponse = useCallback(async (response) => {
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        // Re-check from server so cookie state is the source of truth.
        await checkSession({ silent: true });
        setUser({ email: data.email, name: data.name, picture: data.picture });
      } else {
        setError(data.error || "Sign-in failed");
      }
    } catch (err) {
      setError("Connection error. Please try again.");
    }
  }, [checkSession]);

  // Initialize Google Sign-In once script is loaded AND button div is ready
  const tryInitGoogle = useCallback(() => {
    if (initializedRef.current) return;
    if (!window.google || !window.google.accounts || !btnRef.current) return;

    initializedRef.current = true;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
    });

    window.google.accounts.id.renderButton(btnRef.current, {
      theme: "outline",
      size: "large",
      width: 280,
      text: "signin_with",
      shape: "rectangular",
    });
  }, [handleCredentialResponse]);

  // Load Google Identity Services script
  useEffect(() => {
    if (user || checking || !GOOGLE_CLIENT_ID) return;

    const loadScript = () => {
      if (document.getElementById("gsi-script")) {
        tryInitGoogle();
        return;
      }

      const script = document.createElement("script");
      script.id = "gsi-script";
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => tryInitGoogle();
      document.head.appendChild(script);
    };

    loadScript();
  }, [user, checking, tryInitGoogle]);

  // Retry initialization when button ref is ready (handles race condition)
  useEffect(() => {
    if (user || checking || !GOOGLE_CLIENT_ID) return;
    if (initializedRef.current) return;

    const interval = setInterval(() => {
      if (window.google && window.google.accounts && btnRef.current) {
        tryInitGoogle();
        clearInterval(interval);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [user, checking, tryInitGoogle]);

  // Mobile reliability: if auth completes in another context (popup/webview/email),
  // refresh session on focus/visibility and with light polling while logged out.
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
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    try {
      if (window.heap && typeof window.heap.resetIdentity === "function") {
        window.heap.resetIdentity();
      }
      window.__heapIdentifiedUser = "";
    } catch (_) {}
    setUser(null);
    initializedRef.current = false;
  }, []);

  // Expose user/logout globally for PackPulse header
  useEffect(() => {
    window.__ppUser = user || null;
    window.__ppLogout = user ? handleLogout : null;
  }, [user, handleLogout]);

  // Identify authenticated user in Heap once per user/session.
  useEffect(() => {
    try {
      var email = user && user.email ? String(user.email).trim() : "";
      if (!email) return;
      if (!window.heap || typeof window.heap.identify !== "function") return;
      if (window.__heapIdentifiedUser === email) return;
      window.heap.identify(email);
      if (typeof window.heap.addUserProperties === "function") {
        window.heap.addUserProperties({
          email: email,
          name: user && user.name ? String(user.name) : "",
        });
      }
      window.__heapIdentifiedUser = email;
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

  if (!DEV_BYPASS_AUTH && !GOOGLE_CLIENT_ID) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#ef4444" }}>Configuration Error</div>
          <div style={{ color: "#6b7280", marginTop: 8, fontSize: 14 }}>
            VITE_GOOGLE_CLIENT_ID is not set. Add it to your Vercel environment variables.
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
          <div style={{ fontSize: 14, color: "#6b7280", marginTop: 2, marginBottom: 24 }}>REV Copack</div>
          <div ref={btnRef} style={{ minHeight: 44, display: "flex", justifyContent: "center" }} />
          {error && (
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 14 }}>
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
    maxWidth: 380,
    width: "90%",
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
};

const spinnerCSS = `
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
`;
