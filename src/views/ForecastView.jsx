import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import { safeNum } from "../utils";

function fmtMoney(n) {
  var v = safeNum(n);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  return (safeNum(n) * 100).toFixed(1) + "%";
}

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export default function ForecastView(props) {
  var C = useTheme().C;
  var workOrders = Array.isArray(props.workOrders) ? props.workOrders : [];
  var itemMaster = Array.isArray(props.itemMaster) ? props.itemMaster : [];
  var productionData = Array.isArray(props.productionData) ? props.productionData : [];
  var initial = props.initialFilters || {};
  var onPermalinkChange = props.onPermalinkChange;
  var [monthKey, setMonthKey] = useState(currentMonthKey());
  var [overheadGlobal, setOverheadGlobal] = useState(0);
  var [cogsNonLabor, setCogsNonLabor] = useState(0);
  var [equipmentRental, setEquipmentRental] = useState(0);
  var [loading, setLoading] = useState(false);
  var [error, setError] = useState("");
  var [payload, setPayload] = useState(null);

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
    } catch (err) {
      setError(err && err.message ? err.message : "Could not run forecast.");
    } finally {
      setLoading(false);
    }
  }, [monthKey, overheadGlobal, cogsNonLabor, equipmentRental, workOrders, itemMaster]);

  useEffect(function() {
    if (!workOrders.length) return;
    runForecast();
  }, [runForecast, workOrders.length]);

  var forecast = payload && payload.forecast ? payload.forecast : null;
  var summary = forecast && forecast.summary ? forecast.summary : null;
  var bySku = forecast && Array.isArray(forecast.bySku) ? forecast.bySku : [];
  var daily = forecast && Array.isArray(forecast.daily) ? forecast.daily : [];
  var flags = forecast && Array.isArray(forecast.flags) ? forecast.flags : [];
  var topSku = useMemo(function() { return bySku.slice(0, 20); }, [bySku]);
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
    var pick = function(row, keys) {
      var rowKeys = Object.keys(row || {});
      for (var i = 0; i < keys.length; i++) {
        var target = String(keys[i] || "").toLowerCase();
        for (var j = 0; j < rowKeys.length; j++) {
          var key = rowKeys[j];
          if (String(key).toLowerCase() === target) return row[key];
        }
      }
      return "";
    };
    var dayIso = function(value) {
      if (!value) return "";
      var d = new Date(value);
      if (isNaN(d)) return "";
      return d.toISOString().slice(0, 10);
    };
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
    productionData.forEach(function(r) {
      var sku = String(pick(r, ["Item Code", "item_code", "Code", "code"])).trim();
      if (!sku) return;
      var dt = dayIso(pick(r, ["Actual Job End", "actual_job_end_at", "Produced At", "produced_at", "Actual Job Start", "actual_job_start_at"]));
      if (!dt || dt.slice(0, 7) !== monthKey) return;
      var units = safeNum(pick(r, ["Units Produced", "units_produced", "Produced", "produced"]));
      if (!(units > 0)) return;
      var rate = safeNum(skuRate[sku.toLowerCase()]);
      if (!out[dt]) out[dt] = { day_key: dt, actual_cases: 0, actual_revenue: 0 };
      out[dt].actual_cases += units;
      out[dt].actual_revenue += units * rate;
    });
    return out;
  }, [productionData, bySku, itemMaster, monthKey]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <div>
          <div className="mb-1 text-xs text-[rgb(var(--muted))]">Month</div>
          <Input type="month" value={monthKey} onChange={function(e) { setMonthKey(e.target.value); }} className="h-10 w-44 text-sm" />
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
        <Button onClick={runForecast} disabled={loading}>{loading ? "Running..." : "Run Forecast"}</Button>
      </div>

      {!!error && <div className="mb-2 text-sm text-[rgb(var(--danger))]">{error}</div>}

      {!!summary && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
          {[
            { label: "Total Cases", value: safeNum(summary.total_cases).toLocaleString() },
            { label: "Rollover Cases", value: safeNum(summary.rollover_cases).toLocaleString() },
            { label: "Rollover WOs", value: safeNum(summary.rollover_wo_count).toLocaleString() },
            { label: "Total Revenue", value: fmtMoney(summary.total_revenue) },
            { label: "Actual Revenue", value: fmtMoney(Object.values(actualByDay).reduce(function(sum, d) { return sum + safeNum(d.actual_revenue); }, 0)) },
            { label: "Total Labor Cost", value: fmtMoney(summary.total_labor_cost) },
            { label: "Labor Cost / Case", value: fmtMoney(summary.labor_cost_per_case) },
            { label: "Labor % Sales", value: fmtPct(summary.labor_pct_sales) },
            { label: "Gross Margin", value: fmtMoney(summary.gross_margin) },
            { label: "Net Operating Income", value: fmtMoney(summary.net_operating_income) },
            { label: "Headcount Hours", value: safeNum(summary.total_headcount_hours).toFixed(1) }
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

      {!!flags.length && (
        <div className="mb-3 rounded-md border border-[rgb(var(--warning))] bg-[rgba(245,158,11,0.08)] p-2 text-xs text-[rgb(var(--foreground))]">
          <div className="mb-1 font-semibold">Forecast Flags ({flags.length})</div>
          {flags.slice(0, 8).map(function(f, idx) {
            return <div key={idx}>{f.woCode || "--"} | {f.sku || "--"} | {f.message}</div>;
          })}
        </div>
      )}

      <div className="mb-3 text-sm font-semibold text-[rgb(var(--foreground))]">Top SKU Forecast</div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>SKU</th>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Description</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor $/Case</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor % Sales</th>
              </tr>
            </thead>
            <tbody>
              {!topSku.length && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: C.dim }}>No forecast rows yet.</td></tr>}
              {topSku.map(function(r, idx) {
                var desc = descriptionBySku[r.sku] || descriptionBySku[String(r.sku || "").toLowerCase()] || "--";
                return (
                  <tr key={r.sku + "-" + idx} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright, fontWeight: 600 }}>{r.sku}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text }}>{desc}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(r.planned_cases).toLocaleString()}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.revenue)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.labor_cost)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtMoney(r.labor_cost_per_case)}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{fmtPct(r.labor_pct_sales)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </TableShell>

      <div className="mb-2 mt-4 text-sm font-semibold text-[rgb(var(--foreground))]">Daily Forecast Targets</div>
      <TableShell>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: C.raised }}>
                <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: C.dim }}>Day</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Cases</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Actual Revenue</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Revenue Var</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Labor Cost</th>
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: C.dim }}>Headcount Hours</th>
              </tr>
            </thead>
            <tbody>
              {!daily.length && <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: C.dim }}>No daily targets available.</td></tr>}
              {daily.slice(0, 31).map(function(d) {
                var act = actualByDay[d.day_key] || { actual_cases: 0, actual_revenue: 0 };
                var revVar = safeNum(act.actual_revenue) - safeNum(d.revenue);
                return (
                  <tr key={d.day_key} style={{ borderBottom: "1px solid " + C.border }}>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.bright }}>{d.day_key}</td>
                    <td style={{ padding: "8px 10px", fontSize: 13, color: C.text, textAlign: "right" }}>{safeNum(d.planned_cases).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
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
