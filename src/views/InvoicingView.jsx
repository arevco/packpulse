import { useDeferredValue, useEffect, useMemo, useState } from "react";
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

var DETAIL_ROW_LIMIT = 250;

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeSearchValue(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeGroupValue(value) {
  return normalizeSearchValue(value).replace(/\.0+$/, "").replace(/\s+/g, " ");
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

function buildNormalizedProductionRow(row, index) {
  var customer = String(pickFieldLoose(row, [
    "Customer name", "customer_name",
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
    "Work Order code", "work_order_code",
    "project_code", "Project Code"
  ]) || "").trim();
  var workOrderId = String(pickFieldLoose(row, [
    "Work Order", "work_order",
    "Work Order ID", "work_order_id"
  ]) || "").trim();
  var purchaseOrderNumber = String(pickFieldLoose(row, [
    "Purchase Order number", "purchase_order_number",
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
    "Unit of measure", "unit_of_measure",
    "Unit of Measure", "uom"
  ]) || "").trim();
  var reference1 = String(pickFieldLoose(row, [
    "Reference 1", "reference_1",
    "Work Order reference 1", "work_order_reference_1"
  ]) || "").trim();
  var customerLabel = customer || "Unassigned customer";
  var skuLabel = sku || "Missing SKU";
  var rowIssues = [];
  if (!customer) rowIssues.push("Missing customer");
  if (!sku) rowIssues.push("Missing SKU");
  if (!producedDate) rowIssues.push("Missing produced date");
  if (!(unitsProduced > 0)) rowIssues.push("No produced quantity");
  if (!unitOfMeasure) rowIssues.push("Missing unit of measure");
  if (!workOrderCode && !workOrderId) rowIssues.push("Missing work order");
  return {
    raw: row,
    rowIndex: index,
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
    purchaseOrderNumber: purchaseOrderNumber,
    jobId: jobId,
    line: line || "--",
    unitOfMeasure: unitOfMeasure,
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
  var initialFilters = props.initialFilters || {};
  var onPermalinkChange = typeof props.onPermalinkChange === "function" ? props.onPermalinkChange : null;
  var defaults = defaultInvoicingRange();

  var [startDate, setStartDate] = useState(String(initialFilters.start || defaults.start || ""));
  var [endDate, setEndDate] = useState(String(initialFilters.end || defaults.end || ""));
  var [customerFilter, setCustomerFilter] = useState(String(initialFilters.customer || "all"));
  var [statusFilter, setStatusFilter] = useState(String(initialFilters.status || "all"));
  var [searchTerm, setSearchTerm] = useState(String(initialFilters.q || ""));
  var [selectedCandidateKey, setSelectedCandidateKey] = useState("");

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

  var normalizedRows = useMemo(function() {
    return productionData
      .map(function(row, index) {
        var normalized = buildNormalizedProductionRow(row, index);
        normalized.searchHaystack = buildSearchHaystack(normalized);
        normalized.candidateKey = normalized.customerKey + "|" + normalized.skuKey;
        return normalized;
      })
      .filter(function(row) {
        return row.unitsProduced > 0;
      });
  }, [productionData]);

  var availableDateRange = useMemo(function() {
    return normalizedRows.reduce(function(acc, row) {
      if (!row.producedDate) return acc;
      return {
        min: updateMinDate(acc.min, row.producedDate),
        max: updateMaxDate(acc.max, row.producedDate)
      };
    }, { min: "", max: "" });
  }, [normalizedRows]);

  var searchNeedle = normalizeSearchValue(deferredSearchTerm);

  var filteredRows = useMemo(function() {
    return normalizedRows.filter(function(row) {
      if (startDate && (!row.producedDate || row.producedDate < startDate)) return false;
      if (endDate && (!row.producedDate || row.producedDate > endDate)) return false;
      if (customerFilter !== "all" && row.customer !== customerFilter) return false;
      if (searchNeedle && row.searchHaystack.indexOf(searchNeedle) === -1) return false;
      return true;
    });
  }, [normalizedRows, startDate, endDate, customerFilter, searchNeedle]);

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
          missingSkuRows: 0
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
      if (row.workOrderCode || row.workOrderId) group.workOrders.add(row.workOrderCode || row.workOrderId);
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

      if (!group.purchaseOrders.size) advisoryIssues.push("No purchase order attached");
      else if (group.missingPurchaseOrderRows > 0) advisoryIssues.push(group.missingPurchaseOrderRows + " " + pluralize(group.missingPurchaseOrderRows, "row") + " missing PO");
      if (group.missingWorkOrderRows > 0 && group.workOrders.size > 0) advisoryIssues.push(group.missingWorkOrderRows + " " + pluralize(group.missingWorkOrderRows, "row") + " missing work order");
      if (group.lines.size > 1) advisoryIssues.push(group.lines.size + " production lines");

      var status = blockingIssues.length ? "review" : "ready";
      return {
        key: group.key,
        customer: group.customer,
        sku: group.sku,
        description: group.description,
        unitsProduced: group.unitsProduced,
        detailRows: group.detailRows,
        firstProducedDate: group.firstProducedDate,
        lastProducedDate: group.lastProducedDate,
        workOrderCount: group.workOrders.size,
        purchaseOrderCount: group.purchaseOrders.size,
        jobCount: group.jobs.size,
        lineCount: group.lines.size,
        unitOfMeasure: group.unitMeasures.size === 1 ? setToArray(group.unitMeasures)[0] : (group.unitMeasures.size ? "Mixed" : "--"),
        status: status,
        blockingIssues: blockingIssues,
        advisoryIssues: advisoryIssues,
        issueSummary: blockingIssues.concat(advisoryIssues).join(" | ")
      };
    }).sort(function(left, right) {
      if (left.status !== right.status) return left.status === "review" ? -1 : 1;
      if (right.unitsProduced !== left.unitsProduced) return right.unitsProduced - left.unitsProduced;
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      return left.sku.localeCompare(right.sku);
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

  useEffect(function() {
    if (!selectedCandidateKey) return;
    if (!visibleCandidateKeySet[selectedCandidateKey]) setSelectedCandidateKey("");
  }, [selectedCandidateKey, visibleCandidateKeySet]);

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
          workOrders: 0
        };
      }
      var group = grouped[candidate.customer];
      group.unitsProduced += candidate.unitsProduced;
      group.invoiceLines += 1;
      group.jobs += candidate.jobCount;
      group.workOrders += candidate.workOrderCount;
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
      if (selectedCandidateKey && row.candidateKey !== selectedCandidateKey) return false;
      return true;
    }).slice();

    rows.sort(function(left, right) {
      if (left.producedDate !== right.producedDate) return String(right.producedDate || "").localeCompare(String(left.producedDate || ""));
      if (left.customer !== right.customer) return left.customer.localeCompare(right.customer);
      if (left.sku !== right.sku) return left.sku.localeCompare(right.sku);
      return right.unitsProduced - left.unitsProduced;
    });
    return rows;
  }, [filteredRows, visibleCandidateKeySet, selectedCandidateKey]);

  var detailRowsVisible = detailRows.slice(0, DETAIL_ROW_LIMIT);
  var selectedCandidate = visibleInvoiceCandidates.find(function(candidate) {
    return candidate.key === selectedCandidateKey;
  }) || null;

  var summary = useMemo(function() {
    var customers = {};
    var uniqueJobs = {};
    var readyCount = 0;
    var reviewCount = 0;
    visibleInvoiceCandidates.forEach(function(candidate) {
      customers[candidate.customer] = true;
      if (candidate.status === "review") reviewCount += 1;
      else readyCount += 1;
    });
    detailRows.forEach(function(row) {
      if (row.jobId) uniqueJobs[row.jobId] = true;
    });
    return {
      unitsProduced: visibleInvoiceCandidates.reduce(function(sum, candidate) { return sum + candidate.unitsProduced; }, 0),
      customers: Object.keys(customers).length,
      invoiceLines: visibleInvoiceCandidates.length,
      readyLines: readyCount,
      reviewLines: reviewCount,
      jobs: Object.keys(uniqueJobs).length
    };
  }, [visibleInvoiceCandidates, detailRows]);

  var customerOptions = useMemo(function() {
    var totals = {};
    normalizedRows.forEach(function(row) {
      totals[row.customer] = (totals[row.customer] || 0) + row.unitsProduced;
    });
    return Object.keys(totals)
      .sort(function(left, right) {
        if (totals[right] !== totals[left]) return totals[right] - totals[left];
        return left.localeCompare(right);
      });
  }, [normalizedRows]);

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
    setSelectedCandidateKey("");
  }

  function exportSummaryCsv() {
    var header = [
      "status",
      "customer",
      "sku",
      "item_description",
      "units_produced",
      "unit_of_measure",
      "work_order_count",
      "purchase_order_count",
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
        candidate.unitOfMeasure,
        candidate.workOrderCount,
        candidate.purchaseOrderCount,
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
    var scope = selectedCandidate ? (normalizeLooseKey(selectedCandidate.customer) + "_" + normalizeLooseKey(selectedCandidate.sku)).slice(0, 60) : "filtered";
    var filename = "invoice_detail_" + scope + "_" + (startDate || "all") + "_to_" + (endDate || "all") + ".csv";
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
              {selectedCandidate ? "Export Selected Detail" : "Export Detail"}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">{filteredRows.length.toLocaleString()} production rows in period</Badge>
            <Badge variant={summary.reviewLines > 0 ? "warning" : "success"}>
              {summary.readyLines.toLocaleString()} ready / {summary.reviewLines.toLocaleString()} review
            </Badge>
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
                    setSelectedCandidateKey("");
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
                    setSelectedCandidateKey("");
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
                    setSelectedCandidateKey("");
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {[
          metricCard("Units Produced", formatUnits(summary.unitsProduced), "Finished-good output in the selected billing window.", "default"),
          metricCard("Customers", summary.customers.toLocaleString(), "Distinct customers represented in visible invoice lines.", "default"),
          metricCard("Invoice Lines", summary.invoiceLines.toLocaleString(), "Customer and SKU rollups ready for accounting review.", "success"),
          metricCard("Needs Review", summary.reviewLines.toLocaleString(), summary.reviewLines ? "Lines missing traceability or billing fields." : "No blockers in the current result set.", summary.reviewLines ? "warning" : "success"),
          metricCard("Underlying Jobs", summary.jobs.toLocaleString(), "Unique production jobs behind the visible invoice lines.", "default")
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
                            setSelectedCandidateKey("");
                          }}
                        >
                          <td className="px-4 py-3 font-medium text-[rgb(var(--foreground))]">
                            <div className="flex items-center gap-2">
                              <span>{row.customer}</span>
                              {active ? <Badge variant="info">Focused</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{formatUnits(row.unitsProduced)}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{row.invoiceLines.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--success))]">{row.readyLines.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--warning))]">{row.reviewLines.toLocaleString()}</td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-base font-semibold text-[rgb(var(--foreground))]">Invoice Candidates</div>
                <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                  {customerFilter === "all"
                    ? "Grouped by customer and SKU for the selected billing period."
                    : ("Focused on " + customerFilter + ".")}
                </div>
              </div>
              {selectedCandidate ? (
                <Button onClick={function() { setSelectedCandidateKey(""); }} variant="ghost" size="sm">Clear Selected Line</Button>
              ) : null}
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
                      <th className="px-4 py-3 text-left font-medium">UOM</th>
                      <th className="px-4 py-3 text-right font-medium">WOs</th>
                      <th className="px-4 py-3 text-right font-medium">POs</th>
                      <th className="px-4 py-3 text-right font-medium">Jobs</th>
                      <th className="px-4 py-3 text-left font-medium">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleInvoiceCandidates.length ? visibleInvoiceCandidates.map(function(candidate) {
                      var statusMeta = candidateStatusMeta(candidate.status);
                      var active = selectedCandidateKey === candidate.key;
                      return (
                        <tr
                          key={candidate.key}
                          className={"cursor-pointer border-t border-[rgb(var(--border))] align-top " + (active ? "bg-[color-mix(in_oklab,rgb(var(--accent))_7%,white)]" : "hover:bg-[rgb(var(--surface))]")}
                          onClick={function() {
                            setSelectedCandidateKey(active ? "" : candidate.key);
                          }}
                        >
                          <td className="px-4 py-3">
                            <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-[rgb(var(--foreground))]">
                              {candidate.customer} | {candidate.sku}
                            </div>
                            <div className="mt-1 text-xs text-[rgb(var(--muted))]">{candidate.description}</div>
                            {candidate.issueSummary ? (
                              <div className="mt-2 text-xs text-[rgb(var(--muted))]">{candidate.issueSummary}</div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">{formatUnits(candidate.unitsProduced)}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">{candidate.unitOfMeasure}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{candidate.workOrderCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{candidate.purchaseOrderCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right text-[rgb(var(--muted))]">{candidate.jobCount.toLocaleString()}</td>
                          <td className="px-4 py-3 text-[rgb(var(--muted))]">
                            {formatDateLabel(candidate.firstProducedDate)} to {formatDateLabel(candidate.lastProducedDate)}
                          </td>
                        </tr>
                      );
                    }) : (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
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

      <Card>
        <CardHeader className="border-b border-[rgb(var(--border))] pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-base font-semibold text-[rgb(var(--foreground))]">Production Detail</div>
              <div className="mt-1 text-sm text-[rgb(var(--muted))]">
                {selectedCandidate
                  ? ("Showing " + selectedCandidate.customer + " | " + selectedCandidate.sku + " across " + selectedCandidate.jobCount + " jobs.")
                  : "Showing the underlying production rows for the current filter set."}
              </div>
            </div>
            <div className="text-sm text-[rgb(var(--muted))]">
              {detailRows.length > DETAIL_ROW_LIMIT
                ? ("Showing " + DETAIL_ROW_LIMIT.toLocaleString() + " of " + detailRows.length.toLocaleString() + " rows. Export detail for the full set.")
                : (detailRows.length.toLocaleString() + " rows")}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <TableShell className="rounded-none border-x-0 border-b-0">
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-[rgb(var(--surface))] text-[rgb(var(--muted))]">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Produced</th>
                    <th className="px-4 py-3 text-left font-medium">Customer / SKU</th>
                    <th className="px-4 py-3 text-right font-medium">Units</th>
                    <th className="px-4 py-3 text-left font-medium">Job</th>
                    <th className="px-4 py-3 text-left font-medium">Work Order</th>
                    <th className="px-4 py-3 text-left font-medium">PO</th>
                    <th className="px-4 py-3 text-left font-medium">Line</th>
                    <th className="px-4 py-3 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {detailRowsVisible.length ? detailRowsVisible.map(function(row) {
                    return (
                      <tr key={row.candidateKey + "::" + row.rowIndex} className="border-t border-[rgb(var(--border))] align-top">
                        <td className="px-4 py-3 text-[rgb(var(--foreground))]">{formatDateLabel(row.producedDate)}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[rgb(var(--foreground))]">{row.customer} | {row.sku}</div>
                          <div className="mt-1 text-xs text-[rgb(var(--muted))]">{row.description}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-[rgb(var(--foreground))]">
                          {formatUnits(row.unitsProduced)} {row.unitOfMeasure || ""}
                        </td>
                        <td className="px-4 py-3 text-[rgb(var(--muted))]">{row.jobId || "--"}</td>
                        <td className="px-4 py-3 text-[rgb(var(--muted))]">{row.workOrderCode || row.workOrderId || "--"}</td>
                        <td className="px-4 py-3 text-[rgb(var(--muted))]">{row.purchaseOrderNumber || "--"}</td>
                        <td className="px-4 py-3 text-[rgb(var(--muted))]">{row.line || "--"}</td>
                        <td className="px-4 py-3 text-xs text-[rgb(var(--muted))]">
                          {row.rowIssues.length ? row.rowIssues.join(" | ") : (row.reference1 || "--")}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-sm text-[rgb(var(--muted))]">
                        No production detail rows match the current filters.
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
  );
}
