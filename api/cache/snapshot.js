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
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function sanitizePayload(p) {
  if (!p || typeof p !== "object") return {};
  const allowed = ["inventory", "workOrders", "productionData", "evoconData", "itemMaster", "boms", "edrData", "dockData", "meta"];
  const out = {};
  allowed.forEach(function(k) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  });
  return out;
}

function rowCountsFromPayload(payload) {
  return {
    inventory: Array.isArray(payload.inventory) ? payload.inventory.length : 0,
    workOrders: Array.isArray(payload.workOrders) ? payload.workOrders.length : 0,
    productionData: Array.isArray(payload.productionData) ? payload.productionData.length : 0,
    evoconData: Array.isArray(payload.evoconData) ? payload.evoconData.length : 0,
    itemMaster: Array.isArray(payload.itemMaster) ? payload.itemMaster.length : 0,
    boms: Array.isArray(payload.boms) ? payload.boms.length : 0,
    edrData: Array.isArray(payload.edrData) ? payload.edrData.length : 0,
    dockData: Array.isArray(payload.dockData) ? payload.dockData.length : 0,
  };
}

function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (v == null || v === "") return 0;
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pickField(row, keys) {
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

function statusLooksClosed(status) {
  var s = String(status || "").toLowerCase();
  if (!s) return false;
  return s.includes("close") || s.includes("complete") || s.includes("cancel") || s.includes("archive") || s.includes("done");
}

function deriveMetrics(payload, rowCounts) {
  var workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
  var remainingUnits = 0;
  var lateWOs = 0;
  var activeWOs = 0;
  var today = new Date();
  today.setHours(0, 0, 0, 0);

  workOrders.forEach(function(wo) {
    var status = pickField(wo, ["Work Order Status", "status", "project_status"]);
    var unitsRemaining = toNum(pickField(wo, ["Units Remaining", "units_remaining"]));
    if (!unitsRemaining) {
      var expected = toNum(pickField(wo, ["Units Expected", "units_expected", "Order Qty", "qtyToProduce"] ));
      var produced = toNum(pickField(wo, ["Units Produced", "units_produced", "Produced", "unitsProduced"] ));
      unitsRemaining = Math.max(0, expected - produced);
    }
    remainingUnits += unitsRemaining;

    var closed = statusLooksClosed(status);
    if (!closed && unitsRemaining > 0) activeWOs += 1;

    var dueRaw = pickField(wo, ["Due Date", "due_date_at", "dueDate"]);
    if (!closed && unitsRemaining > 0 && dueRaw) {
      var dd = new Date(dueRaw);
      if (!isNaN(dd) && dd < today) lateWOs += 1;
    }
  });

  return {
    woCount: rowCounts.workOrders || 0,
    woActive: activeWOs,
    woLate: lateWOs,
    woRemainingUnits: Math.round(remainingUnits),
    inventoryRows: rowCounts.inventory || 0,
    productionRows: rowCounts.productionData || 0,
    evoconRows: rowCounts.evoconData || 0,
    bomRows: rowCounts.boms || 0,
    edrRows: rowCounts.edrData || 0,
    dockRows: rowCounts.dockData || 0,
  };
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

function toIso(value) {
  if (!value) return null;
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  return d.toISOString();
}

function buildProductionEvents(payload, siteId, syncedAt, updatedBy) {
  var rows = Array.isArray(payload && payload.productionData) ? payload.productionData : [];
  var dedup = {};
  rows.forEach(function(row, idx) {
    var units = toNum(pickFieldLoose(row, ["Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"]));
    if (!(units > 0)) return;
    var producedRaw = pickFieldLoose(row, [
      // Canonical production timestamp: completed job time aligns with close reporting.
      "Actual Job End", "actual_job_end_at",
      "Produced At", "produced_at", "Produced date", "producedAt",
      "Actual Job Start", "actual_job_start_at"
    ]);
    var producedIso = toIso(producedRaw);
    var eastern = toEasternParts(producedIso || producedRaw);
    var shift = classifyShiftET(eastern);
    var jobId = String(pickFieldLoose(row, ["Job ID", "job_id", "Job"]) || "").trim();
    var wo = String(pickFieldLoose(row, ["Work Order Code", "project_code", "Project Code"]) || "").trim();
    var itemCode = String(pickFieldLoose(row, ["Item Code", "item_code"]) || "").trim();
    var line = String(pickFieldLoose(row, ["Line", "line", "line_name", "Line Name"]) || "").trim();
    var rowHash = stableRowHash(row);
    // Snapshot rows are replaced per sync; preserve row-level granularity and avoid accidental merges.
    var keyBase = [siteId, rowHash, String(idx)].join("|");
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

async function logSyncRun(supabase, row) {
  try {
    const run = await supabase.from("sync_runs").insert(row);
    if (run.error) {
      var msg = String(run.error.message || "").toLowerCase();
      if (msg.includes("sync_runs") && msg.includes("schema cache")) {
        return { ok: false, status: "missing_sync_runs_table" };
      }
      Sentry.captureException(run.error);
      return { ok: false, status: "sync_runs_insert_failed" };
    }
    return { ok: true, status: "ok" };
  } catch (e) {
    Sentry.captureException(e);
    return { ok: false, status: "sync_runs_insert_failed" };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const user = getAuthenticatedUser(req);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      const q = await supabase
        .from("cache_snapshots")
        .select("site_id,payload,row_counts,synced_at,updated_by")
        .eq("site_id", CACHE_SITE_ID)
        .maybeSingle();
      if (q.error) throw q.error;
      if (!q.data) return res.status(200).json({ snapshot: null });
      return res.status(200).json({ snapshot: q.data });
    }

    if (req.method === "POST") {
      const payload = sanitizePayload((req.body && req.body.payload) || {});
      const rowCounts = rowCountsFromPayload(payload);
      const derivedMetrics = deriveMetrics(payload, rowCounts);
      const syncedAt = new Date().toISOString();
      var snapshotVersion = String(Date.now());
      if (!payload.meta || typeof payload.meta !== "object") payload.meta = {};
      payload.meta.snapshotVersion = snapshotVersion;
      const up = await supabase
        .from("cache_snapshots")
        .upsert({
          site_id: CACHE_SITE_ID,
          payload: payload,
          row_counts: rowCounts,
          synced_at: syncedAt,
          updated_by: user.email,
        }, { onConflict: "site_id" })
        .select("site_id,row_counts,synced_at,updated_by,payload")
        .single();
      if (up.error) throw up.error;
      const hist = await supabase
        .from("cache_snapshot_history")
        .insert({
          site_id: CACHE_SITE_ID,
          row_counts: rowCounts,
          derived_metrics: derivedMetrics,
          captured_at: up.data && up.data.synced_at ? up.data.synced_at : syncedAt,
          updated_by: user.email,
        });
      let historyStatus = "ok";
      if (hist.error) {
        var msg = String(hist.error.message || "").toLowerCase();
        if (msg.includes("cache_snapshot_history") && msg.includes("schema cache")) {
          // Non-blocking: keep core snapshot cache live even if history table is not present yet.
          historyStatus = "missing_history_table";
        } else {
          Sentry.captureException(hist.error);
          historyStatus = "history_insert_failed";
        }
      }
      var productionEvents = buildProductionEvents(payload, CACHE_SITE_ID, syncedAt, user.email);
      var productionStatus = "ok";
      var productionWritten = 0;
      if (productionEvents.length > 0) {
        var del = await supabase.from("production_events").delete().eq("site_id", CACHE_SITE_ID);
        if (del.error) {
          var delMsg = String(del.error.message || "").toLowerCase();
          if (delMsg.includes("production_events") && delMsg.includes("schema cache")) {
            productionStatus = "missing_production_events_table";
          } else {
            productionStatus = "production_events_delete_failed";
            Sentry.captureException(del.error);
          }
        }
      }
      if (productionEvents.length > 0 && productionStatus === "ok") {
        var chunkSize = 500;
        for (var i = 0; i < productionEvents.length; i += chunkSize) {
          var chunk = productionEvents.slice(i, i + chunkSize);
          var pe = await supabase
            .from("production_events")
            .upsert(chunk, { onConflict: "site_id,event_key" });
          if (pe.error) {
            var peMsg = String(pe.error.message || "").toLowerCase();
            if (peMsg.includes("production_events") && peMsg.includes("schema cache")) {
              productionStatus = "missing_production_events_table";
            } else {
              productionStatus = "production_events_upsert_failed";
              Sentry.captureException(pe.error);
            }
            break;
          }
          productionWritten += chunk.length;
        }
      }
      var syncRun = await logSyncRun(supabase, {
        site_id: CACHE_SITE_ID,
        source: "snapshot",
        status: historyStatus === "ok" && (productionStatus === "ok" || productionStatus === "missing_production_events_table") ? "ok" : "partial",
        row_counts: rowCounts,
        details: {
          historyStatus: historyStatus,
          productionStatus: productionStatus,
          productionRowsSubmitted: productionEvents.length,
          productionRowsWritten: productionWritten,
          snapshotVersion: snapshotVersion
        },
        started_at: syncedAt,
        finished_at: new Date().toISOString(),
        updated_by: user.email
      });
      return res.status(200).json({
        ok: true,
        snapshot: Object.assign({}, up.data, {
          snapshot_version: (up.data && up.data.payload && up.data.payload.meta && up.data.payload.meta.snapshotVersion) || snapshotVersion
        }),
        historyStatus: historyStatus,
        productionStatus: productionStatus,
        productionRowsSubmitted: productionEvents.length,
        productionRowsWritten: productionWritten,
        syncRunStatus: syncRun.status
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Snapshot cache request failed", details: err && err.message ? err.message : "unknown" });
  }
}
