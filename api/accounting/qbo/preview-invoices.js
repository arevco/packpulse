import Sentry from "../../_sentry.js";
import { getAuthenticatedUser, withCors } from "../../ops/_common.js";
import { buildQuickBooksPreviewModel } from "./_invoice-builder.js";
import { loadQuickBooksPersistenceState } from "./_persistence.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body && typeof req.body === "object" ? req.body : {};
    var selectedCandidates = Array.isArray(body.selectedCandidates) ? body.selectedCandidates : [];
    if (!selectedCandidates.length) {
      return res.status(400).json({ error: "Select at least one invoice candidate to preview." });
    }

    var persistence = await loadQuickBooksPersistenceState(selectedCandidates);
    var preview = buildQuickBooksPreviewModel({
      billingWindow: body.billingWindow,
      invoiceDate: body.invoiceDate,
      selectedCandidates: selectedCandidates,
      persistenceState: persistence
    });

    return res.status(200).json(Object.assign({ ok: true }, preview));
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "QuickBooks preview failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
