// GET /api/auth/check
// Validates session cookie

import { SESSION_SECRET_MISSING_ERROR, getAuthenticatedUser as getAuthenticatedUserFromSession, parseCookies } from "../_session.js";

export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const cookies = parseCookies(req.headers.cookie);
    const session = cookies.pp_session;

    if (!session) {
      return res.status(401).json({ authenticated: false });
    }

    const user = getAuthenticatedUserFromSession(req);
    if (!user) {
      return res.status(401).json({ authenticated: false });
    }

    let userInfo = { email: user.email };
    try {
      const userCookie = cookies.pp_user;
      if (userCookie) userInfo = JSON.parse(decodeURIComponent(userCookie));
    } catch (e) { /* use email only */ }

    return res.status(200).json({ authenticated: true, user: userInfo });
  } catch (err) {
    if (err && err.message === SESSION_SECRET_MISSING_ERROR) {
      return res.status(500).json({ authenticated: false, error: "Authentication is not configured" });
    }
    return res.status(500).json({ authenticated: false, error: "Session validation failed" });
  }
}
