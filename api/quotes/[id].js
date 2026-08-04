import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { addQuoteEvent, signedDocumentUrl, text } from "./_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "PATCH", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var found = await supabase.from("quotes").select("*").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(404).json({ error: "Quote not found" });
    if (req.method === "PATCH") {
      var status = text(req.body && req.body.status, 30).toLowerCase();
      if (status && ["draft","sent","accepted","declined","expired"].indexOf(status) === -1) return res.status(400).json({ error: "Invalid quote status" });
      if (status) {
        var changed = await supabase.from("quotes").update({ status: status, updated_by: user.email }).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
        if (changed.error) throw changed.error;
        await addQuoteEvent(supabase, id, found.data.current_revision_id, "status_changed", user, { fromStatus: found.data.status, toStatus: status });
        found.data = changed.data;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "linkedPurchaseOrderId")) {
        var purchaseOrderId = text(req.body.linkedPurchaseOrderId, 80);
        var removed = await supabase.from("purchase_order_quote_links").delete().eq("site_id", CACHE_SITE_ID).eq("quote_id", id);
        if (removed.error) throw removed.error;
        if (purchaseOrderId) {
          var po = await supabase.from("purchase_orders").select("id").eq("site_id", CACHE_SITE_ID).eq("id", purchaseOrderId).single();
          if (po.error) return res.status(400).json({ error: "Purchase order not found" });
          var linked = await supabase.from("purchase_order_quote_links").insert({ site_id: CACHE_SITE_ID, quote_id: id, purchase_order_id: purchaseOrderId, linked_by: user.email });
          if (linked.error) throw linked.error;
        }
        await addQuoteEvent(supabase, id, found.data.current_revision_id, "purchase_order_link_changed", user, { purchaseOrderId: purchaseOrderId || null });
      }
    }
    var related = await Promise.all([
      supabase.from("quote_lines").select("*").eq("site_id", CACHE_SITE_ID).eq("quote_id", id).eq("revision_id", found.data.current_revision_id).eq("active", true).order("line_number"),
      supabase.from("quote_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("quote_id", id).order("revision_number", { ascending: false }),
      supabase.from("quote_events").select("*").eq("site_id", CACHE_SITE_ID).eq("quote_id", id).order("created_at", { ascending: false }),
      supabase.from("purchase_order_quote_links").select("purchase_order_id,purchase_orders(po_number,customer_name)").eq("site_id", CACHE_SITE_ID).eq("quote_id", id)
    ]);
    related.forEach(function(result) { if (result.error) throw result.error; });
    var currentRevision = (related[1].data || []).find(function(row) { return row.id === found.data.current_revision_id; });
    return res.status(200).json({
      quote: found.data, lines: related[0].data || [], revisions: related[1].data || [], events: related[2].data || [],
      links: related[3].data || [], documentUrl: await signedDocumentUrl(supabase, currentRevision)
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Quote request failed" });
  }
}
