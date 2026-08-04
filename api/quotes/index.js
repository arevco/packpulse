import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { missingQuotesTable, text } from "./_service.js";

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var status = text(req.query && req.query.status, 30).toLowerCase();
    var q = text(req.query && req.query.q, 160).replace(/[%_,()]/g, "");
    var page = Math.max(1, Number(req.query && req.query.page || 1));
    var pageSize = Math.min(100, Math.max(10, Number(req.query && req.query.pageSize || 25)));
    var offset = (page - 1) * pageSize;
    var query = supabase.from("quotes").select("*,quote_lines(id,line_number,sku,description,quantity,active),purchase_order_quote_links(purchase_order_id,purchase_orders(po_number))", { count: "exact" })
      .eq("site_id", CACHE_SITE_ID).order("updated_at", { ascending: false }).range(offset, offset + pageSize - 1);
    if (["draft","sent","accepted","declined","expired"].indexOf(status) !== -1) query = query.eq("status", status);
    if (q) query = query.or("quote_number.ilike.%" + q + "%,customer_name.ilike.%" + q + "%");
    var result = await query;
    if (result.error) {
      if (missingQuotesTable(result.error)) return res.status(200).json({ rows: [], total: 0, status: "missing_table" });
      throw result.error;
    }
    var rows = (result.data || []).map(function(row) {
      var lines = (row.quote_lines || []).filter(function(line) { return line.active; }).sort(function(a,b) { return Number(a.line_number) - Number(b.line_number); });
      row.quantity = lines.reduce(function(sum, line) { return sum + Number(line.quantity || 0); }, 0);
      row.items = lines.map(function(line) { return { sku: line.sku || "", description: line.description }; });
      row.linkedPurchaseOrders = (row.purchase_order_quote_links || []).map(function(link) { return { id: link.purchase_order_id, poNumber: link.purchase_orders && link.purchase_orders.po_number || "" }; });
      delete row.quote_lines;
      delete row.purchase_order_quote_links;
      return row;
    });
    return res.status(200).json({ rows: rows, total: result.count || 0, page: page, pageSize: pageSize });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Quote list failed" });
  }
}
