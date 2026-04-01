import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FilterX } from "lucide-react";

import { formatDescriptionForDisplay, safeNum, triggerDownload } from "../utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { DatePicker } from "../components/ui/date-picker";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";

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
var moneyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeGroupValue(value) {
  return normalizeSearchValue(value).replace(/\.0+$/, "").replace(/\s+/g, " ");
}

function normalizeLookupKey(value) {
  var raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\.0+$/, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeItemCode(value) {
  return normalizeLookupKey(value);
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

function revenueSourceMeta(source) {
  if (source === "pricing") return { label: "Pricing", variant: "success" };
  if (source === "item_master_cost_per_unit") return { label: "Item Master Fallback", variant: "info" };
  if (source === "mixed") return { label: "Mixed Sources", variant: "warning" };
  return { label: "Missing", variant: "danger" };
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

function normalizeRevenueConfigPayload(body) {
  return {
    skuTargets: body && Array.isArray(body.skuTargets) ? body.skuTargets : [],
    itemMasterCostBySku: body && body.itemMasterCostBySku && typeof body.itemMasterCostBySku === "object"
      ? body.itemMasterCostBySku
      : {}
  };
}

async function fetchInvoicingRevenueConfig() {
  var result = await fetchJsonWithCredentials("/api/ops/config");
  return normalizeRevenueConfigPayload(result.response.ok ? result.body : {});
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
    addIndexedValue(customerByWorkOrder, workOrderCode, customer);
    addIndexedValue(customerByWorkOrder, workOrderId, customer);
    addIndexedValue(unitByWorkOrder, workOrderCode, unitOfMeasure);
    addIndexedValue(unitByWorkOrder, workOrderId, unitOfMeasure);
    addIndexedValue(customerBySku, sku, customer);
    addIndexedValue(unitBySku, sku, unitOfMeasure);
  });

  return {
    customerByWorkOrder: customerByWorkOrder,
    customerBySku: customerBySku,
    unitByWorkOrder: unitByWorkOrder,
    unitBySku: unitBySku
  };
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

  var [startDate, setStartDate] = useState(String(initialFilters.start || defaults.start || ""));
  var [endDate, setEndDate] = useState(String(initialFilters.end || defaults.end || ""));
  var [customerFilter, setCustomerFilter] = useState(String(initialFilters.customer || "all"));
  var [statusFilter, setStatusFilter] = useState(String(initialFilters.status || "all"));
  var [searchTerm, setSearchTerm] = useState(String(initialFilters.q || ""));

  var deferredSearchTerm = useDeferredValue(searchTerm);

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      start: startDate || "",
      end: endDate || "",
      customer: customerFilter || "all",
      status: statusFilter || "all",
      q: searchTerm || ""
    });
  }, [onPermalinkChange, startDate, endDate, customerFilter, statusFilter, searchTerm]);

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

  var fieldFallbacks = useMemo(function() {
    var workOrderFallbacks = buildWorkOrderFallbacks(workOrders);
    return {
      customerByWorkOrder: workOrderFallbacks.customerByWorkOrder,
      customerBySku: workOrderFallbacks.customerBySku,
      unitByWorkOrder: workOrderFallbacks.unitByWorkOrder,
      unitBySku: workOrderFallbacks.unitBySku,
      itemMasterCustomerBySku: buildItemMasterCustomerIndex(itemMaster)
    };
  }, [workOrders, itemMaster]);

  var normalizedRows = useMemo(function() {
    return productionData
      .map(function(row, index) {
        var normalized = buildNormalizedProductionRow(row, index, fieldFallbacks);
        normalized.searchHaystack = buildSearchHaystack(normalized);
        normalized.candidateKey = [
          normalized.customerKey,
          normalized.skuKey,
          normalized.workOrderKey,
          normalized.purchaseOrderKey
        ].join("|");
        return normalized;
      })
      .filter(function(row) {
        return row.unitsProduced > 0;
      });
  }, [productionData, fieldFallbacks]);

  var revenueReadyRows = useMemo(function() {
    return normalizedRows.map(function(row) {
      var revenueMatch = resolveRevenuePerUnit(row.itemCodeRaw || row.sku, row.producedDate, revenueTargetsBySku, itemMasterCostBySku);
      var revenuePerUnit = safeNum(revenueMatch && revenueMatch.value);
      return Object.assign({}, row, {
        revenuePerUnit: revenuePerUnit,
        revenueSource: revenueMatch && revenueMatch.source ? revenueMatch.source : "missing",
        estimatedRevenue: revenuePerUnit > 0 ? row.unitsProduced * revenuePerUnit : 0
      });
    });
  }, [normalizedRows, revenueTargetsBySku, itemMasterCostBySku]);

  var availableDateRange = useMemo(function() {
    return revenueReadyRows.reduce(function(acc, row) {
      if (!row.producedDate) return acc;
      return {
        min: updateMinDate(acc.min, row.producedDate),
        max: updateMaxDate(acc.max, row.producedDate)
      };
    }, { min: "", max: "" });
  }, [revenueReadyRows]);

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

  var invoiceCandidates = useMemo(function() {
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
          workOrders: new Set(),
          purchaseOrders: new Set(),
          jobs: new Set(),
          lines: new Set(),
          unitMeasures: new Set(),
          missingProducedDateRows: 0,
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
      if (!group.unitMeasures.size) blockingIssues.push("Missing unit of measure");
      if (group.unitMeasures.size > 1) blockingIssues.push("Multiple unit measures in one invoice line");
      if (!group.workOrders.size) blockingIssues.push("No work order reference in the selected period");
      if (group.workOrders.size > 1) blockingIssues.push("Multiple work orders in one invoice line");
      if (!group.purchaseOrders.size) blockingIssues.push("No purchase order attached");
      if (group.purchaseOrders.size > 1) blockingIssues.push("Multiple purchase orders in one invoice line");

      if (group.missingPurchaseOrderRows > 0 && group.purchaseOrders.size > 0) advisoryIssues.push(group.missingPurchaseOrderRows + " " + pluralize(group.missingPurchaseOrderRows, "row") + " missing PO");
      if (group.missingWorkOrderRows > 0 && group.workOrders.size > 0) advisoryIssues.push(group.missingWorkOrderRows + " " + pluralize(group.missingWorkOrderRows, "row") + " missing work order");
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
      return {
        key: group.key,
        customer: group.customer,
        sku: group.sku,
        description: group.description,
        unitsProduced: group.unitsProduced,
        detailRows: group.detailRows,
        firstProducedDate: group.firstProducedDate,
        lastProducedDate: group.lastProducedDate,
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
    }).sort(function(left, right) {
      if (left.status !== right.status) return left.status === "review" ? -1 : 1;
      if (right.unitsProduced !== left.unitsProduced) return right.unitsProduced - left.unitsProduced;
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      if (left.workOrderReference !== right.workOrderReference) return left.workOrderReference.localeCompare(right.workOrderReference);
      return left.purchaseOrderReference.localeCompare(right.purchaseOrderReference);
    });
  }, [filteredRows]);

  var visibleInvoiceCandidates = useMemo(function() {
    return invoiceCandidates.filter(function(candidate) {
      if (statusFilter === "all") return true;
      return candidate.status === statusFilter;
    });
  }, [invoiceCandidates, statusFilter]);

  var visibleCandidateKeySet = useMemo(function() {
    var out = {};
    visibleInvoiceCandidates.forEach(function(candidate) {
      out[candidate.key] = true;
    });
    return out;
  }, [visibleInvoiceCandidates]);

  var customerRollups = useMemo(function() {
    var grouped = {};
    visibleInvoiceCandidates.forEach(function(candidate) {
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
  }, [visibleInvoiceCandidates]);

  var detailRows = useMemo(function() {
    var rows = filteredRows.filter(function(row) {
      if (!visibleCandidateKeySet[row.candidateKey]) return false;
      return true;
    }).slice();

    rows.sort(function(left, right) {
      if (left.producedDate !== right.producedDate) return String(right.producedDate || "").localeCompare(String(left.producedDate || ""));
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      return right.unitsProduced - left.unitsProduced;
    });
    return rows;
  }, [filteredRows, visibleCandidateKeySet]);

  var summary = useMemo(function() {
    var customers = {};
    var uniqueJobs = {};
    var readyCount = 0;
    var reviewCount = 0;
    var estimatedRevenue = 0;
    var pricedUnits = 0;
    var fallbackUnits = 0;
    visibleInvoiceCandidates.forEach(function(candidate) {
      customers[candidate.customer] = true;
      if (candidate.status === "review") reviewCount += 1;
      else readyCount += 1;
      estimatedRevenue += candidate.estimatedRevenue;
      pricedUnits += candidate.pricedUnits;
      if (candidate.revenueSource === "item_master_cost_per_unit" || candidate.revenueSource === "mixed") fallbackUnits += candidate.itemMasterFallbackUnits || 0;
    });
    detailRows.forEach(function(row) {
      if (row.jobId) uniqueJobs[row.jobId] = true;
    });
    var totalUnits = visibleInvoiceCandidates.reduce(function(sum, candidate) { return sum + candidate.unitsProduced; }, 0);
    return {
      unitsProduced: totalUnits,
      customers: Object.keys(customers).length,
      invoiceLines: visibleInvoiceCandidates.length,
      readyLines: readyCount,
      reviewLines: reviewCount,
      jobs: Object.keys(uniqueJobs).length,
      estimatedRevenue: estimatedRevenue,
      pricedUnits: pricedUnits,
      revenueCoveragePct: totalUnits > 0 ? Math.round((pricedUnits / totalUnits) * 100) : 0,
      fallbackUnits: fallbackUnits
    };
  }, [visibleInvoiceCandidates, detailRows]);

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
  }

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
      "work_order",
      "purchase_order",
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
        candidate.workOrderReference,
        candidate.purchaseOrderReference,
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

  if (!normalizedRows.length) {
    return (
      <Card className="mt-3">
        <CardContent className="px-4 py-5 text-sm text-[rgb(var(--muted))]">
          No production data is available yet. Run the Nulogy sync and include the Production report to build invoice candidates.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 border-b border-[rgb(var(--border))] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Invoicing Workflow</div>
            <div className="mt-1 max-w-3xl text-sm text-[rgb(var(--muted))]">
              Review customer SKU output for a billing period, surface lines that need cleanup, and export invoice-ready summaries or job-level detail.
            </div>
            <div className="mt-2 max-w-3xl text-xs text-[rgb(var(--muted))]">
              Candidates in this view are derived from production output. They do not yet reconcile against posted or open invoice records.
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
            {revenueConfigQuery.isError ? (
              <Badge variant="danger">Revenue config unavailable</Badge>
            ) : revenueConfigQuery.isLoading ? (
              <Badge variant="secondary">Loading revenue config</Badge>
            ) : null}
            {props.productionTimestamp ? (
              <Badge variant="secondary">Production synced {new Date(props.productionTimestamp).toLocaleString()}</Badge>
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
                  placeholder="Customer, SKU, WO, PO, job..."
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
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {[
          metricCard("Units Produced", formatUnits(summary.unitsProduced), "Finished-good output in the selected billing window.", "default"),
          metricCard("Customers", summary.customers.toLocaleString(), "Distinct customers represented in visible invoice lines.", "default"),
          metricCard("Invoice Lines", summary.invoiceLines.toLocaleString(), "Customer, SKU, WO, and PO line items ready for accounting review.", "success"),
          metricCard("Estimated Revenue", formatMoney(summary.estimatedRevenue), summary.revenueCoveragePct >= 100 ? "All visible units have revenue coverage." : "Based on priced units only; uncovered units remain excluded.", summary.revenueCoveragePct >= 100 ? "success" : "warning"),
          metricCard("Revenue Coverage", summary.revenueCoveragePct + "%", summary.pricedUnits ? (formatUnits(summary.pricedUnits) + " priced units in the current result set.") : "No priced units found for the current result set.", summary.revenueCoveragePct >= 100 ? "success" : "warning"),
          metricCard("Needs Review", summary.reviewLines.toLocaleString(), summary.reviewLines ? "Lines missing traceability or billing fields." : "No blockers in the current result set.", summary.reviewLines ? "warning" : "success"),
        ]}
      </div>

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
            <div>
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">Invoice Candidates</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                {customerFilter === "all"
                  ? "Grouped by customer, SKU, work order, and purchase order for the selected billing period."
                  : ("Focused on " + customerFilter + ".")}
              </div>
            </div>
          </CardHeader>
          <CardContent className="px-0 py-0">
            <TableShell className="rounded-none border-x-0 border-b-0">
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-left font-medium">Customer / SKU</th>
                      <th className="px-4 py-3 text-right font-medium">Units</th>
                      <th className="px-4 py-3 text-right font-medium">Rev/Unit</th>
                      <th className="px-4 py-3 text-right font-medium">Est Revenue</th>
                      <th className="px-4 py-3 text-left font-medium">UOM</th>
                      <th className="px-4 py-3 text-left font-medium">Work Order</th>
                      <th className="px-4 py-3 text-left font-medium">Purchase Order</th>
                      <th className="px-4 py-3 text-right font-medium">Jobs</th>
                      <th className="px-4 py-3 text-left font-medium">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoiceCandidates.length ? visibleInvoiceCandidates.map(function(candidate) {
                      var statusMeta = candidateStatusMeta(candidate.status);
                      return (
                        <tr
                          key={candidate.key}
                          className="border-t border-[rgb(var(--border))] align-top hover:bg-[rgb(var(--surface))]"
                        >
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
                              <span className="text-[rgb(var(--muted))]">{candidate.revenueCoveragePct}% coverage</span>
                            </div>
                            {candidate.issueSummary ? (
                              <div className="mt-2 text-xs text-[rgb(var(--muted))]">{candidate.issueSummary}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{formatUnits(candidate.unitsProduced)}</td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">
                            {candidate.pricedUnits > 0 ? formatMoney(candidate.revenuePerUnitAvg) : "--"}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{candidate.pricedUnits > 0 ? formatMoney(candidate.estimatedRevenue) : "--"}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">{candidate.unitOfMeasure}</td>
                          <td className="px-4 py-3 text-[rgb(var(--foreground))]">{candidate.workOrderReference}</td>
                          <td className="px-4 py-3 text-[rgb(var(--foreground))]">{candidate.purchaseOrderReference}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{candidate.jobCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">
                            {formatDateLabel(candidate.firstProducedDate)} to {formatDateLabel(candidate.lastProducedDate)}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={10} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
                          No invoice candidates match the current filters.
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
