import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { addQuoteEvent, date, key, signedDocumentUrl, text, validateConfirmed } from "./_service.js";

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
      var editedData = req.body && req.body.data ? validateConfirmed(req.body.data) : null;
      var hasOutcome = Object.prototype.hasOwnProperty.call(req.body || {}, "outcome");
      var hasTargetCloseDate = Object.prototype.hasOwnProperty.call(req.body || {}, "targetCloseDate");
      if (status && ["draft","sent","accepted","declined","expired"].indexOf(status) === -1) return res.status(400).json({ error: "Invalid quote status" });
      if (editedData) {
        var customerKey = key(editedData.customerName);
        var quoteNumberKey = key(editedData.poNumber);
        var duplicate = await supabase.from("quotes").select("id").eq("site_id", CACHE_SITE_ID)
          .eq("customer_key", customerKey).eq("quote_number_key", quoteNumberKey).neq("id", id).maybeSingle();
        if (duplicate.error) throw duplicate.error;
        if (duplicate.data) return res.status(409).json({ error: "Another quote already uses this customer and quote number." });
        var currentLines = await supabase.from("quote_lines").select("*").eq("site_id", CACHE_SITE_ID)
          .eq("quote_id", id).eq("revision_id", found.data.current_revision_id).eq("active", true).order("line_number");
        if (currentLines.error) throw currentLines.error;
        var existingById = {};
        var maxLineNumber = 0;
        (currentLines.data || []).forEach(function(line) { existingById[line.id] = line; maxLineNumber = Math.max(maxLineNumber, Number(line.line_number || 0)); });
        var retainedIds = [];
        for (var lineIndex = 0; lineIndex < editedData.lines.length; lineIndex++) {
          var line = editedData.lines[lineIndex];
          var requestedId = text(req.body.data.lines[lineIndex] && req.body.data.lines[lineIndex].id, 80);
          var values = { sku: line.sku || null, description: line.description, quantity: line.quantity, uom: line.uom, unit_rate: line.unitRate, tax_amount: line.taxAmount, line_amount: line.lineAmount, active: true };
          if (existingById[requestedId]) {
            var lineUpdate = await supabase.from("quote_lines").update(values).eq("site_id", CACHE_SITE_ID).eq("quote_id", id).eq("id", requestedId);
            if (lineUpdate.error) throw lineUpdate.error;
            retainedIds.push(requestedId);
          } else {
            var lineInsert = await supabase.from("quote_lines").insert(Object.assign({}, values, { site_id: CACHE_SITE_ID, quote_id: id, revision_id: found.data.current_revision_id, line_number: ++maxLineNumber })).select("id").single();
            if (lineInsert.error) throw lineInsert.error;
            retainedIds.push(lineInsert.data.id);
          }
        }
        var removedIds = (currentLines.data || []).filter(function(line) { return retainedIds.indexOf(line.id) === -1; }).map(function(line) { return line.id; });
        if (removedIds.length) {
          var deactivated = await supabase.from("quote_lines").update({ active: false }).eq("site_id", CACHE_SITE_ID).eq("quote_id", id).in("id", removedIds);
          if (deactivated.error) throw deactivated.error;
        }
        var quoteUpdate = await supabase.from("quotes").update({
          customer_name: editedData.customerName, customer_key: customerKey, quote_number: editedData.poNumber,
          quote_number_key: quoteNumberKey, quote_date: editedData.poDate, expiration_date: editedData.expectedDate,
          currency: editedData.currency, subtotal: editedData.subtotal, tax_total: editedData.taxTotal,
          total: editedData.total, updated_by: user.email
        }).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
        if (quoteUpdate.error) throw quoteUpdate.error;
        await addQuoteEvent(supabase, id, found.data.current_revision_id, "details_edited", user, {
          previous: { customerName: found.data.customer_name, quoteNumber: found.data.quote_number, quoteDate: found.data.quote_date, expirationDate: found.data.expiration_date, total: found.data.total },
          updated: editedData
        });
        found.data = quoteUpdate.data;
      }
      if (hasOutcome || hasTargetCloseDate) {
        var outcome = hasOutcome ? text(req.body.outcome, 20).toLowerCase() : found.data.outcome || "open";
        if (["open","won","lost"].indexOf(outcome) === -1) return res.status(400).json({ error: "Invalid quote outcome" });
        var rawTargetCloseDate = hasTargetCloseDate ? text(req.body.targetCloseDate, 40) : found.data.target_close_date;
        var targetCloseDate = rawTargetCloseDate ? date(rawTargetCloseDate) : null;
        if (rawTargetCloseDate && !targetCloseDate) return res.status(400).json({ error: "Invalid target close date" });
        var commercialUpdate = { outcome: outcome, target_close_date: targetCloseDate, updated_by: user.email };
        if (hasOutcome && outcome === "won") commercialUpdate.status = "accepted";
        if (hasOutcome && outcome === "lost") commercialUpdate.status = "declined";
        if (hasOutcome && outcome === "open" && ["accepted","declined"].indexOf(found.data.status) !== -1) commercialUpdate.status = "draft";
        var commercialChanged = await supabase.from("quotes").update(commercialUpdate).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
        if (commercialChanged.error) throw commercialChanged.error;
        await addQuoteEvent(supabase, id, found.data.current_revision_id, hasOutcome ? "outcome_changed" : "target_close_date_changed", user, {
          fromOutcome: found.data.outcome || "open", toOutcome: commercialChanged.data.outcome,
          fromTargetCloseDate: found.data.target_close_date || null, toTargetCloseDate: commercialChanged.data.target_close_date || null
        });
        found.data = commercialChanged.data;
      }
      if (status) {
        var statusUpdate = { status: status, updated_by: user.email };
        if (status === "accepted") statusUpdate.outcome = "won";
        else if (status === "declined") statusUpdate.outcome = "lost";
        else if (["accepted","declined"].indexOf(found.data.status) !== -1) statusUpdate.outcome = "open";
        var changed = await supabase.from("quotes").update(statusUpdate).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
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
    return res.status(error.statusCode || 500).json({ error: error.message || "Quote request failed", warnings: error.warnings || [] });
  }
}
