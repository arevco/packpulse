// POST /api/auth/verify
// Verifies Google ID token, checks email domain, sets session cookie

import crypto from "crypto";
import Sentry from "../_sentry.js";

const SESSION_SECRET = process.env.SESSION_SECRET || "packpulse-default-secret-change-me";
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "revcopack.com";
const SESSION_DAYS = 7;

function signSession(email) {
  const expires = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${email}:${expires}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return `${payload}:${sig}`;
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
    const sessionValue = signSession(email);

    res.setHeader("Set-Cookie", [
      `pp_session=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`,
      `pp_user=${encodeURIComponent(JSON.stringify({ email, name, picture }))}; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}; ${process.env.NODE_ENV === "production" ? "Secure;" : ""}`
    ]);

    return res.status(200).json({ ok: true, email, name, picture });

  } catch (err) {
    Sentry.captureException(err);
    console.error("Auth verify error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}
