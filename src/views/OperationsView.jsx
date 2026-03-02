import { useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Card } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import TableShell from "../components/ui/table-shell";

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

export default function OperationsView() {
  const { C, mono } = useTheme();
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [trends, setTrends] = useState(null);
  const [inputs, setInputs] = useState([]);
  const [breakdown, setBreakdown] = useState({ bySku: [], byLine: [], totalRows: 0 });
  const [rates, setRates] = useState([
    { role: "labor", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "fork", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "qa", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "maint", hourly_rate: 20.1, markup_pct: 0.2 },
    { role: "recycling", hourly_rate: 20.1, markup_pct: 0.2 },
  ]);
  const [targets, setTargets] = useState([]);
  const [saving, setSaving] = useState(false);

  const [entry, setEntry] = useState({
    date_et: new Date().toISOString().slice(0, 10),
    shift_label: "Shift 1 (7a-3p)",
    line_name: "Line 1",
    labor_count: 10,
    fork_count: 1.5,
    qa_count: 0.5,
    maint_count: 0.5,
    recycling_count: 0.5,
    hours_run_override: "",
    notes: "",
  });

  var loadAll = async function() {
    setLoading(true);
    setErr("");
    try {
      var [tr, ip, cfg, br] = await Promise.all([
        fetch("/api/cache/production-trends?days=" + days, { credentials: "include" }),
        fetch("/api/ops/shift-inputs?days=" + days, { credentials: "include" }),
        fetch("/api/ops/config", { credentials: "include" }),
        fetch("/api/ops/production-breakdown?days=" + days, { credentials: "include" }),
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
        bySku: Array.isArray(brBody.bySku) ? brBody.bySku : [],
        byLine: Array.isArray(brBody.byLine) ? brBody.byLine : [],
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
  }, [days]);

  var targetBySku = useMemo(function() {
    var map = {};
    targets.forEach(function(t) {
      var k = String(t.item_code || "").trim();
      if (!k) return;
      if (!map[k]) map[k] = t;
    });
    return map;
  }, [targets]);

  var metrics = useMemo(function() {
    var byDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay : [];
    var byShift = (trends && Array.isArray(trends.byShift)) ? trends.byShift : [];
    var totalUnits = byDay.reduce(function(sum, d) { return sum + safeNum(d.units); }, 0);
    var avgDailyUnits = byDay.length ? Math.round(totalUnits / byDay.length) : 0;
    var today = new Date().toISOString().slice(0, 10);
    var expectedShifts = trends ? businessDaysBetween(trends.fromDate, today) * 2 : 0;
    var shiftKeySet = {};
    inputs.forEach(function(r) {
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
    inputs.forEach(function(r) {
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

    var estimatedRevenue = breakdown.bySku.reduce(function(sum, s) {
      var k = String(s.item_code || "").trim();
      var t = targetBySku[k];
      if (!t) return sum;
      return sum + safeNum(s.units) * safeNum(t.revenue_per_case);
    }, 0);
    var mappedSkuCount = breakdown.bySku.filter(function(s) { return !!targetBySku[String(s.item_code || "").trim()]; }).length;
    var unmappedSkuCount = Math.max(0, breakdown.bySku.length - mappedSkuCount);

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
  }, [trends, inputs, rates, breakdown, targetBySku]);

  var topSku = useMemo(function() {
    return breakdown.bySku.slice(0, 10).map(function(s) {
      var t = targetBySku[String(s.item_code || "").trim()];
      return {
        item_code: s.item_code,
        units: safeNum(s.units),
        estRev: t ? safeNum(t.revenue_per_case) * safeNum(s.units) : null,
      };
    });
  }, [breakdown, targetBySku]);

  var barData = useMemo(function() {
    var byDay = (trends && Array.isArray(trends.byDay)) ? trends.byDay.slice().reverse() : [];
    var max = byDay.reduce(function(m, d) { return Math.max(m, safeNum(d.units)); }, 0) || 1;
    return byDay.map(function(d) {
      return { date: d.date, units: safeNum(d.units), pct: Math.round((safeNum(d.units) / max) * 100) };
    });
  }, [trends]);

  async function saveShiftInput() {
    setSaving(true);
    setErr("");
    try {
      var resp = await fetch("/api/ops/shift-inputs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry)
      });
      var body = await resp.json();
      if (!resp.ok) throw new Error(body.error || "Could not save shift input");
      await loadAll();
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
        <select value={days} onChange={function(e) { setDays(Number(e.target.value)); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm">
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
          <option value={60}>60 days</option>
          <option value={90}>90 days</option>
        </select>
        <Button variant="outline" size="sm" onClick={loadAll} disabled={loading || saving}>Refresh</Button>
        {loading && <span className="text-xs text-[rgb(var(--muted))]">Loading…</span>}
      </div>

      {err && <Card className="border-[rgb(var(--danger-line))] bg-[rgb(var(--danger-soft))] px-3 py-2 text-sm text-[rgb(var(--danger))]">{err}</Card>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="px-4 py-3"><div className="text-2xl font-bold" style={{ fontFamily: mono }}>{metrics.totalUnits.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Cases Produced</div></Card>
        <Card className="px-4 py-3"><div className="text-2xl font-bold" style={{ fontFamily: mono }}>{metrics.avgDailyUnits.toLocaleString()}</div><div className="text-xs text-[rgb(var(--muted))]">Avg Cases / Day</div></Card>
        <Card className="px-4 py-3"><div className="text-2xl font-bold" style={{ fontFamily: mono }}>{metrics.coveragePct}%</div><div className="text-xs text-[rgb(var(--muted))]">Labor Input Coverage ({metrics.enteredShifts}/{metrics.expectedShifts} shifts)</div></Card>
        <Card className="px-4 py-3"><div className="text-2xl font-bold" style={{ fontFamily: mono }}>{fmtMoney(metrics.laborCost)}</div><div className="text-xs text-[rgb(var(--muted))]">Estimated Labor Cost</div></Card>
      </div>

      <Card className="px-4 py-4">
        <div className="mb-2 text-sm font-semibold">Daily Production Trend</div>
        <div className="flex h-44 items-end gap-1.5 overflow-x-auto">
          {barData.map(function(d) {
            return (
              <div key={d.date} className="flex min-w-[34px] flex-col items-center gap-1">
                <div className="w-7 rounded-t bg-[rgb(var(--accent))]" style={{ height: Math.max(8, Math.round((d.pct / 100) * 130)) + "px", opacity: 0.85 }} />
                <div className="text-[10px] text-[rgb(var(--muted))]">{d.date.slice(5)}</div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Manual Shift Labor Input</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Input type="date" value={entry.date_et} onChange={function(e){ setEntry(Object.assign({}, entry, { date_et: e.target.value })); }} />
            <select value={entry.shift_label} onChange={function(e){ setEntry(Object.assign({}, entry, { shift_label: e.target.value })); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm">
              <option>Shift 1 (7a-3p)</option>
              <option>Shift 2 (3p-11p)</option>
            </select>
            <Input value={entry.line_name} onChange={function(e){ setEntry(Object.assign({}, entry, { line_name: e.target.value })); }} placeholder="Line 1" />
            <Input type="number" step="0.5" value={entry.labor_count} onChange={function(e){ setEntry(Object.assign({}, entry, { labor_count: e.target.value })); }} placeholder="Labor" />
            <Input type="number" step="0.5" value={entry.fork_count} onChange={function(e){ setEntry(Object.assign({}, entry, { fork_count: e.target.value })); }} placeholder="Fork" />
            <Input type="number" step="0.5" value={entry.qa_count} onChange={function(e){ setEntry(Object.assign({}, entry, { qa_count: e.target.value })); }} placeholder="QA" />
            <Input type="number" step="0.5" value={entry.maint_count} onChange={function(e){ setEntry(Object.assign({}, entry, { maint_count: e.target.value })); }} placeholder="Maint" />
            <Input type="number" step="0.5" value={entry.recycling_count} onChange={function(e){ setEntry(Object.assign({}, entry, { recycling_count: e.target.value })); }} placeholder="Recycling" />
            <Input type="number" step="0.25" value={entry.hours_run_override} onChange={function(e){ setEntry(Object.assign({}, entry, { hours_run_override: e.target.value })); }} placeholder="Hours Run (optional)" />
          </div>
          <div className="mt-2">
            <Input value={entry.notes} onChange={function(e){ setEntry(Object.assign({}, entry, { notes: e.target.value })); }} placeholder="Notes (optional)" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button onClick={saveShiftInput} disabled={saving}>{saving ? "Saving..." : "Save Shift Input"}</Button>
            <span className="text-xs text-[rgb(var(--muted))]">Inputs power labor cost and margin reporting.</span>
          </div>
        </Card>

        <Card className="px-4 py-4">
          <div className="mb-2 text-sm font-semibold">Labor Rate Settings</div>
          <div className="space-y-2">
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
          </div>
          <div className="mt-3">
            <Button variant="outline" onClick={saveRates} disabled={saving}>{saving ? "Saving..." : "Save Rates"}</Button>
          </div>
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
          <div className="mb-2 text-sm font-semibold">Recent Labor Inputs</div>
          <TableShell>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr style={{ background:C.raised }}>
                <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Date</th>
                <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Shift</th>
                <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Line</th>
                <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[rgb(var(--muted))]">Total HC</th>
              </tr></thead>
              <tbody>
                {inputs.slice(0, 12).map(function(r, i) {
                  var total = safeNum(r.labor_count) + safeNum(r.fork_count) + safeNum(r.qa_count) + safeNum(r.maint_count) + safeNum(r.recycling_count);
                  return <tr key={i} style={{ borderBottom:"1px solid " + C.border }}>
                    <td className="px-2 py-2 text-sm">{r.date_et}</td>
                    <td className="px-2 py-2 text-sm">{r.shift_label}</td>
                    <td className="px-2 py-2 text-sm">{r.line_name}</td>
                    <td className="px-2 py-2 text-right text-sm" style={{ fontFamily: mono }}>{total}</td>
                  </tr>;
                })}
                {!inputs.length && <tr><td colSpan={4} className="px-2 py-6 text-center text-sm text-[rgb(var(--muted))]">No labor inputs saved yet.</td></tr>}
              </tbody>
            </table>
          </TableShell>
        </Card>
      </div>
    </div>
  );
}

