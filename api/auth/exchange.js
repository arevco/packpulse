// POST /api/auth/exchange
// Verifies a Supabase session access token, applies access rules, sets PackPulse session cookies.

import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { SESSION_SECRET_MISSING_ERROR, signSession } from "../_session.js";
import { normalizeEmail, resolveEmailAccess } from "./_access.js";

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

function userCookiePayload(email, name, picture, access) {
  return {
    email: email,
    name: name || "",
    picture: picture || "",
    access: access || null,
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const accessToken = String(req.body && (req.body.access_token || req.body.accessToken) || "").trim();
  if (!accessToken) return res.status(400).json({ error: "Missing access token" });

  try {
    const supabase = getSupabaseAdminSafe();
    if (!supabase) {
      return res.status(500).json({ error: "Authentication is not configured" });
    }

    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data || !data.user) {
      return res.status(401).json({ error: "Invalid Supabase session" });
    }

    const user = data.user;
    const email = normalizeEmail(user.email || "");
    const name = String(
      (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name || user.user_metadata.display_name)) ||
      ""
    ).trim();
    const picture = String(
      (user.user_metadata && (user.user_metadata.avatar_url || user.user_metadata.picture)) ||
      ""
    ).trim();

    const accessDecision = resolveEmailAccess(email);
    if (!accessDecision.ok) {
      return res.status(403).json({
        error: accessDecision.error,
        email: email,
        access: accessDecision.access || null,
      });
    }

    const sessionValue = signSession(email, SESSION_DAYS);
    const userPayload = userCookiePayload(email, name, picture, accessDecision.access);

    res.setHeader("Set-Cookie", [
      `pp_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`,
      `pp_user=${encodeURIComponent(JSON.stringify(userPayload))}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`,
    ]);

    try {
      const userAgent = String(req.headers["user-agent"] || "").slice(0, 1000);
      await supabase.from("user_login_events").insert({
        site_id: CACHE_SITE_ID,
        user_email: email,
        user_name: name || null,
        event_type: "login",
        auth_provider: "magic_link",
        source: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
        ip_address: requestIp(req) || null,
        user_agent: userAgent || null,
      });
    } catch (auditErr) {
      Sentry.captureException(auditErr);
    }

    return res.status(200).json({
      ok: true,
      email: email,
      name: name,
      picture: picture,
      access: accessDecision.access,
    });
  } catch (err) {
    Sentry.captureException(err);
    if (err && err.message === SESSION_SECRET_MISSING_ERROR) {
      return res.status(500).json({ error: "Authentication is not configured" });
    }
    return res.status(500).json({ error: "Authentication failed" });
  }
}
