import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, DollarSign, Gauge, Sparkles, Target, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";
import { useTheme } from "../theme";

function n(value) { var out = Number(value || 0); return Number.isFinite(out) ? out : 0; }
function iso(date) { return date.toISOString().slice(0, 10); }
function shift(dateIso, days) { var d = new Date(dateIso + "T12:00:00"); d.setDate(d.getDate() + days); return iso(d); }
function days(start, end) { return Math.max(1, Math.round((new Date(end + "T12:00:00") - new Date(start + "T12:00:00")) / 86400000) + 1); }
function pct(value, digits) { return Number.isFinite(value) ? value.toFixed(digits == null ? 1 : digits) + "%" : "—"; }
function integer(value) { return Math.round(n(value)).toLocaleString(); }
function money(value) { return n(value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }); }
function compactMoney(value) { return n(value).toLocaleString("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }); }
function normalizeSku(value) { return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase(); }

async function getJson(url) {
  var response = await fetch(url, { credentials: "include" });
  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "Analytics data could not be loaded");
  return body;
}

async function postJson(url, payload) {
  var response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  var body = await response.json().catch(function() { return {}; });
  if (!response.ok) throw new Error(body.error || "AI insights could not be generated");
  return body;
}

function quickCompareRanges(key) {
  var now = new Date();
  var today = iso(now);
  var currentStart;
  var priorStart;
  var priorEnd;
  if (key === "week") {
    var day = now.getDay();
    currentStart = shift(today, day === 0 ? -6 : 1 - day);
    priorStart = shift(currentStart, -7);
    priorEnd = shift(currentStart, -1);
  } else if (key === "quarter") {
    var quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    currentStart = iso(new Date(now.getFullYear(), quarterMonth, 1, 12));
    var priorQuarterDate = new Date(now.getFullYear(), quarterMonth - 3, 1, 12);
    priorStart = iso(priorQuarterDate);
    priorEnd = iso(new Date(priorQuarterDate.getFullYear(), priorQuarterDate.getMonth() + 3, 0, 12));
  } else if (key === "year") {
    currentStart = iso(new Date(now.getFullYear(), 0, 1, 12));
    priorStart = iso(new Date(now.getFullYear() - 1, 0, 1, 12));
    priorEnd = iso(new Date(now.getFullYear() - 1, 11, 31, 12));
  } else {
    currentStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
    var priorMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
    priorStart = iso(priorMonthDate);
    priorEnd = iso(new Date(priorMonthDate.getFullYear(), priorMonthDate.getMonth() + 1, 0, 12));
  }
  return { currentStart: currentStart, currentEnd: today, priorStart: priorStart, priorEnd: priorEnd };
}

function productionDatesInRange(production, range) {
  var found = {};
  (production && Array.isArray(production.rowsLite) ? production.rowsLite : []).forEach(function(row) {
    var date = String(row && row.produced_date_et || "").slice(0, 10);
    if (date >= range.start && date <= range.end && n(row && row.units_produced) > 0) found[date] = true;
  });
  return Object.keys(found).sort();
}

function matchedProductionDayRanges(ranges, production, enabled) {
  var currentRange = { start: ranges.currentStart, end: ranges.currentEnd };
  var priorRange = { start: ranges.priorStart, end: ranges.priorEnd };
  if (!enabled) return { current: currentRange, prior: priorRange, matched: false };
  var currentDates = productionDatesInRange(production, currentRange);
  var priorDates = productionDatesInRange(production, priorRange);
  if (!currentDates.length || !priorDates.length) return { current: currentRange, prior: priorRange, matched: false };
  var matchedCount = Math.min(currentDates.length, priorDates.length);
  var matchedCurrentEnd = currentDates[matchedCount - 1];
  var matchedPriorEnd = priorDates[matchedCount - 1];
  return {
    current: { start: currentRange.start, end: matchedCurrentEnd },
    prior: { start: priorRange.start, end: matchedPriorEnd },
    matched: matchedCurrentEnd !== currentRange.end || matchedPriorEnd !== priorRange.end || currentDates.length !== priorDates.length,
    productionDays: matchedCount,
    availableCurrentDays: currentDates.length,
    availablePriorDays: priorDates.length
  };
}

function pricingResolver(config) {
  var bySku = {};
  (Array.isArray(config && config.skuTargets) ? config.skuTargets : []).forEach(function(row) {
    var sku = normalizeSku(row && (row.item_code || row.sku || row.code));
    if (!sku || !(n(row && row.revenue_per_case) > 0)) return;
    if (!bySku[sku]) bySku[sku] = [];
    bySku[sku].push(row);
  });
  var fallback = config && config.itemMasterCostBySku && typeof config.itemMasterCostBySku === "object" ? config.itemMasterCostBySku : {};
  return function(itemCode, date) {
    var sku = normalizeSku(itemCode);
    var rows = bySku[sku] || [];
    var best = 0;
    rows.forEach(function(row) {
      var start = String(row.active_from || "1900-01-01").slice(0, 10);
      var end = String(row.active_to || "9999-12-31").slice(0, 10);
      if (date >= start && date <= end) best = Math.max(best, n(row.revenue_per_case));
    });
    if (best > 0) return { value: best, covered: true, source: "pricing" };
    var inherited = n(fallback[sku]);
    return { value: inherited, covered: inherited > 0, source: inherited > 0 ? "item master" : "missing" };
  };
}

function summarize(range, production, labor, resolvePrice) {
  var rows = (production && Array.isArray(production.rowsLite) ? production.rowsLite : []).filter(function(row) {
    var date = String(row.produced_date_et || "").slice(0, 10);
    return date >= range.start && date <= range.end;
  });
  var laborDays = (labor && Array.isArray(labor.byDay) ? labor.byDay : []).filter(function(row) {
    var date = String(row.date_et || row.date || "").slice(0, 10);
    return date >= range.start && date <= range.end;
  });
  var laborLines = (labor && Array.isArray(labor.byJob) ? labor.byJob : []).filter(function(row) {
    var date = String(row.date_et || row.date || "").slice(0, 10);
    return date >= range.start && date <= range.end;
  });
  var activeDays = new Set();
  var jobs = new Set();
  var byLine = {};
  var units = 0;
  var revenue = 0;
  var pricedUnits = 0;
  rows.forEach(function(row) {
    var date = String(row.produced_date_et || "").slice(0, 10);
    var qty = n(row.units_produced);
    var line = String(row.line || "Unknown").trim() || "Unknown";
    units += qty;
    if (qty > 0) activeDays.add(date);
    jobs.add([date, row.job_id || "", row.work_order_code || "", line, row.item_code || ""].join("|"));
    var price = resolvePrice(row.item_code, date);
    revenue += qty * price.value;
    if (price.covered) pricedUnits += qty;
    if (!byLine[line]) byLine[line] = { line: line, units: 0, jobs: new Set(), revenue: 0, pricedUnits: 0, payableHours: 0, laborCost: 0, headcountWeighted: 0, headcountWeight: 0 };
    byLine[line].units += qty;
    byLine[line].jobs.add([date, row.job_id || "", row.work_order_code || "", row.item_code || ""].join("|"));
    byLine[line].revenue += qty * price.value;
    if (price.covered) byLine[line].pricedUnits += qty;
  });
  var payableHours = 0;
  var productiveHours = 0;
  var laborCost = 0;
  var headcountWeighted = 0;
  var headcountWeight = 0;
  laborDays.forEach(function(row) {
    var payable = n(row.payable_hours);
    payableHours += payable;
    productiveHours += n(row.productive_hours);
    laborCost += n(row.labor_cost);
    if (n(row.actual_headcount) > 0) { headcountWeighted += n(row.actual_headcount) * Math.max(payable, 1); headcountWeight += Math.max(payable, 1); }
  });
  laborLines.forEach(function(row) {
    var line = String(row.line_name || row.line || "Unknown").trim() || "Unknown";
    if (!byLine[line]) byLine[line] = { line: line, units: 0, jobs: new Set(), revenue: 0, pricedUnits: 0, payableHours: 0, laborCost: 0, headcountWeighted: 0, headcountWeight: 0 };
    byLine[line].payableHours += n(row.payable_hours);
    byLine[line].laborCost += n(row.labor_cost);
    if (n(row.actual_headcount) > 0) { byLine[line].headcountWeighted += n(row.actual_headcount) * Math.max(n(row.payable_hours), 1); byLine[line].headcountWeight += Math.max(n(row.payable_hours), 1); }
  });
  var productionDays = Math.max(1, activeDays.size);
  var lineRows = Object.values(byLine).map(function(row) {
    var margin = row.revenue - row.laborCost;
    return {
      line: row.line, units: row.units, jobs: row.jobs.size, unitsPerDay: row.units / productionDays,
      payableHours: row.payableHours, casesPerPayableHour: row.payableHours > 0 ? row.units / row.payableHours : 0,
      laborCost: row.laborCost, laborCostPerUnit: row.units > 0 ? row.laborCost / row.units : 0,
      crew: row.headcountWeight > 0 ? row.headcountWeighted / row.headcountWeight : null,
      revenue: row.revenue, margin: margin, marginPct: row.revenue > 0 ? margin / row.revenue * 100 : null,
      priceCoverage: row.units > 0 ? row.pricedUnits / row.units * 100 : 0
    };
  }).sort(function(a, b) { return b.units - a.units; });
  return {
    units: units, jobs: jobs.size, productionDays: activeDays.size, unitsPerDay: units / productionDays,
    payableHours: payableHours, productiveHours: productiveHours, laborCost: laborCost,
    laborUtilizationPct: payableHours > 0 ? productiveHours / payableHours * 100 : null,
    casesPerPayableHour: payableHours > 0 ? units / payableHours : 0,
    laborCostPerUnit: units > 0 ? laborCost / units : 0,
    crew: headcountWeight > 0 ? headcountWeighted / headcountWeight : null,
    revenue: revenue, margin: revenue - laborCost, marginPct: revenue > 0 ? (revenue - laborCost) / revenue * 100 : null,
    priceCoverage: units > 0 ? pricedUnits / units * 100 : 0, lines: lineRows
  };
}

function delta(current, prior) { return prior ? (current - prior) / Math.abs(prior) * 100 : null; }

function directionSentence(label, current, prior, goodWhenDown) {
  var change = delta(current, prior);
  if (change == null) return label + " has no prior baseline.";
  var better = goodWhenDown ? change < 0 : change > 0;
  return label + " is " + Math.abs(change).toFixed(1) + "% " + (change >= 0 ? "higher" : "lower") + " than the comparison period" + (better ? "." : ", which needs attention.");
}

function deterministicReadout(current, prior, rows, role) {
  var outputChange = delta(current.unitsPerDay, prior.unitsPerDay);
  var laborChange = delta(current.casesPerPayableHour, prior.casesPerPayableHour);
  var best = rows.slice().filter(function(row) { return row.unitDelta != null; }).sort(function(a, b) { return b.unitDelta - a.unitDelta; })[0];
  var watch = rows.slice().sort(function(a, b) {
    var aScore = (a.marginPct != null && a.marginPct < 20 ? 100 : 0) + (a.unitDelta != null && a.unitDelta < 0 ? Math.abs(a.unitDelta) : 0) + (100 - a.priceCoverage) / 2;
    var bScore = (b.marginPct != null && b.marginPct < 20 ? 100 : 0) + (b.unitDelta != null && b.unitDelta < 0 ? Math.abs(b.unitDelta) : 0) + (100 - b.priceCoverage) / 2;
    return bScore - aScore;
  })[0];
  return {
    headline: outputChange == null ? "Plant performance is ready for review." : "Plant output is " + (outputChange >= 0 ? "improving" : "softening") + " versus the comparison period.",
    summary: directionSentence("Output per production day", current.unitsPerDay, prior.unitsPerDay, false) + " " + directionSentence("Labor productivity", current.casesPerPayableHour, prior.casesPerPayableHour, false),
    primaryDriver: best ? best.line + " shows the strongest output-per-day movement." : "No single line has a reliable comparison baseline.",
    watchItem: watch ? watch.line + " is the clearest line to review for performance, margin, or data coverage." : "No material line exception is available.",
    recommendedAction: watch ? (role === "finance" ? "Validate pricing and direct labor contribution on " : role === "supervisor" ? "Review today’s staffing and job execution on " : "Review job mix, crew deployment, and performance on ") + watch.line + "." : "Confirm labor and pricing coverage before acting on the comparison."
  };
}

function evidenceText(current, prior, rows) {
  var best = rows.slice().filter(function(row) { return row.unitDelta != null; }).sort(function(a, b) { return b.unitDelta - a.unitDelta; })[0];
  var watch = rows.slice().filter(function(row) { return row.marginPct != null || row.unitDelta != null; }).sort(function(a, b) {
    var as = (a.marginPct != null && a.marginPct < 20 ? 100 : 0) + (a.unitDelta < 0 ? Math.abs(a.unitDelta) : 0);
    var bs = (b.marginPct != null && b.marginPct < 20 ? 100 : 0) + (b.unitDelta < 0 ? Math.abs(b.unitDelta) : 0);
    return bs - as;
  })[0];
  return {
    headline: integer(current.unitsPerDay) + " cases/day · " + (delta(current.unitsPerDay, prior.unitsPerDay) == null ? "no baseline" : (delta(current.unitsPerDay, prior.unitsPerDay) > 0 ? "+" : "") + delta(current.unitsPerDay, prior.unitsPerDay).toFixed(1) + "%"),
    summary: current.casesPerPayableHour.toFixed(1) + " cases/payable hr · $" + current.laborCostPerUnit.toFixed(2) + " labor/case",
    primaryDriver: best ? best.line + " · " + (best.unitDelta > 0 ? "+" : "") + best.unitDelta.toFixed(1) + "% output/day" : "No comparable line",
    watchItem: watch ? watch.line + " · " + (watch.marginPct == null ? (watch.unitDelta || 0).toFixed(1) + "% output/day" : pct(watch.marginPct) + " labor margin") : "No material exception",
    recommendedAction: pct(current.priceCoverage) + " plant price coverage · " + current.jobs + " jobs reviewed"
  };
}

function Metric({ icon: Icon, label, value, change, goodWhenDown, note, changeIsPoints }) {
  var improving = change != null && (goodWhenDown ? change < 0 : change > 0);
  var worsening = change != null && (goodWhenDown ? change > 0 : change < 0);
  var Trend = change != null && change < 0 ? ArrowDownRight : ArrowUpRight;
  return <Card className="px-4 py-4">
    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]"><span>{label}</span><Icon className="h-4 w-4" /></div>
    <div className="mt-2 text-2xl font-bold [font-variant-numeric:tabular-nums]">{value}</div>
    <div className="mt-1 flex min-h-5 items-center gap-1 text-xs">
      {change == null ? <span className="text-[rgb(var(--muted))]">No prior baseline</span> : <><Trend className={"h-3.5 w-3.5 " + (improving ? "text-[rgb(var(--success))]" : worsening ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]")} /><span className={improving ? "text-[rgb(var(--success))]" : worsening ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]"}>{change > 0 ? "+" : ""}{change.toFixed(1)}{changeIsPoints ? " pts" : "%"} vs prior</span></>}
    </div>
    {note ? <div className="mt-1 text-[11px] text-[rgb(var(--muted))]">{note}</div> : null}
  </Card>;
}

export default function AnalyticsView({ evoconData }) {
  const { C, mono } = useTheme();
  const defaults = useMemo(function() { return quickCompareRanges("month"); }, []);
  const [ranges, setRanges] = useState(defaults);
  const [comparePreset, setComparePreset] = useState("month");
  const [role, setRole] = useState("supervisor");
  var fetchStart = ranges.priorStart < ranges.currentStart ? ranges.priorStart : ranges.currentStart;
  var fetchEnd = ranges.priorEnd > ranges.currentEnd ? ranges.priorEnd : ranges.currentEnd;
  var productionQuery = useQuery({ queryKey: ["analytics-production", fetchStart, fetchEnd], queryFn: function() { return getJson("/api/ops/production-breakdown?start=" + fetchStart + "&end=" + fetchEnd); }, staleTime: 300000 });
  var laborQuery = useQuery({ queryKey: ["analytics-labor", fetchStart, fetchEnd], queryFn: function() { return getJson("/api/ops/labor-actuals?start=" + fetchStart + "&end=" + fetchEnd); }, staleTime: 300000 });
  var configQuery = useQuery({ queryKey: ["analytics-config"], queryFn: function() { return getJson("/api/ops/config"); }, staleTime: 900000 });
  var resolvePrice = useMemo(function() { return pricingResolver(configQuery.data || {}); }, [configQuery.data]);
  var effectiveRanges = useMemo(function() { return matchedProductionDayRanges(ranges, productionQuery.data || {}, comparePreset !== "custom"); }, [ranges, productionQuery.data, comparePreset]);
  var current = useMemo(function() { return summarize(effectiveRanges.current, productionQuery.data || {}, laborQuery.data || {}, resolvePrice); }, [effectiveRanges.current, productionQuery.data, laborQuery.data, resolvePrice]);
  var prior = useMemo(function() { return summarize(effectiveRanges.prior, productionQuery.data || {}, laborQuery.data || {}, resolvePrice); }, [effectiveRanges.prior, productionQuery.data, laborQuery.data, resolvePrice]);
  var oeeRows = Array.isArray(evoconData) ? evoconData : [];
  var oeeValues = oeeRows.map(function(row) { return n(row && (row.oee || row.OEE || row.oee_pct || row.oeePercent)); }).filter(function(value) { return value > 0; });
  var oee = oeeValues.length ? oeeValues.reduce(function(a, b) { return a + b; }, 0) / oeeValues.length : null;
  var priorByLine = {};
  prior.lines.forEach(function(row) { priorByLine[row.line] = row; });
  var comparisonRows = current.lines.map(function(row) {
    var old = priorByLine[row.line] || {};
    return Object.assign({}, row, { priorUnits: n(old.units), unitDelta: delta(row.unitsPerDay, n(old.unitsPerDay)), priorMarginPct: old.marginPct });
  });
  var flags = comparisonRows.filter(function(row) { return (row.marginPct != null && row.marginPct < 20 && row.units >= current.units * 0.05) || (row.unitDelta != null && row.unitDelta < -15) || (row.priceCoverage < 80 && row.units > 0); }).slice(0, 4);
  var loading = productionQuery.isPending || laborQuery.isPending || configQuery.isPending;
  var error = productionQuery.error || laborQuery.error || configQuery.error;
  var insightPayload = useMemo(function() {
    return {
      audience: role,
      currentPeriod: { start: effectiveRanges.current.start, end: effectiveRanges.current.end, productionDays: current.productionDays, jobs: current.jobs },
      comparisonPeriod: { start: effectiveRanges.prior.start, end: effectiveRanges.prior.end, productionDays: prior.productionDays, jobs: prior.jobs },
      metrics: [
        { label: "cases per production day", current: current.unitsPerDay, prior: prior.unitsPerDay, changePct: delta(current.unitsPerDay, prior.unitsPerDay), unit: "cases/day" },
        { label: "cases per payable hour", current: current.casesPerPayableHour, prior: prior.casesPerPayableHour, changePct: delta(current.casesPerPayableHour, prior.casesPerPayableHour), unit: "cases/hour" },
        { label: "labor cost per case", current: current.laborCostPerUnit, prior: prior.laborCostPerUnit, changePct: delta(current.laborCostPerUnit, prior.laborCostPerUnit), unit: "USD/case", goodWhenDown: true },
        { label: "average crew", current: current.crew, prior: prior.crew, changePct: current.crew == null || prior.crew == null ? null : delta(current.crew, prior.crew), unit: "people", goodWhenDown: true },
        { label: "labor margin per production day", current: current.margin / Math.max(1, current.productionDays), prior: prior.margin / Math.max(1, prior.productionDays), changePct: delta(current.margin / Math.max(1, current.productionDays), prior.margin / Math.max(1, prior.productionDays)), unit: "USD/day" }
      ],
      lines: comparisonRows.slice(0, 10).map(function(row) { return { line: row.line, casesPerDay: row.unitsPerDay, outputChangePct: row.unitDelta, casesPerPayableHour: row.casesPerPayableHour, crew: row.crew, laborCostPerCase: row.laborCostPerUnit, laborMarginPct: row.marginPct, volumeSharePct: current.units > 0 ? row.units / current.units * 100 : 0, priceCoveragePct: row.priceCoverage }; }),
      dataQuality: { pricingCoveragePct: current.priceCoverage, hasLabor: current.payableHours > 0, hasOee: oee != null }
    };
  }, [effectiveRanges, current, prior, comparisonRows, oee, role]);
  var insightsQuery = useQuery({
    queryKey: ["analytics-ai-insights", insightPayload],
    queryFn: function() { return postJson("/api/ai/analytics-insights", insightPayload); },
    enabled: !loading && !error && current.units > 0,
    staleTime: 15 * 60 * 1000,
    retry: false
  });
  var fallbackReadout = useMemo(function() { return deterministicReadout(current, prior, comparisonRows, role); }, [current, prior, comparisonRows, role]);
  var readout = insightsQuery.data && insightsQuery.data.insights ? insightsQuery.data.insights : fallbackReadout;
  var evidence = useMemo(function() { return evidenceText(current, prior, comparisonRows); }, [current, prior, comparisonRows]);
  var laborCostVariance = prior.laborCostPerUnit > 0 ? (current.laborCostPerUnit - prior.laborCostPerUnit) * current.units : 0;
  var roleKpis = role === "finance" ? [
    { icon: DollarSign, label: "Labor margin / day", value: compactMoney(current.margin / Math.max(1, current.productionDays)), change: delta(current.margin / Math.max(1, current.productionDays), prior.margin / Math.max(1, prior.productionDays)), note: "Revenue less direct labor" },
    { icon: Gauge, label: "Labor margin %", value: current.marginPct == null ? "—" : pct(current.marginPct), change: current.marginPct == null || prior.marginPct == null ? null : current.marginPct - prior.marginPct, changeIsPoints: true, note: pct(current.priceCoverage) + " pricing coverage" },
    { icon: DollarSign, label: "Labor spend / day", value: compactMoney(current.laborCost / Math.max(1, current.productionDays)), change: delta(current.laborCost / Math.max(1, current.productionDays), prior.laborCost / Math.max(1, prior.productionDays)), goodWhenDown: true },
    { icon: Target, label: "Labor cost variance", value: (laborCostVariance > 0 ? "+" : "") + compactMoney(laborCostVariance), change: null, goodWhenDown: true, note: "Current volume at prior labor cost/case" }
  ] : role === "operations" ? [
    { icon: Activity, label: "Cases / production day", value: integer(current.unitsPerDay), change: delta(current.unitsPerDay, prior.unitsPerDay) },
    { icon: Gauge, label: "Productive / payable hours", value: current.laborUtilizationPct == null ? "—" : pct(current.laborUtilizationPct), change: current.laborUtilizationPct == null || prior.laborUtilizationPct == null ? null : current.laborUtilizationPct - prior.laborUtilizationPct, changeIsPoints: true, note: "Labor utilization" },
    { icon: Users, label: "Average crew", value: current.crew == null ? "—" : current.crew.toFixed(1), change: current.crew == null || prior.crew == null ? null : delta(current.crew, prior.crew), goodWhenDown: true },
    { icon: DollarSign, label: "Labor cost / case", value: "$" + current.laborCostPerUnit.toFixed(2), change: delta(current.laborCostPerUnit, prior.laborCostPerUnit), goodWhenDown: true }
  ] : [
    { icon: Activity, label: "Cases / production day", value: integer(current.unitsPerDay), change: delta(current.unitsPerDay, prior.unitsPerDay) },
    { icon: Clock3, label: "Cases / payable hour", value: current.casesPerPayableHour.toFixed(1), change: delta(current.casesPerPayableHour, prior.casesPerPayableHour) },
    { icon: Activity, label: "Jobs / production day", value: (current.jobs / Math.max(1, current.productionDays)).toFixed(1), change: delta(current.jobs / Math.max(1, current.productionDays), prior.jobs / Math.max(1, prior.productionDays)), note: "Workload and changeover proxy" },
    { icon: Gauge, label: "OEE", value: oee == null ? "—" : pct(oee <= 1 ? oee * 100 : oee), change: null, note: oee == null ? "Evocon data unavailable" : oeeValues.length + " Evocon observations" }
  ];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">Plant Analytics</h1><p className="text-sm text-[rgb(var(--muted))]">Deterministic production, labor, profitability, and OEE signals—without downloading job data.</p></div>
      <div className="flex flex-wrap gap-1.5">{[{ key: "supervisor", label: "Plant supervisor" }, { key: "operations", label: "Operations manager" }, { key: "finance", label: "CFO / Finance" }].map(function(item) { return <Button key={item.key} variant={role === item.key ? "active" : "outline"} size="sm" onClick={function() { setRole(item.key); }}>{item.label}</Button>; })}</div>
    </div>
    <Card className="px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Quick compare</div>
      <div className="mt-2 flex flex-wrap gap-1.5">{[{ key: "week", label: "This week vs last" }, { key: "month", label: "This month vs last" }, { key: "quarter", label: "This quarter vs last" }, { key: "year", label: "This year vs last" }, { key: "custom", label: "Custom" }].map(function(item) { return <Button key={item.key} variant={comparePreset === item.key ? "active" : "outline"} size="sm" onClick={function() { setComparePreset(item.key); if (item.key !== "custom") setRanges(quickCompareRanges(item.key)); }}>{item.label}</Button>; })}</div>
      {comparePreset === "custom" ? <div className="mt-3 grid gap-3 border-t border-[rgb(var(--border))] pt-3 lg:grid-cols-2">
        <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Current period</div><div className="flex items-center gap-2"><DatePicker value={ranges.currentStart} onChange={function(v) { setRanges(Object.assign({}, ranges, { currentStart: v })); }} /><span className="text-xs text-[rgb(var(--muted))]">to</span><DatePicker value={ranges.currentEnd} onChange={function(v) { setRanges(Object.assign({}, ranges, { currentEnd: v })); }} /></div></div>
        <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Comparison period</div><div className="flex items-center gap-2"><DatePicker value={ranges.priorStart} onChange={function(v) { setRanges(Object.assign({}, ranges, { priorStart: v })); }} /><span className="text-xs text-[rgb(var(--muted))]">to</span><DatePicker value={ranges.priorEnd} onChange={function(v) { setRanges(Object.assign({}, ranges, { priorEnd: v })); }} /></div></div>
      </div> : null}
      <div className="mt-3 rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-2 text-xs">
        <span className="font-semibold">Comparing:</span> {effectiveRanges.current.start} to {effectiveRanges.current.end} <span className="text-[rgb(var(--muted))]">vs</span> {effectiveRanges.prior.start} to {effectiveRanges.prior.end}
        <span className="ml-2 text-[rgb(var(--muted))]">· Current {current.productionDays || 0} production days / {current.jobs} jobs · Prior {prior.productionDays || 0} production days / {prior.jobs} jobs</span>
        {effectiveRanges.matched ? <span className="ml-2 font-medium text-[rgb(var(--accent))]">Matched to {effectiveRanges.productionDays} production days.</span> : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[rgb(var(--border))] pt-3 text-xs"><span className="font-semibold">Decision confidence</span><span className={"rounded-full border px-2 py-1 " + (current.units > 0 ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] text-[rgb(var(--danger))]")}>Production {current.units > 0 ? "ready" : "missing"}</span><span className={"rounded-full border px-2 py-1 " + (current.payableHours > 0 ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning))]")}>Labor {current.payableHours > 0 ? "matched" : "unavailable"}</span><span className={"rounded-full border px-2 py-1 " + (current.priceCoverage >= 95 ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] text-[rgb(var(--warning))]")}>Pricing {pct(current.priceCoverage)}</span><span className={"rounded-full border px-2 py-1 " + (oee != null ? "border-[rgb(var(--success-line))] bg-[rgb(var(--success-soft))] text-[rgb(var(--success))]" : "border-[rgb(var(--border))] text-[rgb(var(--muted))]")}>OEE {oee != null ? "connected" : "unavailable"}</span></div>
    </Card>
    {error ? <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-4 py-4 text-sm text-[rgb(var(--danger))]">{error.message}</Card> : null}
    <Card className="overflow-hidden border-[color-mix(in_oklab,rgb(var(--accent))_35%,rgb(var(--border)))]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--border))] bg-[color-mix(in_oklab,rgb(var(--accent))_7%,rgb(var(--surface)))] px-4 py-3">
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[rgb(var(--accent))]" /><div><div className="text-sm font-semibold">{role === "finance" ? "Financial readout" : role === "operations" ? "Operations readout" : "Shift-lead readout"}</div><div className="text-xs text-[rgb(var(--muted))]">Conclusion first, verified evidence underneath.</div></div></div>
        <div className="flex items-center gap-2"><span className="text-[11px] text-[rgb(var(--muted))]">{insightsQuery.isFetching ? "OpenAI is reading the fact pack…" : insightsQuery.data ? "AI-written · PackPulse-verified" : "Deterministic fallback"}</span><Button variant="outline" size="sm" onClick={function() { insightsQuery.refetch(); }} disabled={loading || insightsQuery.isFetching}>{insightsQuery.isFetching ? "Refreshing…" : "Refresh insight"}</Button></div>
      </div>
      <div className="px-4 py-4">
        <div className="text-xl font-bold leading-snug">{readout.headline}</div><div className="mt-1 max-w-4xl text-sm text-[rgb(var(--muted))]">{readout.summary}</div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {[{ key: "primaryDriver", label: "Primary driver", icon: ArrowUpRight, iconClass: "text-[rgb(var(--success))]" }, { key: "watchItem", label: "Watch item", icon: AlertTriangle, iconClass: "text-[rgb(var(--warning))]" }, { key: "recommendedAction", label: "Recommended next step", icon: Target, iconClass: "text-[rgb(var(--accent))]" }].map(function(item) { var Icon = item.icon; return <div key={item.key} className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3"><div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]"><Icon className={"h-3.5 w-3.5 " + item.iconClass} />{item.label}</div><div className="mt-2 text-sm font-medium leading-relaxed">{readout[item.key]}</div><div className="mt-2 text-xs text-[rgb(var(--muted))]">{evidence[item.key]}</div></div>; })}
        </div>
        {insightsQuery.isError ? <div className="mt-3 text-xs text-[rgb(var(--warning))]">OpenAI narrative is temporarily unavailable; verified deterministic insights are shown instead.</div> : null}
      </div>
    </Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{roleKpis.map(function(metric) { return <Metric key={metric.label} icon={metric.icon} label={metric.label} value={loading ? "—" : metric.value} change={metric.change} goodWhenDown={metric.goodWhenDown} note={metric.note} changeIsPoints={metric.changeIsPoints} />; })}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.7fr)]">
      <Card className="px-4 py-4">
        <div className="mb-3"><div className="text-sm font-semibold">Output by line</div><div className="text-xs text-[rgb(var(--muted))]">Current versus comparison period; totals are normalized in the table below.</div></div>
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={comparisonRows.slice(0, 8)} margin={{ top: 8, right: 8, left: 2, bottom: 8 }}><CartesianGrid vertical={false} stroke="rgb(var(--border))" strokeOpacity={0.5} /><XAxis dataKey="line" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} /><YAxis tickLine={false} axisLine={false} tickFormatter={integer} tick={{ fill: "rgb(var(--muted))", fontSize: 11 }} /><Tooltip formatter={function(value) { return integer(value) + " cases"; }} /><Bar dataKey="priorUnits" name="Prior" fill="rgb(var(--muted))" opacity={0.45} radius={[4,4,0,0]} /><Bar dataKey="units" name="Current" fill="rgb(var(--accent))" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer></div>
      </Card>
      <Card className="px-4 py-4">
        <div className="mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[rgb(var(--warning))]" /><div><div className="text-sm font-semibold">Operational watchlist</div><div className="text-xs text-[rgb(var(--muted))]">Material, deterministic exceptions.</div></div></div>
        <div className="space-y-2">{flags.map(function(row) { var reason = row.priceCoverage < 80 ? "Price coverage is " + pct(row.priceCoverage) : row.marginPct != null && row.marginPct < 20 ? "Labor margin is " + pct(row.marginPct) : "Output/day is down " + Math.abs(row.unitDelta).toFixed(1) + "%"; return <div key={row.line} className="rounded-md border border-[rgb(var(--warning-line))] bg-[rgb(var(--warning-soft))] px-3 py-2"><div className="text-sm font-semibold">{row.line}</div><div className="text-xs text-[rgb(var(--muted))]">{reason} · {integer(row.units)} cases</div></div>; })}{!flags.length ? <div className="rounded-md border border-[rgb(var(--border))] px-3 py-8 text-center text-sm text-[rgb(var(--muted))]">No material exceptions in this period.</div> : null}</div>
      </Card>
    </div>
    <Card className="px-4 py-4">
      <div className="mb-3"><div className="text-sm font-semibold">Line performance</div><div className="text-xs text-[rgb(var(--muted))]">Revenue and margin are shown only from configured pricing/item-master coverage; margin is revenue less direct labor.</div></div>
      <TableShell><table style={{ width: "100%", borderCollapse: "collapse" }}><thead><tr style={{ background: C.raised }}>{["Line","Cases/day","Δ output","Cases/pay hr","Avg crew","Labor/case","Revenue","Labor margin","Price coverage"].map(function(label, index) { return <th key={label} className={"px-2 py-2 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))] " + (index ? "text-right" : "text-left")}>{label}</th>; })}</tr></thead><tbody>{comparisonRows.map(function(row) { return <tr key={row.line} style={{ borderBottom: "1px solid " + C.border }}><td className="px-2 py-2 text-sm font-medium">{row.line}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{integer(row.unitsPerDay)}</td><td className={"px-2 py-2 text-right text-sm " + (row.unitDelta > 0 ? "text-[rgb(var(--success))]" : row.unitDelta < 0 ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]")} style={{ fontFamily: mono }}>{row.unitDelta == null ? "—" : (row.unitDelta > 0 ? "+" : "") + row.unitDelta.toFixed(1) + "%"}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{row.casesPerPayableHour ? row.casesPerPayableHour.toFixed(1) : "—"}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{row.crew == null ? "—" : row.crew.toFixed(1)}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{row.units ? "$" + row.laborCostPerUnit.toFixed(2) : "—"}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{money(row.revenue)}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{row.marginPct == null ? "—" : pct(row.marginPct)}</td><td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{pct(row.priceCoverage)}</td></tr>; })}{!comparisonRows.length ? <tr><td colSpan={9} className="px-2 py-8 text-center text-sm text-[rgb(var(--muted))]">No production rows in this period.</td></tr> : null}</tbody></table></TableShell>
    </Card>
    <div className="text-xs text-[rgb(var(--muted))]">Data audit: production events are authoritative for output and job dimensions; labor events are authoritative for hours, cost, and crew; configured SKU rates drive revenue; Evocon drives OEE. Effective current range spans {days(effectiveRanges.current.start, effectiveRanges.current.end)} calendar days.</div>
  </div>;
}
