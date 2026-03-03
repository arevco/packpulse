import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import TableShell from "../components/ui/table-shell";
import ProductionView from "./ProductionView";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
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

function fmtMoney(v) {
  return "$" + Math.round(safeNum(v)).toLocaleString();
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

function shiftDays(dateIso, n) {
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toIsoDateLocal(d);
}

function weekStart(dateIso) {
  var d = new Date(dateIso + "T00:00:00");
  var dow = d.getDay();
  var delta = dow === 0 ? -6 : 1 - dow; // monday start
  d.setDate(d.getDate() + delta);
  return toIsoDateLocal(d);
}

function monthStart(dateIso) {
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(1);
  return toIsoDateLocal(d);
}

function monthEnd(dateIso) {
  var d = new Date(dateIso + "T00:00:00");
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return toIsoDateLocal(d);
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

function compareRange(preset, range) {
  if (!range || !range.start || !range.end) return { start: "", end: "", label: "Previous Period" };
  if (preset === "today") {
    var d = shiftDays(range.start, -1);
    return { start: d, end: d, label: "Yesterday" };
  }
  if (preset === "yesterday") {
    var dd = shiftDays(range.start, -1);
    return { start: dd, end: dd, label: "Prior Day" };
  }
  if (preset === "this_week") {
    return { start: shiftDays(range.start, -7), end: shiftDays(range.end, -7), label: "Last Week" };
  }
  if (preset === "last_week") {
    return { start: shiftDays(range.start, -7), end: shiftDays(range.end, -7), label: "Prior Week" };
  }
  if (preset === "this_month") {
    var prevMonthEnd = shiftDays(range.start, -1);
    return { start: monthStart(prevMonthEnd), end: monthEnd(prevMonthEnd), label: "Last Month" };
  }
  if (preset === "last_month") {
    var lastMonthStart = monthStart(range.start);
    var priorMonthEnd = shiftDays(lastMonthStart, -1);
    return { start: monthStart(priorMonthEnd), end: monthEnd(priorMonthEnd), label: "Prior Month" };
  }
  var span = Math.max(1, daysInclusive(range.start, range.end));
  var prevEnd = shiftDays(range.start, -1);
  var prevStart = shiftDays(prevEnd, -(span - 1));
  return { start: prevStart, end: prevEnd, label: "Previous " + span + " days" };
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

function extractTagValue(notes, tag) {
  var n = String(notes || "");
  var re = new RegExp("\\[" + tag + ":([^\\]]+)\\]", "i");
  var m = n.match(re);
  return m && m[1] ? m[1].trim() : "";
}

export default function OperationsView({ productionSegments }) {
  const { C, mono } = useTheme();
  const [windowPreset, setWindowPreset] = useState("last_14");
  const initialRange = presetRange("last_14");
  const [rangeStart, setRangeStart] = useState(initialRange.start);
  const [rangeEnd, setRangeEnd] = useState(initialRange.end);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [trends, setTrends] = useState(null);
  const [inputs, setInputs] = useState([]);
  const [breakdown, setBreakdown] = useState({ rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0 });
  const [rates, setRates] = useState([
    { role: "labor", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "fork", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "qa", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "maint", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "recycling", hourly_rate: 20.1, markup_pct: 0.2 },
  ]);
  const [targets, setTargets] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showEntryModal, setShowEntryModal] = useState(false);
  const [showRecentLaborInputs, setShowRecentLaborInputs] = useState(false);

  const [entry, setEntry] = useState({
    date_et: toIsoDateET(new Date()),
    shift_label: "Shift 1 (7a-3p)",
    line_name: "Line 1",
    item_code: "",
    work_order_code: "",
    labor_count: 10,
    fork_count: 1.5,
    qa_count: 0.5,
    maint_count: 0.5,
    recycling_count: 0.5,
    hours_run_override: "",
    notes: "",
  });

  var range = useMemo(function() {
    if (windowPreset === "custom") {
      var start = rangeStart || initialRange.start;
      var end = rangeEnd || start;
      if (end < start) {
        var tmp = start; start = end; end = tmp;
      }
      return { start: start, end: end, fetchDays: Math.max(30, Math.min(180, daysInclusive(start, end) + 21)) };
    }
    return presetRange(windowPreset);
  }, [windowPreset, rangeStart, rangeEnd, initialRange.start, initialRange.end]);

  var applyPreset = function(nextPreset) {
    var cfg = presetRange(nextPreset);
    setWindowPreset(nextPreset);
    setRangeStart(cfg.start);
    setRangeEnd(cfg.end);
  };

  var setCustomStart = function(v) {
    setWindowPreset("custom");
    setRangeStart(v);
  };
  var setCustomEnd = function(v) {
    setWindowPreset("custom");
    setRangeEnd(v);
  };

  var loadAll = async function() {
    setLoading(true);
    setErr("");
    try {
      var fetchDays = range.fetchDays;
      var [tr, ip, cfg, br] = await Promise.all([
        fetch("/api/cache/production-trends?days=" + fetchDays, { credentials: "include" }),
        fetch("/api/ops/shift-inputs?days=" + fetchDays, { credentials: "include" }),
        fetch("/api/ops/config", { credentials: "include" }),
        fetch("/api/ops/production-breakdown?days=" + fetchDays, { credentials: "include" }),
      ]);
      var [trBody, ipBody, cfgBody, brBody] = await Promise.all([tr.json(), ip.json(), cfg.json(), br.json()]);
      if (!tr.ok) throw new Error(trBody.error || "Could not load production trends");
      if (!ip.ok) throw new Error(ipBody.error || "Could not load labor inputs");
      if (!cfg.ok) throw new Error(cfgBody.error || "Could not load rates/targets");
      if (!br.ok) throw new Error(brBody.error || "Could not load production breakdown");
      setTrends(trBody.trends || null);
      setInputs(Array.isArray(ipBody.rows) ? ipBody.rows : []);
      setRates(Array.isArray(cfgBody.rates) && cfgBody.rates.length ? cfgBody.rates : rates);
      setTargets(Array.isArray(cfgBody.skuTargets) ? cfgBody.skuTargets : []);
      setBreakdown({
        rowsLite: Array.isArray(brBody.rowsLite) ? brBody.rowsLite : [],
        bySku: Array.isArray(brBody.bySku) ? brBody.bySku : [],
        byLine: Array.isArray(brBody.byLine) ? brBody.byLine : [],
        latestByLine: Array.isArray(brBody.latestByLine) ? brBody.latestByLine : [],
        latestDate: brBody.latestDate || null,
        totalRows: safeNum(brBody.totalRows),
      });
    } catch (e) {
      setErr(e && e.message ? e.message : "Failed loading Operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(function() {
    loadAll();
  }, [windowPreset, rangeStart, rangeEnd]);

  var targetBySku = useMemo(function() {
    var map = {};
    targets.forEach(function(t) {
      var k = String(t.item_code || "").trim();
      if (!k) return;
      if (!map[k]) map[k] = t;
    });
    return map;
  }, [targets]);

  var filteredTrends = useMemo(function() {
    var byDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay.filter(function(r) { return inRange(String(r.date || ""), range); }) : [];
    var byShift = (trends && Array.isArray(trends.byShift)) ? trends.byShift.filter(function(r) { return inRange(String(r.date || ""), range); }) : [];
    return { byDay: byDay, byShift: byShift, fromDate: range.start };
  }, [trends, range]);

  var filteredInputs = useMemo(function() {
    return (inputs || []).filter(function(r) { return inRange(String(r.date_et || ""), range); });
  }, [inputs, range]);

  var filteredBreakdown = useMemo(function() {
    var rows = (breakdown && Array.isArray(breakdown.rowsLite)) ? breakdown.rowsLite.filter(function(r) { return inRange(String(r.produced_date_et || ""), range); }) : [];
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
  }, [breakdown, range]);

  var periodCompare = useMemo(function() {
    var allByDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay : [];
    var allByShift = (trends && Array.isArray(trends.byShift)) ? trends.byShift : [];
    var prior = compareRange(windowPreset, range);

    var currentUnits = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, range) ? (sum + safeNum(d.units)) : sum;
    }, 0);
    var priorUnits = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, prior) ? (sum + safeNum(d.units)) : sum;
    }, 0);
    var currentRows = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, range) ? (sum + safeNum(d.rows)) : sum;
    }, 0);
    var priorRows = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, prior) ? (sum + safeNum(d.rows)) : sum;
    }, 0);

    var currentShift1 = 0;
    var priorShift1 = 0;
    var currentShift2 = 0;
    var priorShift2 = 0;
    allByShift.forEach(function(r) {
      var date = String(r.date || "");
      var shift = String(r.shift || "");
      var units = safeNum(r.units);
      if (shift.indexOf("Shift 1") !== -1) {
        if (inRangeIso(date, range)) currentShift1 += units;
        if (inRangeIso(date, prior)) priorShift1 += units;
      }
      if (shift.indexOf("Shift 2") !== -1) {
        if (inRangeIso(date, range)) currentShift2 += units;
        if (inRangeIso(date, prior)) priorShift2 += units;
      }
    });

    var delta = currentUnits - priorUnits;
    var deltaPct = priorUnits > 0 ? Math.round((delta / priorUnits) * 100) : 0;
    return {
      labelCurrent: windowPreset === "today" ? "Today" :
        windowPreset === "yesterday" ? "Yesterday" :
        windowPreset === "this_week" ? "This Week" :
        windowPreset === "last_week" ? "Last Week" :
        windowPreset === "this_month" ? "This Month" :
        windowPreset === "last_month" ? "Last Month" :
        windowPreset === "custom" ? (range.start + " to " + range.end) :
        "Selected Window",
      labelPrior: prior.label,
      priorRange: prior.start && prior.end ? (prior.start + " to " + prior.end) : "--",
      currentUnits: currentUnits,
      priorUnits: priorUnits,
      currentRows: currentRows,
      priorRows: priorRows,
      currentShift1: currentShift1,
      priorShift1: priorShift1,
      currentShift2: currentShift2,
      priorShift2: priorShift2,
      delta: delta,
      deltaPct: deltaPct
    };
  }, [trends, windowPreset, range]);

  var metrics = useMemo(function() {
    var byDay = filteredTrends.byDay || [];
    var byShift = filteredTrends.byShift || [];
    var totalUnits = byDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
    var avgDailyUnits = byDay.length ? Math.round(totalUnits / byDay.length) : 0;
    var today = toIsoDateET(new Date());
    var expectedShifts = businessDaysBetween(filteredTrends.fromDate, range.end || today) * 2;
    var shiftKeySet = {};
    filteredInputs.forEach(function(r) {
      var key = String(r.date_et || "") + "|" + String(r.shift_label || "");
      if (r.date_et && r.shift_label) shiftKeySet[key] = true;
    });
    var enteredShifts = Object.keys(shiftKeySet).length;
    var coveragePct = expectedShifts > 0 ? Math.round((enteredShifts / expectedShifts) * 100) : 0;

    var ratesByRole = {};
    rates.forEach(function(r) {
      ratesByRole[String(r.role || "").toLowerCase()] = {
        hourly: safeNum(r.hourly_rate),
        markup: safeNum(r.markup_pct),
      };
    });
    var laborCost = 0;
    filteredInputs.forEach(function(r) {
      var hrs = r.hours_run_override == null || r.hours_run_override === "" ? 8 : safeNum(r.hours_run_override);
      var roleHours = {
        labor: safeNum(r.labor_count) * hrs,
        fork: safeNum(r.fork_count) * hrs,
        qa: safeNum(r.qa_count) * hrs,
        maint: safeNum(r.maint_count) * hrs,
        recycling: safeNum(r.recycling_count) * hrs,
      };
      Object.keys(roleHours).forEach(function(role) {
        var rt = ratesByRole[role] || { hourly: 0, markup: 0 };
        laborCost += roleHours[role] * rt.hourly * (1 + rt.markup);
      });
    });

    var estimatedRevenue = filteredBreakdown.bySku.reduce(function(sum, s) {
      var k = String(s.item_code || "").trim();
      var t = targetBySku[k];
      if (!t) return sum;
      return sum + safeNum(s.units) * safeNum(t.revenue_per_case);
    }, 0);
    var mappedSkuCount = filteredBreakdown.bySku.filter(function(s) { return !!targetBySku[String(s.item_code || "").trim()]; }).length;
    var unmappedSkuCount = Math.max(0, filteredBreakdown.bySku.length - mappedSkuCount);

    return {
      totalUnits: totalUnits,
      avgDailyUnits: avgDailyUnits,
      enteredShifts: enteredShifts,
      expectedShifts: expectedShifts,
      coveragePct: coveragePct,
      laborCost: laborCost,
      estimatedRevenue: estimatedRevenue,
      mappedSkuCount: mappedSkuCount,
      unmappedSkuCount: unmappedSkuCount,
      byShift: byShift,
    };
  }, [filteredTrends, filteredInputs, rates, filteredBreakdown, targetBySku, range.end]);

  var topSku = useMemo(function() {
    return filteredBreakdown.bySku.slice(0, 10).map(function(s) {
      var t = targetBySku[String(s.item_code || "").trim()];
      return {
        item_code: s.item_code,
        units: safeNum(s.units),
        estRev: t ? safeNum(t.revenue_per_case) * safeNum(s.units) : null,
      };
    });
  }, [filteredBreakdown, targetBySku]);

  var commandBoard = useMemo(function() {
    var byDay = filteredTrends.byDay || [];
    var dayCount = byDay.length;
    var latest = byDay.length ? byDay[0] : null;
    var latestRows = latest ? safeNum(latest.rows) : 0;
    var windowActual = safeNum(metrics.totalUnits);

    // Baseline plan = avg daily output from days outside the current window, scaled to current window size.
    // Fallback to current-window avg when there is no older data loaded.
    var allDays = (trends && Array.isArray(trends.byDay)) ? trends.byDay : [];
    var inWindow = {};
    byDay.forEach(function(d) { inWindow[String(d.date || "")] = true; });
    var priorDays = allDays.filter(function(d) { return !inWindow[String(d.date || "")]; });
    var priorSlice = dayCount > 0 ? priorDays.slice(0, dayCount) : [];
    var priorAvg = priorSlice.length
      ? Math.round(priorSlice.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorSlice.length)
      : safeNum(metrics.avgDailyUnits);
    var planUnits = dayCount > 0 ? Math.round(priorAvg * dayCount) : 0;
    var variance = windowActual - planUnits;

    var status = "On Track";
    if (planUnits > 0) {
      var ratio = windowActual / planUnits;
      if (ratio < 0.85) status = "Off Track";
      else if (ratio < 0.95) status = "At Risk";
    }
    var topLine = (filteredBreakdown.byLine && filteredBreakdown.byLine[0]) || null;
    return {
      latestDate: latest ? latest.date : null,
      latestUnits: windowActual,
      latestRows: latestRows,
      dayCount: dayCount,
      planUnits: planUnits,
      variance: variance,
      variancePct: pctDelta(windowActual, planUnits),
      status: status,
      topLine: topLine
    };
  }, [filteredTrends, metrics, filteredBreakdown.byLine, trends]);

  var shiftPlanVsActual = useMemo(function() {
    var rows = (filteredTrends.byShift || []).slice();
    var byDate = {};
    rows.forEach(function(r) {
      var date = String(r.date || "");
      if (!date) return;
      var shift = String(r.shift || "Unassigned");
      if (!byDate[date]) byDate[date] = { date: date, s1: 0, s2: 0, un: 0, total: 0 };
      var units = safeNum(r.units);
      if (shift.indexOf("Shift 1") !== -1) byDate[date].s1 += units;
      else if (shift.indexOf("Shift 2") !== -1) byDate[date].s2 += units;
      else byDate[date].un += units;
      byDate[date].total += units;
    });
    var dayRows = Object.values(byDate).sort(function(a, b) { return a.date.localeCompare(b.date); });
    var priorDays = (trends && Array.isArray(trends.byDay)) ? trends.byDay.filter(function(d) {
      var date = String(d.date || "");
      return date && date < range.start;
    }) : [];
    var baselineDaily = priorDays.length
      ? Math.round(priorDays.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorDays.length)
      : (metrics.avgDailyUnits || 0);
    var max = dayRows.reduce(function(m, r) { return Math.max(m, r.total, baselineDaily); }, 0) || 1;
    return {
      rows: dayRows.map(function(r) {
        var total = Math.max(1, r.total);
        var totalPct = Math.round((r.total / max) * 100);
        var s1PctOfTotal = Math.round((r.s1 / total) * 100);
        var s2PctOfTotal = Math.round((r.s2 / total) * 100);
        var unPctOfTotal = Math.max(0, 100 - s1PctOfTotal - s2PctOfTotal);
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
          plan: baselineDaily,
          planPct: Math.round((baselineDaily / max) * 100)
        };
      }),
      max: max
    };
  }, [filteredTrends.byShift, trends, range.start, metrics.avgDailyUnits]);

  var dailyPlanVsActual = useMemo(function() {
    var rows = (filteredTrends.byDay || []).slice().sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    if (!rows.length) return { rows: [], max: 1 };
    var priorDays = (trends && Array.isArray(trends.byDay)) ? trends.byDay.filter(function(d) {
      var date = String(d.date || "");
      return date && date < range.start;
    }) : [];
    var baselineDaily = priorDays.length
      ? Math.round(priorDays.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0) / priorDays.length)
      : (metrics.avgDailyUnits || 0);
    var max = rows.reduce(function(m, r) {
      return Math.max(m, safeNum(r.units), baselineDaily);
    }, 0) || 1;
    return {
      rows: rows.map(function(r) {
        var actual = safeNum(r.units);
        return {
          date: String(r.date || ""),
          actual: actual,
          plan: baselineDaily,
          actualPct: Math.round((actual / max) * 100),
          planPct: Math.round((baselineDaily / max) * 100),
          variance: actual - baselineDaily
        };
      }),
      max: max
    };
  }, [filteredTrends.byDay, trends, range.start, metrics.avgDailyUnits]);

  var linePerformance = useMemo(function() {
    var laborByLine = {};
    filteredInputs.forEach(function(r) {
      var line = String(r.line_name || "Unknown");
      if (!laborByLine[line]) laborByLine[line] = { laborHours: 0, shifts: 0 };
      var hrs = r.hours_run_override == null || r.hours_run_override === "" ? 8 : safeNum(r.hours_run_override);
      var heads = safeNum(r.labor_count) + safeNum(r.fork_count) + safeNum(r.qa_count) + safeNum(r.maint_count) + safeNum(r.recycling_count);
      laborByLine[line].laborHours += heads * hrs;
      laborByLine[line].shifts += 1;
    });
    var rows = (filteredBreakdown.byLine || []).map(function(l) {
      var line = String(l.line || "Unknown");
      var labor = laborByLine[line] ? laborByLine[line].laborHours : 0;
      var shifts = laborByLine[line] ? laborByLine[line].shifts : 0;
      var units = safeNum(l.units);
      var cplh = labor > 0 ? units / labor : 0;
      var avgPerShift = shifts > 0 ? units / shifts : 0;
      var latest = (filteredBreakdown.latestByLine || []).find(function(x) { return String(x.line || "") === line; });
      var latestUnits = latest ? safeNum(latest.units) : 0;
      var attainment = avgPerShift > 0 ? Math.round((latestUnits / avgPerShift) * 100) : 0;
      return {
        line: line,
        units: units,
        laborHours: labor,
        cplh: cplh,
        avgPerShift: avgPerShift,
        latestUnits: latestUnits,
        attainment: attainment
      };
    }).sort(function(a, b) { return b.latestUnits - a.latestUnits; });
    return rows;
  }, [filteredBreakdown.byLine, filteredBreakdown.latestByLine, filteredInputs]);

  var lineOptions = useMemo(function() {
    var set = new Set();
    ["Line 1", "Line 2", "Line 3", "Line 4"].forEach(function(l) { set.add(l); });
    (filteredBreakdown.byLine || []).forEach(function(r) { if (r && r.line) set.add(String(r.line)); });
    (inputs || []).forEach(function(r) { if (r && r.line_name) set.add(String(r.line_name)); });
    return Array.from(set).sort();
  }, [filteredBreakdown.byLine, inputs]);

  var skuOptions = useMemo(function() {
    return (filteredBreakdown.bySku || []).map(function(r) { return String(r.item_code || "").trim(); }).filter(Boolean).slice(0, 500);
  }, [filteredBreakdown.bySku]);

  async function saveShiftInput() {
    setSaving(true);
    setErr("");
    try {
      var noteParts = [];
      if (entry.item_code) noteParts.push("[SKU:" + String(entry.item_code).trim() + "]");
      if (entry.work_order_code) noteParts.push("[WO:" + String(entry.work_order_code).trim() + "]");
      var plainNotes = String(entry.notes || "").trim();
      if (plainNotes) noteParts.push(plainNotes);
      var payload = Object.assign({}, entry, {
        notes: noteParts.join(" ").trim()
      });
      var resp = await fetch("/api/ops/shift-inputs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      var body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Could not save shift input");
      await loadAll();
      setShowEntryModal(false);
      setEntry(function(prev) {
        return Object.assign({}, prev, {
          item_code: "",
          work_order_code: "",
          notes: ""
        });
      });
    } catch (e) {
      setErr(e && e.message ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveRates() {
    setSaving(true);
    setErr("");
    try {
      var resp = await fetch("/api/ops/config", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: rates })
      });
      var body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Could not save rates");
      await loadAll();
    } catch (e) {
      setErr(e && e.message ? e.message : "Save rates failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-[rgb(var(--muted))]">Operations Window</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: "today", label: "Today" },
            { key: "yesterday", label: "Yesterday" },
            { key: "this_week", label: "This Week" },
            { key: "last_week", label: "Last Week" },
            { key: "this_month", label: "This Month" },
            { key: "last_month", label: "Last Month" }
          ].map(function(p) {
            return (
              <Button
                key={p.key}
                variant={windowPreset === p.key ? "active" : "outline"}
                size="sm"
                onClick={function() { applyPreset(p.key); }}
              >
                {p.label}
              </Button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="date" value={range.start} onChange={function(e) { setCustomStart(e.target.value); }} className="h-10 w-[150px]" />
          <span className="text-xs text-[rgb(var(--muted))]">to</span>
          <Input type="date" value={range.end} onChange={function(e) { setCustomEnd(e.target.value); }} className="h-10 w-[150px]" />
          <span className="text-xs text-[rgb(var(--muted))]">{windowPreset === "custom" ? "Custom range" : (range.start + " to " + range.end)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading || saving}>Refresh</Button>
        {loading && <span className="text-xs text-[rgb(var(--muted))]">Loading…</span>}
      </div>

      {err && <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{err}</Card>}

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-8 px-4 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Shift Command Board</div>
              <div className="text-xs text-[rgb(var(--muted))]">
                {commandBoard.dayCount > 1
                  ? ("Window: " + range.start + " to " + range.end + " · " + commandBoard.dayCount + " production day" + (commandBoard.dayCount === 1 ? "" : "s"))
                  : commandBoard.latestDate
                    ? ("Day: " + commandBoard.latestDate)
                    : "No production day available yet"}
              </div>
            </div>
            <span className={"inline-flex rounded-full px-2.5 py-1 text-xs font-semibold " + (commandBoard.status === "Off Track" ? "bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]" : commandBoard.status === "At Risk" ? "bg-[rgb(var(--accent-soft))] text-[rgb(var(--accent))]" : "bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]")}>
              {commandBoard.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.latestUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Actual Cases</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.planUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Baseline Plan</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className={"text-xl font-bold [font-variant-numeric:tabular-nums] " + (commandBoard.variance < 0 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>
                {commandBoard.variance >= 0 ? "+" : ""}{commandBoard.variance.toLocaleString()}
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">Variance ({commandBoard.variancePct >= 0 ? "+" : ""}{commandBoard.variancePct}%)</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.topLine ? commandBoard.topLine.line : "--"}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Top Line ({commandBoard.topLine ? commandBoard.topLine.units.toLocaleString() : "--"} cases in window)</div>
            </div>
          </div>
          <div className="mt-3 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2.5">
            <div className="mb-1.5 text-xs font-semibold text-[rgb(var(--muted))]">
              Compare: {periodCompare.labelCurrent} vs {periodCompare.labelPrior}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <div className="text-xs text-[rgb(var(--muted))]">
                <div className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{periodCompare.currentUnits.toLocaleString()}</div>
                <div>{periodCompare.labelCurrent} cases</div>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                <div className="font-semibold text-[rgb(var(--foreground))] [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{periodCompare.priorUnits.toLocaleString()}</div>
                <div>{periodCompare.labelPrior} cases</div>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                <div className={"font-semibold [font-variant-numeric:tabular-nums] " + (periodCompare.delta < 0 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>
                  {periodCompare.delta >= 0 ? "+" : ""}{periodCompare.delta.toLocaleString()}
                </div>
                <div>Case delta</div>
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">
                <div className={"font-semibold [font-variant-numeric:tabular-nums] " + (periodCompare.deltaPct < 0 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>
                  {periodCompare.deltaPct >= 0 ? "+" : ""}{periodCompare.deltaPct}%
                </div>
                <div>Percent delta</div>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-[rgb(var(--muted))]">
              Prior window: {periodCompare.priorRange}
            </div>
          </div>
        </Card>

        <Card className="lg:col-span-4 px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Operations KPI</div>
          <div className="space-y-2">
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{metrics.totalUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Cases Produced ({windowPreset === "today" ? "today" : windowPreset === "yesterday" ? "yesterday" : windowPreset === "this_week" ? "this week" : windowPreset === "last_week" ? "last week" : range.start + " to " + range.end})</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{metrics.avgDailyUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Avg Cases / Day</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{metrics.coveragePct}%</div>
              <div className="text-xs text-[rgb(var(--muted))]">Labor Input Coverage ({metrics.enteredShifts}/{metrics.expectedShifts} shifts)</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{fmtMoney(metrics.laborCost)}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Estimated Labor Cost</div>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-12 px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Daily Production Yield</div>
          <div className="flex h-52 items-end gap-2 overflow-x-auto">
            {dailyPlanVsActual.rows.map(function(r) {
              return (
                <div key={r.date} className="flex min-w-[42px] flex-col items-center gap-1">
                  <div className="relative h-36 w-7">
                    <div className="absolute inset-x-0 bottom-0 rounded-t bg-[rgb(var(--accent))]" style={{ height: Math.max(8, Math.round((r.actualPct / 100) * 132)) + "px", opacity: 0.9 }} />
                    <div className="absolute inset-x-0 border-t-2 border-dashed border-[rgb(var(--muted))]" style={{ bottom: Math.max(8, Math.round((r.planPct / 100) * 132)) + "px" }} />
                  </div>
                  <div className="text-[10px] text-[rgb(var(--muted))]">{r.date ? r.date.slice(5) : "--"}</div>
                </div>
              );
            })}
            {!dailyPlanVsActual.rows.length && (
              <div className="w-full self-center text-center text-sm text-[rgb(var(--muted))]">No daily production data in selected window.</div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--accent))]" />Actual daily yield</span>
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Baseline daily plan</span>
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7 px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Shift Mix by Day</div>
          <div className="flex h-52 items-end gap-2 overflow-x-auto">
            {shiftPlanVsActual.rows.map(function(r) {
              return (
                <div key={r.date} className="flex min-w-[38px] flex-col items-center gap-1">
                  <div className="relative h-36 w-6">
                    <div className="absolute inset-x-0 bottom-0 rounded-t bg-[rgb(var(--muted))/0.3]" style={{ height: Math.max(2, Math.round((r.unPct / 100) * 132)) + "px" }} />
                    <div className="absolute inset-x-0 rounded-t bg-[rgb(var(--accent))/0.7]" style={{ bottom: Math.max(2, Math.round((r.unPct / 100) * 132)) + "px", height: Math.max(2, Math.round((r.s2Pct / 100) * 132)) + "px" }} />
                    <div className="absolute inset-x-0 rounded-t bg-[rgb(var(--accent))]" style={{ bottom: Math.max(2, Math.round(((r.unPct + r.s2Pct) / 100) * 132)) + "px", height: Math.max(2, Math.round((r.s1Pct / 100) * 132)) + "px" }} />
                    <div className="absolute inset-x-0 border-t-2 border-dashed border-[rgb(var(--muted))]" style={{ bottom: Math.max(8, Math.round((r.planPct / 100) * 132)) + "px" }} />
                  </div>
                  <div className="text-[10px] text-[rgb(var(--muted))]">{r.date ? r.date.slice(5) : "--"}</div>
                </div>
              );
            })}
            {!shiftPlanVsActual.rows.length && (
              <div className="w-full self-center text-center text-sm text-[rgb(var(--muted))]">No shift production data in selected window.</div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--accent))]" />Shift 1</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--accent))/0.7]" />Shift 2</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--muted))/0.3]" />Unassigned</span>
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Baseline daily plan</span>
          </div>
        </Card>

        <Card className="lg:col-span-5 px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Line Performance (Latest Day vs Baseline)</div>
          <TableShell>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Today</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Attain</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Cases/LH</th>
                </tr>
              </thead>
              <tbody>
                {linePerformance.slice(0, 8).map(function(r) {
                  return (
                    <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                      <td className="px-2 py-2 text-sm">{r.line}</td>
                      <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{Math.round(r.latestUnits).toLocaleString()}</td>
                      <td className={"px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] " + (r.attainment < 90 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>
                        {r.attainment ? r.attainment + "%" : "--"}
                      </td>
                      <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{r.cplh ? r.cplh.toFixed(1) : "--"}</td>
                    </tr>
                  );
                })}
                {!linePerformance.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line performance data yet.</td></tr>}
              </tbody>
            </table>
          </TableShell>
          <div className="mt-2 text-xs text-[rgb(var(--muted))]">Attainment compares latest day output to each line's average output per entered shift.</div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-7 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Shift Inputs</div>
              <div className="text-xs text-[rgb(var(--muted))]">Managers can add line-level labor entries without editing dashboard settings.</div>
            </div>
            <Button onClick={function() { setShowEntryModal(true); }} disabled={saving}>{saving ? "Saving..." : "Add Shift Entry"}</Button>
          </div>
          <div className="mt-3 text-xs text-[rgb(var(--muted))]">
            Labor rates are managed separately and usually remain constant.
          </div>
        </Card>

        <Card className="lg:col-span-5 px-4 py-4">
          <details>
            <summary className="cursor-pointer text-sm font-semibold">Labor Rate Settings</summary>
            <div className="mt-3 space-y-2">
              {rates.map(function(r, idx) {
                return (
                  <div key={r.role + idx} className="grid grid-cols-[120px_1fr_1fr] gap-2">
                    <div className="flex items-center text-sm capitalize">{r.role}</div>
                    <Input type="number" step="0.01" value={r.hourly_rate} onChange={function(e){
                      var next = rates.slice();
                      next[idx] = Object.assign({}, next[idx], { hourly_rate: e.target.value });
                      setRates(next);
                    }} placeholder="Hourly rate" />
                    <Input type="number" step="0.01" value={r.markup_pct} onChange={function(e){
                      var next = rates.slice();
                      next[idx] = Object.assign({}, next[idx], { markup_pct: e.target.value });
                      setRates(next);
                    }} placeholder="Markup (0.2 = 20%)" />
                  </div>
                );
              })}
              <div className="mt-3">
                <Button variant="outline" onClick={saveRates} disabled={saving}>{saving ? "Saving..." : "Save Rates"}</Button>
              </div>
            </div>
          </details>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Top SKU Mix (Units)</div>
          <TableShell>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ background:C.raised }}>
                <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">SKU</th>
                <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Units</th>
                <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Est Revenue</th>
              </tr></thead>
              <tbody>
                {topSku.map(function(s, i) {
                  return <tr key={s.item_code + i} style={{ borderBottom:"1px solid " + C.border }}>
                    <td className="px-2 py-2 text-sm">{s.item_code}</td>
                    <td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{s.units.toLocaleString()}</td>
                    <td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono, color: s.estRev == null ? C.dim : C.ok }}>{s.estRev == null ? "--" : fmtMoney(s.estRev)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </TableShell>
          <div className="mt-2 text-xs text-[rgb(var(--muted))]">SKU targets mapped: {metrics.mappedSkuCount} | unmapped: {metrics.unmappedSkuCount}</div>
        </Card>

        <Card className="px-4 py-4">
          <button
            type="button"
            onClick={function() { setShowRecentLaborInputs(function(v) { return !v; }); }}
            className="mb-2 flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-semibold">Recent Labor Inputs</span>
            <span className="text-xs text-[rgb(var(--muted))]">{showRecentLaborInputs ? "Hide" : "Show"}</span>
          </button>
          {showRecentLaborInputs && (
            <TableShell>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.raised }}>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Date</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Shift</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">SKU</th>
                  <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">WO</th>
                  <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Total HC</th>
                </tr></thead>
                <tbody>
                  {inputs.slice(0, 12).map(function(r, i) {
                    var total = safeNum(r.labor_count) + safeNum(r.fork_count) + safeNum(r.qa_count) + safeNum(r.maint_count) + safeNum(r.recycling_count);
                    var sku = extractTagValue(r.notes, "SKU");
                    var wo = extractTagValue(r.notes, "WO");
                    return <tr key={i} style={{ borderBottom:"1px solid " + C.border }}>
                      <td className="px-2 py-2 text-sm">{r.date_et}</td>
                      <td className="px-2 py-2 text-sm">{r.shift_label}</td>
                      <td className="px-2 py-2 text-sm">{r.line_name}</td>
                      <td className="px-2 py-2 text-sm">{sku || "--"}</td>
                      <td className="px-2 py-2 text-sm">{wo || "--"}</td>
                      <td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{total}</td>
                    </tr>;
                  })}
                  {!inputs.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No labor inputs saved yet.</td></tr>}
                </tbody>
              </table>
            </TableShell>
          )}
        </Card>
      </div>

      <Card className="px-4 py-4">
        <div className="mb-2 text-sm font-semibold">Production Jobs</div>
        <div className="text-xs text-[rgb(var(--muted))] mb-3">
          Job-level production detail is now consolidated here for shift execution and performance review.
        </div>
        <ProductionView productionSegments={productionSegments} />
      </Card>

      {showEntryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={function() { if (!saving) setShowEntryModal(false); }}>
          <Card className="w-full max-w-4xl px-4 py-4" onClick={function(e) { e.stopPropagation(); }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold">Add Shift Entry</div>
                <div className="text-xs text-[rgb(var(--muted))]">Capture day, shift, line, SKU, and labor for manager reporting.</div>
              </div>
              <Button variant="outline" onClick={function() { if (!saving) setShowEntryModal(false); }} disabled={saving}>Close</Button>
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <Input type="date" value={entry.date_et} onChange={function(e){ setEntry(Object.assign({}, entry, { date_et: e.target.value })); }} />
              <select value={entry.shift_label} onChange={function(e){ setEntry(Object.assign({}, entry, { shift_label: e.target.value })); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm">
                <option>Shift 1 (7a-3p)</option>
                <option>Shift 2 (3p-11p)</option>
              </select>
              <select value={entry.line_name} onChange={function(e){ setEntry(Object.assign({}, entry, { line_name: e.target.value })); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm">
                {lineOptions.map(function(line) { return <option key={line} value={line}>{line}</option>; })}
              </select>
              <Input value={entry.item_code} onChange={function(e){ setEntry(Object.assign({}, entry, { item_code: e.target.value })); }} placeholder="SKU (optional)" list="ops-sku-list" />
              <datalist id="ops-sku-list">
                {skuOptions.map(function(sku) { return <option key={sku} value={sku} />; })}
              </datalist>
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
              <Input value={entry.work_order_code} onChange={function(e){ setEntry(Object.assign({}, entry, { work_order_code: e.target.value })); }} placeholder="Work Order (optional)" />
              <Input type="number" step="0.5" value={entry.labor_count} onChange={function(e){ setEntry(Object.assign({}, entry, { labor_count: e.target.value })); }} placeholder="Labor" />
              <Input type="number" step="0.5" value={entry.fork_count} onChange={function(e){ setEntry(Object.assign({}, entry, { fork_count: e.target.value })); }} placeholder="Fork" />
              <Input type="number" step="0.5" value={entry.qa_count} onChange={function(e){ setEntry(Object.assign({}, entry, { qa_count: e.target.value })); }} placeholder="QA" />
              <Input type="number" step="0.5" value={entry.maint_count} onChange={function(e){ setEntry(Object.assign({}, entry, { maint_count: e.target.value })); }} placeholder="Maint" />
              <Input type="number" step="0.5" value={entry.recycling_count} onChange={function(e){ setEntry(Object.assign({}, entry, { recycling_count: e.target.value })); }} placeholder="Recycling" />
              <Input type="number" step="0.25" value={entry.hours_run_override} onChange={function(e){ setEntry(Object.assign({}, entry, { hours_run_override: e.target.value })); }} placeholder="Hours Run (optional)" />
              <Input value={entry.notes} onChange={function(e){ setEntry(Object.assign({}, entry, { notes: e.target.value })); }} placeholder="Notes (optional)" />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button onClick={saveShiftInput} disabled={saving}>{saving ? "Saving..." : "Save Shift Entry"}</Button>
              <span className="text-xs text-[rgb(var(--muted))]">Wages use Labor Rate Settings and generally remain constant.</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
