import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { safeNum, formatDescriptionForDisplay, triggerDownload } from "../utils";
import { Download } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";

var MIN_TRUSTED_JOB_LABOR_HOURS = 0.25;
var SHIFT_MINUTES = 480;
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

function fmtMoneyWhole(value) {
  var rounded = Math.round(safeNum(value));
  if (rounded < 0) return "-$" + Math.abs(rounded).toLocaleString();
  return "$" + rounded.toLocaleString();
}

function fmtMoney(value) {
  var amount = safeNum(value);
  if (!Number.isFinite(amount)) return "--";
  if (amount < 0) return "-$" + Math.abs(amount).toFixed(2);
  return "$" + amount.toFixed(2);
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return (safeNum(value) * 100).toFixed(1) + "%";
}

function normKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
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

function mergeLaborMetric(target, row) {
  target.payable_hours += safeNum(row && row.payable_hours);
  target.productive_hours += safeNum(row && row.productive_hours);
  target.labor_cost += safeNum(row && row.labor_cost);
  var provisionalRows = safeNum(row && row.provisional_rows);
  var finalizedRows = safeNum(row && row.finalized_rows);
  var status = String(row && row.labor_status || "").trim();
  if (!(provisionalRows > 0) && !(finalizedRows > 0)) {
    if (status === "provisional") provisionalRows = 1;
    else if (status === "mixed") {
      provisionalRows = 1;
      finalizedRows = 1;
    } else if (status === "finalized") finalizedRows = 1;
  }
  target.provisional_rows = safeNum(target.provisional_rows) + provisionalRows;
  target.finalized_rows = safeNum(target.finalized_rows) + finalizedRows;
}

function hasAssignedShift(shiftLabel) {
  return !!shiftLabel && String(shiftLabel) !== "Unassigned";
}

function isSpecificShiftLabel(shiftLabel) {
  var normalized = normalizeShiftLabel(shiftLabel);
  return normalized === "Shift 1 (7a-3p)" || normalized === "Shift 2 (3p-11p)";
}

function normalizeShiftLabel(value) {
  var s = String(value || "").toLowerCase();
  if (!s) return "";
  if (s.indexOf("cross") !== -1) return "Cross-Shift Job";
  if (s.indexOf("unassigned") !== -1) return "Unassigned";
  if (s.indexOf("1") !== -1 || s.indexOf("1st") !== -1) return "Shift 1 (7a-3p)";
  if (s.indexOf("2") !== -1 || s.indexOf("2nd") !== -1) return "Shift 2 (3p-11p)";
  return "";
}

function classifyShiftFromHour(hour, minute) {
  var totalMinutes = (Number(hour || 0) * 60) + Number(minute || 0);
  if (totalMinutes >= (7 * 60) && totalMinutes <= ((15 * 60) + 5)) return "Shift 1 (7a-3p)";
  if (totalMinutes >= ((15 * 60) + 6) && totalMinutes <= ((23 * 60) + 59)) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

function parseLaborWallClock(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var patterns = [
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i,
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i
  ];
  for (var i = 0; i < patterns.length; i += 1) {
    var m = raw.match(patterns[i]);
    if (!m) continue;
    var year = 0;
    var monthIndex = 0;
    var day = 0;
    var hour = parseInt(m[4] || "0", 10);
    var minute = parseInt(m[5] || "0", 10);
    var meridiem = String(m[7] || m[6] || "").toUpperCase();
    if (i === 0) {
      year = parseInt(m[1], 10);
      monthIndex = MONTH_INDEX[String(m[2] || "").toLowerCase()];
      day = parseInt(m[3], 10);
    } else if (i === 1) {
      year = parseInt(m[1], 10);
      monthIndex = parseInt(m[2], 10) - 1;
      day = parseInt(m[3], 10);
    } else {
      monthIndex = parseInt(m[1], 10) - 1;
      day = parseInt(m[2], 10);
      year = parseInt(m[3], 10);
    }
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) continue;
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    return {
      date: year + "-" + String(monthIndex + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"),
      shift: classifyShiftFromHour(hour, minute)
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, shift: "Unassigned" };
  }
  return null;
}

function rawLaborTiming(row) {
  var shift = normalizeShiftLabel(pickFieldLoose(row, ["Shift Label", "shift_label", "Shift"])) || "";
  var explicitDate = String(pickFieldLoose(row, ["worked_date_et", "Worked Date ET", "Worked Date", "Date"]) || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
    return { date: explicitDate, shift: shift || "Unassigned" };
  }
  var parsed = parseLaborWallClock(
    pickFieldLoose(row, [
      "Clock In Time", "Clock in time", "clock_in_at_utc",
      "Clock Out Time", "Clock out time", "clock_out_at_utc",
      "Worked At", "worked_at_utc", "Start Time", "start_time"
    ])
  );
  if (!parsed) return { date: "", shift: shift || "" };
  return {
    date: parsed.date,
    shift: shift || parsed.shift || "Unassigned"
  };
}

function scaleLaborMetric(metric, ratio) {
  var share = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
  return {
    payable_hours: safeNum(metric && metric.payable_hours) * share,
    productive_hours: safeNum(metric && metric.productive_hours) * share,
    labor_cost: safeNum(metric && metric.labor_cost) * share,
    provisional_rows: safeNum(metric && metric.provisional_rows) * share,
    finalized_rows: safeNum(metric && metric.finalized_rows) * share,
    labor_status: String(metric && metric.labor_status || "")
  };
}

function deriveLaborStatus(finalizedRows, provisionalRows) {
  if (provisionalRows > 0 && finalizedRows > 0) return "mixed";
  if (provisionalRows > 0) return "provisional";
  if (finalizedRows > 0) return "finalized";
  return "unknown";
}

function laborStatusFromMetric(metric) {
  var provisionalRows = safeNum(metric && metric.provisional_rows);
  var finalizedRows = safeNum(metric && metric.finalized_rows);
  if (provisionalRows > 0 || finalizedRows > 0) return deriveLaborStatus(finalizedRows, provisionalRows);
  return String(metric && metric.labor_status || "unknown");
}

function canDirectMatchServerLaborRow(row) {
  if (!row) return false;
  if (row.can_direct_match_shift === true) return true;
  return safeNum(row.trusted_shift_rows) > 0;
}

function isProvisionalLabor(status) {
  return status === "provisional" || status === "mixed";
}

function laborStatusLabel(status) {
  if (status === "provisional") return "provisional labor";
  if (status === "mixed") return "mixed finalized/provisional labor";
  if (status === "finalized") return "finalized labor";
  return "labor status unknown";
}

function csvCell(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function csvNumber(value, digits) {
  var amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return digits > 0 ? amount.toFixed(digits) : String(Math.round(amount));
}

function todayEtDateKey() {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

export default function ProductionView({ productionSegments, laborActuals, laborDataRaw, resolveRevenueForRow }) {
  const { C, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();

  const [prodDateStart, setProdDateStart] = useState("");
  const [prodDateEnd, setProdDateEnd] = useState("");
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");
  const [lineExpansion, setLineExpansion] = useState({});
  const [showLineExecution, setShowLineExecution] = useState(true);
  const [jobExpansion, setJobExpansion] = useState({});

  var prodShiftRows = productionSegments && Array.isArray(productionSegments.shiftRows) ? productionSegments.shiftRows : [];
  var prodJobRows = productionSegments && Array.isArray(productionSegments.jobRows) ? productionSegments.jobRows : [];
  var laborJobRows = laborActuals && Array.isArray(laborActuals.byJob) ? laborActuals.byJob : [];
  var laborRawRows = Array.isArray(laborDataRaw) ? laborDataRaw : [];
  var laborSummary = laborActuals && laborActuals.summary ? laborActuals.summary : {};
  var laborFinalizedThroughDate = String(laborSummary.finalized_through_date || "").trim();
  var totalRows = productionSegments && productionSegments.totalRows ? productionSegments.totalRows : 0;
  var rowsWithShift = productionSegments && productionSegments.rowsWithShift ? productionSegments.rowsWithShift : 0;
  var prodDates = Array.from(new Set(prodShiftRows.map(function(r) { return r.date; }))).sort().reverse();
  var latestProdDate = prodDates[0] || "";
  var earliestProdDate = prodDates.length ? prodDates[prodDates.length - 1] : "";
  var rangeStart = prodDateStart || latestProdDate;
  var rangeEnd = prodDateEnd || latestProdDate || rangeStart;
  if (rangeEnd && rangeStart && rangeEnd < rangeStart) {
    var tmpRangeDate = rangeStart;
    rangeStart = rangeEnd;
    rangeEnd = tmpRangeDate;
  }
  var isAllMatchingDays = !!rangeStart && !!rangeEnd && !!earliestProdDate && !!latestProdDate && rangeStart === earliestProdDate && rangeEnd === latestProdDate;
  var selectedRangeLabel = !rangeStart
    ? "selected day"
    : (rangeStart === rangeEnd ? rangeStart : (rangeStart + " to " + rangeEnd));
  var selectedJobRows = (rangeStart && rangeEnd)
    ? prodJobRows.filter(function(r) {
        var date = String(r.date || "");
        return date && date >= rangeStart && date <= rangeEnd;
      })
    : [];
  var lineOptions = Array.from(new Set(selectedJobRows.map(function(r) { return String(r.line || "Unknown").trim() || "Unknown"; }))).sort();
  var shiftOptions = Array.from(new Set(selectedJobRows.map(function(r) { return String(r.shift || "Unassigned"); }))).sort();
  var filteredJobRows = useMemo(function() {
    var rows = selectedJobRows.filter(function(r) {
      if (lineFilter !== "all" && String(r.line || "Unknown") !== lineFilter) return false;
      if (shiftFilter !== "all" && String(r.shift || "Unassigned") !== shiftFilter) return false;
      return true;
    });
    if (!search) return rows.slice().sort(function(a, b) { return safeNum(b.unitsProduced) - safeNum(a.unitsProduced); });
    var q = search.toLowerCase();
    return rows.filter(function(r) {
      return (
        (r.jobId || "").toLowerCase().includes(q) ||
        (r.workOrder || "").toLowerCase().includes(q) ||
        (r.itemCode || "").toLowerCase().includes(q) ||
        (r.itemDesc || "").toLowerCase().includes(q) ||
        (r.line || "").toLowerCase().includes(q)
      );
    }).sort(function(a, b) { return safeNum(b.unitsProduced) - safeNum(a.unitsProduced); });
  }, [search, selectedJobRows, lineFilter, shiftFilter]);

  var laborByJobKey = useMemo(function() {
    var exact = {};
    var slim = {};
    var byLineItem = {};
    var byLine = {};
    var byJobDateItem = {};
    var byJobDate = {};
    laborJobRows.forEach(function(r) {
      var shiftLabel = String(r && r.shift_label || "").trim();
      var directShiftAllowed = !isSpecificShiftLabel(shiftLabel) || canDirectMatchServerLaborRow(r);
      var exactKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.shift_label),
        normKey(r && r.line_name),
        normKey(r && r.work_order_code),
        normKey(r && r.item_code)
      ].join("|");
      var slimKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.shift_label)
      ].join("|");
      var lineItemKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.line_name),
        normKey(r && r.item_code)
      ].join("|");
      var lineKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.line_name)
      ].join("|");
      var jobDateItemKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.item_code)
      ].join("|");
      var jobDateKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et)
      ].join("|");
      if (directShiftAllowed && exactKey && !exact[exactKey]) exact[exactKey] = r;
      if (directShiftAllowed && slimKey && !slim[slimKey]) slim[slimKey] = r;
      if (!isSpecificShiftLabel(shiftLabel) && lineItemKey) {
        if (!byLineItem[lineItemKey]) byLineItem[lineItemKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLineItem[lineItemKey], r);
      }
      if (!isSpecificShiftLabel(shiftLabel) && lineKey) {
        if (!byLine[lineKey]) byLine[lineKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLine[lineKey], r);
      }
      if (jobDateItemKey) {
        if (!byJobDateItem[jobDateItemKey]) byJobDateItem[jobDateItemKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byJobDateItem[jobDateItemKey], r);
      }
      if (jobDateKey) {
        if (!byJobDate[jobDateKey]) byJobDate[jobDateKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byJobDate[jobDateKey], r);
      }
    });
    return { exact: exact, slim: slim, byLineItem: byLineItem, byLine: byLine, byJobDateItem: byJobDateItem, byJobDate: byJobDate };
  }, [laborJobRows]);

  var rawLaborByJobKey = useMemo(function() {
    var exact = {};
    var slim = {};
    var byLineItem = {};
    var byLine = {};
    var byJobDateItem = {};
    var byJobDate = {};
    laborRawRows.forEach(function(row) {
      var jobId = String(pickFieldLoose(row, ["Job ID", "job_id", "Job"]) || "").trim();
      if (!jobId) return;
      var timing = rawLaborTiming(row);
      var date = timing.date;
      var shift = timing.shift || "Unassigned";
      if (!date || !shift) return;
      var line = String(pickFieldLoose(row, ["Line Name", "Line name", "line_name", "Line"]) || "").trim() || "Unknown";
      var workOrder = String(pickFieldLoose(row, ["Work Order Code", "work_order_code", "project_code", "Project Code"]) || "").trim();
      var itemCode = String(pickFieldLoose(row, ["Item Code", "Item code", "item_code"]) || "").trim();
      var metric = {
        payable_hours: safeNum(pickFieldLoose(row, ["Payable Hours", "Payable hours", "payable_hours"])),
        productive_hours: safeNum(pickFieldLoose(row, ["Productive Hours", "Productive hours", "productive_hours"])),
        labor_cost: 0
      };
      metric.labor_cost = metric.payable_hours * safeNum(pickFieldLoose(row, ["Badge Type Rate", "Badge type rate", "badge_type_rate", "Hourly Rate", "hourly_rate"]));
      var exactKey = [
        normKey(jobId),
        normKey(date),
        normKey(shift),
        normKey(line),
        normKey(workOrder),
        normKey(itemCode)
      ].join("|");
      var slimKey = [
        normKey(jobId),
        normKey(date),
        normKey(shift)
      ].join("|");
      var lineItemKey = [
        normKey(jobId),
        normKey(date),
        normKey(line),
        normKey(itemCode)
      ].join("|");
      var lineKey = [
        normKey(jobId),
        normKey(date),
        normKey(line)
      ].join("|");
      var jobDateItemKey = [
        normKey(jobId),
        normKey(date),
        normKey(itemCode)
      ].join("|");
      var jobDateKey = [
        normKey(jobId),
        normKey(date)
      ].join("|");
      if (!exact[exactKey]) exact[exactKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
      if (!slim[slimKey]) slim[slimKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
      mergeLaborMetric(exact[exactKey], metric);
      mergeLaborMetric(slim[slimKey], metric);
      if (!isSpecificShiftLabel(shift) && lineItemKey) {
        if (!byLineItem[lineItemKey]) byLineItem[lineItemKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLineItem[lineItemKey], metric);
      }
      if (!isSpecificShiftLabel(shift) && lineKey) {
        if (!byLine[lineKey]) byLine[lineKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLine[lineKey], metric);
      }
      if (jobDateItemKey) {
        if (!byJobDateItem[jobDateItemKey]) byJobDateItem[jobDateItemKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byJobDateItem[jobDateItemKey], metric);
      }
      if (jobDateKey) {
        if (!byJobDate[jobDateKey]) byJobDate[jobDateKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byJobDate[jobDateKey], metric);
      }
    });
    return { exact: exact, slim: slim, byLineItem: byLineItem, byLine: byLine, byJobDateItem: byJobDateItem, byJobDate: byJobDate };
  }, [laborRawRows]);

  var productionFallbackGroups = useMemo(function() {
    var byLineItem = {};
    var byLine = {};
    var byJobDateItem = {};
    var byJobDate = {};
    selectedJobRows.forEach(function(r) {
      var unitsProduced = safeNum(r.unitsProduced);
      var lineItemKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line),
        normKey(r.itemCode)
      ].join("|");
      var lineKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line)
      ].join("|");
      var jobDateItemKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.itemCode)
      ].join("|");
      var jobDateKey = [
        normKey(r.jobId),
        normKey(r.date)
      ].join("|");
      if (lineItemKey) {
        if (!byLineItem[lineItemKey]) byLineItem[lineItemKey] = { units: 0, rows: 0 };
        byLineItem[lineItemKey].units += unitsProduced;
        byLineItem[lineItemKey].rows += 1;
      }
      if (lineKey) {
        if (!byLine[lineKey]) byLine[lineKey] = { units: 0, rows: 0 };
        byLine[lineKey].units += unitsProduced;
        byLine[lineKey].rows += 1;
      }
      if (jobDateItemKey) {
        if (!byJobDateItem[jobDateItemKey]) byJobDateItem[jobDateItemKey] = { units: 0, rows: 0 };
        byJobDateItem[jobDateItemKey].units += unitsProduced;
        byJobDateItem[jobDateItemKey].rows += 1;
      }
      if (jobDateKey) {
        if (!byJobDate[jobDateKey]) byJobDate[jobDateKey] = { units: 0, rows: 0 };
        byJobDate[jobDateKey].units += unitsProduced;
        byJobDate[jobDateKey].rows += 1;
      }
    });
    return { byLineItem: byLineItem, byLine: byLine, byJobDateItem: byJobDateItem, byJobDate: byJobDate };
  }, [selectedJobRows]);

  var jobsWithLabor = useMemo(function() {
    return filteredJobRows.map(function(r) {
      var exactKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.shift),
        normKey(r.line),
        normKey(r.workOrder),
        normKey(r.itemCode)
      ].join("|");
      var slimKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.shift)
      ].join("|");
      var lineItemKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line),
        normKey(r.itemCode)
      ].join("|");
      var lineKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line)
      ].join("|");
      var jobDateItemKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.itemCode)
      ].join("|");
      var jobDateKey = [
        normKey(r.jobId),
        normKey(r.date)
      ].join("|");
      var labor = null;
      var laborSource = "none";
      var allocationMethod = "unmatched";
      var matchLevel = "unmatched";
      if (laborByJobKey.exact[exactKey]) {
        labor = laborByJobKey.exact[exactKey];
        laborSource = "server_by_job";
        allocationMethod = "direct_match";
        matchLevel = "job_date_shift_line_wo_item";
      } else if (laborByJobKey.slim[slimKey]) {
        labor = laborByJobKey.slim[slimKey];
        laborSource = "server_by_job";
        allocationMethod = "direct_match";
        matchLevel = "job_date_shift";
      } else if (rawLaborByJobKey.exact[exactKey]) {
        labor = rawLaborByJobKey.exact[exactKey];
        laborSource = "raw_labor_upload";
        allocationMethod = "direct_match";
        matchLevel = "job_date_shift_line_wo_item";
      } else if (rawLaborByJobKey.slim[slimKey]) {
        labor = rawLaborByJobKey.slim[slimKey];
        laborSource = "raw_labor_upload";
        allocationMethod = "direct_match";
        matchLevel = "job_date_shift";
      }
      if (!labor) {
        var aggregateLabor = laborByJobKey.byLineItem[lineItemKey] || rawLaborByJobKey.byLineItem[lineItemKey] || null;
        var aggregateGroup = productionFallbackGroups.byLineItem[lineItemKey] || null;
        var aggregateSource = laborByJobKey.byLineItem[lineItemKey] ? "server_by_job" : (rawLaborByJobKey.byLineItem[lineItemKey] ? "raw_labor_upload" : "none");
        var aggregateMatchLevel = "job_date_line_item_prorated";
        if (!aggregateLabor) {
          aggregateLabor = laborByJobKey.byLine[lineKey] || rawLaborByJobKey.byLine[lineKey] || null;
          aggregateGroup = productionFallbackGroups.byLine[lineKey] || null;
          aggregateSource = laborByJobKey.byLine[lineKey] ? "server_by_job" : (rawLaborByJobKey.byLine[lineKey] ? "raw_labor_upload" : "none");
          aggregateMatchLevel = "job_date_line_prorated";
        }
        if (!aggregateLabor) {
          aggregateLabor = laborByJobKey.byJobDateItem[jobDateItemKey] || rawLaborByJobKey.byJobDateItem[jobDateItemKey] || null;
          aggregateGroup = productionFallbackGroups.byJobDateItem[jobDateItemKey] || null;
          aggregateSource = laborByJobKey.byJobDateItem[jobDateItemKey] ? "server_by_job" : (rawLaborByJobKey.byJobDateItem[jobDateItemKey] ? "raw_labor_upload" : "none");
          aggregateMatchLevel = "job_date_item_prorated";
        }
        if (!aggregateLabor) {
          aggregateLabor = laborByJobKey.byJobDate[jobDateKey] || rawLaborByJobKey.byJobDate[jobDateKey] || null;
          aggregateGroup = productionFallbackGroups.byJobDate[jobDateKey] || null;
          aggregateSource = laborByJobKey.byJobDate[jobDateKey] ? "server_by_job" : (rawLaborByJobKey.byJobDate[jobDateKey] ? "raw_labor_upload" : "none");
          aggregateMatchLevel = "job_date_prorated";
        }
        if (aggregateLabor && aggregateGroup) {
          var groupUnits = safeNum(aggregateGroup.units);
          var groupRows = safeNum(aggregateGroup.rows);
          var ratio = groupUnits > 0 ? (safeNum(r.unitsProduced) / groupUnits) : (groupRows > 0 ? (1 / groupRows) : 0);
          labor = scaleLaborMetric(aggregateLabor, ratio);
          laborSource = aggregateSource;
          allocationMethod = "prorated_by_units";
          matchLevel = aggregateMatchLevel;
        }
      }
      var rawPayableHours = safeNum(labor && labor.payable_hours);
      var payableHours = rawPayableHours >= MIN_TRUSTED_JOB_LABOR_HOURS ? rawPayableHours : 0;
      var productiveHours = payableHours > 0 ? safeNum(labor && labor.productive_hours) : 0;
      var laborCost = payableHours > 0 ? safeNum(labor && labor.labor_cost) : 0;
      var laborStatus = payableHours > 0 ? laborStatusFromMetric(labor) : "unknown";
      var shiftMatchConfidence = payableHours > 0 ? String(labor && labor.shift_match_confidence || "") : "";
      var canDirectMatchShift = payableHours > 0 ? !!(labor && labor.can_direct_match_shift) : false;
      if (!(payableHours > 0)) {
        laborSource = "none";
        allocationMethod = "unmatched";
        matchLevel = "unmatched";
      }
      var unitsProduced = safeNum(r.unitsProduced);
      var revenueMatch = typeof resolveRevenueForRow === "function" ? resolveRevenueForRow(r.itemCode, r.date) : null;
      var revenuePerCase = safeNum(revenueMatch && revenueMatch.value);
      var revenue = revenuePerCase > 0 && unitsProduced > 0 ? (unitsProduced * revenuePerCase) : 0;
      var laborMargin = revenue - laborCost;
      var laborMarginPct = revenue > 0 ? (laborMargin / revenue) : null;
      var missingRevenue = unitsProduced > 0 && !(revenue > 0);
      var shiftMinutes = hasAssignedShift(r.shift) ? SHIFT_MINUTES : 0;
      return Object.assign({}, r, {
        laborPayableHours: payableHours,
        laborProductiveHours: productiveHours,
        laborCost: laborCost,
        revenue: revenue,
        revenueCoveredUnits: revenue > 0 ? unitsProduced : 0,
        pricePerUnit: revenue > 0 && unitsProduced > 0 ? (revenue / unitsProduced) : null,
        laborMargin: laborMargin,
        laborMarginPct: laborMarginPct,
        missingRevenue: missingRevenue,
        missingRevenueUnits: missingRevenue ? unitsProduced : 0,
        missingRevenueSkuKey: normKey(r.itemCode) || "unknown",
        shiftMinutes: shiftMinutes,
        casesPerMinute: shiftMinutes > 0 ? (unitsProduced / shiftMinutes) : 0,
        casesPerPayableHour: payableHours > 0 ? (unitsProduced / payableHours) : 0,
        laborCostPerCase: unitsProduced > 0 ? (laborCost / unitsProduced) : 0,
        hasLabor: payableHours > 0,
        hasRevenue: revenue > 0,
        laborStatus: laborStatus,
        laborIsProvisional: payableHours > 0 && isProvisionalLabor(laborStatus),
        shiftMatchConfidence: shiftMatchConfidence,
        canDirectMatchShift: canDirectMatchShift,
        laborSource: laborSource,
        allocationMethod: allocationMethod,
        matchLevel: matchLevel
      });
    });
  }, [filteredJobRows, laborByJobKey, rawLaborByJobKey, productionFallbackGroups, resolveRevenueForRow]);

  var jobsWithDetailLabor = useMemo(function() {
    var todayEt = todayEtDateKey();
    return jobsWithLabor.map(function(r) {
      var isToday = String(r.date || "") === todayEt;
      var trustedPastLabor = r.allocationMethod === "direct_match" && (
        r.laborSource !== "server_by_job" ||
        r.shiftMatchConfidence === "trusted" ||
        r.canDirectMatchShift
      );
      if (!r.hasLabor || isToday || trustedPastLabor) return r;
      return Object.assign({}, r, {
        laborPayableHours: 0,
        laborProductiveHours: 0,
        laborCost: 0,
        laborMargin: safeNum(r.revenue),
        laborMarginPct: r.revenue > 0 ? 1 : null,
        casesPerPayableHour: 0,
        laborCostPerCase: 0,
        hasLabor: false,
        laborStatus: "unknown",
        laborIsProvisional: false,
        shiftMatchConfidence: "",
        canDirectMatchShift: false,
        laborSource: "none",
        allocationMethod: "unmatched",
        matchLevel: "unmatched"
      });
    });
  }, [jobsWithLabor]);

  var shiftTotals = useMemo(function() {
    var map = {};
    jobsWithLabor.forEach(function(r) {
      var shift = String(r.shift || "Unassigned");
      if (!map[shift]) map[shift] = { shift: shift, units: 0, jobs: 0, laborPayableHours: 0, laborCost: 0, laborJobs: 0, provisionalLaborRows: 0, finalizedLaborRows: 0 };
      map[shift].units += safeNum(r.unitsProduced);
      map[shift].jobs += 1;
      map[shift].laborPayableHours += safeNum(r.laborPayableHours);
      map[shift].laborCost += safeNum(r.laborCost);
      if (r.hasLabor) map[shift].laborJobs += 1;
      if (r.hasLabor && isProvisionalLabor(r.laborStatus)) map[shift].provisionalLaborRows += 1;
      if (r.hasLabor && (r.laborStatus === "finalized" || r.laborStatus === "mixed")) map[shift].finalizedLaborRows += 1;
    });
    return Object.values(map).map(function(row) {
      return Object.assign({}, row, {
        laborStatus: deriveLaborStatus(row.finalizedLaborRows, row.provisionalLaborRows)
      });
    }).sort(function(a, b) { return b.units - a.units; });
  }, [jobsWithLabor]);

  var lineLoad = useMemo(function() {
    var map = {};
    var totalUnits = jobsWithDetailLabor.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
    jobsWithDetailLabor.forEach(function(r) {
      var line = String(r.line || "Unknown").trim() || "Unknown";
      if (!map[line]) {
        map[line] = {
          line: line,
          units: 0,
          jobs: 0,
          laborPayableHours: 0,
          laborCost: 0,
          revenue: 0,
          revenueCoveredUnits: 0,
          laborMargin: 0,
          shiftSlots: {},
          missingRevenueUnits: 0,
          missingRevenueSkuKeys: {},
          provisionalLaborRows: 0,
          finalizedLaborRows: 0
        };
      }
      map[line].units += safeNum(r.unitsProduced);
      map[line].jobs += 1;
      map[line].laborPayableHours += safeNum(r.laborPayableHours);
      map[line].laborCost += safeNum(r.laborCost);
      map[line].revenue += safeNum(r.revenue);
      map[line].revenueCoveredUnits += safeNum(r.revenueCoveredUnits);
      map[line].laborMargin += safeNum(r.laborMargin);
      map[line].missingRevenueUnits += safeNum(r.missingRevenueUnits);
      if (r.missingRevenue) map[line].missingRevenueSkuKeys[r.missingRevenueSkuKey] = r.itemCode || "Unknown SKU";
      if (hasAssignedShift(r.shift) && r.date) map[line].shiftSlots[String(r.date) + "|" + String(r.shift)] = true;
      if (r.hasLabor && isProvisionalLabor(r.laborStatus)) map[line].provisionalLaborRows += 1;
      if (r.hasLabor && (r.laborStatus === "finalized" || r.laborStatus === "mixed")) map[line].finalizedLaborRows += 1;
    });
    return Object.values(map).map(function(r) {
      var shiftSlotCount = Object.keys(r.shiftSlots).length;
      var shiftMinutes = shiftSlotCount * SHIFT_MINUTES;
      return Object.assign({}, r, {
        sharePct: totalUnits > 0 ? Math.round((r.units / totalUnits) * 100) : 0,
        shiftSlotCount: shiftSlotCount,
        shiftMinutes: shiftMinutes,
        revenueCoveragePct: r.units > 0 ? Math.round((r.revenueCoveredUnits / r.units) * 100) : 0,
        missingRevenueSkuCount: Object.keys(r.missingRevenueSkuKeys).length,
        pricePerUnit: r.revenueCoveredUnits > 0 ? (r.revenue / r.revenueCoveredUnits) : null,
        casesPerMinute: shiftMinutes > 0 ? (r.units / shiftMinutes) : 0,
        laborCostPerCase: r.units > 0 ? (r.laborCost / r.units) : 0,
        laborMarginPct: r.revenue > 0 ? (r.laborMargin / r.revenue) : null,
        laborStatus: deriveLaborStatus(r.finalizedLaborRows, r.provisionalLaborRows)
      });
    }).sort(function(a, b) { return b.units - a.units; });
  }, [jobsWithDetailLabor]);

  var jobRollup = useMemo(function() {
    var map = {};
    jobsWithDetailLabor.forEach(function(r) {
      var key = [r.jobId || "", r.workOrder || "", r.line || "", r.itemCode || ""].join("|");
      if (!map[key]) {
        map[key] = {
          key: key,
          jobId: r.jobId || "--",
          workOrder: r.workOrder || "--",
          line: r.line || "Unknown",
          itemCode: r.itemCode || "--",
          itemDesc: formatDescriptionForDisplay(r.itemDesc) || "--",
          unitsProduced: 0,
          laborPayableHours: 0,
          laborCost: 0,
          revenue: 0,
          revenueCoveredUnits: 0,
          laborMargin: 0,
          shifts: {},
          shiftSlots: {},
          missingRevenueUnits: 0,
          missingRevenueSkuKeys: {},
          provisionalLaborRows: 0,
          finalizedLaborRows: 0
        };
      }
      map[key].unitsProduced += safeNum(r.unitsProduced);
      map[key].laborPayableHours += safeNum(r.laborPayableHours);
      map[key].laborCost += safeNum(r.laborCost);
      map[key].revenue += safeNum(r.revenue);
      map[key].revenueCoveredUnits += safeNum(r.revenueCoveredUnits);
      map[key].laborMargin += safeNum(r.laborMargin);
      map[key].missingRevenueUnits += safeNum(r.missingRevenueUnits);
      if (r.missingRevenue) map[key].missingRevenueSkuKeys[r.missingRevenueSkuKey] = r.itemCode || "Unknown SKU";
      map[key].shifts[String(r.shift || "Unassigned")] = true;
      if (hasAssignedShift(r.shift) && r.date) map[key].shiftSlots[String(r.date) + "|" + String(r.shift)] = true;
      if (r.hasLabor && isProvisionalLabor(r.laborStatus)) map[key].provisionalLaborRows += 1;
      if (r.hasLabor && (r.laborStatus === "finalized" || r.laborStatus === "mixed")) map[key].finalizedLaborRows += 1;
    });
    return Object.values(map).map(function(r) {
      var shiftSlotCount = Object.keys(r.shiftSlots).length;
      var shiftMinutes = shiftSlotCount * SHIFT_MINUTES;
      return Object.assign({}, r, {
        shiftCount: Object.keys(r.shifts).length,
        shiftSlotCount: shiftSlotCount,
        shiftMinutes: shiftMinutes,
        casesPerMinute: shiftMinutes > 0 ? (r.unitsProduced / shiftMinutes) : 0,
        casesPerPayableHour: r.laborPayableHours > 0 ? (r.unitsProduced / r.laborPayableHours) : 0,
        laborCostPerCase: r.unitsProduced > 0 ? (r.laborCost / r.unitsProduced) : 0,
        revenueCoveragePct: r.unitsProduced > 0 ? Math.round((r.revenueCoveredUnits / r.unitsProduced) * 100) : 0,
        missingRevenueSkuCount: Object.keys(r.missingRevenueSkuKeys).length,
        pricePerUnit: r.revenueCoveredUnits > 0 ? (r.revenue / r.revenueCoveredUnits) : null,
        laborMarginPct: r.revenue > 0 ? (r.laborMargin / r.revenue) : null,
        laborStatus: deriveLaborStatus(r.finalizedLaborRows, r.provisionalLaborRows)
      });
    }).sort(function(a, b) { return b.unitsProduced - a.unitsProduced; });
  }, [jobsWithDetailLabor]);

  var detailRowsByJobKey = useMemo(function() {
    var map = {};
    var shiftRank = function(shiftLabel) {
      var normalized = String(shiftLabel || "");
      if (normalized === "Shift 1 (7a-3p)") return 1;
      if (normalized === "Shift 2 (3p-11p)") return 2;
      if (normalized === "Unassigned") return 3;
      return 4;
    };
    jobsWithDetailLabor.forEach(function(r) {
      var key = [r.jobId || "", r.workOrder || "", r.line || "", r.itemCode || ""].join("|");
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    Object.keys(map).forEach(function(key) {
      map[key].sort(function(a, b) {
        var dateA = String(a.date || "");
        var dateB = String(b.date || "");
        if (dateA !== dateB) return dateA.localeCompare(dateB);
        var rankA = shiftRank(a.shift);
        var rankB = shiftRank(b.shift);
        if (rankA !== rankB) return rankA - rankB;
        return safeNum(b.unitsProduced) - safeNum(a.unitsProduced);
      });
    });
    return map;
  }, [jobsWithDetailLabor]);

  var lineExecution = useMemo(function() {
    var jobsByLine = {};
    jobRollup.forEach(function(job) {
      var line = String(job.line || "Unknown").trim() || "Unknown";
      if (!jobsByLine[line]) jobsByLine[line] = [];
      jobsByLine[line].push(Object.assign({}, job, {
        detailRows: detailRowsByJobKey[job.key] || []
      }));
    });
    return lineLoad.map(function(line) {
      var jobs = jobsByLine[line.line] || [];
      return Object.assign({}, line, {
        lineJobs: jobs,
        jobCount: jobs.length
      });
    });
  }, [lineLoad, jobRollup, detailRowsByJobKey]);

  var totalUnitsProduced = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
  var totalRevenue = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.revenue); }, 0);
  var totalLaborCost = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.laborCost); }, 0);
  var totalLaborHours = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.laborPayableHours); }, 0);
  var totalRevenueCoveredUnits = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.revenueCoveredUnits); }, 0);
  var totalProvisionalLaborRows = jobsWithLabor.reduce(function(sum, r) { return sum + (r.hasLabor && isProvisionalLabor(r.laborStatus) ? 1 : 0); }, 0);
  var totalFinalizedLaborRows = jobsWithLabor.reduce(function(sum, r) { return sum + (r.hasLabor && (r.laborStatus === "finalized" || r.laborStatus === "mixed") ? 1 : 0); }, 0);
  var totalLaborMargin = totalRevenue - totalLaborCost;
  var totalLaborMarginPct = totalRevenue > 0 ? (totalLaborMargin / totalRevenue) : null;
  var totalRevenueCoveragePct = totalUnitsProduced > 0 ? Math.round((totalRevenueCoveredUnits / totalUnitsProduced) * 100) : 0;
  var overallLaborStatus = deriveLaborStatus(totalFinalizedLaborRows, totalProvisionalLaborRows);
  var topLine = lineLoad[0] || null;
  var topJob = jobRollup[0] || null;
  var shift1Total = shiftTotals.find(function(r) { return r.shift === "Shift 1 (7a-3p)"; }) || null;
  var shift2Total = shiftTotals.find(function(r) { return r.shift === "Shift 2 (3p-11p)"; }) || null;
  var shift1Units = shift1Total ? shift1Total.units : 0;
  var shift2Units = shift2Total ? shift2Total.units : 0;
  var shift1Jobs = shift1Total ? shift1Total.jobs : 0;
  var shift2Jobs = shift2Total ? shift2Total.jobs : 0;
  var shift1Share = totalUnitsProduced > 0 ? Math.round((shift1Units / totalUnitsProduced) * 100) : 0;
  var shift2Share = totalUnitsProduced > 0 ? Math.round((shift2Units / totalUnitsProduced) * 100) : 0;
  var shift1AvgPerJob = shift1Jobs > 0 ? Math.round(shift1Units / shift1Jobs) : 0;
  var shift2AvgPerJob = shift2Jobs > 0 ? Math.round(shift2Units / shift2Jobs) : 0;
  var shift1Delta = shift1Units - shift2Units;
  var shift2Delta = shift2Units - shift1Units;

  var shortShift = function(shiftLabel) {
    return String(shiftLabel || "")
      .replace("Shift 1 (7a-3p)", "S1")
      .replace("Shift 2 (3p-11p)", "S2");
  };
  var formatDelta = function(value) {
    if (!value) return "even";
    return (value > 0 ? "+" : "-") + Math.abs(value).toLocaleString();
  };
  var shiftCompareText = function(selfJobs, otherJobs, delta, otherLabel, avgPerJob) {
    if (!selfJobs && !otherJobs) return "no shift data";
    if (!selfJobs) return "no jobs logged";
    if (!otherJobs) return "no " + otherLabel + " compare yet";
    return formatDelta(delta) + " vs " + otherLabel + " · " + avgPerJob.toLocaleString() + "/job";
  };
  var laborRateText = function(hours, cases, cost) {
    if (!(hours > 0) || !(cases > 0)) return "labor not matched";
    return (cases / hours).toFixed(1) + " cs/lh · " + fmtMoney(cost / cases) + "/case";
  };
  var lineExpanded = function(lineName) {
    return lineExpansion[lineName] !== false;
  };
  var handleProdDateStartChange = function(nextDate) {
    var next = String(nextDate || "").trim();
    if (!next) {
      setProdDateStart("");
      return;
    }
    var currentEnd = rangeEnd || next;
    setProdDateStart(next);
    if (currentEnd && next > currentEnd) setProdDateEnd(next);
  };
  var handleProdDateEndChange = function(nextDate) {
    var next = String(nextDate || "").trim();
    if (!next) {
      setProdDateEnd("");
      return;
    }
    var currentStart = rangeStart || next;
    if (currentStart && next < currentStart) setProdDateStart(next);
    setProdDateEnd(next);
  };
  var toggleLineExpanded = function(lineName) {
    setLineExpansion(function(prev) {
      return Object.assign({}, prev, {
        [lineName]: !(prev[lineName] !== false)
      });
    });
  };
  var jobExpanded = function(jobKey) {
    return jobExpansion[jobKey] === true;
  };
  var toggleJobExpanded = function(jobKey) {
    setJobExpansion(function(prev) {
      return Object.assign({}, prev, {
        [jobKey]: !prev[jobKey]
      });
    });
  };
  var exportLaborCsv = function() {
    if (!jobsWithDetailLabor.length) return;
    var headers = [
      "date",
      "shift",
      "line",
      "job_id",
      "work_order",
      "item_code",
      "item_description",
      "units_produced",
      "revenue",
      "price_per_unit",
      "revenue_covered_units",
      "revenue_coverage_pct",
      "labor_payable_hours",
      "labor_productive_hours",
      "labor_cost",
      "labor_cost_per_case",
      "labor_margin",
      "labor_margin_pct",
      "cases_per_minute",
      "cases_per_payable_hour",
      "shift_minutes",
      "has_labor",
      "labor_status",
      "labor_is_provisional",
      "labor_source",
      "allocation_method",
      "match_level",
      "has_revenue",
      "missing_revenue"
    ];
    var rows = jobsWithDetailLabor.map(function(row) {
      return [
        row.date || "",
        row.shift || "",
        row.line || "",
        row.jobId || "",
        row.workOrder || "",
        row.itemCode || "",
        formatDescriptionForDisplay(row.itemDesc) || "",
        csvNumber(row.unitsProduced, 0),
        csvNumber(row.revenue, 2),
        csvNumber(row.pricePerUnit, 2),
        csvNumber(row.revenueCoveredUnits, 0),
        csvNumber(row.revenueCoveragePct, 1),
        csvNumber(row.laborPayableHours, 2),
        csvNumber(row.laborProductiveHours, 2),
        csvNumber(row.laborCost, 2),
        csvNumber(row.laborCostPerCase, 2),
        csvNumber(row.laborMargin, 2),
        csvNumber(row.laborMarginPct != null ? row.laborMarginPct * 100 : null, 1),
        csvNumber(row.casesPerMinute, 2),
        csvNumber(row.casesPerPayableHour, 2),
        csvNumber(row.shiftMinutes, 0),
        row.hasLabor ? "yes" : "no",
        row.laborStatus || "",
        row.laborIsProvisional ? "yes" : "no",
        row.laborSource || "",
        row.allocationMethod || "",
        row.matchLevel || "",
        row.hasRevenue ? "yes" : "no",
        row.missingRevenue ? "yes" : "no"
      ].map(csvCell).join(",");
    });
    var stamp = rangeStart && rangeEnd
      ? (rangeStart === rangeEnd ? rangeStart : (rangeStart + "_to_" + rangeEnd))
      : new Date().toISOString().slice(0, 10);
    triggerDownload(
      [headers.map(csvCell).join(",")].concat(rows).join("\n"),
      "production_jobs_labor_" + stamp + ".csv",
      "text/csv"
    );
  };

  if (!prodShiftRows.length) {
    return <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 text-sm text-[rgb(var(--muted))]">
      {totalRows > 0
        ? ("Production rows loaded (" + totalRows.toLocaleString() + "), but " + (rowsWithShift || 0).toLocaleString() + " had usable shift timestamps. Check Nulogy timestamp columns.")
        : "No production data yet. Run Nulogy sync and include the Production report."}
    </div>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="text" placeholder="Search WO / SKU / job / line" value={search} onChange={function(e) { setSearch(e.target.value); }} className="h-10 w-full text-sm sm:w-72" />
        <DatePicker value={rangeStart} onChange={handleProdDateStartChange} placeholder="Start date" className="h-10 w-[132px]" />
        <span className="text-xs text-[rgb(var(--muted))] whitespace-nowrap">-</span>
        <DatePicker value={rangeEnd} onChange={handleProdDateEndChange} placeholder="End date" className="h-10 w-[132px]" />
        <select value={lineFilter} onChange={function(e) { setLineFilter(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Lines</option>
          {lineOptions.map(function(line) { return <option key={line} value={line}>{line}</option>; })}
        </select>
        <select value={shiftFilter} onChange={function(e) { setShiftFilter(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Shifts</option>
          {shiftOptions.map(function(shift) { return <option key={shift} value={shift}>{shortShift(shift)}</option>; })}
        </select>
        <Button onClick={exportLaborCsv} variant="outline" size="default" className="h-10 shrink-0" disabled={!jobsWithDetailLabor.length}>
          <Download className="mr-1.5 h-4 w-4" />
          Export Jobs Data
        </Button>
      </div>

      <div className="mb-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          { l:"Units", v:totalUnitsProduced.toLocaleString(), s:isAllMatchingDays ? "all matching days" : selectedRangeLabel, c:C.bright },
          { l:"Total Revenue", v:fmtMoneyWhole(totalRevenue), s:totalRevenueCoveragePct > 0 ? (totalRevenueCoveragePct + "% revenue covered") : "revenue not matched", meta:totalRevenueCoveragePct > 0 && totalRevenueCoveragePct < 100 ? ((totalUnitsProduced - totalRevenueCoveredUnits).toLocaleString() + " units missing revenue") : null, c:C.ok },
          { l:"Total Labor", v:fmtMoneyWhole(totalLaborCost), s:totalLaborHours > 0 ? (totalLaborHours.toFixed(1) + " labor hrs · " + laborStatusLabel(overallLaborStatus)) : "labor not matched", c:C.accent },
          { l:"Labor Margin", v:fmtMoneyWhole(totalLaborMargin), s:totalLaborMarginPct != null ? ("Margin " + fmtPct(totalLaborMarginPct) + " · " + laborStatusLabel(overallLaborStatus)) : "revenue not matched", c:totalLaborMargin >= 0 ? C.ok : C.bad },
          { l:"Shift 1 Yield", v:shift1Units.toLocaleString(), s:"7a-3p · " + shift1Share + "% share", t:shiftCompareText(shift1Jobs, shift2Jobs, shift1Delta, "S2", shift1AvgPerJob), meta:laborRateText(safeNum(shift1Total && shift1Total.laborPayableHours), shift1Units, safeNum(shift1Total && shift1Total.laborCost)) + ((shift1Total && shift1Total.laborStatus && shift1Total.laborStatus !== "finalized") ? (" · " + laborStatusLabel(shift1Total.laborStatus)) : ""), c:C.ok },
          { l:"Shift 2 Yield", v:shift2Units.toLocaleString(), s:"3p-11p · " + shift2Share + "% share", t:shiftCompareText(shift2Jobs, shift1Jobs, shift2Delta, "S1", shift2AvgPerJob), meta:laborRateText(safeNum(shift2Total && shift2Total.laborPayableHours), shift2Units, safeNum(shift2Total && shift2Total.laborCost)) + ((shift2Total && shift2Total.laborStatus && shift2Total.laborStatus !== "finalized") ? (" · " + laborStatusLabel(shift2Total.laborStatus)) : ""), c:C.accent },
          { l:"Top Line", v:topLine ? topLine.line : "--", s:topLine ? (topLine.units.toLocaleString() + " cs · " + topLine.sharePct + "% share") : "no line data", meta:topLine ? (laborRateText(topLine.laborPayableHours, topLine.units, topLine.laborCost) + (topLine.laborStatus !== "finalized" ? (" · " + laborStatusLabel(topLine.laborStatus)) : "")) : "labor not matched", c:C.ok }
        ].map(function(s) {
          return <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:600 }}>{s.l}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.s}</div>
            {s.t ? <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.t}</div> : null}
            {s.meta ? <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.meta}</div> : null}
          </div>;
        })}
        <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:C.accent, lineHeight:1 }}>
            {topJob ? (topJob.itemCode || "--") : "--"}
          </div>
          <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:600 }}>Top Job</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {topJob ? (topJob.itemDesc || "--") : "no job data"}
          </div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
            {topJob ? (topJob.unitsProduced.toLocaleString() + " cs · Job " + topJob.jobId + " · " + topJob.line) : ""}
          </div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
            {topJob ? laborRateText(topJob.laborPayableHours, topJob.unitsProduced, topJob.laborCost) : ""}
          </div>
        </div>
      </div>

      {totalLaborHours > 0 && overallLaborStatus !== "finalized" ? (
        <div style={{ marginBottom:10, background:C.surface, border:"1px solid " + C.border, borderRadius:8, padding:"10px 12px", fontSize:12, color:C.dim }}>
          Labor actuals in this view are <span style={{ fontWeight:700, color:C.text }}>{laborStatusLabel(overallLaborStatus)}</span>.
          {laborFinalizedThroughDate ? (" Finalized through " + laborFinalizedThroughDate + ".") : ""}
          {" "}Current-day labor can shift after end-of-day Nulogy edits.
        </div>
      ) : null}

      <div className="mb-3 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-sm font-semibold">Job Level Details</div>
          </div>
          <button
            type="button"
            onClick={function() { setShowLineExecution(function(v) { return !v; }); }}
            className="inline-flex h-9 items-center rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]"
          >
            <span className="mr-1">{showLineExecution ? "▾" : "▸"}</span>
            {showLineExecution ? "Hide" : "Show"}
          </button>
        </div>
        {showLineExecution ? (
        <TableShell className="overflow-x-auto overflow-y-hidden">
          <table style={{ width:"100%", minWidth:1300, borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.raised }}>
                <th style={thS}>Line / Job / Shift</th>
                <th style={thS}>Context</th>
                <th style={thS}>Units</th>
                <th style={thS}>Revenue</th>
                <th style={thS}>Price/Unit</th>
                <th style={thS}>Labor Hrs</th>
                <th style={thS}>Labor</th>
                <th style={thS}>Labor Margin</th>
                <th style={thS}>Margin %</th>
                <th style={thS}>Cases/Min</th>
              </tr>
            </thead>
            <tbody>
              {lineExecution.map(function(r) {
                var expanded = lineExpanded(r.line);
                return [
                  <tr key={r.line} style={{ borderBottom:"1px solid " + C.border, background:C.surface }}>
                    <td style={tdM}>
                      <button
                        type="button"
                        onClick={function() { toggleLineExpanded(r.line); }}
                        style={{ display:"inline-flex", alignItems:"center", gap:8, border:"none", background:"transparent", padding:0, cursor:"pointer", color:C.text, font:"inherit" }}
                      >
                        <span style={{ fontFamily:mono, color:C.dim }}>{expanded ? "▾" : "▸"}</span>
                        <span style={{ fontWeight:700 }}>{r.line}</span>
                      </button>
                    </td>
                    <td style={tdM}>
                      <div>{r.sharePct}% share · {r.jobCount} jobs</div>
                      {r.laborStatus !== "finalized" ? (
                        <div style={{ fontSize:11, color:C.warn }}>{laborStatusLabel(r.laborStatus)}</div>
                      ) : null}
                      {r.missingRevenueSkuCount > 0 ? (
                        <div style={{ fontSize:11, color:C.bad }}>
                          {r.revenueCoveragePct}% priced · {r.missingRevenueSkuCount} SKU{r.missingRevenueSkuCount === 1 ? "" : "s"} missing revenue
                        </div>
                      ) : null}
                    </td>
                    <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.units.toLocaleString()}</td>
                    <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.revenue) : "--"}</td>
                    <td style={tdM}>{r.pricePerUnit != null ? fmtMoney(r.pricePerUnit) : "--"}</td>
                    <td style={tdM}>{r.laborPayableHours > 0 ? r.laborPayableHours.toFixed(1) : "--"}</td>
                    <td style={tdM}>{r.laborCost > 0 ? fmtMoneyWhole(r.laborCost) : "--"}</td>
                    <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.laborMargin) : "--"}</td>
                    <td style={tdM}>{r.revenue > 0 ? fmtPct(r.laborMarginPct) : "--"}</td>
                    <td style={tdM}>{r.casesPerMinute > 0 ? r.casesPerMinute.toFixed(2) : "--"}</td>
                  </tr>,
                  expanded ? r.lineJobs.map(function(job) {
                    var expandedJob = jobExpanded(job.key);
                    return [
                      <tr key={job.key} style={{ borderBottom:"1px solid " + C.border, background:C.raised }}>
                        <td style={Object.assign({}, tdM, { paddingLeft:"28px" })}>
                          <button
                            type="button"
                            onClick={function() { toggleJobExpanded(job.key); }}
                            style={{ display:"inline-flex", alignItems:"center", gap:8, border:"none", background:"transparent", padding:0, cursor:"pointer", color:C.text, font:"inherit" }}
                          >
                            <span style={{ fontFamily:mono, color:C.dim }}>{expandedJob ? "▾" : "▸"}</span>
                            <span style={{ fontWeight:600, color:C.bright }}>{job.jobId}</span>
                          </button>
                          <div style={{ fontSize:11, color:C.dim, paddingLeft:"20px" }}>{job.itemCode}</div>
                        </td>
                        <td style={tdM}>
                          <div>{job.workOrder}</div>
                          <div style={{ fontSize:11, color:C.dim }}>{job.shiftCount} shift bucket{job.shiftCount === 1 ? "" : "s"}</div>
                          {job.laborStatus !== "finalized" ? <div style={{ fontSize:11, color:C.warn }}>{laborStatusLabel(job.laborStatus)}</div> : null}
                          <div style={{ fontSize:11, color:C.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:260 }}>{job.itemDesc}</div>
                        </td>
                        <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{job.unitsProduced.toLocaleString()}</td>
                        <td style={tdM}>
                          {job.revenue > 0 ? fmtMoneyWhole(job.revenue) : <span style={{ color:C.bad, fontWeight:600 }}>Missing</span>}
                          {job.missingRevenueSkuCount > 0 ? (
                            <div style={{ fontSize:11, color:C.bad }}>
                              {job.revenueCoveragePct}% priced · {job.missingRevenueSkuCount} missing
                            </div>
                          ) : null}
                        </td>
                        <td style={tdM}>{job.pricePerUnit != null ? fmtMoney(job.pricePerUnit) : "--"}</td>
                        <td style={tdM}>{job.laborPayableHours > 0 ? job.laborPayableHours.toFixed(1) : "--"}</td>
                        <td style={tdM}>{job.laborCost > 0 ? fmtMoneyWhole(job.laborCost) : "--"}</td>
                        <td style={tdM}>{job.revenue > 0 ? fmtMoneyWhole(job.laborMargin) : "--"}</td>
                        <td style={tdM}>{job.revenue > 0 ? fmtPct(job.laborMarginPct) : "--"}</td>
                        <td style={tdM}>{job.casesPerMinute > 0 ? job.casesPerMinute.toFixed(2) : "--"}</td>
                      </tr>,
                      expandedJob ? job.detailRows.map(function(detail, idx) {
                        return (
                          <tr key={job.key + "-detail-" + idx} style={{ borderBottom:"1px solid " + C.border, background:"#fbfcfe" }}>
                            <td style={Object.assign({}, tdM, { paddingLeft:"56px" })}>
                              <div style={{ fontWeight:600 }}>{shortShift(detail.shift)}</div>
                              <div style={{ fontSize:11, color:C.dim }}>{detail.date || "--"}</div>
                            </td>
                            <td style={tdM}>
                              <div>{detail.workOrder}</div>
                              {detail.hasLabor && detail.laborStatus !== "finalized" ? <div style={{ fontSize:11, color:C.warn }}>{laborStatusLabel(detail.laborStatus)}</div> : null}
                              <div style={{ fontSize:11, color:C.dim, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:260 }}>{formatDescriptionForDisplay(detail.itemDesc) || "--"}</div>
                            </td>
                            <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{detail.unitsProduced.toLocaleString()}</td>
                            <td style={tdM}>
                              {detail.revenue > 0 ? fmtMoneyWhole(detail.revenue) : <span style={{ color:C.bad, fontWeight:600 }}>Missing</span>}
                            </td>
                            <td style={tdM}>{detail.pricePerUnit != null ? fmtMoney(detail.pricePerUnit) : "--"}</td>
                            <td style={tdM}>
                              <div>{detail.laborPayableHours > 0 ? detail.laborPayableHours.toFixed(1) : "--"}</div>
                              {detail.hasLabor && detail.laborStatus !== "finalized" ? <div style={{ fontSize:11, color:C.warn }}>{laborStatusLabel(detail.laborStatus)}</div> : null}
                            </td>
                            <td style={tdM}>
                              <div>{detail.laborCost > 0 ? fmtMoneyWhole(detail.laborCost) : "--"}</div>
                              {detail.hasLabor && detail.laborStatus !== "finalized" ? <div style={{ fontSize:11, color:C.warn }}>provisional</div> : null}
                            </td>
                            <td style={tdM}>{detail.revenue > 0 ? fmtMoneyWhole(detail.laborMargin) : "--"}</td>
                            <td style={tdM}>{detail.revenue > 0 ? fmtPct(detail.laborMarginPct) : "--"}</td>
                            <td style={tdM}>{detail.casesPerMinute > 0 ? detail.casesPerMinute.toFixed(2) : "--"}</td>
                          </tr>
                        );
                      }) : null
                    ];
                  }) : null
                ];
              })}
              {!lineExecution.length && <tr><td colSpan={10} style={{ padding:20, textAlign:"center", color:C.dim }}>No line or job rollups for current filters.</td></tr>}
            </tbody>
          </table>
        </TableShell>
        ) : null}
      </div>
    </div>
  );
}
