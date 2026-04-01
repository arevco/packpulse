import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "./_common.js";
import { runInvoicingProductionBackfill } from "./_invoicing-production-backfill.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body && typeof req.body === "object" ? req.body : {};
    var result = await runInvoicingProductionBackfill({
      startDate: body.startDate || body.start,
      endDate: body.endDate || body.end,
      focusWorkOrders: body.workOrders || body.focusWorkOrders,
      updatedBy: user.email
    });

    if (result && result.pending) {
      return res.status(202).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(err && err.statusCode || 500).json({
      error: "Historical invoicing production backfill failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
