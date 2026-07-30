import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addEvent, reconcilePurchaseOrder, text } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var found = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(404).json({ error: "Purchase order not found" });
    var result = await reconcilePurchaseOrder(supabase, found.data);
    await addEvent(supabase, id, found.data.current_revision_id, "reconciled", user, { metadata: result });
    return res.status(200).json(result);
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Reconciliation failed" });
  }
}
