import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FilterX } from "lucide-react";

import { formatDescriptionForDisplay, safeNum, triggerDownload } from "../utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { DatePicker } from "../components/ui/date-picker";
import { Input } from "../components/ui/input";
import SortHeaderButton from "../components/ui/sort-header-button";
import TableShell from "../components/ui/table-shell";
import TabsNav from "../components/ui/tabs-nav";

var MONTH_INDEX = {
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
  dec: 11
};

var REVENUE_CONFIG_STALE_MS = 15 * 60 * 1000;
var DEFAULT_INVOICE_MODE = "production";
var DEFAULT_WAREHOUSE_RATE_DRAFT = {
  inboundRate: "7.50",
  outboundRate: "7.50",
  storageRate: "9.00"
};
var DEFAULT_CANDIDATE_SORT_FIELD = "status";
var DEFAULT_CANDIDATE_SORT_DIR = "asc";
var CANDIDATE_SORT_LABELS = {
  status: "Status",
  customerSku: "Customer / SKU",
  unitsProduced: "Units",
  revenuePerUnitAvg: "Rev/Unit",
  estimatedRevenue: "Estimated Revenue",
  unitOfMeasure: "UOM",
  lotCode: "Lot Code",
  workOrderReference: "Work Order",
  purchaseOrderReference: "Purchase Order",
  jobCount: "Jobs",
  period: "Period"
};
var moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function createDefaultCoverageAudit() {
  return {
    totalRows: 0,
    rowsWithLotCode: 0,
    rowsMissingLotCode: 0,
    lotCoveragePct: 100,
    rowsWithUnitOfMeasure: 0,
    rowsMissingUnitOfMeasure: 0,
    unitOfMeasureCoveragePct: 100,
    rowsMissingBoth: 0,
    rowsFullyCovered: 0,
    fullyCoveredPct: 100,
    topMissingDates: [],
    topMissingWorkOrders: [],
    topMissingSkus: [],
    topMissingJobs: []
  };
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeInvoiceMode(value) {
  return String(value || "").trim().toLowerCase() === "warehousing" ? "warehousing" : DEFAULT_INVOICE_MODE;
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeGroupValue(value) {
  return normalizeSearchValue(value).replace(/\.0+$/, "").replace(/\s+/g, " ");
}

function normalizeLotCodeValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeLookupKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\.0+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeItemCode(value) {
  return normalizeLookupKey(value);
}

function normalizeWarehouseRateInput(value, fallback) {
  var text = String(value == null ? "" : value).trim();
  if (!text) return fallback;
  var numeric = safeNum(text);
  if (!(numeric >= 0)) return fallback;
  return numeric.toFixed(2);
}

function createDefaultWarehouseFeeDraft(overrides) {
  var source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    included: source.included !== false,
    inboundRate: normalizeWarehouseRateInput(source.inboundRate, DEFAULT_WAREHOUSE_RATE_DRAFT.inboundRate),
    outboundRate: normalizeWarehouseRateInput(source.outboundRate, DEFAULT_WAREHOUSE_RATE_DRAFT.outboundRate),
    storageRate: normalizeWarehouseRateInput(source.storageRate, DEFAULT_WAREHOUSE_RATE_DRAFT.storageRate),
    note: String(source.note || "")
  };
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

function formatUnits(value) {
  var amount = safeNum(value);
  if (!Number.isFinite(amount)) return "--";
  if (Math.abs(amount - Math.round(amount)) < 0.0001) return Math.round(amount).toLocaleString();
  return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function formatDateLabel(value) {
  var raw = String(value || "").trim();
  if (!raw) return "--";
  var parsed = new Date(raw + "T00:00:00");
  if (isNaN(parsed)) return raw;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatMoney(value) {
  return moneyFormatter.format(safeNum(value));
}

function formatDateTimeLabel(value) {
  var raw = String(value || "").trim();
  if (!raw) return "--";
  var parsed = new Date(raw);
  if (isNaN(parsed)) return raw;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function csvCell(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function toEasternDateKey(date) {
  var d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(d).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function parseNamedMonthDate(raw) {
  var match = String(raw || "").trim().match(
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i
  );
  if (!match) return "";
  var year = parseInt(match[1], 10);
  var monthIndex = MONTH_INDEX[String(match[2] || "").toLowerCase()];
  var day = parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) return "";
  return (
    String(year).padStart(4, "0") +
    "-" +
    String(monthIndex + 1).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function parseSlashDate(raw) {
  var match = String(raw || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";
  var month = parseInt(match[1], 10);
  var day = parseInt(match[2], 10);
  var year = parseInt(match[3], 10);
  if (year < 100) year += 2000;
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return "";
  return (
    String(year).padStart(4, "0") +
    "-" +
    String(month).padStart(2, "0") +
    "-" +
    String(day).padStart(2, "0")
  );
}

function resolveProducedDateKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var namedMonth = parseNamedMonthDate(raw);
  if (namedMonth) return namedMonth;
  var slashDate = parseSlashDate(raw);
  if (slashDate) return slashDate;
  return toEasternDateKey(raw);
}

function todayEtDateKey() {
  return toEasternDateKey(new Date());
}

function monthEndDateKey(year, monthOneBased) {
  var endDate = new Date(Date.UTC(year, monthOneBased, 0));
  return (
    String(endDate.getUTCFullYear()).padStart(4, "0") +
    "-" +
    String(endDate.getUTCMonth() + 1).padStart(2, "0") +
    "-" +
    String(endDate.getUTCDate()).padStart(2, "0")
  );
}

function defaultInvoicingRange() {
  var todayEt = todayEtDateKey();
  if (!todayEt) return { start: "", end: "" };
  return {
    start: todayEt.slice(0, 7) + "-01",
    end: todayEt
  };
}

function lastMonthRange() {
  var todayEt = todayEtDateKey();
  if (!todayEt) return { start: "", end: "" };
  var year = Number(todayEt.slice(0, 4));
  var month = Number(todayEt.slice(5, 7));
  if (!year || !month) return { start: "", end: "" };
  var prevMonth = month === 1 ? 12 : month - 1;
  var prevYear = month === 1 ? year - 1 : year;
  return {
    start: String(prevYear).padStart(4, "0") + "-" + String(prevMonth).padStart(2, "0") + "-01",
    end: monthEndDateKey(prevYear, prevMonth)
  };
}

function sanitizeIsoDateKey(value) {
  var raw = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function resolveInitialBillingWindow(initialFilters, defaults) {
  var fallbackStart = sanitizeIsoDateKey(defaults && defaults.start);
  var fallbackEnd = sanitizeIsoDateKey(defaults && defaults.end);
  var start = sanitizeIsoDateKey(initialFilters && initialFilters.start);
  var end = sanitizeIsoDateKey(initialFilters && initialFilters.end);
  if (start && end && end >= start) {
    return {
      start: start,
      end: end
    };
  }
  return {
    start: fallbackStart,
    end: fallbackEnd
  };
}

function updateMinDate(current, next) {
  if (!next) return current || "";
  if (!current || next < current) return next;
  return current;
}

function updateMaxDate(current, next) {
  if (!next) return current || "";
  if (!current || next > current) return next;
  return current;
}

function buildCandidateRateKey(value) {
  var amount = safeNum(value);
  return amount > 0 ? amount.toFixed(4) : "missing";
}

function buildCandidateExportKey(candidate) {
  var source = candidate && typeof candidate === "object" ? candidate : {};
  var key = String(source.key || "").trim() || "candidate";
  var firstProducedDate = String(source.firstProducedDate || "").slice(0, 10) || "--";
  var lastProducedDate = String(source.lastProducedDate || "").slice(0, 10) || "--";
  var unitsProduced = safeNum(source.unitsProduced).toFixed(4);
  var revenuePerUnit = safeNum(source.revenuePerUnitAvg != null ? source.revenuePerUnitAvg : source.revenuePerUnit).toFixed(4);
  var estimatedRevenue = safeNum(source.estimatedRevenue).toFixed(2);
  var detailRows = String(Math.max(0, Math.round(safeNum(source.detailRows != null ? source.detailRows : source.lineCount))));
  return [
    key,
    firstProducedDate,
    lastProducedDate,
    unitsProduced,
    revenuePerUnit,
    estimatedRevenue,
    detailRows
  ].join("|");
}

function setToArray(setValue) {
  return Array.from(setValue || []).filter(Boolean);
}

function pluralize(count, singular, plural) {
  return count === 1 ? singular : (plural || (singular + "s"));
}

function candidateStatusMeta(status) {
  if (status === "review") return { label: "Review", variant: "warning" };
  return { label: "Ready", variant: "success" };
}

function quickBooksStateMeta(state) {
  if (state === "already_pushed") return { label: "Already Pushed", variant: "warning" };
  if (state === "missing_mapping") return { label: "Missing QBO Mapping", variant: "warning" };
  return null;
}

function candidateCanPreviewQuickBooks(candidate) {
  if (!candidate || candidate.status !== "ready") return false;
  if (candidate.quickBooksState === "already_pushed") return false;
  if (candidate.quickBooksState === "missing_mapping") return false;
  return true;
}

function revenueSourceMeta(source) {
  if (source === "pricing") return { label: "Pricing", variant: "success" };
  if (source === "item_master_cost_per_unit") return { label: "Item Master Fallback", variant: "info" };
  if (source === "mixed") return { label: "Mixed Sources", variant: "warning" };
  return { label: "Missing", variant: "danger" };
}

function createDefaultCandidateColumnFilters() {
  return {
    status: "all",
    customerSku: "",
    minUnits: "",
    minRevenuePerUnit: "",
    minEstimatedRevenue: "",
    unitOfMeasure: "",
    lotCode: "",
    workOrder: "",
    purchaseOrder: "",
    minJobs: "",
    period: ""
  };
}

function defaultCandidateSortDirForField(field) {
  if (field === "unitsProduced" || field === "revenuePerUnitAvg" || field === "estimatedRevenue" || field === "jobCount") return "desc";
  if (field === "period") return "desc";
  return "asc";
}

function statusSortRank(status) {
  if (status === "review") return 0;
  if (status === "ready") return 1;
  return 2;
}

function compareTextValues(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base", numeric: true });
}

function compareNumberValues(left, right) {
  var a = safeNum(left);
  var b = safeNum(right);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function parseFilterThreshold(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var cleaned = raw.replace(/[$,%\s,]/g, "");
  if (!cleaned) return null;
  var parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function candidatePeriodSearchValue(candidate) {
  return [
    candidate && candidate.firstProducedDate,
    candidate && candidate.lastProducedDate,
    formatDateLabel(candidate && candidate.firstProducedDate),
    formatDateLabel(candidate && candidate.lastProducedDate)
  ].join(" ");
}

function candidateMatchesColumnFilters(candidate, filters) {
  var applied = filters || createDefaultCandidateColumnFilters();
  var statusFilter = String(applied.status || "all");
  var customerSkuFilter = normalizeSearchValue(applied.customerSku);
  var unitOfMeasureFilter = normalizeSearchValue(applied.unitOfMeasure);
  var lotCodeFilter = normalizeSearchValue(applied.lotCode);
  var workOrderFilter = normalizeSearchValue(applied.workOrder);
  var purchaseOrderFilter = normalizeSearchValue(applied.purchaseOrder);
  var periodFilter = normalizeSearchValue(applied.period);
  var minUnits = parseFilterThreshold(applied.minUnits);
  var minRevenuePerUnit = parseFilterThreshold(applied.minRevenuePerUnit);
  var minEstimatedRevenue = parseFilterThreshold(applied.minEstimatedRevenue);
  var minJobs = parseFilterThreshold(applied.minJobs);

  if (statusFilter !== "all" && candidate.status !== statusFilter) return false;
  if (customerSkuFilter) {
    var customerSkuValue = normalizeSearchValue((candidate.customer || "") + " " + (candidate.sku || "") + " " + (candidate.description || ""));
    if (customerSkuValue.indexOf(customerSkuFilter) === -1) return false;
  }
  if (minUnits != null && safeNum(candidate.unitsProduced) < minUnits) return false;
  if (minRevenuePerUnit != null && safeNum(candidate.revenuePerUnitAvg) < minRevenuePerUnit) return false;
  if (minEstimatedRevenue != null && safeNum(candidate.estimatedRevenue) < minEstimatedRevenue) return false;
  if (unitOfMeasureFilter && normalizeSearchValue(candidate.unitOfMeasure).indexOf(unitOfMeasureFilter) === -1) return false;
  if (lotCodeFilter && normalizeSearchValue(candidate.lotCode).indexOf(lotCodeFilter) === -1) return false;
  if (workOrderFilter && normalizeSearchValue(candidate.workOrderReference).indexOf(workOrderFilter) === -1) return false;
  if (purchaseOrderFilter && normalizeSearchValue(candidate.purchaseOrderReference).indexOf(purchaseOrderFilter) === -1) return false;
  if (minJobs != null && safeNum(candidate.jobCount) < minJobs) return false;
  if (periodFilter && normalizeSearchValue(candidatePeriodSearchValue(candidate)).indexOf(periodFilter) === -1) return false;
  return true;
}

function sortInvoiceCandidates(rows, sortField, sortDir) {
  var dir = sortDir === "desc" ? -1 : 1;
  return rows.slice().sort(function(left, right) {
    var comparison = 0;

    if (sortField === "customerSku") {
      comparison = compareTextValues(left.customer, right.customer);
      if (!comparison) comparison = compareTextValues(left.sku, right.sku);
    } else if (sortField === "unitsProduced") {
      comparison = compareNumberValues(left.unitsProduced, right.unitsProduced);
    } else if (sortField === "revenuePerUnitAvg") {
      comparison = compareNumberValues(left.revenuePerUnitAvg, right.revenuePerUnitAvg);
    } else if (sortField === "estimatedRevenue") {
      comparison = compareNumberValues(left.estimatedRevenue, right.estimatedRevenue);
    } else if (sortField === "unitOfMeasure") {
      comparison = compareTextValues(left.unitOfMeasure, right.unitOfMeasure);
    } else if (sortField === "lotCode") {
      comparison = compareTextValues(left.lotCode, right.lotCode);
    } else if (sortField === "workOrderReference") {
      comparison = compareTextValues(left.workOrderReference, right.workOrderReference);
    } else if (sortField === "purchaseOrderReference") {
      comparison = compareTextValues(left.purchaseOrderReference, right.purchaseOrderReference);
    } else if (sortField === "jobCount") {
      comparison = compareNumberValues(left.jobCount, right.jobCount);
    } else if (sortField === "period") {
      comparison = compareTextValues(left.firstProducedDate, right.firstProducedDate);
      if (!comparison) comparison = compareTextValues(left.lastProducedDate, right.lastProducedDate);
    } else {
      comparison = compareNumberValues(statusSortRank(left.status), statusSortRank(right.status));
    }

    if (comparison) return comparison * dir;
    if (right.unitsProduced !== left.unitsProduced) return right.unitsProduced - left.unitsProduced;
    comparison = compareTextValues(left.customer, right.customer);
    if (comparison) return comparison;
    comparison = compareTextValues(left.purchaseOrderReference, right.purchaseOrderReference);
    if (comparison) return comparison;
    comparison = compareTextValues(left.sku, right.sku);
    if (comparison) return comparison;
    comparison = compareTextValues(left.lotCode, right.lotCode);
    if (comparison) return comparison;
    comparison = compareNumberValues(left.revenuePerUnitAvg, right.revenuePerUnitAvg);
    if (comparison) return comparison;
    comparison = compareTextValues(left.workOrderReference, right.workOrderReference);
    if (comparison) return comparison;
    return 0;
  });
}

async function fetchJsonWithCredentials(url) {
  var response = await fetch(url, { credentials: "include" });
  var body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  return { response: response, body: body };
}

async function postJsonWithCredentials(url, body) {
  var response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  var responseBody = {};
  try {
    responseBody = await response.json();
  } catch (_error) {
    responseBody = {};
  }
  return { response: response, body: responseBody };
}

function normalizeRevenueConfigPayload(body) {
  return {
    skuTargets: body && Array.isArray(body.skuTargets) ? body.skuTargets : [],
    itemMasterCostBySku: body && body.itemMasterCostBySku && typeof body.itemMasterCostBySku === "object"
      ? body.itemMasterCostBySku
      : {}
  };
}

function normalizeCoverageAuditPayload(body) {
  var defaults = createDefaultCoverageAudit();
  var source = body && typeof body === "object" ? body : {};
  return {
    totalRows: Number(source.totalRows || defaults.totalRows),
    rowsWithLotCode: Number(source.rowsWithLotCode || defaults.rowsWithLotCode),
    rowsMissingLotCode: Number(source.rowsMissingLotCode || defaults.rowsMissingLotCode),
    lotCoveragePct: Number(source.lotCoveragePct == null ? defaults.lotCoveragePct : source.lotCoveragePct),
    rowsWithUnitOfMeasure: Number(source.rowsWithUnitOfMeasure || defaults.rowsWithUnitOfMeasure),
    rowsMissingUnitOfMeasure: Number(source.rowsMissingUnitOfMeasure || defaults.rowsMissingUnitOfMeasure),
    unitOfMeasureCoveragePct: Number(source.unitOfMeasureCoveragePct == null ? defaults.unitOfMeasureCoveragePct : source.unitOfMeasureCoveragePct),
    rowsMissingBoth: Number(source.rowsMissingBoth || defaults.rowsMissingBoth),
    rowsFullyCovered: Number(source.rowsFullyCovered || defaults.rowsFullyCovered),
    fullyCoveredPct: Number(source.fullyCoveredPct == null ? defaults.fullyCoveredPct : source.fullyCoveredPct),
    topMissingDates: source && Array.isArray(source.topMissingDates) ? source.topMissingDates : defaults.topMissingDates,
    topMissingWorkOrders: source && Array.isArray(source.topMissingWorkOrders) ? source.topMissingWorkOrders : defaults.topMissingWorkOrders,
    topMissingSkus: source && Array.isArray(source.topMissingSkus) ? source.topMissingSkus : defaults.topMissingSkus,
    topMissingJobs: source && Array.isArray(source.topMissingJobs) ? source.topMissingJobs : defaults.topMissingJobs
  };
}

function formatCoverageHotspots(rows, kind) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 3)
    .map(function(row) {
      var label = row && row.label ? row.label : "--";
      if (kind === "date") label = formatDateLabel(label);
      return label + " (" + Number(row && row.missingLotRows || 0).toLocaleString() + " lot, " + Number(row && row.missingUnitOfMeasureRows || 0).toLocaleString() + " UOM)";
    })
    .join("; ");
}

async function fetchInvoicingRevenueConfig() {
  var result = await fetchJsonWithCredentials("/api/ops/config");
  return normalizeRevenueConfigPayload(result.response.ok ? result.body : {});
}

function normalizeInvoicingProductionPayload(body) {
  return {
    rows: body && Array.isArray(body.rows) ? body.rows : [],
    rowCount: Number(body && body.rowCount || 0),
    querySource: String(body && body.querySource || ""),
    latestSyncedAt: String(body && body.latestSyncedAt || ""),
    coverageAudit: normalizeCoverageAuditPayload(body && body.coverageAudit),
    availableDateRange: {
      min: String(body && body.availableDateRange && body.availableDateRange.min || ""),
      max: String(body && body.availableDateRange && body.availableDateRange.max || "")
    }
  };
}

async function fetchInvoicingProductionHistory(startDate, endDate) {
  var url = "/api/ops/invoicing-production?start=" + encodeURIComponent(startDate) + "&end=" + encodeURIComponent(endDate);
  var result = await fetchJsonWithCredentials(url);
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not load invoicing production history");
  }
  return normalizeInvoicingProductionPayload(result.body);
}

async function fetchQuickBooksInvoicePreview(payload) {
  var result = await postJsonWithCredentials("/api/accounting/qbo/preview-invoices", payload);
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not build QuickBooks invoice preview");
  }
  return result.body && typeof result.body === "object" ? result.body : {};
}

async function createQuickBooksInvoices(payload) {
  var result = await postJsonWithCredentials("/api/accounting/qbo/create-invoices", payload);
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not create QuickBooks invoices");
  }
  return result.body && typeof result.body === "object" ? result.body : {};
}

function normalizeQuickBooksPersistencePayload(body) {
  var source = body && typeof body === "object" ? body : {};
  var summary = source.summary && typeof source.summary === "object" ? source.summary : {};
  return {
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    tablesReady: source.tablesReady !== false,
    mappingTableReady: source.mappingTableReady !== false,
    exportTableReady: source.exportTableReady !== false,
    summary: {
      candidateCount: Number(summary.candidateCount || 0),
      exportReadyCount: Number(summary.exportReadyCount || 0),
      alreadyPushedCount: Number(summary.alreadyPushedCount || 0),
      missingCustomerMappings: Number(summary.missingCustomerMappings || 0),
      missingItemMappings: Number(summary.missingItemMappings || 0)
    },
    candidateStates: source.candidateStates && typeof source.candidateStates === "object" ? source.candidateStates : {}
  };
}

async function fetchQuickBooksPersistenceState(payload) {
  var result = await postJsonWithCredentials("/api/accounting/qbo/export-state", payload);
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not load QuickBooks export state");
  }
  return normalizeQuickBooksPersistencePayload(result.body);
}

function normalizeQuickBooksConnectionPayload(body) {
  var source = body && typeof body === "object" ? body : {};
  var connection = source.connection && typeof source.connection === "object" ? source.connection : {};
  var summary = connection.summary && typeof connection.summary === "object" ? connection.summary : {};
  return {
    configured: source.configured !== false,
    connected: !!source.connected,
    warnings: Array.isArray(source.warnings) ? source.warnings : [],
    connection: {
      status: String(connection.status || "disconnected"),
      environment: String(connection.environment || "production"),
      realmId: String(connection.realmId || ""),
      companyName: String(connection.companyName || ""),
      lastSyncedAt: String(connection.lastSyncedAt || ""),
      lastSyncStatus: String(connection.lastSyncStatus || ""),
      accessTokenExpiresAt: String(connection.accessTokenExpiresAt || ""),
      refreshTokenExpiresAt: String(connection.refreshTokenExpiresAt || ""),
      scopes: Array.isArray(connection.scopes) ? connection.scopes : [],
      summary: {
        customerCatalogCount: Number(summary.customerCatalogCount || 0),
        itemCatalogCount: Number(summary.itemCatalogCount || 0),
        termCatalogCount: Number(summary.termCatalogCount || 0),
        customerMappingsCreated: Number(summary.customerMappingsCreated || 0),
        customerMappingsUpdated: Number(summary.customerMappingsUpdated || 0),
        customerMappingsUnresolved: Number(summary.customerMappingsUnresolved || 0),
        itemMappingsCreated: Number(summary.itemMappingsCreated || 0),
        itemMappingsUpdated: Number(summary.itemMappingsUpdated || 0),
        itemMappingsUnresolved: Number(summary.itemMappingsUnresolved || 0),
        termMappingsCreated: Number(summary.termMappingsCreated || 0),
        termMappingsUpdated: Number(summary.termMappingsUpdated || 0),
        termMappingsUnresolved: Number(summary.termMappingsUnresolved || 0),
        preservedMappings: Number(summary.preservedMappings || 0),
        unresolvedCustomers: Array.isArray(summary.unresolvedCustomers) ? summary.unresolvedCustomers : [],
        unresolvedItems: Array.isArray(summary.unresolvedItems) ? summary.unresolvedItems : [],
        unresolvedTerms: Array.isArray(summary.unresolvedTerms) ? summary.unresolvedTerms : []
      }
    }
  };
}

async function fetchQuickBooksConnectionStatus() {
  var result = await fetchJsonWithCredentials("/api/accounting/qbo/connection-status");
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not load QuickBooks connection status");
  }
  return normalizeQuickBooksConnectionPayload(result.body);
}

async function syncQuickBooksMasterData() {
  var result = await postJsonWithCredentials("/api/accounting/qbo/sync-master-data", {});
  if (!result.response.ok) {
    throw new Error((result.body && (result.body.error || result.body.details)) || "Could not sync QuickBooks master data");
  }
  return result.body && typeof result.body === "object" ? result.body : {};
}

function readQuickBooksNoticeFromLocation() {
  if (typeof window === "undefined") return { tone: "", message: "" };
  var params = new URLSearchParams(window.location.search || "");
  var status = String(params.get("qbo_status") || "").trim().toLowerCase();
  var message = String(params.get("qbo_message") || "").trim();
  return !status && !message ? { tone: "", message: "" } : {
    tone: status === "connected" ? "success" : "warning",
    message: message || (status === "connected" ? "QuickBooks connected." : "QuickBooks update received.")
  };
}

function clearQuickBooksNoticeFromLocation() {
  if (typeof window === "undefined") return;
  var params = new URLSearchParams(window.location.search || "");
  if (!params.has("qbo_status") && !params.has("qbo_message")) return;
  params.delete("qbo_status");
  params.delete("qbo_message");
  var nextUrl = window.location.pathname + (params.toString() ? ("?" + params.toString()) : "");
  window.history.replaceState(null, "", nextUrl);
}

function buildRevenueTargetsBySku(rows) {
  var map = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var sku = normalizeItemCode((row && (row.item_code || row.sku || row.code)) || "");
    if (!sku) return;
    if (!map[sku]) map[sku] = [];
    map[sku].push({
      customer: String(row && row.customer || "").trim(),
      revenue_per_case: safeNum(row && row.revenue_per_case),
      active_from: String(row && row.active_from || "").slice(0, 10),
      active_to: String(row && row.active_to || "").slice(0, 10)
    });
  });
  Object.keys(map).forEach(function(sku) {
    map[sku].sort(function(left, right) {
      if (!!left.customer !== !!right.customer) return left.customer ? 1 : -1;
      return String(right.active_from || "").localeCompare(String(left.active_from || ""));
    });
  });
  return map;
}

function resolveRevenuePerUnit(itemCode, dateIso, revenueTargetsBySku, itemMasterCostBySku) {
  var sku = normalizeItemCode(itemCode);
  if (!sku) return { value: 0, source: "missing" };
  var pricingRows = revenueTargetsBySku[sku] || [];
  var day = String(dateIso || "").slice(0, 10);
  var best = 0;
  for (var i = 0; i < pricingRows.length; i += 1) {
    var row = pricingRows[i];
    if (!(safeNum(row.revenue_per_case) > 0)) continue;
    var start = String(row.active_from || "1900-01-01");
    var end = String(row.active_to || "9999-12-31");
    if (day && day < start) continue;
    if (day && day > end) continue;
    if (safeNum(row.revenue_per_case) > best) best = safeNum(row.revenue_per_case);
  }
  if (best > 0) return { value: best, source: "pricing" };
  var itemMasterValue = safeNum(itemMasterCostBySku && itemMasterCostBySku[sku]);
  if (itemMasterValue > 0) return { value: itemMasterValue, source: "item_master_cost_per_unit" };
  return { value: 0, source: "missing" };
}

function buildSearchHaystack(row) {
  return [
    row.customer,
    row.sku,
    row.description,
    row.lotCode,
    row.workOrderCode,
    row.workOrderId,
    row.purchaseOrderNumber,
    row.jobId,
    row.line,
    row.reference1
  ].join(" ").toLowerCase();
}

function createCountIndex() {
  return {};
}

function addIndexedValue(index, key, value) {
  var normalizedKey = normalizeLookupKey(key);
  var normalizedValue = String(value || "").trim();
  if (!normalizedKey || !normalizedValue) return;
  if (!index[normalizedKey]) index[normalizedKey] = {};
  index[normalizedKey][normalizedValue] = (index[normalizedKey][normalizedValue] || 0) + 1;
}

function pickIndexedValue(index, key, allowAmbiguous) {
  var bucket = index[normalizeLookupKey(key)] || null;
  if (!bucket) return "";
  var values = Object.keys(bucket);
  if (!values.length) return "";
  values.sort(function(left, right) {
    if (bucket[right] !== bucket[left]) return bucket[right] - bucket[left];
    return left.localeCompare(right);
  });
  if (!allowAmbiguous && values.length > 1 && bucket[values[0]] === bucket[values[1]]) return "";
  return values[0] || "";
}

function buildWorkOrderFallbacks(workOrders) {
  var customerByWorkOrder = createCountIndex();
  var customerBySku = createCountIndex();
  var unitByWorkOrder = createCountIndex();
  var unitBySku = createCountIndex();
  var fixedLotByWorkOrder = createCountIndex();

  (Array.isArray(workOrders) ? workOrders : []).forEach(function(row) {
    var workOrderCode = String(pickFieldLoose(row, [
      "Work Order Code", "work_order_code",
      "project_code", "Project Code"
    ]) || "").trim();
    var workOrderId = String(pickFieldLoose(row, [
      "Work Order ID", "work_order_id",
      "Work Order", "work_order"
    ]) || "").trim();
    var sku = String(pickFieldLoose(row, [
      "Item Code", "item_code",
      "SKU", "sku"
    ]) || "").trim();
    var customer = String(pickFieldLoose(row, [
      "Customer Name", "customer_name",
      "Customer", "customer"
    ]) || "").trim();
    var unitOfMeasure = String(pickFieldLoose(row, [
      "Unit of Measure", "unit_of_measure",
      "Unit Of Measure", "uom"
    ]) || "").trim();
    var fixedLotCode = String(pickFieldLoose(row, [
      "Fixed Lot Code", "fixed_lot_code",
      "Fixed lot code"
    ]) || "").trim();
    fixedLotCode = normalizeLotCodeValue(fixedLotCode);
    addIndexedValue(customerByWorkOrder, workOrderCode, customer);
    addIndexedValue(customerByWorkOrder, workOrderId, customer);
    addIndexedValue(unitByWorkOrder, workOrderCode, unitOfMeasure);
    addIndexedValue(unitByWorkOrder, workOrderId, unitOfMeasure);
    addIndexedValue(fixedLotByWorkOrder, workOrderCode, fixedLotCode);
    addIndexedValue(fixedLotByWorkOrder, workOrderId, fixedLotCode);
    addIndexedValue(customerBySku, sku, customer);
    addIndexedValue(unitBySku, sku, unitOfMeasure);
  });

  return {
    customerByWorkOrder: customerByWorkOrder,
    customerBySku: customerBySku,
    unitByWorkOrder: unitByWorkOrder,
    unitBySku: unitBySku,
    fixedLotByWorkOrder: fixedLotByWorkOrder
  };
}

function pickStrictIndexedValue(index, key) {
  if (!index) return "";
  var bucket = index[normalizeLookupKey(key)] || null;
  if (!bucket) return "";
  var values = Object.keys(bucket).filter(Boolean);
  return values.length === 1 ? values[0] : "";
}

function buildLotFallbackKey(parts) {
  return (Array.isArray(parts) ? parts : []).map(function(part) {
    return String(part || "").trim();
  }).join("|");
}

function buildProductionLotFallbacks(rows, workOrders) {
  var lotByJobSkuDateLine = createCountIndex();
  var lotByJobSkuDate = createCountIndex();
  var lotByJobSku = createCountIndex();
  var lotByWorkOrderSkuDateLine = createCountIndex();
  var lotByWorkOrderSkuDate = createCountIndex();
  var lotByWorkOrderSku = createCountIndex();
  var fixedLotByWorkOrder = createCountIndex();

  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var lotCode = String(pickFieldLoose(row, [
      "Lot Code", "Lot code", "lot_code",
      "Finished Good Lot Code", "finished_good_lot_code"
    ]) || "").trim();
    lotCode = normalizeLotCodeValue(lotCode);
    if (!lotCode) return;

    var jobId = String(pickFieldLoose(row, [
      "Job", "job_id",
      "Job ID"
    ]) || "").trim();
    var sku = String(pickFieldLoose(row, [
      "Item Code", "Item code", "item_code",
      "SKU", "sku",
      "finished_good_item_code"
    ]) || "").trim();
    var producedRaw = pickFieldLoose(row, [
      "Produced Date ET", "produced_date_et",
      "Produced date", "produced_date",
      "Produced At", "produced_at",
      "produced_at_utc",
      "Actual Job end date", "actual_job_end_at"
    ]);
    var producedDate = resolveProducedDateKey(producedRaw);
    var line = String(pickFieldLoose(row, [
      "Line", "line",
      "line_name", "Line Name"
    ]) || "").trim();
    var workOrderCode = String(pickFieldLoose(row, [
      "Work Order Code", "Work Order code", "work_order_code",
      "project_code", "Project Code"
    ]) || "").trim();
    var workOrderId = String(pickFieldLoose(row, [
      "Work Order", "work_order",
      "Work Order ID", "work_order_id"
    ]) || "").trim();

    addIndexedValue(lotByJobSkuDateLine, buildLotFallbackKey([jobId, sku, producedDate, line]), lotCode);
    addIndexedValue(lotByJobSkuDate, buildLotFallbackKey([jobId, sku, producedDate]), lotCode);
    addIndexedValue(lotByJobSku, buildLotFallbackKey([jobId, sku]), lotCode);
    addIndexedValue(lotByWorkOrderSkuDateLine, buildLotFallbackKey([workOrderCode, sku, producedDate, line]), lotCode);
    addIndexedValue(lotByWorkOrderSkuDateLine, buildLotFallbackKey([workOrderId, sku, producedDate, line]), lotCode);
    addIndexedValue(lotByWorkOrderSkuDate, buildLotFallbackKey([workOrderCode, sku, producedDate]), lotCode);
    addIndexedValue(lotByWorkOrderSkuDate, buildLotFallbackKey([workOrderId, sku, producedDate]), lotCode);
    addIndexedValue(lotByWorkOrderSku, buildLotFallbackKey([workOrderCode, sku]), lotCode);
    addIndexedValue(lotByWorkOrderSku, buildLotFallbackKey([workOrderId, sku]), lotCode);
  });

  (Array.isArray(workOrders) ? workOrders : []).forEach(function(row) {
    var workOrderCode = String(pickFieldLoose(row, [
      "Work Order Code", "work_order_code",
      "project_code", "Project Code"
    ]) || "").trim();
    var workOrderId = String(pickFieldLoose(row, [
      "Work Order ID", "work_order_id",
      "Work Order", "work_order"
    ]) || "").trim();
    var fixedLotCode = String(pickFieldLoose(row, [
      "Fixed Lot Code", "fixed_lot_code",
      "Fixed lot code"
    ]) || "").trim();
    fixedLotCode = normalizeLotCodeValue(fixedLotCode);
    addIndexedValue(fixedLotByWorkOrder, workOrderCode, fixedLotCode);
    addIndexedValue(fixedLotByWorkOrder, workOrderId, fixedLotCode);
  });

  return {
    lotByJobSkuDateLine: lotByJobSkuDateLine,
    lotByJobSkuDate: lotByJobSkuDate,
    lotByJobSku: lotByJobSku,
    lotByWorkOrderSkuDateLine: lotByWorkOrderSkuDateLine,
    lotByWorkOrderSkuDate: lotByWorkOrderSkuDate,
    lotByWorkOrderSku: lotByWorkOrderSku,
    fixedLotByWorkOrder: fixedLotByWorkOrder
  };
}

function resolveLotCodeFallback(row, fallbacks) {
  if (!row || !fallbacks) return "";
  var sku = row.itemCodeRaw || row.sku || "";
  var producedDate = row.producedDate || "";
  var line = row.line && row.line !== "--" ? row.line : "";
  var workOrderCode = row.workOrderCode || "";
  var workOrderId = row.workOrderId || "";
  var jobId = row.jobId || "";
  var keys = [
    buildLotFallbackKey([jobId, sku, producedDate, line]),
    buildLotFallbackKey([jobId, sku, producedDate]),
    buildLotFallbackKey([jobId, sku]),
    buildLotFallbackKey([workOrderCode, sku, producedDate, line]),
    buildLotFallbackKey([workOrderId, sku, producedDate, line]),
    buildLotFallbackKey([workOrderCode, sku, producedDate]),
    buildLotFallbackKey([workOrderId, sku, producedDate]),
    buildLotFallbackKey([workOrderCode, sku]),
    buildLotFallbackKey([workOrderId, sku])
  ];

  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (!key) continue;
    var strictMatch =
      pickStrictIndexedValue(fallbacks.lotByJobSkuDateLine, key) ||
      pickStrictIndexedValue(fallbacks.lotByJobSkuDate, key) ||
      pickStrictIndexedValue(fallbacks.lotByJobSku, key) ||
      pickStrictIndexedValue(fallbacks.lotByWorkOrderSkuDateLine, key) ||
      pickStrictIndexedValue(fallbacks.lotByWorkOrderSkuDate, key) ||
      pickStrictIndexedValue(fallbacks.lotByWorkOrderSku, key);
    if (strictMatch) return strictMatch;
  }

  return (
    pickStrictIndexedValue(fallbacks.fixedLotByWorkOrder, workOrderCode) ||
    pickStrictIndexedValue(fallbacks.fixedLotByWorkOrder, workOrderId) ||
    ""
  );
}

function buildItemMasterCustomerIndex(itemMaster) {
  var customerBySku = createCountIndex();
  (Array.isArray(itemMaster) ? itemMaster : []).forEach(function(row) {
    var sku = String(pickFieldLoose(row, [
      "Item Code", "item_code",
      "Code", "code"
    ]) || "").trim();
    var customer = String(pickFieldLoose(row, [
      "Customer Name", "customer_name",
      "Customer", "customer"
    ]) || "").trim();
    addIndexedValue(customerBySku, sku, customer);
  });
  return customerBySku;
}

function buildNormalizedProductionRow(row, index, fallbacks) {
  var customer = String(pickFieldLoose(row, [
    "Customer Name", "Customer name", "customer_name",
    "Customer", "customer",
    "item_customer_name", "item_customer",
    "project_customer"
  ]) || "").trim();
  var sku = String(pickFieldLoose(row, [
    "Item code", "item_code",
    "SKU", "sku",
    "finished_good_item_code"
  ]) || "").trim();
  var description = String(pickFieldLoose(row, [
    "Item description", "item_description",
    "Description", "description"
  ]) || "").trim();
  var producedRaw = pickFieldLoose(row, [
    "Produced Date ET", "produced_date_et",
    "Produced date", "produced_date",
    "Produced At", "produced_at",
    "produced_at_utc",
    "Actual Job end date", "actual_job_end_at"
  ]);
  var producedDate = resolveProducedDateKey(producedRaw);
  var unitsProduced = safeNum(pickFieldLoose(row, [
    "Units produced", "units_produced",
    "Quantity Produced", "quantity_produced",
    "Produced Units"
  ]));
  var workOrderCode = String(pickFieldLoose(row, [
    "Work Order Code", "Work Order code", "work_order_code",
    "project_code", "Project Code"
  ]) || "").trim();
  var workOrderId = String(pickFieldLoose(row, [
    "Work Order", "work_order",
    "Work Order ID", "work_order_id"
  ]) || "").trim();
  var purchaseOrderNumber = String(pickFieldLoose(row, [
    "Purchase Order Number", "Purchase Order number", "purchase_order_number",
    "PO Number", "po_number"
  ]) || "").trim();
  var jobId = String(pickFieldLoose(row, [
    "Job", "job_id",
    "Job ID"
  ]) || "").trim();
  var lotCode = String(pickFieldLoose(row, [
    "Lot Code", "Lot code", "lot_code",
    "Finished Good Lot Code", "finished_good_lot_code"
  ]) || "").trim();
  lotCode = normalizeLotCodeValue(lotCode);
  var line = String(pickFieldLoose(row, [
    "Line", "line",
    "line_name", "Line Name"
  ]) || "").trim();
  var unitOfMeasure = String(pickFieldLoose(row, [
    "Unit of Measure", "Unit of measure", "unit_of_measure",
    "Unit Of Measure", "uom"
  ]) || "").trim();
  var reference1 = String(pickFieldLoose(row, [
    "Reference 1", "reference_1",
    "Work Order Reference 1", "Work Order reference 1", "work_order_reference_1"
  ]) || "").trim();
  var fallbackCustomer = customer ||
    pickIndexedValue(fallbacks && fallbacks.customerByWorkOrder, workOrderCode || workOrderId, true) ||
    pickIndexedValue(fallbacks && fallbacks.itemMasterCustomerBySku, sku, false) ||
    pickIndexedValue(fallbacks && fallbacks.customerBySku, sku, false);
  var fallbackUnitOfMeasure = unitOfMeasure ||
    pickIndexedValue(fallbacks && fallbacks.unitByWorkOrder, workOrderCode || workOrderId, true) ||
    pickIndexedValue(fallbacks && fallbacks.unitBySku, sku, false);
  var fallbackLotCode = lotCode || resolveLotCodeFallback({
    itemCodeRaw: sku,
    producedDate: producedDate,
    workOrderCode: workOrderCode,
    workOrderId: workOrderId,
    jobId: jobId,
    line: line
  }, fallbacks);
  fallbackLotCode = normalizeLotCodeValue(fallbackLotCode);
  var customerLabel = customer || "Unassigned customer";
  if (fallbackCustomer) customerLabel = fallbackCustomer;
  var skuLabel = sku || "Missing SKU";
  var workOrderReference = workOrderCode || workOrderId;
  var rowIssues = [];
  if (!fallbackCustomer) rowIssues.push("Missing customer");
  if (!sku) rowIssues.push("Missing SKU");
  if (!producedDate) rowIssues.push("Missing produced date");
  if (!(unitsProduced > 0)) rowIssues.push("No produced quantity");
  if (!fallbackUnitOfMeasure) rowIssues.push("Missing unit of measure");
  if (!fallbackLotCode) rowIssues.push("Missing finished good lot code");
  if (!workOrderCode && !workOrderId) rowIssues.push("Missing work order");
  return {
    raw: row,
    rowIndex: index,
    itemCodeRaw: sku,
    customer: customerLabel,
    customerKey: normalizeGroupValue(customerLabel),
    sku: skuLabel,
    skuKey: normalizeGroupValue(skuLabel),
    description: formatDescriptionForDisplay(description) || "--",
    producedDate: producedDate,
    producedRaw: String(producedRaw || "").trim(),
    unitsProduced: unitsProduced,
    workOrderCode: workOrderCode,
    workOrderId: workOrderId,
    workOrderReference: workOrderReference,
    workOrderKey: normalizeGroupValue(workOrderReference || "missing work order"),
    lotCode: fallbackLotCode || "--",
    lotCodeKey: normalizeGroupValue(fallbackLotCode || "missing finished good lot code"),
    purchaseOrderNumber: purchaseOrderNumber,
    purchaseOrderKey: normalizeGroupValue(purchaseOrderNumber || "missing purchase order"),
    jobId: jobId,
    line: line || "--",
    unitOfMeasure: fallbackUnitOfMeasure,
    reference1: reference1,
    rowIssues: rowIssues,
    searchHaystack: "",
    candidateKey: ""
  };
}

function metricCard(label, value, helper, tone) {
  var toneClass = tone === "warning"
    ? "border-[rgb(var(--warning))]/20 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)]"
    : tone === "success"
      ? "border-[rgb(var(--success))]/20 bg-[color-mix(in_oklab,rgb(var(--success))_7%,white)]"
      : "border-[rgb(var(--border))] bg-[rgb(var(--surface))]";
  return (
    <Card className={toneClass} key={label}>
      <CardContent className="px-4 py-4">
        <div className="text-xs uppercase tracking-[0.14em] text-[rgb(var(--muted))]">{label}</div>
        <div className="mt-2 text-2xl font-semibold text-[rgb(var(--foreground))]">{value}</div>
        <div className="mt-1 text-sm text-[rgb(var(--muted))]">{helper}</div>
      </CardContent>
    </Card>
  );
}

export default function InvoicingView(props) {
  var productionData = Array.isArray(props.productionData) ? props.productionData : [];
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var itemMaster = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var initialFilters = props.initialFilters || {};
  var onPermalinkChange = typeof props.onPermalinkChange === "function" ? props.onPermalinkChange : null;
  var defaults = defaultInvoicingRange();
  var initialBillingWindow = resolveInitialBillingWindow(initialFilters, defaults);
  var initialInvoiceMode = normalizeInvoiceMode(initialFilters.mode || DEFAULT_INVOICE_MODE);

  var [invoiceMode, setInvoiceMode] = useState(initialInvoiceMode);
  var [startDate, setStartDate] = useState(initialBillingWindow.start || "");
  var [endDate, setEndDate] = useState(initialBillingWindow.end || "");
  var [customerFilter, setCustomerFilter] = useState(String(initialFilters.customer || "all"));
  var [statusFilter, setStatusFilter] = useState(String(initialFilters.status || "all"));
  var [searchTerm, setSearchTerm] = useState(String(initialFilters.q || ""));
  var [warehouseFeeDrafts, setWarehouseFeeDrafts] = useState(function() {
    return {};
  });
  var [candidateSortField, setCandidateSortField] = useState(DEFAULT_CANDIDATE_SORT_FIELD);
  var [candidateSortDir, setCandidateSortDir] = useState(DEFAULT_CANDIDATE_SORT_DIR);
  var [candidateColumnFilters, setCandidateColumnFilters] = useState(createDefaultCandidateColumnFilters);
  var [showCandidateColumnFilters, setShowCandidateColumnFilters] = useState(false);
  var [selectedCandidateKeys, setSelectedCandidateKeys] = useState({});
  var [invoicePreviewState, setInvoicePreviewState] = useState(function() {
    return { loading: false, error: "", data: null };
  });
  var [invoiceExportState, setInvoiceExportState] = useState(function() {
    return { loading: false, error: "", data: null };
  });
  var [quickBooksSyncState, setQuickBooksSyncState] = useState(function() {
    return { loading: false, error: "", data: null };
  });
  var [quickBooksNotice, setQuickBooksNotice] = useState(readQuickBooksNoticeFromLocation);

  var deferredSearchTerm = useDeferredValue(searchTerm);
  var deferredCandidateColumnFilters = useDeferredValue(candidateColumnFilters);
  var hasValidDateRange = !!(startDate && endDate && endDate >= startDate);

  useEffect(function() {
    if (!onPermalinkChange) return;
    if (!hasValidDateRange) return;
    onPermalinkChange({
      mode: invoiceMode,
      start: startDate || "",
      end: endDate || "",
      customer: customerFilter || "all",
      status: statusFilter || "all",
      q: searchTerm || ""
    });
  }, [onPermalinkChange, hasValidDateRange, invoiceMode, startDate, endDate, customerFilter, statusFilter, searchTerm]);

  useEffect(function() {
    if (!quickBooksNotice.message) return;
    clearQuickBooksNoticeFromLocation();
  }, [quickBooksNotice.message]);

  var revenueConfigQuery = useQuery({
    queryKey: ["invoicing", "revenue-config"],
    queryFn: fetchInvoicingRevenueConfig,
    staleTime: REVENUE_CONFIG_STALE_MS
  });

  var revenueConfig = revenueConfigQuery.data || { skuTargets: [], itemMasterCostBySku: {} };
  var revenueTargetsBySku = useMemo(function() {
    return buildRevenueTargetsBySku(revenueConfig.skuTargets);
  }, [revenueConfig.skuTargets]);
  var itemMasterCostBySku = revenueConfig.itemMasterCostBySku && typeof revenueConfig.itemMasterCostBySku === "object"
    ? revenueConfig.itemMasterCostBySku
    : {};
  var productionHistoryQuery = useQuery({
    queryKey: ["invoicing", "production-history", startDate, endDate],
    queryFn: function() {
      return fetchInvoicingProductionHistory(startDate, endDate);
    },
    enabled: hasValidDateRange,
    staleTime: 30 * 1000
  });
  var productionHistory = productionHistoryQuery.data || {
    rows: [],
    rowCount: 0,
    querySource: "",
    latestSyncedAt: "",
    coverageAudit: createDefaultCoverageAudit(),
    availableDateRange: { min: "", max: "" }
  };
  var productionRows = Array.isArray(productionHistory.rows) ? productionHistory.rows : [];
  var coverageAudit = productionHistory.coverageAudit || createDefaultCoverageAudit();
  var productionSyncTimestamp = productionHistory.latestSyncedAt || (props.productionTimestamp ? new Date(props.productionTimestamp).toISOString() : "");

  var fieldFallbacks = useMemo(function() {
    var workOrderFallbacks = buildWorkOrderFallbacks(workOrders);
    var lotFallbacks = buildProductionLotFallbacks(productionData, workOrders);
    return {
      customerByWorkOrder: workOrderFallbacks.customerByWorkOrder,
      customerBySku: workOrderFallbacks.customerBySku,
      unitByWorkOrder: workOrderFallbacks.unitByWorkOrder,
      unitBySku: workOrderFallbacks.unitBySku,
      fixedLotByWorkOrder: workOrderFallbacks.fixedLotByWorkOrder,
      itemMasterCustomerBySku: buildItemMasterCustomerIndex(itemMaster),
      lotByJobSkuDateLine: lotFallbacks.lotByJobSkuDateLine,
      lotByJobSkuDate: lotFallbacks.lotByJobSkuDate,
      lotByJobSku: lotFallbacks.lotByJobSku,
      lotByWorkOrderSkuDateLine: lotFallbacks.lotByWorkOrderSkuDateLine,
      lotByWorkOrderSkuDate: lotFallbacks.lotByWorkOrderSkuDate,
      lotByWorkOrderSku: lotFallbacks.lotByWorkOrderSku
    };
  }, [productionData, workOrders, itemMaster]);

  var normalizedRows = useMemo(function() {
    return productionRows
      .map(function(row, index) {
        var normalized = buildNormalizedProductionRow(row, index, fieldFallbacks);
        normalized.searchHaystack = buildSearchHaystack(normalized);
        return normalized;
      })
      .filter(function(row) {
        return row.unitsProduced > 0;
      });
  }, [productionRows, fieldFallbacks]);

  var revenueReadyRows = useMemo(function() {
    return normalizedRows.map(function(row) {
      var revenueMatch = resolveRevenuePerUnit(row.itemCodeRaw || row.sku, row.producedDate, revenueTargetsBySku, itemMasterCostBySku);
      var revenuePerUnit = safeNum(revenueMatch && revenueMatch.value);
      var rateKey = buildCandidateRateKey(revenuePerUnit);
      return Object.assign({}, row, {
        searchHaystack: ((row.searchHaystack || "") + " " + rateKey).trim().toLowerCase(),
        candidateRateKey: rateKey,
        candidateKey: [
          row.customerKey,
          row.purchaseOrderKey,
          row.skuKey,
          row.lotCodeKey,
          rateKey
        ].join("|"),
        revenuePerUnit: revenuePerUnit,
        revenueSource: revenueMatch && revenueMatch.source ? revenueMatch.source : "missing",
        estimatedRevenue: revenuePerUnit > 0 ? row.unitsProduced * revenuePerUnit : 0
      });
    });
  }, [normalizedRows, revenueTargetsBySku, itemMasterCostBySku]);

  var availableDateRange = useMemo(function() {
    var queryRange = productionHistory.availableDateRange || { min: "", max: "" };
    if (queryRange.min || queryRange.max) {
      return {
        min: String(queryRange.min || ""),
        max: String(queryRange.max || "")
      };
    }
    return revenueReadyRows.reduce(function(acc, row) {
      if (!row.producedDate) return acc;
      return {
        min: updateMinDate(acc.min, row.producedDate),
        max: updateMaxDate(acc.max, row.producedDate)
      };
    }, { min: "", max: "" });
  }, [productionHistory.availableDateRange, revenueReadyRows]);

  var searchNeedle = normalizeSearchValue(deferredSearchTerm);

  var filteredRows = useMemo(function() {
    return revenueReadyRows.filter(function(row) {
      if (startDate && (!row.producedDate || row.producedDate < startDate)) return false;
      if (endDate && (!row.producedDate || row.producedDate > endDate)) return false;
      if (customerFilter !== "all" && row.customer !== customerFilter) return false;
      if (searchNeedle && row.searchHaystack.indexOf(searchNeedle) === -1) return false;
      return true;
    });
  }, [revenueReadyRows, startDate, endDate, customerFilter, searchNeedle]);

  var baseInvoiceCandidates = useMemo(function() {
    var grouped = {};
    filteredRows.forEach(function(row) {
      var key = row.candidateKey;
      if (!grouped[key]) {
        grouped[key] = {
          key: key,
          customer: row.customer,
          customerKey: row.customerKey,
          sku: row.sku,
          skuKey: row.skuKey,
          description: row.description,
          unitsProduced: 0,
          detailRows: 0,
          firstProducedDate: "",
          lastProducedDate: "",
          lotCodes: new Set(),
          workOrders: new Set(),
          purchaseOrders: new Set(),
          jobs: new Set(),
          lines: new Set(),
          unitMeasures: new Set(),
          missingProducedDateRows: 0,
          missingLotCodeRows: 0,
          missingWorkOrderRows: 0,
          missingPurchaseOrderRows: 0,
          missingUnitOfMeasureRows: 0,
          missingCustomerRows: 0,
          missingSkuRows: 0,
          pricedUnits: 0,
          pricingUnits: 0,
          itemMasterFallbackUnits: 0,
          missingRevenueUnits: 0,
          estimatedRevenue: 0
        };
      }
      var group = grouped[key];
      group.unitsProduced += row.unitsProduced;
      group.detailRows += 1;
      group.firstProducedDate = updateMinDate(group.firstProducedDate, row.producedDate);
      group.lastProducedDate = updateMaxDate(group.lastProducedDate, row.producedDate);
      if (row.description && row.description !== "--" && (group.description === "--" || row.description.length > group.description.length)) {
        group.description = row.description;
      }
      if (row.lotCode && row.lotCode !== "--") group.lotCodes.add(row.lotCode);
      else group.missingLotCodeRows += 1;
      if (row.workOrderReference) group.workOrders.add(row.workOrderReference);
      else group.missingWorkOrderRows += 1;
      if (row.purchaseOrderNumber) group.purchaseOrders.add(row.purchaseOrderNumber);
      else group.missingPurchaseOrderRows += 1;
      if (row.jobId) group.jobs.add(row.jobId);
      if (row.line && row.line !== "--") group.lines.add(row.line);
      if (row.unitOfMeasure) group.unitMeasures.add(row.unitOfMeasure);
      else group.missingUnitOfMeasureRows += 1;
      if (!row.customer || row.customer === "Unassigned customer") group.missingCustomerRows += 1;
      if (!row.sku || row.sku === "Missing SKU") group.missingSkuRows += 1;
      if (!row.producedDate) group.missingProducedDateRows += 1;
      if (safeNum(row.revenuePerUnit) > 0) {
        group.pricedUnits += row.unitsProduced;
        group.estimatedRevenue += row.estimatedRevenue;
        if (row.revenueSource === "pricing") group.pricingUnits += row.unitsProduced;
        else if (row.revenueSource === "item_master_cost_per_unit") group.itemMasterFallbackUnits += row.unitsProduced;
      } else {
        group.missingRevenueUnits += row.unitsProduced;
      }
    });

    return Object.values(grouped).map(function(group) {
      var blockingIssues = [];
      var advisoryIssues = [];

      if (group.missingCustomerRows > 0) blockingIssues.push("Missing customer on " + group.missingCustomerRows + " " + pluralize(group.missingCustomerRows, "row"));
      if (group.missingSkuRows > 0) blockingIssues.push("Missing SKU on " + group.missingSkuRows + " " + pluralize(group.missingSkuRows, "row"));
      if (group.missingProducedDateRows > 0) blockingIssues.push("Missing produced date on " + group.missingProducedDateRows + " " + pluralize(group.missingProducedDateRows, "row"));
      if (!group.lotCodes.size) blockingIssues.push("Missing finished good lot code");
      if (group.lotCodes.size > 1) blockingIssues.push("Multiple finished good lot codes in one invoice line");
      if (!group.unitMeasures.size) blockingIssues.push("Missing unit of measure");
      if (group.unitMeasures.size > 1) blockingIssues.push("Multiple unit measures in one invoice line");
      if (!group.purchaseOrders.size) blockingIssues.push("No purchase order attached");
      if (group.purchaseOrders.size > 1) blockingIssues.push("Multiple purchase orders in one invoice line");

      if (group.missingPurchaseOrderRows > 0 && group.purchaseOrders.size > 0) advisoryIssues.push(group.missingPurchaseOrderRows + " " + pluralize(group.missingPurchaseOrderRows, "row") + " missing PO");
      if (group.missingWorkOrderRows > 0 && group.workOrders.size > 0) advisoryIssues.push(group.missingWorkOrderRows + " " + pluralize(group.missingWorkOrderRows, "row") + " missing work order");
      if (group.workOrders.size > 1) advisoryIssues.push(group.workOrders.size + " work orders rolled into one PO lot line");
      if (group.lines.size > 1) advisoryIssues.push(group.lines.size + " production lines");
      if (group.missingRevenueUnits > 0) advisoryIssues.push(formatUnits(group.missingRevenueUnits) + " units missing revenue");
      if (group.itemMasterFallbackUnits > 0) advisoryIssues.push(formatUnits(group.itemMasterFallbackUnits) + " units using item master fallback");

      var status = blockingIssues.length ? "review" : "ready";
      var coveragePct = group.unitsProduced > 0 ? Math.round((group.pricedUnits / group.unitsProduced) * 100) : 0;
      var avgRevenuePerUnit = group.pricedUnits > 0 ? (group.estimatedRevenue / group.pricedUnits) : 0;
      var primaryRevenueSource = "missing";
      if (group.pricingUnits > 0 && group.itemMasterFallbackUnits > 0) primaryRevenueSource = "mixed";
      else if (group.pricingUnits > 0) primaryRevenueSource = "pricing";
      else if (group.itemMasterFallbackUnits > 0) primaryRevenueSource = "item_master_cost_per_unit";
      var candidate = {
        key: group.key,
        customer: group.customer,
        sku: group.sku,
        description: group.description,
        unitsProduced: group.unitsProduced,
        detailRows: group.detailRows,
        firstProducedDate: group.firstProducedDate,
        lastProducedDate: group.lastProducedDate,
        lotCode: group.lotCodes.size === 1 ? setToArray(group.lotCodes)[0] : (group.lotCodes.size ? "Mixed" : "--"),
        workOrderReference: group.workOrders.size === 1 ? setToArray(group.workOrders)[0] : (group.workOrders.size ? "Mixed" : "--"),
        purchaseOrderReference: group.purchaseOrders.size === 1 ? setToArray(group.purchaseOrders)[0] : (group.purchaseOrders.size ? "Mixed" : "--"),
        workOrderCount: group.workOrders.size,
        purchaseOrderCount: group.purchaseOrders.size,
        jobCount: group.jobs.size,
        lineCount: group.lines.size,
        unitOfMeasure: group.unitMeasures.size === 1 ? setToArray(group.unitMeasures)[0] : (group.unitMeasures.size ? "Mixed" : "--"),
        status: status,
        estimatedRevenue: group.estimatedRevenue,
        pricedUnits: group.pricedUnits,
        missingRevenueUnits: group.missingRevenueUnits,
        itemMasterFallbackUnits: group.itemMasterFallbackUnits,
        pricingUnits: group.pricingUnits,
        revenueCoveragePct: coveragePct,
        revenuePerUnitAvg: avgRevenuePerUnit,
        revenueSource: primaryRevenueSource,
        blockingIssues: blockingIssues,
        advisoryIssues: advisoryIssues,
        issueSummary: blockingIssues.concat(advisoryIssues).join(" | ")
      };
      candidate.exportAuditKey = buildCandidateExportKey(candidate);
      return candidate;
    }).sort(function(left, right) {
      if (left.status !== right.status) return left.status === "review" ? -1 : 1;
      if (right.unitsProduced !== left.unitsProduced) return right.unitsProduced - left.unitsProduced;
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      if (left.purchaseOrderReference !== right.purchaseOrderReference) return left.purchaseOrderReference.localeCompare(right.purchaseOrderReference);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      if (left.lotCode !== right.lotCode) return left.lotCode.localeCompare(right.lotCode);
      if (left.revenuePerUnitAvg !== right.revenuePerUnitAvg) return left.revenuePerUnitAvg - right.revenuePerUnitAvg;
      if (left.workOrderReference !== right.workOrderReference) return left.workOrderReference.localeCompare(right.workOrderReference);
      return 0;
    });
  }, [filteredRows]);

  var invoiceCandidateStateSignature = useMemo(function() {
    return baseInvoiceCandidates
      .map(function(candidate) { return candidate.exportAuditKey; })
      .sort()
      .join("|");
  }, [baseInvoiceCandidates]);

  var quickBooksPersistenceQuery = useQuery({
    queryKey: ["invoicing", "quickbooks-persistence", startDate, endDate, invoiceCandidateStateSignature],
    queryFn: function() {
      return fetchQuickBooksPersistenceState({
        billingWindow: {
          startDate: startDate || "",
          endDate: endDate || ""
        },
        invoiceCandidates: baseInvoiceCandidates.map(function(candidate) {
          return {
            key: candidate.key,
            candidateExportKey: candidate.exportAuditKey,
            customer: candidate.customer,
            sku: candidate.sku,
            unitsProduced: candidate.unitsProduced,
            estimatedRevenue: candidate.estimatedRevenue,
            revenuePerUnitAvg: candidate.revenuePerUnitAvg,
            detailRows: candidate.detailRows,
            lineCount: candidate.lineCount,
            firstProducedDate: candidate.firstProducedDate,
            lastProducedDate: candidate.lastProducedDate,
            status: candidate.status
          };
        })
      });
    },
    enabled: hasValidDateRange && baseInvoiceCandidates.length > 0,
    staleTime: 30 * 1000
  });

  var quickBooksConnectionQuery = useQuery({
    queryKey: ["invoicing", "quickbooks-connection-status"],
    queryFn: fetchQuickBooksConnectionStatus,
    staleTime: 30 * 1000
  });

  var quickBooksPersistence = quickBooksPersistenceQuery.data || normalizeQuickBooksPersistencePayload({});
  var quickBooksConnection = quickBooksConnectionQuery.data || normalizeQuickBooksConnectionPayload({});
  var quickBooksConnectionSummary = quickBooksConnection.connection.summary || {
    customerCatalogCount: 0,
    itemCatalogCount: 0,
    termCatalogCount: 0,
    customerMappingsCreated: 0,
    customerMappingsUpdated: 0,
    customerMappingsUnresolved: 0,
    itemMappingsCreated: 0,
    itemMappingsUpdated: 0,
    itemMappingsUnresolved: 0,
    termMappingsCreated: 0,
    termMappingsUpdated: 0,
    termMappingsUnresolved: 0,
    preservedMappings: 0,
    unresolvedCustomers: [],
    unresolvedItems: [],
    unresolvedTerms: []
  };

  var invoiceCandidates = useMemo(function() {
    return baseInvoiceCandidates.map(function(candidate) {
      var state = quickBooksPersistence.candidateStates[candidate.key] || {};
      var quickBooksIssues = Array.isArray(state.issues) ? state.issues : [];
      var combinedIssueSummary = [candidate.issueSummary].concat(quickBooksIssues).filter(Boolean).join(" | ");
      var quickBooksState = String(state.quickBooksState || "");
      return Object.assign({}, candidate, {
        quickBooksState: quickBooksState,
        quickBooksStateKnown: !!state.stateKnown,
        mappingStateKnown: !!state.mappingStateKnown,
        exportStateKnown: !!state.exportStateKnown,
        quickBooksReady: quickBooksIssues.length === 0 && candidateCanPreviewQuickBooks({ status: candidate.status, quickBooksState: quickBooksState }),
        customerMapped: state.customerMapped,
        itemMapped: state.itemMapped,
        alreadyPushed: !!state.alreadyPushed,
        exportStatus: String(state.exportStatus || ""),
        externalInvoiceId: String(state.externalInvoiceId || ""),
        externalDocNumber: String(state.externalDocNumber || ""),
        exportedAt: String(state.exportedAt || ""),
        quickBooksIssues: quickBooksIssues,
        issueSummary: combinedIssueSummary
      });
    });
  }, [baseInvoiceCandidates, quickBooksPersistence.candidateStates]);

  var candidateByKey = useMemo(function() {
    var out = {};
    invoiceCandidates.forEach(function(candidate) {
      out[candidate.key] = candidate;
    });
    return out;
  }, [invoiceCandidates]);

  var selectedInvoiceCandidates = useMemo(function() {
    return Object.keys(selectedCandidateKeys).map(function(key) {
      return candidateByKey[key];
    }).filter(Boolean);
  }, [selectedCandidateKeys, candidateByKey]);

  var selectedCandidateCount = selectedInvoiceCandidates.length;
  var selectedReadyCandidateCount = useMemo(function() {
    return selectedInvoiceCandidates.filter(function(candidate) { return candidateCanPreviewQuickBooks(candidate); }).length;
  }, [selectedInvoiceCandidates]);
  var selectedReviewCandidateCount = useMemo(function() {
    return selectedInvoiceCandidates.filter(function(candidate) { return candidate.status !== "ready"; }).length;
  }, [selectedInvoiceCandidates]);
  var selectedQuickBooksBlockedCount = useMemo(function() {
    return selectedInvoiceCandidates.filter(function(candidate) {
      return candidate.status === "ready" && !candidateCanPreviewQuickBooks(candidate);
    }).length;
  }, [selectedInvoiceCandidates]);
  var selectedCandidateSignature = useMemo(function() {
    return selectedInvoiceCandidates.map(function(candidate) { return candidate.key; }).sort().join("|");
  }, [selectedInvoiceCandidates]);

  useEffect(function() {
    setSelectedCandidateKeys(function(previous) {
      var next = {};
      var changed = false;
      Object.keys(previous || {}).forEach(function(key) {
        if (candidateCanPreviewQuickBooks(candidateByKey[key])) next[key] = true;
        else changed = true;
      });
      return changed ? next : previous;
    });
  }, [candidateByKey]);

  useEffect(function() {
    setInvoicePreviewState(function(previous) {
      if (!previous.loading && !previous.error && !previous.data) return previous;
      return { loading: false, error: "", data: null };
    });
  }, [selectedCandidateSignature, startDate, endDate]);

  var statusScopedInvoiceCandidates = useMemo(function() {
    return invoiceCandidates.filter(function(candidate) {
      if (statusFilter === "all") return true;
      return candidate.status === statusFilter;
    });
  }, [invoiceCandidates, statusFilter]);

  var visibleInvoiceCandidates = useMemo(function() {
    var filteredCandidates = statusScopedInvoiceCandidates.slice();
    filteredCandidates = filteredCandidates.filter(function(candidate) {
      return candidateMatchesColumnFilters(candidate, deferredCandidateColumnFilters);
    });
    return sortInvoiceCandidates(filteredCandidates, candidateSortField, candidateSortDir);
  }, [statusScopedInvoiceCandidates, deferredCandidateColumnFilters, candidateSortField, candidateSortDir]);

  var visibleCandidateKeySet = useMemo(function() {
    var out = {};
    visibleInvoiceCandidates.forEach(function(candidate) {
      out[candidate.key] = true;
    });
    return out;
  }, [visibleInvoiceCandidates]);

  var statusScopedCandidateKeySet = useMemo(function() {
    var out = {};
    statusScopedInvoiceCandidates.forEach(function(candidate) {
      out[candidate.key] = true;
    });
    return out;
  }, [statusScopedInvoiceCandidates]);

  var visibleReadyCandidates = useMemo(function() {
    return visibleInvoiceCandidates.filter(function(candidate) {
      return candidateCanPreviewQuickBooks(candidate);
    });
  }, [visibleInvoiceCandidates]);

  var selectedVisibleReadyCount = useMemo(function() {
    var count = 0;
    visibleReadyCandidates.forEach(function(candidate) {
      if (selectedCandidateKeys[candidate.key]) count += 1;
    });
    return count;
  }, [visibleReadyCandidates, selectedCandidateKeys]);

  var allVisibleReadySelected = visibleReadyCandidates.length > 0 && selectedVisibleReadyCount === visibleReadyCandidates.length;

  var customerRollups = useMemo(function() {
    var grouped = {};
    statusScopedInvoiceCandidates.forEach(function(candidate) {
      if (!grouped[candidate.customer]) {
        grouped[candidate.customer] = {
          customer: candidate.customer,
          unitsProduced: 0,
          invoiceLines: 0,
          readyLines: 0,
          reviewLines: 0,
          jobs: 0,
          workOrders: 0,
          estimatedRevenue: 0,
          pricedUnits: 0,
          totalUnits: 0
        };
      }
      var group = grouped[candidate.customer];
      group.unitsProduced += candidate.unitsProduced;
      group.totalUnits += candidate.unitsProduced;
      group.invoiceLines += 1;
      group.jobs += candidate.jobCount;
      group.workOrders += candidate.workOrderCount;
      group.estimatedRevenue += candidate.estimatedRevenue;
      group.pricedUnits += candidate.pricedUnits;
      if (candidate.status === "review") group.reviewLines += 1;
      else group.readyLines += 1;
    });
    return Object.values(grouped).sort(function(left, right) {
      if (right.reviewLines !== left.reviewLines) return right.reviewLines - left.reviewLines;
      return right.unitsProduced - left.unitsProduced;
    });
  }, [statusScopedInvoiceCandidates]);

  var detailRows = useMemo(function() {
    var rows = filteredRows.filter(function(row) {
      if (!visibleCandidateKeySet[row.candidateKey]) return false;
      return true;
    }).slice();

    rows.sort(function(left, right) {
      if (left.producedDate !== right.producedDate) return String(right.producedDate || "").localeCompare(String(left.producedDate || ""));
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      if (left.lotCode !== right.lotCode) return left.lotCode.localeCompare(right.lotCode);
      return right.unitsProduced - left.unitsProduced;
    });
    return rows;
  }, [filteredRows, visibleCandidateKeySet]);

  var statusScopedRows = useMemo(function() {
    return filteredRows.filter(function(row) {
      return !!statusScopedCandidateKeySet[row.candidateKey];
    });
  }, [filteredRows, statusScopedCandidateKeySet]);

  var summary = useMemo(function() {
    var customers = {};
    var uniqueJobs = {};
    var readyCount = 0;
    var reviewCount = 0;
    var estimatedRevenue = 0;
    var pricedUnits = 0;
    var fallbackUnits = 0;
    statusScopedInvoiceCandidates.forEach(function(candidate) {
      customers[candidate.customer] = true;
      if (candidate.status === "review") reviewCount += 1;
      else readyCount += 1;
      estimatedRevenue += candidate.estimatedRevenue;
      pricedUnits += candidate.pricedUnits;
      if (candidate.revenueSource === "item_master_cost_per_unit" || candidate.revenueSource === "mixed") fallbackUnits += candidate.itemMasterFallbackUnits || 0;
    });
    statusScopedRows.forEach(function(row) {
      if (row.jobId) uniqueJobs[row.jobId] = true;
    });
    var totalUnits = statusScopedInvoiceCandidates.reduce(function(sum, candidate) { return sum + candidate.unitsProduced; }, 0);
    return {
      unitsProduced: totalUnits,
      customers: Object.keys(customers).length,
      invoiceLines: statusScopedInvoiceCandidates.length,
      readyLines: readyCount,
      reviewLines: reviewCount,
      jobs: Object.keys(uniqueJobs).length,
      estimatedRevenue: estimatedRevenue,
      pricedUnits: pricedUnits,
      revenueCoveragePct: totalUnits > 0 ? Math.round((pricedUnits / totalUnits) * 100) : 0,
      fallbackUnits: fallbackUnits
    };
  }, [statusScopedInvoiceCandidates, statusScopedRows]);

  var customerPeriodRows = useMemo(function() {
    return revenueReadyRows.filter(function(row) {
      if (startDate && (!row.producedDate || row.producedDate < startDate)) return false;
      if (endDate && (!row.producedDate || row.producedDate > endDate)) return false;
      return row.unitsProduced > 0 || !!row.jobId;
    });
  }, [revenueReadyRows, startDate, endDate]);

  var customerOptions = useMemo(function() {
    var totals = {};
    customerPeriodRows.forEach(function(row) {
      totals[row.customer] = (totals[row.customer] || 0) + row.unitsProduced;
    });
    return Object.keys(totals)
      .sort(function(left, right) {
        if (totals[right] !== totals[left]) return totals[right] - totals[left];
        return left.localeCompare(right);
      });
  }, [customerPeriodRows]);

  useEffect(function() {
    if (!customerOptions.length) return;
    setWarehouseFeeDrafts(function(previous) {
      var next = Object.assign({}, previous || {});
      var changed = false;
      customerOptions.forEach(function(customer) {
        if (next[customer]) return;
        next[customer] = createDefaultWarehouseFeeDraft();
        changed = true;
      });
      return changed ? next : previous;
    });
  }, [customerOptions]);

  useEffect(function() {
    if (customerFilter === "all") return;
    if (customerOptions.indexOf(customerFilter) !== -1) return;
    setCustomerFilter("all");
  }, [customerFilter, customerOptions]);

  function applyCurrentMonth() {
    var range = defaultInvoicingRange();
    setStartDate(range.start);
    setEndDate(range.end);
  }

  function applyPreviousMonth() {
    var range = lastMonthRange();
    setStartDate(range.start);
    setEndDate(range.end);
  }

  function clearFilters() {
    var range = defaultInvoicingRange();
    setStartDate(range.start);
    setEndDate(range.end);
    setCustomerFilter("all");
    setStatusFilter("all");
    setSearchTerm("");
    setShowCandidateColumnFilters(false);
    setCandidateSortField(DEFAULT_CANDIDATE_SORT_FIELD);
    setCandidateSortDir(DEFAULT_CANDIDATE_SORT_DIR);
    setCandidateColumnFilters(createDefaultCandidateColumnFilters());
  }

  function updateWarehouseFeeDraft(customer, field, value) {
    setWarehouseFeeDrafts(function(previous) {
      var next = Object.assign({}, previous || {});
      next[customer] = Object.assign(
        {},
        createDefaultWarehouseFeeDraft(previous && previous[customer]),
        field === "included"
          ? { included: !!value }
          : field === "note"
            ? { note: String(value || "") }
            : { [field]: String(value == null ? "" : value) }
      );
      return next;
    });
  }

  function resetWarehouseFeeDrafts() {
    setWarehouseFeeDrafts(function() {
      var next = {};
      customerOptions.forEach(function(customer) {
        next[customer] = createDefaultWarehouseFeeDraft();
      });
      return next;
    });
  }

  function toggleCandidateSelection(key, checked) {
    if (!key) return;
    setSelectedCandidateKeys(function(previous) {
      var next = Object.assign({}, previous);
      if (checked) next[key] = true;
      else delete next[key];
      return next;
    });
  }

  function toggleVisibleReadySelection(checked) {
    setSelectedCandidateKeys(function(previous) {
      var next = Object.assign({}, previous);
      visibleReadyCandidates.forEach(function(candidate) {
        if (checked) next[candidate.key] = true;
        else delete next[candidate.key];
      });
      return next;
    });
  }

  function clearSelectedCandidates() {
    setSelectedCandidateKeys({});
  }

  function beginQuickBooksConnect() {
    if (typeof window === "undefined") return;
    var returnTo = window.location.pathname + (window.location.search || "");
    window.location.assign("/api/accounting/qbo/connect?returnTo=" + encodeURIComponent(returnTo));
  }

  function buildSelectedQuickBooksPayload() {
    return {
      billingWindow: {
        startDate: startDate || "",
        endDate: endDate || ""
      },
      invoiceDate: endDate || startDate || "",
      selectedCandidates: selectedInvoiceCandidates.map(function(candidate) {
        return {
          key: candidate.key,
          candidateExportKey: candidate.exportAuditKey,
          customer: candidate.customer,
          sku: candidate.sku,
          description: candidate.description,
          unitsProduced: candidate.unitsProduced,
          estimatedRevenue: candidate.estimatedRevenue,
          revenuePerUnitAvg: candidate.revenuePerUnitAvg,
          unitOfMeasure: candidate.unitOfMeasure,
          lotCode: candidate.lotCode,
          purchaseOrderReference: candidate.purchaseOrderReference,
          workOrderReference: candidate.workOrderReference,
          workOrderCount: candidate.workOrderCount,
          jobCount: candidate.jobCount,
          lineCount: candidate.lineCount,
          detailRows: candidate.detailRows,
          status: candidate.status,
          firstProducedDate: candidate.firstProducedDate,
          lastProducedDate: candidate.lastProducedDate,
          issueSummary: candidate.issueSummary
        };
      })
    };
  }

  async function runQuickBooksMasterSync() {
    setQuickBooksSyncState({ loading: true, error: "", data: null });
    try {
      var result = await syncQuickBooksMasterData();
      setQuickBooksSyncState({ loading: false, error: "", data: result });
      setQuickBooksNotice({
        tone: "success",
        message: "QuickBooks master data synced. Review any unresolved mappings below."
      });
      await quickBooksConnectionQuery.refetch();
      await quickBooksPersistenceQuery.refetch();
    } catch (error) {
      setQuickBooksSyncState({
        loading: false,
        error: error && error.message ? error.message : "Could not sync QuickBooks master data.",
        data: null
      });
    }
  }

  async function buildInvoicePreview() {
    if (!selectedInvoiceCandidates.length) return;
    setInvoicePreviewState({ loading: true, error: "", data: null });
    setInvoiceExportState({ loading: false, error: "", data: null });
    try {
      var payload = buildSelectedQuickBooksPayload();
      var preview = await fetchQuickBooksInvoicePreview(payload);
      setInvoicePreviewState({ loading: false, error: "", data: preview });
    } catch (error) {
      setInvoicePreviewState({
        loading: false,
        error: error && error.message ? error.message : "Could not build QuickBooks preview.",
        data: null
      });
    }
  }

  async function createInvoicesInQuickBooks() {
    var draftCount = Number(invoicePreviewState.data && invoicePreviewState.data.groupCount || 0);
    if (!draftCount || !selectedInvoiceCandidates.length) return;
    if (typeof window !== "undefined") {
      var confirmed = window.confirm(
        "Create " + draftCount + " QuickBooks invoice" + (draftCount === 1 ? "" : "s") + " now? PackPulse will mark the exported candidates as already pushed after success."
      );
      if (!confirmed) return;
    }

    setInvoiceExportState({ loading: true, error: "", data: null });
    try {
      var result = await createQuickBooksInvoices(buildSelectedQuickBooksPayload());
      setInvoiceExportState({ loading: false, error: "", data: result });
      setQuickBooksNotice({
        tone: Number(result.failedCount || 0) ? "warning" : "success",
        message: Number(result.failedCount || 0)
          ? ("Created " + Number(result.createdCount || 0).toLocaleString() + " QuickBooks invoice" + (Number(result.createdCount || 0) === 1 ? "" : "s") + ". " + Number(result.failedCount || 0).toLocaleString() + " invoice" + (Number(result.failedCount || 0) === 1 ? "" : "s") + " need follow-up.")
          : ("Created " + Number(result.createdCount || 0).toLocaleString() + " QuickBooks invoice" + (Number(result.createdCount || 0) === 1 ? "" : "s") + ".")
      });
      if (Array.isArray(result.createdCandidateKeys) && result.createdCandidateKeys.length) {
        setSelectedCandidateKeys(function(previous) {
          var next = Object.assign({}, previous);
          result.createdCandidateKeys.forEach(function(key) {
            delete next[key];
          });
          return next;
        });
      }
      await quickBooksPersistenceQuery.refetch();
      await quickBooksConnectionQuery.refetch();
    } catch (error) {
      setInvoiceExportState({
        loading: false,
        error: error && error.message ? error.message : "Could not create QuickBooks invoices.",
        data: null
      });
    }
  }

  function handleCandidateSort(field) {
    if (candidateSortField === field) {
      setCandidateSortDir(function(previous) {
        return previous === "asc" ? "desc" : "asc";
      });
      return;
    }
    setCandidateSortField(field);
    setCandidateSortDir(defaultCandidateSortDirForField(field));
  }

  function updateCandidateColumnFilter(field, value) {
    setCandidateColumnFilters(function(previous) {
      return Object.assign({}, previous, { [field]: value });
    });
  }

  function clearCandidateTableControls() {
    setCandidateSortField(DEFAULT_CANDIDATE_SORT_FIELD);
    setCandidateSortDir(DEFAULT_CANDIDATE_SORT_DIR);
    setCandidateColumnFilters(createDefaultCandidateColumnFilters());
  }

  var hasActiveCandidateColumnFilters = useMemo(function() {
    var defaults = createDefaultCandidateColumnFilters();
    return Object.keys(defaults).some(function(key) {
      return String(candidateColumnFilters[key] || "") !== String(defaults[key] || "");
    });
  }, [candidateColumnFilters]);

  var hasActiveCandidateTableControls = useMemo(function() {
    return hasActiveCandidateColumnFilters || candidateSortField !== DEFAULT_CANDIDATE_SORT_FIELD || candidateSortDir !== DEFAULT_CANDIDATE_SORT_DIR;
  }, [hasActiveCandidateColumnFilters, candidateSortField, candidateSortDir]);

  var showCandidateFilterRow = showCandidateColumnFilters || hasActiveCandidateColumnFilters;

  var candidateControlChips = useMemo(function() {
    var chips = [];
    if (candidateSortField !== DEFAULT_CANDIDATE_SORT_FIELD || candidateSortDir !== DEFAULT_CANDIDATE_SORT_DIR) {
      chips.push("Sort: " + (CANDIDATE_SORT_LABELS[candidateSortField] || candidateSortField) + " " + (candidateSortDir === "asc" ? "↑" : "↓"));
    }
    if (candidateColumnFilters.status && candidateColumnFilters.status !== "all") chips.push("Status: " + candidateColumnFilters.status);
    if (candidateColumnFilters.customerSku) chips.push("Customer/SKU: " + candidateColumnFilters.customerSku);
    if (candidateColumnFilters.minUnits) chips.push("Units ≥ " + candidateColumnFilters.minUnits);
    if (candidateColumnFilters.minRevenuePerUnit) chips.push("Rev/Unit ≥ " + candidateColumnFilters.minRevenuePerUnit);
    if (candidateColumnFilters.minEstimatedRevenue) chips.push("Revenue ≥ " + candidateColumnFilters.minEstimatedRevenue);
    if (candidateColumnFilters.unitOfMeasure) chips.push("UOM: " + candidateColumnFilters.unitOfMeasure);
    if (candidateColumnFilters.lotCode) chips.push("Lot: " + candidateColumnFilters.lotCode);
    if (candidateColumnFilters.workOrder) chips.push("WO: " + candidateColumnFilters.workOrder);
    if (candidateColumnFilters.purchaseOrder) chips.push("PO: " + candidateColumnFilters.purchaseOrder);
    if (candidateColumnFilters.minJobs) chips.push("Jobs ≥ " + candidateColumnFilters.minJobs);
    if (candidateColumnFilters.period) chips.push("Period: " + candidateColumnFilters.period);
    return chips;
  }, [candidateColumnFilters, candidateSortField, candidateSortDir]);

  function exportSummaryCsv() {
    var header = [
      "status",
      "customer",
      "sku",
      "item_description",
      "units_produced",
      "priced_units",
      "revenue_coverage_pct",
      "revenue_per_unit",
      "estimated_revenue",
      "revenue_source",
      "unit_of_measure",
      "finished_good_lot_code",
      "purchase_order",
      "work_order",
      "job_count",
      "line_count",
      "first_produced_date",
      "last_produced_date",
      "notes"
    ];
    var body = visibleInvoiceCandidates.map(function(candidate) {
      return [
        candidate.status,
        candidate.customer,
        candidate.sku,
        candidate.description,
        candidate.unitsProduced.toFixed(2),
        candidate.pricedUnits.toFixed(2),
        candidate.revenueCoveragePct,
        candidate.revenuePerUnitAvg.toFixed(4),
        candidate.estimatedRevenue.toFixed(2),
        candidate.revenueSource,
        candidate.unitOfMeasure,
        candidate.lotCode,
        candidate.purchaseOrderReference,
        candidate.workOrderReference,
        candidate.jobCount,
        candidate.lineCount,
        candidate.firstProducedDate,
        candidate.lastProducedDate,
        candidate.issueSummary
      ].map(csvCell).join(",");
    });
    var filename = "invoice_candidates_" + (startDate || "all") + "_to_" + (endDate || "all") + ".csv";
    triggerDownload([header.join(",")].concat(body).join("\n"), filename, "text/csv;charset=utf-8;");
  }

  function exportDetailCsv() {
    var header = [
      "produced_date",
      "customer",
      "sku",
      "item_description",
      "units_produced",
      "revenue_per_unit",
      "estimated_revenue",
      "revenue_source",
      "unit_of_measure",
      "lot_code",
      "job_id",
      "work_order_code",
      "work_order_id",
      "purchase_order_number",
      "line",
      "reference_1",
      "review_notes"
    ];
    var body = detailRows.map(function(row) {
      return [
        row.producedDate,
        row.customer,
        row.sku,
        row.description,
        row.unitsProduced.toFixed(2),
        row.revenuePerUnit.toFixed(4),
        row.estimatedRevenue.toFixed(2),
        row.revenueSource,
        row.unitOfMeasure,
        row.lotCode,
        row.jobId,
        row.workOrderCode,
        row.workOrderId,
        row.purchaseOrderNumber,
        row.line,
        row.reference1,
        row.rowIssues.join(" | ")
      ].map(csvCell).join(",");
    });
    var filename = "invoice_detail_filtered_" + (startDate || "all") + "_to_" + (endDate || "all") + ".csv";
    triggerDownload([header.join(",")].concat(body).join("\n"), filename, "text/csv;charset=utf-8;");
  }

  var warehouseClientRows = useMemo(function() {
    return customerOptions.map(function(customer) {
      return Object.assign({ customer: customer }, createDefaultWarehouseFeeDraft(warehouseFeeDrafts[customer]));
    });
  }, [customerOptions, warehouseFeeDrafts]);

  var warehouseSummary = useMemo(function() {
    var includedCount = 0;
    var zeroRateCount = 0;
    var nonDefaultCount = 0;
    warehouseClientRows.forEach(function(row) {
      if (row.included) includedCount += 1;
      var inboundRate = safeNum(row.inboundRate);
      var outboundRate = safeNum(row.outboundRate);
      var storageRate = safeNum(row.storageRate);
      var isDefaultRate =
        row.inboundRate === DEFAULT_WAREHOUSE_RATE_DRAFT.inboundRate &&
        row.outboundRate === DEFAULT_WAREHOUSE_RATE_DRAFT.outboundRate &&
        row.storageRate === DEFAULT_WAREHOUSE_RATE_DRAFT.storageRate;
      if (!isDefaultRate || !row.included || String(row.note || "").trim()) nonDefaultCount += 1;
      if (inboundRate <= 0 && outboundRate <= 0 && storageRate <= 0) zeroRateCount += 1;
    });
    return {
      clientCount: warehouseClientRows.length,
      includedCount: includedCount,
      excludedCount: Math.max(0, warehouseClientRows.length - includedCount),
      zeroRateCount: zeroRateCount,
      nonDefaultCount: nonDefaultCount
    };
  }, [warehouseClientRows]);

  var invoiceModeTabs = useMemo(function() {
    return [
      {
        key: "production",
        label: "Production",
        count: summary.invoiceLines
      },
      {
        key: "warehousing",
        label: "Warehousing",
        count: warehouseSummary.clientCount
      }
    ];
  }, [summary.invoiceLines, warehouseSummary.clientCount]);

  if (!hasValidDateRange) {
    return (
      <Card className="mt-3">
        <CardHeader className="border-b border-[rgb(var(--border))] pb-4">
          <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
          <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
            Review billable production for a billing period, preserve PO and lot traceability, and export accounting-ready invoice detail.
          </div>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <div className="rounded-xl border border-dashed border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_70%,white)] p-4">
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Choose a valid billing window</div>
            <div className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted))]">
              Start date and end date must both be set, and the end date cannot be earlier than the start date.
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={applyCurrentMonth} size="sm">
                Use Current Month
              </Button>
              <Button onClick={applyPreviousMonth} variant="outline" size="sm">
                Use Previous Month
              </Button>
              <Button onClick={clearFilters} variant="ghost" size="sm">
                Reset Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (productionHistoryQuery.isLoading) {
    return (
      <Card className="mt-3">
        <CardHeader className="border-b border-[rgb(var(--border))] pb-4">
          <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
          <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
            Loading historical production rows for the selected billing window.
          </div>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <div className="rounded-xl border border-dashed border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_70%,white)] p-4 text-sm text-[rgb(var(--muted))]">
            Pulling invoicing history from stored `production_events` for {formatDateLabel(startDate)} to {formatDateLabel(endDate)}.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (productionHistoryQuery.isError) {
    return (
      <Card className="mt-3">
        <CardHeader className="border-b border-[rgb(var(--border))] pb-4">
          <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
          <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
            Review billable production for a billing period, preserve PO and lot traceability, and export accounting-ready invoice detail.
          </div>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <div className="rounded-xl border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-4">
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Historical production data could not be loaded</div>
            <div className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted))]">
              {productionHistoryQuery.error && productionHistoryQuery.error.message
                ? productionHistoryQuery.error.message
                : "The invoicing history request failed."}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!normalizedRows.length) {
    var missingHistoryTable = productionHistory.querySource === "missing_production_events_table";
    var hasAvailableHistory = !!(availableDateRange.min || availableDateRange.max);
    var emptyStateTitle = missingHistoryTable
      ? "Historical production storage is not available yet"
      : hasAvailableHistory
        ? "No production rows were found for this billing window"
        : "No production history is stored for invoicing yet";
    var emptyStateDescription = missingHistoryTable
      ? "This environment does not have the `production_events` table available yet, so invoicing cannot load historical production rows."
      : hasAvailableHistory
        ? "The selected billing window falls outside the currently stored production history, or there were no positive-unit production rows in that period."
        : "Run the Nulogy sync and include the Production report. Once rows are stored in historical production events, this page will assemble customer, PO, SKU, lot, and billed-rate invoice lines automatically.";
    return (
      <Card className="mt-3">
        <CardHeader className="border-b border-[rgb(var(--border))] pb-4">
          <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
          <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
            Review billable production for a billing period, preserve PO and lot traceability, and export accounting-ready invoice detail.
          </div>
        </CardHeader>
        <CardContent className="px-4 py-4">
          <div className="rounded-xl border border-dashed border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_70%,white)] p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">{emptyStateTitle}</div>
                <div className="mt-2 max-w-2xl text-sm text-[rgb(var(--muted))]">
                  {emptyStateDescription}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={applyCurrentMonth} variant="outline" size="sm">Current Month</Button>
                <Button onClick={applyPreviousMonth} variant="outline" size="sm">Previous Month</Button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Billing Window</div>
                <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">
                  {formatDateLabel(startDate)} to {formatDateLabel(endDate)}
                </div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Production Sync</div>
                <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">
                  {productionSyncTimestamp ? new Date(productionSyncTimestamp).toLocaleString() : "Not synced yet"}
                </div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Available History</div>
                <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">
                  {hasAvailableHistory ? (formatDateLabel(availableDateRange.min) + " to " + formatDateLabel(availableDateRange.max)) : "No stored production history yet"}
                </div>
              </div>
              <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Needed For Invoice Lines</div>
                <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">Production rows with SKU, lot code, purchase order, and pricing references</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  var invoiceModeSwitcher = (
    <Card>
      <CardContent className="px-4 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Invoice Type</div>
            <div className="mt-1 text-lg font-semibold text-[rgb(var(--foreground))]">
              {invoiceMode === "production" ? "Production Invoicing" : "Warehousing Invoicing"}
            </div>
            <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
              {invoiceMode === "production"
                ? "Use the existing PO, SKU, lot, and rate workflow for finished-good billing."
                : "Set up client-level pallet fees first, then layer monthly inbound, outbound, and storage charges onto the same invoicing workspace."}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {invoiceMode === "production" ? (
              <>
                <Badge variant="info">{filteredRows.length.toLocaleString()} production rows</Badge>
                <Badge variant="secondary">{summary.customers.toLocaleString()} customers</Badge>
              </>
            ) : (
              <>
                <Badge variant="info">{warehouseSummary.clientCount.toLocaleString()} clients in scope</Badge>
                <Badge variant="secondary">Monthly by client</Badge>
              </>
            )}
          </div>
        </div>
        <TabsNav items={invoiceModeTabs} activeKey={invoiceMode} onChange={setInvoiceMode} className="mb-0 mt-4" />
      </CardContent>
    </Card>
  );

  if (invoiceMode === "warehousing") {
    return (
      <div className="space-y-4">
        {invoiceModeSwitcher}

        <Card>
          <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Warehousing Billing Workspace</div>
              <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
                Monthly warehouse billing should summarize by client instead of by PO line. This first pass keeps every client visible and gives us a place to tune inbound, outbound, and storage pallet fees before the source counts are wired in.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="warning">UI first pass</Badge>
              <Badge variant="secondary">
                Billing window {formatDateLabel(startDate)} to {formatDateLabel(endDate)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-4 py-4">
            <div className="rounded-md border border-[rgb(var(--accent))]/20 bg-[color-mix(in_oklab,rgb(var(--accent))_6%,white)] p-4">
              <div className="text-sm font-medium text-[rgb(var(--foreground))]">Planned monthly formula</div>
              <div className="mt-2 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Inbound</div>
                  <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">Inbound pallets x client inbound fee</div>
                </div>
                <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Outbound</div>
                  <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">Outbound pallets x client outbound fee</div>
                </div>
                <div className="rounded-lg border border-[rgb(var(--border))] bg-white px-3 py-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Storage</div>
                  <div className="mt-2 text-sm font-medium text-[rgb(var(--foreground))]">Active storage pallets x monthly storage fee</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                metricCard("Clients In Scope", warehouseSummary.clientCount.toLocaleString(), "All currently visible customers stay on the warehouse worksheet for now.", "default"),
                metricCard("Included", warehouseSummary.includedCount.toLocaleString(), warehouseSummary.excludedCount ? (warehouseSummary.excludedCount.toLocaleString() + " hidden from the worksheet draft.") : "Every client remains included in the draft.", warehouseSummary.excludedCount ? "warning" : "success"),
                metricCard("Custom Fee Rows", warehouseSummary.nonDefaultCount.toLocaleString(), warehouseSummary.nonDefaultCount ? "Rows with non-default fees, notes, or inclusion changes." : "All rows still use the default fee profile.", warehouseSummary.nonDefaultCount ? "info" : "default"),
                metricCard("Zero-Rate Rows", warehouseSummary.zeroRateCount.toLocaleString(), warehouseSummary.zeroRateCount ? "Useful for non-paying clients that should remain visible." : "No clients have all warehouse fees zeroed out.", warehouseSummary.zeroRateCount ? "warning" : "default")
              ]}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
          <Card>
            <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] pb-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">Fee Structure By Client</div>
                <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                  Default every client to $7.50 inbound per pallet, $7.50 outbound per pallet, and $9.00 monthly storage per pallet. This draft is local UI state only for now.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{warehouseClientRows.length.toLocaleString()} clients</Badge>
                <Button onClick={resetWarehouseFeeDrafts} variant="outline" size="sm" disabled={!warehouseClientRows.length}>
                  Reset To Defaults
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0 py-0">
              <TableShell className="rounded-none border-x-0 border-b-0">
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                      <tr className="border-b border-[rgb(var(--border))]">
                        <th className="px-4 py-3 text-center font-medium">Include</th>
                        <th className="px-4 py-3 text-left font-medium">Client</th>
                        <th className="px-4 py-3 text-right font-medium">Inbound / Pallet</th>
                        <th className="px-4 py-3 text-right font-medium">Outbound / Pallet</th>
                        <th className="px-4 py-3 text-right font-medium">Storage / Pallet / Mo</th>
                        <th className="px-4 py-3 text-left font-medium">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouseClientRows.length ? warehouseClientRows.map(function(row) {
                        return (
                          <tr key={"warehouse-fee-" + row.customer} className="border-t border-[rgb(var(--border))] align-top odd:bg-[color-mix(in_oklab,rgb(var(--surface))_40%,white)]">
                            <td className="px-4 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={!!row.included}
                                onChange={function(event) {
                                  updateWarehouseFeeDraft(row.customer, "included", !!event.target.checked);
                                }}
                                aria-label={"Include warehouse invoicing row for " + row.customer}
                              />
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-medium text-[rgb(var(--foreground))]">{row.customer}</div>
                              <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                                {row.included ? "Included in draft worksheet" : "Hidden from draft worksheet"}
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                value={row.inboundRate}
                                onChange={function(event) { updateWarehouseFeeDraft(row.customer, "inboundRate", event.target.value); }}
                                inputMode="decimal"
                                className="h-8 min-w-[108px] text-right text-xs"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                value={row.outboundRate}
                                onChange={function(event) { updateWarehouseFeeDraft(row.customer, "outboundRate", event.target.value); }}
                                inputMode="decimal"
                                className="h-8 min-w-[108px] text-right text-xs"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                value={row.storageRate}
                                onChange={function(event) { updateWarehouseFeeDraft(row.customer, "storageRate", event.target.value); }}
                                inputMode="decimal"
                                className="h-8 min-w-[108px] text-right text-xs"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <Input
                                value={row.note}
                                onChange={function(event) { updateWarehouseFeeDraft(row.customer, "note", event.target.value); }}
                                placeholder="Optional note"
                                className="h-8 min-w-[180px] text-xs"
                              />
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
                            No customer names are available from the current invoicing dataset yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </TableShell>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-[rgb(var(--border))] pb-3">
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">Next Data Layer</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                This tab is ready for the warehouse counts once we wire them into the invoicing APIs.
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-4 py-4 text-sm text-[rgb(var(--muted))]">
              <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3">
                Monthly worksheet rows should roll up by client instead of by PO, SKU, and lot.
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3">
                Warehouse counts will eventually come from inbound transfers, outbound transfers, and pallet storage billing data.
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3">
                The same month picker at the top will define the warehouse billing window once those source counts are available.
              </div>
              <div className="rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-3 text-xs">
                Draft only: fee edits here are not persisted yet and do not create invoice lines or QuickBooks exports.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {invoiceModeSwitcher}

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
            <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
              Review billable production for a billing period, surface lines that need cleanup, and export invoice-ready summaries or detail rows.
            </div>
            <div className="mt-2 max-w-3xl text-xs text-[rgb(var(--muted))]">
              Candidates in this view are derived from production output. They do not yet reconcile against posted or open invoice records. Switch to `Warehousing` to stage monthly pallet fee logic by client.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={exportSummaryCsv} variant="default" size="sm">
              <Download className="h-4 w-4" />
              Export Summary
            </Button>
            <Button onClick={exportDetailCsv} variant="outline" size="sm">
              <Download className="h-4 w-4" />
              Export Detail
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{filteredRows.length.toLocaleString()} production rows in period</Badge>
            <Badge variant={summary.reviewLines > 0 ? "warning" : "success"}>
              {summary.readyLines.toLocaleString()} ready / {summary.reviewLines.toLocaleString()} review
            </Badge>
            <Badge variant={summary.revenueCoveragePct >= 100 ? "success" : summary.revenueCoveragePct > 0 ? "warning" : "danger"}>
              Revenue coverage {summary.revenueCoveragePct}%
            </Badge>
            <Badge variant={coverageAudit.lotCoveragePct >= 100 ? "success" : coverageAudit.lotCoveragePct > 0 ? "warning" : "danger"}>
              Lot coverage {coverageAudit.lotCoveragePct}%
            </Badge>
            <Badge variant={coverageAudit.unitOfMeasureCoveragePct >= 100 ? "success" : coverageAudit.unitOfMeasureCoveragePct > 0 ? "warning" : "danger"}>
              UOM coverage {coverageAudit.unitOfMeasureCoveragePct}%
            </Badge>
            {revenueConfigQuery.isError ? (
              <Badge variant="danger">Revenue config unavailable</Badge>
            ) : revenueConfigQuery.isLoading ? (
              <Badge variant="secondary">Loading revenue config</Badge>
            ) : null}
            {productionHistoryQuery.isFetching ? (
              <Badge variant="secondary">Refreshing production history</Badge>
            ) : null}
            {productionSyncTimestamp ? (
              <Badge variant="secondary">
                {productionHistory.querySource === "production_events" ? "History synced " : "Production synced "}
                {new Date(productionSyncTimestamp).toLocaleString()}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Start Date</div>
                <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">End Date</div>
                <DatePicker value={endDate} onChange={setEndDate} placeholder="End date" className="w-full" />
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Customer</div>
                <select
                  value={customerFilter}
                  onChange={function(event) {
                    setCustomerFilter(event.target.value);
                  }}
                  className="flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1"
                >
                  <option value="all">All customers</option>
                  {customerOptions.map(function(customer) {
                    return (
                      <option key={customer} value={customer}>{customer}</option>
                    );
                  })}
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Workflow Status</div>
                <select
                  value={statusFilter}
                  onChange={function(event) {
                    setStatusFilter(event.target.value);
                  }}
                  className="flex h-9 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1"
                >
                  <option value="all">All lines</option>
                  <option value="ready">Ready</option>
                  <option value="review">Needs review</option>
                </select>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Search</div>
                <Input
                  value={searchTerm}
                  onChange={function(event) {
                    setSearchTerm(event.target.value);
                  }}
                  placeholder="Customer, SKU, lot, PO, rate, WO, job..."
                />
              </div>
            </div>

            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-3">
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Quick Periods</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={applyCurrentMonth} variant="outline" size="sm">Current Month</Button>
                <Button onClick={applyPreviousMonth} variant="outline" size="sm">Previous Month</Button>
                <Button onClick={clearFilters} variant="ghost" size="sm">
                  <FilterX className="h-4 w-4" />
                  Reset
                </Button>
              </div>
              <div className="mt-3 text-sm text-[rgb(var(--muted))]">
                Available production dates: <span className="font-medium text-[rgb(var(--foreground))]">{formatDateLabel(availableDateRange.min)}</span> to{" "}
                <span className="font-medium text-[rgb(var(--foreground))]">{formatDateLabel(availableDateRange.max)}</span>
              </div>
            </div>
          </div>

          {coverageAudit.totalRows ? (
            <div className={
              "rounded-md border p-3 " +
              ((coverageAudit.rowsMissingLotCode || coverageAudit.rowsMissingUnitOfMeasure)
                ? "border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)]"
                : "border-[rgb(var(--success))]/20 bg-[color-mix(in_oklab,rgb(var(--success))_7%,white)]")
            }>
              <div className="text-xs font-medium uppercase tracking-[0.12em] text-[rgb(var(--muted))]">Production Events Audit</div>
              <div className="mt-2 text-sm text-[rgb(var(--foreground))]">
                Stored production history for this billing window is {coverageAudit.lotCoveragePct}% populated for lot code and {coverageAudit.unitOfMeasureCoveragePct}% populated for unit of measure.
                {(coverageAudit.rowsMissingLotCode || coverageAudit.rowsMissingUnitOfMeasure)
                  ? " " + coverageAudit.rowsMissingBoth.toLocaleString() + " row" + (coverageAudit.rowsMissingBoth === 1 ? "" : "s") + " are missing both fields."
                  : " No lot or UOM gaps were detected in this window."}
              </div>
              {(coverageAudit.rowsMissingLotCode || coverageAudit.rowsMissingUnitOfMeasure) ? (
                <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                  {coverageAudit.topMissingDates.length ? (
                    <div>Top dates: {formatCoverageHotspots(coverageAudit.topMissingDates, "date")}</div>
                  ) : null}
                  {coverageAudit.topMissingWorkOrders.length ? (
                    <div>Top work orders: {formatCoverageHotspots(coverageAudit.topMissingWorkOrders, "workOrder")}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {[
          metricCard("Units Produced", formatUnits(summary.unitsProduced), "Finished-good output in the selected billing window.", "default"),
          metricCard("Customers", summary.customers.toLocaleString(), "Distinct customers represented in visible invoice lines.", "default"),
          metricCard("Invoice Lines", summary.invoiceLines.toLocaleString(), "Customer, PO, SKU, lot, and rate line items ready for accounting review.", "success"),
          metricCard("Estimated Revenue", formatMoney(summary.estimatedRevenue), summary.revenueCoveragePct >= 100 ? "All visible units have revenue coverage." : "Based on priced units only; uncovered units remain excluded.", summary.revenueCoveragePct >= 100 ? "success" : "warning"),
          metricCard("Revenue Coverage", summary.revenueCoveragePct + "%", summary.pricedUnits ? (formatUnits(summary.pricedUnits) + " priced units in the current result set.") : "No priced units found for the current result set.", summary.revenueCoveragePct >= 100 ? "success" : "warning"),
          metricCard("Needs Review", summary.reviewLines.toLocaleString(), summary.reviewLines ? "Lines missing traceability or billing fields." : "No blockers in the current result set.", summary.reviewLines ? "warning" : "success"),
        ]}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] pb-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">QuickBooks Preview</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Select export-ready invoice candidates, preview draft invoices grouped by customer and purchase order, then create them in QuickBooks when the review looks right.
              </div>
            </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={selectedCandidateCount ? "info" : "secondary"}>
              {selectedCandidateCount.toLocaleString()} selected
            </Badge>
            {Number(quickBooksPersistence.summary.alreadyPushedCount || 0) ? (
              <Badge variant="warning">{Number(quickBooksPersistence.summary.alreadyPushedCount || 0).toLocaleString()} already pushed</Badge>
            ) : null}
            {Number(quickBooksPersistence.summary.missingCustomerMappings || 0) || Number(quickBooksPersistence.summary.missingItemMappings || 0) ? (
              <Badge variant="warning">
                {(Number(quickBooksPersistence.summary.missingCustomerMappings || 0) + Number(quickBooksPersistence.summary.missingItemMappings || 0)).toLocaleString()} mapping gap{(Number(quickBooksPersistence.summary.missingCustomerMappings || 0) + Number(quickBooksPersistence.summary.missingItemMappings || 0)) === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {selectedReviewCandidateCount ? (
              <Badge variant="warning">{selectedReviewCandidateCount.toLocaleString()} needs review</Badge>
            ) : null}
            {selectedQuickBooksBlockedCount ? (
              <Badge variant="warning">{selectedQuickBooksBlockedCount.toLocaleString()} blocked for QuickBooks</Badge>
            ) : null}
            <Button
              onClick={function() {
                toggleVisibleReadySelection(!allVisibleReadySelected);
              }}
              variant="outline"
              size="sm"
              disabled={!visibleReadyCandidates.length}
            >
              {allVisibleReadySelected ? "Unselect Visible Export-Ready" : "Select Visible Export-Ready"}
            </Button>
            <Button onClick={clearSelectedCandidates} variant="ghost" size="sm" disabled={!selectedCandidateCount}>
              Clear Selection
            </Button>
            <Button onClick={buildInvoicePreview} variant="default" size="sm" disabled={!selectedReadyCandidateCount || invoicePreviewState.loading}>
              {invoicePreviewState.loading ? "Building Preview..." : "Preview QuickBooks Draft"}
            </Button>
            <Button
              onClick={createInvoicesInQuickBooks}
              variant="outline"
              size="sm"
              disabled={!quickBooksConnection.connected || !(invoicePreviewState.data && Array.isArray(invoicePreviewState.data.invoiceGroups) && invoicePreviewState.data.invoiceGroups.length) || invoicePreviewState.loading || invoiceExportState.loading}
            >
              {invoiceExportState.loading ? "Creating In QuickBooks..." : "Create In QuickBooks"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          {quickBooksPersistenceQuery.error ? (
            <div className="rounded-md border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-4 text-sm text-[rgb(var(--foreground))]">
              Could not load QuickBooks persistence state. Preview still works, but duplicate detection and mapping checks are unavailable right now.
            </div>
          ) : null}

          {!quickBooksPersistenceQuery.error && Array.isArray(quickBooksPersistence.warnings) && quickBooksPersistence.warnings.length ? (
            <div className="rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-4">
              <div className="text-sm font-medium text-[rgb(var(--foreground))]">QuickBooks Persistence Setup</div>
              <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                {quickBooksPersistence.warnings.map(function(warning, index) {
                  return <div key={"qbo-warning-" + index}>{warning}</div>;
                })}
              </div>
            </div>
          ) : null}

          {quickBooksConnectionQuery.error ? (
            <div className="rounded-md border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-4 text-sm text-[rgb(var(--foreground))]">
              Could not load QuickBooks connection status. OAuth setup and master-data sync are unavailable right now.
            </div>
          ) : (
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-[rgb(var(--foreground))]">QuickBooks Connection</div>
                  <div className="mt-1 text-xs text-[rgb(var(--muted))]">
                    {quickBooksConnection.connected
                      ? ((quickBooksConnection.connection.companyName || ("Realm " + (quickBooksConnection.connection.realmId || "--"))) + " connected in " + quickBooksConnection.connection.environment + ".")
                      : "Connect QuickBooks, then sync customers, items, and terms so PackPulse can auto-fill invoice mappings."}
                  </div>
                  {quickBooksConnection.connected && quickBooksConnection.connection.lastSyncedAt ? (
                    <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                      Last synced {formatDateTimeLabel(quickBooksConnection.connection.lastSyncedAt)}.
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={!quickBooksConnection.configured ? "warning" : quickBooksConnection.connected ? "success" : "secondary"}>
                    {!quickBooksConnection.configured ? "Needs QBO Env" : quickBooksConnection.connected ? "Connected" : "Not Connected"}
                  </Badge>
                  {quickBooksConnection.connected && quickBooksConnection.connection.lastSyncStatus === "ok" ? (
                    <Badge variant="info">Catalog synced</Badge>
                  ) : null}
                  <Button onClick={beginQuickBooksConnect} variant={quickBooksConnection.connected ? "outline" : "default"} size="sm" disabled={!quickBooksConnection.configured}>
                    {quickBooksConnection.connected ? "Reconnect QuickBooks" : "Connect QuickBooks"}
                  </Button>
                  <Button onClick={runQuickBooksMasterSync} variant="outline" size="sm" disabled={!quickBooksConnection.connected || quickBooksSyncState.loading}>
                    {quickBooksSyncState.loading ? "Syncing QBO Master Data..." : "Sync QBO Master Data"}
                  </Button>
                </div>
              </div>

              {!quickBooksConnectionQuery.error && Array.isArray(quickBooksConnection.warnings) && quickBooksConnection.warnings.length ? (
                <div className="mt-3 rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-3">
                  <div className="space-y-1 text-xs text-[rgb(var(--muted))]">
                    {quickBooksConnection.warnings.map(function(warning, index) {
                      return <div key={"qbo-connection-warning-" + index}>{warning}</div>;
                    })}
                  </div>
                </div>
              ) : null}

              {quickBooksNotice.message ? (
                <div className={
                  "mt-3 rounded-md border p-3 text-sm " +
                  (quickBooksNotice.tone === "success"
                    ? "border-[rgb(var(--success))]/20 bg-[color-mix(in_oklab,rgb(var(--success))_8%,white)] text-[rgb(var(--foreground))]"
                    : "border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] text-[rgb(var(--foreground))]")
                }>
                  {quickBooksNotice.message}
                </div>
              ) : null}

              {quickBooksSyncState.error ? (
                <div className="mt-3 rounded-md border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-3 text-sm text-[rgb(var(--foreground))]">
                  {quickBooksSyncState.error}
                </div>
              ) : null}

              {quickBooksConnection.connected ? (
                <div className="mt-3 grid gap-3 md:grid-cols-4">
                  {[
                    metricCard("QBO Customers", quickBooksConnectionSummary.customerCatalogCount.toLocaleString(), "Customer records stored from the latest QuickBooks sync.", "default"),
                    metricCard("QBO Items", quickBooksConnectionSummary.itemCatalogCount.toLocaleString(), "Item records stored from the latest QuickBooks sync.", "default"),
                    metricCard("Auto-Mapped", (quickBooksConnectionSummary.customerMappingsCreated + quickBooksConnectionSummary.customerMappingsUpdated + quickBooksConnectionSummary.itemMappingsCreated + quickBooksConnectionSummary.itemMappingsUpdated + quickBooksConnectionSummary.termMappingsCreated + quickBooksConnectionSummary.termMappingsUpdated).toLocaleString(), "Mappings created or refreshed from exact QuickBooks matches.", "success"),
                    metricCard("Manual Review", (quickBooksConnectionSummary.customerMappingsUnresolved + quickBooksConnectionSummary.itemMappingsUnresolved + quickBooksConnectionSummary.termMappingsUnresolved).toLocaleString(), quickBooksConnectionSummary.preservedMappings ? (quickBooksConnectionSummary.preservedMappings.toLocaleString() + " existing mapping" + (quickBooksConnectionSummary.preservedMappings === 1 ? "" : "s") + " preserved.") : "Only edge cases should remain after sync.", (quickBooksConnectionSummary.customerMappingsUnresolved + quickBooksConnectionSummary.itemMappingsUnresolved + quickBooksConnectionSummary.termMappingsUnresolved) ? "warning" : "success")
                  ]}
                </div>
              ) : null}

              {quickBooksConnection.connected && (quickBooksConnectionSummary.unresolvedCustomers.length || quickBooksConnectionSummary.unresolvedItems.length || quickBooksConnectionSummary.unresolvedTerms.length) ? (
                <div className="mt-3 rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-3">
                  <div className="text-sm font-medium text-[rgb(var(--foreground))]">Manual Review Queue</div>
                  <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                    {quickBooksConnectionSummary.unresolvedCustomers.length ? (
                      <div>Customers: {quickBooksConnectionSummary.unresolvedCustomers.join("; ")}</div>
                    ) : null}
                    {quickBooksConnectionSummary.unresolvedItems.length ? (
                      <div>Items: {quickBooksConnectionSummary.unresolvedItems.join("; ")}</div>
                    ) : null}
                    {quickBooksConnectionSummary.unresolvedTerms.length ? (
                      <div>Terms: {quickBooksConnectionSummary.unresolvedTerms.join("; ")}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {!selectedCandidateCount ? (
            <div className="rounded-md border border-dashed border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_70%,white)] p-4 text-sm text-[rgb(var(--muted))]">
              Select export-ready invoice candidates from the table below to build a QuickBooks draft preview.
            </div>
          ) : null}

          {selectedCandidateCount ? (
            <div className="grid gap-3 md:grid-cols-4">
              {[
                metricCard("Selected Lines", selectedCandidateCount.toLocaleString(), "Invoice candidates currently selected for preview.", "default"),
                metricCard("Selected Units", formatUnits(selectedInvoiceCandidates.reduce(function(sum, candidate) { return sum + candidate.unitsProduced; }, 0)), "Total billed quantity across selected candidates.", "default"),
                metricCard("Selected Revenue", formatMoney(selectedInvoiceCandidates.reduce(function(sum, candidate) { return sum + candidate.estimatedRevenue; }, 0)), "Estimated invoice amount from the selected candidates.", "success"),
                metricCard("Selected Exportable", selectedReadyCandidateCount.toLocaleString(), selectedReviewCandidateCount ? "Some selected candidates still need invoice review." : (selectedQuickBooksBlockedCount ? "Some selected candidates are blocked by QuickBooks mappings or prior exports." : "All selected candidates are export-ready."), (selectedReviewCandidateCount || selectedQuickBooksBlockedCount) ? "warning" : "success")
              ]}
            </div>
          ) : null}

          {invoicePreviewState.error ? (
            <div className="rounded-md border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-4 text-sm text-[rgb(var(--foreground))]">
              {invoicePreviewState.error}
            </div>
          ) : null}

          {invoiceExportState.error ? (
            <div className="rounded-md border border-[rgb(var(--danger))]/20 bg-[color-mix(in_oklab,rgb(var(--danger))_6%,white)] p-4 text-sm text-[rgb(var(--foreground))]">
              {invoiceExportState.error}
            </div>
          ) : null}

          {invoicePreviewState.data && Array.isArray(invoicePreviewState.data.validationIssues) && invoicePreviewState.data.validationIssues.length ? (
            <div className="rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-4">
              <div className="text-sm font-medium text-[rgb(var(--foreground))]">Validation Issues</div>
              <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                {invoicePreviewState.data.validationIssues.map(function(issue, index) {
                  return <div key={String(issue && issue.key || "issue") + "-" + index}>{issue && issue.message ? issue.message : "Unknown preview issue."}</div>;
                })}
              </div>
            </div>
          ) : null}

          {invoiceExportState.data ? (
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={Number(invoiceExportState.data.failedCount || 0) ? "warning" : "success"}>
                  {Number(invoiceExportState.data.createdCount || 0).toLocaleString()} created
                </Badge>
                {Number(invoiceExportState.data.failedCount || 0) ? (
                  <Badge variant="warning">{Number(invoiceExportState.data.failedCount || 0).toLocaleString()} failed</Badge>
                ) : null}
                {Array.isArray(invoiceExportState.data.warnings) && invoiceExportState.data.warnings.length ? (
                  <Badge variant="secondary">{invoiceExportState.data.warnings.length.toLocaleString()} warning{invoiceExportState.data.warnings.length === 1 ? "" : "s"}</Badge>
                ) : null}
              </div>
              {Array.isArray(invoiceExportState.data.warnings) && invoiceExportState.data.warnings.length ? (
                <div className="mt-3 space-y-1 text-xs text-[rgb(var(--muted))]">
                  {invoiceExportState.data.warnings.map(function(warning, index) {
                    return <div key={"qbo-export-warning-" + index}>{warning}</div>;
                  })}
                </div>
              ) : null}
              {Array.isArray(invoiceExportState.data.createdInvoices) && invoiceExportState.data.createdInvoices.length ? (
                <div className="mt-3 rounded-md border border-[rgb(var(--success))]/20 bg-[color-mix(in_oklab,rgb(var(--success))_8%,white)] p-3">
                  <div className="text-sm font-medium text-[rgb(var(--foreground))]">Created Invoices</div>
                  <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                    {invoiceExportState.data.createdInvoices.map(function(group) {
                      var docLabel = group.externalDocNumber ? ("Invoice " + group.externalDocNumber) : (group.externalInvoiceId ? ("QBO ID " + group.externalInvoiceId) : "Created");
                      return (
                        <div key={"created-invoice-" + group.key}>
                          {group.customer} | PO {group.purchaseOrderNumber || "--"} | {docLabel}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              {Array.isArray(invoiceExportState.data.failedInvoices) && invoiceExportState.data.failedInvoices.length ? (
                <div className="mt-3 rounded-md border border-[rgb(var(--warning))]/25 bg-[color-mix(in_oklab,rgb(var(--warning))_7%,white)] p-3">
                  <div className="text-sm font-medium text-[rgb(var(--foreground))]">Needs Follow-Up</div>
                  <div className="mt-2 space-y-1 text-xs text-[rgb(var(--muted))]">
                    {invoiceExportState.data.failedInvoices.map(function(group, index) {
                      return (
                        <div key={"failed-invoice-" + index}>
                          {group.customer} | PO {group.purchaseOrderNumber || "--"} | {group.message}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {invoicePreviewState.data && Array.isArray(invoicePreviewState.data.invoiceGroups) && invoicePreviewState.data.invoiceGroups.length ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{Number(invoicePreviewState.data.groupCount || 0).toLocaleString()} draft invoice{Number(invoicePreviewState.data.groupCount || 0) === 1 ? "" : "s"}</Badge>
                <Badge variant="info">{Number(invoicePreviewState.data.lineCount || 0).toLocaleString()} line{Number(invoicePreviewState.data.lineCount || 0) === 1 ? "" : "s"}</Badge>
                <Badge variant="secondary">{formatUnits(invoicePreviewState.data.totalUnits || 0)} units</Badge>
                <Badge variant="secondary">{formatMoney(invoicePreviewState.data.totalAmount || 0)}</Badge>
              </div>
              {invoicePreviewState.data.invoiceGroups.map(function(group) {
                return (
                  <div key={group.key} className="rounded-lg border border-[rgb(var(--border))] bg-white p-4">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{group.customer}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
                          <Badge variant="info">PO {group.purchaseOrderNumber || "--"}</Badge>
                          <span>{group.lineCount} line{group.lineCount === 1 ? "" : "s"}</span>
                          <span>{formatUnits(group.totalUnits)} units</span>
                          <span>{formatMoney(group.totalAmount)}</span>
                        </div>
                        {group.customerMemo ? (
                          <div className="mt-2 text-xs text-[rgb(var(--muted))]">Customer memo: {group.customerMemo}</div>
                        ) : null}
                      </div>
                      <div className="text-xs text-[rgb(var(--muted))]">
                        Invoice date {formatDateLabel(group.invoiceDate)}
                      </div>
                    </div>
                    <TableShell className="mt-3">
                      <div className="overflow-auto">
                        <table className="min-w-full text-xs">
                          <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">SKU / Description</th>
                              <th className="px-3 py-2 text-left font-medium">Lot / PO</th>
                              <th className="px-3 py-2 text-right font-medium">Qty</th>
                              <th className="px-3 py-2 text-right font-medium">Rate</th>
                              <th className="px-3 py-2 text-right font-medium">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {group.lines.map(function(line) {
                              return (
                                <tr key={line.key} className="border-t border-[rgb(var(--border))] align-top">
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-[rgb(var(--foreground))]">{line.sku}</div>
                                    <div className="mt-1 text-[rgb(var(--muted))]">{line.description}</div>
                                  </td>
                                  <td className="px-3 py-2 text-[rgb(var(--muted))]">
                                    <div className="font-mono text-[rgb(var(--foreground))]">{line.lotCode}</div>
                                    <div className="mt-1">PO {line.purchaseOrderNumber || "--"}</div>
                                    {line.workOrderSummary ? <div className="mt-1">{line.workOrderSummary}</div> : null}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--foreground))]">{formatUnits(line.unitsProduced)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-[rgb(var(--foreground))]">{formatMoney(line.revenuePerUnit)}</td>
                                  <td className="px-3 py-2 text-right tabular-nums font-medium text-[rgb(var(--foreground))]">{formatMoney(line.amount)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </TableShell>
                  </div>
                );
              })}
            </div>
          ) : null}

          {selectedCandidateCount && !invoicePreviewState.loading && !invoicePreviewState.error && !invoicePreviewState.data ? (
            <div className="rounded-md border border-dashed border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_70%,white)] p-4 text-sm text-[rgb(var(--muted))]">
              Preview has not been generated yet for the current selection.
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader className="border-b border-[rgb(var(--border))] pb-3">
            <div className="text-base font-semibold text-[rgb(var(--foreground))]">Customer Rollup</div>
            <div className="mt-1 text-sm text-[rgb(var(--muted))]">
              Select a customer to focus the invoice candidate list for that account.
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <TableShell className="rounded-none border-x-0 border-b-0">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Customer</th>
                      <th className="px-4 py-3 text-right font-medium">Units</th>
                      <th className="px-4 py-3 text-right font-medium">Revenue</th>
                      <th className="px-4 py-3 text-right font-medium">Lines</th>
                      <th className="px-4 py-3 text-right font-medium">Ready</th>
                      <th className="px-4 py-3 text-right font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerRollups.length ? customerRollups.map(function(row) {
                      var active = customerFilter === row.customer;
                      return (
                        <tr
                          key={row.customer}
                          className={"cursor-pointer border-t border-[rgb(var(--border))] " + (active ? "bg-[color-mix(in_oklab,rgb(var(--accent))_7%,white)]" : "hover:bg-[rgb(var(--surface))]")}
                          onClick={function() {
                            setCustomerFilter(active ? "all" : row.customer);
                          }}
                        >
                          <td className="px-4 py-3 font-medium text-[rgb(var(--foreground))]">
                            <div className="flex items-center gap-2">
                              <span>{row.customer}</span>
                              {active ? <Badge variant="info">Focused</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{formatUnits(row.unitsProduced)}</td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{formatMoney(row.estimatedRevenue)}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{row.invoiceLines.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--success))]">{row.readyLines.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--warning))]">{row.reviewLines.toLocaleString()}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
                          No customers match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TableShell>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-[rgb(var(--border))] pb-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">Invoice Candidates</div>
                <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                  {customerFilter === "all"
                    ? "Grouped by customer, purchase order, SKU, finished-good lot, and billed rate for the selected billing period. Work orders roll up for audit."
                    : ("Focused on " + customerFilter + ".")}
                </div>
                <div className="mt-2 text-xs text-[rgb(var(--muted))]">
                  Page filters stay above. Table controls below only refine the invoice line grid and exports.
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {visibleInvoiceCandidates.length === statusScopedInvoiceCandidates.length
                    ? (visibleInvoiceCandidates.length.toLocaleString() + " line items")
                    : ("Showing " + visibleInvoiceCandidates.length.toLocaleString() + " of " + statusScopedInvoiceCandidates.length.toLocaleString())}
                </Badge>
                <Badge variant={selectedVisibleReadyCount ? "info" : "secondary"}>
                  {selectedVisibleReadyCount.toLocaleString()} visible ready selected
                </Badge>
                <Button
                  onClick={function() {
                    setShowCandidateColumnFilters(function(previous) { return !previous; });
                  }}
                  variant={showCandidateFilterRow ? "secondary" : "outline"}
                  size="sm"
                  disabled={hasActiveCandidateColumnFilters}
                >
                  {hasActiveCandidateColumnFilters ? "Filters Applied" : (showCandidateFilterRow ? "Hide Column Filters" : "Show Column Filters")}
                </Button>
                <Button onClick={clearCandidateTableControls} variant="ghost" size="sm" disabled={!hasActiveCandidateTableControls}>
                  Clear Table Controls
                </Button>
              </div>
            </div>
            {candidateControlChips.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {candidateControlChips.map(function(label) {
                  return <Badge key={label} variant="secondary">{label}</Badge>;
                })}
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="px-0 py-0">
            <TableShell className="rounded-none border-x-0 border-b-0">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                    <tr className="border-b border-[rgb(var(--border))]">
                      <th className="px-4 py-3 text-center font-medium">
                        <input
                          type="checkbox"
                          checked={allVisibleReadySelected}
                          onChange={function(event) {
                            toggleVisibleReadySelection(!!event.target.checked);
                          }}
                          aria-label="Select visible export-ready invoice candidates"
                        />
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("status"); }} className="w-full">
                          Status{candidateSortField === "status" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("customerSku"); }} className="w-full">
                          Customer / SKU{candidateSortField === "customerSku" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("unitsProduced"); }} className="w-full text-right">
                          Units{candidateSortField === "unitsProduced" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("revenuePerUnitAvg"); }} className="w-full text-right">
                          Rev/Unit{candidateSortField === "revenuePerUnitAvg" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("estimatedRevenue"); }} className="w-full text-right">
                          Est Revenue{candidateSortField === "estimatedRevenue" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("unitOfMeasure"); }} className="w-full">
                          UOM{candidateSortField === "unitOfMeasure" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("lotCode"); }} className="w-full">
                          Lot Code{candidateSortField === "lotCode" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("purchaseOrderReference"); }} className="w-full">
                          Purchase Order{candidateSortField === "purchaseOrderReference" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("workOrderReference"); }} className="w-full">
                          Work Order{candidateSortField === "workOrderReference" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("jobCount"); }} className="w-full text-right">
                          Jobs{candidateSortField === "jobCount" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        <SortHeaderButton onClick={function() { handleCandidateSort("period"); }} className="w-full">
                          Period{candidateSortField === "period" ? (candidateSortDir === "asc" ? " ↑" : " ↓") : ""}
                        </SortHeaderButton>
                      </th>
                    </tr>
                    {showCandidateFilterRow ? (
                      <tr className="border-b border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--surface))_72%,white)]">
                        <th className="px-4 py-3" />
                        <th className="px-4 py-3">
                          <select
                            value={candidateColumnFilters.status}
                            onChange={function(event) { updateCandidateColumnFilter("status", event.target.value); }}
                            className="flex h-8 w-full rounded-md border border-[rgb(var(--border))] bg-white px-2 text-xs text-[rgb(var(--foreground))] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent))] focus-visible:ring-offset-1"
                          >
                            <option value="all">Any</option>
                            <option value="ready">Ready</option>
                            <option value="review">Review</option>
                          </select>
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.customerSku}
                            onChange={function(event) { updateCandidateColumnFilter("customerSku", event.target.value); }}
                            placeholder="Filter..."
                            className="h-8 min-w-[180px] px-2 text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.minUnits}
                            onChange={function(event) { updateCandidateColumnFilter("minUnits", event.target.value); }}
                            placeholder="Min"
                            inputMode="decimal"
                            className="h-8 min-w-[88px] px-2 text-right text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.minRevenuePerUnit}
                            onChange={function(event) { updateCandidateColumnFilter("minRevenuePerUnit", event.target.value); }}
                            placeholder="Min"
                            inputMode="decimal"
                            className="h-8 min-w-[88px] px-2 text-right text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.minEstimatedRevenue}
                            onChange={function(event) { updateCandidateColumnFilter("minEstimatedRevenue", event.target.value); }}
                            placeholder="Min"
                            inputMode="decimal"
                            className="h-8 min-w-[96px] px-2 text-right text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.unitOfMeasure}
                            onChange={function(event) { updateCandidateColumnFilter("unitOfMeasure", event.target.value); }}
                            placeholder="Filter..."
                            className="h-8 min-w-[88px] px-2 text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.lotCode}
                            onChange={function(event) { updateCandidateColumnFilter("lotCode", event.target.value); }}
                            placeholder="Filter..."
                            className="h-8 min-w-[140px] px-2 text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.purchaseOrder}
                            onChange={function(event) { updateCandidateColumnFilter("purchaseOrder", event.target.value); }}
                            placeholder="Filter..."
                            className="h-8 min-w-[140px] px-2 text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.workOrder}
                            onChange={function(event) { updateCandidateColumnFilter("workOrder", event.target.value); }}
                            placeholder="Filter..."
                            className="h-8 min-w-[140px] px-2 text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.minJobs}
                            onChange={function(event) { updateCandidateColumnFilter("minJobs", event.target.value); }}
                            placeholder="Min"
                            inputMode="decimal"
                            className="h-8 min-w-[72px] px-2 text-right text-xs"
                          />
                        </th>
                        <th className="px-4 py-3">
                          <Input
                            value={candidateColumnFilters.period}
                            onChange={function(event) { updateCandidateColumnFilter("period", event.target.value); }}
                            placeholder="YYYY-MM-DD"
                            className="h-8 min-w-[120px] px-2 text-xs"
                          />
                        </th>
                      </tr>
                    ) : null}
                  </thead>
                  <tbody>
                    {visibleInvoiceCandidates.length ? visibleInvoiceCandidates.map(function(candidate) {
                      var statusMeta = candidateStatusMeta(candidate.status);
                      var selectable = candidateCanPreviewQuickBooks(candidate);
                      var quickBooksMeta = quickBooksStateMeta(candidate.quickBooksState);
                      return (
                        <tr
                          key={candidate.key}
                          className="border-t border-[rgb(var(--border))] align-top hover:bg-[rgb(var(--surface))] odd:bg-[color-mix(in_oklab,rgb(var(--surface))_40%,white)]"
                        >
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={!!selectedCandidateKeys[candidate.key]}
                              disabled={!selectable}
                              onChange={function(event) {
                                toggleCandidateSelection(candidate.key, !!event.target.checked);
                              }}
                              aria-label={"Select invoice candidate " + candidate.customer + " " + candidate.purchaseOrderReference + " " + candidate.sku}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[rgb(var(--foreground))]">
                              {candidate.customer} | {candidate.sku}
                            </div>
                            <div className="mt-1 text-xs text-[rgb(var(--muted))]">{candidate.description}</div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                              <Badge variant={revenueSourceMeta(candidate.revenueSource).variant}>{revenueSourceMeta(candidate.revenueSource).label}</Badge>
                              {quickBooksMeta ? <Badge variant={quickBooksMeta.variant}>{quickBooksMeta.label}</Badge> : null}
                              {candidate.externalDocNumber ? <span className="text-[rgb(var(--muted))]">QB #{candidate.externalDocNumber}</span> : null}
                              <span className="text-[rgb(var(--muted))]">{candidate.revenueCoveragePct}% coverage</span>
                            </div>
                            {candidate.issueSummary ? (
                              <div className="mt-2 text-xs text-[rgb(var(--muted))]">{candidate.issueSummary}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-[rgb(var(--foreground))]">{formatUnits(candidate.unitsProduced)}</td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-[rgb(var(--foreground))]">
                            {candidate.pricedUnits > 0 ? formatMoney(candidate.revenuePerUnitAvg) : "--"}
                          </td>
                          <td className="px-4 py-3 text-right font-medium tabular-nums text-[rgb(var(--foreground))]">{candidate.pricedUnits > 0 ? formatMoney(candidate.estimatedRevenue) : "--"}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">{candidate.unitOfMeasure}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[rgb(var(--foreground))]">{candidate.lotCode}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[rgb(var(--foreground))]">{candidate.purchaseOrderReference}</td>
                          <td className="px-4 py-3 font-mono text-xs text-[rgb(var(--foreground))]">{candidate.workOrderReference}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-[rgb(var(--muted))]">{candidate.jobCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">
                            {formatDateLabel(candidate.firstProducedDate)} to {formatDateLabel(candidate.lastProducedDate)}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={12} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
                          {statusScopedInvoiceCandidates.length
                            ? "No invoice candidates match the current table controls."
                            : "No invoice candidates match the current filters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TableShell>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
