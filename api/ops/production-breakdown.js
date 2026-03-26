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
  var wanted = {};
  keys.forEach(function(k) {
    wanted[String(k || "").replace(/[^a-z0-9]/gi, "").toLowerCase()] = true;
  });
  for (var x = 0; x < rowKeys.length; x++) {
    var rowKey = rowKeys[x];
    var normalized = String(rowKey || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (wanted[normalized]) return row[rowKey];
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

function isMissingDailyMetricsViewError(error) {
  var msg = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
  return msg.indexOf("ops_daily_line_metrics_mv") !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
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

async function fetchDailyMetricRows(supabase, siteId, fromDate, toDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = supabase
      .from("ops_daily_line_metrics_mv")
      .select("date_et,shift_label,line_name,produced_units,production_rows")
      .eq("site_id", siteId)
      .gte("date_et", fromDate)
      .order("date_et", { ascending: false })
      .range(from, to);
    if (toDate) query = query.lte("date_et", toDate);
    var q = await query;
    if (q.error) return { error: q.error, data: out };
    var rows = Array.isArray(q.data) ? q.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 200000) break;
  }
  return { error: null, data: out };
}

function buildSummaryPayloadFromMetricRows(rows, querySource) {
  var byDay = {};
  var byShift = {};
  var byLine = {};
  var byDateLine = {};
  var totalRows = 0;

  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var date = String(row && row.date_et || "");
    var shift = String(row && row.shift_label || "Unassigned");
    var line = String(row && row.line_name || "Unknown");
    var units = toNum(row && row.produced_units);
    var rowCount = toNum(row && row.production_rows);
    if (!date || !(units > 0)) return;

    totalRows += rowCount;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += rowCount;

    var shiftKey = date + "|" + shift;
    if (!byShift[shiftKey]) byShift[shiftKey] = { date: date, shift: shift, units: 0, rows: 0 };
    byShift[shiftKey].units += units;
    byShift[shiftKey].rows += rowCount;

    if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
    byLine[line].units += units;
    byLine[line].rows += rowCount;

    if (!byDateLine[date]) byDateLine[date] = {};
    if (!byDateLine[date][line]) byDateLine[date][line] = { line: line, units: 0, rows: 0 };
    byDateLine[date][line].units += units;
    byDateLine[date][line].rows += rowCount;
  });

  var latestDate = Object.keys(byDateLine).sort().pop() || null;
  return {
    querySource: querySource || "ops_daily_line_metrics_mv",
    summaryOnly: true,
    totalRows: totalRows,
    rowsLite: [],
    byDay: Object.values(byDay).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
    byShift: Object.values(byShift).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return String(a.shift || "").localeCompare(String(b.shift || ""));
    }),
    byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
    latestDate: latestDate,
    latestByLine: latestDate ? Object.values(byDateLine[latestDate]).sort(function(a, b) { return b.units - a.units; }) : []
  };
}

function buildDetailedPayloadFromRows(rows, querySource) {
  var bySku = {};
  var byLine = {};
  var byDate = {};
  var byDaySku = {};
  var byShift = {};

  (Array.isArray(rows) ? rows : []).forEach(function(r) {
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
      var shiftKey = dateKey + "|" + String(timing.shift || r.shift_label || "Unassigned");
      if (!byShift[shiftKey]) {
        byShift[shiftKey] = {
          date: dateKey,
          shift: String(timing.shift || r.shift_label || "Unassigned"),
          units: 0,
          rows: 0
        };
      }
      byShift[shiftKey].units += units;
      byShift[shiftKey].rows += 1;
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

  return {
    querySource: querySource || "production_events",
    summaryOnly: false,
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
    byDay: Object.keys(byDate).sort().reverse().map(function(dateKey) {
      var lineMap = byDate[dateKey] || {};
      var totals = Object.values(lineMap).reduce(function(acc, row) {
        acc.units += toNum(row.units);
        acc.rows += toNum(row.rows);
        return acc;
      }, { date: dateKey, units: 0, rows: 0 });
      return totals;
    }),
    byShift: Object.values(byShift).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return String(a.shift || "").localeCompare(String(b.shift || ""));
    }),
    bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }).slice(0, 200),
    byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
    latestDate: latestDate,
    latestByLine: latestByLine,
    byDaySku: Object.keys(byDaySku).sort().reduce(function(out, dayKey) {
      return out.concat(Object.values(byDaySku[dayKey]).sort(function(a, b) {
        return b.units - a.units;
      }));
    }, [])
  };
}


export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();
    const summaryOnly = /^(1|true|yes)$/i.test(String((req.query && req.query.summary) || "").trim());

    const hasRange = !!(sanitizeIsoDate(req.query.start) && sanitizeIsoDate(req.query.end));
    const days = hasRange ? 0 : Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const fromDate = hasRange ? sanitizeIsoDate(req.query.start) : toDateEt(days);
    const toDate = hasRange ? sanitizeIsoDate(req.query.end) : "";
    if (!fromDate || (hasRange && (!toDate || toDate < fromDate))) {
      return res.status(400).json({ error: "Invalid start/end date range" });
    }

    if (summaryOnly) {
      const summaryQ = await fetchDailyMetricRows(supabase, CACHE_SITE_ID, fromDate, toDate);
      if (!summaryQ.error) {
        const summaryPayload = buildSummaryPayloadFromMetricRows(summaryQ.data || [], "ops_daily_line_metrics_mv");
        return res.status(200).json(Object.assign({
          days: days,
          fromDate: fromDate,
          toDate: toDate || null
        }, summaryPayload));
      }
      if (!isMissingDailyMetricsViewError(summaryQ.error)) throw summaryQ.error;
    }

    const q = await fetchAllProductionRows(supabase, CACHE_SITE_ID, fromDate, toDate);
    if (q.error) throw q.error;
    const rows = Array.isArray(q.data) ? q.data : [];
    const payload = summaryOnly
      ? buildSummaryPayloadFromMetricRows(rows.map(function(r) {
          var timing = resolveProductionTiming(r);
          return {
            date_et: String(timing.date || r.produced_date_et || ""),
            shift_label: String(timing.shift || r.shift_label || "Unassigned"),
            line_name: String(r.line || "Unknown"),
            produced_units: toNum(r.units_produced),
            production_rows: 1
          };
        }), "production_events_fallback")
      : buildDetailedPayloadFromRows(rows, "production_events");

    return res.status(200).json(Object.assign({
      days: days,
      fromDate: fromDate,
      toDate: toDate || null
    }, payload));
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops production breakdown failed", details: err && err.message ? err.message : "unknown" });
  }
}
