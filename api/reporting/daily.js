import Papa from "papaparse";
import { isMissingTableError } from "../_event-window.js";
import { parseCSV } from "../nulogy/_csv.js";
import { executeReportRun } from "../nulogy/_runner.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { canonicalizeCustomerName, customerNamesMatch, preferredNulogyCustomerFilterValue } from "../ops/_customer-aliases.js";
import { loadWarehouseTransferEventsForWindow } from "../ops/_warehouse-transfers.js";

const SECTION_ORDER = ["inventory", "inbounds", "outbounds", "production", "consumption"];

const SECTION_CONFIG = {
  inventory: { label: "Inventory", reportCode: "inventory_snapshot" },
  inbounds: { label: "Inbounds", reportCode: "receipt_item" },
  outbounds: { label: "Outbounds", reportCode: "shipment_item" },
  production: { label: "Production", reportCode: "production" },
  consumption: { label: "Consumption", reportCode: "consumption_by_lot" },
};

const CONSUMPTION_LIVE_COLUMNS = [
  "actual_job_end",
  "actual_job_start",
  "consumed_at",
  "consumed_date",
  "customer",
  "finished_good_expiry_date",
  "finished_good_lot_code",
  "job_id",
  "job_reconciliation_status",
  "job_reference",
  "line",
  "project_code",
  "project_id",
  "project_reference_1",
  "project_reference_2",
  "project_reference_3",
  "project_reference_4",
  "project_reference_5",
  "subcomponent_consumption_pallet",
  "subcomponent_expiry_date",
  "subcomponent_item_category",
  "subcomponent_item_family",
  "subcomponent_item_type",
  "subcomponent_item_vendor",
  "subcomponent_lot_code",
];

const REPORT_ROW_LIMITS = {
  consumption_by_lot: 60000,
};

const MONTH_INDEX = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function requireReportingUser(req, res) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return user;
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickLooseValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  const rowKeys = Object.keys(row);
  for (let i = 0; i < keys.length; i += 1) {
    const wanted = normalizeKey(keys[i]);
    for (let j = 0; j < rowKeys.length; j += 1) {
      if (normalizeKey(rowKeys[j]) === wanted) return row[rowKeys[j]];
    }
  }
  return "";
}

function safeNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null || value === "") return 0;
  const numeric = parseFloat(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(numeric) ? numeric : 0;
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueSorted(values) {
  const seen = {};
  const out = [];
  (Array.isArray(values) ? values : []).forEach(function(value) {
    const next = compactText(value);
    if (!next) return;
    const key = normalizeKey(next);
    if (seen[key]) return;
    seen[key] = true;
    out.push(next);
  });
  out.sort(function(left, right) {
    return left.localeCompare(right, undefined, { sensitivity: "base", numeric: true });
  });
  return out;
}

function formatDateParts(date, timeZone) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function todayEtIso() {
  return formatDateParts(new Date(), "America/New_York");
}

function parseLooseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value || "").trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (ymd) {
    const parsedYmd = new Date(
      Number(ymd[1]),
      Number(ymd[2]) - 1,
      Number(ymd[3]),
      Number(ymd[4] || 0),
      Number(ymd[5] || 0),
      Number(ymd[6] || 0),
    );
    return Number.isNaN(parsedYmd.getTime()) ? null : parsedYmd;
  }

  const monthNamed = raw.match(/^(\d{4})[-/ ]([A-Za-z]{3})[-/ ](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (monthNamed) {
    let hour = Number(monthNamed[4] || 0);
    const minute = Number(monthNamed[5] || 0);
    const second = Number(monthNamed[6] || 0);
    const meridiem = String(monthNamed[7] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const parsedMonthNamed = new Date(
      Number(monthNamed[1]),
      MONTH_INDEX[String(monthNamed[2] || "").toLowerCase()],
      Number(monthNamed[3]),
      hour,
      minute,
      second,
    );
    return Number.isNaN(parsedMonthNamed.getTime()) ? null : parsedMonthNamed;
  }

  const mdy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (mdy) {
    let year = Number(mdy[3]);
    if (year < 100) year += 2000;
    let hour = Number(mdy[4] || 0);
    const minute = Number(mdy[5] || 0);
    const second = Number(mdy[6] || 0);
    const meridiem = String(mdy[7] || "").toUpperCase();
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    const parsedMdy = new Date(year, Number(mdy[1]) - 1, Number(mdy[2]), hour, minute, second);
    return Number.isNaN(parsedMdy.getTime()) ? null : parsedMdy;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(value) {
  const parsed = parseLooseDate(value);
  if (!parsed) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return year + "-" + month + "-" + day;
}

function formatEtDateTime(value) {
  if (!value) return "";
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function shiftIsoDate(dateKey, deltaDays) {
  const parsed = parseLooseDate(dateKey);
  if (!parsed) return dateKey || "";
  parsed.setDate(parsed.getDate() + Number(deltaDays || 0));
  return formatIsoDate(parsed);
}

function matchesDateWindow(dateKey, startDate, endDate) {
  if (!dateKey) return false;
  return dateKey >= startDate && dateKey <= endDate;
}

function deriveSectionCustomer(sectionKey, row) {
  if (sectionKey === "inventory") {
    return canonicalizeCustomerName(pickLooseValue(row, ["customer_name", "Customer name"]));
  }
  if (sectionKey === "inbounds") {
    return canonicalizeCustomerName(pickLooseValue(row, ["item_customer_name", "receipt_customer_name", "receive_order_customer_name", "customer_name", "Customer name"]));
  }
  if (sectionKey === "outbounds") {
    return canonicalizeCustomerName(pickLooseValue(row, ["shipment_customer_name", "ship_order_customer_name", "item_customer_name", "customer_name", "Customer name"]));
  }
  if (sectionKey === "production") {
    return canonicalizeCustomerName(pickLooseValue(row, ["customer_name", "Customer name"]));
  }
  return canonicalizeCustomerName(pickLooseValue(row, ["customer", "Customer", "customer_name", "Customer name"]));
}

function matchesCustomerName(customerName, selectedCustomer) {
  if (!selectedCustomer || selectedCustomer === "all") return true;
  return customerNamesMatch(customerName, selectedCustomer);
}

function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
}

function buildMetrics(entries) {
  return entries
    .filter(function(entry) {
      return entry && entry.label;
    })
    .map(function(entry) {
      return {
        label: entry.label,
        value: entry.value,
      };
    });
}

function buildMissingSection(config, context) {
  const notes = [];
  if (context && context.note) notes.push(String(context.note));
  return {
    label: config.label,
    reportCode: config.reportCode,
    generatedAt: "",
    generatedAtLabel: "",
    sourceMode: "missing",
    possibleTruncation: false,
    rowCount: 0,
    metrics: buildMetrics([{ label: "Rows", value: "0" }]),
    columns: [],
    rows: [],
    groups: [],
    notes: notes,
  };
}

async function fetchRecentReportsForCode(supabase, siteId, reportCode) {
  const result = await supabase
    .from("nulogy_artifact_reports")
    .select("site_id,run_id,generated_at,report_code,report_title,ok,skipped,row_count,header_count,headers,requested_columns,possible_truncation,preview_json,summary_json,created_at")
    .eq("site_id", siteId)
    .eq("report_code", reportCode)
    .eq("ok", true)
    .eq("skipped", false)
    .order("generated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (result.error) throw result.error;
  return Array.isArray(result.data) ? result.data : [];
}

function chooseHistoricalReport(reports, asOfDate) {
  let matched = null;
  let usedLatestFallback = false;
  for (let i = 0; i < reports.length; i += 1) {
    const report = reports[i];
    const reportDate = reportGeneratedEtDate(report);
    if (reportDate && reportDate <= asOfDate) {
      matched = report;
      break;
    }
  }
  if (!matched && reports.length) {
    matched = reports[0];
    usedLatestFallback = true;
  }
  return {
    report: matched,
    usedLatestFallback: usedLatestFallback,
  };
}

function reportGeneratedEtDate(report) {
  if (!report || !report.generated_at) return "";
  return formatDateParts(new Date(report.generated_at), "America/New_York");
}

function isRollingWindowSection(sectionKey) {
  return sectionKey !== "inventory";
}

function isReportOutsideWindow(sectionKey, report, windowStart) {
  if (!isRollingWindowSection(sectionKey) || !windowStart) return false;
  const reportDate = reportGeneratedEtDate(report);
  return !!reportDate && reportDate < windowStart;
}

function extractPreviewRows(previewJson) {
  if (!previewJson || typeof previewJson !== "object") return [];
  if (Array.isArray(previewJson.rows)) return previewJson.rows;
  if (Array.isArray(previewJson.data)) return previewJson.data;
  if (Array.isArray(previewJson.previewRows)) return previewJson.previewRows;
  if (previewJson.table && Array.isArray(previewJson.table.rows)) return previewJson.table.rows;
  if (previewJson.payload && Array.isArray(previewJson.payload.rows)) return previewJson.payload.rows;
  return [];
}

async function fetchArtifactRows(supabase, siteId, report) {
  const result = await supabase
    .from("nulogy_artifact_files")
    .select("storage_bucket,storage_path,artifact_type,created_at,generated_at")
    .eq("site_id", siteId)
    .eq("run_id", report.run_id)
    .eq("report_code", report.report_code)
    .eq("artifact_type", "raw_csv")
    .order("generated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  const file = Array.isArray(result.data) && result.data.length ? result.data[0] : null;
  if (!file) {
    const previewRows = extractPreviewRows(report.preview_json);
    return {
      rows: previewRows,
      sourceMode: previewRows.length ? "preview_json" : "missing",
      note: previewRows.length ? "Using preview rows because raw CSV is unavailable." : "Raw CSV artifact is unavailable.",
    };
  }

  const signed = await supabase.storage.from(file.storage_bucket || "nulogy-artifacts").createSignedUrl(file.storage_path, 120);
  if (signed.error || !signed.data || !signed.data.signedUrl) {
    const previewRows = extractPreviewRows(report.preview_json);
    return {
      rows: previewRows,
      sourceMode: previewRows.length ? "preview_json" : "missing",
      note: previewRows.length ? "Using preview rows because the raw CSV artifact could not be signed." : "Raw CSV artifact could not be signed.",
    };
  }

  const response = await fetch(signed.data.signedUrl);
  if (!response.ok) {
    const previewRows = extractPreviewRows(report.preview_json);
    return {
      rows: previewRows,
      sourceMode: previewRows.length ? "preview_json" : "missing",
      note: previewRows.length ? "Using preview rows because the raw CSV artifact could not be downloaded." : "Raw CSV artifact could not be downloaded.",
    };
  }

  const csvText = await response.text();
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: false });
  return {
    rows: Array.isArray(parsed.data) ? parsed.data : [],
    sourceMode: "raw_csv",
    note: "",
  };
}

function seedDescriptionMap(map, rows, codeKeys, descriptionKeys) {
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const code = compactText(pickLooseValue(row, codeKeys));
    const description = compactText(pickLooseValue(row, descriptionKeys));
    if (!code || !description) return;
    const key = normalizeKey(code);
    if (!map[key]) map[key] = description;
  });
}

function buildItemDescriptionMap(rawBySection) {
  const map = {};
  seedDescriptionMap(map, rawBySection.inventory, ["item_code", "Item code"], ["item_description", "Item description"]);
  seedDescriptionMap(map, rawBySection.inbounds, ["item_code", "Item code", "original_item_code", "Original item code"], ["item_description", "Item description"]);
  seedDescriptionMap(map, rawBySection.outbounds, ["item_code", "Item code"], ["item_description", "Item description"]);
  seedDescriptionMap(map, rawBySection.production, ["item_code", "Item code"], ["item_description", "Item description"]);
  return map;
}

function buildTransferSectionMeta(reportCode, transferLoad) {
  const generatedAt = compactText(transferLoad && transferLoad.generatedAt);
  return {
    report: generatedAt
      ? {
        generated_at: generatedAt,
        possible_truncation: !!(transferLoad && transferLoad.possibleTruncation),
        report_code: reportCode,
      }
      : null,
    sourceMode: compactText(transferLoad && transferLoad.sourceMode) || "live_transfer_sync",
    notes: Array.isArray(transferLoad && transferLoad.notes) ? transferLoad.notes.slice() : [],
  };
}

function formatNulogyDateTime(dateIso, endOfDay) {
  const match = String(dateIso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Number(match[2]) - 1;
  if (!Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return "";
  return match[1] + "-" + monthNames[monthIndex] + "-" + match[3] + (endOfDay ? " 11:59 PM" : " 12:00 AM");
}

function summarizeReportFailure(result, report) {
  const body = result && result.body ? result.body : {};
  const messages = Array.isArray(body.failureMessages) ? body.failureMessages.filter(Boolean) : [];
  if (messages.length) return messages.join(" | ");
  if (body.error) return String(body.error);
  return "Failed to run " + report + ".";
}

function normalizeRawObject(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return {};
    }
  }
  return typeof value === "object" ? value : {};
}

async function fetchLatestProductionSnapshotAt(supabase, siteId) {
  const result = await supabase
    .from("production_events")
    .select("source_snapshot_at")
    .eq("site_id", siteId)
    .not("source_snapshot_at", "is", null)
    .order("source_snapshot_at", { ascending: false })
    .limit(1);
  if (result.error) throw result.error;
  return Array.isArray(result.data) && result.data[0]
    ? compactText(result.data[0].source_snapshot_at)
    : "";
}

async function fetchProductionEventRows(supabase, siteId, startDate, endDate) {
  const pageSize = 1000;
  let from = 0;
  let out = [];
  while (true) {
    const to = from + pageSize - 1;
    const query = await supabase
      .from("production_events")
      .select("produced_date_et,produced_at_utc,item_code,units_produced,line,work_order_code,source_snapshot_at,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", startDate)
      .lte("produced_date_et", endDate)
      .order("produced_date_et", { ascending: false })
      .range(from, to);
    if (query.error) throw query.error;
    const rows = Array.isArray(query.data) ? query.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return out;
}

async function loadProductionEventsForWindow(supabase, siteId, startDate, endDate) {
  const results = await Promise.all([
    fetchProductionEventRows(supabase, siteId, startDate, endDate),
    fetchLatestProductionSnapshotAt(supabase, siteId),
  ]);
  return {
    events: results[0],
    generatedAt: results[1],
    possibleTruncation: false,
    notes: ["Using normalized production events synced from live Nulogy production history."],
    sourceMode: "production_events",
  };
}

function buildProductionSectionMeta(reportCode, load) {
  const generatedAt = compactText(load && load.generatedAt);
  return {
    report: generatedAt
      ? {
        generated_at: generatedAt,
        possible_truncation: !!(load && load.possibleTruncation),
        report_code: reportCode,
      }
      : null,
    sourceMode: compactText(load && load.sourceMode) || "production_events",
    notes: Array.isArray(load && load.notes) ? load.notes.slice() : [],
  };
}

function mapProductionEventsToRows(events) {
  return (Array.isArray(events) ? events : []).map(function(event) {
    const raw = normalizeRawObject(event && event.raw);
    const itemCode = compactText(pickLooseValue(raw, ["item_code", "Item code"])) || compactText(event && event.item_code);
    return {
      customer_name: canonicalizeCustomerName(pickLooseValue(raw, ["customer_name", "Customer name", "Customer Name", "customer"])),
      produced_at: compactText(
        pickLooseValue(raw, ["produced_at", "Produced at", "Produced At", "Produced date"]) ||
        event && (event.produced_at_utc || event.produced_date_et)
      ),
      purchase_order_number: compactText(pickLooseValue(raw, ["purchase_order_number", "Purchase Order number", "Purchase Order Number"])),
      project_code: compactText(pickLooseValue(raw, ["project_code", "Work Order code", "Work Order Code"])) || compactText(event && event.work_order_code),
      line: compactText(pickLooseValue(raw, ["line", "Line", "line_name", "Line Name"])) || compactText(event && event.line),
      item_code: itemCode,
      item_description: compactText(pickLooseValue(raw, ["item_description", "Item description", "Item Description", "description", "Description"])),
      lot_code: compactText(pickLooseValue(raw, ["lot_code", "Lot code", "Lot Code"])),
      units_produced: safeNum(pickLooseValue(raw, ["units_produced", "Units produced", "Units Produced"])) || safeNum(event && event.units_produced),
    };
  });
}

function buildLiveConsumptionFilters(startDate, endDate, selectedCustomer) {
  const filters = [
    {
      column: "consumed_at",
      operator: "between",
      from_threshold: formatNulogyDateTime(startDate, false),
      to_threshold: formatNulogyDateTime(endDate, true),
    },
  ];
  const customerFilter = preferredNulogyCustomerFilterValue(selectedCustomer);
  if (customerFilter && selectedCustomer && selectedCustomer !== "all") {
    filters.push({
      column: "customer",
      operator: "=",
      threshold: customerFilter,
    });
  }
  return filters;
}

async function fetchLiveConsumptionRows(windowStart, windowEnd, selectedCustomer) {
  const report = SECTION_CONFIG.consumption.reportCode;
  const executed = await executeReportRun({
    report: report,
    columns: CONSUMPTION_LIVE_COLUMNS,
    filters: buildLiveConsumptionFilters(windowStart, windowEnd, selectedCustomer),
    waitForCompletion: true,
    pollIntervalMs: 2500,
    maxPolls: 60,
  });
  if (!executed.ok) throw new Error(summarizeReportFailure(executed, report));
  const body = executed.body || {};
  if (!body.downloadUrl) throw new Error("Completed " + report + " run did not return a download URL.");
  const response = await fetch(body.downloadUrl, {
    method: "GET",
    headers: {
      Accept: "text/csv,text/plain,application/xml,text/xml",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Failed to download " + report + " CSV (" + response.status + ").");
  }
  const rows = parseCSV(text);
  return {
    rows: rows,
    generatedAt: new Date().toISOString(),
    possibleTruncation: Number(REPORT_ROW_LIMITS[report] || 0) > 0 && rows.length >= Number(REPORT_ROW_LIMITS[report] || 0),
    notes: ["Using a live consumption pull because the stored consumption artifact window is stale."],
    sourceMode: "live_consumption_sync",
  };
}

function buildLiveConsumptionMeta(reportCode, load) {
  const generatedAt = compactText(load && load.generatedAt);
  return {
    report: generatedAt
      ? {
        generated_at: generatedAt,
        possible_truncation: !!(load && load.possibleTruncation),
        report_code: reportCode,
      }
      : null,
    sourceMode: compactText(load && load.sourceMode) || "live_consumption_sync",
    notes: Array.isArray(load && load.notes) ? load.notes.slice() : [],
  };
}

function mapInboundTransferEventsToRows(events) {
  return (Array.isArray(events) ? events : []).map(function(event) {
    return {
      customer_name: canonicalizeCustomerName(event && event.customer_name),
      item_customer_name: canonicalizeCustomerName(event && event.customer_name),
      receipt_customer_name: canonicalizeCustomerName(event && event.customer_name),
      receive_order_customer_name: canonicalizeCustomerName(event && event.customer_name),
      received_at: compactText(event && event.transfer_date_et),
      receive_order_code: compactText(event && (event.order_code || event.reference_code)),
      receive_order_reference: compactText(event && event.reference_code),
      planned_receipt_id: compactText(event && event.reference_code),
      item_code: compactText(event && event.item_code),
      original_item_code: compactText(event && event.item_code),
      item_description: compactText(event && event.item_description),
      lot_code: compactText(event && event.lot_code),
      pallet_number: compactText(event && event.pallet_number),
      receiving_quantity: safeNum(event && event.quantity),
      base_quantity: safeNum(event && event.quantity),
      default_quantity: safeNum(event && event.quantity),
      default_unit_of_measure: compactText(event && event.unit_of_measure),
    };
  });
}

function mapOutboundTransferEventsToRows(events) {
  return (Array.isArray(events) ? events : []).map(function(event) {
    return {
      customer_name: canonicalizeCustomerName(event && event.customer_name),
      item_customer_name: canonicalizeCustomerName(event && event.customer_name),
      shipment_customer_name: canonicalizeCustomerName(event && event.customer_name),
      ship_order_customer_name: canonicalizeCustomerName(event && event.customer_name),
      actual_ship_at: compactText(event && event.transfer_date_et),
      shipment_expected_ship_at: compactText(event && event.transfer_date_et),
      ship_order_code: compactText(event && (event.order_code || event.reference_code)),
      shipment_id: compactText(event && event.reference_code),
      shipment_item_purchase_order_number: compactText(event && event.purchase_order_number),
      project_purchase_order_number: compactText(event && event.purchase_order_number),
      item_code: compactText(event && event.item_code),
      item_description: compactText(event && event.item_description),
      lot_code: compactText(event && event.lot_code),
      pallet_number: compactText(event && event.pallet_number),
      default_quantity: safeNum(event && event.quantity),
      base_quantity: safeNum(event && event.quantity),
      case_quantity: safeNum(event && event.quantity),
      default_unit_of_measure: compactText(event && event.unit_of_measure),
    };
  });
}

function buildInventorySection(rawRows, selectedCustomer, meta, itemDescriptions) {
  const columns = [
    { key: "itemCode", label: "Item code", kind: "text" },
    { key: "itemDescription", label: "Item description", kind: "text" },
    { key: "lotCode", label: "Lot code", kind: "text" },
    { key: "expiryDate", label: "Expiry date", kind: "date" },
    { key: "qtyOnHand", label: "Qty On Hand", kind: "number" },
    { key: "baseUom", label: "Base UOM", kind: "text" },
    { key: "inventoryStatus", label: "Inventory Status", kind: "text" },
    { key: "customerName", label: "Customer Name", kind: "text" },
  ];

  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map(function(row) {
      const itemCode = compactText(pickLooseValue(row, ["item_code", "Item code"]));
      const itemDescription = compactText(pickLooseValue(row, ["item_description", "Item description"])) || itemDescriptions[normalizeKey(itemCode)] || "";
      const customerName = deriveSectionCustomer("inventory", row);
      return {
        itemCode: itemCode,
        itemDescription: itemDescription,
        lotCode: compactText(pickLooseValue(row, ["lot_code", "Lot code"])),
        expiryDate: formatIsoDate(pickLooseValue(row, ["expiry_date", "Expiry date"])),
        qtyOnHand: safeNum(pickLooseValue(row, ["base_quantity", "Base quantity", "default_quantity", "Default quantity"])),
        baseUom: compactText(pickLooseValue(row, ["base_unit_of_measure", "Base unit of measure", "default_unit_of_measure", "Default unit of measure"])),
        inventoryStatus: compactText(pickLooseValue(row, ["inventory_status", "Inventory status"])),
        customerName: customerName,
      };
    })
    .filter(function(row) {
      return (row.itemCode || row.itemDescription || row.lotCode || row.qtyOnHand) && matchesCustomerName(row.customerName, selectedCustomer);
    })
    .sort(function(left, right) {
      return (
        compareText(left.customerName, right.customerName) ||
        compareText(left.itemCode, right.itemCode) ||
        compareText(left.lotCode, right.lotCode) ||
        compareText(left.expiryDate, right.expiryDate)
      );
    });

  const totalQuantity = rows.reduce(function(sum, row) { return sum + safeNum(row.qtyOnHand); }, 0);
  const metrics = buildMetrics([
    { label: "Rows", value: rows.length.toLocaleString() },
    { label: "Qty On Hand", value: Math.round(totalQuantity).toLocaleString() },
    { label: "SKUs", value: uniqueSorted(rows.map(function(row) { return row.itemCode; })).length.toLocaleString() },
    { label: "Lots", value: uniqueSorted(rows.map(function(row) { return row.lotCode; })).length.toLocaleString() },
  ]);

  return {
    label: SECTION_CONFIG.inventory.label,
    reportCode: SECTION_CONFIG.inventory.reportCode,
    generatedAt: meta.report ? meta.report.generated_at : "",
    generatedAtLabel: meta.report ? formatEtDateTime(meta.report.generated_at) : "",
    sourceMode: meta.sourceMode,
    possibleTruncation: !!(meta.report && meta.report.possible_truncation),
    rowCount: rows.length,
    metrics: metrics,
    columns: columns,
    rows: rows,
    groups: [],
    notes: meta.notes || [],
  };
}

function buildInboundsSection(rawRows, selectedCustomer, windowStart, windowEnd, meta, itemDescriptions) {
  const columns = [
    { key: "receivedAt", label: "Received at", kind: "date" },
    { key: "reference", label: "STO#/TO#/PO#", kind: "text" },
    { key: "itemCode", label: "Item code", kind: "text" },
    { key: "itemDescription", label: "Item description", kind: "text" },
    { key: "lotCode", label: "Lot code", kind: "text" },
    { key: "qtyReceived", label: "Qty Received", kind: "number" },
  ];

  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map(function(row) {
      const receivedAt = formatIsoDate(pickLooseValue(row, ["received_at", "Received at"]));
      const itemCode = compactText(pickLooseValue(row, ["item_code", "Item code", "original_item_code", "Original item code"]));
      const customerName = deriveSectionCustomer("inbounds", row);
      return {
        receivedAt: receivedAt,
        reference: compactText(pickLooseValue(row, ["receive_order_code", "Receive Order code", "receive_order", "Receive Order", "planned_receipt_id", "Planned Receipt ID", "receive_order_reference", "Receive Order reference", "receipt_reference_1", "Receipt reference 1", "receipt_reference_2", "Receipt reference 2"])),
        itemCode: itemCode,
        itemDescription: compactText(pickLooseValue(row, ["item_description", "Item description"])) || itemDescriptions[normalizeKey(itemCode)] || "",
        lotCode: compactText(pickLooseValue(row, ["lot_code", "Lot code"])),
        qtyReceived: safeNum(pickLooseValue(row, ["receiving_quantity", "Receiving quantity", "base_quantity", "Base quantity", "default_quantity", "Default quantity"])),
        customerName: customerName,
      };
    })
    .filter(function(row) {
      return row.receivedAt && matchesDateWindow(row.receivedAt, windowStart, windowEnd) && matchesCustomerName(row.customerName, selectedCustomer);
    })
    .sort(function(left, right) {
      return (
        compareText(left.receivedAt, right.receivedAt) ||
        compareText(left.reference, right.reference) ||
        compareText(left.itemCode, right.itemCode) ||
        compareText(left.lotCode, right.lotCode)
      );
    });

  const totalQuantity = rows.reduce(function(sum, row) { return sum + safeNum(row.qtyReceived); }, 0);
  const metrics = buildMetrics([
    { label: "Rows", value: rows.length.toLocaleString() },
    { label: "Qty Received", value: Math.round(totalQuantity).toLocaleString() },
    { label: "SKUs", value: uniqueSorted(rows.map(function(row) { return row.itemCode; })).length.toLocaleString() },
    { label: "Receipts", value: uniqueSorted(rows.map(function(row) { return row.reference; })).length.toLocaleString() },
  ]);

  return {
    label: SECTION_CONFIG.inbounds.label,
    reportCode: SECTION_CONFIG.inbounds.reportCode,
    generatedAt: meta.report ? meta.report.generated_at : "",
    generatedAtLabel: meta.report ? formatEtDateTime(meta.report.generated_at) : "",
    sourceMode: meta.sourceMode,
    possibleTruncation: !!(meta.report && meta.report.possible_truncation),
    rowCount: rows.length,
    metrics: metrics,
    columns: columns,
    rows: rows,
    groups: [],
    notes: meta.notes || [],
  };
}

function buildOutboundsSection(rawRows, selectedCustomer, windowStart, windowEnd, meta, itemDescriptions) {
  const columns = [
    { key: "dateShipped", label: "Date Shipped", kind: "date" },
    { key: "orderNumber", label: "PO#", kind: "text" },
    { key: "partNumber", label: "Part Number", kind: "text" },
    { key: "description", label: "Description", kind: "text" },
    { key: "vendorLotCode", label: "Vendor Lot Code", kind: "text" },
    { key: "quantity", label: "Quantity", kind: "number" },
  ];

  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map(function(row) {
      const dateShipped = formatIsoDate(pickLooseValue(row, ["actual_ship_at", "Actual ship date", "shipment_expected_ship_at", "Shipment expected ship date"]));
      const partNumber = compactText(pickLooseValue(row, ["item_code", "Item code"]));
      const customerName = deriveSectionCustomer("outbounds", row);
      return {
        dateShipped: dateShipped,
        orderNumber: compactText(pickLooseValue(row, ["ship_order_code", "Ship Order code", "shipment_id", "Shipment ID", "shipment_item_purchase_order_number", "Shipment Item purchase order number", "project_purchase_order_number", "Work Order Purchase Order number"])),
        partNumber: partNumber,
        description: compactText(pickLooseValue(row, ["item_description", "Item description"])) || itemDescriptions[normalizeKey(partNumber)] || "",
        vendorLotCode: compactText(pickLooseValue(row, ["lot_code", "Lot code"])),
        quantity: safeNum(pickLooseValue(row, ["default_quantity", "Default quantity", "base_quantity", "Base quantity", "case_quantity", "Case quantity"])),
        customerName: customerName,
      };
    })
    .filter(function(row) {
      return row.dateShipped && matchesDateWindow(row.dateShipped, windowStart, windowEnd) && matchesCustomerName(row.customerName, selectedCustomer);
    })
    .sort(function(left, right) {
      return (
        compareText(left.dateShipped, right.dateShipped) ||
        compareText(left.orderNumber, right.orderNumber) ||
        compareText(left.partNumber, right.partNumber) ||
        compareText(left.vendorLotCode, right.vendorLotCode)
      );
    });

  const totalQuantity = rows.reduce(function(sum, row) { return sum + safeNum(row.quantity); }, 0);
  const metrics = buildMetrics([
    { label: "Rows", value: rows.length.toLocaleString() },
    { label: "Quantity", value: Math.round(totalQuantity).toLocaleString() },
    { label: "SKUs", value: uniqueSorted(rows.map(function(row) { return row.partNumber; })).length.toLocaleString() },
    { label: "Orders", value: uniqueSorted(rows.map(function(row) { return row.orderNumber; })).length.toLocaleString() },
  ]);

  return {
    label: SECTION_CONFIG.outbounds.label,
    reportCode: SECTION_CONFIG.outbounds.reportCode,
    generatedAt: meta.report ? meta.report.generated_at : "",
    generatedAtLabel: meta.report ? formatEtDateTime(meta.report.generated_at) : "",
    sourceMode: meta.sourceMode,
    possibleTruncation: !!(meta.report && meta.report.possible_truncation),
    rowCount: rows.length,
    metrics: metrics,
    columns: columns,
    rows: rows,
    groups: [],
    notes: meta.notes || [],
  };
}

function buildProductionSection(rawRows, selectedCustomer, windowStart, windowEnd, meta, itemDescriptions) {
  const columns = [
    { key: "producedAt", label: "Produced date", kind: "date" },
    { key: "purchaseOrderNumber", label: "PO#", kind: "text" },
    { key: "workOrderCode", label: "Work Order", kind: "text" },
    { key: "line", label: "Line", kind: "text" },
    { key: "itemCode", label: "Item code", kind: "text" },
    { key: "itemDescription", label: "Item description", kind: "text" },
    { key: "lotCode", label: "Lot code", kind: "text" },
    { key: "unitsProduced", label: "Units Produced", kind: "number" },
  ];

  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map(function(row) {
      const producedAt = formatIsoDate(pickLooseValue(row, ["produced_at", "Produced date"]));
      const itemCode = compactText(pickLooseValue(row, ["item_code", "Item code"]));
      const customerName = deriveSectionCustomer("production", row);
      return {
        producedAt: producedAt,
        purchaseOrderNumber: compactText(pickLooseValue(row, ["purchase_order_number", "Purchase Order number"])),
        workOrderCode: compactText(pickLooseValue(row, ["project_code", "Work Order code"])),
        line: compactText(pickLooseValue(row, ["line", "Line"])),
        itemCode: itemCode,
        itemDescription: compactText(pickLooseValue(row, ["item_description", "Item description"])) || itemDescriptions[normalizeKey(itemCode)] || "",
        lotCode: compactText(pickLooseValue(row, ["lot_code", "Lot code"])),
        unitsProduced: safeNum(pickLooseValue(row, ["units_produced", "Units produced"])),
        customerName: customerName,
      };
    })
    .filter(function(row) {
      return row.producedAt && matchesDateWindow(row.producedAt, windowStart, windowEnd) && matchesCustomerName(row.customerName, selectedCustomer);
    })
    .sort(function(left, right) {
      return (
        compareText(left.producedAt, right.producedAt) ||
        compareText(left.workOrderCode, right.workOrderCode) ||
        compareText(left.itemCode, right.itemCode) ||
        compareText(left.lotCode, right.lotCode)
      );
    });

  const totalUnits = rows.reduce(function(sum, row) { return sum + safeNum(row.unitsProduced); }, 0);
  const metrics = buildMetrics([
    { label: "Rows", value: rows.length.toLocaleString() },
    { label: "Units Produced", value: Math.round(totalUnits).toLocaleString() },
    { label: "SKUs", value: uniqueSorted(rows.map(function(row) { return row.itemCode; })).length.toLocaleString() },
    { label: "Work Orders", value: uniqueSorted(rows.map(function(row) { return row.workOrderCode; })).length.toLocaleString() },
  ]);

  return {
    label: SECTION_CONFIG.production.label,
    reportCode: SECTION_CONFIG.production.reportCode,
    generatedAt: meta.report ? meta.report.generated_at : "",
    generatedAtLabel: meta.report ? formatEtDateTime(meta.report.generated_at) : "",
    sourceMode: meta.sourceMode,
    possibleTruncation: !!(meta.report && meta.report.possible_truncation),
    rowCount: rows.length,
    metrics: metrics,
    columns: columns,
    rows: rows,
    groups: [],
    notes: meta.notes || [],
  };
}

function deriveConsumptionPurchaseOrder(row) {
  const candidates = [
    "purchase_order_number",
    "Purchase Order number",
    "project_reference_1",
    "project_reference_2",
    "project_reference_3",
    "project_reference_4",
    "project_reference_5",
    "job_reference",
    "project_code",
    "Work Order code",
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    const value = compactText(pickLooseValue(row, [candidates[i]]));
    if (!value) continue;
    if (/^po\b/i.test(value)) return value.replace(/^po\s*/i, "").trim();
    if (/\d{5,}/.test(value)) return value.match(/\d{5,}/)[0];
  }
  return "";
}

function safeSheetName(value) {
  const raw = String(value || "").replace(/[\\/?*\[\]:]/g, " ").replace(/\s+/g, " ").trim();
  return raw ? raw.slice(0, 31) : "Consumption";
}

function buildConsumptionSection(rawRows, selectedCustomer, windowStart, windowEnd, meta, itemDescriptions) {
  const columns = [
    { key: "date", label: "Date", kind: "date" },
    { key: "item", label: "Item", kind: "text" },
    { key: "description", label: "Description", kind: "text" },
    { key: "lotCode", label: "Lot Code", kind: "text" },
    { key: "expiryDate", label: "Expiry Date", kind: "date" },
    { key: "quantityConsumed", label: "Quantity Consumed", kind: "number" },
  ];

  const normalizedRows = (Array.isArray(rawRows) ? rawRows : [])
    .map(function(row) {
      const dateKey = formatIsoDate(pickLooseValue(row, ["consumed_at", "Consumed at", "consumed_date", "Consumed date"]));
      const finishedGoodItemCode = compactText(pickLooseValue(row, ["finished_good_item_code", "Finished good code"]));
      const subcomponentItemCode = compactText(pickLooseValue(row, ["subcomponent_item_code", "Subcomponent Item code"]));
      const customerName = deriveSectionCustomer("consumption", row);
      return {
        dateKey: dateKey,
        customerName: customerName,
        purchaseOrderNumber: deriveConsumptionPurchaseOrder(row),
        workOrderCode: compactText(pickLooseValue(row, ["project_code", "Work Order code"])),
        finishedGoodItemCode: finishedGoodItemCode,
        finishedGoodDescription:
          compactText(pickLooseValue(row, ["finished_good_item_description", "Finished good description"])) ||
          itemDescriptions[normalizeKey(finishedGoodItemCode)] ||
          "",
        finishedGoodLotCode: compactText(pickLooseValue(row, ["finished_good_lot_code", "Finished good lot code"])),
        finishedGoodExpiryDate: formatIsoDate(pickLooseValue(row, ["finished_good_expiry_date", "Finished good expiry date"])),
        finishedGoodQuantityProduced: safeNum(pickLooseValue(row, ["finished_good_quantity_produced", "Finished good quantity produced"])),
        subcomponentItemCode: subcomponentItemCode,
        subcomponentDescription:
          compactText(pickLooseValue(row, ["subcomponent_item_description", "Subcomponent item description", "item_description", "Item description"])) ||
          itemDescriptions[normalizeKey(subcomponentItemCode)] ||
          "",
        subcomponentLotCode: compactText(pickLooseValue(row, ["subcomponent_lot_code", "Subcomponent lot code"])),
        subcomponentExpiryDate: formatIsoDate(pickLooseValue(row, ["subcomponent_expiry_date", "Subcomponent expiry date"])),
        subcomponentQuantityConsumed: safeNum(pickLooseValue(row, ["subcomponent_quantity_consumed", "Subcomponent quantity consumed"])),
      };
    })
    .filter(function(row) {
      return row.dateKey && row.finishedGoodItemCode && matchesDateWindow(row.dateKey, windowStart, windowEnd) && matchesCustomerName(row.customerName, selectedCustomer);
    })
    .sort(function(left, right) {
      return (
        compareText(left.purchaseOrderNumber || left.workOrderCode, right.purchaseOrderNumber || right.workOrderCode) ||
        compareText(left.finishedGoodItemCode, right.finishedGoodItemCode) ||
        compareText(left.dateKey, right.dateKey) ||
        compareText(left.subcomponentItemCode, right.subcomponentItemCode) ||
        compareText(left.subcomponentLotCode, right.subcomponentLotCode)
      );
    });

  const grouped = {};
  normalizedRows.forEach(function(row) {
    const reference = row.purchaseOrderNumber || row.workOrderCode || "Unassigned";
    const sheetName = safeSheetName(row.finishedGoodItemCode + " - " + (row.purchaseOrderNumber ? ("PO " + row.purchaseOrderNumber) : ("WO " + reference)));
    const groupKey = row.finishedGoodItemCode + "|" + reference;
    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        key: groupKey,
        sheetName: sheetName,
        finishedGoodItemCode: row.finishedGoodItemCode,
        finishedGoodDescription: row.finishedGoodDescription,
        purchaseOrderNumber: row.purchaseOrderNumber,
        workOrderCode: row.workOrderCode,
        rows: [],
      };
    }
    grouped[groupKey].rows.push(row);
  });

  const groups = Object.values(grouped)
    .sort(function(left, right) {
      return compareText(left.sheetName, right.sheetName);
    })
    .map(function(group) {
      const workbookRows = [];
      const byDate = {};
      group.rows.forEach(function(row) {
        const dateKey = row.dateKey || "";
        if (!byDate[dateKey]) byDate[dateKey] = [];
        byDate[dateKey].push(row);
      });

      Object.keys(byDate)
        .sort(compareText)
        .forEach(function(dateKey, index, keys) {
          const dateRows = byDate[dateKey];
          dateRows.forEach(function(row, rowIndex) {
            workbookRows.push({
              date: rowIndex === 0 ? row.dateKey : "",
              item: row.subcomponentItemCode,
              description: row.subcomponentDescription,
              lotCode: row.subcomponentLotCode,
              expiryDate: row.subcomponentExpiryDate,
              quantityConsumed: row.subcomponentQuantityConsumed,
              rowKind: "subcomponent",
            });
          });

          const finishedGoods = {};
          dateRows.forEach(function(row) {
            const fgKey = [
              row.finishedGoodItemCode,
              row.finishedGoodLotCode,
              row.finishedGoodExpiryDate,
              row.finishedGoodQuantityProduced,
            ].join("|");
            if (!finishedGoods[fgKey]) {
              finishedGoods[fgKey] = {
                item: row.finishedGoodItemCode,
                description: row.finishedGoodDescription,
                lotCode: row.finishedGoodLotCode,
                expiryDate: row.finishedGoodExpiryDate,
                quantityConsumed: row.finishedGoodQuantityProduced,
                rowKind: "finished_good",
              };
            }
          });

          Object.keys(finishedGoods).forEach(function(fgKey) {
            workbookRows.push(Object.assign({ date: "" }, finishedGoods[fgKey]));
          });

          if (index < keys.length - 1) {
            workbookRows.push({
              date: "",
              item: "",
              description: "",
              lotCode: "",
              expiryDate: "",
              quantityConsumed: "",
              rowKind: "separator",
            });
          }
        });

      const totalQuantityConsumed = group.rows.reduce(function(sum, row) {
        return sum + safeNum(row.subcomponentQuantityConsumed);
      }, 0);

      return {
        key: group.key,
        sheetName: group.sheetName,
        finishedGoodItemCode: group.finishedGoodItemCode,
        finishedGoodDescription: group.finishedGoodDescription,
        purchaseOrderNumber: group.purchaseOrderNumber,
        workOrderCode: group.workOrderCode,
        rowCount: group.rows.length,
        metrics: buildMetrics([
          { label: "Raw Rows", value: group.rows.length.toLocaleString() },
          { label: "Qty Consumed", value: Math.round(totalQuantityConsumed).toLocaleString() },
          { label: "Dates", value: uniqueSorted(group.rows.map(function(row) { return row.dateKey; })).length.toLocaleString() },
        ]),
        rows: workbookRows,
      };
    });

  const totalQuantityConsumed = normalizedRows.reduce(function(sum, row) {
    return sum + safeNum(row.subcomponentQuantityConsumed);
  }, 0);
  const metrics = buildMetrics([
    { label: "Sheets", value: groups.length.toLocaleString() },
    { label: "Raw Rows", value: normalizedRows.length.toLocaleString() },
    { label: "Qty Consumed", value: Math.round(totalQuantityConsumed).toLocaleString() },
    { label: "Finished Goods", value: uniqueSorted(groups.map(function(group) { return group.finishedGoodItemCode; })).length.toLocaleString() },
  ]);

  return {
    label: SECTION_CONFIG.consumption.label,
    reportCode: SECTION_CONFIG.consumption.reportCode,
    generatedAt: meta.report ? meta.report.generated_at : "",
    generatedAtLabel: meta.report ? formatEtDateTime(meta.report.generated_at) : "",
    sourceMode: meta.sourceMode,
    possibleTruncation: !!(meta.report && meta.report.possible_truncation),
    rowCount: normalizedRows.length,
    metrics: metrics,
    columns: columns,
    rows: [],
    groups: groups,
    notes: meta.notes || [],
  };
}

function collectCustomers(rawSectionRows) {
  const customers = [];
  SECTION_ORDER.forEach(function(sectionKey) {
    (Array.isArray(rawSectionRows[sectionKey]) ? rawSectionRows[sectionKey] : []).forEach(function(row) {
      const customer = deriveSectionCustomer(sectionKey, row);
      if (customer) customers.push(customer);
    });
  });
  return uniqueSorted(customers);
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const user = requireReportingUser(req, res);
  if (!user) return;

  try {
    const siteId = compactText((req.query && req.query.siteId) || CACHE_SITE_ID || "default") || "default";
    const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query && req.query.asOf || ""))
      ? String(req.query.asOf)
      : todayEtIso();
    const windowDays = clampInt(req.query && req.query.windowDays, 7, 1, 31);
    const windowStart = shiftIsoDate(asOfDate, -(windowDays - 1));
    const selectedCustomer = compactText(req.query && req.query.customer) === "all"
      ? "all"
      : (canonicalizeCustomerName(req.query && req.query.customer) || "all");
    const supabase = getSupabaseAdmin();

    const rawRowsBySection = {};
    const metaBySection = {};

    await Promise.all(SECTION_ORDER.map(async function(sectionKey) {
      const config = SECTION_CONFIG[sectionKey];
      const notes = [];

      if (sectionKey === "inbounds" || sectionKey === "outbounds") {
        const direction = sectionKey === "inbounds" ? "inbound" : "outbound";
        try {
          const transferLoad = await loadWarehouseTransferEventsForWindow({
            supabase: supabase,
            siteId: siteId,
            direction: direction,
            startDate: windowStart,
            endDate: asOfDate,
            updatedBy: user && user.email ? user.email : "",
            maxPolls: 60,
          });
          rawRowsBySection[sectionKey] = direction === "inbound"
            ? mapInboundTransferEventsToRows(transferLoad.events)
            : mapOutboundTransferEventsToRows(transferLoad.events);
          metaBySection[sectionKey] = buildTransferSectionMeta(config.reportCode, transferLoad);
          return;
        } catch (transferError) {
          notes.push("Live warehouse transfer sync failed, so this section fell back to historical reporting artifacts: " + compactText(transferError && transferError.message));
        }
      }

      if (sectionKey === "production") {
        try {
          const productionLoad = await loadProductionEventsForWindow(supabase, siteId, windowStart, asOfDate);
          rawRowsBySection[sectionKey] = mapProductionEventsToRows(productionLoad.events);
          metaBySection[sectionKey] = buildProductionSectionMeta(config.reportCode, productionLoad);
          return;
        } catch (productionError) {
          if (!isMissingTableError("production_events", productionError)) {
            notes.push("Production event cache failed, so this section fell back to historical reporting artifacts: " + compactText(productionError && productionError.message));
          }
        }
      }

      const reports = await fetchRecentReportsForCode(supabase, siteId, config.reportCode);
      const chosen = chooseHistoricalReport(reports, asOfDate);

      if (sectionKey === "consumption" && (!chosen.report || isReportOutsideWindow(sectionKey, chosen.report, windowStart))) {
        try {
          const consumptionLoad = await fetchLiveConsumptionRows(windowStart, asOfDate, selectedCustomer);
          rawRowsBySection[sectionKey] = Array.isArray(consumptionLoad.rows) ? consumptionLoad.rows : [];
          metaBySection[sectionKey] = buildLiveConsumptionMeta(config.reportCode, consumptionLoad);
          return;
        } catch (consumptionError) {
          notes.push("Live consumption sync failed, so this section fell back to historical reporting artifacts: " + compactText(consumptionError && consumptionError.message));
        }
      }

      if (!chosen.report) {
        rawRowsBySection[sectionKey] = [];
        metaBySection[sectionKey] = {
          report: null,
          sourceMode: "missing",
          notes: notes.length ? notes.concat(["No successful artifact report found."]) : ["No successful artifact report found."],
        };
        return;
      }

      if (chosen.usedLatestFallback) {
        notes.push("Using the most recent artifact run because none were generated on or before the selected date.");
      }

      if (isReportOutsideWindow(sectionKey, chosen.report, windowStart)) {
        notes.push("The selected artifact run predates the selected activity window, so this section has no matching activity to load.");
        rawRowsBySection[sectionKey] = [];
        metaBySection[sectionKey] = {
          report: chosen.report,
          sourceMode: "stale_window",
          notes: notes,
        };
        return;
      }

      const artifact = await fetchArtifactRows(supabase, siteId, chosen.report);
      if (artifact.note) notes.push(artifact.note);
      rawRowsBySection[sectionKey] = Array.isArray(artifact.rows) ? artifact.rows : [];
      metaBySection[sectionKey] = {
        report: chosen.report,
        sourceMode: artifact.sourceMode || "missing",
        notes: notes,
      };
    }));

    const itemDescriptions = buildItemDescriptionMap(rawRowsBySection);
    const availableCustomers = collectCustomers(rawRowsBySection);

    const sections = {
      inventory: metaBySection.inventory && rawRowsBySection.inventory
        ? buildInventorySection(rawRowsBySection.inventory, selectedCustomer, metaBySection.inventory, itemDescriptions)
        : buildMissingSection(SECTION_CONFIG.inventory, { note: "Inventory artifact data is unavailable." }),
      inbounds: metaBySection.inbounds && rawRowsBySection.inbounds
        ? buildInboundsSection(rawRowsBySection.inbounds, selectedCustomer, windowStart, asOfDate, metaBySection.inbounds, itemDescriptions)
        : buildMissingSection(SECTION_CONFIG.inbounds, { note: "Inbound artifact data is unavailable." }),
      outbounds: metaBySection.outbounds && rawRowsBySection.outbounds
        ? buildOutboundsSection(rawRowsBySection.outbounds, selectedCustomer, windowStart, asOfDate, metaBySection.outbounds, itemDescriptions)
        : buildMissingSection(SECTION_CONFIG.outbounds, { note: "Outbound artifact data is unavailable." }),
      production: metaBySection.production && rawRowsBySection.production
        ? buildProductionSection(rawRowsBySection.production, selectedCustomer, windowStart, asOfDate, metaBySection.production, itemDescriptions)
        : buildMissingSection(SECTION_CONFIG.production, { note: "Production artifact data is unavailable." }),
      consumption: metaBySection.consumption && rawRowsBySection.consumption
        ? buildConsumptionSection(rawRowsBySection.consumption, selectedCustomer, windowStart, asOfDate, metaBySection.consumption, itemDescriptions)
        : buildMissingSection(SECTION_CONFIG.consumption, { note: "Consumption artifact data is unavailable." }),
    };

    const notes = [];
    if (selectedCustomer !== "all" && availableCustomers.length && !availableCustomers.some(function(customer) {
      return customerNamesMatch(customer, selectedCustomer);
    })) {
      notes.push("The selected customer does not match any customer name found in the available artifacts.");
    }
    notes.push("Inventory is treated as an as-of snapshot. Transaction sections are filtered to the rolling activity window.");
    notes.push("The attached workbook sample included inbounds, outbounds, and consumption tabs; inventory and production tabs were added in PackPulse based on the stated reporting requirement.");

    return res.status(200).json({
      ok: true,
      siteId: siteId,
      asOfDate: asOfDate,
      windowDays: windowDays,
      windowStart: windowStart,
      windowEnd: asOfDate,
      selectedCustomer: selectedCustomer,
      availableCustomers: availableCustomers,
      sections: sections,
      notes: notes,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Could not build reporting packet.",
      details: error && error.message ? error.message : "unknown",
    });
  }
}
