import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toDateEt, toNum, withCors } from "./_common.js";
import { classifyShiftET, toEasternParts, toIso } from "../_labor.js";

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

function resolveProductionTiming(row) {
  var producedRaw = pickFieldLoose(row && row.raw, [
    "Produced date", "producedAt",
    "Produced At", "produced_at",
    "Actual Job End", "actual_job_end_at"
  ]);
  var producedIso = toIso(producedRaw);
  var eastern = toEasternParts(producedIso || producedRaw);
  return {
    date: eastern && eastern.dateKey ? eastern.dateKey : String(row && row.produced_date_et || ""),
    shift: eastern ? classifyShiftET(eastern) : String(row && row.shift_label || "Unassigned")
  };
}

function sanitizeIsoDate(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function resolveJobWindow(row) {
  var startRaw = pickFieldLoose(row && row.raw, [
    "Actual Job Start", "actual_job_start_at",
    "Actual Job Start At", "actualJobStartAt"
  ]);
  var endRaw = pickFieldLoose(row && row.raw, [
    "Actual Job End", "actual_job_end_at",
    "Actual Job End At", "actualJobEndAt",
    "Produced At", "produced_at"
  ]) || row && row.produced_at_utc;
  return {
    startAtUtc: toIso(startRaw),
    endAtUtc: toIso(endRaw)
  };
}

async function fetchAllProductionRows(supabase, siteId, fromDate, toDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = supabase
      .from("production_events")
      .select("event_key,produced_at_utc,produced_date_et,shift_label,job_id,item_code,units_produced,line,work_order_code,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", fromDate)
      .order("produced_date_et", { ascending: false })
      .range(from, to);
    if (toDate) query = query.lte("produced_date_et", toDate);
    var q = await query;
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

    const hasRange = !!(sanitizeIsoDate(req.query.start) && sanitizeIsoDate(req.query.end));
    const days = hasRange ? 0 : Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const fromDate = hasRange ? sanitizeIsoDate(req.query.start) : toDateEt(days);
    const toDate = hasRange ? sanitizeIsoDate(req.query.end) : "";
    if (!fromDate || (hasRange && (!toDate || toDate < fromDate))) {
      return res.status(400).json({ error: "Invalid start/end date range" });
    }

    const q = await fetchAllProductionRows(supabase, CACHE_SITE_ID, fromDate, toDate);
    if (q.error) throw q.error;
    const rows = Array.isArray(q.data) ? q.data : [];
    const bySku = {};
    const byLine = {};
    const byDate = {};
    const byDaySku = {};

    rows.forEach(function(r) {
      const timing = resolveProductionTiming(r);
      const sku = String(r.item_code || "UNKNOWN");
      const units = toNum(r.units_produced);
      const line = String(r.line || "Unknown");
      const dateKey = String(timing.date || r.produced_date_et || "");
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
        if (!byDaySku[dateKey]) byDaySku[dateKey] = {};
        if (!byDaySku[dateKey][sku]) byDaySku[dateKey][sku] = { day_key: dateKey, item_code: sku, units: 0 };
        byDaySku[dateKey][sku].units += units;
      }
    });

    const latestDate = Object.keys(byDate).sort().pop() || null;
    const latestByLine = latestDate ? Object.values(byDate[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [];

    return res.status(200).json({
      days: days,
      fromDate: fromDate,
      toDate: toDate || null,
      totalRows: rows.length,
      rowsLite: rows.map(function(r) {
        var timing = resolveProductionTiming(r);
        var window = resolveJobWindow(r);
        var itemDesc = pickFieldLoose(r.raw, ["item_description", "Item Description", "Description", "description"]);
        return {
          produced_at_utc: r.produced_at_utc || null,
          produced_date_et: timing.date || r.produced_date_et || null,
          shift_label: timing.shift || r.shift_label || null,
          job_id: r.job_id || null,
          item_code: r.item_code || null,
          item_desc: itemDesc ? String(itemDesc) : null,
          units_produced: toNum(r.units_produced),
          line: r.line || null,
          work_order_code: r.work_order_code || null,
          job_start_at_utc: window.startAtUtc || null,
          job_end_at_utc: window.endAtUtc || null
        };
      }),
      byDaySku: Object.keys(byDaySku).sort().reduce(function(out, dayKey) {
        return out.concat(Object.values(byDaySku[dayKey]).sort(function(a, b) {
          return b.units - a.units;
        }));
      }, []),
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
