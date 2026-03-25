// POST /api/auth/verify
// Verifies Google ID token, checks email domain, sets session cookie

import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { SESSION_SECRET_MISSING_ERROR, signSession } from "../_session.js";

const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "revcopack.com";
const SESSION_DAYS = 7;
const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

function getSupabaseAdminSafe() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function requestIp(req) {
  const h = req.headers || {};
  const fwd = h["x-forwarded-for"] || h["X-Forwarded-For"] || "";
  if (typeof fwd === "string" && fwd.trim()) return fwd.split(",")[0].trim();
  return h["x-real-ip"] || h["X-Real-Ip"] || "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: "Missing Google credential" });

  try {
    // Verify token with Google
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
    if (!verifyRes.ok) {
      return res.status(401).json({ error: "Invalid Google token" });
    }

    const tokenData = await verifyRes.json();
    const email = (tokenData.email || "").toLowerCase();
    const name = tokenData.name || "";
    const picture = tokenData.picture || "";

    // Check email domain
    const domain = email.split("@")[1];
    if (domain !== ALLOWED_DOMAIN.toLowerCase()) {
      return res.status(403).json({
        error: `Access restricted to @${ALLOWED_DOMAIN} accounts`,
        email: email
      });
    }

    // Create signed session cookie
    const sessionValue = signSession(email, SESSION_DAYS);

    res.setHeader("Set-Cookie", [
      `pp_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`,
      `pp_user=${encodeURIComponent(JSON.stringify({ email, name, picture }))}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`
    ]);

    // Best-effort login audit trail. Never block authentication on audit write failures.
    try {
      const supabase = getSupabaseAdminSafe();
      if (supabase) {
        const userAgent = String(req.headers["user-agent"] || "").slice(0, 1000);
        await supabase.from("user_login_events").insert({
          site_id: CACHE_SITE_ID,
          user_email: email,
          user_name: name || null,
          event_type: "login",
          auth_provider: "google",
          source: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
          ip_address: requestIp(req) || null,
          user_agent: userAgent || null
        });
      }
    } catch (auditErr) {
      // Keep auth successful; audit is informational.
      Sentry.captureException(auditErr);
    }

    return res.status(200).json({ ok: true, email, name, picture });

  } catch (err) {
    Sentry.captureException(err);
    console.error("Auth verify error:", err);
    if (err && err.message === SESSION_SECRET_MISSING_ERROR) {
      return res.status(500).json({ error: "Authentication is not configured" });
    }
    return res.status(500).json({ error: "Authentication failed" });
  }
}
