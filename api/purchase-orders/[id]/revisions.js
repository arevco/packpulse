import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { stageUpload, text } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var po = await supabase.from("purchase_orders").select("id,revision_number").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (po.error) return res.status(404).json({ error: "Purchase order not found" });
    var staged = await stageUpload(req.body || {}, user, { allowExactRevision: true });
    if (staged.revision) {
      var latestRevision = await supabase.from("purchase_order_revisions").select("revision_number")
        .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id)
        .order("revision_number", { ascending: false }).limit(1).maybeSingle();
      if (latestRevision.error) throw latestRevision.error;
      var nextRevisionNumber = Math.max(Number(po.data.revision_number || 0), Number(latestRevision.data && latestRevision.data.revision_number || 0)) + 1;
      var linked = await supabase.from("purchase_order_revisions").update({ purchase_order_id: id, revision_number: nextRevisionNumber })
        .eq("site_id", CACHE_SITE_ID).eq("id", staged.revision.id).select("*").single();
      if (linked.error) throw linked.error;
      staged.revision = linked.data;
      staged.duplicate = false;
      staged.duplicateType = null;
      staged.existingPurchaseOrder = null;
      staged.uploadMode = "revision";
    }
    return res.status(staged.error ? 422 : 200).json(staged);
  } catch (error) {
    Sentry.captureException(error);
    if (error && error.code === "23505" && String(error.message || "").indexOf("purchase_order_revisions_site_id_sha256_key") !== -1) {
      return res.status(409).json({
        error: "Database setup required. Run docs/supabase-purchase-order-repeat-file-revisions.sql in Supabase, then retry the revision upload."
      });
    }
    return res.status(500).json({ error: error.message || "Revision upload failed" });
  }
}
