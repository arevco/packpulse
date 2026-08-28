import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { classifyShiftET, toEasternParts, toIso } from "../_labor.js";
import { isMissingTableError } from "../_event-window.js";
import { getAuthenticatedUser } from "../_session.js";
import { refreshOpsPerformanceViews } from "./_performance-views.js";
import { writeProductionEventsSafely } from "./_production-write.js";
import { reconcileProductionJobCoverage } from "../ops/_production-coverage.js";

const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null || v === "") return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeKey(s) {
  return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function stableRowHash(row) {
  if (!row || typeof row !== "object") return "";
  var keys = Object.keys(row).sort();
  var out = {};
  keys.forEach(function(k) { out[k] = row[k]; });
  return crypto.createHash("sha1").update(JSON.stringify(out)).digest("hex");
}

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
  keys.forEach(function(k) { wanted[normalizeKey(k)] = true; });
  for (var x = 0; x < rowKeys.length; x++) {
    var rowKey = rowKeys[x];
    if (wanted[normalizeKey(rowKey)]) return row[rowKey];
  }
  return "";
}

export function buildProductionEvents(rows, siteId, syncedAt, updatedBy) {
  var dedup = {};
  var hashOccurrences = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var units = toNum(pickFieldLoose(row, ["Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"]));
    if (!(units > 0)) return;
    var producedRaw = pickFieldLoose(row, [
      // Prefer the row-level produced timestamp for shift attribution.
      // Fall back to job close only when the produced event time is unavailable.
      "Produced date", "producedAt",
      "Produced At", "produced_at",
      "Actual Job End", "actual_job_end_at"
    ]);
    var producedIso = toIso(producedRaw);
    var eastern = toEasternParts(producedIso || producedRaw || syncedAt);
    var shift = classifyShiftET(eastern);
    var jobId = String(pickFieldLoose(row, ["Job ID", "job_id", "Job"]) || "").trim();
    var wo = String(pickFieldLoose(row, ["Work Order Code", "project_code", "Project Code"]) || "").trim();
    var itemCode = String(pickFieldLoose(row, ["Item Code", "item_code"]) || "").trim();
    var line = String(pickFieldLoose(row, ["Line", "line", "line_name", "Line Name"]) || "").trim();
    var rowHash = stableRowHash(row);
    var occurrence = (hashOccurrences[rowHash] || 0) + 1;
    hashOccurrences[rowHash] = occurrence;
    var keyBase = [siteId, rowHash, String(occurrence)].join("|");
    var eventKey = crypto.createHash("sha1").update(keyBase).digest("hex");
    dedup[eventKey] = {
      site_id: siteId,
      event_key: eventKey,
      produced_at_utc: producedIso,
      produced_date_et: eastern ? eastern.dateKey : null,
      shift_label: shift,
      job_id: jobId || null,
      work_order_code: wo || null,
      item_code: itemCode || null,
      line: line || null,
      units_produced: units,
      source_snapshot_at: syncedAt,
      updated_by: updatedBy,
      raw: row
    };
  });
  return Object.values(dedup);
}

function productionEventDateWindow(events) {
  var dates = (Array.isArray(events) ? events : [])
    .map(function(event) { return String(event && event.produced_date_et || "").slice(0, 10); })
    .filter(function(dateKey) { return /^\d{4}-\d{2}-\d{2}$/.test(dateKey); })
    .sort();
  return {
    startDate: dates.length ? dates[0] : "",
    endDate: dates.length ? dates[dates.length - 1] : ""
  };
}

async function fetchStoredProductionRows(supabase, siteId, startDate, endDate) {
  var rows = [];
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var query = await supabase
      .from("production_events")
      .select("produced_date_et,job_id,work_order_code,item_code,line,units_produced,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", startDate)
      .lte("produced_date_et", endDate)
      .order("produced_date_et", { ascending: false })
      .range(from, from + pageSize - 1);
    if (query.error) throw query.error;
    var page = Array.isArray(query.data) ? query.data : [];
    rows = rows.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return rows;
}

export function buildProductionIngestReconciliation(sourceRows, storedRows) {
  var reconciliation = reconcileProductionJobCoverage(sourceRows, storedRows);
  return Object.assign({}, reconciliation, {
    status: reconciliation.reconciled ? "reconciled" : "mismatch"
  });
}

async function logProductionSyncRun(supabase, details) {
  var result = await supabase.from("sync_runs").insert({
    site_id: CACHE_SITE_ID,
    source: "nulogy_production",
    status: details && details.status === "reconciled" ? "ok" : "partial",
    row_counts: {
      sourceRows: Number(details && details.sourceRows || 0),
      writtenRows: Number(details && details.writtenRows || 0),
      sourceJobs: Number(details && details.reconciliation && details.reconciliation.sourceJobCount || 0),
      storedJobs: Number(details && details.reconciliation && details.reconciliation.storedJobCount || 0),
      sourceUnits: Number(details && details.reconciliation && details.reconciliation.sourceUnits || 0),
      storedUnits: Number(details && details.reconciliation && details.reconciliation.storedUnits || 0)
    },
    details: details || {},
    started_at: details && details.startedAt || new Date().toISOString(),
    finished_at: new Date().toISOString(),
    updated_by: details && details.updatedBy || "system"
  });
  if (result.error && !isMissingTableError("sync_runs", result.error)) {
    Sentry.captureException(result.error);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const rows = req.body && Array.isArray(req.body.rows) ? req.body.rows : [];
    const syncedAt = req.body && req.body.syncedAt ? String(req.body.syncedAt) : new Date().toISOString();
    const events = buildProductionEvents(rows, CACHE_SITE_ID, syncedAt, user.email);
    if (!events.length) {
      Sentry.captureMessage("Nulogy production ingest returned no positive-unit rows", "warning");
      return res.status(422).json({
        ok: false,
        productionStatus: "empty_source",
        submitted: rows.length,
        written: 0,
        note: "Nulogy production ingest returned no positive-unit rows; PackPulse data was not changed."
      });
    }
    const supabase = getSupabaseAdmin();
    // Keep one extra calendar day in the correction window so the next business-day
    // refresh can still repair a partial Friday write after a quiet weekend.
    var correctionDays = Number(process.env.PRODUCTION_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 4);
    try {
      var writeResult = await writeProductionEventsSafely(supabase, {
        siteId: CACHE_SITE_ID,
        events: events,
        correctionDays: correctionDays
      });
      var refreshResult = { status: "noop", details: null };
      if (writeResult.written > 0) {
        try {
          refreshResult = await refreshOpsPerformanceViews(supabase);
        } catch (refreshErr) {
          Sentry.captureException(refreshErr);
          refreshResult = {
            status: "refresh_failed",
            details: refreshErr && refreshErr.message ? refreshErr.message : "unknown"
          };
        }
      }
      var dateWindow = productionEventDateWindow(events);
      var storedRows = dateWindow.startDate && dateWindow.endDate
        ? await fetchStoredProductionRows(supabase, CACHE_SITE_ID, dateWindow.startDate, dateWindow.endDate)
        : [];
      var reconciliation = buildProductionIngestReconciliation(rows, storedRows);
      var responseBody = {
        ok: reconciliation.reconciled,
        submitted: rows.length,
        submittedEvents: events.length,
        writeMode: writeResult.writeMode,
        correctionStart: writeResult.correctionStart,
        written: writeResult.written,
        deletedWindowStart: writeResult.deletedWindowStart,
        deletedWindowEnd: writeResult.deletedWindowEnd,
        guardedDateKeys: writeResult.guardedDateKeys || [],
        performanceViewRefreshStatus: refreshResult.status,
        performanceViewRefreshDetails: refreshResult.details,
        reconciliationWindow: dateWindow,
        reconciliationStatus: reconciliation.status,
        reconciliation: reconciliation
      };
      await logProductionSyncRun(supabase, {
        status: reconciliation.status,
        sourceRows: rows.length,
        writtenRows: writeResult.written,
        reconciliationWindow: dateWindow,
        reconciliation: reconciliation,
        writeMode: writeResult.writeMode,
        guardedDateKeys: writeResult.guardedDateKeys || [],
        startedAt: syncedAt,
        updatedBy: user.email
      });
      if (!reconciliation.reconciled) {
        Sentry.captureMessage(
          "Nulogy production ingest reconciliation mismatch: " +
          reconciliation.missingJobs.length + " missing, " +
          reconciliation.extraJobs.length + " extra, " +
          reconciliation.revisedJobs.length + " revised jobs",
          "error"
        );
        return res.status(409).json(responseBody);
      }
      return res.status(200).json(responseBody);
    } catch (writeErr) {
      if (isMissingTableError("production_events", writeErr)) {
        return res.status(200).json({
          ok: false,
          productionStatus: "missing_production_events_table",
          submitted: rows.length,
          submittedEvents: events.length,
          writeMode: "missing_table",
          correctionStart: null,
          written: 0
        });
      }
      throw writeErr;
    }
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Production event ingest failed", details: err && err.message ? err.message : "unknown" });
  }
}
