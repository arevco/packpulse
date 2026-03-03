import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toDateEt, toNum, withCors } from "./_common.js";

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = String(keys[i]).toLowerCase();
    for (var j = 0; j < rowKeys.length; j++) {
      var rk = rowKeys[j];
      if (String(rk).toLowerCase() === target) return row[rk];
    }
  }
  return "";
}

async function fetchAllProductionRows(supabase, siteId, fromDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var q = await supabase
      .from("production_events")
      .select("event_key,produced_date_et,shift_label,item_code,units_produced,line,work_order_code,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", fromDate)
      .order("produced_date_et", { ascending: false })
      .range(from, to);
    if (q.error) return { error: q.error, data: out };
    var rows = Array.isArray(q.data) ? q.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return { error: null, data: out };
}


export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();

    const days = Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const fromDate = toDateEt(days);

    const q = await fetchAllProductionRows(supabase, CACHE_SITE_ID, fromDate);
    if (q.error) throw q.error;
    const rows = Array.isArray(q.data) ? q.data : [];
    const bySku = {};
    const byLine = {};
    const byDate = {};

    rows.forEach(function(r) {
      const sku = String(r.item_code || "UNKNOWN");
      const units = toNum(r.units_produced);
      const line = String(r.line || "Unknown");
      const dateKey = String(r.produced_date_et || "");
      if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
      bySku[sku].units += units;
      bySku[sku].rows += 1;
      if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
      byLine[line].units += units;
      byLine[line].rows += 1;
      if (dateKey) {
        if (!byDate[dateKey]) byDate[dateKey] = {};
        if (!byDate[dateKey][line]) byDate[dateKey][line] = { line: line, units: 0, rows: 0 };
        byDate[dateKey][line].units += units;
        byDate[dateKey][line].rows += 1;
      }
    });

    const latestDate = Object.keys(byDate).sort().pop() || null;
    const latestByLine = latestDate ? Object.values(byDate[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [];

    return res.status(200).json({
      days: days,
      fromDate: fromDate,
      totalRows: rows.length,
      rowsLite: rows.map(function(r) {
        var itemDesc = pickFieldLoose(r.raw, ["item_description", "Item Description", "Description", "description"]);
        return {
          produced_date_et: r.produced_date_et || null,
          shift_label: r.shift_label || null,
          item_code: r.item_code || null,
          item_desc: itemDesc ? String(itemDesc) : null,
          units_produced: toNum(r.units_produced),
          line: r.line || null,
          work_order_code: r.work_order_code || null
        };
      }),
      bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }).slice(0, 200),
      byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
      latestDate: latestDate,
      latestByLine: latestByLine
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops production breakdown failed", details: err && err.message ? err.message : "unknown" });
  }
}
