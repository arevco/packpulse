import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "../theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { MonthPicker } from "../components/ui/month-picker";
import TableShell from "../components/ui/table-shell";
import { detectPackType, safeNum } from "../utils";

function fmtMoney(n) {
  var v = safeNum(n);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyWhole(n) {
  var v = safeNum(n);
  return "$" + Math.round(v).toLocaleString();
}

function fmtPct(n) {
  return (safeNum(n) * 100).toFixed(1) + "%";
}

function fmtPctWhole(n) {
  return Math.round(safeNum(n) * 100).toLocaleString() + "%";
}

function hasExplicitValue(value) {
  return value != null && String(value).trim() !== "";
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function monthRange(monthKey) {
  var s = String(monthKey || "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return { start: "", end: "" };
  var year = Number(s.slice(0, 4));
  var month = Number(s.slice(5, 7));
  var start = s + "-01";
  var endDate = new Date(Date.UTC(year, month, 0));
  var end = endDate.toISOString().slice(0, 10);
  return { start: start, end: end };
}

function shiftIsoDay(dateIso, days) {
  var s = String(dateIso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  var d = new Date(s + "T00:00:00Z");
  if (isNaN(d)) return "";
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function eachIsoDayBetween(startIso, endIso) {
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

function isBusinessDay(dateIso) {
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

function productionDayStatusET(value) {
  var parts = toEasternDateTimeParts(value);
  if (!parts) return null;
  var totalMinutes = (safeNum(parts.hour) * 60) + safeNum(parts.minute);
  return {
    calendarDate: parts.date,
    productionDate: totalMinutes < PRODUCTION_DAY_START_MINUTES ? shiftIsoDay(parts.date, -1) : parts.date,
    inProgress: totalMinutes >= PRODUCTION_DAY_START_MINUTES && totalMinutes < PRODUCTION_DAY_END_MINUTES
  };
}

function statusLooksClosed(status) {
  var s = String(status || "").toLowerCase();
  if (!s) return false;
  return s.indexOf("close") !== -1 || s.indexOf("complete") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("archive") !== -1 || s.indexOf("done") !== -1;
}

function defaultLaborBucketForRole(role) {
  var r = normalizeRoleKey(role);
  if (r === "maint" || r === "qa") return "fixed";
  if (r === "fork" || r === "recycling") return "step_fixed";
  return "variable";
}

function normalizeRoleKey(role) {
  var r = String(role || "").toLowerCase().trim();
  if (r === "forklift" || r === "fork lift") return "fork";
  if (r === "maintenance") return "maint";
  if (r === "qa tech" || r === "qa_tech") return "qa";
  if (r === "gen labor" || r === "general labor") return "labor";
  return r;
}

var FORECAST_ROLE_ORDER = ["labor", "operator", "fork", "qa", "maint", "recycling"];
var DEFAULT_MICRO_HEADCOUNT = {
  labor: 9.6,
  operator: 1,
  fork: 1.5,
  qa: 0.5,
  maint: 0.5,
  recycling: 0.5
};
var LINE_OPTIONS = ["DMM", "MPAC", "RSC", "Hand Pack", "Climax"];
var DEFAULT_ROLE_RATE = {
  labor: 20.17,
  operator: 27.22,
  fork: 27.73,
  qa: 22.20,
  maint: 37.06,
  recycling: 20.17
};

function normalizeLegacyHeadcountMap(map) {
  var out = Object.assign({}, map || {});
  var labor = safeNum(out.labor);
  var operator = safeNum(out.operator);
  var fork = safeNum(out.fork);
  var qa = safeNum(out.qa);
  var maint = safeNum(out.maint);
  var recycling = safeNum(out.recycling);
  // Legacy bootstrap used labor=1 with otherwise current defaults; upgrade to current preset.
  if (labor === 1 && operator === 1 && fork === 1.5 && qa === 0.5 && maint === 0.5 && recycling === 0.5) {
    out.labor = DEFAULT_MICRO_HEADCOUNT.labor;
  }
  return out;
}

var FORECAST_PRIMARY_STALE_MS = 5 * 60 * 1000;
var FORECAST_CONFIG_STALE_MS = 15 * 60 * 1000;

async function fetchJsonWithCredentials(url, options) {
  var response = await fetch(url, Object.assign({ credentials: "include" }, options || {}));
  var body = {};
  try {
    body = await response.json();
  } catch (_error) {
    body = {};
  }
  return { response: response, body: body };
}

async function fetchForecastVersions(monthKey) {
  var result = await fetchJsonWithCredentials("/api/ops/forecast-versions?monthKey=" + encodeURIComponent(monthKey));
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load forecast versions");
  return {
    versions: Array.isArray(result.body && result.body.versions) ? result.body.versions : [],
    status: String((result.body && result.body.status) || "")
  };
}

async function fetchForecastAssumptions(monthKey) {
  var result = await fetchJsonWithCredentials("/api/ops/forecast-assumptions?monthKey=" + encodeURIComponent(monthKey));
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load assumptions");
  return result.body || {};
}

async function fetchForecastConfig(monthKey) {
  var result = await fetchJsonWithCredentials("/api/ops/config?monthKey=" + encodeURIComponent(monthKey));
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load forecast config");
  return result.body || {};
}

async function fetchForecastLaborActuals(monthKey) {
  var result = await fetchJsonWithCredentials("/api/ops/labor-actuals?monthKey=" + encodeURIComponent(monthKey));
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load labor actuals");
  return result.body || {};
}

async function fetchForecastProductionActuals(monthKey) {
  var range = monthRange(monthKey);
  if (!range.start || !range.end) {
    return { status: "error", byDay: [], byDaySku: [], error: "Invalid month range", totalRows: 0 };
  }
  var url = "/api/ops/production-breakdown?start=" + encodeURIComponent(range.start) + "&end=" + encodeURIComponent(range.end);
  var result = await fetchJsonWithCredentials(url);
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load production actuals");
  return result.body || {};
}

async function fetchForecastProductionHistory(monthKey) {
  var range = monthRange(monthKey);
  if (!range.start || !range.end) {
    return { status: "error", byDay: [], error: "Invalid month range" };
  }
  var historyStart = shiftIsoDay(range.start, -84);
  var url = "/api/ops/production-breakdown?summary=1&start=" + encodeURIComponent(historyStart) + "&end=" + encodeURIComponent(range.end);
  var result = await fetchJsonWithCredentials(url);
  if (!result.response.ok) throw new Error((result.body && result.body.error) || "Could not load production history");
  return result.body || {};
}

function buildProductionDrivenDailyTargets(options) {
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

  var productionStatus = productionDayStatusET(new Date());
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
  var recentRows = historyRows.slice(-28);
  var trailingRows = historyRows.slice(-5);
  var trailingDailyVelocity = trailingRows.length
    ? Math.round(trailingRows.reduce(function(sum, row) { return sum + safeNum(row.units); }, 0) / trailingRows.length)
    : 0;
  var historyDaysUsed = recentRows.length;
  var weekdayUnits = {};
  recentRows.forEach(function(row) {
    var day = String(row && row.date || "");
    var d = new Date(day + "T00:00:00Z");
    if (isNaN(d)) return;
    var dow = d.getUTCDay();
    if (!weekdayUnits[dow]) weekdayUnits[dow] = [];
    weekdayUnits[dow].push(safeNum(row.units));
  });
  var overallAverage = recentRows.length
    ? recentRows.reduce(function(sum, row) { return sum + safeNum(row.units); }, 0) / recentRows.length
    : 0;
  var hasSaturdayHistory = !!(weekdayUnits[6] && weekdayUnits[6].length);
  var allocationDays = isCurrentProductionMonth
    ? allDays.filter(function(day) { return day >= planningStart; })
    : allDays.slice();
  var rawWeightByDay = {};
  var rawWeightTotal = 0;
  allocationDays.forEach(function(day) {
    var dow = new Date(day + "T00:00:00Z").getUTCDay();
    var samples = weekdayUnits[dow] || [];
    var weekdayAverage = samples.length
      ? samples.reduce(function(sum, units) { return sum + safeNum(units); }, 0) / samples.length
      : 0;
    var rawWeight = weekdayAverage;
    if (!(rawWeight > 0)) {
      if (dow === 6 && hasSaturdayHistory) rawWeight = overallAverage * 0.2;
      else if (dow === 0) rawWeight = 0;
      else if (isBusinessDay(day)) rawWeight = overallAverage > 0 ? overallAverage : 1;
    }
    rawWeightByDay[day] = rawWeight;
    rawWeightTotal += rawWeight;
  });
  if (!(rawWeightTotal > 0)) {
    rawWeightTotal = 0;
    allocationDays.forEach(function(day) {
      var fallbackWeight = isBusinessDay(day) ? 1 : 0;
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

export default function ForecastView(props) {
  var queryClient = useQueryClient();
  var C = useTheme().C;
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var itemMaster = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var productionData = Array.isArray(props.productionData) ? props.productionData : [];
  var laborData = Array.isArray(props.laborData) ? props.laborData : [];
  var initial = props.initialFilters || {};
  var onPermalinkChange = props.onPermalinkChange;
  var [monthKey, setMonthKey] = useState(currentMonthKey());
  var [overheadGlobal, setOverheadGlobal] = useState(0);
  var [cogsNonLabor, setCogsNonLabor] = useState(0);
  var [equipmentRental, setEquipmentRental] = useState(0);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [payload, setPayload] = useState(null);
  var [laborTemplates, setLaborTemplates] = useState([]);
  var [overrides, setOverrides] = useState([]);
  var [assumptionsLoading, setAssumptionsLoading] = useState(false);
  var [autosaveStatus, setAutosaveStatus] = useState("idle");
  var [autosaveError, setAutosaveError] = useState("");
  var [versionsMsg, setVersionsMsg] = useState("");
  var [publishLoading, setPublishLoading] = useState(false);
  var didLoadMonthRef = useRef({});
  var [expandedRows, setExpandedRows] = useState({});
  var [dirtyRows, setDirtyRows] = useState({});
  var [selectedRows, setSelectedRows] = useState({});
  var [bulkOperatorHeadcount, setBulkOperatorHeadcount] = useState("");

  useEffect(function() {
    if (initial.month) setMonthKey(String(initial.month));
    if (initial.overhead !== "") setOverheadGlobal(String(initial.overhead));
    if (initial.cogs !== "") setCogsNonLabor(String(initial.cogs));
    if (initial.equipment !== "") setEquipmentRental(String(initial.equipment));
    // Only apply once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      month: monthKey,
      overhead: String(overheadGlobal || ""),
      cogs: String(cogsNonLabor || ""),
      equipment: String(equipmentRental || "")
    });
  }, [onPermalinkChange, monthKey, overheadGlobal, cogsNonLabor, equipmentRental]);

  var applySavedAssumptions = useCallback(function(row) {
    if (!row) return;
    var ga = row.global_assumptions || {};
    var lt = Array.isArray(row.labor_templates) ? row.labor_templates : [];
    var ov = Array.isArray(row.overrides) ? row.overrides : [];
    if (ga && typeof ga === "object") {
      if (ga.overhead_global != null) setOverheadGlobal(String(ga.overhead_global));
      if (ga.cogs_non_labor != null) setCogsNonLabor(String(ga.cogs_non_labor));
      if (ga.equipment_rental != null) setEquipmentRental(String(ga.equipment_rental));
    }
    if (lt.length) setLaborTemplates(lt);
    if (ov.length) {
      setOverrides(ov.map(function(r) {
        var hc = normalizeLegacyHeadcountMap(r && r.override_headcount_by_role);
        return Object.assign({}, r, { override_headcount_by_role: hc });
      }));
    }
  }, []);

  var applyForecastSnapshot = useCallback(function(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return false;
    var ga = snapshot.global_assumptions && typeof snapshot.global_assumptions === "object"
      ? snapshot.global_assumptions
      : (snapshot.globalAssumptions && typeof snapshot.globalAssumptions === "object" ? snapshot.globalAssumptions : {});
    var lt = Array.isArray(snapshot.labor_templates) ? snapshot.labor_templates : (Array.isArray(snapshot.laborTemplates) ? snapshot.laborTemplates : []);
    var ov = Array.isArray(snapshot.overrides) ? snapshot.overrides : [];
    applySavedAssumptions({
      global_assumptions: ga,
      labor_templates: lt,
      overrides: ov
    });
    return true;
  }, [applySavedAssumptions]);

  var saveAssumptions = useCallback(async function() {
    try {
      setAutosaveStatus("saving");
      setAutosaveError("");
      var result = await fetchJsonWithCredentials("/api/ops/forecast-assumptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthKey: monthKey,
          globalAssumptions: {
            overhead_global: safeNum(overheadGlobal),
            cogs_non_labor: safeNum(cogsNonLabor),
            equipment_rental: safeNum(equipmentRental)
          },
          laborTemplates: laborTemplates,
          overrides: overrides
        })
      });
      var body = result.body;
      if (!result.response.ok) throw new Error((body && body.error) || "Could not save assumptions");
      if (body && body.status === "missing_forecast_assumptions_table") {
        setAutosaveStatus("error");
        setAutosaveError("Assumptions table not set up yet.");
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["forecast", "assumptions", monthKey] });
      setAutosaveStatus("saved");
    } catch (err) {
      setAutosaveStatus("error");
      setAutosaveError(err && err.message ? err.message : "Could not save assumptions.");
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides, queryClient]);

  var versionsQuery = useQuery({
    queryKey: ["forecast", "versions", monthKey],
    queryFn: function() {
      return fetchForecastVersions(monthKey);
    },
    enabled: !!monthKey,
    staleTime: FORECAST_PRIMARY_STALE_MS
  });
  var versions = versionsQuery.data && Array.isArray(versionsQuery.data.versions) ? versionsQuery.data.versions : [];
  var versionsLoading = versionsQuery.isPending;
  var selectedVersion = useMemo(function() {
    var picked = null;
    versions.forEach(function(v) {
      if (picked) return;
      if (v && v.is_active) picked = v;
    });
    if (!picked && versions.length) picked = versions[0];
    return picked;
  }, [versions]);
  var hasSelectedSnapshot = !!(selectedVersion && selectedVersion.snapshot && typeof selectedVersion.snapshot === "object");

  var assumptionsQuery = useQuery({
    queryKey: ["forecast", "assumptions", monthKey],
    queryFn: function() {
      return fetchForecastAssumptions(monthKey);
    },
    enabled: !!monthKey && !hasSelectedSnapshot && (versionsQuery.status === "success" || versionsQuery.status === "error"),
    staleTime: FORECAST_PRIMARY_STALE_MS
  });

  useEffect(function() {
    if (!monthKey) return;
    didLoadMonthRef.current[monthKey] = false;
    setAssumptionsLoading(true);
    setAutosaveError("");
    setAutosaveStatus("loading");
    setVersionsMsg("");
  }, [monthKey]);

  useEffect(function() {
    var mk = String(monthKey || "").trim();
    if (!mk || didLoadMonthRef.current[mk]) return;
    if (versionsQuery.isPending) return;

    if (versionsQuery.data && versionsQuery.data.status === "missing_forecast_versions_table") {
      setVersionsMsg("Run docs/supabase-forecast-versions.sql in Supabase to enable publishing.");
    }

    if (hasSelectedSnapshot) {
      applyForecastSnapshot(selectedVersion.snapshot);
      didLoadMonthRef.current[mk] = true;
      setAssumptionsLoading(false);
      setAutosaveStatus("idle");
      setVersionsMsg("Loaded published version v" + String(selectedVersion.version_no || "") + " for " + mk + ".");
      return;
    }

    if (assumptionsQuery.isPending) return;
    if (assumptionsQuery.isSuccess) {
      var body = assumptionsQuery.data || {};
      if (body && body.status === "missing_forecast_assumptions_table") {
        setAutosaveStatus("error");
        setAutosaveError("Assumptions table not set up yet.");
      } else {
        if (body && body.row) applySavedAssumptions(body.row);
        setAutosaveStatus("idle");
      }
      didLoadMonthRef.current[mk] = true;
      setAssumptionsLoading(false);
      return;
    }
    if (assumptionsQuery.isError) {
      setAutosaveStatus("error");
      setAutosaveError(assumptionsQuery.error && assumptionsQuery.error.message ? assumptionsQuery.error.message : "Could not load assumptions.");
      didLoadMonthRef.current[mk] = true;
      setAssumptionsLoading(false);
    }
  }, [
    monthKey,
    versionsQuery.isPending,
    versionsQuery.data,
    assumptionsQuery.isPending,
    assumptionsQuery.isSuccess,
    assumptionsQuery.isError,
    assumptionsQuery.data,
    assumptionsQuery.error,
    selectedVersion,
    hasSelectedSnapshot,
    applyForecastSnapshot,
    applySavedAssumptions
  ]);

  var configQuery = useQuery({
    queryKey: ["forecast", "config", monthKey],
    queryFn: function() {
      return fetchForecastConfig(monthKey);
    },
    enabled: !!monthKey,
    staleTime: FORECAST_CONFIG_STALE_MS
  });

  useEffect(function() {
    var body = configQuery.data;
    if (!body || typeof body !== "object") return;
    var rates = Array.isArray(body && body.rates) ? body.rates : [];
    var headcountDefaults = body && body.headcountDefaults && typeof body.headcountDefaults === "object"
      ? body.headcountDefaults
      : {};
    var lineHeadcountDefaults = body && body.lineHeadcountDefaults && typeof body.lineHeadcountDefaults === "object"
      ? body.lineHeadcountDefaults
      : {};
    if (!rates.length) return;
    var seenRoles = {};
    var roles = [];
    var rateByRole = {};
    rates.forEach(function(r) {
      var role = normalizeRoleKey(r.role);
      if (!role) return;
      if (!seenRoles[role]) {
        seenRoles[role] = true;
        roles.push(role);
      }
      rateByRole[role] = (safeNum(r.hourly_rate) * (1 + safeNum(r.markup_pct))).toFixed(2);
    });
    FORECAST_ROLE_ORDER.forEach(function(role) {
      if (seenRoles[role]) return;
      roles.push(role);
      if (!rateByRole[role]) rateByRole[role] = "0.00";
    });
    var combos = {};
    workOrders.forEach(function(w) {
      var status = String((w && (w["Work Order Status"] || w.project_status || w.status)) || "").trim();
      if (statusLooksClosed(status)) return;
      var line = String((w && (w["Line"] || w.line || w["Line Name"] || w.line_name)) || "").trim();
      var sku = String((w && (w["Item Code"] || w.item_code || w.code || w["Code"])) || "").trim();
      var desc = String((w && (w["Description"] || w.description || w.item_description || w["Item Description"])) || "").trim();
      var pack = detectPackType(desc || sku, sku);
      if (!line) return;
      combos[line + "::" + pack] = { line_name: line, pack_type: pack || "" };
    });
    var comboList = Object.keys(combos).map(function(k) { return combos[k]; });
    if (!comboList.length) comboList = [{ line_name: "", pack_type: "" }];
    var seeded = [];
    comboList.forEach(function(c) {
      roles.forEach(function(role) {
        var lineDefaults = lineHeadcountDefaults[c.line_name] || {};
        var hc = safeNum(lineDefaults[role]);
        if (!(hc > 0)) hc = safeNum(headcountDefaults[role]);
        if (!(hc > 0)) hc = safeNum(DEFAULT_MICRO_HEADCOUNT[role]);
        seeded.push({
          sku: "",
          product_family: "",
          pack_type: c.pack_type || "",
          line_name: c.line_name || "",
          role: role,
          labor_bucket: defaultLaborBucketForRole(role),
          headcount_assumed: hc > 0 ? hc : 1,
          hourly_rate: rateByRole[role] || "0.00"
        });
      });
    });
    setLaborTemplates(function(prev) {
      return Array.isArray(prev) && prev.length ? prev : seeded;
    });
  }, [configQuery.data, workOrders]);

  var runForecast = useCallback(async function() {
    setLoading(true);
    setError("");
    try {
      var res = await fetch("/api/ops/labor-forecast", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monthKey: monthKey,
          workOrders: workOrders,
          itemMaster: itemMaster,
          laborTemplates: laborTemplates,
          overrides: overrides,
          globalAssumptions: {
            overhead_global: safeNum(overheadGlobal),
            cogs_non_labor: safeNum(cogsNonLabor),
            equipment_rental: safeNum(equipmentRental)
          }
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Forecast request failed");
      setPayload(body);
      clearAllDirty();
    } catch (err) {
      setError(err && err.message ? err.message : "Could not run forecast.");
    } finally {
      setLoading(false);
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, workOrders, itemMaster, laborTemplates, overrides]);

  var publishForecastVersion = useCallback(async function() {
    if (!monthKey) return;
    if (!payload || !payload.forecast) {
      setVersionsMsg("Run Forecast before publishing a version.");
      return;
    }
    setPublishLoading(true);
    setVersionsMsg("");
    try {
      var res = await fetch("/api/ops/forecast-versions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "publish",
          monthKey: monthKey,
          snapshot: {
            global_assumptions: {
              overhead_global: safeNum(overheadGlobal),
              cogs_non_labor: safeNum(cogsNonLabor),
              equipment_rental: safeNum(equipmentRental)
            },
            labor_templates: laborTemplates,
            overrides: overrides,
            forecast: payload.forecast
          },
          summary: summary || {}
        })
      });
      var body = await res.json();
      if (!res.ok) throw new Error((body && body.error) || "Could not publish forecast version");
      if (body && body.status === "missing_forecast_versions_table") {
        setVersionsMsg("Run docs/supabase-forecast-versions.sql in Supabase to enable publishing.");
        return;
      }
      setVersionsMsg("Published forecast version for " + monthKey + ".");
      queryClient.invalidateQueries({ queryKey: ["forecast", "versions", monthKey] });
    } catch (err) {
      setVersionsMsg(err && err.message ? err.message : "Could not publish forecast version.");
    } finally {
      setPublishLoading(false);
    }
  }, [monthKey, payload, summary, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides, queryClient]);

  useEffect(function() {
    if (!workOrders.length) return;
    runForecast();
  }, [runForecast, workOrders.length]);

  var laborActualsQuery = useQuery({
    queryKey: ["forecast", "labor-actuals", monthKey, Array.isArray(laborData) ? laborData.length : 0],
    queryFn: function() {
      return fetchForecastLaborActuals(monthKey);
    },
    enabled: !!monthKey,
    staleTime: FORECAST_PRIMARY_STALE_MS
  });

  var productionActualsQuery = useQuery({
    queryKey: ["forecast", "production-actuals", monthKey, Array.isArray(productionData) ? productionData.length : 0],
    queryFn: function() {
      return fetchForecastProductionActuals(monthKey);
    },
    enabled: !!monthKey,
    staleTime: FORECAST_PRIMARY_STALE_MS
  });
  var productionHistoryQuery = useQuery({
    queryKey: ["forecast", "production-history", monthKey, Array.isArray(productionData) ? productionData.length : 0],
    queryFn: function() {
      return fetchForecastProductionHistory(monthKey);
    },
    enabled: !!monthKey,
    staleTime: FORECAST_PRIMARY_STALE_MS
  });

  useEffect(function() {
    if (!monthKey) return;
    if (assumptionsLoading) return;
    if (!didLoadMonthRef.current[monthKey]) return;
    var id = setTimeout(function() {
      saveAssumptions();
    }, 900);
    return function() { clearTimeout(id); };
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, laborTemplates, overrides, assumptionsLoading, saveAssumptions]);

  var laborActuals = laborActualsQuery.data
    ? {
        status: laborActualsQuery.data.status || "ok",
        summary: laborActualsQuery.data.summary || {},
        byWorkOrder: Array.isArray(laborActualsQuery.data.byWorkOrder) ? laborActualsQuery.data.byWorkOrder : [],
        byJob: Array.isArray(laborActualsQuery.data.byJob) ? laborActualsQuery.data.byJob : []
      }
    : laborActualsQuery.isError
      ? { status: "error", summary: {}, byWorkOrder: [], byJob: [], error: laborActualsQuery.error && laborActualsQuery.error.message ? laborActualsQuery.error.message : "Could not load labor actuals" }
      : { status: "idle", summary: {} };
  var productionActuals = productionActualsQuery.data
    ? {
        status: productionActualsQuery.data.status || "ok",
        byDay: Array.isArray(productionActualsQuery.data.byDay) ? productionActualsQuery.data.byDay : [],
        byDaySku: Array.isArray(productionActualsQuery.data.byDaySku) ? productionActualsQuery.data.byDaySku : [],
        latestDate: productionActualsQuery.data.latestDate || null,
        totalRows: Number(productionActualsQuery.data.totalRows || 0),
        error: productionActualsQuery.data.error || ""
      }
    : productionActualsQuery.isError
      ? { status: "error", byDay: [], byDaySku: [], latestDate: null, error: productionActualsQuery.error && productionActualsQuery.error.message ? productionActualsQuery.error.message : "Could not load production actuals" }
      : { status: "idle", byDay: [], byDaySku: [], latestDate: null };
  var productionHistory = productionHistoryQuery.data
    ? {
        status: productionHistoryQuery.data.status || "ok",
        byDay: Array.isArray(productionHistoryQuery.data.byDay) ? productionHistoryQuery.data.byDay : [],
        error: productionHistoryQuery.data.error || ""
      }
    : productionHistoryQuery.isError
      ? { status: "error", byDay: [], error: productionHistoryQuery.error && productionHistoryQuery.error.message ? productionHistoryQuery.error.message : "Could not load production history" }
      : { status: "idle", byDay: [] };
  var forecast = payload && payload.forecast ? payload.forecast : null;
  var summary = forecast && forecast.summary ? forecast.summary : null;
  var actualLaborSummary = laborActuals && laborActuals.summary && typeof laborActuals.summary === "object" ? laborActuals.summary : {};
  var bySku = forecast && Array.isArray(forecast.bySku) ? forecast.bySku : [];
  var byWorkOrder = forecast && Array.isArray(forecast.byWorkOrder) ? forecast.byWorkOrder : [];
  var daily = forecast && Array.isArray(forecast.daily) ? forecast.daily : [];
  var flags = forecast && Array.isArray(forecast.flags) ? forecast.flags : [];
  var dailyMonthLabel = useMemo(function() {
    if (!/^\d{4}-\d{2}$/.test(String(monthKey || ""))) return String(monthKey || "the selected month");
    return new Date(monthKey + "-01T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long" });
  }, [monthKey]);
  var topSku = useMemo(function() { return bySku.slice(0, 20); }, [bySku]);
  var microRows = useMemo(function() {
    return byWorkOrder.slice().sort(function(a, b) {
      return safeNum(b.planned_cases) - safeNum(a.planned_cases);
    });
  }, [byWorkOrder]);
  var visibleMicroRows = useMemo(function() { return microRows.slice(0, 200); }, [microRows]);
  var dirtyCount = useMemo(function() { return Object.keys(dirtyRows || {}).length; }, [dirtyRows]);
  var activeVersion = useMemo(function() {
    var found = null;
    (versions || []).forEach(function(v) {
      if (found) return;
      if (v && v.is_active) found = v;
    });
    return found;
  }, [versions]);
  var selectedCount = useMemo(function() {
    var count = 0;
    visibleMicroRows.forEach(function(r, idx) {
      var key = r && r.wo_code ? ("wo:" + String(r.wo_code).trim().toLowerCase()) : ("sku:" + String(r && r.sku || "").trim().toLowerCase() + "::" + idx);
      if (selectedRows[key]) count += 1;
    });
    return count;
  }, [visibleMicroRows, selectedRows]);
  var descriptionBySku = useMemo(function() {
    var out = {};
    itemMaster.forEach(function(r) {
      var sku = String((r && (r["Item Code"] || r.Code || r.item_code || r.code)) || "").trim();
      if (!sku) return;
      var desc = String((r && (r["Description"] || r.description || r["Item Description"])) || "").trim();
      if (!desc) return;
      if (!out[sku]) out[sku] = desc;
      var key = sku.toLowerCase();
      if (!out[key]) out[key] = desc;
    });
    return out;
  }, [itemMaster]);
  var actualByDay = useMemo(function() {
    var skuRate = {};
    bySku.forEach(function(s) {
      var sku = String(s.sku || "").trim();
      var key = sku.toLowerCase();
      if (!key) return;
      var rate = safeNum(s.revenue) / Math.max(1, safeNum(s.planned_cases));
      if (rate > 0) skuRate[key] = rate;
    });
    itemMaster.forEach(function(r) {
      var sku = String((r && (r["Item Code"] || r.Code || r.item_code || r.code)) || "").trim();
      if (!sku) return;
      var key = sku.toLowerCase();
      if (skuRate[key] > 0) return;
      var cost = safeNum((r && (r["Cost Per Unit"] || r.cost_per_unit || r["Unit Cost"] || r.unit_cost)) || 0);
      if (cost > 0) skuRate[key] = cost;
    });

    var out = {};
    var rows = Array.isArray(productionActuals.byDaySku) ? productionActuals.byDaySku : [];
    rows.forEach(function(r) {
      var sku = String((r && r.item_code) || "").trim();
      if (!sku) return;
      var dt = String((r && r.day_key) || "").trim();
      if (!dt || dt.slice(0, 7) !== monthKey) return;
      var units = safeNum((r && (r.units || r.units_produced)) || 0);
      if (!(units > 0)) return;
      var rate = safeNum(skuRate[sku.toLowerCase()]);
      if (!out[dt]) out[dt] = { day_key: dt, actual_cases: 0, actual_revenue: 0 };
      out[dt].actual_cases += units;
      out[dt].actual_revenue += units * rate;
    });
    return out;
  }, [productionActuals, bySku, itemMaster, monthKey]);
  var dailyTargetsModel = useMemo(function() {
    if (!summary) {
      return {
        rows: daily,
        model: "forecast_schedule",
        actualLockedThrough: "",
        remainingForecastCases: 0,
        trailingDailyVelocity: 0,
        historyDaysUsed: 0
      };
    }
    if (productionHistory.status !== "ok" || productionActuals.status !== "ok") {
      return {
        rows: daily,
        model: "forecast_schedule",
        actualLockedThrough: "",
        remainingForecastCases: 0,
        trailingDailyVelocity: 0,
        historyDaysUsed: 0
      };
    }
    return buildProductionDrivenDailyTargets({
      monthKey: monthKey,
      summary: summary,
      actualByDay: actualByDay,
      historyByDay: productionHistory.byDay,
      fallbackRows: daily
    });
  }, [summary, daily, monthKey, actualByDay, productionHistory]);
  var displayDaily = useMemo(function() {
    return Array.isArray(dailyTargetsModel.rows) ? dailyTargetsModel.rows : [];
  }, [dailyTargetsModel]);
  var dailyTargetsNote = useMemo(function() {
    if (dailyTargetsModel.model === "production_history") {
      var lead = dailyTargetsModel.actualLockedThrough
        ? ("Locked actual output through " + dailyTargetsModel.actualLockedThrough + "; ")
        : "";
      return lead + "remaining " + Math.round(safeNum(dailyTargetsModel.remainingForecastCases)).toLocaleString() + " cases are distributed using the recent production yield profile (" + Math.max(1, safeNum(dailyTargetsModel.historyDaysUsed)) + " recent production days, trailing pace " + Math.round(safeNum(dailyTargetsModel.trailingDailyVelocity)).toLocaleString() + "/day).";
    }
    return "Daily targets are using the forecast schedule split because recent production history is unavailable.";
  }, [dailyTargetsModel]);

  var normKey = function(v) {
    return String(v || "").trim().toLowerCase();
  };
  var getRowKey = function(row, idx) {
    var woKey = normKey(row && row.wo_code);
    if (woKey) return "wo:" + woKey;
    return "sku:" + normKey(row && row.sku) + "::" + idx;
  };
  var markRowDirty = function(key) {
    if (!key) return;
    setDirtyRows(function(prev) {
      return Object.assign({}, prev, { [key]: true });
    });
  };
  var clearRowDirty = function(key) {
    if (!key) return;
    setDirtyRows(function(prev) {
      if (!prev[key]) return prev;
      var next = Object.assign({}, prev);
      delete next[key];
      return next;
    });
  };
  var clearAllDirty = function() {
    setDirtyRows({});
  };
  var pickOverrideForWo = function(row) {
    var woKey = normKey(row && row.wo_code);
    var skuKey = normKey(row && row.sku);
    var lineKey = normKey(row && row.line_name);
    var month = String(monthKey || "");
    var found = null;
    overrides.forEach(function(o) {
      if (found) return;
      var oMonth = String((o && o.month_key) || "");
      if (month && oMonth && oMonth !== month) return;
      if (woKey && normKey(o.wo_code) === woKey) {
        found = o;
        return;
      }
      if (skuKey && normKey(o.sku) === skuKey && lineKey && normKey(o.line_name) === lineKey) {
        found = o;
      }
    });
    return found || {};
  };
  var upsertOverrideForWo = function(row, apply) {
    setOverrides(function(prev) {
      var woKey = normKey(row && row.wo_code);
      var skuKey = normKey(row && row.sku);
      var lineKey = normKey(row && row.line_name);
      var month = String(monthKey || "");
      var idx = -1;
      for (var i = 0; i < prev.length; i++) {
        var o = prev[i] || {};
        var oMonth = String(o.month_key || "");
        if (month && oMonth && oMonth !== month) continue;
        if (woKey && normKey(o.wo_code) === woKey) { idx = i; break; }
        if (!woKey && skuKey && lineKey && normKey(o.sku) === skuKey && normKey(o.line_name) === lineKey) { idx = i; break; }
      }
      var base = idx >= 0 ? Object.assign({}, prev[idx]) : {
        month_key: monthKey,
        wo_code: row.wo_code || "",
        sku: row.sku || "",
        line_name: row.line_name || "",
        override_planned_cases: "",
        override_cases_per_min: "",
        override_line_name: "",
        override_pack_type: "",
        override_headcount_by_role: {},
        override_bucket_multiplier: {}
      };
      var nextRow = apply(base) || base;
      nextRow = Object.assign({}, nextRow, { month_key: monthKey });
      if (idx >= 0) {
        var next = prev.slice();
        next[idx] = nextRow;
        return next;
      }
      return prev.concat([nextRow]);
    });
  };
  var baselineHeadcountByRole = function(row) {
    var out = Object.assign({}, DEFAULT_MICRO_HEADCOUNT);
    var lineKey = normKey(row && row.line_name);
    var packKey = normKey(row && row.pack_type);
    var skuKey = normKey(row && row.sku);
    var matches = laborTemplates.filter(function(t) {
      var tRole = normalizeRoleKey(t && t.role);
      if (!tRole) return false;
      var tSku = normKey(t && t.sku);
      var tLine = normKey(t && t.line_name);
      var tPack = normKey(t && t.pack_type);
      if (tSku && skuKey && tSku === skuKey && (!tLine || tLine === lineKey)) return true;
      if (tLine && tLine === lineKey && (!tPack || tPack === packKey)) return true;
      return false;
    });
    matches.forEach(function(t) {
      var role = normalizeRoleKey(t && t.role);
      if (!Object.prototype.hasOwnProperty.call(out, role)) return;
      out[role] = safeNum(t.headcount_assumed);
    });
    return out;
  };
  var workOrderByCode = useMemo(function() {
    var out = {};
    workOrders.forEach(function(w) {
      var wo = String((w && (w["Work Order Code"] || w.project_code || w["Project Code"] || w.wo_number || w.wo)) || "").trim();
      if (!wo) return;
      out[normKey(wo)] = w;
    });
    return out;
  }, [workOrders]);
  var workOrderCasesPerMin = function(wo) {
    if (!wo) return 0;
    var uph = safeNum((wo["Standard Units Per Hour"] || wo.standard_units_per_hour || wo.units_per_hour || wo["Units Per Hour"] || wo.rate_per_hour || wo["Rate Per Hour"]) || 0);
    if (uph > 0) return uph / 60;
    return 0;
  };
  var roleRatesForRow = function(row, lineName, packType) {
    var out = Object.assign({}, DEFAULT_ROLE_RATE);
    var lineKey = normKey(lineName || (row && row.line_name));
    var packKey = normKey(packType || (row && row.pack_type));
    var skuKey = normKey(row && row.sku);
    laborTemplates.forEach(function(t) {
      var role = normalizeRoleKey(t && t.role);
      if (!role) return;
      var tSku = normKey(t && t.sku);
      var tLine = normKey(t && t.line_name);
      var tPack = normKey(t && t.pack_type);
      var match = false;
      if (tSku && skuKey && tSku === skuKey && (!tLine || tLine === lineKey)) match = true;
      else if (!tSku && tLine && tLine === lineKey && (!tPack || tPack === packKey)) match = true;
      else if (!tSku && !tLine && tPack && tPack === packKey) match = true;
      else if (!tSku && !tLine && !tPack) match = true;
      if (!match) return;
      var rate = safeNum(t && t.hourly_rate);
      if (rate > 0) out[role] = rate;
    });
    return out;
  };
  var baselineLaborCostByRowKey = useMemo(function() {
    var out = {};
    microRows.forEach(function(r, idx) {
      var key = getRowKey(r, idx);
      var wo = workOrderByCode[normKey(r && r.wo_code)];
      var baseLine = String((wo && (wo["Line"] || wo.line || wo["Line Name"] || wo.line_name)) || r.line_name || "Unassigned");
      var basePack = String((wo && (wo["Pack Type"] || wo.pack_type || wo["Item Type"] || wo.item_type)) || r.pack_type || "");
      var baseCpm = workOrderCasesPerMin(wo);
      if (!(baseCpm > 0)) baseCpm = safeNum(r.cases_per_min);
      if (!(baseCpm > 0)) baseCpm = 1;
      var baseHc = baselineHeadcountByRole(Object.assign({}, r, { line_name: baseLine, pack_type: basePack }));
      var rateByRole = roleRatesForRow(r, baseLine, basePack);
      var hourly = 0;
      Object.keys(baseHc).forEach(function(role) {
        hourly += safeNum(baseHc[role]) * safeNum(rateByRole[role] || DEFAULT_ROLE_RATE[role] || 0);
      });
      var hours = safeNum(r.planned_cases) / (baseCpm * 60);
      out[key] = hourly * hours;
    });
    return out;
  }, [microRows, workOrderByCode, laborTemplates]);
  useEffect(function() {
    if (!microRows.length) return;
    var month = String(monthKey || "");
    setOverrides(function(prev) {
      var next = prev.slice();
      var changed = false;
      for (var i = 0; i < next.length; i++) {
        var row = next[i] || {};
        var hcCurrent = row.override_headcount_by_role || {};
        var hcNext = normalizeLegacyHeadcountMap(hcCurrent);
        if (safeNum(hcNext.labor) !== safeNum(hcCurrent.labor)) {
          next[i] = Object.assign({}, row, { override_headcount_by_role: hcNext });
          changed = true;
        }
      }
      microRows.forEach(function(r) {
        var woKey = normKey(r && r.wo_code);
        if (!woKey) return;
        var exists = next.some(function(o) {
          var oMonth = String((o && o.month_key) || "");
          if (month && oMonth && oMonth !== month) return false;
          return normKey(o && o.wo_code) === woKey;
        });
        if (exists) return;
        var hc = baselineHeadcountByRole(r);
        hc = normalizeLegacyHeadcountMap(hc);
        next.push({
          month_key: monthKey,
          wo_code: r.wo_code || "",
          sku: r.sku || "",
          line_name: r.line_name || "",
          override_planned_cases: "",
          override_cases_per_min: "",
          override_line_name: "",
          override_pack_type: "",
          override_headcount_by_role: hc,
          override_bucket_multiplier: { variable: 1, step_fixed: 1, fixed: 1 }
        });
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [monthKey, microRows]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Month</div>
          <MonthPicker value={monthKey} onChange={setMonthKey} className="w-44" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Overhead</div>
          <Input type="number" value={overheadGlobal} onChange={function(e) { setOverheadGlobal(e.target.value); }} className="h-10 w-36 text-sm" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">COGS (Non-Labor)</div>
          <Input type="number" value={cogsNonLabor} onChange={function(e) { setCogsNonLabor(e.target.value); }} className="h-10 w-40 text-sm" />
        </div>
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Equipment</div>
          <Input type="number" value={equipmentRental} onChange={function(e) { setEquipmentRental(e.target.value); }} className="h-10 w-36 text-sm" />
        </div>
        <Button onClick={publishForecastVersion} disabled={publishLoading || !summary} variant="outline">
          {publishLoading ? "Publishing..." : "Publish Forecast"}
        </Button>
      </div>
      <div className="mb-2 text-xs text-[rgb(var(--muted))]">
        {assumptionsLoading ? "Loading monthly assumptions..." : ""}
        {!assumptionsLoading && autosaveStatus === "saving" ? "Saving monthly assumptions..." : ""}
        {!assumptionsLoading && autosaveStatus === "saved" ? "Saved monthly assumptions." : ""}
        {!assumptionsLoading && autosaveStatus === "error" ? ("Autosave issue: " + (autosaveError || "Could not save assumptions.")) : ""}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-[rgb(var(--muted))]">
        <span>{activeVersion ? ("Source of truth: v" + activeVersion.version_no + " (" + (activeVersion.label || "") + ")") : "No published source of truth yet."}</span>
        {!!versionsMsg && <span>{versionsMsg}</span>}
      </div>

      {!!error && <div className="mb-2 text-sm text-[rgb(var(--danger))]">{error}</div>}

      {!!summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Total Case Forecast", value: safeNum(summary.total_cases).toLocaleString() },
            { label: "Rollover Cases", value: safeNum(summary.rollover_cases).toLocaleString() },
            { label: "Rollover WOs", value: safeNum(summary.rollover_wo_count).toLocaleString() },
            { label: "Total Revenue", value: fmtMoneyWhole(summary.total_revenue) },
            { label: "Total Labor Cost", value: fmtMoneyWhole(summary.total_labor_cost) },
            { label: "Variable Labor", value: fmtMoneyWhole(summary.total_variable_labor_cost) },
            { label: "Step-Fixed Labor", value: fmtMoneyWhole(summary.total_step_fixed_labor_cost) },
            { label: "Fixed Labor", value: fmtMoneyWhole(summary.total_fixed_labor_cost) },
            { label: "Labor Cost / Case", value: fmtMoney(summary.labor_cost_per_case) },
            { label: "Labor % Sales", value: fmtPctWhole(summary.labor_pct_sales) },
            { label: "Gross Margin", value: fmtMoneyWhole(summary.gross_margin) },
            { label: "Net Operating Income", value: fmtMoneyWhole(summary.net_operating_income) },
            { label: "Production Hours", value: Math.round(safeNum(summary.total_prod_hours)).toLocaleString() },
            { label: "Headcount Hours", value: Math.round(safeNum(summary.total_headcount_hours)).toLocaleString() },
            { label: "Actual Labor Cost", value: fmtMoneyWhole(actualLaborSummary.labor_cost) },
            { label: "Actual Payable Hours", value: Math.round(safeNum(actualLaborSummary.payable_hours)).toLocaleString() },
            { label: "Actual Cases / Labor Hr", value: safeNum(actualLaborSummary.cases_per_payable_hour).toFixed(1) },
            { label: "Actual Labor $ / Case", value: fmtMoney(safeNum(actualLaborSummary.labor_cost_per_case)) }
          ].map(function(card) {
            return (
              <div key={card.label} style={{ background: C.surface, border: "1px solid " + C.border, borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, color: C.dim }}>{card.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: C.bright }}>{card.value}</div>
              </div>
            );
          })}
        </div>
      )}
      {!!summary && laborActuals.status === "ok" && safeNum(actualLaborSummary.payable_hours) > 0 && (
        <div className="mb-3 text-xs text-[rgb(var(--muted))]">
          Labor actuals matched {Math.round(safeNum(actualLaborSummary.matched_cases)).toLocaleString()} cases across {Math.round(safeNum(actualLaborSummary.unique_job_count)).toLocaleString()} jobs through {actualLaborSummary.latest_date || monthKey}.
          {" "}Coverage: {fmtPctWhole(actualLaborSummary.coverage_pct || 0)} of production cases in the selected month.
        </div>
      )}
      {!!summary && laborActuals.status === "missing_labor_events_table" && (
        <div className="mb-3 text-xs text-[rgb(var(--muted))]">
          Labor actuals are not enabled yet. Run `docs/supabase-labor-events.sql` in Supabase.
        </div>
      )}

      {!!flags.length && (
        <div className="mb-3 rounded-md border border-[rgb(var(--warning))] bg-[rgba(245,158,11,0.08)] p-2 text-xs text-[rgb(var(--foreground))]">
          <div className="mb-1 font-semibold">Forecast Flags ({flags.length})</div>
          {flags.slice(0, 8).map(function(f, idx) {
            return <div key={idx}>{f.woCode || "--"} | {f.sku || "--"} | {f.message}</div>;
          })}
        </div>
      )}

      <div className="mb-3 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-2">
        <div className="mb-1 text-sm font-semibold text-[rgb(var(--foreground))]">Published Forecast Versions</div>
        {versionsLoading ? (
          <div className="text-xs text-[rgb(var(--muted))]">Loading versions...</div>
        ) : !versions.length ? (
          <div className="text-xs text-[rgb(var(--muted))]">No published versions for this month yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Month</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Version</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>Published At</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Cases</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Revenue</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 12, color: C.dim }}>Labor</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>By</th>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 12, color: C.dim }}>State</th>
                </tr>
              </thead>
              <tbody>
                {versions.slice(0, 20).map(function(v) {
                  var s = v && v.summary && typeof v.summary === "object" ? v.summary : {};
                  var dt = String((v && (v.published_at || v.created_at)) || "");
                  var mk = String((v && v.month_key) || "");
                  var monthLabel = mk && /^\d{4}-\d{2}$/.test(mk) ? new Date(mk + "-01T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "short" }) : (mk || "--");
                  return (
                    <tr key={v.id || (v.version_no + "-" + dt)} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{monthLabel}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>v{v.version_no} {v.label ? ("- " + v.label) : ""}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{dt ? new Date(dt).toLocaleString() : "--"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{Math.round(safeNum(s.total_cases)).toLocaleString()}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{fmtMoneyWhole(s.total_revenue)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text, textAlign: "right" }}>{fmtMoneyWhole(s.total_labor_cost)}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{v.created_by || "--"}</td>
                      <td style={{ padding: "6px 8px", fontSize: 12, color: C.text }}>{v.is_active ? "Active" : "Archived"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-1 text-sm font-semibold text-[rgb(var(--foreground))]">Work Order Micro-Forecasts</div>
      <div className="mb-2 text-xs text-[rgb(var(--muted))]">Compact rows show outcome KPIs. Expand a row to edit headcount buckets and advanced settings.</div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="rounded border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 py-1 text-xs text-[rgb(var(--muted))]">Dirty rows: {dirtyCount}</div>
        <Button size="sm" onClick={runForecast} disabled={loading || dirtyCount === 0}>Save All</Button>
        <div className="h-5 w-px bg-[rgb(var(--border))]" />
        <div className="text-xs text-[rgb(var(--muted))]">Bulk for selected ({selectedCount})</div>
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedCount}
          onClick={function() {
            visibleMicroRows.forEach(function(r, idx) {
              var key = getRowKey(r, idx);
              if (!selectedRows[key]) return;
              upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_line_name: "" }); });
              markRowDirty(key);
            });
          }}
        >
          Apply Line Defaults
        </Button>
        <Input
          type="number"
          step="0.1"
          placeholder="HC Op"
          value={bulkOperatorHeadcount}
          onChange={function(e) { setBulkOperatorHeadcount(e.target.value); }}
          className="h-8 w-20 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!selectedCount}
          onClick={function() {
            visibleMicroRows.forEach(function(r, idx) {
              var key = getRowKey(r, idx);
              if (!selectedRows[key]) return;
              upsertOverrideForWo(r, function(base) {
                var nextHc = Object.assign({}, base.override_headcount_by_role || {});
                nextHc.operator = bulkOperatorHeadcount;
                return Object.assign({}, base, { override_headcount_by_role: nextHc });
              });
              markRowDirty(key);
            });
          }}
        >
          Set HC Op
        </Button>
      </div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "center", padding: "8px 6px", fontSize: 12, color: C.dim, width: 38 }}>
                  <input
                    type="checkbox"
                    checked={visibleMicroRows.length > 0 && selectedCount === visibleMicroRows.length}
                    onChange={function(e) {
                      var checked = !!e.target.checked;
                      setSelectedRows(function(prev) {
                        var next = Object.assign({}, prev);
                        visibleMicroRows.forEach(function(r, idx) {
                          var key = getRowKey(r, idx);
                          if (checked) next[key] = true;
                          else delete next[key];
                        });
                        return next;
                      });
                    }}
                  />
                </th>
                <th style={{ textAlign: "center", padding: "8px 6px", fontSize: 12, color: C.dim, width: 38 }} />
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>WO</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>SKU</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Description</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>KPIs</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Price Per Unit</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {!visibleMicroRows.length && <tr><td colSpan={11} style={{ padding: 16, textAlign: "center", color: C.dim }}>No forecast rows yet.</td></tr>}
              {visibleMicroRows.map(function(r, idx) {
                var rowKey = getRowKey(r, idx);
                var desc = descriptionBySku[r.sku] || descriptionBySku[String(r.sku || "").toLowerCase()] || "--";
                var ov = pickOverrideForWo(r);
                var baseHc = baselineHeadcountByRole(r);
                var hc = Object.assign({}, baseHc, (ov && ov.override_headcount_by_role) || {});
                var lineValue = String((ov && ov.override_line_name) || r.line_name || "Unassigned");
                var rowLines = LINE_OPTIONS.slice();
                if (lineValue && rowLines.indexOf(lineValue) === -1) rowLines.unshift(lineValue);
                var isExpanded = !!expandedRows[rowKey];
                var isDirty = !!dirtyRows[rowKey];
                var baseLaborCost = safeNum(baselineLaborCostByRowKey[rowKey]);
                var deltaVsBase = safeNum(r.line_run_labor_cost) - baseLaborCost;
                var casesValue = hasExplicitValue(ov && ov.override_planned_cases)
                  ? String(ov.override_planned_cases)
                  : String(Math.round(safeNum(r.planned_cases)));
                var setRoleHeadcount = function(role, val) {
                  upsertOverrideForWo(r, function(base) {
                    var nextHc = Object.assign({}, base.override_headcount_by_role || {});
                    nextHc[role] = val;
                    return Object.assign({}, base, { override_headcount_by_role: nextHc });
                  });
                  markRowDirty(rowKey);
                };
                var saveRow = function() {
                  runForecast();
                };
                var resetRow = function() {
                  var resetHc = normalizeLegacyHeadcountMap(baseHc);
                  upsertOverrideForWo(r, function(base) {
                    return Object.assign({}, base, {
                      override_planned_cases: "",
                      override_cases_per_min: "",
                      override_line_name: "",
                      override_pack_type: "",
                      override_headcount_by_role: resetHc,
                      override_bucket_multiplier: { variable: 1, step_fixed: 1, fixed: 1 }
                    });
                  });
                  markRowDirty(rowKey);
                };
                return [
                    <tr key={rowKey + "-main"} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={!!selectedRows[rowKey]}
                          onChange={function(e) {
                            var checked = !!e.target.checked;
                            setSelectedRows(function(prev) {
                              var next = Object.assign({}, prev);
                              if (checked) next[rowKey] = true;
                              else delete next[rowKey];
                              return next;
                            });
                          }}
                        />
                      </td>
                      <td style={{ padding: "8px 6px", textAlign: "center" }}>
                        <button
                          type="button"
                          onClick={function() {
                            setExpandedRows(function(prev) {
                              var next = Object.assign({}, prev);
                              next[rowKey] = !prev[rowKey];
                              return next;
                            });
                          }}
                          className="rounded border border-[rgb(var(--border))] px-1 text-xs"
                        >
                          {isExpanded ? "-" : "+"}
                        </button>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600, position: "sticky", left: 0, zIndex: 3, background: C.surface, minWidth: 160 }}>{r.wo_code || "--"}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600, position: "sticky", left: 160, zIndex: 3, background: C.surface, minWidth: 120 }}>{r.sku}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, position: "sticky", left: 280, zIndex: 3, background: C.surface, minWidth: 320, maxWidth: 420 }}>{desc}</td>
                      <td style={{ padding: "8px 10px" }}>
                        <div className="flex flex-wrap gap-1">
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">Hours {safeNum(r.production_hours).toFixed(1)}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">$/Case {fmtMoney(safeNum(r.line_run_labor_cost) / Math.max(1, safeNum(r.planned_cases)))}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]">Labor% {fmtPct(safeNum(r.line_run_labor_cost) / Math.max(1, safeNum(r.revenue)))}</span>
                          <span className="rounded border border-[rgb(var(--border))] px-2 py-0.5 text-[11px]" style={{ color: deltaVsBase >= 0 ? C.bad : C.ok }}>Delta {fmtMoney(deltaVsBase)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>
                        <Input
                          type="number"
                          min="0"
                          step="1"
                          value={casesValue}
                          onChange={function(e) {
                            var v = e.target.value;
                            upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_planned_cases: v }); });
                            markRowDirty(rowKey);
                          }}
                          className="h-8 w-28 text-xs text-right"
                        />
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(safeNum(r.revenue_per_case || 0))}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.line_run_labor_cost)}</td>
                      <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.revenue)}</td>
                    </tr>,
                    isExpanded ? (
                      <tr key={rowKey + "-edit"} style={{ borderBottom: "1px solid " + C.border, background: C.surface }}>
                        <td colSpan={11} style={{ padding: "4px 10px 8px" }}>
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="text-xs font-medium text-[rgb(var(--muted))] pr-2">Headcount Inputs</div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Gen</div>
                              <Input type="number" step="0.1" value={hc.labor} onChange={function(e) { setRoleHeadcount("labor", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Op</div>
                              <Input type="number" step="0.1" value={hc.operator} onChange={function(e) { setRoleHeadcount("operator", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Fork</div>
                              <Input type="number" step="0.1" value={hc.fork} onChange={function(e) { setRoleHeadcount("fork", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">QA</div>
                              <Input type="number" step="0.1" value={hc.qa} onChange={function(e) { setRoleHeadcount("qa", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Maint</div>
                              <Input type="number" step="0.1" value={hc.maint} onChange={function(e) { setRoleHeadcount("maint", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Rec</div>
                              <Input type="number" step="0.1" value={hc.recycling} onChange={function(e) { setRoleHeadcount("recycling", e.target.value); }} className="h-8 w-16 text-xs text-right" />
                            </div>
                            <div className="ml-2 h-8 w-px bg-[rgb(var(--border))]" />
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Line</div>
                              <select
                                value={lineValue}
                                onChange={function(e) {
                                  var v = e.target.value;
                                  upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_line_name: v }); });
                                  markRowDirty(rowKey);
                                }}
                                className="h-8 w-28 rounded border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-2 text-xs"
                              >
                                {rowLines.map(function(line) { return <option key={line} value={line}>{line}</option>; })}
                              </select>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">Cases/Min</div>
                              <Input
                                type="number"
                                step="0.01"
                                value={(ov && ov.override_cases_per_min) || ""}
                                onChange={function(e) {
                                  var v = e.target.value;
                                  upsertOverrideForWo(r, function(base) { return Object.assign({}, base, { override_cases_per_min: v }); });
                                  markRowDirty(rowKey);
                                }}
                                className="h-8 w-20 text-xs text-right"
                                placeholder={safeNum(r.cases_per_min).toFixed(2)}
                              />
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] text-[rgb(var(--muted))]">&nbsp;</div>
                              <div className="flex items-center gap-1">
                                <Button size="sm" variant="outline" onClick={saveRow} disabled={loading || !isDirty}>Save</Button>
                                <Button size="sm" variant="outline" onClick={resetRow}>Reset</Button>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null
                ];
              })}
            </tbody>
          </table>
        </div>
      </TableShell>

      <div className="mb-2 mt-4 text-sm font-semibold text-[rgb(var(--foreground))]">Daily Forecast Targets</div>
      <div className="mb-2 text-xs text-[rgb(var(--muted))]">
        Daily targets are scoped to {dailyMonthLabel}. {dailyTargetsNote}
      </div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Day</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Forecast Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Actual Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Case Var</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Actual Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue Var</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Headcount Hours</th>
              </tr>
            </thead>
            <tbody>
              {!displayDaily.length && <tr><td colSpan={9} style={{ padding: 16, textAlign: "center", color: C.dim }}>No daily targets available.</td></tr>}
              {displayDaily.slice(0, 31).map(function(d) {
                var act = actualByDay[d.day_key] || { actual_cases: 0, actual_revenue: 0 };
                var caseVar = safeNum(act.actual_cases) - safeNum(d.planned_cases);
                var revVar = safeNum(act.actual_revenue) - safeNum(d.revenue);
                return (
                  <tr key={d.day_key} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright }}>{d.day_key}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(d.planned_cases).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(act.actual_cases).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: caseVar >= 0 ? C.ok : C.bad, textAlign: "right" }}>{caseVar.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(d.revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(act.actual_revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: revVar >= 0 ? C.ok : C.bad, textAlign: "right" }}>{fmtMoney(revVar)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(d.labor_cost)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(d.headcount_hours).toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableShell>
    </div>
  );
}
