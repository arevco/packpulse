import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addEvent, key, text, validateConfirmed } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var revisionId = text(req.query && req.query.id, 80);
    var revisionResult = await supabase.from("purchase_order_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("id", revisionId).single();
    if (revisionResult.error) return res.status(404).json({ error: "Staged upload not found" });
    var data = validateConfirmed(req.body && req.body.data || revisionResult.data.extracted_data);
    var customerKey = key(data.customerName);
    var poNumberKey = key(data.poNumber);
    var existing = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID)
      .eq("customer_key", customerKey).eq("po_number_key", poNumberKey).maybeSingle();
    if (existing.error) throw existing.error;
    var po = existing.data;
    if (revisionResult.data.processing_status === "confirmed" && revisionResult.data.purchase_order_id) {
      var confirmedPo = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID)
        .eq("id", revisionResult.data.purchase_order_id).maybeSingle();
      if (confirmedPo.error) throw confirmedPo.error;
      if (confirmedPo.data && confirmedPo.data.current_revision_id === revisionId) {
        var confirmedLines = await supabase.from("purchase_order_lines").select("*").eq("site_id", CACHE_SITE_ID)
          .eq("revision_id", revisionId).order("line_number");
        if (confirmedLines.error) throw confirmedLines.error;
        if ((confirmedLines.data || []).length) {
          return res.status(200).json({
            ok: true, alreadyConfirmed: true, purchaseOrder: confirmedPo.data,
            lines: confirmedLines.data, revision: revisionResult.data
          });
        }
      }
    }
    if (revisionResult.data.purchase_order_id && (!po || po.id !== revisionResult.data.purchase_order_id)) {
      var attachedPo = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID)
        .eq("id", revisionResult.data.purchase_order_id).single();
      if (attachedPo.error) throw attachedPo.error;
      po = attachedPo.data;
    }
    var revisionNumber = revisionResult.data.revision_number
      ? Number(revisionResult.data.revision_number)
      : po ? Number(po.revision_number || 0) + 1 : 1;
    if (!po) {
      var created = await supabase.from("purchase_orders").insert({
        site_id: CACHE_SITE_ID, customer_name: data.customerName, customer_key: customerKey,
        po_number: data.poNumber, po_number_key: poNumberKey, po_date: data.poDate,
        expected_date: data.expectedDate, currency: data.currency, subtotal: data.subtotal,
        tax_total: data.taxTotal, total: data.total, status: "open", revision_number: revisionNumber,
        created_by: user.email, updated_by: user.email, confirmed_at: new Date().toISOString()
      }).select("*").single();
      if (created.error) throw created.error;
      po = created.data;
    }
    var revisionUpdate = await supabase.from("purchase_order_revisions").update({
      purchase_order_id: po.id, revision_number: revisionNumber, processing_status: "confirmed",
      extracted_data: data, warnings: data.warnings, confirmed_by: user.email, confirmed_at: new Date().toISOString()
    }).eq("site_id", CACHE_SITE_ID).eq("id", revisionId).select("*").single();
    if (revisionUpdate.error) throw revisionUpdate.error;
    var oldLines = await supabase.from("purchase_order_lines").update({ active: false })
      .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", po.id).eq("active", true);
    if (oldLines.error) throw oldLines.error;
    // A network retry can arrive after a prior attempt inserted this revision's lines but
    // failed before making the revision current. Remove only those partial rows so the
    // retry remains idempotent without changing an already-confirmed revision.
    var partialLines = await supabase.from("purchase_order_lines").delete()
      .eq("site_id", CACHE_SITE_ID).eq("revision_id", revisionId);
    if (partialLines.error) throw partialLines.error;
    var lines = data.lines.map(function(line, index) {
      return {
        site_id: CACHE_SITE_ID, purchase_order_id: po.id, revision_id: revisionId,
        line_number: index + 1, sku: line.sku || null, sku_key: key(line.sku),
        description: line.description, quantity: line.quantity, uom: line.uom,
        unit_rate: line.unitRate, tax_amount: line.taxAmount, line_amount: line.lineAmount,
        expected_date: line.expectedDate, remaining_quantity: line.quantity, active: true
      };
    });
    var insertedLines = await supabase.from("purchase_order_lines").insert(lines).select("*");
    if (insertedLines.error) throw insertedLines.error;
    var updated = await supabase.from("purchase_orders").update({
      customer_name: data.customerName, customer_key: customerKey, po_number: data.poNumber,
      po_number_key: poNumberKey, po_date: data.poDate, expected_date: data.expectedDate,
      currency: data.currency, subtotal: data.subtotal, tax_total: data.taxTotal, total: data.total,
      current_revision_id: revisionId, revision_number: revisionNumber,
      status: po.status === "draft" ? "open" : po.status, updated_by: user.email, confirmed_at: new Date().toISOString()
    }).eq("site_id", CACHE_SITE_ID).eq("id", po.id).select("*").single();
    if (updated.error) throw updated.error;
    await addEvent(supabase, po.id, revisionId, revisionNumber > 1 ? "revision_confirmed" : "created", user, {
      fromStatus: po.status, toStatus: updated.data.status, metadata: { revisionNumber: revisionNumber }
    });
    return res.status(200).json({ ok: true, purchaseOrder: updated.data, lines: insertedLines.data, revision: revisionUpdate.data });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Confirmation failed", warnings: error.warnings || [] });
  }
}
