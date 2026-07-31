import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "./_common.js";
import { NULOGY_URL, buildAuthHeader, executeReportRun, getNulogyCredentials, pollReportRun } from "../nulogy/_runner.js";
import { parseCSV } from "../nulogy/_csv.js";
import { canonicalizeCustomerName } from "./_customer-aliases.js";
import {
  INBOUND_TRANSFER_COLUMNS as SHARED_INBOUND_TRANSFER_COLUMNS,
  OUTBOUND_TRANSFER_COLUMNS as SHARED_OUTBOUND_TRANSFER_COLUMNS,
  normalizeWarehouseTransferRows,
  applyWarehouseTransferEventsToClientMap,
  writeWarehouseTransferEvents,
} from "./_warehouse-transfers.js";

var INBOUND_REPORT = "receipt_item";
var OUTBOUND_REPORT = "shipment_item";
var STORAGE_REPORT = "pallet_storage";
var STORAGE_FALLBACK_REPORT = "pallet_aging";
var WAREHOUSE_SNAPSHOT_TABLE = "warehouse_invoicing_snapshots";
var WAREHOUSE_SNAPSHOT_HISTORY_TABLE = "cache_snapshot_history";
var WAREHOUSE_SNAPSHOT_FEATURE = "warehouse_invoicing";

var INBOUND_COLUMNS = SHARED_INBOUND_TRANSFER_COLUMNS;
var OUTBOUND_COLUMNS = SHARED_OUTBOUND_TRANSFER_COLUMNS;
var STORAGE_COLUMNS = [
  "customer_name",
  "billed_since",
  "billed_until",
  "stored_since"
];
var STORAGE_FALLBACK_COLUMNS = [
  "customer_name",
  "pallet_number",
  "stored_since"
];

var REPORT_ROW_LIMITS = {
  receipt_item: 60000,
  shipment_item: 60000,
  pallet_storage: 250000,
  pallet_aging: 60000
};

var RETRYABLE_FETCH_STATUSES = {
  408: true,
  425: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true
};
var RETRYABLE_XML_ERROR_CODES = {
  InternalError: true,
  RequestTimeout: true,
  ServiceUnavailable: true,
  SlowDown: true
};

function sanitizeIsoDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function sanitizeBooleanFlag(value) {
  var text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function sanitizeMode(value) {
  var mode = String(value || "").trim().toLowerCase();
  if (mode === "storage" || mode === "transfers") return mode;
  return "combined";
}

function describeError(error) {
  return String(
    (error && (error.message || error.details || error.hint || error.error_description || error.code)) ||
    error ||
    ""
  ).trim();
}

function summarizeDbError(error, maxLen) {
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

function isTransientSnapshotError(error) {
  var msg = describeError(error).toLowerCase();
  var status = Number(error && (error.status || error.statusCode || error.code));
  if (Number.isFinite(status) && status >= 500) return true;
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("gateway") ||
    msg.includes("connection") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("service unavailable")
  );
}

async function bestEffortSnapshotOperation(operation) {
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
    if (attempts >= 2 || !isTransientSnapshotError(lastError)) break;
    await sleep(150 * attempts);
  }
  return { ok: false, error: lastError, attempts: attempts };
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeLookupKey(value) {
  return String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeTaskId(value) {
  var text = String(value || "").trim();
  return /^\d+$/.test(text) ? text : "";
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

function normalizeCustomerName(value) {
  return canonicalizeCustomerName(value, "Unassigned customer") || "Unassigned customer";
}

function resolveDateKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var nulogyMatch = raw.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:\s+\d{1,2}:\d{2}\s*(AM|PM))?$/i);
  if (nulogyMatch) {
    var months = {
      jan: "01",
      feb: "02",
      mar: "03",
      apr: "04",
      may: "05",
      jun: "06",
      jul: "07",
      aug: "08",
      sep: "09",
      oct: "10",
      nov: "11",
      dec: "12"
    };
    var year = String(nulogyMatch[1] || "");
    var month = months[String(nulogyMatch[2] || "").toLowerCase()] || "";
    var day = String(Number(nulogyMatch[3] || 0)).padStart(2, "0");
    return year && month && day ? (year + "-" + month + "-" + day) : "";
  }
  var parsed = new Date(raw);
  if (isNaN(parsed)) return "";
  return parsed.toISOString().slice(0, 10);
}

function formatNulogyDateTime(dateIso, endOfDay) {
  var match = String(dateIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return "";
  return match[1] + "-" + monthNames[monthIndex] + "-" + match[3] + (endOfDay ? " 11:59 PM" : " 12:00 AM");
}

function summarizeReportFailure(result, report) {
  var body = result && result.body ? result.body : {};
  var messages = Array.isArray(body.failureMessages) ? body.failureMessages.filter(Boolean) : [];
  if (messages.length) return messages.join(" | ");
  if (body.error) return String(body.error);
  return "Failed to run " + report + ".";
}

function summarizeErrorText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function extractXmlErrorCode(text) {
  var match = String(text || "").match(/<Code>([^<]+)<\/Code>/i);
  return match ? String(match[1] || "").trim() : "";
}

function hasXmlErrorPayload(text, contentType) {
  var raw = String(text || "").trim();
  var normalizedType = String(contentType || "").toLowerCase();
  if (!raw) return false;
  if (!normalizedType.includes("xml") && raw.indexOf("<?xml") !== 0) return false;
  return raw.includes("<Error>") && !!extractXmlErrorCode(raw);
}

function isRetryableXmlError(text, contentType) {
  if (!hasXmlErrorPayload(text, contentType)) return false;
  return !!RETRYABLE_XML_ERROR_CODES[extractXmlErrorCode(text)];
}

function isRetryableFetchError(error) {
  var causeCode = String(error && error.cause && error.cause.code || "").toUpperCase();
  if (
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  var message = String(error && error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("econnreset")
  );
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchTextWithRetries(url, options, errorLabel) {
  var lastError = null;
  var attempts = 3;
  var baseDelayMs = 750;

  for (var attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      var response = await fetch(url, options);
      var text = await response.text().catch(function() { return ""; });
      var contentType = response.headers.get("content-type") || "";
      var xmlErrorPayload = hasXmlErrorPayload(text, contentType);
      var retryableXmlError = isRetryableXmlError(text, contentType);

      if (!response.ok || xmlErrorPayload) {
        var prefix = attempt > 1 ? (errorLabel + " after " + attempt + " attempts") : errorLabel;
        var error = new Error(prefix + " (" + response.status + "): " + summarizeErrorText(text));
        error.statusCode = response.status;
        error.retryable = !!RETRYABLE_FETCH_STATUSES[response.status] || retryableXmlError;
        error.responseText = summarizeErrorText(text);
        error.contentType = contentType;
        lastError = error;
        if (error.retryable && attempt < attempts) {
          await sleep(baseDelayMs * attempt);
          continue;
        }
        throw error;
      }

      return {
        text: text,
        contentType: contentType
      };
    } catch (error) {
      lastError = error;
      var retryable = typeof (error && error.retryable) === "boolean"
        ? error.retryable
        : isRetryableFetchError(error);
      if (error && typeof error.retryable !== "boolean") error.retryable = retryable;
      if (retryable && attempt < attempts) {
        await sleep(baseDelayMs * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(errorLabel + " failed.");
}

async function fetchReportCsv(report, columns, options) {
  var executed = await executeReportRun({
    report: report,
    columns: columns,
    filters: Array.isArray(options && options.filters) ? options.filters : undefined,
    sort_by: options && options.sortBy ? options.sortBy : undefined,
    waitForCompletion: true,
    pollIntervalMs: 2500,
    maxPolls: Number(options && options.maxPolls) > 0 ? Number(options.maxPolls) : 60
  });
  if (!executed.ok) {
    throw new Error(summarizeReportFailure(executed, report));
  }
  var body = executed.body || {};
  if (!body.downloadUrl) {
    throw new Error("Completed " + report + " run did not return a download URL.");
  }
  var downloaded = await fetchTextWithRetries(body.downloadUrl, {
    method: "GET",
    headers: {
      "Accept": "text/csv,text/plain,application/xml,text/xml"
    }
  }, "Failed to download " + report + " CSV");
  var rows = parseCSV(downloaded.text);
  return {
    report: report,
    rows: rows,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    statusHistory: Array.isArray(body.statusHistory) ? body.statusHistory : [],
    possibleTruncation: Number(REPORT_ROW_LIMITS[report] || 0) > 0 && rows.length >= Number(REPORT_ROW_LIMITS[report] || 0)
  };
}

function getClientBucket(clientMap, customer) {
  if (!clientMap[customer]) {
    clientMap[customer] = {
      customer: customer,
      inboundPallets: 0,
      outboundPallets: 0,
      activeStoragePallets: 0
    };
  }
  return clientMap[customer];
}

function countInboundPallets(rows, startDate, endDate, clientMap) {
  var seen = {};
  var diagnostics = {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    distinctPallets: 0,
    rowsMissingCustomerName: 0,
    rowsMissingPalletNumber: 0,
    rowsMissingTransferredAt: 0
  };

  (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
    var customer = normalizeCustomerName(pickFieldLoose(row, [
      "Item Customer name", "Item Customer Name", "item_customer_name",
      "Receipt Customer name", "Receipt Customer Name", "receipt_customer_name",
      "Receive Order Customer name", "Receive Order Customer Name", "receive_order_customer_name",
      "Item Customer", "item_customer",
      "Customer Name", "customer_name"
    ]));
    var palletNumber = String(pickFieldLoose(row, [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet"
    ]) || "").trim();
    var receivedRaw = pickFieldLoose(row, [
      "Received at", "Received At", "received_at", "Received date", "Received Date"
    ]);
    var receivedDate = resolveDateKey(receivedRaw);
    if (!receivedDate) {
      diagnostics.rowsMissingTransferredAt += 1;
      return;
    }
    if (receivedDate < startDate || receivedDate > endDate) return;
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    var fallbackToken = [
      String(pickFieldLoose(row, ["Receive Order code", "Receive Order Code", "receive_order_code", "Receive Order", "receive_order"]) || "").trim(),
      String(pickFieldLoose(row, ["Item code", "Item Code", "item_code"]) || "").trim(),
      String(pickFieldLoose(row, ["Lot code", "Lot Code", "lot_code"]) || "").trim(),
      String(index)
    ].join("|");
    var distinctKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      normalizeLookupKey(String(receivedRaw || receivedDate)),
      "inbound"
    ].join("|");
    if (seen[distinctKey]) return;
    seen[distinctKey] = true;
    getClientBucket(clientMap, customer).inboundPallets += 1;
    diagnostics.distinctPallets += 1;
  });

  return diagnostics;
}

function countOutboundPallets(rows, startDate, endDate, clientMap) {
  var seen = {};
  var diagnostics = {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    distinctPallets: 0,
    rowsMissingCustomerName: 0,
    rowsMissingPalletNumber: 0,
    rowsMissingTransferredAt: 0
  };

  (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
    var customer = normalizeCustomerName(pickFieldLoose(row, [
      "Item Customer name", "Item Customer Name", "item_customer_name",
      "Shipment Customer name", "Shipment Customer Name", "shipment_customer_name",
      "Ship Order Customer name", "Ship Order Customer Name", "ship_order_customer_name",
      "Item Customer", "item_customer",
      "Customer Name", "customer_name"
    ]));
    var palletNumber = String(pickFieldLoose(row, [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet"
    ]) || "").trim();
    var shippedRaw = pickFieldLoose(row, [
      "Actual ship date", "Actual Ship Date", "actual_ship_at", "Actual Ship At"
    ]);
    var shippedDate = resolveDateKey(shippedRaw);
    if (!shippedDate) {
      diagnostics.rowsMissingTransferredAt += 1;
      return;
    }
    if (shippedDate < startDate || shippedDate > endDate) return;
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    var fallbackToken = [
      String(pickFieldLoose(row, ["Ship Order code", "Ship Order Code", "ship_order_code", "Shipment ID", "shipment_id"]) || "").trim(),
      String(pickFieldLoose(row, ["Item code", "Item Code", "item_code"]) || "").trim(),
      String(pickFieldLoose(row, ["Lot code", "Lot Code", "lot_code"]) || "").trim(),
      String(index)
    ].join("|");
    var distinctKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      normalizeLookupKey(String(shippedRaw || shippedDate)),
      "outbound"
    ].join("|");
    if (seen[distinctKey]) return;
    seen[distinctKey] = true;
    getClientBucket(clientMap, customer).outboundPallets += 1;
    diagnostics.distinctPallets += 1;
  });

  return diagnostics;
}

function countActiveStoragePallets(rows, startDate, endDate, clientMap) {
  var seen = {};
  var diagnostics = {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    distinctPallets: 0,
    rowsMissingCustomerName: 0,
    rowsMissingPalletNumber: 0,
    rowsMissingBillingWindow: 0
  };

  (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
    var customer = normalizeCustomerName(pickFieldLoose(row, [
      "Customer name", "Customer Name", "customer_name",
      "Item Customer name", "item_customer_name"
    ]));
    var palletNumber = String(pickFieldLoose(row, [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet"
    ]) || "").trim();
    var billedSince = resolveDateKey(pickFieldLoose(row, ["Billed since", "Billed Since", "billed_since"]));
    var billedUntil = resolveDateKey(pickFieldLoose(row, ["Billed until", "Billed Until", "billed_until"]));
    var storedSince = resolveDateKey(pickFieldLoose(row, ["Stored since", "Stored Since", "stored_since"]));
    var windowStart = billedSince || storedSince;
    var windowEnd = billedUntil || endDate;
    if (!windowStart && !windowEnd) {
      diagnostics.rowsMissingBillingWindow += 1;
      return;
    }
    if (windowStart && windowStart > endDate) return;
    if (windowEnd && windowEnd < startDate) return;
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    var fallbackToken = [
      String(pickFieldLoose(row, ["Item code", "Item Code", "item_code"]) || "").trim(),
      String(pickFieldLoose(row, ["Location name", "Location Name", "location_name"]) || "").trim(),
      String(index)
    ].join("|");
    var distinctKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      "storage"
    ].join("|");
    if (seen[distinctKey]) return;
    seen[distinctKey] = true;
    getClientBucket(clientMap, customer).activeStoragePallets += 1;
    diagnostics.distinctPallets += 1;
  });

  return diagnostics;
}

function buildReportDiagnostics(result, diagnostics) {
  var warnings = Array.isArray(result && result.warnings) ? result.warnings.slice() : [];
  if (result && result.possibleTruncation) {
    warnings.push("Result reached the documented Nulogy row cap and may be truncated.");
  }
  return {
    report: result && result.report ? result.report : "",
    rowCount: Number(diagnostics && diagnostics.rowCount || 0),
    distinctPallets: Number(diagnostics && diagnostics.distinctPallets || 0),
    possibleTruncation: !!(result && result.possibleTruncation),
    pending: !!(result && result.pending),
    taskId: String(result && result.taskId || ""),
    rowsMissingCustomerName: Number(diagnostics && diagnostics.rowsMissingCustomerName || 0),
    rowsMissingPalletNumber: Number(diagnostics && diagnostics.rowsMissingPalletNumber || 0),
    rowsMissingTransferredAt: Number(diagnostics && diagnostics.rowsMissingTransferredAt || 0),
    rowsMissingBillingWindow: Number(diagnostics && diagnostics.rowsMissingBillingWindow || 0),
    warnings: warnings,
    statusHistory: Array.isArray(result && result.statusHistory) ? result.statusHistory : []
  };
}

function shouldFallbackStorageReport(error) {
  var message = String(error && error.message || "");
  return (
    message.includes("undefined method 'from_threshold' for nil") ||
    message.includes("Reports::PalletStorage::Base#build_query") ||
    message.includes("pallet_storage/base.rb")
  );
}

function buildStatusUrlFromTaskId(taskId) {
  var normalized = normalizeTaskId(taskId);
  return normalized ? (NULOGY_URL + "/api/reports/report_runs/" + normalized) : "";
}

function summarizePollFailure(polled, report) {
  var message = String(polled && polled.error || "").trim();
  if (!message) return "Failed to poll " + report + ".";
  return message;
}

async function createPendingReportRun(report, columns, options) {
  var created = await executeReportRun({
    report: report,
    columns: columns,
    filters: Array.isArray(options && options.filters) ? options.filters : undefined,
    sort_by: options && options.sortBy ? options.sortBy : undefined,
    waitForCompletion: false
  });
  if (!created.ok) {
    throw new Error(summarizeReportFailure(created, report));
  }
  var body = created.body || {};
  var taskId = normalizeTaskId(body.taskId);
  if (!taskId) {
    throw new Error("Started " + report + " run did not return a task ID.");
  }
  return {
    report: report,
    pending: true,
    taskId: taskId,
    rows: [],
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    statusHistory: [],
    possibleTruncation: false
  };
}

async function resolvePendingTransferReport(taskId, report, authHeader, options) {
  var normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) {
    return createPendingReportRun(report, options.columns, options);
  }
  var statusUrl = buildStatusUrlFromTaskId(normalizedTaskId);
  var polled = await pollReportRun(statusUrl, authHeader, {
    pollIntervalMs: Number(options && options.pollIntervalMs) > 0 ? Number(options.pollIntervalMs) : 2500,
    maxPolls: Number(options && options.maxPolls) > 0 ? Number(options.maxPolls) : 2
  });
  if (!polled.ok) {
    var errorText = summarizePollFailure(polled, report);
    if (shouldRestartPendingReport(errorText)) {
      return createPendingReportRun(report, options.columns, options);
    }
    throw new Error(errorText);
  }
  if (!polled.completed) {
    return {
      report: report,
      pending: true,
      taskId: normalizedTaskId,
      rows: [],
      warnings: [],
      statusHistory: Array.isArray(polled.statusHistory) ? polled.statusHistory : [],
      possibleTruncation: false
    };
  }
  if (!polled.downloadUrl) {
    throw new Error("Completed " + report + " run did not return a download URL.");
  }
  var downloaded = await fetchTextWithRetries(polled.downloadUrl, {
    method: "GET",
    headers: {
      "Accept": "text/csv,text/plain,application/xml,text/xml"
    }
  }, "Failed to download " + report + " CSV");
  var rows = parseCSV(downloaded.text);
  return {
    report: report,
    pending: false,
    taskId: normalizedTaskId,
    rows: rows,
    warnings: [],
    statusHistory: Array.isArray(polled.statusHistory) ? polled.statusHistory : [],
    possibleTruncation: Number(REPORT_ROW_LIMITS[report] || 0) > 0 && rows.length >= Number(REPORT_ROW_LIMITS[report] || 0)
  };
}

async function fetchStorageReportWithFallback(startDate, endDate, assumptions) {
  try {
    return await fetchReportCsv(STORAGE_REPORT, STORAGE_COLUMNS, {
      maxPolls: 90
    });
  } catch (error) {
    if (!shouldFallbackStorageReport(error)) throw error;

    var fallback = await fetchReportCsv(STORAGE_FALLBACK_REPORT, STORAGE_FALLBACK_COLUMNS, {
      filters: [
        {
          column: "stored_since",
          operator: "between",
          from_threshold: formatNulogyDateTime("2000-01-01", false),
          to_threshold: formatNulogyDateTime(endDate, true)
        }
      ],
      maxPolls: 90
    });
    fallback.warnings = (Array.isArray(fallback.warnings) ? fallback.warnings.slice() : []).concat([
      "Nulogy pallet_storage failed for this tenant, so storage counts are using the current pallet_aging snapshot fallback."
    ]);
    if (Array.isArray(assumptions)) {
      assumptions.push(
        "Storage counts are currently sourced from the live pallet_aging snapshot because the tenant's pallet_storage report is failing in Nulogy."
      );
      assumptions.push(
        "When the billing window ends before the feed run time, storage fallback counts may understate historical pallets that have already shipped since that month."
      );
    }
    return fallback;
  }
}

function buildClientRowsFromMap(clientMap) {
  return Object.values(clientMap).sort(function(left, right) {
    var rightTotal = Number(right.inboundPallets || 0) + Number(right.outboundPallets || 0) + Number(right.activeStoragePallets || 0);
    var leftTotal = Number(left.inboundPallets || 0) + Number(left.outboundPallets || 0) + Number(left.activeStoragePallets || 0);
    if (rightTotal !== leftTotal) return rightTotal - leftTotal;
    return String(left.customer || "").localeCompare(String(right.customer || ""));
  });
}

function buildSummaryFromClientRows(clientRows) {
  return (Array.isArray(clientRows) ? clientRows : []).reduce(function(acc, row) {
    var inbound = Number(row && row.inboundPallets || 0);
    var outbound = Number(row && row.outboundPallets || 0);
    var storage = Number(row && row.activeStoragePallets || 0);
    acc.clientCount += 1;
    if (inbound > 0 || outbound > 0 || storage > 0) acc.activeClientCount += 1;
    acc.inboundPallets += inbound;
    acc.outboundPallets += outbound;
    acc.activeStoragePallets += storage;
    return acc;
  }, {
    clientCount: 0,
    activeClientCount: 0,
    inboundPallets: 0,
    outboundPallets: 0,
    activeStoragePallets: 0
  });
}

function addUniqueAssumption(list, message) {
  if (!message) return list;
  var next = String(message || "").trim();
  if (!next) return list;
  var target = Array.isArray(list) ? list : [];
  if (target.indexOf(next) === -1) target.push(next);
  return target;
}

function buildStoragePayload(mode, startDate, endDate, assumptions, storageResult, storageDiagnostics, storageClientRows) {
  return {
    querySource: "nulogy_reports_api_storage",
    mode: mode,
    startDate: startDate,
    endDate: endDate,
    generatedAt: new Date().toISOString(),
    pending: false,
    assumptions: (Array.isArray(assumptions) ? assumptions.slice() : []).concat([
      storageResult.report === STORAGE_REPORT
        ? "Storage counts use distinct customer and pallet rows whose billed or stored window overlaps the selected billing window."
        : "Storage fallback counts use distinct active pallets from pallet_aging whose stored_since date is on or before the selected billing window end."
    ]),
    summary: buildSummaryFromClientRows(storageClientRows),
    reports: {
      inbound: buildReportDiagnostics(null, {}),
      outbound: buildReportDiagnostics(null, {}),
      storage: buildReportDiagnostics(storageResult, storageDiagnostics)
    },
    clientRows: storageClientRows
  };
}

function buildTransferPayload(mode, startDate, endDate, assumptions, inboundResult, outboundResult, transferClientRows, inboundDiagnostics, outboundDiagnostics) {
  return {
    querySource: "nulogy_reports_api_transfers",
    mode: mode,
    startDate: startDate,
    endDate: endDate,
    generatedAt: new Date().toISOString(),
    pending: !!(inboundResult.pending || outboundResult.pending),
    assumptions: Array.isArray(assumptions) ? assumptions.slice() : [],
    summary: buildSummaryFromClientRows(transferClientRows),
    reports: {
      inbound: buildReportDiagnostics(inboundResult, inboundDiagnostics),
      outbound: buildReportDiagnostics(outboundResult, outboundDiagnostics),
      storage: buildReportDiagnostics(null, {})
    },
    clientRows: transferClientRows
  };
}

function buildCombinedPayload(mode, startDate, endDate, assumptions, inboundResult, outboundResult, storageResult, inboundDiagnostics, outboundDiagnostics, storageDiagnostics, clientRows) {
  return {
    querySource: "nulogy_reports_api",
    mode: mode,
    startDate: startDate,
    endDate: endDate,
    generatedAt: new Date().toISOString(),
    pending: false,
    assumptions: (Array.isArray(assumptions) ? assumptions.slice() : []).concat([
      storageResult.report === STORAGE_REPORT
        ? "Storage counts use distinct customer and pallet rows whose billed or stored window overlaps the selected billing window."
        : "Storage fallback counts use distinct active pallets from pallet_aging whose stored_since date is on or before the selected billing window end."
    ]),
    summary: buildSummaryFromClientRows(clientRows),
    reports: {
      inbound: buildReportDiagnostics(inboundResult, inboundDiagnostics),
      outbound: buildReportDiagnostics(outboundResult, outboundDiagnostics),
      storage: buildReportDiagnostics(storageResult, storageDiagnostics)
    },
    clientRows: clientRows
  };
}

function buildHistorySnapshotCounts(payload) {
  var summary = payload && payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  return {
    warehouse_invoicing_clients: Number(summary.clientCount || 0),
    warehouse_invoicing_active_clients: Number(summary.activeClientCount || 0),
    warehouse_invoicing_inbound_pallets: Number(summary.inboundPallets || 0),
    warehouse_invoicing_outbound_pallets: Number(summary.outboundPallets || 0),
    warehouse_invoicing_storage_pallets: Number(summary.activeStoragePallets || 0)
  };
}

function extractWarehouseSnapshotHistoryRow(row) {
  var metrics = row && row.derived_metrics && typeof row.derived_metrics === "object"
    ? row.derived_metrics
    : {};
  var payload = metrics.payload && typeof metrics.payload === "object"
    ? metrics.payload
    : null;
  if (!payload) return null;
  return {
    site_id: row && row.site_id ? row.site_id : CACHE_SITE_ID,
    snapshot_mode: String(metrics.snapshotMode || payload.mode || "").trim(),
    start_date: String(metrics.startDate || payload.startDate || "").trim(),
    end_date: String(metrics.endDate || payload.endDate || "").trim(),
    payload: payload,
    pending: !!(metrics.pending || payload.pending),
    generated_at: String(metrics.generatedAt || payload.generatedAt || row && row.captured_at || "").trim() || null,
    updated_by: row && row.updated_by ? row.updated_by : null,
    updated_at: String(row && (row.created_at || row.captured_at) || "").trim() || null
  };
}

async function readWarehouseSnapshotFromHistory(supabase, mode, startDate, endDate) {
  if (!supabase) return { ok: false, status: "cache_disabled", row: null };
  try {
    var query = await supabase
      .from(WAREHOUSE_SNAPSHOT_HISTORY_TABLE)
      .select("site_id,derived_metrics,captured_at,updated_by,created_at")
      .eq("site_id", CACHE_SITE_ID)
      .contains("derived_metrics", {
        cacheFeature: WAREHOUSE_SNAPSHOT_FEATURE,
        snapshotMode: mode,
        startDate: startDate,
        endDate: endDate
      })
      .order("captured_at", { ascending: false })
      .limit(1);
    if (query.error) {
      if (isMissingOptionalTableError(WAREHOUSE_SNAPSHOT_HISTORY_TABLE, query.error)) {
        return { ok: false, status: "missing_snapshot_history_table", row: null };
      }
      throw query.error;
    }
    var historyRow = Array.isArray(query.data) && query.data.length
      ? extractWarehouseSnapshotHistoryRow(query.data[0])
      : null;
    return { ok: true, status: historyRow ? "hit" : "miss", row: historyRow };
  } catch (error) {
    if (isTransientSnapshotError(error)) {
      console.warn("[invoicing-warehousing] Warehouse snapshot history read unavailable: " + summarizeDbError(error));
      return { ok: false, status: "snapshot_history_read_unavailable", row: null };
    }
    Sentry.captureException(error);
    return { ok: false, status: "snapshot_history_read_failed", row: null };
  }
}

async function writeWarehouseSnapshotToHistory(supabase, mode, startDate, endDate, payload, updatedBy) {
  if (!supabase) return { ok: false, status: "cache_disabled" };
  var source = payload && typeof payload === "object" ? payload : {};
  var generatedAt = String(source.generatedAt || new Date().toISOString());
  var writeResult = await bestEffortSnapshotOperation(function() {
    return supabase
      .from(WAREHOUSE_SNAPSHOT_HISTORY_TABLE)
      .insert({
        site_id: CACHE_SITE_ID,
        row_counts: buildHistorySnapshotCounts(source),
        derived_metrics: {
          cacheFeature: WAREHOUSE_SNAPSHOT_FEATURE,
          snapshotMode: mode,
          startDate: startDate,
          endDate: endDate,
          pending: !!source.pending,
          generatedAt: generatedAt,
          payload: source
        },
        captured_at: generatedAt,
        updated_by: updatedBy || null
      });
  });
  if (writeResult.ok) {
    return { ok: true, status: "ok", attempts: writeResult.attempts };
  }
  if (isMissingOptionalTableError(WAREHOUSE_SNAPSHOT_HISTORY_TABLE, writeResult.error)) {
    return { ok: false, status: "missing_snapshot_history_table", attempts: writeResult.attempts };
  }
  if (isTransientSnapshotError(writeResult.error)) {
    console.warn("[invoicing-warehousing] Warehouse snapshot history write unavailable after " + writeResult.attempts + " attempts: " + summarizeDbError(writeResult.error));
    return { ok: false, status: "snapshot_history_write_unavailable", attempts: writeResult.attempts };
  }
  Sentry.captureException(writeResult.error);
  return { ok: false, status: "snapshot_history_write_failed", attempts: writeResult.attempts };
}

function decorateCachedSnapshotPayload(payload) {
  var source = payload && typeof payload === "object" ? payload : {};
  var assumptions = Array.isArray(source.assumptions) ? source.assumptions.slice() : [];
  var canonicalClientMap = {};
  (Array.isArray(source.clientRows) ? source.clientRows : []).forEach(function(row) {
    var customer = normalizeCustomerName(row && row.customer);
    if (!customer) return;
    if (!canonicalClientMap[customer]) {
      canonicalClientMap[customer] = {
        customer: customer,
        inboundPallets: 0,
        outboundPallets: 0,
        activeStoragePallets: 0
      };
    }
    canonicalClientMap[customer].inboundPallets += Number(row && row.inboundPallets || 0);
    canonicalClientMap[customer].outboundPallets += Number(row && row.outboundPallets || 0);
    canonicalClientMap[customer].activeStoragePallets += Number(row && row.activeStoragePallets || 0);
  });
  var canonicalClientRows = buildClientRowsFromMap(canonicalClientMap);
  addUniqueAssumption(
    assumptions,
    "This warehouse result was served from the Supabase snapshot cache for the selected billing window. Add ?refresh=1 to the request to bypass the cache."
  );
  return Object.assign({}, source, {
    querySource: [String(source.querySource || ""), "supabase_snapshot_cache"].filter(Boolean).join("+"),
    assumptions: assumptions,
    summary: buildSummaryFromClientRows(canonicalClientRows),
    clientRows: canonicalClientRows
  });
}

function getSnapshotTaskId(payload, key) {
  return normalizeTaskId(
    payload &&
    payload.reports &&
    payload.reports[key] &&
    payload.reports[key].taskId
  );
}

async function readWarehouseSnapshot(supabase, mode, startDate, endDate) {
  if (!supabase) return { ok: false, status: "cache_disabled", row: null };
  try {
    var query = await supabase
      .from(WAREHOUSE_SNAPSHOT_TABLE)
      .select("site_id,snapshot_mode,start_date,end_date,payload,pending,generated_at,updated_by,updated_at")
      .eq("site_id", CACHE_SITE_ID)
      .eq("snapshot_mode", mode)
      .eq("start_date", startDate)
      .eq("end_date", endDate)
      .maybeSingle();
    if (query.error) {
      if (isMissingOptionalTableError(WAREHOUSE_SNAPSHOT_TABLE, query.error)) {
        return readWarehouseSnapshotFromHistory(supabase, mode, startDate, endDate);
      }
      throw query.error;
    }
    if (query.data) {
      return { ok: true, status: "hit", row: query.data };
    }
    return readWarehouseSnapshotFromHistory(supabase, mode, startDate, endDate);
  } catch (error) {
    if (isTransientSnapshotError(error)) {
      console.warn("[invoicing-warehousing] Warehouse snapshot read unavailable: " + summarizeDbError(error));
      return { ok: false, status: "snapshot_read_unavailable", row: null };
    }
    Sentry.captureException(error);
    return { ok: false, status: "snapshot_read_failed", row: null };
  }
}

async function writeWarehouseSnapshot(supabase, mode, startDate, endDate, payload, updatedBy) {
  if (!supabase) return { ok: false, status: "cache_disabled" };
  var source = payload && typeof payload === "object" ? payload : {};
  var writeResult = await bestEffortSnapshotOperation(function() {
    return supabase
      .from(WAREHOUSE_SNAPSHOT_TABLE)
      .upsert({
        site_id: CACHE_SITE_ID,
        snapshot_mode: mode,
        start_date: startDate,
        end_date: endDate,
        payload: source,
        pending: !!source.pending,
        generated_at: String(source.generatedAt || new Date().toISOString()),
        updated_by: updatedBy || null
      }, { onConflict: "site_id,snapshot_mode,start_date,end_date" });
  });
  if (writeResult.ok) {
    return { ok: true, status: "ok", attempts: writeResult.attempts };
  }
  if (isMissingOptionalTableError(WAREHOUSE_SNAPSHOT_TABLE, writeResult.error)) {
    return writeWarehouseSnapshotToHistory(supabase, mode, startDate, endDate, source, updatedBy);
  }
  if (isTransientSnapshotError(writeResult.error)) {
    console.warn("[invoicing-warehousing] Warehouse snapshot write unavailable after " + writeResult.attempts + " attempts: " + summarizeDbError(writeResult.error));
    return { ok: false, status: "snapshot_write_unavailable", attempts: writeResult.attempts };
  }
  Sentry.captureException(writeResult.error);
  return { ok: false, status: "snapshot_write_failed", attempts: writeResult.attempts };
}

function shouldRestartPendingReport(errorText) {
  var message = String(errorText || "").toLowerCase();
  return (
    message.includes("status error (404)") ||
    message.includes("status error (410)") ||
    message.includes("unsafe or invalid")
  );
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = null;
    try {
      supabase = getSupabaseAdmin();
    } catch (cacheError) {
      supabase = null;
    }

    var startDate = sanitizeIsoDate(req.query && req.query.start);
    var endDate = sanitizeIsoDate(req.query && req.query.end);
    var mode = sanitizeMode(req.query && req.query.mode);
    var refreshCache = sanitizeBooleanFlag(req.query && req.query.refresh);
    if (!startDate || !endDate || endDate < startDate) {
      return res.status(400).json({ error: "Invalid start/end date range" });
    }

    var cachedSnapshotRow = null;
    if (!refreshCache) {
      var cachedSnapshot = await readWarehouseSnapshot(supabase, mode, startDate, endDate);
      cachedSnapshotRow = cachedSnapshot && cachedSnapshot.row ? cachedSnapshot.row : null;
      if (
        cachedSnapshotRow &&
        cachedSnapshotRow.payload &&
        typeof cachedSnapshotRow.payload === "object" &&
        cachedSnapshotRow.payload.pending !== true
      ) {
        return res.status(200).json(decorateCachedSnapshotPayload(cachedSnapshotRow.payload));
      }
    }

    if (mode === "storage") {
      var storageAssumptions = [];
      var storageResultOnly = await fetchStorageReportWithFallback(startDate, endDate, storageAssumptions);
      var storageClientMapOnly = {};
      var storageDiagnosticsOnly = countActiveStoragePallets(storageResultOnly.rows, startDate, endDate, storageClientMapOnly);
      var storageClientRowsOnly = buildClientRowsFromMap(storageClientMapOnly);
      var storagePayload = buildStoragePayload(
        mode,
        startDate,
        endDate,
        storageAssumptions,
        storageResultOnly,
        storageDiagnosticsOnly,
        storageClientRowsOnly
      );
      await writeWarehouseSnapshot(supabase, mode, startDate, endDate, storagePayload, user.email);
      return res.status(200).json(storagePayload);
    }

    var inboundFilters = [
      {
        column: "received_at",
        operator: "between",
        from_threshold: formatNulogyDateTime(startDate, false),
        to_threshold: formatNulogyDateTime(endDate, true)
      }
    ];
    var outboundFilters = [
      {
        column: "actual_ship_at",
        operator: "between",
        from_threshold: formatNulogyDateTime(startDate, false),
        to_threshold: formatNulogyDateTime(endDate, true)
      }
    ];
    var inboundTaskId = normalizeTaskId(req.query && req.query.inboundTaskId);
    var outboundTaskId = normalizeTaskId(req.query && req.query.outboundTaskId);
    if (cachedSnapshotRow && cachedSnapshotRow.payload && typeof cachedSnapshotRow.payload === "object") {
      if (!inboundTaskId) inboundTaskId = getSnapshotTaskId(cachedSnapshotRow.payload, "inbound");
      if (!outboundTaskId) outboundTaskId = getSnapshotTaskId(cachedSnapshotRow.payload, "outbound");
    }
    var credentials = getNulogyCredentials();
    var authHeader = buildAuthHeader(credentials.user, credentials.pass);
    var pendingAssumptions = [
      "Inbound counts use distinct received pallets inside the selected received date window, and outbound counts use distinct shipped pallets inside the selected actual ship date window."
    ];

    if (mode === "transfers") {
      var inboundTransferResult = inboundTaskId
        ? await resolvePendingTransferReport(inboundTaskId, INBOUND_REPORT, authHeader, {
          columns: INBOUND_COLUMNS,
          filters: inboundFilters,
          maxPolls: 2
        })
        : await createPendingReportRun(INBOUND_REPORT, INBOUND_COLUMNS, {
          filters: inboundFilters
        });
      var outboundTransferResult = outboundTaskId
        ? await resolvePendingTransferReport(outboundTaskId, OUTBOUND_REPORT, authHeader, {
          columns: OUTBOUND_COLUMNS,
          filters: outboundFilters,
          maxPolls: 2
        })
        : await createPendingReportRun(OUTBOUND_REPORT, OUTBOUND_COLUMNS, {
          filters: outboundFilters
        });

      if (inboundTransferResult.pending || outboundTransferResult.pending) {
        pendingAssumptions.push("Inbound and outbound pallet counts are still loading from Nulogy and will populate after the current report runs complete.");
      }

      var transferSyncedAt = new Date().toISOString();
      var transferClientMap = {};
      var inboundTransferDiagnostics = {
        rowCount: 0,
        distinctPallets: 0,
        rowsMissingCustomerName: 0,
        rowsMissingPalletNumber: 0,
        rowsMissingTransferredAt: 0
      };
      if (!inboundTransferResult.pending) {
        var inboundTransferNormalized = normalizeWarehouseTransferRows(
          "inbound",
          inboundTransferResult.rows,
          siteId,
          transferSyncedAt,
          user.email
        );
        inboundTransferDiagnostics = inboundTransferNormalized.diagnostics;
        applyWarehouseTransferEventsToClientMap(inboundTransferNormalized.events, transferClientMap, {
          startDate: startDate,
          endDate: endDate
        });
        await writeWarehouseTransferEvents(supabase, {
          siteId: siteId,
          direction: "inbound",
          startDate: startDate,
          endDate: endDate,
          events: inboundTransferNormalized.events
        });
      }
      var outboundTransferDiagnostics = {
        rowCount: 0,
        distinctPallets: 0,
        rowsMissingCustomerName: 0,
        rowsMissingPalletNumber: 0,
        rowsMissingTransferredAt: 0
      };
      if (!outboundTransferResult.pending) {
        var outboundTransferNormalized = normalizeWarehouseTransferRows(
          "outbound",
          outboundTransferResult.rows,
          siteId,
          transferSyncedAt,
          user.email
        );
        outboundTransferDiagnostics = outboundTransferNormalized.diagnostics;
        applyWarehouseTransferEventsToClientMap(outboundTransferNormalized.events, transferClientMap, {
          startDate: startDate,
          endDate: endDate
        });
        await writeWarehouseTransferEvents(supabase, {
          siteId: siteId,
          direction: "outbound",
          startDate: startDate,
          endDate: endDate,
          events: outboundTransferNormalized.events
        });
      }
      var transferClientRows = buildClientRowsFromMap(transferClientMap);
      var transferPayload = buildTransferPayload(
        mode,
        startDate,
        endDate,
        pendingAssumptions,
        inboundTransferResult,
        outboundTransferResult,
        transferClientRows,
        inboundTransferDiagnostics,
        outboundTransferDiagnostics
      );
      await writeWarehouseSnapshot(supabase, mode, startDate, endDate, transferPayload, user.email);
      return res.status(200).json(transferPayload);
    }

    var assumptions = pendingAssumptions.slice();

    var inboundResult = await fetchReportCsv(INBOUND_REPORT, INBOUND_COLUMNS, {
      filters: inboundFilters,
      sortBy: [{ column: "received_at", direction: "asc" }],
      maxPolls: 60
    });
    var outboundResult = await fetchReportCsv(OUTBOUND_REPORT, OUTBOUND_COLUMNS, {
      filters: outboundFilters,
      sortBy: [{ column: "actual_ship_at", direction: "asc" }],
      maxPolls: 60
    });
    var storageResult = await fetchStorageReportWithFallback(startDate, endDate, assumptions);

    var normalizedTransferSnapshotAt = new Date().toISOString();
    var inboundNormalized = normalizeWarehouseTransferRows(
      "inbound",
      inboundResult.rows,
      siteId,
      normalizedTransferSnapshotAt,
      user.email
    );
    var outboundNormalized = normalizeWarehouseTransferRows(
      "outbound",
      outboundResult.rows,
      siteId,
      normalizedTransferSnapshotAt,
      user.email
    );
    var clientMap = {};
    var inboundDiagnostics = inboundNormalized.diagnostics;
    var outboundDiagnostics = outboundNormalized.diagnostics;
    applyWarehouseTransferEventsToClientMap(inboundNormalized.events, clientMap, {
      startDate: startDate,
      endDate: endDate
    });
    applyWarehouseTransferEventsToClientMap(outboundNormalized.events, clientMap, {
      startDate: startDate,
      endDate: endDate
    });
    await writeWarehouseTransferEvents(supabase, {
      siteId: siteId,
      direction: "inbound",
      startDate: startDate,
      endDate: endDate,
      events: inboundNormalized.events
    });
    await writeWarehouseTransferEvents(supabase, {
      siteId: siteId,
      direction: "outbound",
      startDate: startDate,
      endDate: endDate,
      events: outboundNormalized.events
    });
    var storageDiagnostics = countActiveStoragePallets(storageResult.rows, startDate, endDate, clientMap);

    var clientRows = buildClientRowsFromMap(clientMap);
    var combinedPayload = buildCombinedPayload(
      mode,
      startDate,
      endDate,
      assumptions,
      inboundResult,
      outboundResult,
      storageResult,
      inboundDiagnostics,
      outboundDiagnostics,
      storageDiagnostics,
      clientRows
    );
    await writeWarehouseSnapshot(supabase, mode, startDate, endDate, combinedPayload, user.email);
    return res.status(200).json(combinedPayload);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Invoicing warehousing feed failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
