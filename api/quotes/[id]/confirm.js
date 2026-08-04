import Sentry from "../../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../../ops/_common.js";
import { addQuoteEvent, key, text, validateConfirmed } from "../_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var revisionId = text(req.query && req.query.id, 80);
    var revision = await supabase.from("quote_revisions").select("*").eq("site_id", CACHE_SITE_ID).eq("id", revisionId).single();
    if (revision.error) return res.status(404).json({ error: "Staged quote not found" });
    var data = validateConfirmed(req.body && req.body.data || revision.data.extracted_data);
    var customerKey = key(data.customerName);
    var quoteNumberKey = key(data.poNumber);
    var existing = await supabase.from("quotes").select("*").eq("site_id", CACHE_SITE_ID).eq("customer_key", customerKey).eq("quote_number_key", quoteNumberKey).maybeSingle();
    if (existing.error) throw existing.error;
    var quote = existing.data;
    var revisionNumber = quote ? Number(quote.revision_number || 0) + 1 : 1;
    if (!quote) {
      var created = await supabase.from("quotes").insert({
        site_id: CACHE_SITE_ID, customer_name: data.customerName, customer_key: customerKey,
        quote_number: data.poNumber, quote_number_key: quoteNumberKey, quote_date: data.poDate,
        expiration_date: data.expectedDate, currency: data.currency, subtotal: data.subtotal,
        tax_total: data.taxTotal, total: data.total, status: "draft", revision_number: revisionNumber,
        created_by: user.email, updated_by: user.email
      }).select("*").single();
      if (created.error) throw created.error;
      quote = created.data;
    }
    var revisionUpdate = await supabase.from("quote_revisions").update({
      quote_id: quote.id, revision_number: revisionNumber, processing_status: "confirmed",
      extracted_data: data, warnings: data.warnings, confirmed_by: user.email, confirmed_at: new Date().toISOString()
    }).eq("site_id", CACHE_SITE_ID).eq("id", revisionId).select("*").single();
    if (revisionUpdate.error) throw revisionUpdate.error;
    var oldLines = await supabase.from("quote_lines").update({ active: false }).eq("site_id", CACHE_SITE_ID).eq("quote_id", quote.id).eq("active", true);
    if (oldLines.error) throw oldLines.error;
    var lines = data.lines.map(function(line, index) { return {
      site_id: CACHE_SITE_ID, quote_id: quote.id, revision_id: revisionId, line_number: index + 1,
      sku: line.sku || null, description: line.description, quantity: line.quantity, uom: line.uom,
      unit_rate: line.unitRate, tax_amount: line.taxAmount, line_amount: line.lineAmount, active: true
    }; });
    var insertedLines = await supabase.from("quote_lines").insert(lines).select("*");
    if (insertedLines.error) throw insertedLines.error;
    var updated = await supabase.from("quotes").update({
      customer_name: data.customerName, customer_key: customerKey, quote_number: data.poNumber,
      quote_number_key: quoteNumberKey, quote_date: data.poDate, expiration_date: data.expectedDate,
      currency: data.currency, subtotal: data.subtotal, tax_total: data.taxTotal, total: data.total,
      current_revision_id: revisionId, revision_number: revisionNumber, updated_by: user.email
    }).eq("site_id", CACHE_SITE_ID).eq("id", quote.id).select("*").single();
    if (updated.error) throw updated.error;
    await addQuoteEvent(supabase, quote.id, revisionId, revisionNumber > 1 ? "revision_confirmed" : "created", user, { revisionNumber: revisionNumber });
    return res.status(200).json({ ok: true, quote: updated.data, lines: insertedLines.data });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(error.statusCode || 500).json({ error: error.message || "Quote confirmation failed", warnings: error.warnings || [] });
  }
}
