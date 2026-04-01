import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";
import { isMissingTableError } from "../_event-window.js";
import { buildProductionCoverageAudit } from "./_production-coverage.js";

function sanitizeIsoDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i += 1) {
    var target = String(keys[i] || "").toLowerCase();
    for (var j = 0; j < rowKeys.length; j += 1) {
      var rowKey = rowKeys[j];
      if (String(rowKey || "").toLowerCase() === target) return row[rowKey];
    }
  }
  var wanted = {};
  keys.forEach(function(key) {
    wanted[normalizeLooseKey(key)] = true;
  });
  for (var x = 0; x < rowKeys.length; x += 1) {
    var looseKey = rowKeys[x];
    if (wanted[normalizeLooseKey(looseKey)]) return row[looseKey];
  }
  return "";
}

function normalizeRawRow(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_error) {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

function buildInvoicingRow(row) {
  var raw = normalizeRawRow(row && row.raw);
  var producedAt = pickFieldLoose(raw, ["Produced At", "Produced date", "produced_at"]) || row && (row.produced_at_utc || row.produced_date_et) || "";
  return {
    "Customer Name": pickFieldLoose(raw, ["Customer Name", "Customer name", "customer_name"]),
    "Item Code": pickFieldLoose(raw, ["Item Code", "item_code"]) || row && row.item_code || "",
    "Description": pickFieldLoose(raw, ["Description", "Item Description", "item_description", "description"]),
    "Lot Code": pickFieldLoose(raw, ["Lot Code", "Lot code", "lot_code"]),
    "Produced At": producedAt,
    produced_date_et: row && row.produced_date_et || "",
    produced_at_utc: row && row.produced_at_utc || "",
    "Units Produced": pickFieldLoose(raw, ["Units Produced", "units_produced"]) || row && row.units_produced || "",
    "Work Order Code": pickFieldLoose(raw, ["Work Order Code", "Work Order code", "project_code"]) || row && row.work_order_code || "",
    "Work Order": pickFieldLoose(raw, ["Work Order", "Work Order ID", "work_order_id"]),
    "Purchase Order Number": pickFieldLoose(raw, ["Purchase Order Number", "Purchase Order number", "purchase_order_number"]),
    "Job ID": pickFieldLoose(raw, ["Job ID", "Job", "job_id"]) || row && row.job_id || "",
    "Line": pickFieldLoose(raw, ["Line", "line", "Line Name", "line_name"]) || row && row.line || "",
    "Unit of Measure": pickFieldLoose(raw, ["Unit of Measure", "Unit of measure", "unit_of_measure", "uom"]),
    "Reference 1": pickFieldLoose(raw, ["Reference 1", "reference_1"]),
    source_snapshot_at: row && row.source_snapshot_at || ""
  };
}

async function fetchAvailableDateRange(supabase, siteId) {
  var latestSyncQ = supabase
    .from("production_events")
    .select("source_snapshot_at")
    .eq("site_id", siteId)
    .not("source_snapshot_at", "is", null)
    .order("source_snapshot_at", { ascending: false })
    .limit(1);
  var queries = await Promise.all([
    supabase
      .from("production_events")
      .select("produced_date_et")
      .eq("site_id", siteId)
      .not("produced_date_et", "is", null)
      .order("produced_date_et", { ascending: true })
      .limit(1),
    supabase
      .from("production_events")
      .select("produced_date_et")
      .eq("site_id", siteId)
      .not("produced_date_et", "is", null)
      .order("produced_date_et", { ascending: false })
      .limit(1),
    latestSyncQ
  ]);
  var minQ = queries[0];
  var maxQ = queries[1];
  var latestQ = queries[2];
  if (minQ.error) throw minQ.error;
  if (maxQ.error) throw maxQ.error;
  if (latestQ.error) throw latestQ.error;
  return {
    min: Array.isArray(minQ.data) && minQ.data[0] ? String(minQ.data[0].produced_date_et || "") : "",
    max: Array.isArray(maxQ.data) && maxQ.data[0] ? String(maxQ.data[0].produced_date_et || "") : "",
    latestSyncedAt: Array.isArray(latestQ.data) && latestQ.data[0] ? String(latestQ.data[0].source_snapshot_at || "") : ""
  };
}

async function fetchRangeRows(supabase, siteId, startDate, endDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = await supabase
      .from("production_events")
      .select("event_key,produced_date_et,produced_at_utc,job_id,item_code,units_produced,line,work_order_code,source_snapshot_at,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", startDate)
      .lte("produced_date_et", endDate)
      .order("produced_date_et", { ascending: false })
      .range(from, to);
    if (query.error) throw query.error;
    var rows = Array.isArray(query.data) ? query.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var startDate = sanitizeIsoDate(req.query && req.query.start);
    var endDate = sanitizeIsoDate(req.query && req.query.end);
    if (!startDate || !endDate || endDate < startDate) {
      return res.status(400).json({ error: "Invalid start/end date range" });
    }

    var supabase = getSupabaseAdmin();
    var results = await Promise.all([
      fetchAvailableDateRange(supabase, CACHE_SITE_ID),
      fetchRangeRows(supabase, CACHE_SITE_ID, startDate, endDate)
    ]);
    var availableDateRange = results[0];
    var rows = results[1];
    var coverageAudit = buildProductionCoverageAudit(rows);

    return res.status(200).json({
      querySource: "production_events",
      startDate: startDate,
      endDate: endDate,
      rowCount: rows.length,
      availableDateRange: {
        min: availableDateRange.min || "",
        max: availableDateRange.max || ""
      },
      latestSyncedAt: availableDateRange.latestSyncedAt || "",
      coverageAudit: coverageAudit,
      rows: rows.map(buildInvoicingRow)
    });
  } catch (err) {
    if (isMissingTableError("production_events", err)) {
      return res.status(200).json({
        querySource: "missing_production_events_table",
        startDate: sanitizeIsoDate(req.query && req.query.start),
        endDate: sanitizeIsoDate(req.query && req.query.end),
        rowCount: 0,
        availableDateRange: { min: "", max: "" },
        latestSyncedAt: "",
        coverageAudit: buildProductionCoverageAudit([]),
        rows: []
      });
    }
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Invoicing production history failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
