// GET /api/auth/check
// Validates session cookie

import crypto from "crypto";

const SESSION_SECRET = process.env.SESSION_SECRET || "packpulse-default-secret-change-me";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(c => {
    const [key, ...val] = c.trim().split("=");
    if (key) cookies[key.trim()] = val.join("=").trim();
  });
  return cookies;
}

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();

  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.pp_session;

  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  const parts = session.split(":");
  if (parts.length !== 3) {
    return res.status(401).json({ authenticated: false });
  }

  const [email, expires, sig] = parts;
  const payload = `${email}:${expires}`;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");

  if (sig !== expectedSig) {
    return res.status(401).json({ authenticated: false });
  }

  if (Date.now() > parseInt(expires)) {
    return res.status(401).json({ authenticated: false, reason: "expired" });
  }

  // Parse user info from non-httponly cookie
  let user = { email };
  try {
    const userCookie = cookies.pp_user;
    if (userCookie) user = JSON.parse(decodeURIComponent(userCookie));
  } catch (e) { /* use email only */ }

  return res.status(200).json({ authenticated: true, user });
}
