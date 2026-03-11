import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";
import ProductionView from "./ProductionView";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../components/ui/chart";
import { detectPackType } from "../utils";

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
    "rgb(var(--accent))",
    "color-mix(in oklab, rgb(var(--accent)) 80%, white)",
    "color-mix(in oklab, rgb(var(--success)) 85%, white)",
    "color-mix(in oklab, rgb(var(--warning)) 85%, white)",
    "color-mix(in oklab, rgb(var(--danger)) 85%, white)",
    "color-mix(in oklab, rgb(var(--muted)) 55%, white)",
  ];
  return palette[index % palette.length];
}

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
      "Actual Job End", "actual_job_end_at",
      "Produced At", "produced_at", "Produced date", "producedAt",
      "Actual Job Start", "actual_job_start_at"
    ]);
    var date = toIsoDateET(producedRaw || new Date());
    if (!date) return;
    var shift = "Unassigned";
    var dt = new Date(producedRaw || "");
    if (!isNaN(dt)) {
      var hrFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false });
      var hour = parseInt(hrFmt.format(dt), 10);
      if (hour >= 7 && hour < 15) shift = "Shift 1 (7a-3p)";
      else if (hour >= 15 && hour < 23) shift = "Shift 2 (3p-11p)";
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

export default function OperationsView({ productionSegments, productionDataRaw, evoconData, evoconTimestamp, itemMaster, initialFilters, onPermalinkChange }) {
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
  const [showTopSkuMix, setShowTopSkuMix] = useState(false);
  const [showWindowCompare, setShowWindowCompare] = useState(false);
  const [skuMixMode, setSkuMixMode] = useState("type");
  const [evoconRole, setEvoconRole] = useState("manager");

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

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      preset: windowPreset,
      start: rangeStart,
      end: rangeEnd
    });
  }, [onPermalinkChange, windowPreset, rangeStart, rangeEnd]);

  var applyPreset = function(nextPreset) {
    var cfg = presetRange(nextPreset);
    setWindowPreset(nextPreset);
    setRangeStart(cfg.start);
    setRangeEnd(cfg.end);
  };

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

  var normalizeSkuKey = function(v) {
    return String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  };

  var targetBySku = useMemo(function() {
    var map = {};
    targets.forEach(function(t) {
      var raw = String(t.item_code || "").trim();
      if (!raw) return;
      var rev = safeNum(t.revenue_per_case);
      if (!(rev > 0)) return;
      var norm = normalizeSkuKey(raw);
      var payload = {
        revenue_per_case: rev,
        target_cases_per_hour: safeNum(t.target_cases_per_hour),
        source: "ops_target"
      };
      if (!map[raw]) map[raw] = payload;
      if (norm && !map[norm]) map[norm] = payload;
    });
    return map;
  }, [targets]);

  var itemMasterPriceBySku = useMemo(function() {
    var rows = Array.isArray(itemMaster) ? itemMaster : [];
    var map = {};
    rows.forEach(function(r) {
      var rawSku = pickFieldLooseLocal(r, ["Item Code", "Code", "item_code", "code"]);
      var raw = String(rawSku || "").trim();
      if (!raw) return;
      var fgRaw = String(pickFieldLooseLocal(r, ["Is Finished Good", "is_finished_good"]) || "").trim().toLowerCase();
      if (fgRaw && !(fgRaw === "true" || fgRaw === "1" || fgRaw === "yes" || fgRaw === "y")) return;
      var cost = safeNum(pickFieldLooseLocal(r, [
        "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
        "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
      ]));
      if (!(cost > 0)) return;
      var norm = normalizeSkuKey(raw);
      if (!map[raw]) map[raw] = cost;
      if (norm && !map[norm]) map[norm] = cost;
    });
    return map;
  }, [itemMaster]);

  var revenueTargetForSku = function(itemCode) {
    var raw = String(itemCode || "").trim();
    if (!raw) return null;
    var norm = normalizeSkuKey(raw);
    var manual = targetBySku[raw] || (norm ? targetBySku[norm] : null);
    if (manual && safeNum(manual.revenue_per_case) > 0) return manual;
    var imCost = itemMasterPriceBySku[raw] || (norm ? itemMasterPriceBySku[norm] : 0);
    if (safeNum(imCost) > 0) {
      return { revenue_per_case: safeNum(imCost), target_cases_per_hour: 0, source: "item_master_cost" };
    }
    return null;
  };

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
    var hasSegmentData = fromSegments.trends.byDay.length > 0 || fromSegments.breakdown.rowsLite.length > 0;
    if (hasSegmentData) return fromSegments;
    return fromRaw;
  }, [productionSegments, productionDataRaw]);

  var evoconSeries = useMemo(function() {
    return buildEvoconSeries(evoconData || []);
  }, [evoconData]);

  var effectiveTrends = useMemo(function() {
    var cacheByDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay : [];
    var cacheByShift = (trends && Array.isArray(trends.byShift)) ? trends.byShift : [];
    var rawByDay = (localNulogySeries && localNulogySeries.trends && Array.isArray(localNulogySeries.trends.byDay)) ? localNulogySeries.trends.byDay : [];
    var rawByShift = (localNulogySeries && localNulogySeries.trends && Array.isArray(localNulogySeries.trends.byShift)) ? localNulogySeries.trends.byShift : [];
    var hasCache = cacheByDay.length > 0 || cacheByShift.length > 0;
    if (hasCache) return { byDay: cacheByDay, byShift: cacheByShift };
    var hasRaw = rawByDay.length > 0 || rawByShift.length > 0;
    if (hasRaw) return { byDay: rawByDay, byShift: rawByShift };
    return { byDay: [], byShift: [] };
  }, [trends, localNulogySeries]);

  var effectiveBreakdown = useMemo(function() {
    var fallbackN = (localNulogySeries && localNulogySeries.breakdown) ? localNulogySeries.breakdown : { rowsLite: [], bySku: [], byLine: [], latestByLine: [], latestDate: null, totalRows: 0 };
    return (breakdown && Array.isArray(breakdown.rowsLite) && breakdown.rowsLite.length) ? breakdown : fallbackN;
  }, [breakdown, localNulogySeries]);

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

  var filteredInputs = useMemo(function() {
    return (inputs || []).filter(function(r) { return inRange(String(r.date_et || ""), effectiveRange); });
  }, [inputs, effectiveRange]);

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

  var periodCompare = useMemo(function() {
    var allByDay = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
    var allByShift = (effectiveTrends && Array.isArray(effectiveTrends.byShift)) ? effectiveTrends.byShift : [];
    var prior = compareRange(windowPreset, effectiveRange);

    var currentUnits = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, effectiveRange) ? (sum + safeNum(d.units)) : sum;
    }, 0);
    var priorUnits = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, prior) ? (sum + safeNum(d.units)) : sum;
    }, 0);
    var currentRows = allByDay.reduce(function(sum, d) {
      var date = String(d.date || "");
      return inRangeIso(date, effectiveRange) ? (sum + safeNum(d.rows)) : sum;
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
        if (inRangeIso(date, effectiveRange)) currentShift1 += units;
        if (inRangeIso(date, prior)) priorShift1 += units;
      }
      if (shift.indexOf("Shift 2") !== -1) {
        if (inRangeIso(date, effectiveRange)) currentShift2 += units;
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
        windowPreset === "custom" ? (effectiveRange.start + " to " + effectiveRange.end) :
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
  }, [effectiveTrends, windowPreset, effectiveRange]);

  var metrics = useMemo(function() {
    var byDay = filteredTrends.byDay || [];
    var byShift = filteredTrends.byShift || [];
    var totalUnits = byDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
    var avgDailyUnits = byDay.length ? Math.round(totalUnits / byDay.length) : 0;
    var today = toIsoDateET(new Date());
    var expectedShifts = businessDaysBetween(filteredTrends.fromDate, effectiveRange.end || today) * 2;
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
      var t = revenueTargetForSku(k);
      if (!t) return sum;
      return sum + safeNum(s.units) * safeNum(t.revenue_per_case);
    }, 0);
    var mappedSkuCount = filteredBreakdown.bySku.filter(function(s) { return !!revenueTargetForSku(String(s.item_code || "").trim()); }).length;
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
  }, [filteredTrends, filteredInputs, rates, filteredBreakdown, targetBySku, itemMasterPriceBySku, effectiveRange.end]);

  var topSku = useMemo(function() {
    return filteredBreakdown.bySku.slice(0, 10).map(function(s) {
      var t = revenueTargetForSku(String(s.item_code || "").trim());
      return {
        item_code: s.item_code,
        units: safeNum(s.units),
        estRev: t ? safeNum(t.revenue_per_case) * safeNum(s.units) : null,
        revSource: t && t.source ? t.source : null,
      };
    });
  }, [filteredBreakdown, targetBySku, itemMasterPriceBySku]);

  var commandBoard = useMemo(function() {
    var byDay = filteredTrends.byDay || [];
    var dayCount = byDay.length;
    var latest = byDay.length ? byDay[0] : null;
    var latestRows = latest ? safeNum(latest.rows) : 0;
    var windowActual = safeNum(metrics.totalUnits);

    // Baseline plan = avg daily output from days outside the current window, scaled to current window size.
    // Fallback to current-window avg when there is no older data loaded.
    var allDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay : [];
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
  }, [filteredTrends, metrics, filteredBreakdown.byLine, effectiveTrends]);

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
    var priorDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay.filter(function(d) {
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
          planPct: Math.round((baselineDaily / max) * 100),
          tooltip: [
            r.date || "--",
            "Shift 1: " + Math.round(r.s1).toLocaleString(),
            "Shift 2: " + Math.round(r.s2).toLocaleString(),
            "Unassigned: " + Math.round(r.un).toLocaleString(),
            "Total: " + Math.round(r.total).toLocaleString(),
            "Baseline: " + baselineDaily.toLocaleString(),
            "Variance: " + ((r.total - baselineDaily) >= 0 ? "+" : "") + (r.total - baselineDaily).toLocaleString()
          ].join("\n")
        };
      }),
      max: max
    };
  }, [filteredTrends.byShift, effectiveTrends, range.start, metrics.avgDailyUnits]);

  var dailyPlanVsActual = useMemo(function() {
    var dayRows = (filteredTrends.byDay || []).slice().sort(function(a, b) { return String(a.date || "").localeCompare(String(b.date || "")); });
    if (!dayRows.length) return { rows: [], lineSeries: [] };

    var priorDays = (effectiveTrends && Array.isArray(effectiveTrends.byDay)) ? effectiveTrends.byDay.filter(function(d) {
      var date = String(d.date || "");
      return date && date < range.start;
    }) : [];
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
      var row = {
        date: date,
        total: safeNum(r.units),
        plan: baselineDaily,
      };
      lineSeries.forEach(function(line) {
        row[line.key] = safeNum(byDateLine[date] && byDateLine[date][line.key]);
      });
      return row;
    });

    return { rows: rowData, lineSeries: lineSeries };
  }, [filteredTrends.byDay, effectiveTrends, range.start, metrics.avgDailyUnits, filteredBreakdown.rowsLite]);

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

  var lineYieldChartData = useMemo(function() {
    return (linePerformance || []).map(function(r) {
      return {
        line: String(r.line || "Unknown"),
        units: Math.round(safeNum(r.units)),
        latest: Math.round(safeNum(r.latestUnits))
      };
    }).slice(0, 10);
  }, [linePerformance]);

  const lineYieldChartConfig = useMemo(function() {
    return {
      units: { label: "Window yield", color: "rgb(var(--accent))" },
      latest: { label: "Latest day", color: "color-mix(in oklab, rgb(var(--success)) 85%, white)" }
    };
  }, []);

  const evoconLossChartConfig = useMemo(function() {
    return {
      unplannedMin: { label: "Unplanned", color: "rgb(var(--danger))" },
      slowMin: { label: "Speed loss", color: "rgb(var(--warning))" },
      technicalMin: { label: "Technical", color: "color-mix(in oklab, rgb(var(--accent)) 70%, white)" },
      plannedMin: { label: "Planned", color: "color-mix(in oklab, rgb(var(--muted)) 65%, white)" }
    };
  }, []);

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

  var evoconInsights = useMemo(function() {
    var rows = (Array.isArray(evoconData) ? evoconData : []).filter(function(r) {
      return inRangeIso(String(r.date || ""), range);
    });
    if (!rows.length) {
      return {
        hasData: false,
        rows: [],
        summary: null,
        byLine: [],
        byShift: [],
        chartRows: [],
        actions: [],
        latestDate: null
      };
    }

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

    var byLine = Object.values(byLineMap).map(function(r) {
      var lossMin = r.unplannedMin + r.slowMin + r.technicalMin;
      var availabilityPct = pct(r.operatingMin, r.operatingMin + r.downtimeMin);
      var commentCoveragePct = pct(Math.max(0, r.downtimeMin - r.uncommentedMin), r.downtimeMin);
      var speedLossSharePct = pct(r.slowMin, Math.max(1, lossMin));
      return Object.assign({}, r, {
        lossMin: lossMin,
        availabilityPct: availabilityPct,
        commentCoveragePct: commentCoveragePct,
        speedLossSharePct: speedLossSharePct
      });
    }).sort(function(a, b) { return b.lossMin - a.lossMin; });

    var byShift = Object.values(byShiftMap).map(function(r) {
      var lossMin = r.unplannedMin + r.slowMin + r.technicalMin;
      var availabilityPct = pct(r.operatingMin, r.operatingMin + r.downtimeMin);
      return Object.assign({}, r, {
        lossMin: lossMin,
        availabilityPct: availabilityPct
      });
    }).sort(function(a, b) { return String(a.shift || "").localeCompare(String(b.shift || "")); });

    var worstLossLine = byLine[0] || null;
    var worstCommentLine = byLine.slice().sort(function(a, b) { return a.commentCoveragePct - b.commentCoveragePct; })[0] || null;
    var worstSpeedLossLine = byLine.slice().sort(function(a, b) { return b.slowMin - a.slowMin; })[0] || null;
    var s1 = byShift.find(function(r) { return String(r.shift || "").indexOf("Shift 1") !== -1; });
    var s2 = byShift.find(function(r) { return String(r.shift || "").indexOf("Shift 2") !== -1; });
    var shiftGapMin = Math.abs(safeNum(s1 && s1.lossMin) - safeNum(s2 && s2.lossMin));

    var actions = [];
    if (worstLossLine && worstLossLine.lossMin > 0) {
      actions.push({
        severity: "high",
        text: "Focus " + worstLossLine.line + " first: " + worstLossLine.lossMin.toLocaleString() + " loss min (" + worstLossLine.unplannedMin.toLocaleString() + " unplanned).",
      });
    }
    if (worstSpeedLossLine && worstSpeedLossLine.slowMin > 0) {
      actions.push({
        severity: "med",
        text: "Speed-loss hotspot: " + worstSpeedLossLine.line + " has " + worstSpeedLossLine.slowMin.toLocaleString() + " slow-run min.",
      });
    }
    if (worstCommentLine && worstCommentLine.downtimeMin > 0 && worstCommentLine.commentCoveragePct < 80) {
      actions.push({
        severity: "med",
        text: "Raise stop-reason discipline on " + worstCommentLine.line + " (comment coverage " + worstCommentLine.commentCoveragePct + "%).",
      });
    }
    if (shiftGapMin >= 120) {
      actions.push({
        severity: "low",
        text: "Shift imbalance detected: " + shiftGapMin.toLocaleString() + " min difference between Shift 1 and Shift 2 loss.",
      });
    }

    var summaryLossMin = summary.unplannedMin + summary.slowMin + summary.technicalMin;
    var summaryAvailabilityPct = pct(summary.operatingMin, summary.operatingMin + summary.downtimeMin);
    var summaryCommentCoveragePct = pct(Math.max(0, summary.downtimeMin - summary.uncommentedMin), summary.downtimeMin);

    var chartRows = byLine.slice(0, 8).map(function(r) {
      return {
        line: r.line,
        unplannedMin: r.unplannedMin,
        slowMin: r.slowMin,
        technicalMin: r.technicalMin,
        plannedMin: r.plannedMin,
        lossMin: r.lossMin
      };
    });

    var latestDate = Object.keys(byDateMap).sort().pop() || null;
    var managerActions = actions.slice(0, 3);
    var supervisorActions = byLine.slice(0, 4).map(function(r) {
      var priority = r.unplannedMin >= r.slowMin ? "Unplanned stops" : "Speed loss";
      return {
        severity: r.lossMin > 300 ? "high" : r.lossMin > 120 ? "med" : "low",
        text: r.line + ": " + priority + " | Loss " + r.lossMin.toLocaleString() + " min | Events " + r.stopEvents.toLocaleString()
      };
    });

    return {
      hasData: true,
      rows: rows,
      latestDate: latestDate,
      summary: Object.assign({}, summary, {
        lossMin: summaryLossMin,
        availabilityPct: summaryAvailabilityPct,
        commentCoveragePct: summaryCommentCoveragePct
      }),
      byLine: byLine,
      byShift: byShift,
      chartRows: chartRows,
      actions: evoconRole === "supervisor" ? supervisorActions : managerActions
    };
  }, [evoconData, range, evoconRole]);

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

  const dailyChartConfig = useMemo(function() {
    var cfg = { plan: { label: "Baseline daily plan", color: "rgb(var(--muted))" } };
    (dailyPlanVsActual.lineSeries || []).forEach(function(line) {
      cfg[line.key] = { label: line.label, color: line.color };
    });
    return cfg;
  }, [dailyPlanVsActual.lineSeries]);

  const shiftChartConfig = useMemo(function() {
    return {
      s1: { label: "Shift 1", color: "rgb(var(--accent))" },
      s2: { label: "Shift 2", color: "color-mix(in oklab, rgb(var(--accent)) 78%, white)" },
      un: { label: "Unassigned", color: "color-mix(in oklab, rgb(var(--muted)) 45%, white)" },
      plan: { label: "Baseline daily plan", color: "rgb(var(--muted))" }
    };
  }, []);

  return (
    <div className="space-y-4">
      <Card className="px-3 py-2">
        <div className="flex flex-wrap lg:flex-nowrap items-center gap-1.5">
          <span className="text-sm font-medium text-[rgb(var(--muted))] whitespace-nowrap">Operations Window</span>
          <Badge variant="secondary">Nulogy</Badge>
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
          <DatePicker value={range.start} onChange={setCustomStart} className="h-9 w-[132px]" />
          <span className="text-xs text-[rgb(var(--muted))] whitespace-nowrap">to</span>
          <DatePicker value={range.end} onChange={setCustomEnd} className="h-9 w-[132px]" />
          <Button variant="outline" size="sm" onClick={loadAll} disabled={loading || saving}>Refresh</Button>
          {loading && <span className="text-xs text-[rgb(var(--muted))] whitespace-nowrap">Loading…</span>}
        </div>
      </Card>

      {err && <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{err}</Card>}

      <div className="grid gap-2 lg:grid-cols-12">
        <Card className="lg:col-span-8 px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
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
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.latestUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Actual Cases</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.planUnits.toLocaleString()}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Baseline Plan</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5">
              <div className={"text-lg font-bold [font-variant-numeric:tabular-nums] " + (commandBoard.variance < 0 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>
                {commandBoard.variance >= 0 ? "+" : ""}{commandBoard.variance.toLocaleString()}
              </div>
              <div className="text-xs text-[rgb(var(--muted))]">Variance ({commandBoard.variancePct >= 0 ? "+" : ""}{commandBoard.variancePct}%)</div>
            </div>
            <div className="rounded-md border border-[rgb(var(--border))] px-3 py-1.5">
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{commandBoard.topLine ? commandBoard.topLine.line : "--"}</div>
              <div className="text-xs text-[rgb(var(--muted))]">Top Line ({commandBoard.topLine ? commandBoard.topLine.units.toLocaleString() : "--"} cases in window)</div>
            </div>
          </div>
          <button
            type="button"
            onClick={function() { setShowWindowCompare(function(v) { return !v; }); }}
            className="mt-2 flex w-full items-center justify-between rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-1.5 text-left"
          >
            <span className="text-xs font-semibold text-[rgb(var(--muted))]">Compare: {periodCompare.labelCurrent} vs {periodCompare.labelPrior}</span>
            <span className="text-xs text-[rgb(var(--muted))]">{showWindowCompare ? "Hide" : "Show"}</span>
          </button>
          {showWindowCompare && (
            <div className="mt-1 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2">
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
          )}
        </Card>

        <Card className="lg:col-span-4 px-3 py-3">
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
                      <ChartTooltipContent
                        labelFormatter={function(value) { return value; }}
                        formatter={function(value) { return Math.round(safeNum(value)); }}
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
                        fill={"var(--color-" + line.key + ")"}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke="var(--color-plan)"
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
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Baseline daily plan</span>
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
                      <ChartTooltipContent
                        labelFormatter={function(value) { return value; }}
                        formatter={function(value) { return Math.round(safeNum(value)); }}
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
                        fill={"var(--color-" + key + ")"}
                        radius={radius}
                        maxBarSize={26}
                      />
                    );
                  })}
                  <Line
                    type="monotone"
                    dataKey="plan"
                    stroke="var(--color-plan)"
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
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--accent))]" />Shift 1</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--accent))/0.7]" />Shift 2</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[rgb(var(--muted))/0.3]" />Unassigned</span>
            <span className="inline-flex items-center gap-1"><span className="h-px w-3 border-t-2 border-dashed border-[rgb(var(--muted))]" />Baseline daily plan</span>
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
                        fill={"var(--color-" + s.key + ")"}
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
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">Evocon Loss Intelligence</div>
            <div className="text-xs text-[rgb(var(--muted))]">
              Non-yield analysis for downtime, speed loss, stop discipline, and shift/line stability.
              {evoconInsights.latestDate ? " Latest production day: " + evoconInsights.latestDate + "." : ""}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant={evoconRole === "manager" ? "active" : "outline"} onClick={function() { setEvoconRole("manager"); }}>
              Plant Manager
            </Button>
            <Button size="sm" variant={evoconRole === "supervisor" ? "active" : "outline"} onClick={function() { setEvoconRole("supervisor"); }}>
              Supervisor
            </Button>
          </div>
        </div>
        {!evoconInsights.hasData ? (
          <div className="rounded-md border border-[rgb(var(--border))] px-3 py-8 text-center text-sm text-[rgb(var(--muted))]">
            No Evocon rows in selected window. Sync Evocon and/or adjust dates.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
                <div className="text-lg font-bold text-[rgb(var(--danger))] [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{evoconInsights.summary.unplannedMin.toLocaleString()}</div>
                <div className="text-xs text-[rgb(var(--muted))]">Unplanned Stop Min</div>
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
                <div className="text-lg font-bold text-[rgb(var(--warning))] [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{evoconInsights.summary.slowMin.toLocaleString()}</div>
                <div className="text-xs text-[rgb(var(--muted))]">Speed Loss Min</div>
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
                <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{evoconInsights.summary.stopEvents.toLocaleString()}</div>
                <div className="text-xs text-[rgb(var(--muted))]">Loss Events</div>
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
                <div className={"text-lg font-bold [font-variant-numeric:tabular-nums] " + (evoconInsights.summary.commentCoveragePct < 80 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>{evoconInsights.summary.commentCoveragePct}%</div>
                <div className="text-xs text-[rgb(var(--muted))]">Comment Coverage</div>
              </div>
              <div className="rounded-md border border-[rgb(var(--border))] px-3 py-2">
                <div className={"text-lg font-bold [font-variant-numeric:tabular-nums] " + (evoconInsights.summary.availabilityPct < 85 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>{evoconInsights.summary.availabilityPct}%</div>
                <div className="text-xs text-[rgb(var(--muted))]">Availability Proxy</div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-12">
              <Card className="lg:col-span-7 px-3 py-3">
                <div className="mb-2 text-sm font-semibold">Loss Stack by Line (minutes)</div>
                {evoconInsights.chartRows.length ? (
                  <ChartContainer config={evoconLossChartConfig} className="h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={evoconInsights.chartRows} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                        <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                        <XAxis dataKey="line" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} />
                        <YAxis width={62} tickLine={false} axisLine={false} tickFormatter={function(v) { return Math.round(safeNum(v)).toLocaleString(); }} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} />
                        <ChartTooltip
                          cursor={{ fill: "rgb(var(--surface))" }}
                          content={<ChartTooltipContent formatter={function(value) { return Math.round(safeNum(value)); }} />}
                        />
                        <Bar stackId="loss" dataKey="unplannedMin" fill="var(--color-unplannedMin)" radius={[0, 0, 4, 4]} maxBarSize={28} />
                        <Bar stackId="loss" dataKey="slowMin" fill="var(--color-slowMin)" maxBarSize={28} />
                        <Bar stackId="loss" dataKey="technicalMin" fill="var(--color-technicalMin)" maxBarSize={28} />
                        <Bar stackId="loss" dataKey="plannedMin" fill="var(--color-plannedMin)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </ChartContainer>
                ) : (
                  <div className="h-44 w-full self-center text-center text-sm text-[rgb(var(--muted))] leading-[11rem]">No line loss data.</div>
                )}
              </Card>
              <Card className="lg:col-span-5 px-3 py-3">
                <div className="mb-2 text-sm font-semibold">Ops Action Queue</div>
                <div className="space-y-2">
                  {(evoconInsights.actions || []).map(function(a, idx) {
                    var cls = a.severity === "high"
                      ? "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]"
                      : a.severity === "med"
                        ? "border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning))]"
                        : "border-[rgb(var(--border))] bg-[rgb(var(--surface))] text-[rgb(var(--foreground))]";
                    return (
                      <div key={idx} className={"rounded-md border px-2.5 py-2 text-xs " + cls}>
                        {idx + 1}. {a.text}
                      </div>
                    );
                  })}
                  {!evoconInsights.actions.length && (
                    <div className="rounded-md border border-[rgb(var(--border))] px-2.5 py-2 text-xs text-[rgb(var(--muted))]">No high-priority loss actions for this window.</div>
                  )}
                </div>
              </Card>
            </div>

            <TableShell>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: C.raised }}>
                    <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Loss Min</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Unplanned</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Speed Loss</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Events</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Comment %</th>
                    <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Avail %</th>
                  </tr>
                </thead>
                <tbody>
                  {evoconInsights.byLine.slice(0, 8).map(function(r) {
                    return (
                      <tr key={r.line} style={{ borderBottom: "1px solid " + C.border }}>
                        <td className="px-2 py-2 text-sm">{r.line}</td>
                        <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{r.lossMin.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] text-[rgb(var(--danger))]" style={{ fontFamily: mono }}>{r.unplannedMin.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] text-[rgb(var(--warning))]" style={{ fontFamily: mono }}>{r.slowMin.toLocaleString()}</td>
                        <td className="px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums]" style={{ fontFamily: mono }}>{r.stopEvents.toLocaleString()}</td>
                        <td className={"px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] " + (r.commentCoveragePct < 80 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>{r.commentCoveragePct}%</td>
                        <td className={"px-2 py-2 text-right text-sm [font-variant-numeric:tabular-nums] " + (r.availabilityPct < 85 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--success))]")} style={{ fontFamily: mono }}>{r.availabilityPct}%</td>
                      </tr>
                    );
                  })}
                  {!evoconInsights.byLine.length && <tr><td colSpan={7} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No line loss data in this window.</td></tr>}
                </tbody>
              </table>
            </TableShell>
          </div>
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-12">
        <Card className="lg:col-span-12 px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Line Performance (Latest Day vs Baseline)</div>
          {lineYieldChartData.length ? (
            <ChartContainer config={lineYieldChartConfig} className="mb-3 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={lineYieldChartData} margin={{ top: 8, right: 8, left: 4, bottom: 8 }}>
                  <CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="line"
                    tickLine={false}
                    axisLine={false}
                    minTickGap={12}
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
                        labelFormatter={function(value) { return "Line " + value; }}
                        formatter={function(value) { return Math.round(safeNum(value)); }}
                      />
                    }
                  />
                  <Bar dataKey="units" fill="var(--color-units)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Line type="monotone" dataKey="latest" stroke="var(--color-latest)" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : null}
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

      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-[rgb(var(--muted))]">
            Labor inputs and rates are managed in a pop-up form to keep this view focused on operations analysis.
          </div>
          <button
            type="button"
            onClick={function() { setShowEntryModal(true); }}
            className="text-sm font-medium text-[rgb(var(--accent))] underline underline-offset-2 hover:opacity-80"
            disabled={saving}
          >
            Open Labor Input Form
          </button>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="px-4 py-4">
          <button
            type="button"
            onClick={function() { setShowTopSkuMix(function(v) { return !v; }); }}
            className="mb-2 flex w-full items-center justify-between text-left"
          >
            <span className="text-sm font-semibold">Top SKU Mix (Units)</span>
            <span className="text-xs text-[rgb(var(--muted))]">{showTopSkuMix ? "Hide" : "Show"}</span>
          </button>
          {showTopSkuMix && (
            <>
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
              <div className="mt-2 text-xs text-[rgb(var(--muted))]">Revenue mapped (SKU target or Item Master Cost): {metrics.mappedSkuCount} | unmapped: {metrics.unmappedSkuCount}</div>
            </>
          )}
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
              <DatePicker value={entry.date_et} onChange={function(nextDate){ setEntry(Object.assign({}, entry, { date_et: nextDate })); }} className="w-full" />
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

            <details className="mt-4">
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
      )}
    </div>
  );
}
