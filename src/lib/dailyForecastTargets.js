import { safeNum } from "../utils.js";

export function monthRange(monthKey) {
  var s = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return { start: "", end: "" };
  var year = Number(s.slice(0, 4));
  var month = Number(s.slice(5, 7));
  var start = s + "-01";
  var endDate = new Date(Date.UTC(year, month, 0));
  var end = endDate.toISOString().slice(0, 10);
  return { start: start, end: end };
}

export function shiftIsoDay(dateIso, days) {
  var s = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  var d = new Date(s + "T00:00:00Z");
  if (isNaN(d)) return "";
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function eachIsoDayBetween(startIso, endIso) {
  var start = String(startIso || "").slice(0, 10);
  var end = String(endIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
  var s = new Date(start + "T00:00:00Z");
  var e = new Date(end + "T00:00:00Z");
  if (isNaN(s) || isNaN(e) || e < s) return [];
  var out = [];
  for (var d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function isBusinessDay(dateIso) {
  var s = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var d = new Date(s + "T00:00:00Z");
  if (isNaN(d)) return false;
  var dow = d.getUTCDay();
  return dow !== 0 && dow !== 6;
}

function toEasternDateTimeParts(value) {
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return null;
  var out = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d).forEach(function(part) {
    if (part.type !== "literal") out[part.type] = part.value;
  });
  if (!out.year || !out.month || !out.day || !out.hour || !out.minute) return null;
  return {
    date: out.year + "-" + out.month + "-" + out.day,
    hour: parseInt(out.hour, 10),
    minute: parseInt(out.minute, 10)
  };
}

var PRODUCTION_DAY_START_MINUTES = 7 * 60;
var PRODUCTION_DAY_END_MINUTES = 23 * 60;
var DAILY_TARGET_HISTORY_WINDOW_DAYS = 42;
var DAILY_TARGET_MIN_WEEKDAY_SAMPLES = 2;
var DAILY_TARGET_WEEKDAY_RATIO_MIN = 0.9;
var DAILY_TARGET_WEEKDAY_RATIO_MAX = 1.1;

export function productionDayStatusET(value) {
  var parts = toEasternDateTimeParts(value);
  if (!parts) return null;
  var totalMinutes = (safeNum(parts.hour) * 60) + safeNum(parts.minute);
  return {
    calendarDate: parts.date,
    productionDate: totalMinutes < PRODUCTION_DAY_START_MINUTES ? shiftIsoDay(parts.date, -1) : parts.date,
    inProgress: totalMinutes >= PRODUCTION_DAY_START_MINUTES && totalMinutes < PRODUCTION_DAY_END_MINUTES
  };
}

function normalizeProductionStatus(status, fallbackValue) {
  if (status && typeof status === "object") {
    var productionDate = String(status.productionDate || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(productionDate)) {
      return {
        productionDate: productionDate,
        inProgress: status.inProgress !== false
      };
    }
  }
  return productionDayStatusET(fallbackValue || new Date());
}

function clampNumber(value, minValue, maxValue) {
  var n = safeNum(value);
  if (n < minValue) return minValue;
  if (n > maxValue) return maxValue;
  return n;
}

export function buildProductionDrivenDailyTargets(options) {
  var input = options || {};
  var monthKey = String(input.monthKey || "").trim();
  var summary = input.summary && typeof input.summary === "object" ? input.summary : {};
  var actualByDay = input.actualByDay && typeof input.actualByDay === "object" ? input.actualByDay : {};
  var historyByDay = Array.isArray(input.historyByDay) ? input.historyByDay : [];
  var fallbackRows = Array.isArray(input.fallbackRows) ? input.fallbackRows : [];
  var range = monthRange(monthKey);
  var totalCases = safeNum(summary.total_cases);
  var totalRevenue = safeNum(summary.total_revenue);
  var totalLaborCost = safeNum(summary.total_labor_cost);
  var totalHeadcountHours = safeNum(summary.total_headcount_hours);
  var allDays = eachIsoDayBetween(range.start, range.end);
  if (!allDays.length || !(totalCases > 0)) {
    return {
      rows: fallbackRows,
      model: "forecast_schedule",
      actualLockedThrough: "",
      remainingForecastCases: 0,
      trailingDailyVelocity: 0,
      historyDaysUsed: 0
    };
  }
  if (!historyByDay.length) {
    return {
      rows: fallbackRows,
      model: "forecast_schedule",
      actualLockedThrough: "",
      remainingForecastCases: 0,
      trailingDailyVelocity: 0,
      historyDaysUsed: 0
    };
  }

  var productionStatus = normalizeProductionStatus(input.productionStatus, input.now);
  var currentProductionMonth = productionStatus && productionStatus.productionDate
    ? String(productionStatus.productionDate).slice(0, 7)
    : "";
  var isCurrentProductionMonth = currentProductionMonth === monthKey;
  var planningStart = range.start;
  var actualLockedThrough = "";
  if (isCurrentProductionMonth && productionStatus && productionStatus.productionDate) {
    planningStart = productionStatus.inProgress
      ? productionStatus.productionDate
      : shiftIsoDay(productionStatus.productionDate, 1);
    if (planningStart < range.start) planningStart = range.start;
    if (planningStart > range.end) planningStart = shiftIsoDay(range.end, 1);
    actualLockedThrough = shiftIsoDay(planningStart, -1);
  }

  var completedActualCases = 0;
  if (isCurrentProductionMonth && actualLockedThrough) {
    allDays.forEach(function(day) {
      if (day > actualLockedThrough) return;
      completedActualCases += safeNum(actualByDay[day] && actualByDay[day].actual_cases);
    });
  }
  var remainingForecastCases = isCurrentProductionMonth
    ? Math.max(0, totalCases - completedActualCases)
    : totalCases;

  var historyRows = historyByDay.slice().sort(function(a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  }).filter(function(row) {
    var day = String(row && row.date || "");
    if (!day || !range.start) return false;
    if (!(safeNum(row && row.units) > 0)) return false;
    return !planningStart || day < planningStart;
  });
  var recentRows = historyRows.slice(-DAILY_TARGET_HISTORY_WINDOW_DAYS);
  var trailingRows = historyRows.slice(-5);
  var trailingDailyVelocity = trailingRows.length
    ? Math.round(trailingRows.reduce(function(sum, row) { return sum + safeNum(row.units); }, 0) / trailingRows.length)
    : 0;
  var historyDaysUsed = recentRows.length;
  var weekdayUnits = {};
  var recentBusinessRows = [];
  recentRows.forEach(function(row) {
    var day = String(row && row.date || "");
    var d = new Date(day + "T00:00:00Z");
    if (isNaN(d)) return;
    var dow = d.getUTCDay();
    if (!weekdayUnits[dow]) weekdayUnits[dow] = [];
    weekdayUnits[dow].push(safeNum(row.units));
    if (isBusinessDay(day)) recentBusinessRows.push(row);
  });
  var overallBusinessAverage = recentBusinessRows.length
    ? recentBusinessRows.reduce(function(sum, row) { return sum + safeNum(row.units); }, 0) / recentBusinessRows.length
    : 0;
  var allocationDays = isCurrentProductionMonth
    ? allDays.filter(function(day) { return day >= planningStart; })
    : allDays.slice();
  var rawWeightByDay = {};
  var rawWeightTotal = 0;
  allocationDays.forEach(function(day) {
    var rawWeight = 0;
    if (isBusinessDay(day)) {
      rawWeight = 1;
      var dow = new Date(day + "T00:00:00Z").getUTCDay();
      var samples = weekdayUnits[dow] || [];
      if (samples.length >= DAILY_TARGET_MIN_WEEKDAY_SAMPLES && overallBusinessAverage > 0) {
        var weekdayAverage = samples.reduce(function(sum, units) { return sum + safeNum(units); }, 0) / samples.length;
        if (weekdayAverage > 0) {
          rawWeight = clampNumber(
            weekdayAverage / overallBusinessAverage,
            DAILY_TARGET_WEEKDAY_RATIO_MIN,
            DAILY_TARGET_WEEKDAY_RATIO_MAX
          );
        }
      }
    }
    rawWeightByDay[day] = rawWeight;
    rawWeightTotal += rawWeight;
  });
  if (!(rawWeightTotal > 0)) {
    rawWeightTotal = 0;
    allocationDays.forEach(function(day) {
      var fallbackWeight = 1;
      rawWeightByDay[day] = fallbackWeight;
      rawWeightTotal += fallbackWeight;
    });
  }

  var revenuePerCase = totalCases > 0 ? totalRevenue / totalCases : 0;
  var laborPerCase = totalCases > 0 ? totalLaborCost / totalCases : 0;
  var headcountHoursPerCase = totalCases > 0 ? totalHeadcountHours / totalCases : 0;
  var rows = allDays.map(function(day) {
    var plannedCases = 0;
    if (isCurrentProductionMonth && actualLockedThrough && day <= actualLockedThrough) {
      plannedCases = safeNum(actualByDay[day] && actualByDay[day].actual_cases);
    } else if (rawWeightByDay[day] > 0 && remainingForecastCases > 0 && rawWeightTotal > 0) {
      plannedCases = remainingForecastCases * (rawWeightByDay[day] / rawWeightTotal);
    }
    return {
      day_key: day,
      planned_cases: plannedCases,
      revenue: plannedCases * revenuePerCase,
      labor_cost: plannedCases * laborPerCase,
      headcount_hours: plannedCases * headcountHoursPerCase
    };
  });

  return {
    rows: rows,
    model: historyDaysUsed ? "production_history" : "forecast_schedule",
    actualLockedThrough: actualLockedThrough,
    remainingForecastCases: remainingForecastCases,
    trailingDailyVelocity: trailingDailyVelocity,
    historyDaysUsed: historyDaysUsed
  };
}
