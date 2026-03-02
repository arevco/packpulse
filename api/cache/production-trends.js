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
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function toNumLoose(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function normalizeKey(s) {
  return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return d.toISOString();
}

function toEasternParts(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    dateKey: out.year + "-" + out.month + "-" + out.day,
    hour: parseInt(out.hour || "0", 10),
  };
}

function classifyShiftET(parts) {
  if (!parts) return "Unassigned";
  var hour = Number(parts.hour || 0);
  if (hour >= 7 && hour < 15) return "Shift 1 (7a-3p)";
  if (hour >= 15 && hour < 23) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

function buildProductionEventsFromSnapshotRows(rows, siteId, syncedAt, updatedBy) {
  var out = [];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var units = toNumLoose(pickFieldLoose(row, ["Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"]));
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
    var keyBase = [siteId, producedIso || producedRaw || syncedAt || "", jobId, wo, itemCode, line, units].join("|");
    var eventKey = crypto.createHash("sha1").update(keyBase).digest("hex");
    out.push({
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
      source_snapshot_at: syncedAt || new Date().toISOString(),
      updated_by: updatedBy || null,
      raw: row
    });
  });
  return out;
}

function toEasternDateKey(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out = {};
  dtf.formatToParts(d).forEach(function(p) {
    if (p.type !== "literal") out[p.type] = p.value;
  });
  if (!out.year || !out.month || !out.day) return "";
  return out.year + "-" + out.month + "-" + out.day;
}

function businessDateDaysAgo(days) {
  var remaining = Math.max(1, Number(days || 30));
  var d = new Date();
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    var dow = d.getDay(); // 0 Sun, 6 Sat
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    const supabase = getSupabaseAdmin();
    const days = Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const operatingDays = String(req.query.operatingDays || "true").toLowerCase() !== "false";
    const from = operatingDays ? businessDateDaysAgo(days) : (function() {
      var cd = new Date();
      cd.setDate(cd.getDate() - days);
      return cd;
    })();
    const fromDate = from.toISOString().slice(0, 10);

    const q = await supabase
      .from("production_events")
      .select("produced_date_et,produced_at_utc,source_snapshot_at,shift_label,units_produced,job_id,work_order_code,line,item_code")
      .eq("site_id", CACHE_SITE_ID)
      .order("source_snapshot_at", { ascending: false })
      .limit(60000);

    if (q.error) {
      const msg = String(q.error.message || "").toLowerCase();
      if (msg.includes("production_events") && msg.includes("schema cache")) {
        return res.status(200).json({ trends: null, productionStatus: "missing_production_events_table" });
      }
      throw q.error;
    }

    let rows = Array.isArray(q.data) ? q.data : [];
    let backfilledRows = 0;
    let backfillError = "";
    let snapshotProductionRows = 0;
    let snapshotSyncedAt = "";
    if (!rows.length) {
      const sq = await supabase
        .from("cache_snapshots")
        .select("payload,row_counts,synced_at,updated_by")
        .eq("site_id", CACHE_SITE_ID)
        .maybeSingle();
      if (!sq.error && sq.data) {
        snapshotSyncedAt = sq.data.synced_at || "";
        if (sq.data.row_counts && typeof sq.data.row_counts.productionData !== "undefined") {
          snapshotProductionRows = Number(sq.data.row_counts.productionData || 0);
        } else if (sq.data.payload && Array.isArray(sq.data.payload.productionData)) {
          snapshotProductionRows = sq.data.payload.productionData.length;
        }
      }
      if (!sq.error && sq.data && sq.data.payload && Array.isArray(sq.data.payload.productionData) && sq.data.payload.productionData.length) {
        const events = buildProductionEventsFromSnapshotRows(
          sq.data.payload.productionData,
          CACHE_SITE_ID,
          sq.data.synced_at || new Date().toISOString(),
          sq.data.updated_by || (user && user.email) || ""
        );
        if (events.length) {
          const chunkSize = 500;
          for (let i = 0; i < events.length; i += chunkSize) {
            const chunk = events.slice(i, i + chunkSize);
            const ins = await supabase
              .from("production_events")
              .upsert(chunk, { onConflict: "site_id,event_key" });
            if (ins.error) {
              backfillError = String(ins.error.message || "backfill_insert_failed");
              break;
            }
            backfilledRows += chunk.length;
          }
          const q2 = await supabase
            .from("production_events")
            .select("produced_date_et,produced_at_utc,source_snapshot_at,shift_label,units_produced,job_id,work_order_code,line,item_code")
            .eq("site_id", CACHE_SITE_ID)
            .order("source_snapshot_at", { ascending: false })
            .limit(60000);
          if (!q2.error) rows = Array.isArray(q2.data) ? q2.data : [];
        }
      }
    }
    const byDay = {};
    const byShift = {};
    let rowsMissingProducedDate = 0;
    let rowsInWindow = 0;
    rows.forEach(function(r) {
      const fromProducedDate = String(r.produced_date_et || "");
      const fallbackDate = toEasternDateKey(r.produced_at_utc) || toEasternDateKey(r.source_snapshot_at);
      const d = fromProducedDate || fallbackDate;
      if (!fromProducedDate) rowsMissingProducedDate += 1;
      if (!d || d < fromDate) return;
      rowsInWindow += 1;
      const s = String(r.shift_label || "Unassigned");
      const u = toNum(r.units_produced);
      if (!byDay[d]) byDay[d] = { date: d, units: 0, rows: 0 };
      byDay[d].units += u;
      byDay[d].rows += 1;
      const key = d + "|" + s;
      if (!byShift[key]) byShift[key] = { date: d, shift: s, units: 0, rows: 0 };
      byShift[key].units += u;
      byShift[key].rows += 1;
    });

    return res.status(200).json({
      trends: {
        days: days,
        operatingDays: operatingDays,
        fromDate: fromDate,
        totalRows: rowsInWindow,
        byDay: Object.values(byDay).sort(function(a, b) { return a.date < b.date ? 1 : -1; }),
        byShift: Object.values(byShift).sort(function(a, b) {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return a.shift < b.shift ? -1 : 1;
        }),
        diagnostics: {
          totalRowsInTable: rows.length,
          rowsMissingProducedDateEt: rowsMissingProducedDate,
          backfilledRows: backfilledRows,
          backfillError: backfillError || null,
          snapshotProductionRows: snapshotProductionRows,
          snapshotSyncedAt: snapshotSyncedAt || null
        }
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Production trends request failed", details: err && err.message ? err.message : "unknown" });
  }
}
