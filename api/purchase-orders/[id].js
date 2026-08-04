import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { addEvent, key, signedDocumentUrl, text, validateConfirmed } from "./_service.js";

function missingOnboardingDocumentsTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("purchase_order_onboarding_documents") !== -1 &&
    (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "PATCH", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "PATCH") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var id = text(req.query && req.query.id, 80);
    var found = await supabase.from("purchase_orders").select("*").eq("site_id", CACHE_SITE_ID).eq("id", id).single();
    if (found.error) return res.status(found.error.code === "PGRST116" ? 404 : 500).json({ error: found.error.message });
    if (req.method === "PATCH") {
      var requestedStatus = text(req.body && req.body.status, 40).toLowerCase();
      var update = { updated_by: user.email };
      var editedData = req.body && req.body.data ? validateConfirmed(req.body.data) : null;
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, "notes")) update.notes = text(req.body.notes, 4000) || null;
      if (requestedStatus) {
        if (["open","closed","cancelled"].indexOf(requestedStatus) === -1) return res.status(400).json({ error: "Invalid status" });
        update.status = requestedStatus;
      }
      if (editedData) {
        update.customer_name = editedData.customerName;
        update.customer_key = key(editedData.customerName);
        update.po_number = editedData.poNumber;
        update.po_number_key = key(editedData.poNumber);
        update.po_date = editedData.poDate;
        update.expected_date = editedData.expectedDate;
        update.currency = editedData.currency;
        update.subtotal = editedData.subtotal;
        update.tax_total = editedData.taxTotal;
        update.total = editedData.total;
        update.suggested_status = "open";

        var duplicate = await supabase.from("purchase_orders").select("id")
          .eq("site_id", CACHE_SITE_ID).eq("customer_key", update.customer_key)
          .eq("po_number_key", update.po_number_key).neq("id", id).maybeSingle();
        if (duplicate.error) throw duplicate.error;
        if (duplicate.data) return res.status(409).json({ error: "Another purchase order already uses this customer and PO number." });

        var currentLines = await supabase.from("purchase_order_lines").select("*")
          .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id)
          .eq("revision_id", found.data.current_revision_id).eq("active", true).order("line_number");
        if (currentLines.error) throw currentLines.error;
        var existingById = {};
        var maxLineNumber = 0;
        (currentLines.data || []).forEach(function(line) {
          existingById[line.id] = line;
          maxLineNumber = Math.max(maxLineNumber, Number(line.line_number || 0));
        });
        var retainedIds = [];
        for (var lineIndex = 0; lineIndex < editedData.lines.length; lineIndex++) {
          var editedLine = editedData.lines[lineIndex];
          var requestedId = text(req.body.data.lines[lineIndex] && req.body.data.lines[lineIndex].id, 80);
          var existingLine = existingById[requestedId];
          var lineValues = {
            sku: editedLine.sku || null, sku_key: key(editedLine.sku), description: editedLine.description,
            quantity: editedLine.quantity, uom: editedLine.uom, unit_rate: editedLine.unitRate,
            tax_amount: editedLine.taxAmount, line_amount: editedLine.lineAmount,
            expected_date: editedLine.expectedDate, active: true
          };
          if (existingLine) {
            lineValues.remaining_quantity = Math.max(0, editedLine.quantity - Number(existingLine.produced_quantity || 0));
            var lineUpdate = await supabase.from("purchase_order_lines").update(lineValues)
              .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).eq("id", existingLine.id);
            if (lineUpdate.error) throw lineUpdate.error;
            retainedIds.push(existingLine.id);
          } else {
            lineValues.site_id = CACHE_SITE_ID;
            lineValues.purchase_order_id = id;
            lineValues.revision_id = found.data.current_revision_id;
            lineValues.line_number = ++maxLineNumber;
            lineValues.remaining_quantity = editedLine.quantity;
            var lineInsert = await supabase.from("purchase_order_lines").insert(lineValues).select("id").single();
            if (lineInsert.error) throw lineInsert.error;
            retainedIds.push(lineInsert.data.id);
          }
        }
        var removedIds = (currentLines.data || []).filter(function(line) { return retainedIds.indexOf(line.id) === -1; }).map(function(line) { return line.id; });
        if (removedIds.length) {
          var deactivated = await supabase.from("purchase_order_lines").update({ active: false })
            .eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).in("id", removedIds);
          if (deactivated.error) throw deactivated.error;
        }
      }
      var changed = await supabase.from("purchase_orders").update(update).eq("site_id", CACHE_SITE_ID).eq("id", id).select("*").single();
      if (changed.error) throw changed.error;
      await addEvent(supabase, id, found.data.current_revision_id, requestedStatus ? "status_changed" : editedData ? "details_edited" : "metadata_updated", user, {
        fromStatus: found.data.status, toStatus: changed.data.status, note: req.body && req.body.note,
        metadata: editedData ? { previous: {
          customerName: found.data.customer_name, poNumber: found.data.po_number, poDate: found.data.po_date,
          expectedDate: found.data.expected_date, currency: found.data.currency, subtotal: found.data.subtotal,
          taxTotal: found.data.tax_total, total: found.data.total
        }, updated: editedData } : {}
      });
      found.data = changed.data;
    }
    var related = await Promise.all([
      supabase.from("purchase_order_lines").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).eq("revision_id", found.data.current_revision_id).eq("active", true).order("line_number"),
      supabase.from("purchase_order_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("revision_number", { ascending: false }),
      supabase.from("purchase_order_events").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("created_at", { ascending: false }),
      supabase.from("purchase_order_onboarding_documents").select("*").eq("site_id", CACHE_SITE_ID).eq("purchase_order_id", id).order("created_at", { ascending: false })
    ]);
    related.slice(0, 3).forEach(function(result) { if (result.error) throw result.error; });
    if (related[3].error && !missingOnboardingDocumentsTable(related[3].error)) throw related[3].error;
    var currentRevision = (related[1].data || []).find(function(row) { return row.id === found.data.current_revision_id; });
    var documentUrl = await signedDocumentUrl(supabase, currentRevision);
    var onboardingDocuments = [];
    if (!related[3].error) {
      onboardingDocuments = await Promise.all((related[3].data || []).map(async function(row) {
        return Object.assign({}, row, { url: await signedDocumentUrl(supabase, row) });
      }));
    }
    return res.status(200).json({
      purchaseOrder: found.data, lines: related[0].data || [], revisions: related[1].data || [],
      events: related[2].data || [], documentUrl: documentUrl,
      onboardingDocuments: onboardingDocuments,
      onboardingDocumentsStatus: related[3].error ? "missing_table" : "ready"
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Purchase order request failed", warnings: error.warnings || [] });
  }
}
