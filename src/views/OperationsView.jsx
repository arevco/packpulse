import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";
import ProductionView from "./ProductionView";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { detectPackType, formatDescriptionForDisplay, normalizeStr } from "../utils";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function createEmptyLaborActuals(status, productionStatus) {
  return {
    summary: {},
    byDay: [],
    byShift: [],
    byLine: [],
    byRole: [],
    byWorkOrder: [],
    byJob: [],
    status: status || "idle",
    productionStatus: productionStatus || "ok"
  };
}

var EMPTY_BREAKDOWN = { rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0 };
var operationsResponseCache = {
  breakdown: Object.create(null),
  forecast: Object.create(null),
  config: Object.create(null),
  labor: Object.create(null)
};
var operationsInFlightCache = {
  breakdown: Object.create(null),
  forecast: Object.create(null),
  config: Object.create(null),
  labor: Object.create(null)
};

function readCachedOperationsData(kind, key) {
  var bucket = operationsResponseCache[kind] || {};
  return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : null;
}

function loadCachedOperationsData(kind, key, loader) {
  var cached = readCachedOperationsData(kind, key);
  if (cached != null) return Promise.resolve(cached);
  var inflight = operationsInFlightCache[kind] || {};
  if (inflight[key]) return inflight[key];
  var request = Promise.resolve()
    .then(loader)
    .then(function(result) {
      operationsResponseCache[kind][key] = result;
      delete operationsInFlightCache[kind][key];
      return result;
    })
    .catch(function(error) {
      delete operationsInFlightCache[kind][key];
      throw error;
    });
  operationsInFlightCache[kind][key] = request;
  return request;
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

function normalizeBreakdownPayload(body) {
  var breakdownRows = Array.isArray(body && body.rowsLite) ? body.rowsLite : [];
  return {
    trends: {
      byDay: aggregateBreakdownByDay(breakdownRows).slice().sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
      byShift: aggregateBreakdownByShift(breakdownRows)
    },
    breakdown: {
      rowsLite: breakdownRows,
      bySku: Array.isArray(body && body.bySku) ? body.bySku : [],
      byLine: Array.isArray(body && body.byLine) ? body.byLine : [],
      latestByLine: Array.isArray(body && body.latestByLine) ? body.latestByLine : [],
      latestDate: body && body.latestDate ? body.latestDate : null,
      totalRows: safeNum(body && body.totalRows),
    }
  };
}

function normalizeConfigPayload(body) {
  return {
    skuTargets: body && Array.isArray(body.skuTargets) ? body.skuTargets : [],
    itemMasterCostBySku: body && body.itemMasterCostBySku && typeof body.itemMasterCostBySku === "object"
      ? body.itemMasterCostBySku
      : {}
  };
}

function normalizeForecastPlansPayload(body) {
  return body && typeof body.plans === "object" ? body.plans : {};
}

function normalizeLaborActualsPayload(ok, body) {
  if (!ok || !body) return createEmptyLaborActuals("error", "error");
  return {
    summary: body.summary || {},
    byDay: Array.isArray(body.byDay) ? body.byDay : [],
    byShift: Array.isArray(body.byShift) ? body.byShift : [],
    byLine: Array.isArray(body.byLine) ? body.byLine : [],
    byRole: Array.isArray(body.byRole) ? body.byRole : [],
    byWorkOrder: Array.isArray(body.byWorkOrder) ? body.byWorkOrder : [],
    byJob: Array.isArray(body.byJob) ? body.byJob : [],
    status: body.status || "ok",
    productionStatus: body.productionStatus || "ok"
  };
}

function scheduleAfterPaint(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    var rafOne = 0;
    var rafTwo = 0;
    rafOne = window.requestAnimationFrame(function() {
      rafTwo = window.requestAnimationFrame(callback);
    });
    return function() {
      if (rafOne) window.cancelAnimationFrame(rafOne);
      if (rafTwo) window.cancelAnimationFrame(rafTwo);
    };
  }
  var timerId = setTimeout(callback, 0);
  return function() { clearTimeout(timerId); };
}

var moneyCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1
});

var moneyWholeFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

function fmtMoneyCompact(v) {
  return moneyCompactFormatter.format(safeNum(v));
}

function fmtMoney(v) {
  return moneyWholeFormatter.format(safeNum(v));
}

function fmtMissingRevenueSkuCount(count) {
  return count + " SKU" + (count === 1 ? "" : "s") + " missing revenue";
}

function fmtMoneyPrecise(v) {
  var amount = safeNum(v);
  if (!Number.isFinite(amount)) return "--";
  if (amount < 0) return "-$" + Math.abs(amount).toFixed(2);
  return "$" + amount.toFixed(2);
}

function fmtCasesPerHour(v) {
  return safeNum(v).toFixed(1) + " cs/lh";
}

function deriveLaborStatusFromRows(finalizedRows, provisionalRows) {
  if (provisionalRows > 0 && finalizedRows > 0) return "mixed";
  if (provisionalRows > 0) return "provisional";
  if (finalizedRows > 0) return "finalized";
  return "unknown";
}

function laborStatusShortLabel(status) {
  if (status === "provisional") return "Provisional";
  if (status === "mixed") return "Mixed";
  if (status === "finalized") return "Finalized";
  return "Unmatched";
}

function OperationsDailyTotalTooltipContent(props) {
  var active = props.active;
  var payload = props.payload;
  var label = props.label;
  var config = props.config || {};
  if (!active || !payload || !payload.length) return null;
  var rows = payload.filter(function(item) { return String(item && item.dataKey || "") !== "plan"; });
  if (!rows.length) return null;
  var sourceRow = rows[0] && rows[0].payload ? rows[0].payload : {};
  var total = safeNum(sourceRow.total);
  return (
    <div className="min-w-[170px] rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-[rgb(var(--foreground))]">{label}</div>
      <div className="space-y-1">
        {rows.map(function(item, idx) {
          var key = String(item.dataKey || "");
          var cfg = config[key] || {};
          var name = cfg.label || item.name || key;
          var color = item.color || cfg.color || "rgb(var(--muted))";
          return (
            <div key={key + "-" + idx} className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-[rgb(var(--muted))]">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} />
                {name}
              </span>
              <span className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]">
                {Math.round(safeNum(item.value)).toLocaleString()}
              </span>
            </div>
          );
        })}
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 text-[rgb(var(--muted))]">
            <span className="h-2 w-2 rounded-sm bg-[rgb(var(--foreground))]" />
            Daily Total
          </span>
          <span className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]">
            {Math.round(total).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function normalizeItemCode(value) {
  return normalizeStr(String(value || "").trim());
}

function pickItemMasterCostValue(row) {
  if (!row || typeof row !== "object") return 0;
  var keys = [
    "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ];
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null && row[key] !== "") {
      return safeNum(row[key]);
    }
  }
  var rowKeys = Object.keys(row);
  for (var j = 0; j < rowKeys.length; j += 1) {
    var rk = rowKeys[j];
    var nk = normalizeStr(rk || "");
    var hasCostToken = nk.includes("cost") || nk.includes("price");
    var looksLikeUnitish = nk.includes("unit") || nk.includes("base") || nk.includes("standard") || nk.includes("average") || nk.includes("avg") || nk === "cost" || nk === "price";
    if (hasCostToken && looksLikeUnitish && !nk.includes("total") && !nk.includes("extended") && !nk.includes("amount")) {
      return safeNum(row[rk]);
    }
  }
  return 0;
}

function businessDaysBetween(fromDate, toDate) {
  var from = new Date(fromDate);
  var to = new Date(toDate);
  if (isNaN(from) || isNaN(to) || from > to) return 0;
  var c = 0;
  var d = new Date(from);
  while (d <= to) {
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) c += 1;
    d.setDate(d.getDate() + 1);
  }
  return c;
}

function pctDelta(actual, plan) {
  if (!plan) return 0;
  return Math.round(((safeNum(actual) - safeNum(plan)) / safeNum(plan)) * 100);
}

function toIsoDateLocal(d) {
  var dt = new Date(d);
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, "0");
  var day = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function toIsoDateUTC(d) {
  var dt = new Date(d);
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  var day = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function toIsoDateET(d) {
  var dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return "";
  var parts = {};
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  fmt.formatToParts(dt).forEach(function(p) {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function toEasternDateTimeParts(d) {
  var dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  var parts = {};
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  fmt.formatToParts(dt).forEach(function(p) {
    if (p.type !== "literal") parts[p.type] = p.value;
  });
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return null;
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    hour: parseInt(parts.hour, 10),
    minute: parseInt(parts.minute, 10)
  };
}

function productionDayElapsedMinutesET(d) {
  var parts = toEasternDateTimeParts(d);
  if (!parts) return 0;
  var totalMinutes = (safeNum(parts.hour) * 60) + safeNum(parts.minute);
  var productionStart = 7 * 60;
  var productionEnd = 23 * 60;
  if (totalMinutes <= productionStart) return 0;
  if (totalMinutes >= productionEnd) return 960;
  return Math.max(0, Math.min(960, totalMinutes - productionStart));
}

function shiftDays(dateIso, n) {
  var d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return toIsoDateUTC(d);
}

function weekStart(dateIso) {
  var d = new Date(dateIso + "T00:00:00Z");
  var dow = d.getUTCDay();
  var delta = dow === 0 ? -6 : 1 - dow; // monday start
  d.setUTCDate(d.getUTCDate() + delta);
  return toIsoDateUTC(d);
}

function monthStart(dateIso) {
  var d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(1);
  return toIsoDateUTC(d);
}

function monthEnd(dateIso) {
  var d = new Date(dateIso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return toIsoDateUTC(d);
}

function eachDayIsoBetween(startIso, endIso) {
  if (!startIso || !endIso) return [];
  var start = new Date(startIso + "T00:00:00Z");
  var end = new Date(endIso + "T00:00:00Z");
  if (isNaN(start) || isNaN(end) || end < start) return [];
  var out = [];
  var d = new Date(start);
  while (d <= end) {
    out.push(toIsoDateUTC(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function eachMonthKeysBetween(startIso, endIso) {
  if (!startIso || !endIso) return [];
  var start = String(startIso).slice(0, 7);
  var end = String(endIso).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || end < start) return [];
  var out = [];
  var cursor = new Date(start + "-01T00:00:00Z");
  var limit = new Date(end + "-01T00:00:00Z");
  while (cursor <= limit) {
    out.push(toIsoDateUTC(cursor).slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    cursor.setUTCDate(1);
  }
  return out;
}

function isBusinessDay(dateIso) {
  if (!dateIso) return false;
  var d = new Date(String(dateIso).slice(0, 10) + "T00:00:00Z");
  if (isNaN(d)) return false;
  var dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

function daysInclusive(startIso, endIso) {
  var start = new Date(startIso + "T00:00:00");
  var end = new Date(endIso + "T00:00:00");
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  return Math.floor((end - start) / 86400000) + 1;
}

function shiftRange(range, days) {
  return {
    start: shiftDays(range.start, days),
    end: shiftDays(range.end, days)
  };
}

function clipRangeEnd(range, maxEnd) {
  if (!range) return range;
  if (!maxEnd || range.end <= maxEnd) return range;
  return {
    start: range.start,
    end: maxEnd
  };
}

function comparableRangeForPreset(presetKey, currentRange) {
  var spanDays = daysInclusive(currentRange && currentRange.start, currentRange && currentRange.end);
  if (!currentRange || !currentRange.start || !currentRange.end || spanDays <= 0) {
    return { label: "vs prior period", range: null };
  }
  if (presetKey === "today") {
    return { label: "vs yesterday", range: shiftRange(currentRange, -1) };
  }
  if (presetKey === "yesterday") {
    return { label: "vs prior day", range: shiftRange(currentRange, -1) };
  }
  if (presetKey === "this_week") {
    return { label: "vs same days last week", range: shiftRange(currentRange, -7) };
  }
  if (presetKey === "last_week") {
    return { label: "vs previous week", range: shiftRange(currentRange, -7) };
  }
  if (presetKey === "this_month") {
    var prevMonthEnd = shiftDays(monthStart(currentRange.start), -1);
    var prevMonthStart = monthStart(prevMonthEnd);
    var prevMonthRange = {
      start: prevMonthStart,
      end: shiftDays(prevMonthStart, spanDays - 1)
    };
    return { label: "vs same days last month", range: clipRangeEnd(prevMonthRange, monthEnd(prevMonthEnd)) };
  }
  if (presetKey === "last_month") {
    var priorMonthEnd = shiftDays(monthStart(currentRange.start), -1);
    return {
      label: "vs previous month",
      range: {
        start: monthStart(priorMonthEnd),
        end: monthEnd(priorMonthEnd)
      }
    };
  }
  return { label: "vs prior period", range: shiftRange(currentRange, -spanDays) };
}

function presetRange(preset) {
  var today = toIsoDateET(new Date());
  if (preset === "today") return { start: today, end: today, fetchDays: 14 };
  if (preset === "yesterday") {
    var y = shiftDays(today, -1);
    return { start: y, end: y, fetchDays: 21 };
  }
  if (preset === "this_week") return { start: weekStart(today), end: today, fetchDays: 30 };
  if (preset === "last_week") {
    var thisStart = weekStart(today);
    var lastEnd = shiftDays(thisStart, -1);
    return { start: shiftDays(lastEnd, -6), end: lastEnd, fetchDays: 45 };
  }
  if (preset === "this_month") {
    return { start: monthStart(today), end: today, fetchDays: 90 };
  }
  if (preset === "last_month") {
    var thisMonthStart = monthStart(today);
    var prevMonthEnd = shiftDays(thisMonthStart, -1);
    return { start: monthStart(prevMonthEnd), end: monthEnd(prevMonthEnd), fetchDays: 120 };
  }
  if (preset === "last_30") return { start: shiftDays(today, -29), end: today, fetchDays: 45 };
  if (preset === "last_60") return { start: shiftDays(today, -59), end: today, fetchDays: 75 };
  return { start: shiftDays(today, -13), end: today, fetchDays: 30 };
}

function inRange(dateIso, range) {
  if (!dateIso || !range) return false;
  var raw = String(dateIso || "").trim();
  if (!raw) return false;
  var normalized = "";
  var isoPrefix = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoPrefix && isoPrefix[1]) {
    normalized = isoPrefix[1];
  } else {
    var parsed = new Date(raw);
    if (isNaN(parsed)) return false;
    normalized = toIsoDateET(parsed);
  }
  if (!normalized) return false;
  return normalized >= range.start && normalized <= range.end;
}

function inRangeIso(dateIso, range) {
  if (!dateIso || !range || !range.start || !range.end) return false;
  return dateIso >= range.start && dateIso <= range.end;
}

function shortShiftLabel(label) {
  var s = String(label || "").toLowerCase();
  if (s.indexOf("shift 1") !== -1) return "S1";
  if (s.indexOf("shift 2") !== -1) return "S2";
  return "Un";
}

function toLineKey(lineName) {
  var base = String(lineName || "Unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return "line_" + (base || "unknown");
}

function toSeriesKey(prefix, label) {
  var base = String(label || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return prefix + "_" + (base || "unknown");
}

function lineColor(index) {
  var palette = [
    "#0072B2",
    "#E69F00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#D55E00",
    "#7F7F7F",
  ];
  return palette[index % palette.length];
}

var OPERATIONS_SHIFT_COLORS = {
  s1: "#0072B2",
  s2: "#E69F00",
  un: "#7F7F7F"
};

var OPERATIONS_ECONOMICS_COLORS = {
  cases: "#0072B2",
  revenue: "#009E73",
  labor: "#CC79A7"
};

var COMMAND_BOARD_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" }
];

function normalizeKeyLocal(s) {
  return String(s || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function pickFieldLooseLocal(row, keys) {
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
  keys.forEach(function(k) { wanted[normalizeKeyLocal(k)] = true; });
  for (var x = 0; x < rowKeys.length; x++) {
    var key = rowKeys[x];
    if (wanted[normalizeKeyLocal(key)]) return row[key];
  }
  return "";
}

function secToMin(v) {
  return Math.round(safeNum(v) / 60);
}

function pct(part, whole) {
  var p = safeNum(part);
  var w = safeNum(whole);
  if (!(w > 0)) return 0;
  return Math.round((p / w) * 100);
}

function normalizeEvoconShift(shiftRaw) {
  var s = String(shiftRaw || "").toLowerCase();
  if (s.includes("1") || s.includes("1st")) return "Shift 1 (7a-3p)";
  if (s.includes("2") || s.includes("2nd")) return "Shift 2 (3p-11p)";
  return "Unassigned";
}

function buildRawNulogySeries(rows) {
  var byDay = {};
  var byShift = {};
  var byLine = {};
  var bySku = {};
  var byDateLine = {};
  var rowsLite = [];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var units = safeNum(pickFieldLooseLocal(row, ["Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"]));
    if (!(units > 0)) return;
    var producedRaw = pickFieldLooseLocal(row, [
      "Produced date", "producedAt",
      "Produced At", "produced_at",
      "Actual Job End", "actual_job_end_at"
    ]);
    var date = toIsoDateET(producedRaw || new Date());
    if (!date) return;
    var shift = "Unassigned";
    var dt = new Date(producedRaw || "");
    if (!isNaN(dt)) {
      var parts = {};
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).formatToParts(dt).forEach(function(p) {
        if (p.type !== "literal") parts[p.type] = p.value;
      });
      var hour = parseInt(parts.hour || "0", 10);
      var minute = parseInt(parts.minute || "0", 10);
      var totalMinutes = (hour * 60) + minute;
      if (totalMinutes >= (7 * 60) && totalMinutes <= ((15 * 60) + 5)) shift = "Shift 1 (7a-3p)";
      else if (totalMinutes >= ((15 * 60) + 6) && totalMinutes <= ((23 * 60) + 59)) shift = "Shift 2 (3p-11p)";
    }
    var line = String(pickFieldLooseLocal(row, ["Line", "line", "line_name", "Line Name"]) || "--").trim() || "--";
    var sku = String(pickFieldLooseLocal(row, ["Item Code", "item_code"]) || "").trim() || "UNKNOWN";
    var itemDesc = String(pickFieldLooseLocal(row, ["Description", "description", "Item Description", "item_description"]) || "").trim();
    var wo = String(pickFieldLooseLocal(row, ["Work Order Code", "project_code", "Project Code"]) || "").trim();

    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += 1;
    var shiftKey = date + "|" + shift;
    if (!byShift[shiftKey]) byShift[shiftKey] = { date: date, shift: shift, units: 0, rows: 0 };
    byShift[shiftKey].units += units;
    byShift[shiftKey].rows += 1;
    if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
    byLine[line].units += units;
    byLine[line].rows += 1;
    if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
    bySku[sku].units += units;
    bySku[sku].rows += 1;
    if (!byDateLine[date]) byDateLine[date] = {};
    if (!byDateLine[date][line]) byDateLine[date][line] = { line: line, units: 0, rows: 0 };
    byDateLine[date][line].units += units;
    byDateLine[date][line].rows += 1;

    rowsLite.push({
      produced_date_et: date,
      shift_label: shift,
      item_code: sku === "UNKNOWN" ? null : sku,
      item_desc: itemDesc || null,
      units_produced: units,
      line: line,
      work_order_code: wo || null
    });
  });
  var latestDate = Object.keys(byDateLine).sort().pop() || null;
  return {
    trends: {
      byDay: Object.values(byDay).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
      byShift: Object.values(byShift).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return String(a.shift || "").localeCompare(String(b.shift || ""));
      })
    },
    breakdown: {
      rowsLite: rowsLite,
      bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }),
      byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
      latestDate: latestDate,
      latestByLine: latestDate ? Object.values(byDateLine[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [],
      totalRows: rowsLite.length
    }
  };
}

function buildEvoconSeries(rows) {
  var byDay = {};
  var byShift = {};
  var rowsLite = [];
  var bySku = {};
  var byLine = {};
  var byDateLine = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var date = String(row.date || "").trim();
    if (!date) return;
    var station = String(row.station || row.line || "Unknown").trim() || "Unknown";
    var shift = normalizeEvoconShift(row.shift);
    var units = safeNum(row.goodQty || row.totalQty || row.goodProduction || row.goodProdction);
    if (!(units > 0)) return;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += 1;
    var shiftKey = date + "|" + shift;
    if (!byShift[shiftKey]) byShift[shiftKey] = { date: date, shift: shift, units: 0, rows: 0 };
    byShift[shiftKey].units += units;
    byShift[shiftKey].rows += 1;
    rowsLite.push({
      produced_date_et: date,
      shift_label: shift,
      item_code: null,
      item_desc: null,
      units_produced: units,
      line: station,
      work_order_code: null
    });
    if (!byLine[station]) byLine[station] = { line: station, units: 0, rows: 0 };
    byLine[station].units += units;
    byLine[station].rows += 1;
    if (!byDateLine[date]) byDateLine[date] = {};
    if (!byDateLine[date][station]) byDateLine[date][station] = { line: station, units: 0, rows: 0 };
    byDateLine[date][station].units += units;
    byDateLine[date][station].rows += 1;
    var sku = "EVOCON";
    if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
    bySku[sku].units += units;
    bySku[sku].rows += 1;
  });
  var latestDate = Object.keys(byDateLine).sort().pop() || null;
  return {
    trends: {
      byDay: Object.values(byDay).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
      byShift: Object.values(byShift).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return String(a.shift || "").localeCompare(String(b.shift || ""));
      })
    },
    breakdown: {
      rowsLite: rowsLite,
      bySku: Object.values(bySku),
      byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
      latestDate: latestDate,
      latestByLine: latestDate ? Object.values(byDateLine[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [],
      totalRows: rowsLite.length
    }
  };
}

function mergeTrendSeries(baseRows, extraRows) {
  var map = {};
  (baseRows || []).forEach(function(r) {
    var key = String(r.date || "") + "|" + String(r.shift || "");
    map[key] = {
      date: String(r.date || ""),
      shift: String(r.shift || ""),
      units: safeNum(r.units),
      rows: safeNum(r.rows)
    };
  });
  (extraRows || []).forEach(function(r) {
    var key = String(r.date || "") + "|" + String(r.shift || "");
    if (!map[key]) map[key] = { date: String(r.date || ""), shift: String(r.shift || ""), units: 0, rows: 0 };
    map[key].units += safeNum(r.units);
    map[key].rows += safeNum(r.rows);
  });
  return Object.values(map).sort(function(a, b) {
    if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
    return String(a.shift || "").localeCompare(String(b.shift || ""));
  });
}

function mergeDaySeries(baseRows, extraRows) {
  var map = {};
  (baseRows || []).forEach(function(r) {
    var key = String(r.date || "");
    map[key] = { date: key, units: safeNum(r.units), rows: safeNum(r.rows) };
  });
  (extraRows || []).forEach(function(r) {
    var key = String(r.date || "");
    if (!map[key]) map[key] = { date: key, units: 0, rows: 0 };
    map[key].units += safeNum(r.units);
    map[key].rows += safeNum(r.rows);
  });
  return Object.values(map).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
}

function aggregateBreakdownByDay(rowsLite) {
  var byDay = {};
  (Array.isArray(rowsLite) ? rowsLite : []).forEach(function(r) {
    var date = String(r && r.produced_date_et || "");
    var units = safeNum(r && r.units_produced);
    if (!date || !(units > 0)) return;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += 1;
  });
  return Object.values(byDay).sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
}

function aggregateBreakdownByShift(rowsLite) {
  var byShift = {};
  (Array.isArray(rowsLite) ? rowsLite : []).forEach(function(r) {
    var date = String(r && r.produced_date_et || "");
    var shift = String(r && r.shift_label || "Unassigned");
    var units = safeNum(r && r.units_produced);
    if (!date || !(units > 0)) return;
    var key = date + "|" + shift;
    if (!byShift[key]) byShift[key] = { date: date, shift: shift, units: 0, rows: 0 };
    byShift[key].units += units;
    byShift[key].rows += 1;
  });
  return Object.values(byShift).sort(function(a, b) {
    if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
    return String(a.shift || "").localeCompare(String(b.shift || ""));
  });
}

function aggregateBreakdownShiftMix(rowsLite) {
  var byDate = {};
  (Array.isArray(rowsLite) ? rowsLite : []).forEach(function(r) {
    var date = String(r && r.produced_date_et || "");
    var shift = String(r && r.shift_label || "Unassigned");
    var units = safeNum(r && r.units_produced);
    if (!date || !(units > 0)) return;
    if (!byDate[date]) byDate[date] = { date: date, s1: 0, s2: 0, un: 0, total: 0 };
    if (shift.indexOf("Shift 1") !== -1) byDate[date].s1 += units;
    else if (shift.indexOf("Shift 2") !== -1) byDate[date].s2 += units;
    else byDate[date].un += units;
    byDate[date].total += units;
  });
  return Object.values(byDate).sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
}

function preferHigherDaySeries(primaryRows, fallbackRows) {
  var map = {};
  var add = function(row) {
    var key = String((row && row.date) || "");
    if (!key) return;
    var units = safeNum(row.units);
    var rows = safeNum(row.rows);
    if (!map[key] || units > safeNum(map[key].units)) {
      map[key] = { date: key, units: units, rows: rows };
    }
  };
  (Array.isArray(primaryRows) ? primaryRows : []).forEach(add);
  (Array.isArray(fallbackRows) ? fallbackRows : []).forEach(add);
  return Object.values(map).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); });
}

function preferHigherShiftSeries(primaryRows, fallbackRows) {
  var map = {};
  var add = function(row) {
    var date = String((row && row.date) || "");
    var shift = String((row && row.shift) || "");
    if (!date) return;
    var key = date + "|" + shift;
    var units = safeNum(row.units);
    var rows = safeNum(row.rows);
    if (!map[key] || units > safeNum(map[key].units)) {
      map[key] = { date: date, shift: shift, units: units, rows: rows };
    }
  };
  (Array.isArray(primaryRows) ? primaryRows : []).forEach(add);
  (Array.isArray(fallbackRows) ? fallbackRows : []).forEach(add);
  return Object.values(map).sort(function(a, b) {
    if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
    return String(a.shift || "").localeCompare(String(b.shift || ""));
  });
}

export default function OperationsView({ productionSegments, productionDataRaw, laborDataRaw, evoconData, evoconTimestamp, itemMaster, initialFilters, onPermalinkChange, serverSyncVersion, onRefreshProduction, refreshingProduction }) {
  const { C, mono } = useTheme();
  var initial = initialFilters || {};
  var initialPreset = String(initial.preset || "last_14");
  const [windowPreset, setWindowPreset] = useState(initialPreset);
  const initialRange = presetRange("last_14");
  const [rangeStart, setRangeStart] = useState(String(initial.start || initialRange.start));
  const [rangeEnd, setRangeEnd] = useState(String(initial.end || initialRange.end));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [trends, setTrends] = useState(null);
  const [breakdown, setBreakdown] = useState(EMPTY_BREAKDOWN);
  const [forecastPlans, setForecastPlans] = useState({});
  const [opsSkuTargets, setOpsSkuTargets] = useState([]);
  const [itemMasterCostBySku, setItemMasterCostBySku] = useState({});
  const [laborActuals, setLaborActuals] = useState(function() { return createEmptyLaborActuals("idle", "ok"); });
  const [deferredLoading, setDeferredLoading] = useState({ forecast: false, config: false, labor: false });
  const loadRequestRef = useRef(0);
  const [skuMixMode, setSkuMixMode] = useState("type");
  const [showProductionLines, setShowProductionLines] = useState(false);
  const [showLossPriorities, setShowLossPriorities] = useState(false);
  const [dailyPerfStart, setDailyPerfStart] = useState("");
  const [dailyPerfEnd, setDailyPerfEnd] = useState("");

  var range = useMemo(function() {
    if (windowPreset === "custom") {
      var start = rangeStart || initialRange.start;
      var end = rangeEnd || start;
      if (end < start) {
        var tmp = start; start = end; end = tmp;
      }
      var spanDays = daysInclusive(start, end);
      return { start: start, end: end, fetchDays: Math.max(30, Math.min(180, (spanDays * 2) + 21)) };
    }
    return presetRange(windowPreset);
  }, [windowPreset, rangeStart, rangeEnd, initialRange.start, initialRange.end]);

  var todayEt = useMemo(function() {
    return toIsoDateET(new Date());
  }, []);

  var defaultDailyPerfEnd = useMemo(function() {
    var dates = (trends && Array.isArray(trends.byDay) ? trends.byDay : [])
      .map(function(row) { return String(row && row.date || ""); })
      .filter(Boolean)
      .sort();
    return dates.length ? dates[dates.length - 1] : todayEt;
  }, [trends, todayEt]);

  var dailyPerfRange = useMemo(function() {
    var start = dailyPerfStart || shiftDays(defaultDailyPerfEnd, -29);
    var end = dailyPerfEnd || defaultDailyPerfEnd;
    if (end < start) {
      var tmp = start;
      start = end;
      end = tmp;
    }
    return { start: start, end: end };
  }, [dailyPerfStart, dailyPerfEnd, defaultDailyPerfEnd]);

  var dailyPerfFetchDays = useMemo(function() {
    var fetchStart = dailyPerfRange.start || shiftDays(todayEt, -29);
    if (!fetchStart || fetchStart > todayEt) return 30;
    return Math.max(30, daysInclusive(fetchStart, todayEt));
  }, [dailyPerfRange.start, todayEt]);

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      preset: windowPreset,
      start: rangeStart,
      end: rangeEnd
    });
  }, [onPermalinkChange, windowPreset, rangeStart, rangeEnd]);

  var forecastPlanMonths = useMemo(function() {
    var wanted = {};
    eachMonthKeysBetween(range.start, range.end).forEach(function(monthKey) { wanted[monthKey] = true; });
    COMMAND_BOARD_PRESETS.forEach(function(def) {
      var preset = presetRange(def.key);
      eachMonthKeysBetween(preset.start, preset.end).forEach(function(monthKey) { wanted[monthKey] = true; });
    });
    return Object.keys(wanted).sort();
  }, [range.start, range.end]);

  var setCustomStart = function(v) {
    if (!v) return;
    setWindowPreset("custom");
    setRangeStart(v);
    setRangeEnd(function(prevEnd) {
      var end = prevEnd || v;
      return end < v ? v : end;
    });
  };
  var setCustomEnd = function(v) {
    if (!v) return;
    setWindowPreset("custom");
    setRangeEnd(v);
    setRangeStart(function(prevStart) {
      var start = prevStart || v;
      return start > v ? v : start;
    });
  };

  var loadAll = async function() {
    var requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setErr("");
    try {
      var fetchDays = Math.max(range.fetchDays, dailyPerfFetchDays);
      var laborFetchEnd = toIsoDateET(new Date());
      var laborFetchStart = shiftDays(laborFetchEnd, -(fetchDays - 1));
      var forecastKey = "v" + safeNum(serverSyncVersion) + "|" + forecastPlanMonths.join(",");
      var configKey = "v" + safeNum(serverSyncVersion);
      var laborKey = "v" + safeNum(serverSyncVersion) + "|" + laborFetchStart + "|" + laborFetchEnd;
      var breakdownKey = "v" + safeNum(serverSyncVersion) + "|" + fetchDays;

      var cachedBreakdown = readCachedOperationsData("breakdown", breakdownKey);
      var cachedForecast = readCachedOperationsData("forecast", forecastKey);
      var cachedConfig = readCachedOperationsData("config", configKey);
      var cachedLabor = readCachedOperationsData("labor", laborKey);

      setLoading(!cachedBreakdown);

      if (cachedBreakdown) {
        setTrends(cachedBreakdown.trends);
        setBreakdown(cachedBreakdown.breakdown);
      }
      if (cachedForecast) setForecastPlans(cachedForecast);
      else if (!forecastPlanMonths.length) setForecastPlans({});
      if (cachedConfig) {
        setOpsSkuTargets(cachedConfig.skuTargets);
        setItemMasterCostBySku(cachedConfig.itemMasterCostBySku);
      }
      if (cachedLabor) {
        setLaborActuals(cachedLabor);
      } else {
        setLaborActuals(createEmptyLaborActuals("loading", "loading"));
      }
      setDeferredLoading({
        forecast: !cachedForecast && forecastPlanMonths.length > 0,
        config: !cachedConfig,
        labor: !cachedLabor
      });

      var criticalPayload = cachedBreakdown;
      if (!criticalPayload) {
        criticalPayload = await loadCachedOperationsData("breakdown", breakdownKey, async function() {
          var breakdownResult = await fetchJsonWithCredentials("/api/ops/production-breakdown?days=" + fetchDays);
          if (!breakdownResult.response.ok) {
            throw new Error((breakdownResult.body && breakdownResult.body.error) || "Could not load production breakdown");
          }
          return normalizeBreakdownPayload(breakdownResult.body);
        });
      }
      if (requestId !== loadRequestRef.current) return;
      setTrends(criticalPayload.trends);
      setBreakdown(criticalPayload.breakdown);
      setLoading(false);

      var cancelDeferred = scheduleAfterPaint(function() {
        if (requestId !== loadRequestRef.current) return;

        if (!cachedForecast && forecastPlanMonths.length) {
          loadCachedOperationsData("forecast", forecastKey, async function() {
            var forecastResult = await fetchJsonWithCredentials("/api/ops/forecast-plan?monthKeys=" + encodeURIComponent(forecastPlanMonths.join(",")));
            return normalizeForecastPlansPayload(forecastResult.response.ok ? forecastResult.body : {});
          })
            .then(function(nextForecastPlans) {
              if (requestId !== loadRequestRef.current) return;
              setForecastPlans(nextForecastPlans);
            })
            .catch(function() {})
            .finally(function() {
              if (requestId !== loadRequestRef.current) return;
              setDeferredLoading(function(prev) { return Object.assign({}, prev, { forecast: false }); });
            });
        }

        if (!cachedConfig) {
          loadCachedOperationsData("config", configKey, async function() {
            var configResult = await fetchJsonWithCredentials("/api/ops/config");
            return normalizeConfigPayload(configResult.response.ok ? configResult.body : {});
          })
            .then(function(configPayload) {
              if (requestId !== loadRequestRef.current) return;
              setOpsSkuTargets(configPayload.skuTargets);
              setItemMasterCostBySku(configPayload.itemMasterCostBySku);
            })
            .catch(function() {})
            .finally(function() {
              if (requestId !== loadRequestRef.current) return;
              setDeferredLoading(function(prev) { return Object.assign({}, prev, { config: false }); });
            });
        }

        if (!cachedLabor) {
          loadCachedOperationsData("labor", laborKey, async function() {
            var laborResult = await fetchJsonWithCredentials("/api/ops/labor-actuals?start=" + encodeURIComponent(laborFetchStart) + "&end=" + encodeURIComponent(laborFetchEnd));
            return normalizeLaborActualsPayload(laborResult.response.ok, laborResult.body);
          })
            .then(function(nextLaborActuals) {
              if (requestId !== loadRequestRef.current) return;
              setLaborActuals(nextLaborActuals);
            })
            .catch(function() {
              if (requestId !== loadRequestRef.current) return;
              setLaborActuals(createEmptyLaborActuals("error", "error"));
            })
            .finally(function() {
              if (requestId !== loadRequestRef.current) return;
              setDeferredLoading(function(prev) { return Object.assign({}, prev, { labor: false }); });
            });
        }
      });
      if (requestId !== loadRequestRef.current && typeof cancelDeferred === "function") cancelDeferred();
    } catch (e) {
      if (requestId !== loadRequestRef.current) return;
      setErr(e && e.message ? e.message : "Failed loading Operations data");
      setDeferredLoading({ forecast: false, config: false, labor: false });
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  useEffect(function() {
    loadAll();
  }, [windowPreset, rangeStart, rangeEnd, forecastPlanMonths.join(","), dailyPerfFetchDays, serverSyncVersion]);

  var localNulogySeries = useMemo(function() {
    var shiftRows = (productionSegments && Array.isArray(productionSegments.shiftRows)) ? productionSegments.shiftRows : [];
    var jobRows = (productionSegments && Array.isArray(productionSegments.jobRows)) ? productionSegments.jobRows : [];
    var byDayMap = {};
    shiftRows.forEach(function(r) {
      var date = String(r.date || "");
      if (!date) return;
      if (!byDayMap[date]) byDayMap[date] = { date: date, units: 0, rows: 0 };
      byDayMap[date].units += safeNum(r.unitsProduced);
      byDayMap[date].rows += safeNum(r.jobs);
    });
    var byLine = {};
    var bySku = {};
    var rowsLite = jobRows.map(function(r) {
      var units = safeNum(r.unitsProduced);
      var line = String(r.line || "Unknown");
      var sku = String(r.itemCode || "").trim() || "UNKNOWN";
      if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
      byLine[line].units += units;
      byLine[line].rows += 1;
      if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
      bySku[sku].units += units;
      bySku[sku].rows += 1;
      return {
        produced_date_et: String(r.date || ""),
        shift_label: String(r.shift || "Unassigned"),
        item_code: sku === "UNKNOWN" ? null : sku,
        item_desc: String(r.itemDesc || "").trim() || null,
        units_produced: units,
        line: line,
        work_order_code: String(r.workOrder || "").trim() || null
      };
    });
    var latestDate = rowsLite.map(function(r) { return r.produced_date_et; }).filter(Boolean).sort().pop() || null;
    var latestByLineMap = {};
    rowsLite.forEach(function(r) {
      if (!latestDate || r.produced_date_et !== latestDate) return;
      var line = String(r.line || "Unknown");
      if (!latestByLineMap[line]) latestByLineMap[line] = { line: line, units: 0, rows: 0 };
      latestByLineMap[line].units += safeNum(r.units_produced);
      latestByLineMap[line].rows += 1;
    });
    var fromSegments = {
      trends: {
        byDay: Object.values(byDayMap).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
        byShift: shiftRows.map(function(r) {
          return {
            date: String(r.date || ""),
            shift: String(r.shift || "Unassigned"),
            units: safeNum(r.unitsProduced),
            rows: safeNum(r.jobs)
          };
        }).sort(function(a, b) {
          if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
          return String(a.shift || "").localeCompare(String(b.shift || ""));
        })
      },
      breakdown: {
        rowsLite: rowsLite,
        bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }),
        byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
        latestDate: latestDate,
        latestByLine: Object.values(latestByLineMap).sort(function(a, b) { return b.units - a.units; }),
        totalRows: rowsLite.length
      }
    };
    var fromRaw = buildRawNulogySeries(productionDataRaw || []);
    var hasRawData = fromRaw.trends.byDay.length > 0 || fromRaw.breakdown.rowsLite.length > 0;
    if (hasRawData) return fromRaw;
    return fromSegments;
  }, [productionSegments, productionDataRaw]);

  var evoconSeries = useMemo(function() {
    return buildEvoconSeries(evoconData || []);
  }, [evoconData]);

  var effectiveNulogySource = useMemo(function() {
    var cacheByDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay : [];
    var cacheByShift = (trends && Array.isArray(trends.byShift)) ? trends.byShift : [];
    var cacheBreakdown = (breakdown && Array.isArray(breakdown.rowsLite) && breakdown.rowsLite.length)
      ? breakdown
      : { rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0 };
    var hasServerTrends = cacheByDay.length > 0 || cacheByShift.length > 0;
    var hasServerBreakdown = cacheBreakdown.rowsLite.length > 0;
    if (hasServerTrends || hasServerBreakdown) {
      return {
        source: "server",
        trends: { byDay: cacheByDay, byShift: cacheByShift },
        breakdown: cacheBreakdown
      };
    }
    return {
      source: "empty",
      trends: { byDay: [], byShift: [] },
      breakdown: { rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0 }
    };
  }, [trends, breakdown]);

  var effectiveTrends = effectiveNulogySource.trends;
  var effectiveBreakdown = effectiveNulogySource.breakdown;

  var revenueTargetsBySku = useMemo(function() {
    var map = {};
    (Array.isArray(opsSkuTargets) ? opsSkuTargets : []).forEach(function(row) {
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
      map[sku].sort(function(a, b) {
        if (!!a.customer !== !!b.customer) return a.customer ? 1 : -1;
        return String(b.active_from || "").localeCompare(String(a.active_from || ""));
      });
    });
    return map;
  }, [opsSkuTargets]);

  var revenuePerCaseForRow = function(itemCode, dateIso) {
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
    var itemMasterValue = safeNum(itemMasterCostBySku[sku]);
    if (itemMasterValue > 0) return { value: itemMasterValue, source: "item_master_cost_per_unit" };
    return { value: 0, source: "missing" };
  };

  var serverProductionSegments = useMemo(function() {
    var rows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    var byShiftDay = {};
    var byJob = {};
    var totalRows = rows.length;
    var rowsWithShift = 0;

    rows.forEach(function(r) {
      var date = String(r && r.produced_date_et || "");
      var shift = String(r && r.shift_label || "Unassigned");
      var units = safeNum(r && r.units_produced);
      if (!(units > 0) || !date) return;
      rowsWithShift += 1;

      var shiftKey = date + "|" + shift;
      if (!byShiftDay[shiftKey]) byShiftDay[shiftKey] = { date: date, shift: shift, unitsProduced: 0, jobs: 0 };
      byShiftDay[shiftKey].unitsProduced += units;
      byShiftDay[shiftKey].jobs += 1;

      var jobId = String(r && r.job_id || "").trim() || "Unknown Job";
      var workOrder = String(r && r.work_order_code || "").trim();
      var itemCode = String(r && r.item_code || "").trim();
      var itemDesc = String(r && r.item_desc || "").trim();
      var line = String(r && r.line || "Unknown").trim() || "Unknown";
      var jobKey = [date, shift, jobId, workOrder, itemCode].join("|");
      if (!byJob[jobKey]) {
        byJob[jobKey] = {
          date: date,
          shift: shift,
          jobId: jobId,
          workOrder: workOrder || "--",
          line: line,
          itemCode: itemCode || "--",
          itemDesc: itemDesc || "--",
          unitsProduced: 0
        };
      }
      byJob[jobKey].unitsProduced += units;
      if ((!byJob[jobKey].itemDesc || byJob[jobKey].itemDesc === "--") && itemDesc) byJob[jobKey].itemDesc = itemDesc;
      if ((!byJob[jobKey].line || byJob[jobKey].line === "Unknown") && line) byJob[jobKey].line = line;
    });

    return {
      shiftRows: Object.values(byShiftDay).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return String(a.shift || "").localeCompare(String(b.shift || ""));
      }),
      jobRows: Object.values(byJob).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return safeNum(b.unitsProduced) - safeNum(a.unitsProduced);
      }),
      totalRows: totalRows,
      rowsWithShift: rowsWithShift
    };
  }, [effectiveBreakdown]);

  var effectiveRange = useMemo(function() {
    if (windowPreset !== "today") return range;
    var days = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    var hasSelectedDayData = days.some(function(d) { return inRangeIso(String(d.date || ""), range); });
    if (hasSelectedDayData) return range;
    var latestDate = days.map(function(d) { return String(d.date || ""); }).filter(Boolean).sort().pop() || "";
    if (!latestDate) return range;
    return {
      start: latestDate,
      end: latestDate,
      fetchDays: range.fetchDays,
      _fallbackApplied: true,
      _fallbackDate: latestDate
    };
  }, [windowPreset, range, effectiveTrends]);

  var filteredTrends = useMemo(function() {
    var byDay = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay.filter(function(r) { return inRange(String(r.date || ""), effectiveRange); }) : [];
    var byShift = (effectiveTrends && Array.isArray(effectiveTrends.byShift)) ? effectiveTrends.byShift.filter(function(r) { return inRange(String(r.date || ""), effectiveRange); }) : [];
    return { byDay: byDay, byShift: byShift, fromDate: effectiveRange.start };
  }, [effectiveTrends, effectiveRange]);

  var filteredBreakdown = useMemo(function() {
    var rows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite.filter(function(r) { return inRange(String(r.produced_date_et || ""), effectiveRange); }) : [];
    var bySku = {};
    var byLine = {};
    var byDateLine = {};
    rows.forEach(function(r) {
      var sku = String(r.item_code || "UNKNOWN");
      var line = String(r.line || "Unknown");
      var date = String(r.produced_date_et || "");
      var units = safeNum(r.units_produced);
      if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
      bySku[sku].units += units;
      bySku[sku].rows += 1;
      if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
      byLine[line].units += units;
      byLine[line].rows += 1;
      if (date) {
        if (!byDateLine[date]) byDateLine[date] = {};
        if (!byDateLine[date][line]) byDateLine[date][line] = { line: line, units: 0, rows: 0 };
        byDateLine[date][line].units += units;
        byDateLine[date][line].rows += 1;
      }
    });
    var latestDate = Object.keys(byDateLine).sort().pop() || null;
    var latestByLine = latestDate ? Object.values(byDateLine[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [];
    return {
      rowsLite: rows,
      bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }),
      byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
      latestDate: latestDate,
      latestByLine: latestByLine,
      totalRows: rows.length
    };
  }, [effectiveBreakdown, effectiveRange]);

  var forecastDailyTargetForDate = function(dateIso) {
    var day = String(dateIso || "").slice(0, 10);
    if (!day || !isBusinessDay(day)) return null;
    var monthKey = day.slice(0, 7);
    var monthPlan = forecastPlans && forecastPlans[monthKey] ? forecastPlans[monthKey] : null;
    var totalCases = safeNum(monthPlan && monthPlan.total_cases);
    if (!(totalCases > 0)) return null;
    var monthDays = businessDaysBetween(monthStart(day), monthEnd(day));
    if (!(monthDays > 0)) return null;
    return totalCases / monthDays;
  };

  var forecastPlanForRange = function(targetRange, fallbackDaily) {
    var days = eachDayIsoBetween(targetRange && targetRange.start, targetRange && targetRange.end);
    var total = 0;
    var usedForecast = false;
    days.forEach(function(day) {
      if (!isBusinessDay(day)) return;
      var forecastDaily = forecastDailyTargetForDate(day);
      if (forecastDaily != null) {
        total += forecastDaily;
        usedForecast = true;
      } else if (fallbackDaily != null) {
        total += safeNum(fallbackDaily);
      }
    });
    return {
      units: Math.round(total),
      source: usedForecast ? "forecast" : "historical"
    };
  };

  var metrics = useMemo(function() {
    var allByDay = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    var byDay = filteredTrends.byDay || [];
    var byShift = filteredTrends.byShift || [];
    var totalUnits = byDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
    var avgDailyUnits = byDay.length ? Math.round(totalUnits / byDay.length) : 0;
    var today = toIsoDateET(new Date());
    var productionDates = allByDay.map(function(d) { return String(d.date || ""); }).filter(Boolean).sort();
    var latestProductionDate = productionDates[productionDates.length - 1] || "";
    var latestCompletedProductionDate = latestProductionDate === today
      ? (productionDates[productionDates.length - 2] || "")
      : latestProductionDate;
    var projectionReferenceDate = latestProductionDate || effectiveRange.end || today;
    var monthAnchor = latestCompletedProductionDate;
    var monthBusinessDays = businessDaysBetween(monthStart(projectionReferenceDate), monthEnd(projectionReferenceDate));
    var trailingProductionDays = allByDay
      .filter(function(d) { return monthAnchor && String(d.date || "") <= monthAnchor; })
      .slice(0, 5);
    var trailingDailyVelocity = trailingProductionDays.length
      ? Math.round(trailingProductionDays.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / trailingProductionDays.length)
      : 0;
    var weeklyRunRate = trailingDailyVelocity * 5;
    var monthActualUnits = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      if (monthAnchor && date >= monthStart(projectionReferenceDate) && date <= monthAnchor) return sum + safeNum(d.units);
      return sum;
    }, 0);
    var projectionStartDate = monthAnchor ? shiftDays(monthAnchor, 1) : projectionReferenceDate;
    var remainingBusinessDays = businessDaysBetween(projectionStartDate, monthEnd(projectionReferenceDate));
    var monthlyRunRate = monthActualUnits + (trailingDailyVelocity * remainingBusinessDays);
    var selectedPlanInfo = forecastPlanForRange(effectiveRange, avgDailyUnits);
    var selectedPlanUnits = selectedPlanInfo.units;
    var forecastDeltaUnits = totalUnits - selectedPlanUnits;
    var forecastDeltaPct = selectedPlanUnits > 0 ? Math.round((forecastDeltaUnits / selectedPlanUnits) * 100) : 0;

    return {
      totalUnits: totalUnits,
      avgDailyUnits: avgDailyUnits,
      latestProductionDate: monthAnchor || projectionReferenceDate,
      trailingProductionDays: trailingProductionDays.length,
      trailingDailyVelocity: trailingDailyVelocity,
      weeklyRunRate: weeklyRunRate,
      monthlyRunRate: monthlyRunRate,
      monthBusinessDays: monthBusinessDays,
      monthActualUnits: monthActualUnits,
      remainingBusinessDays: remainingBusinessDays,
      selectedPlanUnits: selectedPlanUnits,
      selectedPlanSource: selectedPlanInfo.source,
      forecastDeltaUnits: forecastDeltaUnits,
      forecastDeltaPct: forecastDeltaPct,
      byShift: byShift,
    };
  }, [effectiveTrends, filteredTrends, filteredBreakdown, effectiveRange]);

  var commandBoard = useMemo(function() {
    var allDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    var allRows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    var findPreviousProductionDay = function(beforeIso) {
      var match = null;
      allDays.forEach(function(day) {
        var dayIso = String(day && day.date || "");
        if (!dayIso || !beforeIso || dayIso >= beforeIso || !(safeNum(day && day.units) > 0)) return;
        if (!match || dayIso > String(match.date || "")) {
          match = day;
        }
      });
      return match;
    };
    var summarizeRange = function(def) {
      var label = def.label;
      var summaryRange = def.range;
      var rowsInRange = allRows.filter(function(r) { return inRange(String(r.produced_date_et || ""), summaryRange); });
      var byDayMap = {};
      rowsInRange.forEach(function(r) {
        var date = String(r && r.produced_date_et || "");
        var units = safeNum(r && r.units_produced);
        if (!date) return;
        if (!byDayMap[date]) byDayMap[date] = { date: date, units: 0, rows: 0 };
        byDayMap[date].units += units;
        byDayMap[date].rows += 1;
      });
      var byDay = Object.values(byDayMap);
      if (!byDay.length) byDay = allDays.filter(function(d) { return inRangeIso(String(d.date || ""), summaryRange); });
      var dayCount = byDay.length;
      var latest = byDay.slice().sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); })[0] || null;
      var latestRows = latest ? safeNum(latest.rows) : 0;
      var windowActual = byDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
      var avgDailyUnits = dayCount > 0 ? Math.round(windowActual / dayCount) : 0;

      var inWindow = {};
      byDay.forEach(function(d) { inWindow[String(d.date || "")] = true; });
      var priorDays = allDays.filter(function(d) { return !inWindow[String(d.date || "")]; });
      var priorSlice = dayCount > 0 ? priorDays.slice(0, dayCount) : [];
      var priorAvg = priorSlice.length
        ? Math.round(priorSlice.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorSlice.length)
        : avgDailyUnits;
      var planInfo = forecastPlanForRange(summaryRange, priorAvg);
      var planUnits = planInfo.units;
      var variance = windowActual - planUnits;

      var status = "On Track";
      if (planUnits > 0) {
        var ratio = windowActual / planUnits;
        if (ratio < 0.85) status = "Off Track";
        else if (ratio < 0.95) status = "At Risk";
      }

      var byLineMap = {};
      var revenueActual = 0;
      var pricedUnits = 0;
      var missingRevenueUnits = 0;
      var missingRevenueBySku = {};
      rowsInRange.forEach(function(r) {
        var line = String(r.line || "Unknown");
        var unitsProduced = safeNum(r.units_produced);
        if (!byLineMap[line]) byLineMap[line] = { line: line, units: 0, rows: 0 };
        byLineMap[line].units += unitsProduced;
        byLineMap[line].rows += 1;
        var revenueMatch = revenuePerCaseForRow(r.item_code, r.produced_date_et);
        var revenuePerCase = safeNum(revenueMatch && revenueMatch.value);
        if (revenuePerCase > 0 && unitsProduced > 0) {
          revenueActual += unitsProduced * revenuePerCase;
          pricedUnits += unitsProduced;
        } else if (unitsProduced > 0) {
          var itemCode = String(r.item_code || "").trim();
          var missingSkuKey = normalizeItemCode(itemCode) || "unknown";
          missingRevenueUnits += unitsProduced;
          if (!missingRevenueBySku[missingSkuKey]) {
            missingRevenueBySku[missingSkuKey] = {
              itemCode: itemCode || "Unknown SKU",
              units: 0
            };
          }
          missingRevenueBySku[missingSkuKey].units += unitsProduced;
        }
      });
      var topLine = Object.values(byLineMap).sort(function(a, b) { return b.units - a.units; })[0] || null;
      var compareInfo = comparableRangeForPreset(def.key, summaryRange);
      var compareReferenceLabel = def.key === "today" ? "Last Production Day" : "";
      var compareReferenceUnits = 0;
      var compareReferenceDate = "";
      if (def.key === "today") {
        var previousProductionDay = findPreviousProductionDay(summaryRange && summaryRange.start);
        if (previousProductionDay && previousProductionDay.date) {
          compareInfo = {
            label: "vs last production day",
            range: {
              start: String(previousProductionDay.date || ""),
              end: String(previousProductionDay.date || "")
            }
          };
          compareReferenceUnits = safeNum(previousProductionDay.units);
          compareReferenceDate = String(previousProductionDay.date || "");
        } else {
          compareReferenceLabel = "Yesterday";
        }
      }
      var compareRange = compareInfo.range;
      var compareRows = compareRange ? allRows.filter(function(r) { return inRange(String(r.produced_date_et || ""), compareRange); }) : [];
      var compareActual = compareRows.reduce(function(sum, r) { return sum + safeNum(r.units_produced); }, 0);
      if (!(compareActual > 0) && compareRange) {
        var compareByDay = allDays.filter(function(d) { return inRangeIso(String(d.date || ""), compareRange); });
        compareActual = compareByDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
      }
      var compareDelta = windowActual - compareActual;
      var compareDeltaPct = compareActual > 0 ? Math.round((compareDelta / compareActual) * 100) : 0;
      var revenueCoveragePct = windowActual > 0 ? Math.round((pricedUnits / windowActual) * 100) : 0;
      var displayDelta = compareDelta;
      var displayDeltaPct = compareDeltaPct;
      var displayLabel = compareInfo.label;
      var paceProjectedUnits = null;
      if (def.key === "today") {
        var elapsedMinutes = productionDayElapsedMinutesET(new Date());
        if (windowActual > 0 && elapsedMinutes > 0 && elapsedMinutes < 960) {
          paceProjectedUnits = Math.round((windowActual / elapsedMinutes) * 960);
          displayDelta = paceProjectedUnits - compareActual;
          displayDeltaPct = compareActual > 0 ? Math.round((displayDelta / compareActual) * 100) : (paceProjectedUnits > 0 ? 100 : 0);
          displayLabel = compareReferenceDate ? "pace vs last production day" : "pace vs yesterday";
        }
      }
      return {
        label: label,
        range: summaryRange,
        latestDate: latest ? latest.date : null,
        latestUnits: windowActual,
        revenueActual: Math.round(revenueActual),
        revenuePricedUnits: pricedUnits,
        revenueCoveragePct: revenueCoveragePct,
        missingRevenueUnits: missingRevenueUnits,
        missingRevenueSkuCount: Object.keys(missingRevenueBySku).length,
        missingRevenueSkus: Object.values(missingRevenueBySku).sort(function(a, b) { return b.units - a.units; }).slice(0, 5),
        latestRows: latestRows,
        dayCount: dayCount,
        planUnits: planUnits,
        planSource: planInfo.source,
        variance: variance,
        variancePct: pctDelta(windowActual, planUnits),
        status: status,
        topLine: topLine,
        compareLabel: compareInfo.label,
        compareRange: compareRange,
        compareActual: compareActual,
        compareReferenceLabel: compareReferenceLabel,
        compareReferenceUnits: compareReferenceUnits || compareActual,
        compareReferenceDate: compareReferenceDate,
        compareDelta: compareDelta,
        compareDeltaPct: compareDeltaPct,
        displayDelta: displayDelta,
        displayDeltaPct: displayDeltaPct,
        displayLabel: displayLabel,
        paceProjectedUnits: paceProjectedUnits
      };
    };

    var presetCards = COMMAND_BOARD_PRESETS.map(function(def) {
      var summary = summarizeRange({
        key: def.key,
        label: def.label,
        range: presetRange(def.key)
      });
      return Object.assign({ key: def.key }, summary);
    });
    return {
      presets: presetCards
    };
  }, [effectiveTrends, effectiveBreakdown, forecastPlans, revenueTargetsBySku, itemMasterCostBySku]);

  var shiftPlanVsActual = useMemo(function() {
    var dayRows = aggregateBreakdownShiftMix(filteredBreakdown.rowsLite || []);
    if (!dayRows.length) {
      var fallbackRows = (filteredTrends.byShift || []).slice();
      var fallbackByDate = {};
      fallbackRows.forEach(function(r) {
        var date = String(r.date || "");
        if (!date) return;
        var shift = String(r.shift || "Unassigned");
        if (!fallbackByDate[date]) fallbackByDate[date] = { date: date, s1: 0, s2: 0, un: 0, total: 0 };
        var units = safeNum(r.units);
        if (shift.indexOf("Shift 1") !== -1) fallbackByDate[date].s1 += units;
        else if (shift.indexOf("Shift 2") !== -1) fallbackByDate[date].s2 += units;
        else fallbackByDate[date].un += units;
        fallbackByDate[date].total += units;
      });
      dayRows = Object.values(fallbackByDate).sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    }
    var priorDays = aggregateBreakdownByDay((effectiveBreakdown && effectiveBreakdown.rowsLite) || []).filter(function(d) {
      var date = String(d.date || "");
      return date && date < range.start;
    });
    if (!priorDays.length) {
      priorDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay.filter(function(d) {
        var date = String(d.date || "");
        return date && date < range.start;
      }) : [];
    }
    var baselineDaily = priorDays.length
      ? Math.round(priorDays.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorDays.length)
      : (metrics.avgDailyUnits || 0);
    var max = dayRows.reduce(function(m, r) {
      var dayPlan = forecastDailyTargetForDate(r.date);
      return Math.max(m, r.total, dayPlan == null ? baselineDaily : dayPlan);
    }, 0) || 1;
    return {
      rows: dayRows.map(function(r) {
        var total = Math.max(1, r.total);
        var totalPct = Math.round((r.total / max) * 100);
        var s1PctOfTotal = Math.round((r.s1 / total) * 100);
        var s2PctOfTotal = Math.round((r.s2 / total) * 100);
        var unPctOfTotal = Math.max(0, 100 - s1PctOfTotal - s2PctOfTotal);
        var dayPlan = forecastDailyTargetForDate(r.date);
        var effectivePlan = dayPlan == null ? baselineDaily : dayPlan;
        return {
          date: r.date,
          s1: r.s1,
          s2: r.s2,
          un: r.un,
          total: r.total,
          totalPct: totalPct,
          s1Pct: Math.round((totalPct * s1PctOfTotal) / 100),
          s2Pct: Math.round((totalPct * s2PctOfTotal) / 100),
          unPct: Math.round((totalPct * unPctOfTotal) / 100),
          plan: effectivePlan,
          planPct: Math.round((effectivePlan / max) * 100),
          tooltip: [
            r.date || "--",
            "Shift 1: " + Math.round(r.s1).toLocaleString(),
            "Shift 2: " + Math.round(r.s2).toLocaleString(),
            "Unassigned: " + Math.round(r.un).toLocaleString(),
            "Total: " + Math.round(r.total).toLocaleString(),
            (dayPlan == null ? "Baseline" : "Forecast Plan") + ": " + Math.round(effectivePlan).toLocaleString(),
            "Variance: " + ((r.total - effectivePlan) >= 0 ? "+" : "") + Math.round(r.total - effectivePlan).toLocaleString()
          ].join("\n")
        };
      }),
      max: max
    };
  }, [filteredBreakdown.rowsLite, filteredTrends.byShift, effectiveBreakdown, effectiveTrends, range.start, metrics.avgDailyUnits, forecastPlans]);

  var dailyPlanVsActual = useMemo(function() {
    var dayRows = aggregateBreakdownByDay(filteredBreakdown.rowsLite || []);
    if (!dayRows.length) {
      dayRows = (filteredTrends.byDay || []).slice().sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    }
    if (!dayRows.length) return { rows: [], lineSeries: [] };

    var priorDays = aggregateBreakdownByDay((effectiveBreakdown && effectiveBreakdown.rowsLite) || []).filter(function(d) {
      var date = String(d.date || "");
      return date && date < range.start;
    });
    if (!priorDays.length) {
      priorDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay.filter(function(d) {
        var date = String(d.date || "");
        return date && date < range.start;
      }) : [];
    }
    var baselineDaily = priorDays.length
      ? Math.round(priorDays.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorDays.length)
      : (metrics.avgDailyUnits || 0);

    var lineTotals = {};
    var byDateLine = {};
    (filteredBreakdown.rowsLite || []).forEach(function(r) {
      var date = String(r.produced_date_et || "");
      if (!date) return;
      var lineName = String(r.line || "Unknown");
      var key = toLineKey(lineName);
      var units = safeNum(r.units_produced);
      lineTotals[key] = (lineTotals[key] || 0) + units;
      if (!byDateLine[date]) byDateLine[date] = {};
      byDateLine[date][key] = (byDateLine[date][key] || 0) + units;
    });

    var lineSeries = Object.keys(lineTotals)
      .sort(function(a, b) { return safeNum(lineTotals[b]) - safeNum(lineTotals[a]); })
      .slice(0, 6)
      .map(function(key, idx) {
        return { key: key, label: key.replace(/^line_/, "").replace(/_/g, " ").toUpperCase(), color: lineColor(idx) };
      });

    var rowData = dayRows.map(function(r) {
      var date = String(r.date || "");
      var dayPlan = forecastDailyTargetForDate(date);
      var row = {
        date: date,
        total: safeNum(r.units),
        plan: dayPlan == null ? baselineDaily : dayPlan,
      };
      lineSeries.forEach(function(line) {
        row[line.key] = safeNum(byDateLine[date] && byDateLine[date][line.key]);
      });
      return row;
    });

    return { rows: rowData, lineSeries: lineSeries };
  }, [filteredBreakdown.rowsLite, filteredTrends.byDay, effectiveBreakdown, effectiveTrends, range.start, metrics.avgDailyUnits, forecastPlans]);

  var lineScoreboard = useMemo(function() {
    var compareInfo = comparableRangeForPreset(windowPreset, effectiveRange);
    var compareRange = compareInfo.range;
    var rowsLite = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    var currentByLine = {};
    var priorByLine = {};
    var currentTotal = 0;
    var priorTotal = 0;

    rowsLite.forEach(function(r) {
      var date = String(r.produced_date_et || "");
      if (!date) return;
      var line = String(r.line || "Unknown");
      var units = safeNum(r.units_produced);
      if (inRange(date, effectiveRange)) {
        currentByLine[line] = (currentByLine[line] || 0) + units;
        currentTotal += units;
      }
      if (compareRange && inRange(date, compareRange)) {
        priorByLine[line] = (priorByLine[line] || 0) + units;
        priorTotal += units;
      }
    });

    var lineKeys = {};
    Object.keys(currentByLine).forEach(function(line) { lineKeys[line] = true; });
    Object.keys(priorByLine).forEach(function(line) { lineKeys[line] = true; });

    var rows = Object.keys(lineKeys).map(function(line) {
      var units = safeNum(currentByLine[line]);
      var priorUnits = safeNum(priorByLine[line]);
      var deltaUnits = units - priorUnits;
      var deltaPct = priorUnits > 0 ? Math.round((deltaUnits / priorUnits) * 100) : (units > 0 ? 100 : 0);
      var sharePct = currentTotal > 0 ? Math.round((units / currentTotal) * 100) : 0;
      var trend = deltaUnits > 0 ? "up" : deltaUnits < 0 ? "down" : "flat";
      var status = "Stable";

      if (units === 0 && priorUnits > 0) status = "Idle";
      else if (sharePct >= 35) status = "Leading";
      else if (deltaUnits >= 1000 || deltaPct >= 12) status = "Improving";
      else if (deltaUnits <= -1000 || deltaPct <= -12) status = "Softening";

      return {
        line: line,
        units: units,
        priorUnits: priorUnits,
        sharePct: sharePct,
        deltaUnits: deltaUnits,
        deltaPct: deltaPct,
        trend: trend,
        status: status
      };
    }).sort(function(a, b) {
      if (b.units !== a.units) return b.units - a.units;
      return b.priorUnits - a.priorUnits;
    });

    var leader = rows[0] || null;
    var moversUp = rows.filter(function(r) { return r.deltaUnits > 0; }).sort(function(a, b) { return b.deltaUnits - a.deltaUnits; });
    var moversDown = rows.filter(function(r) { return r.deltaUnits < 0; }).sort(function(a, b) { return a.deltaUnits - b.deltaUnits; });

    return {
      rows: rows.slice(0, 8),
      totalUnits: currentTotal,
      priorTotal: priorTotal,
      compareLabel: compareInfo.label,
      leader: leader,
      biggestUp: moversUp[0] || null,
      biggestDown: moversDown[0] || null
    };
  }, [effectiveBreakdown, effectiveRange, windowPreset]);

  var productionJobLeaderboard = useMemo(function() {
    var leaderboardMinCases = 250;
    var leaderboardMinHours = 1;
    var sourceRows = (laborActuals && Array.isArray(laborActuals.byJob)) ? laborActuals.byJob : [];
    var grouped = {};

    sourceRows.forEach(function(row) {
      var date = String(row && row.date_et || "");
      if (!inRangeIso(date, effectiveRange)) return;
      var jobId = String(row && row.job_id || "").trim();
      var workOrder = String(row && row.work_order_code || "").trim();
      var line = String(row && row.line_name || "Unknown").trim() || "Unknown";
      var itemCode = String(row && row.item_code || "").trim();
      var itemDescription = formatDescriptionForDisplay(row && row.item_description) || "";
      var key = [jobId || "--", workOrder || "--", line, itemCode || "--"].join("|");
      if (!grouped[key]) {
        grouped[key] = {
          key: key,
          jobId: jobId || "--",
          workOrder: workOrder || "--",
          line: line,
          itemCode: itemCode || "--",
          itemDescription: itemDescription || "--",
          casesProduced: 0,
          payableHours: 0,
          productiveHours: 0,
          laborCost: 0,
          finalizedRows: 0,
          provisionalRows: 0,
          activeDates: {}
        };
      }
      grouped[key].casesProduced += safeNum(row && row.cases_produced);
      grouped[key].payableHours += safeNum(row && row.payable_hours);
      grouped[key].productiveHours += safeNum(row && row.productive_hours);
      grouped[key].laborCost += safeNum(row && row.labor_cost);
      grouped[key].finalizedRows += safeNum(row && row.finalized_rows);
      grouped[key].provisionalRows += safeNum(row && row.provisional_rows);
      if (date) grouped[key].activeDates[date] = true;
      if (grouped[key].itemDescription === "--" && itemDescription) grouped[key].itemDescription = itemDescription;
    });

    var ranked = Object.values(grouped)
      .map(function(row) {
        var casesProduced = safeNum(row.casesProduced);
        var payableHours = safeNum(row.payableHours);
        var productiveHours = safeNum(row.productiveHours);
        var laborCost = safeNum(row.laborCost);
        return Object.assign({}, row, {
          activeDayCount: Object.keys(row.activeDates).length,
          laborStatus: deriveLaborStatusFromRows(row.finalizedRows, row.provisionalRows),
          casesPerPayableHour: payableHours > 0 ? (casesProduced / payableHours) : 0,
          casesPerProductiveHour: productiveHours > 0 ? (casesProduced / productiveHours) : 0,
          laborCostPerCase: casesProduced > 0 ? (laborCost / casesProduced) : 0
        });
      })
      .filter(function(row) {
        return row.casesProduced >= leaderboardMinCases && row.payableHours >= leaderboardMinHours;
      });

    var byBest = ranked.slice().sort(function(a, b) {
      if (safeNum(b.casesPerPayableHour) !== safeNum(a.casesPerPayableHour)) {
        return safeNum(b.casesPerPayableHour) - safeNum(a.casesPerPayableHour);
      }
      if (safeNum(b.casesProduced) !== safeNum(a.casesProduced)) return safeNum(b.casesProduced) - safeNum(a.casesProduced);
      return safeNum(a.laborCostPerCase) - safeNum(b.laborCostPerCase);
    });
    var byWorst = ranked.slice().sort(function(a, b) {
      if (safeNum(a.casesPerPayableHour) !== safeNum(b.casesPerPayableHour)) {
        return safeNum(a.casesPerPayableHour) - safeNum(b.casesPerPayableHour);
      }
      if (safeNum(b.payableHours) !== safeNum(a.payableHours)) return safeNum(b.payableHours) - safeNum(a.payableHours);
      return safeNum(a.casesProduced) - safeNum(b.casesProduced);
    });

    return {
      minCases: leaderboardMinCases,
      minHours: leaderboardMinHours,
      qualifiedCount: ranked.length,
      best: byBest.slice(0, 5),
      worst: byWorst.slice(0, 5)
    };
  }, [laborActuals, effectiveRange]);

  var skuMixByDay = useMemo(function() {
    var rowsLite = (filteredBreakdown && Array.isArray(filteredBreakdown.rowsLite)) ? filteredBreakdown.rowsLite : [];
    if (!rowsLite.length) return { rows: [], series: [] };

    var totalsBySeries = {};
    var byDateSeries = {};
    rowsLite.forEach(function(r) {
      var date = String(r.produced_date_et || "");
      if (!date) return;
      var item = String(r.item_code || "").trim();
      var desc = String(r.item_desc || r.description || "");
      var label = skuMixMode === "item"
        ? (item || "Unknown")
        : detectPackType(desc || item, item || "");
      var key = toSeriesKey(skuMixMode === "item" ? "item" : "type", label);
      var units = safeNum(r.units_produced);

      totalsBySeries[key] = (totalsBySeries[key] || 0) + units;
      if (!byDateSeries[date]) byDateSeries[date] = {};
      byDateSeries[date][key] = (byDateSeries[date][key] || 0) + units;
    });

    var maxSeries = skuMixMode === "item" ? 8 : 7;
    var topKeys = Object.keys(totalsBySeries)
      .sort(function(a, b) { return safeNum(totalsBySeries[b]) - safeNum(totalsBySeries[a]); })
      .slice(0, maxSeries);
    var topKeySet = {};
    topKeys.forEach(function(k) { topKeySet[k] = true; });

    var keyToLabel = {};
    rowsLite.forEach(function(r) {
      var item = String(r.item_code || "").trim();
      var desc = String(r.item_desc || r.description || "");
      var label = skuMixMode === "item"
        ? (item || "Unknown")
        : detectPackType(desc || item, item || "");
      var key = toSeriesKey(skuMixMode === "item" ? "item" : "type", label);
      if (!keyToLabel[key]) keyToLabel[key] = label;
    });

    var series = topKeys.map(function(key, idx) {
      return { key: key, label: keyToLabel[key] || key, color: lineColor(idx) };
    });

    var dates = Object.keys(byDateSeries).sort();
    var chartRows = dates.map(function(date) {
      var row = { date: date };
      series.forEach(function(s) {
        row[s.key] = safeNum(byDateSeries[date] && byDateSeries[date][s.key]);
      });
      row.total = series.reduce(function(sum, s) { return sum + safeNum(row[s.key]); }, 0);
      return row;
    });

    return { rows: chartRows, series: series };
  }, [filteredBreakdown, skuMixMode]);

  const skuMixChartConfig = useMemo(function() {
    var cfg = {};
    (skuMixByDay.series || []).forEach(function(s) {
      cfg[s.key] = { label: s.label, color: s.color };
    });
    return cfg;
  }, [skuMixByDay.series]);

  var evoconInsights = useMemo(function() {
    var compareInfo = comparableRangeForPreset(windowPreset, range);
    var compareRange = compareInfo.range;
    var currentRows = (Array.isArray(evoconData) ? evoconData : []).filter(function(r) {
      return inRangeIso(String(r.date || ""), range);
    });
    var priorRows = compareRange ? (Array.isArray(evoconData) ? evoconData : []).filter(function(r) {
      return inRangeIso(String(r.date || ""), compareRange);
    }) : [];

    var lossDriver = function(unplannedMin, slowMin, technicalMin) {
      var choices = [
        { key: "slowMin", label: "Speed loss", value: safeNum(slowMin) },
        { key: "unplannedMin", label: "Unplanned stops", value: safeNum(unplannedMin) },
        { key: "technicalMin", label: "Technical stops", value: safeNum(technicalMin) }
      ].sort(function(a, b) { return b.value - a.value; });
      return choices[0] || { key: "slowMin", label: "Speed loss", value: 0 };
    };

    var summarizeRows = function(sourceRows) {
      var rows = Array.isArray(sourceRows) ? sourceRows : [];
      var byLineMap = {};
      var byShiftMap = {};
      var byDateMap = {};
      var summary = {
        unplannedMin: 0,
        plannedMin: 0,
        technicalMin: 0,
        slowMin: 0,
        downtimeMin: 0,
        operatingMin: 0,
        stopEvents: 0,
        uncommentedMin: 0
      };

      rows.forEach(function(r) {
        var line = String(r.station || r.line || "Unknown").trim() || "Unknown";
        var shift = normalizeEvoconShift(r.shift);
        var date = String(r.date || "");
        var unplannedMin = secToMin(r.unplannedstops);
        var plannedMin = secToMin(r.plannedstops);
        var technicalMin = secToMin(r.technicalStopTimeSec);
        var slowMin = secToMin(r.slowProduction);
        var downtimeMin = secToMin(r.downtime);
        var operatingMin = secToMin(r.operatingTimeSec);
        var uncommentedMin = secToMin(r.uncommented);
        var stopEvents = safeNum(r.perfLossCount);

        summary.unplannedMin += unplannedMin;
        summary.plannedMin += plannedMin;
        summary.technicalMin += technicalMin;
        summary.slowMin += slowMin;
        summary.downtimeMin += downtimeMin;
        summary.operatingMin += operatingMin;
        summary.stopEvents += stopEvents;
        summary.uncommentedMin += uncommentedMin;

        if (!byLineMap[line]) {
          byLineMap[line] = {
            line: line,
            unplannedMin: 0,
            plannedMin: 0,
            technicalMin: 0,
            slowMin: 0,
            downtimeMin: 0,
            operatingMin: 0,
            uncommentedMin: 0,
            stopEvents: 0,
            rows: 0
          };
        }
        var lineRef = byLineMap[line];
        lineRef.unplannedMin += unplannedMin;
        lineRef.plannedMin += plannedMin;
        lineRef.technicalMin += technicalMin;
        lineRef.slowMin += slowMin;
        lineRef.downtimeMin += downtimeMin;
        lineRef.operatingMin += operatingMin;
        lineRef.uncommentedMin += uncommentedMin;
        lineRef.stopEvents += stopEvents;
        lineRef.rows += 1;

        if (!byShiftMap[shift]) {
          byShiftMap[shift] = {
            shift: shift,
            unplannedMin: 0,
            plannedMin: 0,
            technicalMin: 0,
            slowMin: 0,
            downtimeMin: 0,
            operatingMin: 0,
            stopEvents: 0,
            rows: 0
          };
        }
        var shiftRef = byShiftMap[shift];
        shiftRef.unplannedMin += unplannedMin;
        shiftRef.plannedMin += plannedMin;
        shiftRef.technicalMin += technicalMin;
        shiftRef.slowMin += slowMin;
        shiftRef.downtimeMin += downtimeMin;
        shiftRef.operatingMin += operatingMin;
        shiftRef.stopEvents += stopEvents;
        shiftRef.rows += 1;

        if (!byDateMap[date]) byDateMap[date] = true;
      });

      var summaryLossMin = summary.unplannedMin + summary.slowMin + summary.technicalMin;
      var summaryAvailabilityPct = pct(summary.operatingMin, summary.operatingMin + summary.downtimeMin);
      var summaryCommentCoveragePct = pct(Math.max(0, summary.downtimeMin - summary.uncommentedMin), summary.downtimeMin);
      var summaryDriver = lossDriver(summary.unplannedMin, summary.slowMin, summary.technicalMin);

      var byLine = Object.values(byLineMap).map(function(r) {
        var lossMin = r.unplannedMin + r.slowMin + r.technicalMin;
        var availabilityPct = pct(r.operatingMin, r.operatingMin + r.downtimeMin);
        var commentCoveragePct = pct(Math.max(0, r.downtimeMin - r.uncommentedMin), r.downtimeMin);
        var driver = lossDriver(r.unplannedMin, r.slowMin, r.technicalMin);
        var focus = "Monitor";
        if (commentCoveragePct < 60 && r.downtimeMin >= 60) focus = "Raise stop coding";
        else if (driver.key === "slowMin" && driver.value > 0) focus = "Recover speed";
        else if (driver.key === "unplannedMin" && driver.value > 0) focus = "Reduce stops";
        else if (driver.key === "technicalMin" && driver.value > 0) focus = "Fix technical losses";
        return Object.assign({}, r, {
          lossMin: lossMin,
          availabilityPct: availabilityPct,
          commentCoveragePct: commentCoveragePct,
          lossSharePct: pct(lossMin, Math.max(1, summaryLossMin)),
          driverLabel: driver.label,
          driverMin: driver.value,
          driverSharePct: pct(driver.value, Math.max(1, lossMin)),
          focus: focus
        });
      }).sort(function(a, b) { return b.lossMin - a.lossMin; });

      var byShift = Object.values(byShiftMap).map(function(r) {
        var lossMin = r.unplannedMin + r.slowMin + r.technicalMin;
        var availabilityPct = pct(r.operatingMin, r.operatingMin + r.downtimeMin);
        var driver = lossDriver(r.unplannedMin, r.slowMin, r.technicalMin);
        return Object.assign({}, r, {
          lossMin: lossMin,
          availabilityPct: availabilityPct,
          driverLabel: driver.label
        });
      }).sort(function(a, b) { return b.lossMin - a.lossMin; });

      return {
        rows: rows,
        latestDate: Object.keys(byDateMap).sort().pop() || null,
        summary: Object.assign({}, summary, {
          lossMin: summaryLossMin,
          availabilityPct: summaryAvailabilityPct,
          commentCoveragePct: summaryCommentCoveragePct,
          driverLabel: summaryDriver.label,
          driverMin: summaryDriver.value,
          driverSharePct: pct(summaryDriver.value, Math.max(1, summaryLossMin))
        }),
        byLine: byLine,
        byShift: byShift
      };
    };

    if (!currentRows.length) {
      return {
        hasData: false,
        rows: [],
        summary: null,
        byLine: [],
        byShift: [],
        latestDate: null,
        priorityCards: [],
        shiftCards: [],
        actions: [],
        compareLabel: compareInfo.label
      };
    }

    var current = summarizeRows(currentRows);
    var prior = summarizeRows(priorRows);
    var priorLineMap = {};
    prior.byLine.forEach(function(r) { priorLineMap[r.line] = r; });

    var byLine = current.byLine.map(function(r) {
      var prev = priorLineMap[r.line] || null;
      var deltaLossMin = r.lossMin - safeNum(prev && prev.lossMin);
      var deltaLossPct = safeNum(prev && prev.lossMin) > 0 ? Math.round((deltaLossMin / safeNum(prev.lossMin)) * 100) : (r.lossMin > 0 ? 100 : 0);
      var status = "Stable";
      if (r.lossSharePct >= 35) status = "Hotspot";
      else if (r.commentCoveragePct < 60 && r.downtimeMin >= 60) status = "Blind spot";
      else if (deltaLossMin >= 120 || deltaLossPct >= 15) status = "Worsening";
      else if (deltaLossMin <= -120 || deltaLossPct <= -15) status = "Improving";
      return Object.assign({}, r, {
        deltaLossMin: deltaLossMin,
        deltaLossPct: deltaLossPct,
        status: status
      });
    }).sort(function(a, b) { return b.lossMin - a.lossMin; });

    var worstLossLine = byLine[0] || null;
    var worstCommentLine = byLine.slice().sort(function(a, b) { return a.commentCoveragePct - b.commentCoveragePct; })[0] || null;
    var worstAvailabilityLine = byLine.slice().sort(function(a, b) { return a.availabilityPct - b.availabilityPct; })[0] || null;
    var hottestShift = current.byShift[0] || null;
    var secondShift = current.byShift[1] || null;
    var shiftGapMin = hottestShift && secondShift ? Math.abs(hottestShift.lossMin - secondShift.lossMin) : 0;
    var summaryDeltaMin = current.summary.lossMin - safeNum(prior.summary && prior.summary.lossMin);
    var summaryDeltaPct = safeNum(prior.summary && prior.summary.lossMin) > 0 ? Math.round((summaryDeltaMin / safeNum(prior.summary.lossMin)) * 100) : (current.summary.lossMin > 0 ? 100 : 0);
    var coverageDelta = current.summary.commentCoveragePct - safeNum(prior.summary && prior.summary.commentCoveragePct);

    var priorityCards = [
      {
        label: "Controllable Loss",
        value: current.summary.lossMin.toLocaleString(),
        subcopy: current.summary.driverLabel + " drives " + current.summary.driverSharePct + "% of loss",
        delta: summaryDeltaMin,
        deltaPct: summaryDeltaPct,
        compareLabel: compareInfo.label,
        goodWhenDown: true
      },
      {
        label: "Priority Line",
        value: worstLossLine ? worstLossLine.line : "No line",
        subcopy: worstLossLine
          ? (worstLossLine.lossMin.toLocaleString() + " min · " + worstLossLine.lossSharePct + "% of loss")
          : "No line loss in this window",
        tone: "danger"
      },
      {
        label: "Comment Discipline",
        value: current.summary.commentCoveragePct + "%",
        subcopy: worstCommentLine
          ? ("Worst line: " + worstCommentLine.line + " at " + worstCommentLine.commentCoveragePct + "%")
          : "No comment coverage issue",
        delta: coverageDelta,
        compareLabel: compareInfo.label,
        goodWhenDown: false
      },
      {
        label: "Availability Watch",
        value: worstAvailabilityLine ? worstAvailabilityLine.availabilityPct + "%" : "--",
        subcopy: worstAvailabilityLine
          ? ("Lowest line: " + worstAvailabilityLine.line)
          : "No availability gap",
        tone: worstAvailabilityLine && worstAvailabilityLine.availabilityPct < 85 ? "danger" : "default"
      }
    ];

    var actions = [];
    if (worstLossLine && worstLossLine.lossMin > 0) {
      actions.push({
        severity: "high",
        title: worstLossLine.line + " is the primary bottleneck",
        detail: worstLossLine.lossMin.toLocaleString() + " controllable loss min. " + worstLossLine.driverLabel + " is " + worstLossLine.driverSharePct + "% of that line's loss."
      });
    }
    if (hottestShift && shiftGapMin >= 60) {
      actions.push({
        severity: "med",
        title: hottestShift.shift + " is carrying more loss",
        detail: "+" + shiftGapMin.toLocaleString() + " min versus the next shift. Primary driver: " + hottestShift.driverLabel + "."
      });
    }
    if (worstCommentLine && worstCommentLine.commentCoveragePct < 80 && worstCommentLine.downtimeMin > 0) {
      actions.push({
        severity: "med",
        title: "Stop coding is limiting root-cause clarity",
        detail: worstCommentLine.line + " has " + worstCommentLine.commentCoveragePct + "% comment coverage across " + worstCommentLine.downtimeMin.toLocaleString() + " downtime min."
      });
    }
    if (current.summary.driverSharePct >= 50) {
      actions.push({
        severity: "low",
        title: current.summary.driverLabel + " is the dominant loss mode",
        detail: current.summary.driverMin.toLocaleString() + " min, or " + current.summary.driverSharePct + "% of controllable loss in this window."
      });
    }

    var shiftCards = current.byShift.slice(0, 3).map(function(r, idx) {
      return Object.assign({}, r, { emphasis: idx === 0 });
    });

    return {
      hasData: true,
      rows: current.rows,
      latestDate: current.latestDate,
      summary: current.summary,
      byLine: byLine,
      byShift: current.byShift,
      priorityCards: priorityCards,
      shiftCards: shiftCards,
      actions: actions.slice(0, 3),
      compareLabel: compareInfo.label
    };
  }, [evoconData, range, windowPreset]);

  const dailyChartConfig = useMemo(function() {
    var cfg = { plan: { label: "Baseline daily plan", color: C.dim } };
    (dailyPlanVsActual.lineSeries || []).forEach(function(line) {
      cfg[line.key] = { label: line.label, color: line.color };
    });
    return cfg;
  }, [C.dim, dailyPlanVsActual.lineSeries]);

  const shiftChartConfig = useMemo(function() {
    return {
      s1: { label: "Shift 1", color: OPERATIONS_SHIFT_COLORS.s1 },
      s2: { label: "Shift 2", color: OPERATIONS_SHIFT_COLORS.s2 },
      un: { label: "Unassigned", color: OPERATIONS_SHIFT_COLORS.un },
      plan: { label: "Baseline daily plan", color: C.dim }
    };
  }, [C.dim]);

  const dailyEconomicsChartConfig = useMemo(function() {
    return {
      cases: { label: "Cases Produced", color: OPERATIONS_ECONOMICS_COLORS.cases },
      revenue: { label: "Revenue", color: OPERATIONS_ECONOMICS_COLORS.revenue },
      labor: { label: "Labor Cost", color: OPERATIONS_ECONOMICS_COLORS.labor }
    };
  }, []);

  const dailyEconomicsRows = useMemo(function() {
    var dayMap = {};
    var trendDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    trendDays.forEach(function(row) {
      var date = String(row && row.date || "");
      if (!date) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0 };
      dayMap[date].cases += safeNum(row && row.units);
    });
    var breakdownRows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    breakdownRows.forEach(function(row) {
      var date = String(row && row.produced_date_et || "");
      var itemCode = String(row && row.item_code || "");
      var units = safeNum(row && row.units_produced);
      if (!date || !(units > 0)) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0 };
      var revenueMatch = revenuePerCaseForRow(itemCode, date);
      var revenuePerCase = safeNum(revenueMatch && revenueMatch.value);
      if (revenuePerCase > 0) dayMap[date].revenue += units * revenuePerCase;
    });
    var laborByDay = (laborActuals && Array.isArray(laborActuals.byDay)) ? laborActuals.byDay : [];
    laborByDay.forEach(function(row) {
      var date = String(row && row.date_et || "");
      if (!date) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0 };
      dayMap[date].labor += safeNum(row && row.labor_cost);
    });
    return eachDayIsoBetween(dailyPerfRange.start, dailyPerfRange.end).map(function(date) {
      return dayMap[date] || { date: date, cases: 0, revenue: 0, labor: 0 };
    });
  }, [effectiveTrends, effectiveBreakdown, laborActuals, revenuePerCaseForRow, dailyPerfRange.start, dailyPerfRange.end]);

  const topOperationsCards = useMemo(function() {
    var byKey = {};
    (commandBoard && Array.isArray(commandBoard.presets) ? commandBoard.presets : []).forEach(function(card) {
      byKey[card.key] = card;
    });
    var revenueNote = function(card) {
      if (!card || !(safeNum(card.revenuePricedUnits) > 0)) return "Rev --";
      var note = "Rev " + fmtMoneyCompact(card.revenueActual);
      if (safeNum(card.revenueCoveragePct) > 0 && safeNum(card.revenueCoveragePct) < 100) note += " · " + card.revenueCoveragePct + "% cov";
      return note;
    };
    var referenceNote = function(label, card) {
      if (!card) return "";
      return label + " " + safeNum(card.latestUnits).toLocaleString();
    };
    var compareTone = function(card) {
      var delta = safeNum(card && card.displayDelta);
      if (delta > 0) return "text-[rgb(var(--success))]";
      if (delta < 0) return "text-[rgb(var(--danger))]";
      return "text-[rgb(var(--muted))]";
    };
    var compareText = function(card) {
      if (!card) return "No comparison available";
      var delta = safeNum(card.displayDelta);
      var pct = safeNum(card.displayDeltaPct);
      var compareActual = safeNum(card.compareActual);
      var prefix = delta > 0 ? "+" : "";
      var pctText = compareActual > 0 ? " (" + (pct > 0 ? "+" : "") + pct + "%)" : "";
      var label = String(card.displayLabel || card.compareLabel || "");
      var stateLabel = delta > 0 ? "Ahead" : delta < 0 ? "Behind" : "Flat";
      if (card.paceProjectedUnits != null) {
        return "Pacing " + safeNum(card.paceProjectedUnits).toLocaleString() + " · " + stateLabel + " " + prefix + delta.toLocaleString() + pctText + " " + label;
      }
      return stateLabel + " " + prefix + delta.toLocaleString() + pctText + " " + label;
    };
    return [
      {
        key: "today",
        label: "Today",
        value: safeNum(byKey.today && byKey.today.latestUnits).toLocaleString(),
        note: revenueNote(byKey.today),
        subnote: byKey.today
          ? referenceNote(
              String(byKey.today.compareReferenceLabel || "Yesterday"),
              { latestUnits: safeNum(byKey.today.compareReferenceUnits) }
            )
          : referenceNote("Yesterday", byKey.yesterday),
        detail: compareText(byKey.today),
        tone: compareTone(byKey.today)
      },
      {
        key: "this_week",
        label: "This Week",
        value: safeNum(byKey.this_week && byKey.this_week.latestUnits).toLocaleString(),
        note: revenueNote(byKey.this_week),
        subnote: referenceNote("Last Week", byKey.last_week),
        detail: compareText(byKey.this_week),
        tone: compareTone(byKey.this_week)
      },
      {
        key: "this_month",
        label: "This Month",
        value: safeNum(byKey.this_month && byKey.this_month.latestUnits).toLocaleString(),
        note: revenueNote(byKey.this_month),
        subnote: referenceNote("Last Month", byKey.last_month),
        detail: compareText(byKey.this_month),
        tone: compareTone(byKey.this_month)
      },
      {
        key: "avg_daily",
        label: "Avg / Day",
        value: safeNum(metrics.avgDailyUnits).toLocaleString(),
        note: metrics.latestProductionDate ? ("Latest day " + metrics.latestProductionDate) : "No production day yet",
        subnote: "",
        detail: metrics.trailingProductionDays
          ? ("Trailing velocity " + safeNum(metrics.trailingDailyVelocity).toLocaleString() + "/day")
          : "No trailing production history",
        tone: "text-[rgb(var(--muted))]"
      },
      {
        key: "weekly_run_rate",
        label: "Weekly Run Rate",
        value: safeNum(metrics.weeklyRunRate).toLocaleString(),
        note: "Trailing " + safeNum(metrics.trailingProductionDays).toLocaleString() + " production days",
        subnote: "",
        detail: "Current weekly yield pace",
        tone: "text-[rgb(var(--muted))]"
      },
      {
        key: "month_end",
        label: "Month-End Yield",
        value: safeNum(metrics.monthlyRunRate).toLocaleString(),
        note: safeNum(metrics.remainingBusinessDays).toLocaleString() + " business days remaining",
        subnote: "",
        detail: "Projected month-end yield",
        tone: "text-[rgb(var(--muted))]"
      }
    ];
  }, [commandBoard, metrics]);

  var hasCriticalOperationsData = (effectiveTrends && Array.isArray(effectiveTrends.byDay) && effectiveTrends.byDay.length > 0)
    || (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite) && effectiveBreakdown.rowsLite.length > 0);
  var isDeferredLoading = !!(deferredLoading.forecast || deferredLoading.config || deferredLoading.labor);
  var showProductionJobsLoading = deferredLoading.labor && laborActuals.status === "loading";
  var showProductionJobsError = laborActuals.status === "error" && !showProductionJobsLoading;

  if (!hasCriticalOperationsData && (loading || err)) {
    return (
      <div className="space-y-4">
        {err ? <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{err}</Card> : null}
        {!err ? (
          <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">
            Loading latest Operations snapshot...
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {err && <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{err}</Card>}

      <Card className="px-3 py-3">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Operations Snapshot</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {loading ? <div className="text-xs text-[rgb(var(--muted))]">Refreshing production snapshot...</div> : null}
            {isDeferredLoading ? <div className="text-xs text-[rgb(var(--muted))]">Loading labor, forecast, and cost overlays...</div> : null}
            {onRefreshProduction ? (
              <Button variant="outline" size="sm" onClick={onRefreshProduction} disabled={!!refreshingProduction}>
                <span className="mr-1" aria-hidden="true">↻</span>
                {refreshingProduction ? "Refreshing..." : "Refresh Data"}
              </Button>
            ) : null}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-6">
          {topOperationsCards.map(function(card) {
            return (
              <div key={card.key} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted))]">{card.label}</div>
                <div className="mt-2 text-2xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{card.value}</div>
                <div className="mt-1 text-xs text-[rgb(var(--muted))]">{card.note}</div>
                {card.subnote ? <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{card.subnote}</div> : null}
                <div className={"mt-2 text-[11px] font-medium " + card.tone}>{card.detail}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="mb-2 text-sm font-semibold">Production Jobs</div>
        {laborActuals.status === "missing_labor_events_table" && (
          <div className="mb-3 text-xs text-[rgb(var(--muted))]">
            Labor actuals are not enabled yet. Run `docs/supabase-labor-events.sql` in Supabase.
          </div>
        )}
        {showProductionJobsLoading ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            Loading labor-matched production jobs...
          </div>
        ) : showProductionJobsError ? (
          <div className="rounded-xl border border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-4 text-sm text-[rgb(var(--danger))]">
            Could not load labor actuals for Production Jobs right now.
          </div>
        ) : (
          <ProductionView
            productionSegments={serverProductionSegments}
            laborActuals={laborActuals}
            laborDataRaw={[]}
            resolveRevenueForRow={revenuePerCaseForRow}
          />
        )}
      </Card>

      <Card className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Daily Output & Economics</div>
            <div className="text-xs text-[rgb(var(--muted))]">
              Cases produced, revenue, and labor cost by day. Default window is the latest 30 days.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <DatePicker value={dailyPerfRange.start} onChange={setDailyPerfStart} className="h-9 w-[132px]" />
            <span className="text-xs text-[rgb(var(--muted))] whitespace-nowrap">-</span>
            <DatePicker value={dailyPerfRange.end} onChange={setDailyPerfEnd} className="h-9 w-[132px]" />
            <Button
              variant="outline"
              size="sm"
              onClick={function() {
                setDailyPerfStart("");
                setDailyPerfEnd("");
              }}
            >
              Last 30D
            </Button>
          </div>
        </div>
        {dailyEconomicsRows.length ? (
          <ChartContainer config={dailyEconomicsChartConfig} className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailyEconomicsRows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                <XAxis
                  dataKey="date"
                  tickFormatter={function(v) { return String(v || "").slice(5); }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={16}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="cases"
                  width={62}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="dollars"
                  orientation="right"
                  width={72}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={function(v) { return fmtMoneyCompact(v); }}
                  tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                />
                <ChartTooltip
                  cursor={{ stroke: "rgb(var(--border))", strokeDasharray: "3 3" }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={function(value) { return value; }}
                      formatter={function(value, _name, item) {
                        var key = String(item && item.dataKey || "");
                        if (key === "revenue" || key === "labor") return fmtMoney(value);
                        return Math.round(safeNum(value)).toLocaleString();
                      }}
                    />
                  }
                />
                <Line
                  yAxisId="cases"
                  type="monotone"
                  dataKey="cases"
                  stroke={dailyEconomicsChartConfig.cases.color}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="revenue"
                  stroke={dailyEconomicsChartConfig.revenue.color}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Line
                  yAxisId="dollars"
                  type="monotone"
                  dataKey="labor"
                  stroke={dailyEconomicsChartConfig.labor.color}
                  strokeWidth={2.25}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        ) : (
          <div className="h-60 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[15rem]">No daily production or labor data in selected window.</div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.cases.color }} />Cases Produced</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.revenue.color }} />Revenue</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: dailyEconomicsChartConfig.labor.color }} />Labor Cost</span>
        </div>
      </Card>

      <div className="grid gap-3 xl:grid-cols-3">
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Daily Production Yield</div>
          {dailyPlanVsActual.rows.length ? (
            <ChartContainer config={dailyChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyPlanVsActual.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={
                      <OperationsDailyTotalTooltipContent
                        config={dailyChartConfig}
                      />
                    }
                  />
                  {(dailyPlanVsActual.lineSeries || []).map(function(line, idx) {
                    var lastIdx = (dailyPlanVsActual.lineSeries || []).length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={line.key}
                        stackId="line"
                        dataKey={line.key}
                        fill={line.color}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke={dailyChartConfig.plan.color}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No daily production data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            {(dailyPlanVsActual.lineSeries || []).map(function(line) {
              return (
                <span key={line.key} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: line.color }} />
                  {line.label}
                </span>
              );
            })}
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Forecast daily plan</span>
          </div>
        </Card>
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Shift Mix by Day</div>
          {shiftPlanVsActual.rows.length ? (
            <ChartContainer config={shiftChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={shiftPlanVsActual.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={
                      <OperationsDailyTotalTooltipContent
                        config={shiftChartConfig}
                      />
                    }
                  />
                  {["s1", "s2", "un"].map(function(key, idx, arr) {
                    var lastIdx = arr.length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={key}
                        stackId="shift"
                        dataKey={key}
                        fill={shiftChartConfig[key].color}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke={shiftChartConfig.plan.color}
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No shift production data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.s1.color }} />Shift 1</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.s2.color }} />Shift 2</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: shiftChartConfig.un.color }} />Unassigned</span>
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Forecast daily plan</span>
          </div>
        </Card>
        <Card className="px-4 py-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">SKU Mix by Day</div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant={skuMixMode === "type" ? "active" : "outline"} onClick={function() { setSkuMixMode("type"); }}>
                SKU Type
              </Button>
              <Button size="sm" variant={skuMixMode === "item" ? "active" : "outline"} onClick={function() { setSkuMixMode("item"); }}>
                Item #
              </Button>
            </div>
          </div>
          {skuMixByDay.rows.length ? (
            <ChartContainer config={skuMixChartConfig} className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={skuMixByDay.rows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={function(v) { return String(v || "").slice(5); }}
                    tickLine={false}
                    axisLine={false}
                    minTickGap={16}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <YAxis
                    width={62}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }}
                    tick={{ fill: "rgb(var(--muted))", fontSize: 11 }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "rgb(var(--surface))" }}
                    content={
                      <ChartTooltipContent
                        labelFormatter={function(value) { return value; }}
                        formatter={function(value) { return Math.round(safeNum(value)); }}
                      />
                    }
                  />
                  {(skuMixByDay.series || []).map(function(s, idx) {
                    var lastIdx = (skuMixByDay.series || []).length - 1;
                    var radius = idx === 0 ? [0, 0, 4, 4] : idx === lastIdx ? [4, 4, 0, 0] : [0, 0, 0, 0];
                    return (
                      <Bar
                        key={s.key}
                        stackId="skuMix"
                        dataKey={s.key}
                        fill={s.color}
                        radius={radius}
                        maxBarSize={30}
                      />
                    );
                  })}
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="h-52 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[13rem]">No SKU mix data in selected window.</div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            {(skuMixByDay.series || []).map(function(s) {
              return (
                <span key={s.key} className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                  {s.label}
                </span>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Production Job Leaderboard</div>
            <div className="text-xs text-[rgb(var(--muted))]">
              Ranked by cases per payable labor hour in the selected window. Qualified jobs need at least {productionJobLeaderboard.minCases.toLocaleString()} cases and {productionJobLeaderboard.minHours.toFixed(1)} matched labor hour.
            </div>
          </div>
          <div className="text-xs text-[rgb(var(--muted))]">
            {productionJobLeaderboard.qualifiedCount.toLocaleString()} qualified job{productionJobLeaderboard.qualifiedCount === 1 ? "" : "s"}
          </div>
        </div>

        {showProductionJobsLoading ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            Loading labor-matched job leaderboard...
          </div>
        ) : laborActuals.status === "missing_labor_events_table" ? (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            Labor actuals are not enabled yet, so the job leaderboard is unavailable.
          </div>
        ) : showProductionJobsError ? (
          <div className="rounded-xl border border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-4 text-sm text-[rgb(var(--danger))]">
            Could not load matched labor data for the job leaderboard right now.
          </div>
        ) : productionJobLeaderboard.qualifiedCount ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {[
              { key: "best", label: "Top 5 Best Jobs", rows: productionJobLeaderboard.best, tone: "success", icon: TrendingUp },
              { key: "worst", label: "Top 5 Worst Jobs", rows: productionJobLeaderboard.worst, tone: "danger", icon: TrendingDown }
            ].map(function(section) {
              var Icon = section.icon;
              var headerTone = section.tone === "success"
                ? "text-[rgb(var(--success))]"
                : "text-[rgb(var(--danger))]";
              return (
                <div key={section.key} className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))]">
                  <div className="flex items-center gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
                    <Icon className={"h-4 w-4 " + headerTone} />
                    <div className="text-sm font-semibold">{section.label}</div>
                  </div>
                  <div className="divide-y divide-[rgb(var(--border))]">
                    {section.rows.map(function(row, idx) {
                      var statusTone = row.laborStatus === "finalized"
                        ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]"
                        : row.laborStatus === "provisional" || row.laborStatus === "mixed"
                          ? "border-[rgb(var(--warn-line))] bg-[rgb(var(--warn-soft))] text-[rgb(var(--warn))]"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]";
                      return (
                        <div key={row.key} className="flex flex-wrap items-start justify-between gap-3 px-3 py-3">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className={"inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold " + (section.tone === "success" ? "bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]")}>
                                #{idx + 1}
                              </span>
                              <span className="truncate text-sm font-semibold text-[rgb(var(--foreground))]">{row.itemCode}</span>
                              <span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium " + statusTone}>{laborStatusShortLabel(row.laborStatus)}</span>
                            </div>
                            <div className="truncate text-xs text-[rgb(var(--muted))]">
                              Job {row.jobId} · WO {row.workOrder} · {row.line}
                            </div>
                            <div className="truncate text-[11px] text-[rgb(var(--muted))]">{row.itemDescription || "--"}</div>
                          </div>
                          <div className="shrink-0 text-right text-xs [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>
                            <div className={"text-sm font-semibold " + headerTone}>{fmtCasesPerHour(row.casesPerPayableHour)}</div>
                            <div className="text-[rgb(var(--muted))]">{Math.round(safeNum(row.casesProduced)).toLocaleString()} cs · {safeNum(row.payableHours).toFixed(1)} hrs</div>
                            <div className="text-[rgb(var(--muted))]">{fmtMoneyPrecise(row.laborCostPerCase)}/case · {row.activeDayCount} day{row.activeDayCount === 1 ? "" : "s"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-4 text-sm text-[rgb(var(--muted))]">
            No matched production jobs met the leaderboard minimums in this window.
          </div>
        )}
      </Card>

      <div className="grid gap-3 xl:grid-cols-2">
        <Card className="px-4 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Production Lines</div>
              <div className="text-xs text-[rgb(var(--muted))]">
                Output leaders and movers for the selected window, {lineScoreboard.compareLabel}.
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={function() { setShowProductionLines(function(v) { return !v; }); }}>
              <span className="mr-1">{showProductionLines ? "▾" : "▸"}</span>
              {showProductionLines ? "Hide" : "Show"}
            </Button>
          </div>
          {showProductionLines ? (
          <>
          <div className="mb-3 grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Leader</div>
              <div className="mt-1 text-sm font-semibold">
                {lineScoreboard.leader ? lineScoreboard.leader.line : "No production"}
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.leader
                  ? (Math.round(lineScoreboard.leader.units).toLocaleString() + " cs · " + lineScoreboard.leader.sharePct + "%")
                  : "No line output in this window."}
              </div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Lift</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                {lineScoreboard.biggestUp ? <TrendingUp className="h-3.5 w-3.5 text-[rgb(var(--success))]" /> : null}
                <span>{lineScoreboard.biggestUp ? lineScoreboard.biggestUp.line : "No lift"}</span>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.biggestUp
                  ? ("+" + Math.round(lineScoreboard.biggestUp.deltaUnits).toLocaleString() + " cs")
                  : ("No positive movement " + lineScoreboard.compareLabel + ".")}
              </div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Watch</div>
              <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                {lineScoreboard.biggestDown ? <TrendingDown className="h-3.5 w-3.5 text-[rgb(var(--danger))]" /> : null}
                <span>{lineScoreboard.biggestDown ? lineScoreboard.biggestDown.line : "No lagging line"}</span>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {lineScoreboard.biggestDown
                  ? (Math.round(lineScoreboard.biggestDown.deltaUnits).toLocaleString() + " cs")
                  : ("No negative movement " + lineScoreboard.compareLabel + ".")}
              </div>
            </div>
          </div>
          <TableShell>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Cases</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Delta</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">State</th>
                </tr>
              </thead>
              <tbody>
                {lineScoreboard.rows.slice(0, 6).map(function(r) {
                  var TrendIcon = r.trend === "up" ? TrendingUp : r.trend === "down" ? TrendingDown : Minus;
                  var deltaTone = r.trend === "up"
                    ? "text-[rgb(var(--success))]"
                    : r.trend === "down"
                      ? "text-[rgb(var(--danger))]"
                      : "text-[rgb(var(--muted))]";
                  var statusTone = r.status === "Leading"
                    ? "border-[rgb(var(--accent))] bg-[color-mix(in_oklab,rgb(var(--accent))_8%,white)] text-[rgb(var(--accent))]"
                    : r.status === "Improving"
                      ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]"
                      : r.status === "Softening" || r.status === "Idle"
                        ? "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]"
                        : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]";
                  return (
                    <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                      <td className="px-2 py-2 text-sm">
                        <div>{r.line}</div>
                        <div className="text-[11px] text-[rgb(var(--muted))]">{r.sharePct}% share</div>
                      </td>
                      <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(r.units).toLocaleString()}</td>
                      <td className={"px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] " + deltaTone} style={{ fontFamily: mono }}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          <TrendIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {r.deltaUnits > 0 ? "+" : ""}{Math.round(r.deltaUnits).toLocaleString()}
                            {r.priorUnits > 0 ? " (" + (r.deltaPct > 0 ? "+" : "") + r.deltaPct + "%)" : ""}
                          </span>
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <span className={"inline-flex rounded-full border px-2 py-1 text-[11px] font-medium " + statusTone}>{r.status}</span>
                      </td>
                    </tr>
                  );
                })}
                {!lineScoreboard.rows.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line output data in this window.</td></tr>}
              </tbody>
            </table>
          </TableShell>
          </>
          ) : null}
        </Card>

        <Card className="px-4 py-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Loss Priorities</div>
              <div className="text-xs text-[rgb(var(--muted))]">
                Controllable Evocon loss hotspots, {evoconInsights.compareLabel}.
                {evoconInsights.latestDate ? " Latest day: " + evoconInsights.latestDate + "." : ""}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={function() { setShowLossPriorities(function(v) { return !v; }); }}>
              <span className="mr-1">{showLossPriorities ? "▾" : "▸"}</span>
              {showLossPriorities ? "Hide" : "Show"}
            </Button>
          </div>
          {showLossPriorities ? (!evoconInsights.hasData ? (
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-8 text-center text-sm text-[rgb(var(--muted))]">
              No Evocon rows in selected window. Sync Evocon and/or adjust dates.
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                {evoconInsights.priorityCards.slice(0, 3).map(function(card) {
                  var rawDelta = safeNum(card.delta);
                  var hasDelta = card.delta != null;
                  var deltaIsGood = card.goodWhenDown ? rawDelta < 0 : rawDelta > 0;
                  var deltaIsBad = card.goodWhenDown ? rawDelta > 0 : rawDelta < 0;
                  var DeltaIcon = rawDelta > 0 ? TrendingUp : rawDelta < 0 ? TrendingDown : Minus;
                  var deltaLabel = deltaIsGood ? "Improving" : deltaIsBad ? "Worsening" : "Flat";
                  var deltaTone = deltaIsGood
                    ? "text-[rgb(var(--success))]"
                    : deltaIsBad
                      ? "text-[rgb(var(--danger))]"
                      : "text-[rgb(var(--muted))]";
                  var valueTone = card.tone === "danger"
                    ? "text-[rgb(var(--danger))]"
                    : "text-[rgb(var(--foreground))]";
                  return (
                    <div key={card.label} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">{card.label}</div>
                      <div className={"mt-1 text-lg font-bold [font-variant-numeric:tabular-nums] " + valueTone} style={{ fontFamily: mono }}>{card.value}</div>
                      <div className="text-xs text-[rgb(var(--muted))]">{card.subcopy}</div>
                      {hasDelta ? (
                        <div className={"mt-2 inline-flex items-center gap-1 text-[11px] font-medium " + deltaTone}>
                          <DeltaIcon className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {deltaLabel + " · "}
                            {rawDelta > 0 ? "+" : ""}{rawDelta.toLocaleString()}
                            {card.deltaPct != null ? " (" + (safeNum(card.deltaPct) > 0 ? "+" : "") + card.deltaPct + "%)" : ""}
                          </span>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {(evoconInsights.actions && evoconInsights.actions[0]) ? (
                <div className="rounded-md border border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2">
                  <div className="text-sm font-semibold text-[rgb(var(--danger))]">{evoconInsights.actions[0].title}</div>
                  <div className="text-xs text-[rgb(var(--muted))]">{evoconInsights.actions[0].detail}</div>
                </div>
              ) : null}
              {(evoconInsights.shiftCards && evoconInsights.shiftCards[0]) ? (
                <div className="rounded-md border border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] px-3 py-2 text-xs text-[rgb(var(--foreground))]">
                  Worst shift: <span className="font-semibold">{evoconInsights.shiftCards[0].shift}</span> · {evoconInsights.shiftCards[0].lossMin.toLocaleString()} loss min · {evoconInsights.shiftCards[0].driverLabel}
                </div>
              ) : null}
              <TableShell>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: C.raised }}>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Loss</th>
                      <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Driver</th>
                      <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Focus</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evoconInsights.byLine.slice(0, 6).map(function(r) {
                      var focusTone = r.focus === "Raise stop coding"
                        ? "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]"
                        : r.focus === "Recover speed"
                          ? "border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning))]"
                          : r.focus === "Reduce stops" || r.focus === "Fix technical losses"
                            ? "border-[rgb(var(--accent))] bg-[color-mix(in_oklab,rgb(var(--accent))_8%,white)] text-[rgb(var(--accent))]"
                            : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--muted))]";
                      var statusTone = r.status === "Hotspot" || r.status === "Blind spot" || r.status === "Worsening"
                        ? "text-[rgb(var(--danger))]"
                        : r.status === "Improving"
                          ? "text-[rgb(var(--success))]"
                          : "text-[rgb(var(--muted))]";
                      return (
                        <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                          <td className="px-2 py-2 text-sm">
                            <div>{r.line}</div>
                            <div className={"text-[11px] " + statusTone}>{r.status} · {r.lossSharePct}% share</div>
                          </td>
                          <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{r.lossMin.toLocaleString()}</td>
                          <td className="px-2 py-2 text-sm">
                            <div>{r.driverLabel}</div>
                            <div className="text-[11px] text-[rgb(var(--muted))]">{r.driverSharePct}% of line loss</div>
                          </td>
                          <td className="px-2 py-2 text-right text-sm">
                            <span className={"inline-flex rounded-full border px-2 py-1 text-[11px] font-medium " + focusTone}>{r.focus}</span>
                          </td>
                        </tr>
                      );
                    })}
                    {!evoconInsights.byLine.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line loss data in this window.</td></tr>}
                  </tbody>
                </table>
              </TableShell>
            </div>
          )) : null}
        </Card>
      </div>

    </div>
  );
}
