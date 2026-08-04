import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { key, text } from "./_service.js";

function missingTable(error) {
  var message = String(error && error.message || "").toLowerCase();
  return message.indexOf("purchase_orders") !== -1 && (message.indexOf("schema cache") !== -1 || message.indexOf("relation") !== -1);
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var status = text(req.query && req.query.status, 40).toLowerCase();
    var q = text(req.query && req.query.q, 160);
    var page = Math.max(1, Number(req.query && req.query.page || 1));
    var pageSize = Math.min(100, Math.max(10, Number(req.query && req.query.pageSize || 25)));
    var sort = text(req.query && req.query.sort, 40);
    var direction = text(req.query && req.query.direction, 8).toLowerCase() === "asc";
    var sortable = { updated_at: true, po_date: true, expected_date: true, po_number: true, customer_name: true, total: true, status: true };
    if (!sortable[sort]) sort = "updated_at";
    var offset = (page - 1) * pageSize;
    var query = supabase.from("purchase_orders")
      .select("*,purchase_order_lines(id,line_number,sku,description,quantity,produced_quantity,remaining_quantity,match_status,active)", { count: "exact" })
      .eq("site_id", CACHE_SITE_ID)
      .order(sort, { ascending: direction, nullsFirst: false })
      .range(offset, offset + pageSize - 1);
    if (status === "suggested_closed") query = query.eq("status", "open").eq("suggested_status", "closed");
    else if (["open","closed","cancelled","draft"].indexOf(status) !== -1) query = query.eq("status", status);
    if (q) query = query.or("po_number.ilike.%" + q.replace(/[%_,()]/g, "") + "%,customer_name.ilike.%" + q.replace(/[%_,()]/g, "") + "%");
    var result = await query;
    if (result.error) {
      if (missingTable(result.error)) return res.status(200).json({ rows: [], counts: {}, total: 0, status: "missing_table" });
      throw result.error;
    }
    var countsResult = await supabase.from("purchase_orders").select("status,suggested_status").eq("site_id", CACHE_SITE_ID);
    if (countsResult.error) throw countsResult.error;
    var counts = { all: 0, open: 0, suggested_closed: 0, closed: 0, cancelled: 0, draft: 0 };
    (countsResult.data || []).forEach(function(row) {
      counts.all += 1;
      if (counts[row.status] != null) counts[row.status] += 1;
      if (row.status === "open" && row.suggested_status === "closed") counts.suggested_closed += 1;
    });
    var rows = (result.data || []).map(function(row) {
      var activeLines = (row.purchase_order_lines || []).filter(function(line) { return line.active; }).sort(function(left, right) {
        return Number(left.line_number || 0) - Number(right.line_number || 0);
      });
      row.ordered_quantity = activeLines.reduce(function(sum, line) { return sum + Number(line.quantity || 0); }, 0);
      row.produced_quantity = activeLines.reduce(function(sum, line) { return sum + Number(line.produced_quantity || 0); }, 0);
      row.remaining_quantity = activeLines.reduce(function(sum, line) { return sum + Number(line.remaining_quantity || 0); }, 0);
      row.sku_items = activeLines.map(function(line) {
        return {
          lineNumber: Number(line.line_number || 0),
          sku: text(line.sku, 160),
          description: text(line.description, 1000)
        };
      });
      delete row.purchase_order_lines;
      return row;
    });
    return res.status(200).json({ rows: rows, counts: counts, total: result.count || 0, page: page, pageSize: pageSize });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Purchase order list failed" });
  }
}
