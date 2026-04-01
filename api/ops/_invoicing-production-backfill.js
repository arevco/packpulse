import Sentry from "../_sentry.js";
import { buildAuthHeader, getNulogyCredentials, pollReportRun } from "../nulogy/_runner.js";
import { createReportTask } from "../nulogy/create.js";
import { fetchAndTransformReport } from "../nulogy/download.js";
import { isMissingTableError } from "../_event-window.js";
import { refreshOpsPerformanceViews } from "../cache/_performance-views.js";
import { buildProductionEvents } from "../cache/production-events.js";
import { writeProductionEventsSafely } from "../cache/_production-write.js";
import { CACHE_SITE_ID, getSupabaseAdmin } from "./_common.js";
import { buildProductionCoverageAudit, pickFieldLoose, resolveProducedDateKey, sanitizeIsoDate } from "./_production-coverage.js";

export const MAX_INVOICING_PRODUCTION_BACKFILL_DAYS = 45;

function createHttpError(statusCode, message) {
  var error = new Error(message || "Request failed");
  error.statusCode = Number(statusCode) || 500;
  return error;
}

export function normalizeWorkOrderList(value) {
  var list = Array.isArray(value) ? value : [];
  var seen = {};
  return list
    .map(function(entry) {
      return String(entry || "").trim();
    })
    .filter(function(entry) {
      if (!entry || seen[entry]) return false;
      seen[entry] = true;
      return true;
    });
}

export function daySpanInclusive(startDate, endDate) {
  var start = sanitizeIsoDate(startDate);
  var end = sanitizeIsoDate(endDate);
  if (!start || !end || end < start) return 0;
  var startMs = Date.parse(start + "T12:00:00Z");
  var endMs = Date.parse(end + "T12:00:00Z");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.round((endMs - startMs) / 86400000) + 1;
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

function filterRowsToDateRange(rows, startDate, endDate) {
  return (Array.isArray(rows) ? rows : []).filter(function(row) {
    var producedDate = resolveProducedDateKey(
      pickFieldLoose(row, [
        "Produced Date ET", "produced_date_et",
        "Produced date", "produced_date",
        "Produced At", "produced_at",
        "produced_at_utc",
        "Actual Job end date", "actual_job_end_at"
      ]) || ""
    );
    if (!producedDate) return false;
    if (startDate && producedDate < startDate) return false;
    if (endDate && producedDate > endDate) return false;
    return true;
  });
}

export async function runInvoicingProductionBackfill(options) {
  var input = options && typeof options === "object" ? options : {};
  var startDate = sanitizeIsoDate(input.startDate || input.start);
  var endDate = sanitizeIsoDate(input.endDate || input.end);
  var focusWorkOrders = normalizeWorkOrderList(input.workOrders || input.focusWorkOrders);
  var updatedBy = String(input.updatedBy || input.userEmail || "system").trim() || "system";
  var siteId = String(input.siteId || CACHE_SITE_ID || "default").trim() || "default";

  if (!startDate || !endDate || endDate < startDate) {
    throw createHttpError(400, "Invalid start/end date range");
  }
  var windowDays = daySpanInclusive(startDate, endDate);
  if (!(windowDays > 0) || windowDays > MAX_INVOICING_PRODUCTION_BACKFILL_DAYS) {
    throw createHttpError(400, "Historical production backfill is limited to 45 days per request.");
  }

  var supabase = input.supabase || getSupabaseAdmin();
  var beforeRows = [];
  try {
    beforeRows = await fetchRangeRows(supabase, siteId, startDate, endDate);
  } catch (beforeErr) {
    if (!isMissingTableError("production_events", beforeErr)) throw beforeErr;
  }
  var beforeAudit = buildProductionCoverageAudit(beforeRows, { focusWorkOrders: focusWorkOrders });

  var createResult = await createReportTask({
    reportType: "production",
    startDate: startDate,
    endDate: endDate
  });
  if (createResult.statusCode >= 400) {
    throw createHttpError(createResult.statusCode, createResult.body && createResult.body.error || "Failed to create production report task.");
  }

  var credentials = getNulogyCredentials();
  var authHeader = buildAuthHeader(credentials.user, credentials.pass);
  var polled = await pollReportRun(createResult.body.statusUrl, authHeader, {
    pollIntervalMs: 2500,
    maxPolls: 90
  });
  if (!polled.ok) {
    throw createHttpError(502, polled.error || "Production backfill report did not complete successfully.");
  }
  if (!polled.completed || !polled.downloadUrl) {
    return {
      ok: false,
      pending: true,
      startDate: startDate,
      endDate: endDate,
      windowDays: windowDays,
      focusWorkOrders: focusWorkOrders,
      beforeAudit: beforeAudit,
      reportRequest: createResult.body,
      reportStatusHistory: polled.statusHistory || []
    };
  }

  var downloadResult = await fetchAndTransformReport(polled.downloadUrl, "production", false);
  if (!downloadResult.ok) {
    throw createHttpError(downloadResult.statusCode || 502, downloadResult.body && downloadResult.body.error || "Failed to download production backfill report.");
  }

  var downloadedRows = Array.isArray(downloadResult.body.data) ? downloadResult.body.data : [];
  var sourceRows = filterRowsToDateRange(downloadedRows, startDate, endDate);
  var sourceAudit = buildProductionCoverageAudit(sourceRows, { focusWorkOrders: focusWorkOrders });
  var syncedAt = new Date().toISOString();
  var events = buildProductionEvents(sourceRows, siteId, syncedAt, updatedBy);
  if (!events.length) {
    return {
      ok: true,
      startDate: startDate,
      endDate: endDate,
      windowDays: windowDays,
      focusWorkOrders: focusWorkOrders,
      rowsDownloaded: downloadedRows.length,
      rowsInRequestedWindow: sourceRows.length,
      eventsBuilt: 0,
      beforeAudit: beforeAudit,
      sourceAudit: sourceAudit,
      note: "No positive-unit production rows were available in the selected date window."
    };
  }

  var writeResult = await writeProductionEventsSafely(supabase, {
    siteId: siteId,
    events: events,
    correctionDays: windowDays,
    forceFullBackfill: true
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

  var afterRows = [];
  try {
    afterRows = await fetchRangeRows(supabase, siteId, startDate, endDate);
  } catch (afterErr) {
    if (!isMissingTableError("production_events", afterErr)) throw afterErr;
  }
  var afterAudit = buildProductionCoverageAudit(afterRows, { focusWorkOrders: focusWorkOrders });

  return {
    ok: true,
    startDate: startDate,
    endDate: endDate,
    windowDays: windowDays,
    focusWorkOrders: focusWorkOrders,
    reportStatusUrl: createResult.body.statusUrl,
    reportColumnsUsed: createResult.body.columnsUsed || [],
    reportAttempt: createResult.body.attempt || 0,
    reportStatusHistory: polled.statusHistory || [],
    reportDownloadUrl: polled.downloadUrl,
    rowsDownloaded: downloadedRows.length,
    rowsInRequestedWindow: sourceRows.length,
    eventsBuilt: events.length,
    writeMode: writeResult.writeMode,
    written: writeResult.written,
    deletedWindowStart: writeResult.deletedWindowStart,
    deletedWindowEnd: writeResult.deletedWindowEnd,
    correctionStart: writeResult.correctionStart,
    performanceViewRefreshStatus: refreshResult.status,
    performanceViewRefreshDetails: refreshResult.details,
    beforeAudit: beforeAudit,
    sourceAudit: sourceAudit,
    afterAudit: afterAudit,
    note: "Backfill rewrote the full selected production date window. Focus work orders are used for audit summaries only to avoid partial-date event replacement."
  };
}
