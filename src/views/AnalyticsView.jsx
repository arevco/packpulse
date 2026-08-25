import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Clock3, DollarSign, Gauge, Users } from "lucide-react";
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

function defaultPeriods() {
  var now = new Date();
  var currentEnd = iso(now);
  var currentStart = iso(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  var priorEnd = shift(currentStart, -1);
  var priorDate = new Date(priorEnd + "T12:00:00");
  var priorStart = iso(new Date(priorDate.getFullYear(), priorDate.getMonth(), 1, 12));
  return { currentStart: currentStart, currentEnd: currentEnd, priorStart: priorStart, priorEnd: priorEnd };
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
    casesPerPayableHour: payableHours > 0 ? units / payableHours : 0,
    laborCostPerUnit: units > 0 ? laborCost / units : 0,
    crew: headcountWeight > 0 ? headcountWeighted / headcountWeight : null,
    revenue: revenue, margin: revenue - laborCost, marginPct: revenue > 0 ? (revenue - laborCost) / revenue * 100 : null,
    priceCoverage: units > 0 ? pricedUnits / units * 100 : 0, lines: lineRows
  };
}

function delta(current, prior) { return prior ? (current - prior) / Math.abs(prior) * 100 : null; }

function Metric({ icon: Icon, label, value, change, goodWhenDown, note }) {
  var improving = change != null && (goodWhenDown ? change < 0 : change > 0);
  var worsening = change != null && (goodWhenDown ? change > 0 : change < 0);
  var Trend = change != null && change < 0 ? ArrowDownRight : ArrowUpRight;
  return <Card className="px-4 py-4">
    <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]"><span>{label}</span><Icon className="h-4 w-4" /></div>
    <div className="mt-2 text-2xl font-bold [font-variant-numeric:tabular-nums]">{value}</div>
    <div className="mt-1 flex min-h-5 items-center gap-1 text-xs">
      {change == null ? <span className="text-[rgb(var(--muted))]">No prior baseline</span> : <><Trend className={"h-3.5 w-3.5 " + (improving ? "text-[rgb(var(--success))]" : worsening ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]")} /><span className={improving ? "text-[rgb(var(--success))]" : worsening ? "text-[rgb(var(--danger))]" : "text-[rgb(var(--muted))]"}>{change > 0 ? "+" : ""}{change.toFixed(1)}% vs prior</span></>}
    </div>
    {note ? <div className="mt-1 text-[11px] text-[rgb(var(--muted))]">{note}</div> : null}
  </Card>;
}

export default function AnalyticsView({ evoconData }) {
  const { C, mono } = useTheme();
  const defaults = useMemo(defaultPeriods, []);
  const [ranges, setRanges] = useState(defaults);
  var fetchStart = ranges.priorStart < ranges.currentStart ? ranges.priorStart : ranges.currentStart;
  var fetchEnd = ranges.priorEnd > ranges.currentEnd ? ranges.priorEnd : ranges.currentEnd;
  var productionQuery = useQuery({ queryKey: ["analytics-production", fetchStart, fetchEnd], queryFn: function() { return getJson("/api/ops/production-breakdown?start=" + fetchStart + "&end=" + fetchEnd); }, staleTime: 300000 });
  var laborQuery = useQuery({ queryKey: ["analytics-labor", fetchStart, fetchEnd], queryFn: function() { return getJson("/api/ops/labor-actuals?start=" + fetchStart + "&end=" + fetchEnd); }, staleTime: 300000 });
  var configQuery = useQuery({ queryKey: ["analytics-config"], queryFn: function() { return getJson("/api/ops/config"); }, staleTime: 900000 });
  var resolvePrice = useMemo(function() { return pricingResolver(configQuery.data || {}); }, [configQuery.data]);
  var current = useMemo(function() { return summarize({ start: ranges.currentStart, end: ranges.currentEnd }, productionQuery.data || {}, laborQuery.data || {}, resolvePrice); }, [ranges, productionQuery.data, laborQuery.data, resolvePrice]);
  var prior = useMemo(function() { return summarize({ start: ranges.priorStart, end: ranges.priorEnd }, productionQuery.data || {}, laborQuery.data || {}, resolvePrice); }, [ranges, productionQuery.data, laborQuery.data, resolvePrice]);
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

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold">Plant Analytics</h1><p className="text-sm text-[rgb(var(--muted))]">Deterministic production, labor, profitability, and OEE signals—without downloading job data.</p></div>
      <Button variant="outline" size="sm" onClick={function() { setRanges(defaults); }}>Reset to month</Button>
    </div>
    <Card className="px-4 py-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Current period</div><div className="flex items-center gap-2"><DatePicker value={ranges.currentStart} onChange={function(v) { setRanges(Object.assign({}, ranges, { currentStart: v })); }} /><span className="text-xs text-[rgb(var(--muted))]">to</span><DatePicker value={ranges.currentEnd} onChange={function(v) { setRanges(Object.assign({}, ranges, { currentEnd: v })); }} /></div></div>
        <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Comparison period</div><div className="flex items-center gap-2"><DatePicker value={ranges.priorStart} onChange={function(v) { setRanges(Object.assign({}, ranges, { priorStart: v })); }} /><span className="text-xs text-[rgb(var(--muted))]">to</span><DatePicker value={ranges.priorEnd} onChange={function(v) { setRanges(Object.assign({}, ranges, { priorEnd: v })); }} /></div></div>
      </div>
      <div className="mt-2 text-xs text-[rgb(var(--muted))]">Normalized by actual production days. Current: {current.productionDays || 0} days / {current.jobs} jobs · Prior: {prior.productionDays || 0} days / {prior.jobs} jobs.</div>
    </Card>
    {error ? <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-4 py-4 text-sm text-[rgb(var(--danger))]">{error.message}</Card> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Activity} label="Cases / production day" value={loading ? "—" : integer(current.unitsPerDay)} change={delta(current.unitsPerDay, prior.unitsPerDay)} />
      <Metric icon={Clock3} label="Cases / payable hour" value={loading ? "—" : current.casesPerPayableHour.toFixed(1)} change={delta(current.casesPerPayableHour, prior.casesPerPayableHour)} />
      <Metric icon={DollarSign} label="Labor cost / case" value={loading ? "—" : "$" + current.laborCostPerUnit.toFixed(2)} change={delta(current.laborCostPerUnit, prior.laborCostPerUnit)} goodWhenDown />
      <Metric icon={Users} label="Average crew" value={loading || current.crew == null ? "—" : current.crew.toFixed(1)} change={current.crew == null || prior.crew == null ? null : delta(current.crew, prior.crew)} goodWhenDown />
      <Metric icon={DollarSign} label="Revenue / day" value={loading ? "—" : compactMoney(current.revenue / Math.max(1, current.productionDays))} change={delta(current.revenue / Math.max(1, current.productionDays), prior.revenue / Math.max(1, prior.productionDays))} note={pct(current.priceCoverage) + " SKU price coverage"} />
      <Metric icon={DollarSign} label="Labor margin / day" value={loading ? "—" : compactMoney(current.margin / Math.max(1, current.productionDays))} change={delta(current.margin / Math.max(1, current.productionDays), prior.margin / Math.max(1, prior.productionDays))} note="Revenue less direct labor" />
      <Metric icon={Gauge} label="Labor margin %" value={loading || current.marginPct == null ? "—" : pct(current.marginPct)} change={current.marginPct == null || prior.marginPct == null ? null : current.marginPct - prior.marginPct} note="Change shown as percentage-point proxy" />
      <Metric icon={Gauge} label="OEE" value={oee == null ? "—" : pct(oee <= 1 ? oee * 100 : oee)} change={null} note={oee == null ? "No Evocon OEE rows available" : oeeValues.length + " Evocon observations"} />
    </div>
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
    <div className="text-xs text-[rgb(var(--muted))]">Data audit: production events are authoritative for output and job dimensions; labor events are authoritative for hours, cost, and crew; configured SKU rates drive revenue; Evocon drives OEE. Calendar range spans {days(ranges.currentStart, ranges.currentEnd)} days.</div>
  </div>;
}
