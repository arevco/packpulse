import crypto from "crypto";
import { executeReportRun } from "../nulogy/_runner.js";
import { parseCSV } from "../nulogy/_csv.js";
import { canonicalizeCustomerName } from "./_customer-aliases.js";

export const WAREHOUSE_TRANSFER_EVENT_TABLE = "warehouse_transfer_events";
export const INBOUND_TRANSFER_REPORT = "receipt_item";
export const OUTBOUND_TRANSFER_REPORT = "shipment_item";

export const INBOUND_TRANSFER_COLUMNS = [
  "item_customer_name",
  "receipt_customer_name",
  "receive_order_customer_name",
  "item_code",
  "original_item_code",
  "item_description",
  "lot_code",
  "pallet_number",
  "receive_order_code",
  "receive_order_reference",
  "receipt_reference_1",
  "receipt_reference_2",
  "planned_receipt_id",
  "received_at",
  "receiving_quantity",
  "base_quantity",
  "default_quantity",
  "base_unit_of_measure",
  "default_unit_of_measure",
];

export const OUTBOUND_TRANSFER_COLUMNS = [
  "item_customer_name",
  "shipment_customer_name",
  "ship_order_customer_name",
  "item_code",
  "item_description",
  "lot_code",
  "pallet_number",
  "ship_order_code",
  "shipment_item_purchase_order_number",
  "project_purchase_order_number",
  "actual_ship_at",
  "shipment_expected_ship_at",
  "default_quantity",
  "base_quantity",
  "case_quantity",
  "default_unit_of_measure",
  "base_unit_of_measure",
];

const REPORT_ROW_LIMITS = {
  receipt_item: 60000,
  shipment_item: 60000,
};

const RETRYABLE_FETCH_STATUSES = {
  408: true,
  425: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true,
};

const RETRYABLE_XML_ERROR_CODES = {
  InternalError: true,
  RequestTimeout: true,
  ServiceUnavailable: true,
  SlowDown: true,
};

const TRANSFER_DIRECTION_CONFIG = {
  inbound: {
    report: INBOUND_TRANSFER_REPORT,
    columns: INBOUND_TRANSFER_COLUMNS,
    dateColumn: "received_at",
    sortColumn: "received_at",
    customerKeys: [
      "Item Customer name", "Item Customer Name", "item_customer_name",
      "Receipt Customer name", "Receipt Customer Name", "receipt_customer_name",
      "Receive Order Customer name", "Receive Order Customer Name", "receive_order_customer_name",
      "Item Customer", "item_customer",
      "Customer Name", "customer_name",
    ],
    dateKeys: [
      "Received at", "Received At", "received_at", "Received date", "Received Date",
    ],
    itemCodeKeys: [
      "Item code", "Item Code", "item_code", "Original item code", "Original Item Code", "original_item_code",
    ],
    itemDescriptionKeys: [
      "Item description", "Item Description", "item_description",
    ],
    lotCodeKeys: [
      "Lot code", "Lot Code", "lot_code",
    ],
    palletNumberKeys: [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet",
    ],
    referenceKeys: [
      "Receive Order code", "Receive Order Code", "receive_order_code",
      "Receive Order", "receive_order",
      "Planned Receipt ID", "planned_receipt_id",
      "Receive Order reference", "Receive Order Reference", "receive_order_reference",
      "Receipt reference 1", "Receipt Reference 1", "receipt_reference_1",
      "Receipt reference 2", "Receipt Reference 2", "receipt_reference_2",
    ],
    orderCodeKeys: [
      "Receive Order code", "Receive Order Code", "receive_order_code",
      "Receive Order", "receive_order",
    ],
    purchaseOrderKeys: [],
    quantityKeys: [
      "Receiving quantity", "Receiving Quantity", "receiving_quantity",
      "Base quantity", "Base Quantity", "base_quantity",
      "Default quantity", "Default Quantity", "default_quantity",
    ],
    unitOfMeasureKeys: [
      "Default unit of measure", "Default Unit Of Measure", "default_unit_of_measure",
      "Base unit of measure", "Base Unit Of Measure", "base_unit_of_measure",
    ],
  },
  outbound: {
    report: OUTBOUND_TRANSFER_REPORT,
    columns: OUTBOUND_TRANSFER_COLUMNS,
    dateColumn: "actual_ship_at",
    sortColumn: "actual_ship_at",
    customerKeys: [
      "Item Customer name", "Item Customer Name", "item_customer_name",
      "Shipment Customer name", "Shipment Customer Name", "shipment_customer_name",
      "Ship Order Customer name", "Ship Order Customer Name", "ship_order_customer_name",
      "Item Customer", "item_customer",
      "Customer Name", "customer_name",
    ],
    dateKeys: [
      "Actual ship date", "Actual Ship Date", "actual_ship_at", "Actual Ship At",
      "Shipment expected ship date", "Shipment Expected Ship Date", "shipment_expected_ship_at",
    ],
    itemCodeKeys: [
      "Item code", "Item Code", "item_code",
    ],
    itemDescriptionKeys: [
      "Item description", "Item Description", "item_description",
    ],
    lotCodeKeys: [
      "Lot code", "Lot Code", "lot_code",
    ],
    palletNumberKeys: [
      "Pallet number", "Pallet Number", "pallet_number", "Pallet", "pallet",
    ],
    referenceKeys: [
      "Ship Order code", "Ship Order Code", "ship_order_code",
      "Shipment ID", "shipment_id",
      "Shipment Item purchase order number", "Shipment Item Purchase Order Number", "shipment_item_purchase_order_number",
      "Work Order Purchase Order number", "Work Order Purchase Order Number", "project_purchase_order_number",
    ],
    orderCodeKeys: [
      "Ship Order code", "Ship Order Code", "ship_order_code",
      "Shipment ID", "shipment_id",
    ],
    purchaseOrderKeys: [
      "Shipment Item purchase order number", "Shipment Item Purchase Order Number", "shipment_item_purchase_order_number",
      "Work Order Purchase Order number", "Work Order Purchase Order Number", "project_purchase_order_number",
    ],
    quantityKeys: [
      "Default quantity", "Default Quantity", "default_quantity",
      "Base quantity", "Base Quantity", "base_quantity",
      "Case quantity", "Case Quantity", "case_quantity",
    ],
    unitOfMeasureKeys: [
      "Default unit of measure", "Default Unit Of Measure", "default_unit_of_measure",
      "Base unit of measure", "Base Unit Of Measure", "base_unit_of_measure",
      "Case unit of measure", "Case Unit Of Measure", "case_unit_of_measure",
    ],
  },
};

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  const numeric = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function normalizeLookupKey(value) {
  return compactText(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function summarizeErrorText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function extractXmlErrorCode(text) {
  const match = String(text || "").match(/<Code>([^<]+)<\/Code>/i);
  return match ? String(match[1] || "").trim() : "";
}

function hasXmlErrorPayload(text, contentType) {
  const raw = String(text || "").trim();
  const normalizedType = String(contentType || "").toLowerCase();
  if (!raw) return false;
  if (!normalizedType.includes("xml") && raw.indexOf("<?xml") !== 0) return false;
  return raw.includes("<Error>") && !!extractXmlErrorCode(raw);
}

function isRetryableXmlError(text, contentType) {
  if (!hasXmlErrorPayload(text, contentType)) return false;
  return !!RETRYABLE_XML_ERROR_CODES[extractXmlErrorCode(text)];
}

function isRetryableFetchError(error) {
  const causeCode = String(error && error.cause && error.cause.code || "").toUpperCase();
  if (
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  const message = String(error && error.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("socket") ||
    message.includes("timeout") ||
    message.includes("econnreset")
  );
}

function describeError(error) {
  return String(
    (error && (error.message || error.details || error.hint || error.error_description || error.code)) ||
    error ||
    ""
  ).trim();
}

function isTransientDbError(error) {
  const message = describeError(error).toLowerCase();
  const status = Number(error && (error.status || error.statusCode || error.code));
  if (Number.isFinite(status) && status >= 500) return true;
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("gateway") ||
    message.includes("connection") ||
    message.includes("econnreset") ||
    message.includes("fetch failed") ||
    message.includes("service unavailable")
  );
}

export function isMissingWarehouseTransferEventsTableError(error) {
  const message = describeError(error).toLowerCase();
  return message.includes(WAREHOUSE_TRANSFER_EVENT_TABLE) && (
    message.includes("schema cache") ||
    message.includes("could not find the table") ||
    message.includes("relation") ||
    message.includes("does not exist")
  );
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, Math.max(0, Number(ms || 0)));
  });
}

async function withRetry(fn, options) {
  const attempts = Math.max(1, Number(options && options.attempts || 2));
  const delayMs = Math.max(0, Number(options && options.delayMs || 200));
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = typeof (error && error.retryable) === "boolean"
        ? error.retryable
        : (isRetryableFetchError(error) || isTransientDbError(error));
      if (!retryable || attempt >= attempts - 1) throw error;
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError || new Error("retry_failed");
}

async function fetchTextWithRetries(url, options, errorLabel) {
  let lastError = null;
  const attempts = 3;
  const baseDelayMs = 750;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text().catch(function() { return ""; });
      const contentType = response.headers.get("content-type") || "";
      const xmlErrorPayload = hasXmlErrorPayload(text, contentType);
      const retryableXmlError = isRetryableXmlError(text, contentType);

      if (!response.ok || xmlErrorPayload) {
        const prefix = attempt > 1 ? (errorLabel + " after " + attempt + " attempts") : errorLabel;
        const error = new Error(prefix + " (" + response.status + "): " + summarizeErrorText(text));
        error.statusCode = response.status;
        error.retryable = !!RETRYABLE_FETCH_STATUSES[response.status] || retryableXmlError;
        lastError = error;
        if (error.retryable && attempt < attempts) {
          await sleep(baseDelayMs * attempt);
          continue;
        }
        throw error;
      }

      return {
        text: text,
        contentType: contentType,
      };
    } catch (error) {
      lastError = error;
      const retryable = typeof (error && error.retryable) === "boolean"
        ? error.retryable
        : isRetryableFetchError(error);
      if (retryable && attempt < attempts) {
        await sleep(baseDelayMs * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(errorLabel + " failed.");
}

function stableRowHash(row) {
  if (!row || typeof row !== "object") return "";
  const keys = Object.keys(row).sort();
  const ordered = {};
  keys.forEach(function(key) {
    ordered[key] = row[key];
  });
  return crypto.createHash("sha1").update(JSON.stringify(ordered)).digest("hex");
}

function formatNulogyDateTime(dateIso, endOfDay) {
  const match = String(dateIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return "";
  return match[1] + "-" + monthNames[monthIndex] + "-" + match[3] + (endOfDay ? " 11:59 PM" : " 12:00 AM");
}

function buildTransferFilters(direction, startDate, endDate) {
  const config = TRANSFER_DIRECTION_CONFIG[direction];
  if (!config) throw new Error("Unsupported warehouse transfer direction: " + direction);
  return [
    {
      column: config.dateColumn,
      operator: "between",
      from_threshold: formatNulogyDateTime(startDate, false),
      to_threshold: formatNulogyDateTime(endDate, true),
    },
  ];
}

function summarizeReportFailure(result, report) {
  const body = result && result.body ? result.body : {};
  const messages = Array.isArray(body.failureMessages) ? body.failureMessages.filter(Boolean) : [];
  if (messages.length) return messages.join(" | ");
  if (body.error) return String(body.error);
  return "Failed to run " + report + ".";
}

export function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  const rowKeys = Object.keys(row);
  for (let i = 0; i < keys.length; i += 1) {
    const target = String(keys[i] || "").toLowerCase();
    for (let j = 0; j < rowKeys.length; j += 1) {
      const rowKey = rowKeys[j];
      if (String(rowKey || "").toLowerCase() === target) return row[rowKey];
    }
  }
  const wanted = {};
  keys.forEach(function(key) {
    wanted[normalizeLooseKey(key)] = true;
  });
  for (let i = 0; i < rowKeys.length; i += 1) {
    const rowKey = rowKeys[i];
    if (wanted[normalizeLooseKey(rowKey)]) return row[rowKey];
  }
  return "";
}

export function normalizeCustomerName(value) {
  return canonicalizeCustomerName(value, "Unassigned customer") || "Unassigned customer";
}

export function resolveDateKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const nulogyMatch = raw.match(/^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:\s+\d{1,2}:\d{2}\s*(AM|PM))?$/i);
  if (nulogyMatch) {
    const months = {
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
      dec: "12",
    };
    const year = String(nulogyMatch[1] || "");
    const month = months[String(nulogyMatch[2] || "").toLowerCase()] || "";
    const day = String(Number(nulogyMatch[3] || 0)).padStart(2, "0");
    return year && month && day ? (year + "-" + month + "-" + day) : "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

export async function fetchWarehouseTransferReport(direction, options) {
  const config = TRANSFER_DIRECTION_CONFIG[direction];
  if (!config) throw new Error("Unsupported warehouse transfer direction: " + direction);
  const startDate = String(options && options.startDate || "");
  const endDate = String(options && options.endDate || "");
  const report = config.report;
  const executed = await executeReportRun({
    report: report,
    columns: config.columns,
    filters: buildTransferFilters(direction, startDate, endDate),
    sort_by: [{ column: config.sortColumn, direction: "asc" }],
    waitForCompletion: true,
    pollIntervalMs: 2500,
    maxPolls: Number(options && options.maxPolls) > 0 ? Number(options.maxPolls) : 60,
  });
  if (!executed.ok) throw new Error(summarizeReportFailure(executed, report));
  const body = executed.body || {};
  if (!body.downloadUrl) throw new Error("Completed " + report + " run did not return a download URL.");
  const downloaded = await fetchTextWithRetries(body.downloadUrl, {
    method: "GET",
    headers: {
      Accept: "text/csv,text/plain,application/xml,text/xml",
    },
  }, "Failed to download " + report + " CSV");
  const rows = parseCSV(downloaded.text);
  return {
    report: report,
    rows: rows,
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    statusHistory: Array.isArray(body.statusHistory) ? body.statusHistory : [],
    possibleTruncation: Number(REPORT_ROW_LIMITS[report] || 0) > 0 && rows.length >= Number(REPORT_ROW_LIMITS[report] || 0),
  };
}

export function normalizeWarehouseTransferRows(direction, rows, siteId, syncedAt, updatedBy) {
  const config = TRANSFER_DIRECTION_CONFIG[direction];
  if (!config) throw new Error("Unsupported warehouse transfer direction: " + direction);
  const diagnostics = {
    rowCount: Array.isArray(rows) ? rows.length : 0,
    distinctPallets: 0,
    rowsMissingCustomerName: 0,
    rowsMissingPalletNumber: 0,
    rowsMissingTransferredAt: 0,
  };
  const events = [];
  const distinctPallets = {};
  const hashOccurrences = {};

  (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
    const customer = normalizeCustomerName(pickFieldLoose(row, config.customerKeys));
    const palletNumber = compactText(pickFieldLoose(row, config.palletNumberKeys));
    const transferDateRaw = pickFieldLoose(row, config.dateKeys);
    const transferDateEt = resolveDateKey(transferDateRaw);
    if (!transferDateEt) {
      diagnostics.rowsMissingTransferredAt += 1;
      return;
    }
    if (!palletNumber) diagnostics.rowsMissingPalletNumber += 1;
    if (customer === "Unassigned customer") diagnostics.rowsMissingCustomerName += 1;

    const itemCode = compactText(pickFieldLoose(row, config.itemCodeKeys));
    const itemDescription = compactText(pickFieldLoose(row, config.itemDescriptionKeys));
    const lotCode = compactText(pickFieldLoose(row, config.lotCodeKeys));
    const referenceCode = compactText(pickFieldLoose(row, config.referenceKeys));
    const orderCode = compactText(pickFieldLoose(row, config.orderCodeKeys));
    const purchaseOrderNumber = compactText(pickFieldLoose(row, config.purchaseOrderKeys));
    const quantity = toNum(pickFieldLoose(row, config.quantityKeys));
    const unitOfMeasure = compactText(pickFieldLoose(row, config.unitOfMeasureKeys));
    const fallbackToken = [
      referenceCode || orderCode,
      itemCode,
      lotCode,
      String(index),
    ].join("|");
    const distinctPalletKey = [
      normalizeLookupKey(customer),
      normalizeLookupKey(palletNumber) || normalizeLookupKey(fallbackToken),
      normalizeLookupKey(String(transferDateRaw || transferDateEt)),
      direction,
    ].join("|");
    distinctPallets[distinctPalletKey] = true;

    const rowHash = stableRowHash(row);
    const occurrence = (hashOccurrences[rowHash] || 0) + 1;
    hashOccurrences[rowHash] = occurrence;
    const eventKey = crypto
      .createHash("sha1")
      .update([siteId, direction, rowHash, String(occurrence)].join("|"))
      .digest("hex");

    events.push({
      site_id: siteId,
      event_key: eventKey,
      direction: direction,
      transfer_date_et: transferDateEt,
      customer_name: customer,
      reference_code: referenceCode || orderCode || null,
      order_code: orderCode || null,
      purchase_order_number: purchaseOrderNumber || null,
      item_code: itemCode || null,
      item_description: itemDescription || null,
      lot_code: lotCode || null,
      pallet_number: palletNumber || null,
      quantity: quantity,
      unit_of_measure: unitOfMeasure || null,
      distinct_pallet_key: distinctPalletKey,
      source_report_code: config.report,
      source_snapshot_at: syncedAt,
      updated_by: updatedBy || null,
      raw: row,
    });
  });

  diagnostics.distinctPallets = Object.keys(distinctPallets).length;
  return {
    events: events,
    diagnostics: diagnostics,
  };
}

function getClientBucket(clientMap, customer) {
  if (!clientMap[customer]) {
    clientMap[customer] = {
      customer: customer,
      inboundPallets: 0,
      outboundPallets: 0,
      activeStoragePallets: 0,
    };
  }
  return clientMap[customer];
}

export function applyWarehouseTransferEventsToClientMap(events, clientMap, options) {
  const seen = {};
  let distinctPallets = 0;
  const startDate = String(options && options.startDate || "");
  const endDate = String(options && options.endDate || "");

  (Array.isArray(events) ? events : []).forEach(function(event) {
    if (!event || typeof event !== "object") return;
    const transferDateEt = String(event.transfer_date_et || "").slice(0, 10);
    if (startDate && transferDateEt && transferDateEt < startDate) return;
    if (endDate && transferDateEt && transferDateEt > endDate) return;
    const customer = normalizeCustomerName(event.customer_name);
    const distinctKey = compactText(event.distinct_pallet_key) || [
      normalizeLookupKey(customer),
      normalizeLookupKey(event.pallet_number || event.event_key),
      normalizeLookupKey(transferDateEt),
      compactText(event.direction || "unknown"),
    ].join("|");
    if (seen[distinctKey]) return;
    seen[distinctKey] = true;
    if (event.direction === "inbound") {
      getClientBucket(clientMap, customer).inboundPallets += 1;
    } else if (event.direction === "outbound") {
      getClientBucket(clientMap, customer).outboundPallets += 1;
    }
    distinctPallets += 1;
  });

  return {
    distinctPallets: distinctPallets,
  };
}

async function replaceWarehouseTransferEvents(supabase, siteId, direction, startDate, endDate, events) {
  const deleteResult = await withRetry(function() {
    return supabase
      .from(WAREHOUSE_TRANSFER_EVENT_TABLE)
      .delete()
      .eq("site_id", siteId)
      .eq("direction", direction)
      .gte("transfer_date_et", startDate)
      .lte("transfer_date_et", endDate);
  }, { attempts: 3, delayMs: 200 });
  if (deleteResult.error) throw deleteResult.error;

  let written = 0;
  const chunkSize = 500;
  for (let index = 0; index < events.length; index += chunkSize) {
    const chunk = events.slice(index, index + chunkSize);
    const writeResult = await withRetry(function() {
      return supabase
        .from(WAREHOUSE_TRANSFER_EVENT_TABLE)
        .upsert(chunk, { onConflict: "site_id,event_key" });
    }, { attempts: 3, delayMs: 200 });
    if (writeResult.error) throw writeResult.error;
    written += chunk.length;
  }

  return {
    written: written,
  };
}

export async function writeWarehouseTransferEvents(supabase, options) {
  if (!supabase) return { ok: false, status: "cache_disabled", written: 0 };
  const siteId = String(options && options.siteId || "");
  const direction = String(options && options.direction || "");
  const startDate = String(options && options.startDate || "");
  const endDate = String(options && options.endDate || "");
  const events = Array.isArray(options && options.events) ? options.events : [];
  try {
    const replaced = await replaceWarehouseTransferEvents(supabase, siteId, direction, startDate, endDate, events);
    return { ok: true, status: "ok", written: replaced.written };
  } catch (error) {
    if (isMissingWarehouseTransferEventsTableError(error)) {
      return { ok: false, status: "missing_transfer_events_table", written: 0 };
    }
    if (isTransientDbError(error)) {
      return { ok: false, status: "transfer_event_write_unavailable", written: 0 };
    }
    throw error;
  }
}

const TRANSFER_EVENT_SELECT = [
  "site_id",
  "event_key",
  "direction",
  "transfer_date_et",
  "customer_name",
  "reference_code",
  "order_code",
  "purchase_order_number",
  "item_code",
  "item_description",
  "lot_code",
  "pallet_number",
  "quantity",
  "unit_of_measure",
  "distinct_pallet_key",
  "source_report_code",
  "source_snapshot_at",
  "updated_by",
  "created_at",
  "raw",
].join(",");

export async function readWarehouseTransferEvents(supabase, options) {
  if (!supabase) {
    return { ok: false, status: "cache_disabled", events: [], generatedAt: "" };
  }
  const siteId = String(options && options.siteId || "");
  const direction = String(options && options.direction || "");
  const startDate = String(options && options.startDate || "");
  const endDate = String(options && options.endDate || "");
  const events = [];
  let from = 0;
  const pageSize = 1000;

  try {
    while (true) {
      const to = from + pageSize - 1;
      const query = await withRetry(function() {
        return supabase
          .from(WAREHOUSE_TRANSFER_EVENT_TABLE)
          .select(TRANSFER_EVENT_SELECT)
          .eq("site_id", siteId)
          .eq("direction", direction)
          .gte("transfer_date_et", startDate)
          .lte("transfer_date_et", endDate)
          .order("transfer_date_et", { ascending: true })
          .order("created_at", { ascending: true })
          .range(from, to);
      }, { attempts: 3, delayMs: 200 });
      if (query.error) throw query.error;
      const rows = Array.isArray(query.data) ? query.data : [];
      events.push.apply(events, rows);
      if (rows.length < pageSize) break;
      from += pageSize;
      if (from > 100000) break;
    }

    const generatedAt = events.reduce(function(latest, event) {
      const candidate = String(event && event.source_snapshot_at || "");
      if (!candidate) return latest;
      if (!latest || candidate > latest) return candidate;
      return latest;
    }, "");

    return {
      ok: true,
      status: events.length ? "hit" : "miss",
      events: events,
      generatedAt: generatedAt,
    };
  } catch (error) {
    if (isMissingWarehouseTransferEventsTableError(error)) {
      return { ok: false, status: "missing_transfer_events_table", events: [], generatedAt: "" };
    }
    if (isTransientDbError(error)) {
      return { ok: false, status: "transfer_event_read_unavailable", events: [], generatedAt: "" };
    }
    throw error;
  }
}

export async function syncWarehouseTransferEvents(options) {
  const siteId = String(options && options.siteId || "");
  const direction = String(options && options.direction || "");
  const startDate = String(options && options.startDate || "");
  const endDate = String(options && options.endDate || "");
  const updatedBy = String(options && options.updatedBy || "");
  const supabase = options ? options.supabase : null;
  const reportResult = await fetchWarehouseTransferReport(direction, {
    startDate: startDate,
    endDate: endDate,
    maxPolls: Number(options && options.maxPolls) > 0 ? Number(options.maxPolls) : 60,
  });
  const generatedAt = new Date().toISOString();
  const normalized = normalizeWarehouseTransferRows(direction, reportResult.rows, siteId, generatedAt, updatedBy);
  const persisted = await writeWarehouseTransferEvents(supabase, {
    siteId: siteId,
    direction: direction,
    startDate: startDate,
    endDate: endDate,
    events: normalized.events,
  });
  return {
    report: reportResult.report,
    generatedAt: generatedAt,
    events: normalized.events,
    diagnostics: normalized.diagnostics,
    warnings: Array.isArray(reportResult.warnings) ? reportResult.warnings : [],
    possibleTruncation: !!reportResult.possibleTruncation,
    persisted: persisted,
  };
}

export async function loadWarehouseTransferEventsForWindow(options) {
  const direction = String(options && options.direction || "");
  const readResult = await readWarehouseTransferEvents(options && options.supabase, options);
  if (readResult.ok && readResult.events.length) {
    return {
      events: readResult.events,
      generatedAt: readResult.generatedAt,
      possibleTruncation: false,
      sourceMode: "warehouse_transfer_events",
      notes: [
        "Sourced from normalized warehouse transfer events stored in Supabase.",
      ],
    };
  }

  const syncResult = await syncWarehouseTransferEvents(options);
  const notes = [];
  if (syncResult.persisted.ok) {
    notes.push("Synced live Nulogy transfer data for this window and stored normalized warehouse transfer events in Supabase.");
  } else if (syncResult.persisted.status === "missing_transfer_events_table") {
    notes.push("Served from a live Nulogy transfer sync because the Supabase warehouse transfer event table is unavailable.");
  } else if (syncResult.persisted.status === "transfer_event_write_unavailable") {
    notes.push("Served from a live Nulogy transfer sync because the Supabase warehouse transfer event cache is temporarily unavailable.");
  } else if (syncResult.persisted.status === "cache_disabled") {
    notes.push("Served from a live Nulogy transfer sync because the Supabase transfer cache is disabled.");
  }
  if (syncResult.possibleTruncation) {
    notes.push("The live Nulogy transfer result reached the documented row cap and may be truncated.");
  }
  (Array.isArray(syncResult.warnings) ? syncResult.warnings : []).forEach(function(warning) {
    if (warning) notes.push(String(warning));
  });
  return {
    events: syncResult.events,
    generatedAt: syncResult.generatedAt,
    possibleTruncation: syncResult.possibleTruncation,
    sourceMode: "live_transfer_sync",
    notes: notes,
  };
}
