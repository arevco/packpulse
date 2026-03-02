import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";

const SESSION_SECRET = process.env.SESSION_SECRET || "packpulse-default-secret-change-me";
const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(";").forEach(function(c) {
    const parts = c.trim().split("=");
    const key = parts.shift();
    if (key) cookies[key.trim()] = parts.join("=").trim();
  });
  return cookies;
}

function getAuthenticatedUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const session = cookies.pp_session;
  if (!session) return null;
  const parts = session.split(":");
  if (parts.length !== 3) return null;
  const email = parts[0];
  const expires = parts[1];
  const sig = parts[2];
  const payload = email + ":" + expires;
  const expectedSig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  if (sig !== expectedSig) return null;
  if (Date.now() > parseInt(expires, 10)) return null;
  return { email: email };
}

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

function toIso(value) {
  if (!value) return null;
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return d.toISOString();
}

function toEasternParts(value) {
  if (!value) return null;
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  var dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  var out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    dateKey: out.year + "-" + out.month + "-" + out.day,
    hour: parseInt(out.hour || "0", 10)
  };
}

function classifyShiftET(parts) {
  if (!parts) return "Unassigned";
  var hour = Number(parts.hour || 0);
  if (hour >= 7 && hour < 15) return "Shift 1 (7a-3p)";
  if (hour >= 15 && hour < 23) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

function buildProductionEvents(rows, siteId, syncedAt, updatedBy) {
  var dedup = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var units = toNum(pickFieldLoose(row, ["Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"]));
    if (!(units > 0)) return;
    var producedRaw = pickFieldLoose(row, [
      "Produced At", "produced_at", "Produced date", "producedAt",
      "Actual Job Start", "actual_job_start_at",
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
    var keyDisambiguator = (producedIso || producedRaw) ? "" : rowHash;
    var keyBase = [siteId, producedIso || producedRaw || syncedAt || "", jobId, wo, itemCode, line, units, keyDisambiguator].join("|");
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
    var written = 0;
    var chunkSize = 500;
    for (var i = 0; i < events.length; i += chunkSize) {
      var chunk = events.slice(i, i + chunkSize);
      var up = await supabase.from("production_events").upsert(chunk, { onConflict: "site_id,event_key" });
      if (up.error) {
        var msg = String(up.error.message || "").toLowerCase();
        if (msg.includes("production_events") && msg.includes("schema cache")) {
          return res.status(200).json({ ok: false, productionStatus: "missing_production_events_table", submitted: rows.length, written: written });
        }
        throw up.error;
      }
      written += chunk.length;
    }
    return res.status(200).json({ ok: true, submitted: rows.length, written: written });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Production event ingest failed", details: err && err.message ? err.message : "unknown" });
  }
}
