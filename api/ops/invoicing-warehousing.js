import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "./_common.js";
import { executeReportRun } from "../nulogy/_runner.js";
import { parseCSV } from "../nulogy/_csv.js";

var INBOUND_REPORT = "inbound_stock_transfer";
var OUTBOUND_REPORT = "outbound_stock_transfer";
var STORAGE_REPORT = "pallet_storage";
var STORAGE_FALLBACK_REPORT = "pallet_aging";

var INBOUND_COLUMNS = [
  "item_customer_name",
  "item_code",
  "lot_code",
  "pallet_number",
  "transfer_status",
  "transferred_at"
];
var OUTBOUND_COLUMNS = [
  "item_customer_name",
  "item_code",
  "lot_code",
  "pallet_number",
  "transfer_status",
  "transferred_at"
];
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
  inbound_stock_transfer: 60000,
  outbound_stock_transfer: 60000,
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

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeLookupKey(value) {
  return String(value || "").trim().replace(/[^a-z0-9]/gi, "").toLowerCase();
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
  var text = String(value || "").trim().replace(/\s+/g, " ");
  return text || "Unassigned customer";
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
      "Item Customer", "item_customer",
      "Customer Name", "customer_name"
    ]));
    var palletNumber = String(pickFieldLoose(row, [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet"
    ]) || "").trim();
    var transferredRaw = pickFieldLoose(row, [
      "Transferred date", "Transferred Date", "transferred_at", "Transferred At"
    ]);
    var transferredDate = resolveDateKey(transferredRaw);
    if (!transferredDate) {
      diagnostics.rowsMissingTransferredAt += 1;
      return;
    }
    if (transferredDate < startDate || transferredDate > endDate) return;
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    var fallbackToken = [
      String(pickFieldLoose(row, ["Item code", "Item Code", "item_code"]) || "").trim(),
      String(pickFieldLoose(row, ["Lot code", "Lot Code", "lot_code"]) || "").trim(),
      String(index)
    ].join("|");
    var distinctKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      normalizeLookupKey(String(transferredRaw || transferredDate)),
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
      "Item Customer", "item_customer",
      "Customer Name", "customer_name"
    ]));
    var palletNumber = String(pickFieldLoose(row, [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet"
    ]) || "").trim();
    var transferredRaw = pickFieldLoose(row, [
      "Transferred date", "Transferred Date", "transferred_at", "Transferred At"
    ]);
    var transferredDate = resolveDateKey(transferredRaw);
    if (!transferredDate) {
      diagnostics.rowsMissingTransferredAt += 1;
      return;
    }
    if (transferredDate < startDate || transferredDate > endDate) return;
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    var fallbackToken = [
      String(pickFieldLoose(row, ["Item code", "Item Code", "item_code"]) || "").trim(),
      String(pickFieldLoose(row, ["Lot code", "Lot Code", "lot_code"]) || "").trim(),
      String(index)
    ].join("|");
    var distinctKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      normalizeLookupKey(String(transferredRaw || transferredDate)),
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

    var transferFilters = [
      {
        column: "transferred_at",
        operator: "between",
        from_threshold: formatNulogyDateTime(startDate, false),
        to_threshold: formatNulogyDateTime(endDate, true)
      }
    ];

    var assumptions = [
      "Inbound and outbound counts use distinct pallet moves inside the selected transferred date window."
    ];

    var inboundResult = await fetchReportCsv(INBOUND_REPORT, INBOUND_COLUMNS, {
      filters: transferFilters,
      sortBy: [{ column: "transferred_at", direction: "asc" }],
      maxPolls: 60
    });
    var outboundResult = await fetchReportCsv(OUTBOUND_REPORT, OUTBOUND_COLUMNS, {
      filters: transferFilters,
      sortBy: [{ column: "transferred_at", direction: "asc" }],
      maxPolls: 60
    });
    var storageResult = await fetchStorageReportWithFallback(startDate, endDate, assumptions);

    var clientMap = {};
    var inboundDiagnostics = countInboundPallets(inboundResult.rows, startDate, endDate, clientMap);
    var outboundDiagnostics = countOutboundPallets(outboundResult.rows, startDate, endDate, clientMap);
    var storageDiagnostics = countActiveStoragePallets(storageResult.rows, startDate, endDate, clientMap);

    var clientRows = Object.values(clientMap).sort(function(left, right) {
      var rightTotal = Number(right.inboundPallets || 0) + Number(right.outboundPallets || 0) + Number(right.activeStoragePallets || 0);
      var leftTotal = Number(left.inboundPallets || 0) + Number(left.outboundPallets || 0) + Number(left.activeStoragePallets || 0);
      if (rightTotal !== leftTotal) return rightTotal - leftTotal;
      return String(left.customer || "").localeCompare(String(right.customer || ""));
    });

    var summary = clientRows.reduce(function(acc, row) {
      var inbound = Number(row.inboundPallets || 0);
      var outbound = Number(row.outboundPallets || 0);
      var storage = Number(row.activeStoragePallets || 0);
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

    return res.status(200).json({
      querySource: "nulogy_reports_api",
      startDate: startDate,
      endDate: endDate,
      generatedAt: new Date().toISOString(),
      assumptions: assumptions.concat([
        storageResult.report === STORAGE_REPORT
          ? "Storage counts use distinct customer and pallet rows whose billed or stored window overlaps the selected billing window."
          : "Storage fallback counts use distinct active pallets from pallet_aging whose stored_since date is on or before the selected billing window end."
      ]),
      summary: summary,
      reports: {
        inbound: buildReportDiagnostics(inboundResult, inboundDiagnostics),
        outbound: buildReportDiagnostics(outboundResult, outboundDiagnostics),
        storage: buildReportDiagnostics(storageResult, storageDiagnostics)
      },
      clientRows: clientRows
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Invoicing warehousing feed failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
