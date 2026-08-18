import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addEvent, key, previewPurchaseOrderReconciliation, reconcilePurchaseOrder, text } from "../_service.js";

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
    var mode = text(req.body && req.body.mode, 20).toLowerCase() || "preview";
    if (mode === "preview") return res.status(200).json(await previewPurchaseOrderReconciliation(supabase, found.data));
    if (mode !== "apply") return res.status(400).json({ error: "Invalid reconciliation mode" });
    var preview = await previewPurchaseOrderReconciliation(supabase, found.data);
    var activeLineIds = {};
    preview.lines.forEach(function(line) { activeLineIds[line.id] = true; });
    var candidateKeys = {};
    preview.candidates.forEach(function(candidate) { candidateKeys[candidate.itemKey] = candidate.itemCode; });
    var mappings = Array.isArray(req.body && req.body.mappings) ? req.body.mappings : [];
    for (var mappingIndex = 0; mappingIndex < mappings.length; mappingIndex++) {
      var mapping = mappings[mappingIndex] || {};
      var lineId = text(mapping.lineId, 80);
      var itemCode = text(mapping.productionItemCode, 160);
      if (!activeLineIds[lineId]) return res.status(400).json({ error: "A selected PO line is no longer active." });
      if (itemCode && !candidateKeys[key(itemCode)]) return res.status(400).json({ error: "A selected production item is not a candidate for this PO." });
      if (!itemCode) {
        var removed = await supabase.from("purchase_order_item_mappings").delete().eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).eq("line_id", lineId);
        if (removed.error) throw removed.error;
      } else {
        var saved = await supabase.from("purchase_order_item_mappings").upsert({
          site_id: CACHE_SITE_ID, purchase_order_id: id, line_id: lineId,
          production_item_code: candidateKeys[key(itemCode)], production_item_key: key(itemCode),
          reviewed_by: user.email, reviewed_at: new Date().toISOString()
        }, { onConflict: "line_id" });
        if (saved.error) throw saved.error;
      }
    }
    var result = await reconcilePurchaseOrder(supabase, found.data);
    await addEvent(supabase, id, found.data.current_revision_id, "reconciled", user, {
      metadata: { suggestedStatus: result.suggestedStatus, matchedProductionRows: result.matchedProductionRows, reviewedMappings: mappings.length, reconciliationSource: result.reconciliationSource, linkedWorkOrderCount: result.linkedWorkOrderCount }
    });
    return res.status(200).json(Object.assign({}, result, {
      message: result.lines.filter(function(line) { return line.match_status !== "unmatched"; }).length + " of " + result.lines.length + " lines matched."
    }));
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Reconciliation failed" });
  }
}
