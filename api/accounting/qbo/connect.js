import Sentry from "../../_sentry.js";
import { getAuthenticatedUser, withCors } from "../../ops/_common.js";
import { buildQuickBooksAuthorizationUrl, sanitizeReturnToPath } from "./_client.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var returnTo = sanitizeReturnToPath((req.query && req.query.returnTo) || req.headers.referer || "/?view=invoicing");
    var url = buildQuickBooksAuthorizationUrl(req, {
      email: user.email,
      returnTo: returnTo
    });
    return res.redirect(url);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "QuickBooks connect failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
