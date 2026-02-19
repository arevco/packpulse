import { useState, useEffect, useCallback } from "react";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function AuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");

  // Check existing session on mount
  useEffect(() => {
    fetch("/api/auth/check", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) setUser(data.user);
        setChecking(false);
      })
      .catch(() => setChecking(false));
  }, []);

  // Load Google Identity Services script
  useEffect(() => {
    if (user || !GOOGLE_CLIENT_ID) return;

    const existing = document.getElementById("gsi-script");
    if (existing) return;

    const script = document.createElement("script");
    script.id = "gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => initGoogleSignIn();
    document.head.appendChild(script);

    return () => {};
  }, [user]);

  const initGoogleSignIn = useCallback(() => {
    if (!window.google || !GOOGLE_CLIENT_ID) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
    });

    window.google.accounts.id.renderButton(
      document.getElementById("google-signin-btn"),
      {
        theme: "outline",
        size: "large",
        width: 280,
        text: "signin_with",
        shape: "rectangular",
      }
    );
  }, []);

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
        setUser({ email: data.email, name: data.name, picture: data.picture });
      } else {
        setError(data.error || "Sign-in failed");
      }
    } catch (err) {
      setError("Connection error. Please try again.");
    }
  }, []);

  const handleLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
    // Re-init Google Sign-In button after logout
    setTimeout(() => initGoogleSignIn(), 300);
  }, [initGoogleSignIn]);

  // Expose logout function globally so PackPulse header can use it
  useEffect(() => {
    if (user) {
      window.__ppUser = user;
      window.__ppLogout = handleLogout;
    } else {
      window.__ppUser = null;
      window.__ppLogout = null;
    }
  }, [user, handleLogout]);

  if (checking) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.spinner} />
          <div style={{ color: "#6b7280", marginTop: 12 }}>Checking session...</div>
        </div>
        <style>{spinnerCSS}</style>
      </div>
    );
  }

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#ef4444" }}>Configuration Error</div>
          <div style={{ color: "#6b7280", marginTop: 8, fontSize: 14 }}>
            VITE_GOOGLE_CLIENT_ID is not set. Add it to your Vercel environment variables.
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#111827", letterSpacing: -0.3 }}>PackPulse</div>
          <div style={{ fontSize: 14, color: "#9ca3af", marginTop: 2, marginBottom: 24 }}>REV Copack</div>
          <div id="google-signin-btn" style={{ minHeight: 44 }} />
          {error && (
            <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 14 }}>
              {error}
            </div>
          )}
          <div style={{ marginTop: 20, fontSize: 13, color: "#9ca3af" }}>
            Restricted to authorized accounts
          </div>
        </div>
        <style>{spinnerCSS}</style>
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
    fontFamily: "'IBM Plex Sans', -apple-system, sans-serif",
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

const spinnerCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;
