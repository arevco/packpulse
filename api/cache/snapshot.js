import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import Sentry from "../_sentry.js";
import { buildLaborEvents, classifyShiftET, toEasternParts, toIso } from "../_labor.js";
import { isMissingTableError } from "../_event-window.js";
import { getAuthenticatedUser } from "../_session.js";
import { refreshOpsPerformanceViews } from "./_performance-views.js";
import { writeLaborEventsSafely } from "./_labor-write.js";
import { writeProductionEventsSafely } from "./_production-write.js";

const CACHE_SITE_ID = process.env.CACHE_SITE_ID || "default";

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
  const allowed = ["inventory", "workOrders", "productionData", "laborData", "evoconData", "itemMaster", "boms", "edrData", "dockData", "meta"];
  const out = {};
  allowed.forEach(function(k) {
    if (Object.prototype.hasOwnProperty.call(p, k)) out[k] = p[k];
  });
  return out;
}

function clonePlain(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function describeError(error) {
  return String(
    (error && (error.message || error.details || error.hint || error.error_description || error.code)) ||
    error ||
    ""
  ).trim();
}

function summarizeError(error, maxLen) {
  var limit = Math.max(40, Number(maxLen || 220));
  var message = describeError(error).replace(/\s+/g, " ").trim();
  if (!message) return "unknown";
  return message.length > limit ? message.slice(0, limit - 3) + "..." : message;
}

function isMissingOptionalTableError(table, error) {
  var msg = describeError(error).toLowerCase();
  var tableName = String(table || "").toLowerCase();
  if (!tableName) return false;
  return msg.includes(tableName) && (
    msg.includes("schema cache") ||
    msg.includes("could not find the table") ||
    msg.includes("relation") ||
    msg.includes("does not exist")
  );
}

function isTransientUpstreamError(error) {
  var msg = describeError(error).toLowerCase();
  var status = Number(error && (error.status || error.statusCode || error.code));
  if (Number.isFinite(status) && status >= 500) return true;
  return (
    msg.includes("<html") ||
    msg.includes("cloudflare") ||
    msg.includes("internal server error") ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("gateway timeout")
  );
}

function wait(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

async function bestEffortInsert(operation) {
  var attempts = 0;
  var lastError = null;
  while (attempts < 2) {
    attempts += 1;
    try {
      var result = await operation();
      if (!result || !result.error) {
        return { ok: true, data: result && result.data ? result.data : null, attempts: attempts };
      }
      lastError = result.error;
    } catch (error) {
      lastError = error;
    }
    if (attempts >= 2 || !isTransientUpstreamError(lastError)) break;
    await wait(150 * attempts);
  }
  return { ok: false, error: lastError, attempts: attempts };
}

function compactRows(rows, opts) {
  var maxRows = (opts && opts.maxRows) || 1200;
  if (!Array.isArray(rows)) return [];
  var sliced = rows.slice(0, maxRows);
  return sliced.map(function(r) {
    if (!r || typeof r !== "object") return r;
    var copy = Object.assign({}, r);
    // Large nested raw payloads are not needed for shared cache hydration.
    if (Object.prototype.hasOwnProperty.call(copy, "raw")) delete copy.raw;
    return copy;
  });
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function pickLooseInventoryValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var wanted = normalizeLooseKey(keys[i]);
    for (var j = 0; j < rowKeys.length; j++) {
      var rowKey = rowKeys[j];
      if (normalizeLooseKey(rowKey) === wanted) return row[rowKey];
    }
  }
  return "";
}

function shouldCompactInventoryPayload(rows, meta) {
  if (!Array.isArray(rows) || !rows.length) return false;
  var name = String(meta && meta.inventoryFileName || "").toLowerCase();
  if (name.includes("nulogy")) return true;
  var sourceMarkers = 0;
  var sampleSize = Math.min(rows.length, 40);
  for (var i = 0; i < sampleSize; i++) {
    var row = rows[i] || {};
    var source = String(pickLooseInventoryValue(row, ["Source", "source"]) || "").toLowerCase();
    if (source && (source.includes("inventory") || source.includes("locator") || source.includes("compact") || source.includes("nulogy"))) {
      sourceMarkers += 1;
    }
  }
  return sourceMarkers > 0;
}

function compactInventoryRows(rows) {
  var grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var sku = String(pickLooseInventoryValue(row, ["Item Code", "item_code", "SKU", "sku", "Item", "item"]) || "").trim();
    var description = String(pickLooseInventoryValue(row, ["Description", "description", "Item Description", "item_description"]) || "").trim();
    var qty = toNum(pickLooseInventoryValue(row, ["Qty On Hand", "qty_on_hand", "Base quantity", "base_quantity", "Quantity", "quantity", "Available", "available"]));
    var status = String(pickLooseInventoryValue(row, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
    var customer = String(pickLooseInventoryValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
    var baseUom = String(pickLooseInventoryValue(row, ["Base UOM", "base_uom", "Base unit of measure", "base_unit_of_measure", "UOM", "uom"]) || "").trim();
    var itemCategory = String(pickLooseInventoryValue(row, ["Item Category", "item_category", "Item category name", "item_category_name"]) || "").trim();
    var source = String(pickLooseInventoryValue(row, ["Source", "source"]) || "").trim();
    if (!sku && !description && !(qty > 0) && !status && !customer) return;
    var key = [
      normalizeLooseKey(sku),
      normalizeLooseKey(status),
      normalizeLooseKey(customer),
      normalizeLooseKey(baseUom),
      normalizeLooseKey(itemCategory)
    ].join("|");
    if (!grouped[key]) {
      grouped[key] = {
        "Item Code": sku || "--",
        "Description": description || "--",
        "Qty On Hand": 0,
        "Inventory Status": status || "",
        "Customer Name": customer || "",
        "Base UOM": baseUom || "",
        "Item Category": itemCategory || "",
        "Source": source || "compact_inventory"
      };
    }
    grouped[key]["Qty On Hand"] += qty;
    if ((!grouped[key]["Description"] || grouped[key]["Description"] === "--") && description) {
      grouped[key]["Description"] = description;
    }
    if (!grouped[key]["Item Category"] && itemCategory) grouped[key]["Item Category"] = itemCategory;
    if (!grouped[key]["Source"] && source) grouped[key]["Source"] = source;
    if (grouped[key]["Source"] && source && grouped[key]["Source"] !== source) {
      grouped[key]["Source"] = "report_compact_inventory";
    }
  });
  return Object.values(grouped);
}

function compactPayloadForCache(input) {
  var payload = clonePlain(input);
  var dropped = [];
  var bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  var SOFT_LIMIT = 3_000_000; // Keep well below typical edge/serverless payload limits.

  // First pass: trim known heavy arrays while preserving useful hydration data.
  if (Array.isArray(payload.inventory) && shouldCompactInventoryPayload(payload.inventory, payload.meta)) {
    payload.inventory = compactInventoryRows(payload.inventory);
  }
  if (Array.isArray(payload.productionData)) payload.productionData = compactRows(payload.productionData, { maxRows: 1400 });
  if (Array.isArray(payload.laborData)) payload.laborData = compactRows(payload.laborData, { maxRows: 1400 });
  if (Array.isArray(payload.evoconData)) payload.evoconData = compactRows(payload.evoconData, { maxRows: 1400 });
  bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");

  // Progressive drop of optional datasets if payload is still too large.
  var optionalOrder = ["evoconData", "productionData", "laborData", "edrData", "dockData", "boms"];
  for (var i = 0; i < optionalOrder.length && bytes > SOFT_LIMIT; i++) {
    var key = optionalOrder[i];
    if (Array.isArray(payload[key]) && payload[key].length) {
      dropped.push(key);
      payload[key] = [];
      bytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    }
  }

  if (!payload.meta || typeof payload.meta !== "object") payload.meta = {};
  payload.meta.cachePayloadBytes = bytes;
  payload.meta.cacheDroppedDatasets = dropped;
  return { payload: payload, bytes: bytes, dropped: dropped };
}

function rowCountsFromPayload(payload) {
  return {
    inventory: Array.isArray(payload.inventory) ? payload.inventory.length : 0,
    workOrders: Array.isArray(payload.workOrders) ? payload.workOrders.length : 0,
    productionData: Array.isArray(payload.productionData) ? payload.productionData.length : 0,
    laborData: Array.isArray(payload.laborData) ? payload.laborData.length : 0,
    evoconData: Array.isArray(payload.evoconData) ? payload.evoconData.length : 0,
    itemMaster: Array.isArray(payload.itemMaster) ? payload.itemMaster.length : 0,
    boms: Array.isArray(payload.boms) ? payload.boms.length : 0,
    edrData: Array.isArray(payload.edrData) ? payload.edrData.length : 0,
    dockData: Array.isArray(payload.dockData) ? payload.dockData.length : 0,
  };
}

function uniqueStringValues(values) {
  var seen = {};
  var out = [];
  (Array.isArray(values) ? values : []).forEach(function(value) {
    var key = String(value || "").trim();
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push(key);
  });
  return out;
}

function payloadMeta(payload) {
  return payload && payload.meta && typeof payload.meta === "object"
    ? payload.meta
    : {};
}

function clientReportedRowCounts(payload) {
  var meta = payloadMeta(payload);
  return meta.clientRowCounts && typeof meta.clientRowCounts === "object"
    ? meta.clientRowCounts
    : {};
}

function payloadDatasetState(payload, key) {
  var meta = payloadMeta(payload);
  var rows = Array.isArray(payload && payload[key]) ? payload[key] : [];
  var clientCounts = clientReportedRowCounts(payload);
  var clientCount = Number(clientCounts && clientCounts[key]);
  var trimmed = uniqueStringValues(meta.clientTrimmedDatasets).indexOf(key) !== -1;
  var dropped = uniqueStringValues(meta.clientDroppedDatasets).indexOf(key) !== -1;
  var truncated = trimmed || dropped || (Number.isFinite(clientCount) && clientCount > rows.length);
  return {
    rows: rows,
    rowCount: rows.length,
    clientCount: Number.isFinite(clientCount) ? clientCount : rows.length,
    trimmed: trimmed,
    dropped: dropped,
    truncated: truncated
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
    laborRows: rowCounts.laborData || 0,
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

function buildProductionEvents(payload, siteId, syncedAt, updatedBy) {
  var rows = Array.isArray(payload && payload.productionData) ? payload.productionData : [];
  var dedup = {};
  var hashOccurrences = {};
  rows.forEach(function(row) {
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

async function logSyncRun(supabase, row) {
  var run = await bestEffortInsert(function() {
    return supabase.from("sync_runs").insert(row);
  });
  if (run.ok) {
    return { ok: true, status: "ok", attempts: run.attempts };
  }
  if (isMissingOptionalTableError("sync_runs", run.error)) {
    return { ok: false, status: "missing_sync_runs_table", attempts: run.attempts };
  }
  if (isTransientUpstreamError(run.error)) {
    console.warn("[cache/snapshot] sync_runs insert unavailable after " + run.attempts + " attempts: " + summarizeError(run.error));
    return { ok: false, status: "sync_runs_unavailable", attempts: run.attempts };
  }
  Sentry.captureException(run.error);
  return { ok: false, status: "sync_runs_insert_failed", attempts: run.attempts };
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
      const incomingPayload = sanitizePayload((req.body && req.body.payload) || {});
      const rowCounts = rowCountsFromPayload(incomingPayload);
      const derivedMetrics = deriveMetrics(incomingPayload, rowCounts);
      const syncedAt = new Date().toISOString();
      var snapshotVersion = String(Date.now());
      var compacted = compactPayloadForCache(incomingPayload);
      const payload = compacted.payload;
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
        .select("site_id,row_counts,synced_at,updated_by")
        .single();
      if (up.error) throw up.error;
      const hist = await bestEffortInsert(function() {
        return supabase
          .from("cache_snapshot_history")
          .insert({
            site_id: CACHE_SITE_ID,
            row_counts: rowCounts,
            derived_metrics: derivedMetrics,
            captured_at: up.data && up.data.synced_at ? up.data.synced_at : syncedAt,
            updated_by: user.email,
          });
      });
      let historyStatus = "ok";
      if (!hist.ok) {
        if (isMissingOptionalTableError("cache_snapshot_history", hist.error)) {
          // Non-blocking: keep core snapshot cache live even if history table is not present yet.
          historyStatus = "missing_history_table";
        } else if (isTransientUpstreamError(hist.error)) {
          console.warn("[cache/snapshot] cache_snapshot_history insert unavailable after " + hist.attempts + " attempts: " + summarizeError(hist.error));
          historyStatus = "history_upstream_unavailable";
        } else {
          Sentry.captureException(hist.error);
          historyStatus = "history_insert_failed";
        }
      }
      // Shared snapshot POSTs may contain intentionally compacted production/labor datasets.
      // Never rewrite canonical event tables unless this request still carries the full dataset.
      var productionState = payloadDatasetState(incomingPayload, "productionData");
      var laborState = payloadDatasetState(incomingPayload, "laborData");
      var productionEvents = productionState.truncated
        ? []
        : buildProductionEvents(incomingPayload, CACHE_SITE_ID, syncedAt, user.email);
      var laborEvents = laborState.truncated
        ? []
        : buildLaborEvents(laborState.rows, CACHE_SITE_ID, syncedAt, user.email);
      var productionStatus = "ok";
      var productionWritten = 0;
      var productionWriteMode = "noop";
      var productionCorrectionStart = null;
      var productionDeletedWindowStart = null;
      var productionDeletedWindowEnd = null;
      var productionGuardedDateKeys = [];
      var laborStatus = "ok";
      var laborWritten = 0;
      var laborWriteMode = "noop";
      var laborCorrectionStart = null;
      var laborDeletedWindowStart = null;
      var laborDeletedWindowEnd = null;
      var laborGuardedDateKeys = [];
      var performanceViewRefreshStatus = "noop";
      var performanceViewRefreshDetails = null;
      if (productionState.truncated) {
        productionStatus = "skipped_truncated_snapshot_production";
        productionWriteMode = "skipped_truncated_snapshot";
        console.warn("[cache/snapshot] Skipping production_events rewrite from compacted shared snapshot.", {
          payloadRows: productionState.rowCount,
          clientRows: productionState.clientCount,
          trimmed: productionState.trimmed,
          dropped: productionState.dropped
        });
      } else if (productionEvents.length > 0) {
        // Keep one extra calendar day in the correction window so the next business-day
        // refresh can still repair a partial Friday write after a quiet weekend.
        var productionCorrectionDays = Number(process.env.PRODUCTION_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 4);
        try {
          var productionWrite = await writeProductionEventsSafely(supabase, {
            siteId: CACHE_SITE_ID,
            events: productionEvents,
            correctionDays: productionCorrectionDays
          });
          productionWriteMode = productionWrite.writeMode;
          productionCorrectionStart = productionWrite.correctionStart;
          productionWritten = productionWrite.written;
          productionDeletedWindowStart = productionWrite.deletedWindowStart;
          productionDeletedWindowEnd = productionWrite.deletedWindowEnd;
          productionGuardedDateKeys = productionWrite.guardedDateKeys || [];
        } catch (productionErr) {
          if (isMissingTableError("production_events", productionErr)) {
            productionStatus = "missing_production_events_table";
          } else {
            productionStatus = "production_events_write_failed";
            Sentry.captureException(productionErr);
          }
        }
      }
      if (laborState.truncated) {
        laborStatus = "skipped_truncated_snapshot_labor";
        laborWriteMode = "skipped_truncated_snapshot";
        console.warn("[cache/snapshot] Skipping labor_events rewrite from compacted shared snapshot.", {
          payloadRows: laborState.rowCount,
          clientRows: laborState.clientCount,
          trimmed: laborState.trimmed,
          dropped: laborState.dropped
        });
      } else if (laborEvents.length > 0) {
        try {
          var laborWrite = await writeLaborEventsSafely(supabase, {
            siteId: CACHE_SITE_ID,
            events: laborEvents,
            correctionDays: Number(process.env.LABOR_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 60)
          });
          laborWriteMode = laborWrite.writeMode;
          laborCorrectionStart = laborWrite.correctionStart;
          laborWritten = laborWrite.written;
          laborDeletedWindowStart = laborWrite.deletedWindowStart;
          laborDeletedWindowEnd = laborWrite.deletedWindowEnd;
          laborGuardedDateKeys = laborWrite.guardedDateKeys || [];
        } catch (laborErr) {
          if (isMissingTableError("labor_events", laborErr)) {
            laborStatus = "missing_labor_events_table";
          } else {
            laborStatus = "labor_events_write_failed";
            Sentry.captureException(laborErr);
          }
        }
      }
      if (
        (productionWritten > 0 || laborWritten > 0) &&
        (productionStatus === "ok" || laborStatus === "ok")
      ) {
        try {
          var refreshResult = await refreshOpsPerformanceViews(supabase);
          performanceViewRefreshStatus = refreshResult.status;
          performanceViewRefreshDetails = refreshResult.details;
        } catch (refreshErr) {
          performanceViewRefreshStatus = "refresh_failed";
          performanceViewRefreshDetails = refreshErr && refreshErr.message ? refreshErr.message : "unknown";
          Sentry.captureException(refreshErr);
        }
      }
      var syncRun = await logSyncRun(supabase, {
        site_id: CACHE_SITE_ID,
        source: "snapshot",
        status: historyStatus === "ok" &&
          (productionStatus === "ok" || productionStatus === "missing_production_events_table") &&
          (laborStatus === "ok" || laborStatus === "missing_labor_events_table")
            ? "ok"
            : "partial",
        row_counts: rowCounts,
        details: {
          historyStatus: historyStatus,
          productionStatus: productionStatus,
          productionRowsSubmitted: productionEvents.length,
          productionPayloadRows: productionState.rowCount,
          productionClientRows: productionState.clientCount,
          productionPayloadTruncated: productionState.truncated,
          productionRowsWritten: productionWritten,
          productionWriteMode: productionWriteMode,
          productionCorrectionStart: productionCorrectionStart,
          productionDeletedWindowStart: productionDeletedWindowStart,
          productionDeletedWindowEnd: productionDeletedWindowEnd,
          productionGuardedDateKeys: productionGuardedDateKeys,
          laborStatus: laborStatus,
          laborRowsSubmitted: laborEvents.length,
          laborPayloadRows: laborState.rowCount,
          laborClientRows: laborState.clientCount,
          laborPayloadTruncated: laborState.truncated,
          laborRowsWritten: laborWritten,
          laborWriteMode: laborWriteMode,
          laborCorrectionStart: laborCorrectionStart,
          laborDeletedWindowStart: laborDeletedWindowStart,
          laborDeletedWindowEnd: laborDeletedWindowEnd,
          laborGuardedDateKeys: laborGuardedDateKeys,
          performanceViewRefreshStatus: performanceViewRefreshStatus,
          performanceViewRefreshDetails: performanceViewRefreshDetails,
          snapshotVersion: snapshotVersion,
          cachePayloadBytes: compacted.bytes,
          cacheDroppedDatasets: compacted.dropped
        },
        started_at: syncedAt,
        finished_at: new Date().toISOString(),
        updated_by: user.email
      });
      return res.status(200).json({
        ok: true,
        snapshot: Object.assign({}, up.data, {
          snapshot_version: snapshotVersion
        }),
        historyStatus: historyStatus,
        productionStatus: productionStatus,
        productionRowsSubmitted: productionEvents.length,
        productionPayloadRows: productionState.rowCount,
        productionClientRows: productionState.clientCount,
        productionPayloadTruncated: productionState.truncated,
        productionRowsWritten: productionWritten,
        productionWriteMode: productionWriteMode,
        productionCorrectionStart: productionCorrectionStart,
        productionDeletedWindowStart: productionDeletedWindowStart,
        productionDeletedWindowEnd: productionDeletedWindowEnd,
        productionGuardedDateKeys: productionGuardedDateKeys,
        laborStatus: laborStatus,
        laborRowsSubmitted: laborEvents.length,
        laborPayloadRows: laborState.rowCount,
        laborClientRows: laborState.clientCount,
        laborPayloadTruncated: laborState.truncated,
        laborRowsWritten: laborWritten,
        laborWriteMode: laborWriteMode,
        laborCorrectionStart: laborCorrectionStart,
        laborDeletedWindowStart: laborDeletedWindowStart,
        laborDeletedWindowEnd: laborDeletedWindowEnd,
        laborGuardedDateKeys: laborGuardedDateKeys,
        syncRunStatus: syncRun.status,
        cachePayloadBytes: compacted.bytes,
        cacheDroppedDatasets: compacted.dropped
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Snapshot cache request failed", details: err && err.message ? err.message : "unknown" });
  }
}
