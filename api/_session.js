import crypto from "crypto";

export const SESSION_SECRET_MISSING_ERROR = "Missing SESSION_SECRET";

export function getSessionSecret() {
  const secret = String(process.env.SESSION_SECRET || "").trim();
  if (!secret) throw new Error(SESSION_SECRET_MISSING_ERROR);
  return secret;
}

export function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(function(c) {
    const parts = c.trim().split("=");
    const key = parts.shift();
    if (key) cookies[key.trim()] = parts.join("=").trim();
  });
  return cookies;
}

export function signSession(email, sessionDays) {
  const secret = getSessionSecret();
  const expires = Date.now() + Number(sessionDays || 7) * 86400000;
  const payload = String(email || "").trim().toLowerCase() + ":" + expires;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return payload + ":" + sig;
}

export function verifySessionValue(sessionValue) {
  if (!sessionValue) return null;
  const parts = String(sessionValue).split(":");
  if (parts.length !== 3) return null;
  const email = parts[0];
  const expires = parts[1];
  const sig = parts[2];
  const payload = email + ":" + expires;
  const expectedSig = crypto.createHmac("sha256", getSessionSecret()).update(payload).digest("hex");
  if (sig !== expectedSig) return null;
  if (Date.now() > parseInt(expires, 10)) return null;
  return { email: email };
}

export function getAuthenticatedUser(req) {
  const cookies = parseCookies(req && req.headers ? req.headers.cookie : "");
  return verifySessionValue(cookies.pp_session);
}
