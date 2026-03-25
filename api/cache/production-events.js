import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { classifyShiftET, toEasternParts, toIso } from "../_labor.js";
import { isMissingTableError } from "../_event-window.js";
import { getAuthenticatedUser } from "../_session.js";
import { writeProductionEventsSafely } from "./_production-write.js";

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

function buildProductionEvents(rows, siteId, syncedAt, updatedBy) {
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
      return res.status(200).json({ ok: true, submitted: rows.length, written: 0, note: "no_positive_unit_rows" });
    }
    const supabase = getSupabaseAdmin();
    try {
      var writeResult = await writeProductionEventsSafely(supabase, {
        siteId: CACHE_SITE_ID,
        events: events,
        correctionDays: Number(process.env.PRODUCTION_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 60)
      });
      return res.status(200).json({
        ok: true,
        submitted: rows.length,
        submittedEvents: events.length,
        writeMode: writeResult.writeMode,
        correctionStart: writeResult.correctionStart,
        written: writeResult.written,
        deletedWindowStart: writeResult.deletedWindowStart,
        deletedWindowEnd: writeResult.deletedWindowEnd,
        guardedDateKeys: writeResult.guardedDateKeys || []
      });
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
