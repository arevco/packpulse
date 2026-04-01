import Sentry from "../../_sentry.js";
import { getAuthenticatedUser, withCors } from "../../ops/_common.js";
import { loadQuickBooksPersistenceState } from "./_persistence.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body && typeof req.body === "object" ? req.body : {};
    var invoiceCandidates = Array.isArray(body.invoiceCandidates) ? body.invoiceCandidates : [];
    var state = await loadQuickBooksPersistenceState(invoiceCandidates);
    return res.status(200).json(state);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "QuickBooks export state lookup failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
