import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { detectPackType, formatDescriptionForDisplay, normalizeStr } from "../utils";

var MONTH_INDEX_LOCAL = {
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
    productionStatus: productionStatus || "ok",
    summaryOnly: false,
    querySource: ""
  };
}

var EMPTY_BREAKDOWN = { rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0, summaryOnly: false, querySource: "" };
var OPERATIONS_PRIMARY_STALE_MS = 5 * 60 * 1000;
var OPERATIONS_SUPPORTING_STALE_MS = 15 * 60 * 1000;
var MAX_PRODUCTION_WINDOW_MINUTES = 960;
var operationsInsightsPanelImportPromise = null;

function importOperationsInsightsPanel() {
  if (!operationsInsightsPanelImportPromise) operationsInsightsPanelImportPromise = import("./OperationsInsightsPanel");
  return operationsInsightsPanelImportPromise;
}

const OperationsInsightsPanel = lazy(function() {
  return importOperationsInsightsPanel()
    .then(function(mod) {
      return mod && mod.default ? mod : { default: mod.default || mod };
    })
    .catch(function() {
      return {
        default: function FailedOperationsInsightsPanel() {
          return <Card className="px-4 py-4 text-sm text-[rgb(var(--danger))]">Could not load Operations charts and production detail.</Card>;
        }
      };
    });
});

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

async function fetchOperationsSummary(start, end) {
  var result = await fetchJsonWithCredentials("/api/ops/production-breakdown?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end) + "&summary=1");
  if (!result.response.ok) {
    throw new Error((result.body && result.body.error) || "Could not load production summary");
  }
  return normalizeBreakdownPayload(result.body);
}

async function fetchOperationsBreakdown(start, end) {
  var result = await fetchJsonWithCredentials("/api/ops/production-breakdown?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end));
  if (!result.response.ok) {
    throw new Error((result.body && result.body.error) || "Could not load production breakdown");
  }
  return normalizeBreakdownPayload(result.body);
}

async function fetchOperationsForecastPlans(monthKeys) {
  var result = await fetchJsonWithCredentials("/api/ops/forecast-plan?monthKeys=" + encodeURIComponent(monthKeys.join(",")));
  return normalizeForecastPlansPayload(result.response.ok ? result.body : {});
}

async function fetchOperationsConfig() {
  var result = await fetchJsonWithCredentials("/api/ops/config");
  return normalizeConfigPayload(result.response.ok ? result.body : {});
}

async function fetchOperationsLaborSummary(start, end) {
  var result = await fetchJsonWithCredentials("/api/ops/labor-actuals?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end) + "&summary=1");
  if (!result.response.ok) {
    throw new Error((result.body && result.body.error) || "Could not load labor summary");
  }
  return normalizeLaborActualsPayload(true, result.body);
}

async function fetchOperationsLaborDetail(start, end) {
  var result = await fetchJsonWithCredentials("/api/ops/labor-actuals?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end));
  if (!result.response.ok) {
    throw new Error((result.body && result.body.error) || "Could not load labor actuals");
  }
  return normalizeLaborActualsPayload(true, result.body);
}

function normalizeBreakdownPayload(body) {
  var breakdownRows = Array.isArray(body && body.rowsLite) ? body.rowsLite : [];
  var byDay = Array.isArray(body && body.byDay) ? body.byDay : aggregateBreakdownByDay(breakdownRows).slice().sort(function(a, b) {
    return String(b.date || "").localeCompare(String(a.date || ""));
  });
  var byShift = Array.isArray(body && body.byShift) ? body.byShift : aggregateBreakdownByShift(breakdownRows);
  return {
    trends: {
      byDay: byDay,
      byShift: byShift
    },
    breakdown: {
      rowsLite: breakdownRows,
      bySku: Array.isArray(body && body.bySku) ? body.bySku : [],
      byLine: Array.isArray(body && body.byLine) ? body.byLine : [],
      latestByLine: Array.isArray(body && body.latestByLine) ? body.latestByLine : [],
      latestDate: body && body.latestDate ? body.latestDate : null,
      totalRows: safeNum(body && body.totalRows),
      summaryOnly: !!(body && body.summaryOnly),
      querySource: String(body && body.querySource || "")
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
    productionStatus: body.productionStatus || "ok",
    summaryOnly: !!(body && body.summaryOnly),
    querySource: String(body && body.querySource || "")
  };
}

function withLaborActualsStatus(payload, status) {
  var base = createEmptyLaborActuals(status, payload && payload.productionStatus);
  return Object.assign(base, payload || {}, { status: status || (payload && payload.status) || "ok" });
}

function hasLaborActualsSummaryData(payload) {
  if (!payload || typeof payload !== "object") return false;
  return (
    !!(payload.summary && Object.keys(payload.summary).length) ||
    (Array.isArray(payload.byDay) && payload.byDay.length > 0) ||
    (Array.isArray(payload.byShift) && payload.byShift.length > 0) ||
    (Array.isArray(payload.byLine) && payload.byLine.length > 0)
  );
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

function fmtMoneyCompact(v) {
  return moneyCompactFormatter.format(safeNum(v));
}

function fmtMissingRevenueSkuCount(count) {
  return count + " SKU" + (count === 1 ? "" : "s") + " missing revenue";
}

function elapsedMinutesBetween(startUtc, endUtc) {
  var start = startUtc ? new Date(startUtc) : null;
  var end = endUtc ? new Date(endUtc) : null;
  if (!start || !end || isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function clampProductionMinutes(minutes) {
  var value = safeNum(minutes);
  if (!(value > 0)) return 0;
  return Math.min(MAX_PRODUCTION_WINDOW_MINUTES, value);
}

function normalizeProductionShiftBucket(label) {
  var text = String(label || "").toLowerCase();
  if (text.indexOf("1") !== -1) return "shift_1";
  if (text.indexOf("2") !== -1) return "shift_2";
  return "unassigned";
}

function parseIsoDateParts(dateKey) {
  var match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    monthIndex: parseInt(match[2], 10) - 1,
    day: parseInt(match[3], 10)
  };
}

function productionShiftWindowRange(dateKey, shiftLabel) {
  var parts = parseIsoDateParts(dateKey);
  if (!parts) return null;
  if (shiftLabel === "Shift 1 (7a-3p)") {
    return {
      start: easternWallClockToDateLocal(parts.year, parts.monthIndex, parts.day, 7, 0, 0),
      end: easternWallClockToDateLocal(parts.year, parts.monthIndex, parts.day, 15, 6, 0)
    };
  }
  if (shiftLabel === "Shift 2 (3p-11p)") {
    return {
      start: easternWallClockToDateLocal(parts.year, parts.monthIndex, parts.day, 15, 6, 0),
      end: easternWallClockToDateLocal(parts.year, parts.monthIndex, parts.day, 24, 0, 0)
    };
  }
  return null;
}

function actualWindowMinutesForShiftBucket(dateKey, shiftLabel, startUtc, endUtc) {
  var range = productionShiftWindowRange(dateKey, shiftLabel);
  var start = parseDateLooseLocal(startUtc);
  var end = parseDateLooseLocal(endUtc);
  if (!range || !start || !end || isNaN(start) || isNaN(end) || end <= start) return 0;
  var overlapStart = Math.max(start.getTime(), range.start.getTime());
  var overlapEnd = Math.min(end.getTime(), range.end.getTime());
  if (!(overlapEnd > overlapStart)) return 0;
  return clampProductionMinutes(Math.round((overlapEnd - overlapStart) / 60000));
}

function measureProductionWindow(startUtc, endUtc, firstProducedAtUtc, lastProducedAtUtc) {
  var actualElapsedMinutes = clampProductionMinutes(elapsedMinutesBetween(startUtc, endUtc));
  var observedElapsedMinutes = clampProductionMinutes(elapsedMinutesBetween(firstProducedAtUtc, lastProducedAtUtc));
  var hasActualWindow = actualElapsedMinutes > 0;
  var hasObservedSpan = !hasActualWindow && observedElapsedMinutes > 0;
  return {
    actualElapsedMinutes: actualElapsedMinutes,
    observedElapsedMinutes: observedElapsedMinutes,
    productionMinutes: hasActualWindow
      ? actualElapsedMinutes
      : (hasObservedSpan ? observedElapsedMinutes : 0),
    hasActualWindow: hasActualWindow,
    hasObservedSpan: hasObservedSpan,
    spanSource: hasActualWindow ? "actual_job_window" : (hasObservedSpan ? "observed_fg_output_span" : "unavailable")
  };
}

function formatTimeEt(value) {
  var parts = toEasternDateTimeParts(value);
  if (!parts) return "--";
  var hour24 = safeNum(parts.hour);
  var minute = String(safeNum(parts.minute)).padStart(2, "0");
  var suffix = hour24 >= 12 ? "p" : "a";
  var hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return hour12 + ":" + minute + suffix;
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
  var from = new Date(String(fromDate || "") + "T00:00:00Z");
  var to = new Date(String(toDate || "") + "T00:00:00Z");
  if (isNaN(from) || isNaN(to) || from > to) return 0;
  var c = 0;
  var d = new Date(from);
  while (d <= to) {
    var dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) c += 1;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return c;
}

function pctDelta(actual, plan) {
  if (!plan) return 0;
  return Math.round(((safeNum(actual) - safeNum(plan)) / safeNum(plan)) * 100);
}

function timeZonePartsLocal(date, timeZone) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  var out = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).forEach(function(part) {
    if (part.type !== "literal") out[part.type] = part.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    year: parseInt(out.year, 10),
    month: parseInt(out.month, 10),
    day: parseInt(out.day, 10),
    hour: parseInt(out.hour || "0", 10),
    minute: parseInt(out.minute || "0", 10),
    second: parseInt(out.second || "0", 10)
  };
}

function timeZoneOffsetMillisLocal(date, timeZone) {
  var parts = timeZonePartsLocal(date, timeZone);
  if (!parts) return 0;
  var asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function easternWallClockToDateLocal(year, monthIndex, day, hour24, minute, second) {
  var utcGuess = Date.UTC(year, monthIndex, day, hour24, minute || 0, second || 0);
  var offset = timeZoneOffsetMillisLocal(new Date(utcGuess), "America/New_York");
  var actual = utcGuess - offset;
  var resolvedOffset = timeZoneOffsetMillisLocal(new Date(actual), "America/New_York");
  if (resolvedOffset !== offset) actual = utcGuess - resolvedOffset;
  return new Date(actual);
}

function parseNulogyWallClockLocal(value) {
  var raw = String(value || "").trim();
  if (!raw) return null;
  var patterns = [
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{4})-([A-Za-z]{3})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)?(?:\s+[A-Z]{2,5}|[+-]\d{2}:?\d{2})?$/i,
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d{1,6})?\s*([AP]M)?$/i
  ];
  for (var i = 0; i < patterns.length; i += 1) {
    var match = raw.match(patterns[i]);
    if (!match) continue;
    var year = 0;
    var monthIndex = 0;
    var day = 0;
    if (i === 0 || i === 1) {
      year = parseInt(match[1], 10);
      monthIndex = MONTH_INDEX_LOCAL[String(match[2] || "").toLowerCase()];
      day = parseInt(match[3], 10);
    } else if (i === 2) {
      year = parseInt(match[1], 10);
      monthIndex = parseInt(match[2], 10) - 1;
      day = parseInt(match[3], 10);
    } else {
      monthIndex = parseInt(match[1], 10) - 1;
      day = parseInt(match[2], 10);
      year = parseInt(match[3], 10);
    }
    var hour = parseInt(match[4], 10);
    var minute = parseInt(match[5], 10);
    var second = parseInt(match[6] || "0", 10);
    var meridiem = String(match[7] || "").toUpperCase();
    if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) continue;
    if (meridiem === "PM" && hour < 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
    var parsed = easternWallClockToDateLocal(year, monthIndex, day, hour, minute, second);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

function parseDateLooseLocal(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  if (typeof value === "number") {
    var fromNum = new Date(value);
    return isNaN(fromNum) ? null : fromNum;
  }
  var raw = String(value || "").trim();
  if (!raw || /^[+-]?\d{4,}$/.test(raw)) return null;
  var wallClock = parseNulogyWallClockLocal(raw);
  if (wallClock) return wallClock;
  var parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed;
}

function toIsoDateLocal(d) {
  var dt = parseDateLooseLocal(d);
  if (!dt || isNaN(dt)) return "";
  var y = dt.getFullYear();
  var m = String(dt.getMonth() + 1).padStart(2, "0");
  var day = String(dt.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function toIsoDateUTC(d) {
  var dt = parseDateLooseLocal(d);
  if (!dt || isNaN(dt)) return "";
  var y = dt.getUTCFullYear();
  var m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  var day = String(dt.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function toIso(value) {
  var dt = parseDateLooseLocal(value);
  if (!dt || isNaN(dt)) return "";
  return dt.toISOString();
}

function toIsoDateET(d) {
  var dt = parseDateLooseLocal(d);
  if (!dt || isNaN(dt)) return "";
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
  var dt = parseDateLooseLocal(d);
  if (!dt || isNaN(dt)) return null;
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

var PRODUCTION_DAY_START_MINUTES = 7 * 60;
var PRODUCTION_DAY_END_MINUTES = 23 * 60;

function productionDayStatusET(d) {
  var parts = toEasternDateTimeParts(d);
  if (!parts) return null;
  var totalMinutes = (safeNum(parts.hour) * 60) + safeNum(parts.minute);
  return {
    calendarDate: parts.date,
    productionDate: totalMinutes < PRODUCTION_DAY_START_MINUTES ? shiftDays(parts.date, -1) : parts.date,
    totalMinutes: totalMinutes,
    inProgress: totalMinutes >= PRODUCTION_DAY_START_MINUTES && totalMinutes < PRODUCTION_DAY_END_MINUTES
  };
}

function productionDayElapsedMinutesET(d) {
  var status = productionDayStatusET(d);
  if (!status) return 0;
  var totalProductionMinutes = PRODUCTION_DAY_END_MINUTES - PRODUCTION_DAY_START_MINUTES;
  if (status.totalMinutes <= PRODUCTION_DAY_START_MINUTES) return 0;
  if (status.totalMinutes >= PRODUCTION_DAY_END_MINUTES) return totalProductionMinutes;
  return Math.max(0, Math.min(totalProductionMinutes, status.totalMinutes - PRODUCTION_DAY_START_MINUTES));
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
  d.setUTCDate(1);
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

function isIsoDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function isValidIsoRange(range) {
  var start = String(range && range.start || "");
  var end = String(range && range.end || "");
  return isIsoDateKey(start) && isIsoDateKey(end) && end >= start;
}

function mergeIsoRangeBounds(bounds, range) {
  if (!isValidIsoRange(range)) return bounds;
  var start = String(range.start || "");
  var end = String(range.end || "");
  return {
    start: !bounds.start || start < bounds.start ? start : bounds.start,
    end: !bounds.end || end > bounds.end ? end : bounds.end
  };
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
  labor: "#CC79A7",
  margin: "#D55E00"
};

var COMMAND_BOARD_PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This Week" },
  { key: "last_week", label: "Last Week" },
  { key: "this_month", label: "This Month" },
  { key: "last_month", label: "Last Month" }
];
var OPERATIONS_SNAPSHOT_CARD_KEYS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"];

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
    var dt = parseDateLooseLocal(producedRaw || "");
    if (dt && !isNaN(dt)) {
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
    var jobId = String(pickFieldLooseLocal(row, ["Job ID", "job_id", "Job"]) || "").trim();
    var producedAtUtc = toIso(pickFieldLooseLocal(row, ["Produced At", "produced_at", "Produced date", "producedAt"]));
    var jobStartAtUtc = toIso(pickFieldLooseLocal(row, ["Actual Job Start", "actual_job_start_at", "Actual Job Start At", "actualJobStartAt"]));
    var jobEndAtUtc = toIso(pickFieldLooseLocal(row, ["Actual Job End", "actual_job_end_at", "Actual Job End At", "actualJobEndAt"])) || producedAtUtc;

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
      produced_at_utc: producedAtUtc || null,
      produced_date_et: date,
      shift_label: shift,
      job_id: jobId || null,
      item_code: sku === "UNKNOWN" ? null : sku,
      item_desc: itemDesc || null,
      units_produced: units,
      line: line,
      work_order_code: wo || null,
      job_start_at_utc: jobStartAtUtc || null,
      job_end_at_utc: jobEndAtUtc || null
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

function productionJobKey(row) {
  var date = String(row && row.produced_date_et || "");
  var jobId = String(row && row.job_id || "").trim();
  var workOrder = String(row && row.work_order_code || "").trim();
  var line = String(row && row.line || "Unknown").trim() || "Unknown";
  var itemCode = String(row && row.item_code || "").trim();
  return [date, jobId || "--", workOrder || "--", line, itemCode || "--"].join("|");
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

function statusLooksClosed(status) {
  var s = normalizeStr(status || "");
  if (!s) return false;
  return s.includes("close") || s.includes("complete") || s.includes("cancel") || s.includes("archive") || s.includes("done");
}

export default function OperationsView({ productionSegments, productionDataRaw, laborDataRaw, evoconData, evoconTimestamp, itemMaster, workOrders, dispatchQueue, initialFilters, onPermalinkChange, serverSyncVersion, onRefreshProduction, refreshingProduction }) {
  const { C, mono } = useTheme();
  const queryClient = useQueryClient();
  var initial = initialFilters || {};
  var initialPreset = String(initial.preset || "last_14");
  const [windowPreset, setWindowPreset] = useState(initialPreset);
  const initialRange = presetRange("last_14");
  const [rangeStart, setRangeStart] = useState(String(initial.start || initialRange.start));
  const [rangeEnd, setRangeEnd] = useState(String(initial.end || initialRange.end));
  const [showInsightsPanelsReady, setShowInsightsPanelsReady] = useState(false);
  const [deferredFetchReady, setDeferredFetchReady] = useState(false);
  const [skuMixMode, setSkuMixMode] = useState("type");
  const [showProductionLines, setShowProductionLines] = useState(false);
  const [showLossPriorities, setShowLossPriorities] = useState(false);
  const [dailyPerfStart, setDailyPerfStart] = useState("");
  const [dailyPerfEnd, setDailyPerfEnd] = useState("");
  const [productionJobsRequestedRange, setProductionJobsRequestedRange] = useState({ start: "", end: "" });

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

  var dailyPerfRequestedRange = useMemo(function() {
    var fetchEnd = dailyPerfEnd || todayEt;
    var fetchStart = dailyPerfStart || shiftDays(fetchEnd, -29);
    if (!isValidIsoRange({ start: fetchStart, end: fetchEnd })) {
      return {
        start: shiftDays(todayEt, -29),
        end: todayEt
      };
    }
    return {
      start: fetchStart,
      end: fetchEnd
    };
  }, [dailyPerfStart, dailyPerfEnd, todayEt]);

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

  var commandBoardFetchRange = useMemo(function() {
    var bounds = { start: "", end: "" };
    OPERATIONS_SNAPSHOT_CARD_KEYS.forEach(function(key) {
      var preset = presetRange(key);
      bounds = mergeIsoRangeBounds(bounds, preset);
      if (key === "today" || key === "this_week" || key === "this_month") {
        var compareInfo = comparableRangeForPreset(key, preset);
        var compareRange = compareInfo && compareInfo.range ? compareInfo.range : null;
        bounds = mergeIsoRangeBounds(bounds, compareRange);
      }
    });
    if (!isValidIsoRange(bounds)) {
      return {
        start: todayEt,
        end: todayEt
      };
    }
    return bounds;
  }, [todayEt]);

  var productionDataFetchRange = useMemo(function() {
    var bounds = { start: "", end: "" };
    bounds = mergeIsoRangeBounds(bounds, range);
    bounds = mergeIsoRangeBounds(bounds, dailyPerfRequestedRange);
    bounds = mergeIsoRangeBounds(bounds, commandBoardFetchRange);
    bounds = mergeIsoRangeBounds(bounds, productionJobsRequestedRange);
    if (!isValidIsoRange(bounds)) {
      return {
        start: shiftDays(todayEt, -29),
        end: todayEt
      };
    }
    return bounds;
  }, [range, dailyPerfRequestedRange, commandBoardFetchRange, productionJobsRequestedRange, todayEt]);

  var forecastMonthsKey = forecastPlanMonths.join(",");
  var summaryQueryKey = useMemo(function() {
    return ["operations", "summary", safeNum(serverSyncVersion), productionDataFetchRange.start, productionDataFetchRange.end];
  }, [serverSyncVersion, productionDataFetchRange.start, productionDataFetchRange.end]);
  var breakdownQueryKey = useMemo(function() {
    return ["operations", "breakdown", safeNum(serverSyncVersion), productionDataFetchRange.start, productionDataFetchRange.end];
  }, [serverSyncVersion, productionDataFetchRange.start, productionDataFetchRange.end]);
  var forecastQueryKey = useMemo(function() {
    return ["operations", "forecast", safeNum(serverSyncVersion), forecastMonthsKey];
  }, [serverSyncVersion, forecastMonthsKey]);
  var configQueryKey = useMemo(function() {
    return ["operations", "config", safeNum(serverSyncVersion)];
  }, [serverSyncVersion]);
  var laborSummaryQueryKey = useMemo(function() {
    return ["operations", "labor-summary", safeNum(serverSyncVersion), productionDataFetchRange.start, productionDataFetchRange.end];
  }, [serverSyncVersion, productionDataFetchRange.start, productionDataFetchRange.end]);
  var laborDetailQueryKey = useMemo(function() {
    return ["operations", "labor-detail", safeNum(serverSyncVersion), productionDataFetchRange.start, productionDataFetchRange.end];
  }, [serverSyncVersion, productionDataFetchRange.start, productionDataFetchRange.end]);
  var deferredQueryKey = useMemo(function() {
    return [
      safeNum(serverSyncVersion),
      productionDataFetchRange.start,
      productionDataFetchRange.end,
      forecastMonthsKey,
      productionDataFetchRange.start,
      productionDataFetchRange.end
    ].join("|");
  }, [serverSyncVersion, productionDataFetchRange.start, productionDataFetchRange.end, forecastMonthsKey]);
  var hasCachedBreakdown = !!queryClient.getQueryData(breakdownQueryKey);

  useEffect(function() {
    setDeferredFetchReady(hasCachedBreakdown);
    if (!hasCachedBreakdown) setShowInsightsPanelsReady(false);
  }, [deferredQueryKey, hasCachedBreakdown]);

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
  var summaryQuery = useQuery({
    queryKey: summaryQueryKey,
    queryFn: function() {
      return fetchOperationsSummary(productionDataFetchRange.start, productionDataFetchRange.end);
    },
    staleTime: OPERATIONS_PRIMARY_STALE_MS
  });

  useEffect(function() {
    if (!summaryQuery.data) return;
    if (deferredFetchReady) return;
    return scheduleAfterPaint(function() {
      setDeferredFetchReady(true);
    });
  }, [summaryQuery.data, deferredFetchReady, deferredQueryKey]);

  var breakdownQuery = useQuery({
    queryKey: breakdownQueryKey,
    queryFn: function() {
      return fetchOperationsBreakdown(productionDataFetchRange.start, productionDataFetchRange.end);
    },
    enabled: deferredFetchReady,
    staleTime: OPERATIONS_PRIMARY_STALE_MS
  });
  var forecastQuery = useQuery({
    queryKey: forecastQueryKey,
    queryFn: function() {
      return fetchOperationsForecastPlans(forecastPlanMonths);
    },
    enabled: deferredFetchReady && forecastPlanMonths.length > 0,
    staleTime: OPERATIONS_SUPPORTING_STALE_MS
  });
  var configQuery = useQuery({
    queryKey: configQueryKey,
    queryFn: fetchOperationsConfig,
    enabled: deferredFetchReady,
    staleTime: OPERATIONS_SUPPORTING_STALE_MS
  });
  var laborSummaryQuery = useQuery({
    queryKey: laborSummaryQueryKey,
    queryFn: function() {
      return fetchOperationsLaborSummary(productionDataFetchRange.start, productionDataFetchRange.end);
    },
    enabled: deferredFetchReady,
    staleTime: OPERATIONS_PRIMARY_STALE_MS
  });
  var laborSummarySettled = !!queryClient.getQueryData(laborSummaryQueryKey)
    || laborSummaryQuery.status === "success"
    || laborSummaryQuery.status === "error";
  var laborDetailQuery = useQuery({
    queryKey: laborDetailQueryKey,
    queryFn: function() {
      return fetchOperationsLaborDetail(productionDataFetchRange.start, productionDataFetchRange.end);
    },
    enabled: deferredFetchReady && laborSummarySettled,
    staleTime: OPERATIONS_PRIMARY_STALE_MS
  });

  var serverPayload = breakdownQuery.data || summaryQuery.data || null;
  var trends = serverPayload && serverPayload.trends ? serverPayload.trends : null;
  var breakdown = breakdownQuery.data && breakdownQuery.data.breakdown
    ? breakdownQuery.data.breakdown
    : (serverPayload && serverPayload.breakdown ? serverPayload.breakdown : EMPTY_BREAKDOWN);
  var forecastPlans = forecastPlanMonths.length ? (forecastQuery.data || {}) : {};
  var configPayload = configQuery.data || {};
  var opsSkuTargets = Array.isArray(configPayload.skuTargets) ? configPayload.skuTargets : [];
  var itemMasterCostBySku = configPayload.itemMasterCostBySku && typeof configPayload.itemMasterCostBySku === "object"
    ? configPayload.itemMasterCostBySku
    : {};
  var laborActuals = useMemo(function() {
    if (laborDetailQuery.data) return laborDetailQuery.data;
    if (laborSummaryQuery.data) {
      return withLaborActualsStatus(laborSummaryQuery.data, laborDetailQuery.isError ? "error" : "loading");
    }
    if (laborDetailQuery.isError) return createEmptyLaborActuals("error", "error");
    if (deferredFetchReady) return createEmptyLaborActuals("loading", "loading");
    return createEmptyLaborActuals("idle", "ok");
  }, [laborDetailQuery.data, laborDetailQuery.isError, laborSummaryQuery.data, deferredFetchReady]);
  var loading = !serverPayload && summaryQuery.isPending;
  var err = !serverPayload && summaryQuery.isError
    ? (summaryQuery.error && summaryQuery.error.message ? summaryQuery.error.message : "Failed loading Operations data")
    : "";
  var deferredLoading = {
    detail: !breakdownQuery.data && (!deferredFetchReady || breakdownQuery.isPending),
    forecast: forecastPlanMonths.length > 0 && !forecastQuery.data && (!deferredFetchReady || forecastQuery.isPending),
    config: !configQuery.data && (!deferredFetchReady || configQuery.isPending),
    labor: !laborDetailQuery.data && (!deferredFetchReady || !laborSummarySettled || laborDetailQuery.isPending)
  };
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
    if (!showInsightsPanelsReady) {
      return { shiftRows: [], jobRows: [], totalRows: 0, rowsWithShift: 0 };
    }
    var rows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    var byShiftDay = {};
    var byJob = {};
    var productionRunsByKey = {};
    var knownLinesByBaseJobKey = {};
    var totalRows = rows.length;
    var rowsWithShift = 0;

    rows.forEach(function(r) {
      var date = String(r && r.produced_date_et || "");
      var shift = String(r && r.shift_label || "Unassigned");
      var units = safeNum(r && r.units_produced);
      if (!(units > 0) || !date) return;
      var jobId = String(r && r.job_id || "").trim() || "Unknown Job";
      var workOrder = String(r && r.work_order_code || "").trim();
      var itemCode = String(r && r.item_code || "").trim();
      var line = String(r && r.line || "Unknown").trim() || "Unknown";
      if (!line || line === "Unknown") return;
      var baseJobKey = [date, shift, jobId, workOrder, itemCode].join("|");
      if (!knownLinesByBaseJobKey[baseJobKey]) knownLinesByBaseJobKey[baseJobKey] = {};
      knownLinesByBaseJobKey[baseJobKey][line] = (knownLinesByBaseJobKey[baseJobKey][line] || 0) + units;
    });

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
      var rawLine = String(r && r.line || "Unknown").trim() || "Unknown";
      var baseJobKey = [date, shift, jobId, workOrder, itemCode].join("|");
      var knownLineMap = knownLinesByBaseJobKey[baseJobKey] || null;
      var knownLines = knownLineMap ? Object.keys(knownLineMap) : [];
      var line = rawLine;
      if ((!line || line === "Unknown") && knownLines.length === 1) {
        line = knownLines[0];
      }
      var producedAtUtc = String(r && r.produced_at_utc || "").trim();
      var jobStartAtUtc = String(r && r.job_start_at_utc || "").trim();
      var jobEndAtUtc = String(r && (r.job_end_at_utc || r.produced_at_utc) || "").trim();
      var productionRunKey = productionJobKey({
        produced_date_et: date,
        job_id: jobId,
        work_order_code: workOrder,
        line: line,
        item_code: itemCode
      });
      if (!productionRunsByKey[productionRunKey]) {
        productionRunsByKey[productionRunKey] = {
          key: productionRunKey,
          jobStartAtUtc: "",
          jobEndAtUtc: "",
          firstProducedAtUtc: "",
          lastProducedAtUtc: ""
        };
      }
      if (jobStartAtUtc && (!productionRunsByKey[productionRunKey].jobStartAtUtc || jobStartAtUtc < productionRunsByKey[productionRunKey].jobStartAtUtc)) {
        productionRunsByKey[productionRunKey].jobStartAtUtc = jobStartAtUtc;
      }
      if (jobEndAtUtc && (!productionRunsByKey[productionRunKey].jobEndAtUtc || jobEndAtUtc > productionRunsByKey[productionRunKey].jobEndAtUtc)) {
        productionRunsByKey[productionRunKey].jobEndAtUtc = jobEndAtUtc;
      }
      if (producedAtUtc && (!productionRunsByKey[productionRunKey].firstProducedAtUtc || producedAtUtc < productionRunsByKey[productionRunKey].firstProducedAtUtc)) {
        productionRunsByKey[productionRunKey].firstProducedAtUtc = producedAtUtc;
      }
      if (producedAtUtc && (!productionRunsByKey[productionRunKey].lastProducedAtUtc || producedAtUtc > productionRunsByKey[productionRunKey].lastProducedAtUtc)) {
        productionRunsByKey[productionRunKey].lastProducedAtUtc = producedAtUtc;
      }

      var jobKey = [date, shift, jobId, workOrder, line, itemCode].join("|");
      if (!byJob[jobKey]) {
        byJob[jobKey] = {
          date: date,
          shift: shift,
          jobId: jobId,
          workOrder: workOrder || "--",
          line: line,
          itemCode: itemCode || "--",
          itemDesc: itemDesc || "--",
          unitsProduced: 0,
          firstProducedAtUtc: "",
          lastProducedAtUtc: "",
          productionRunKey: productionRunKey
        };
      }
      byJob[jobKey].unitsProduced += units;
      if (producedAtUtc && (!byJob[jobKey].firstProducedAtUtc || producedAtUtc < byJob[jobKey].firstProducedAtUtc)) byJob[jobKey].firstProducedAtUtc = producedAtUtc;
      if (producedAtUtc && (!byJob[jobKey].lastProducedAtUtc || producedAtUtc > byJob[jobKey].lastProducedAtUtc)) byJob[jobKey].lastProducedAtUtc = producedAtUtc;
      if ((!byJob[jobKey].itemDesc || byJob[jobKey].itemDesc === "--") && itemDesc) byJob[jobKey].itemDesc = itemDesc;
      if ((!byJob[jobKey].line || byJob[jobKey].line === "Unknown") && line) byJob[jobKey].line = line;
    });

    Object.keys(productionRunsByKey).forEach(function(key) {
      var run = productionRunsByKey[key];
      var measured = measureProductionWindow(run.jobStartAtUtc, run.jobEndAtUtc, run.firstProducedAtUtc, run.lastProducedAtUtc);
      productionRunsByKey[key] = Object.assign({}, run, measured);
    });

    return {
      shiftRows: Object.values(byShiftDay).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return String(a.shift || "").localeCompare(String(b.shift || ""));
      }),
      jobRows: Object.values(byJob).map(function(row) {
        var productionRun = productionRunsByKey[row.productionRunKey] || null;
        var actualBucketMinutes = productionRun && productionRun.hasActualWindow
          ? (
            row.shift === "Unassigned"
              ? safeNum(productionRun.productionMinutes)
              : actualWindowMinutesForShiftBucket(row.date, row.shift, productionRun.jobStartAtUtc, productionRun.jobEndAtUtc)
          )
          : 0;
        var observedBucketMinutes = clampProductionMinutes(elapsedMinutesBetween(row.firstProducedAtUtc, row.lastProducedAtUtc));
        var hasActualBucketWindow = actualBucketMinutes > 0;
        var hasObservedBucketSpan = !hasActualBucketWindow && observedBucketMinutes > 0;
        var productionMinutes = hasActualBucketWindow
          ? actualBucketMinutes
          : (hasObservedBucketSpan ? observedBucketMinutes : 0);
        return Object.assign({}, row, {
          jobStartAtUtc: productionRun && productionRun.jobStartAtUtc ? productionRun.jobStartAtUtc : null,
          jobEndAtUtc: productionRun && productionRun.jobEndAtUtc ? productionRun.jobEndAtUtc : null,
          firstProducedAtUtc: row.firstProducedAtUtc || null,
          lastProducedAtUtc: row.lastProducedAtUtc || null,
          productionMinutes: productionMinutes,
          casesPerProductionMinute: productionMinutes > 0 ? (safeNum(row.unitsProduced) / productionMinutes) : 0,
          productionMinutesSource: hasActualBucketWindow ? "actual_job_window" : (hasObservedBucketSpan ? "observed_fg_output_span" : "unavailable"),
          hasActualWindow: hasActualBucketWindow,
          hasObservedSpan: hasObservedBucketSpan
        });
      }).sort(function(a, b) {
        if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
        return safeNum(b.unitsProduced) - safeNum(a.unitsProduced);
      }),
      totalRows: totalRows,
      rowsWithShift: rowsWithShift
    };
  }, [effectiveBreakdown, showInsightsPanelsReady]);

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
    var productionDayStatus = productionDayStatusET(new Date());
    var today = productionDayStatus && productionDayStatus.calendarDate
      ? productionDayStatus.calendarDate
      : toIsoDateET(new Date());
    var projectionReferenceDate = productionDayStatus && productionDayStatus.productionDate
      ? productionDayStatus.productionDate
      : today;
    var productionDates = allByDay.map(function(d) { return String(d.date || ""); }).filter(Boolean).sort();
    var eligibleProductionDates = productionDates.filter(function(date) {
      return date <= projectionReferenceDate;
    });
    var latestEligibleProductionDate = eligibleProductionDates[eligibleProductionDates.length - 1] || "";
    var latestCompletedProductionDate = latestEligibleProductionDate;
    if (productionDayStatus && productionDayStatus.inProgress && latestEligibleProductionDate === projectionReferenceDate) {
      latestCompletedProductionDate = eligibleProductionDates[eligibleProductionDates.length - 2] || "";
    }
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
    var projectionStartDate = projectionReferenceDate;
    if (monthAnchor) {
      var nextProjectionDay = shiftDays(monthAnchor, 1);
      projectionStartDate = nextProjectionDay > projectionReferenceDate ? nextProjectionDay : projectionReferenceDate;
    }
    var remainingBusinessDays = businessDaysBetween(projectionStartDate, monthEnd(projectionReferenceDate));
    var paceRemainingUnits = trailingDailyVelocity * remainingBusinessDays;
    var queueSeen = {};
    var runnableQueueRemainingUnits = (Array.isArray(dispatchQueue) ? dispatchQueue : []).reduce(function(sum, row) {
      var woNum = String(row && row.woNum || "");
      if (!woNum || queueSeen[woNum]) return sum;
      queueSeen[woNum] = true;
      var action = String(row && row.action || "");
      var netUnits = Math.max(0, safeNum(row && row.netUnits));
      if (!(netUnits > 0) || action === "Hold / Replenish") return sum;
      return sum + netUnits;
    }, 0);
    var remainingProjectedUnits = paceRemainingUnits;
    var monthlyRunRateCapped = false;
    if (runnableQueueRemainingUnits > 0 && runnableQueueRemainingUnits < paceRemainingUnits) {
      remainingProjectedUnits = runnableQueueRemainingUnits;
      monthlyRunRateCapped = true;
    }
    var monthlyRunRate = monthActualUnits + remainingProjectedUnits;
    var selectedPlanInfo = forecastPlanForRange(effectiveRange, avgDailyUnits);
    var selectedPlanUnits = selectedPlanInfo.units;
    var forecastDeltaUnits = totalUnits - selectedPlanUnits;
    var forecastDeltaPct = selectedPlanUnits > 0 ? Math.round((forecastDeltaUnits / selectedPlanUnits) * 100) : 0;

    return {
      totalUnits: totalUnits,
      avgDailyUnits: avgDailyUnits,
      latestProductionDate: monthAnchor || latestEligibleProductionDate,
      trailingProductionDays: trailingProductionDays.length,
      trailingDailyVelocity: trailingDailyVelocity,
      weeklyRunRate: weeklyRunRate,
      monthlyRunRate: monthlyRunRate,
      monthlyRunRateCapped: monthlyRunRateCapped,
      monthBusinessDays: monthBusinessDays,
      monthActualUnits: monthActualUnits,
      remainingBusinessDays: remainingBusinessDays,
      remainingProjectedUnits: remainingProjectedUnits,
      remainingPaceUnits: paceRemainingUnits,
      runnableQueueRemainingUnits: runnableQueueRemainingUnits,
      selectedPlanUnits: selectedPlanUnits,
      selectedPlanSource: selectedPlanInfo.source,
      forecastDeltaUnits: forecastDeltaUnits,
      forecastDeltaPct: forecastDeltaPct,
      byShift: byShift,
    };
  }, [effectiveTrends, filteredTrends, filteredBreakdown, effectiveRange, dispatchQueue]);

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

  var openBookedWorkOrderTotal = useMemo(function() {
    return (Array.isArray(workOrders) ? workOrders : []).reduce(function(sum, wo) {
      var status = normalizeStr(wo && wo.status || "");
      if (status !== "booked" || statusLooksClosed(status)) return sum;
      var qtyToProduce = safeNum(wo && wo.qtyToProduce);
      var unitsRemaining = safeNum(wo && wo.unitsRemaining);
      if (!(unitsRemaining > 0)) {
        unitsRemaining = Math.max(0, qtyToProduce - safeNum(wo && wo.unitsProduced));
      }
      if (!(unitsRemaining > 0)) return sum;
      return sum + qtyToProduce;
    }, 0);
  }, [workOrders]);

  var monthEndBookedWorkOrderComparison = useMemo(function() {
    var openBookedTotal = safeNum(openBookedWorkOrderTotal);
    if (!(openBookedTotal > 0)) return null;
    var projectedMonthEndYield = safeNum(metrics.monthlyRunRate);
    var delta = projectedMonthEndYield - openBookedTotal;
    return {
      compareActual: openBookedTotal,
      compareReferenceLabel: "Open booked WOs",
      compareReferenceUnits: openBookedTotal,
      displayDelta: delta,
      displayDeltaPct: Math.round((delta / openBookedTotal) * 100),
      displayLabel: "vs open booked WO total",
      compareLabel: "vs open booked WO total",
      capNote: metrics.monthlyRunRateCapped ? "capped by runnable Run Next queue" : ""
    };
  }, [openBookedWorkOrderTotal, metrics.monthlyRunRate, metrics.monthlyRunRateCapped]);

  var weeklyBookedWorkOrderComparison = useMemo(function() {
    var openBookedTotal = safeNum(openBookedWorkOrderTotal);
    var remainingBusinessDays = safeNum(metrics.remainingBusinessDays);
    if (!(openBookedTotal > 0) || !(remainingBusinessDays > 0)) return null;
    var availableWeeks = remainingBusinessDays / 5;
    if (!(availableWeeks > 0)) return null;
    var requiredWeeklyPace = Math.round(openBookedTotal / availableWeeks);
    var projectedWeeklyRunRate = safeNum(metrics.weeklyRunRate);
    var delta = projectedWeeklyRunRate - requiredWeeklyPace;
    return {
      compareActual: requiredWeeklyPace,
      compareReferenceLabel: "Booked weekly pace",
      compareReferenceUnits: requiredWeeklyPace,
      displayDelta: delta,
      displayDeltaPct: Math.round((delta / requiredWeeklyPace) * 100),
      displayLabel: "vs booked weekly pace",
      compareLabel: "vs booked weekly pace",
      availableWeeks: availableWeeks
    };
  }, [openBookedWorkOrderTotal, metrics.weeklyRunRate, metrics.remainingBusinessDays]);

  var shiftPlanVsActual = useMemo(function() {
    if (!showInsightsPanelsReady) return { rows: [], max: 1 };
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
  }, [filteredBreakdown.rowsLite, filteredTrends.byShift, effectiveBreakdown, effectiveTrends, range.start, metrics.avgDailyUnits, forecastPlans, showInsightsPanelsReady]);

  var dailyPlanVsActual = useMemo(function() {
    if (!showInsightsPanelsReady) return { rows: [], lineSeries: [] };
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
  }, [filteredBreakdown.rowsLite, filteredTrends.byDay, effectiveBreakdown, effectiveTrends, range.start, metrics.avgDailyUnits, forecastPlans, showInsightsPanelsReady]);

  var lineScoreboard = useMemo(function() {
    var compareInfo = comparableRangeForPreset(windowPreset, effectiveRange);
    if (!showInsightsPanelsReady || !showProductionLines) {
      return {
        rows: [],
        totalUnits: 0,
        priorTotal: 0,
        compareLabel: compareInfo.label,
        leader: null,
        biggestUp: null,
        biggestDown: null
      };
    }
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
  }, [effectiveBreakdown, effectiveRange, windowPreset, showInsightsPanelsReady, showProductionLines]);

  var productionJobLeaderboard = useMemo(function() {
    if (!showInsightsPanelsReady) {
      return {
        minCases: 250,
        qualifiedCount: 0,
        source: "",
        actualWindowCount: 0,
        observedSpanCount: 0,
        best: [],
        worst: []
      };
    }
    var leaderboardMinCases = 250;
    var serverRows = (filteredBreakdown && Array.isArray(filteredBreakdown.rowsLite)) ? filteredBreakdown.rowsLite : [];
    var rawRows = (localNulogySeries && localNulogySeries.breakdown && Array.isArray(localNulogySeries.breakdown.rowsLite))
      ? localNulogySeries.breakdown.rowsLite.filter(function(row) {
          return inRangeIso(String(row && row.produced_date_et || ""), effectiveRange);
        })
      : [];
    var sourceRows = serverRows.length ? serverRows : rawRows;
    var windowByKey = {};
    var collectWindow = function(row, sourceLabel) {
      var key = productionJobKey(row);
      var startAtUtc = String(row && row.job_start_at_utc || "").trim();
      var endAtUtc = String(row && (row.job_end_at_utc || row.produced_at_utc) || "").trim();
      if (!startAtUtc && !endAtUtc) return;
      if (!windowByKey[key]) {
        windowByKey[key] = {
          startAtUtc: "",
          endAtUtc: "",
          hasActualStart: false,
          source: ""
        };
      }
      if (startAtUtc) {
        windowByKey[key].hasActualStart = true;
        if (!windowByKey[key].source || windowByKey[key].source !== "server") windowByKey[key].source = sourceLabel;
        if (!windowByKey[key].startAtUtc || startAtUtc < windowByKey[key].startAtUtc) windowByKey[key].startAtUtc = startAtUtc;
      }
      if (endAtUtc && (!windowByKey[key].endAtUtc || endAtUtc > windowByKey[key].endAtUtc)) {
        windowByKey[key].endAtUtc = endAtUtc;
      }
    };
    serverRows.forEach(function(row) { collectWindow(row, "server"); });
    rawRows.forEach(function(row) { collectWindow(row, "raw"); });
    var grouped = {};

    sourceRows.forEach(function(row) {
      var date = String(row && row.produced_date_et || "");
      if (!date) return;
      var jobId = String(row && row.job_id || "").trim();
      var workOrder = String(row && row.work_order_code || "").trim();
      var line = String(row && row.line || "Unknown").trim() || "Unknown";
      var itemCode = String(row && row.item_code || "").trim();
      var itemDescription = formatDescriptionForDisplay(row && row.item_desc) || "";
      var key = productionJobKey(row);
      var window = windowByKey[key] || null;
      if (!grouped[key]) {
        grouped[key] = {
          key: key,
          date: date,
          jobId: jobId || "--",
          workOrder: workOrder || "--",
          line: line,
          itemCode: itemCode || "--",
          itemDescription: itemDescription || "--",
          casesProduced: 0,
          shiftSlots: {},
          jobStartAtUtc: "",
          jobEndAtUtc: "",
          firstProducedAtUtc: "",
          lastProducedAtUtc: "",
          windowSource: window && window.hasActualStart ? window.source : ""
        };
      }
      grouped[key].casesProduced += safeNum(row && row.units_produced);
      grouped[key].shiftSlots[normalizeProductionShiftBucket(row && row.shift_label)] = true;
      var producedAtUtc = String(row && row.produced_at_utc || "").trim();
      if (window && window.startAtUtc && (!grouped[key].jobStartAtUtc || window.startAtUtc < grouped[key].jobStartAtUtc)) grouped[key].jobStartAtUtc = window.startAtUtc;
      if (window && window.endAtUtc && (!grouped[key].jobEndAtUtc || window.endAtUtc > grouped[key].jobEndAtUtc)) grouped[key].jobEndAtUtc = window.endAtUtc;
      if (producedAtUtc && (!grouped[key].firstProducedAtUtc || producedAtUtc < grouped[key].firstProducedAtUtc)) grouped[key].firstProducedAtUtc = producedAtUtc;
      if (producedAtUtc && (!grouped[key].lastProducedAtUtc || producedAtUtc > grouped[key].lastProducedAtUtc)) grouped[key].lastProducedAtUtc = producedAtUtc;
      if (grouped[key].itemDescription === "--" && itemDescription) grouped[key].itemDescription = itemDescription;
    });

    var ranked = Object.values(grouped)
      .map(function(row) {
        var casesProduced = safeNum(row.casesProduced);
        var measured = measureProductionWindow(row.jobStartAtUtc, row.jobEndAtUtc, row.firstProducedAtUtc, row.lastProducedAtUtc);
        var hasActualWindow = measured.hasActualWindow;
        var hasObservedSpan = measured.hasObservedSpan;
        var productionMinutes = measured.productionMinutes;
        return Object.assign({}, row, {
          productionMinutes: productionMinutes,
          hasActualWindow: hasActualWindow,
          hasObservedSpan: hasObservedSpan,
          spanSource: hasActualWindow ? "actual_job_window" : (hasObservedSpan ? "observed_fg_output_span" : "unavailable"),
          windowLabel: hasActualWindow
            ? ("Actual Nulogy Job Window: " + formatTimeEt(row.jobStartAtUtc) + " - " + formatTimeEt(row.jobEndAtUtc))
            : (hasObservedSpan
              ? ("Observed FG Output Span: " + formatTimeEt(row.firstProducedAtUtc) + " - " + formatTimeEt(row.lastProducedAtUtc))
              : "Observed FG Output Span unavailable"),
          casesPerProductionMinute: productionMinutes > 0 ? (casesProduced / productionMinutes) : 0
        });
      })
      .filter(function(row) {
        return row.casesProduced >= leaderboardMinCases && row.productionMinutes > 0;
      });
    var actualWindowCount = ranked.filter(function(row) { return row.hasActualWindow; }).length;
    var observedSpanCount = ranked.filter(function(row) { return row.hasObservedSpan; }).length;
    var actualWindowSource = actualWindowCount
      ? (ranked.some(function(row) { return row.hasActualWindow && row.windowSource === "server"; }) ? "server" : "raw")
      : "";

    var maxCasesProduced = ranked.reduce(function(max, row) {
      return Math.max(max, safeNum(row.casesProduced));
    }, 0) || 1;
    var maxCasesPerProductionMinute = ranked.reduce(function(max, row) {
      return Math.max(max, safeNum(row.casesPerProductionMinute));
    }, 0) || 1;

    ranked = ranked.map(function(row) {
      var yieldScore = safeNum(row.casesProduced) / maxCasesProduced;
      var speedScore = safeNum(row.casesPerProductionMinute) / maxCasesPerProductionMinute;
      return Object.assign({}, row, {
        leaderboardScore: (yieldScore * 0.75) + (speedScore * 0.25)
      });
    });

    var byBest = ranked.slice().sort(function(a, b) {
      if (safeNum(b.leaderboardScore) !== safeNum(a.leaderboardScore)) {
        return safeNum(b.leaderboardScore) - safeNum(a.leaderboardScore);
      }
      if (safeNum(b.casesProduced) !== safeNum(a.casesProduced)) return safeNum(b.casesProduced) - safeNum(a.casesProduced);
      if (safeNum(b.casesPerProductionMinute) !== safeNum(a.casesPerProductionMinute)) {
        return safeNum(b.casesPerProductionMinute) - safeNum(a.casesPerProductionMinute);
      }
      return safeNum(a.laborCostPerCase) - safeNum(b.laborCostPerCase);
    });
    var byWorst = ranked.slice().sort(function(a, b) {
      if (safeNum(a.leaderboardScore) !== safeNum(b.leaderboardScore)) {
        return safeNum(a.leaderboardScore) - safeNum(b.leaderboardScore);
      }
      if (safeNum(a.casesPerProductionMinute) !== safeNum(b.casesPerProductionMinute)) {
        return safeNum(a.casesPerProductionMinute) - safeNum(b.casesPerProductionMinute);
      }
      return safeNum(a.casesProduced) - safeNum(b.casesProduced);
    });

    return {
      minCases: leaderboardMinCases,
      qualifiedCount: ranked.length,
      source: actualWindowSource,
      actualWindowCount: actualWindowCount,
      observedSpanCount: observedSpanCount,
      best: byBest.slice(0, 5),
      worst: byWorst.slice(0, 5)
    };
  }, [localNulogySeries, filteredBreakdown, effectiveRange, showInsightsPanelsReady]);

  var skuMixByDay = useMemo(function() {
    if (!showInsightsPanelsReady) return { rows: [], series: [] };
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
  }, [filteredBreakdown, skuMixMode, showInsightsPanelsReady]);

  const skuMixChartConfig = useMemo(function() {
    var cfg = {};
    (skuMixByDay.series || []).forEach(function(s) {
      cfg[s.key] = { label: s.label, color: s.color };
    });
    return cfg;
  }, [skuMixByDay.series]);

  var evoconInsights = useMemo(function() {
    var compareInfo = comparableRangeForPreset(windowPreset, range);
    if (!showInsightsPanelsReady || !showLossPriorities) {
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
  }, [evoconData, range, windowPreset, showInsightsPanelsReady, showLossPriorities]);

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
      labor: { label: "Labor Cost", color: OPERATIONS_ECONOMICS_COLORS.labor },
      margin: { label: "Labor Margin", color: OPERATIONS_ECONOMICS_COLORS.margin }
    };
  }, []);

  const dailyEconomicsRows = useMemo(function() {
    if (!showInsightsPanelsReady) return [];
    var dayMap = {};
    var trendDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    trendDays.forEach(function(row) {
      var date = String(row && row.date || "");
      if (!date) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0, margin: 0 };
      dayMap[date].cases += safeNum(row && row.units);
    });
    var breakdownRows = (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite)) ? effectiveBreakdown.rowsLite : [];
    breakdownRows.forEach(function(row) {
      var date = String(row && row.produced_date_et || "");
      var itemCode = String(row && row.item_code || "");
      var units = safeNum(row && row.units_produced);
      if (!date || !(units > 0)) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0, margin: 0 };
      var revenueMatch = revenuePerCaseForRow(itemCode, date);
      var revenuePerCase = safeNum(revenueMatch && revenueMatch.value);
      if (revenuePerCase > 0) dayMap[date].revenue += units * revenuePerCase;
    });
    var laborByDay = (laborActuals && Array.isArray(laborActuals.byDay)) ? laborActuals.byDay : [];
    laborByDay.forEach(function(row) {
      var date = String(row && row.date_et || "");
      if (!date) return;
      if (!dayMap[date]) dayMap[date] = { date: date, cases: 0, revenue: 0, labor: 0, margin: 0 };
      dayMap[date].labor += safeNum(row && row.labor_cost);
    });
    return eachDayIsoBetween(dailyPerfRange.start, dailyPerfRange.end).map(function(date) {
      var row = dayMap[date] || { date: date, cases: 0, revenue: 0, labor: 0, margin: 0 };
      return Object.assign({}, row, { margin: safeNum(row.revenue) - safeNum(row.labor) });
    });
  }, [effectiveTrends, effectiveBreakdown, laborActuals, revenuePerCaseForRow, dailyPerfRange.start, dailyPerfRange.end, showInsightsPanelsReady]);

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
      var suffix = card.capNote ? (" · " + String(card.capNote)) : "";
      var stateLabel = delta > 0 ? "Ahead" : delta < 0 ? "Behind" : "Flat";
      if (card.paceProjectedUnits != null) {
        return "Pacing " + safeNum(card.paceProjectedUnits).toLocaleString() + " · " + stateLabel + " " + prefix + delta.toLocaleString() + pctText + " " + label + suffix;
      }
      return stateLabel + " " + prefix + delta.toLocaleString() + pctText + " " + label + suffix;
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
        subnote: weeklyBookedWorkOrderComparison
          ? ("Booked weekly pace " + safeNum(weeklyBookedWorkOrderComparison.compareReferenceUnits).toLocaleString() + " · " + (Math.round(safeNum(weeklyBookedWorkOrderComparison.availableWeeks) * 10) / 10).toLocaleString() + " weeks left")
          : "",
        detail: weeklyBookedWorkOrderComparison
          ? compareText(weeklyBookedWorkOrderComparison)
          : "Current weekly yield pace",
        tone: weeklyBookedWorkOrderComparison
          ? compareTone(weeklyBookedWorkOrderComparison)
          : "text-[rgb(var(--muted))]"
      },
      {
        key: "month_end",
        label: "Month-End Yield",
        value: safeNum(metrics.monthlyRunRate).toLocaleString(),
        note: safeNum(metrics.remainingBusinessDays).toLocaleString() + " business days remaining",
        subnote: monthEndBookedWorkOrderComparison
          ? referenceNote("Open booked WOs", { latestUnits: safeNum(monthEndBookedWorkOrderComparison.compareReferenceUnits) })
          : "",
        detail: monthEndBookedWorkOrderComparison
          ? compareText(monthEndBookedWorkOrderComparison)
          : "Projected month-end yield",
        tone: monthEndBookedWorkOrderComparison
          ? compareTone(monthEndBookedWorkOrderComparison)
          : "text-[rgb(var(--muted))]"
      }
    ];
  }, [commandBoard, metrics, weeklyBookedWorkOrderComparison, monthEndBookedWorkOrderComparison]);

  var hasCriticalOperationsData = (effectiveTrends && Array.isArray(effectiveTrends.byDay) && effectiveTrends.byDay.length > 0)
    || (effectiveBreakdown && Array.isArray(effectiveBreakdown.rowsLite) && effectiveBreakdown.rowsLite.length > 0);
  var detailReadyForInsights = !deferredLoading.detail;
  var isDeferredLoading = !!(deferredLoading.detail || deferredLoading.forecast || deferredLoading.config || deferredLoading.labor);
  var showProductionJobsLoading = deferredLoading.labor && laborActuals.status === "loading";
  var showProductionJobsError = laborActuals.status === "error" && !showProductionJobsLoading;

  useEffect(function() {
    if (showInsightsPanelsReady || !hasCriticalOperationsData || !detailReadyForInsights) return;
    var cancelled = false;
    var cancel = scheduleAfterPaint(function() {
      importOperationsInsightsPanel().catch(function() {});
      if (!cancelled) setShowInsightsPanelsReady(true);
    });
    return function() {
      cancelled = true;
      cancel();
    };
  }, [showInsightsPanelsReady, hasCriticalOperationsData, detailReadyForInsights]);

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
            {isDeferredLoading ? <div className="text-xs text-[rgb(var(--muted))]">Loading production detail, labor, forecast, and cost overlays...</div> : null}
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

      {!showInsightsPanelsReady ? (
        <Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">
          {deferredLoading.detail ? "Loading detailed production rows for jobs and charts..." : "Preparing production jobs and charts..."}
        </Card>
      ) : (
        <Suspense fallback={<Card className="px-4 py-4 text-sm text-[rgb(var(--muted))]">Loading production jobs and charts...</Card>}>
          <OperationsInsightsPanel
            laborActuals={laborActuals}
            showProductionJobsLoading={showProductionJobsLoading}
            showProductionJobsError={showProductionJobsError}
            serverProductionSegments={serverProductionSegments}
            setProductionJobsRequestedRange={setProductionJobsRequestedRange}
            revenuePerCaseForRow={revenuePerCaseForRow}
            dailyPerfRange={dailyPerfRange}
            setDailyPerfStart={setDailyPerfStart}
            setDailyPerfEnd={setDailyPerfEnd}
            dailyEconomicsRows={dailyEconomicsRows}
            dailyEconomicsChartConfig={dailyEconomicsChartConfig}
            dailyPlanVsActual={dailyPlanVsActual}
            dailyChartConfig={dailyChartConfig}
            shiftPlanVsActual={shiftPlanVsActual}
            shiftChartConfig={shiftChartConfig}
            skuMixMode={skuMixMode}
            setSkuMixMode={setSkuMixMode}
            skuMixByDay={skuMixByDay}
            skuMixChartConfig={skuMixChartConfig}
            productionJobLeaderboard={productionJobLeaderboard}
            showProductionLines={showProductionLines}
            setShowProductionLines={setShowProductionLines}
            lineScoreboard={lineScoreboard}
            showLossPriorities={showLossPriorities}
            setShowLossPriorities={setShowLossPriorities}
            evoconInsights={evoconInsights}
          />
        </Suspense>
      )}

    </div>
  );
}
