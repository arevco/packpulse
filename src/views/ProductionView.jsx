import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { safeNum, formatDescriptionForDisplay } from "../utils";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";

var MIN_TRUSTED_JOB_LABOR_HOURS = 0.25;

function fmtMoneyWhole(value) {
  var rounded = Math.round(safeNum(value));
  if (rounded < 0) return "-$" + Math.abs(rounded).toLocaleString();
  return "$" + rounded.toLocaleString();
}

function fmtPct(value) {
  if (value == null || !Number.isFinite(value)) return "--";
  return (safeNum(value) * 100).toFixed(1) + "%";
}

function normKey(value) {
  return String(value || "").trim().toLowerCase();
}

function mergeLaborMetric(target, row) {
  target.payable_hours += safeNum(row && row.payable_hours);
  target.productive_hours += safeNum(row && row.productive_hours);
  target.labor_cost += safeNum(row && row.labor_cost);
}

export default function ProductionView({ productionSegments, laborActuals, resolveRevenueForRow }) {
  const { C, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();

  const [prodDate, setProdDate] = useState("latest");
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");

  var prodShiftRows = productionSegments && Array.isArray(productionSegments.shiftRows) ? productionSegments.shiftRows : [];
  var prodJobRows = productionSegments && Array.isArray(productionSegments.jobRows) ? productionSegments.jobRows : [];
  var laborJobRows = laborActuals && Array.isArray(laborActuals.byJob) ? laborActuals.byJob : [];
  var totalRows = productionSegments && productionSegments.totalRows ? productionSegments.totalRows : 0;
  var rowsWithShift = productionSegments && productionSegments.rowsWithShift ? productionSegments.rowsWithShift : 0;
  var prodDates = Array.from(new Set(prodShiftRows.map(function(r) { return r.date; }))).sort().reverse();
  var selectedProdDate = prodDate === "latest" ? (prodDates[0] || "") : prodDate;
  var selectedJobRows = prodDate === "all"
    ? prodJobRows
    : (selectedProdDate ? prodJobRows.filter(function(r) { return r.date === selectedProdDate; }) : []);
  var lineOptions = Array.from(new Set(selectedJobRows.map(function(r) { return String(r.line || "Unknown").trim() || "Unknown"; }))).sort();
  var shiftOptions = Array.from(new Set(selectedJobRows.map(function(r) { return String(r.shift || "Unassigned"); }))).sort();
  var filteredJobRows = useMemo(function() {
    var rows = selectedJobRows.filter(function(r) {
      if (lineFilter !== "all" && String(r.line || "Unknown") !== lineFilter) return false;
      if (shiftFilter !== "all" && String(r.shift || "Unassigned") !== shiftFilter) return false;
      return true;
    });
    if (!search) return rows.slice().sort(function(a, b) { return safeNum(b.unitsProduced) - safeNum(a.unitsProduced); });
    var q = search.toLowerCase();
    return rows.filter(function(r) {
      return (
        (r.jobId || "").toLowerCase().includes(q) ||
        (r.workOrder || "").toLowerCase().includes(q) ||
        (r.itemCode || "").toLowerCase().includes(q) ||
        (r.itemDesc || "").toLowerCase().includes(q) ||
        (r.line || "").toLowerCase().includes(q)
      );
    }).sort(function(a, b) { return safeNum(b.unitsProduced) - safeNum(a.unitsProduced); });
  }, [search, selectedJobRows, lineFilter, shiftFilter]);

  var laborByJobKey = useMemo(function() {
    var exact = {};
    var slim = {};
    var byLineItem = {};
    var byLine = {};
    laborJobRows.forEach(function(r) {
      var exactKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.shift_label),
        normKey(r && r.line_name),
        normKey(r && r.work_order_code),
        normKey(r && r.item_code)
      ].join("|");
      var slimKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.shift_label)
      ].join("|");
      var lineItemKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.line_name),
        normKey(r && r.item_code)
      ].join("|");
      var lineKey = [
        normKey(r && r.job_id),
        normKey(r && r.date_et),
        normKey(r && r.line_name)
      ].join("|");
      if (exactKey && !exact[exactKey]) exact[exactKey] = r;
      if (slimKey && !slim[slimKey]) slim[slimKey] = r;
      if (lineItemKey) {
        if (!byLineItem[lineItemKey]) byLineItem[lineItemKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLineItem[lineItemKey], r);
      }
      if (lineKey) {
        if (!byLine[lineKey]) byLine[lineKey] = { payable_hours: 0, productive_hours: 0, labor_cost: 0 };
        mergeLaborMetric(byLine[lineKey], r);
      }
    });
    return { exact: exact, slim: slim, byLineItem: byLineItem, byLine: byLine };
  }, [laborJobRows]);

  var jobsWithLabor = useMemo(function() {
    return filteredJobRows.map(function(r) {
      var exactKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.shift),
        normKey(r.line),
        normKey(r.workOrder),
        normKey(r.itemCode)
      ].join("|");
      var slimKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.shift)
      ].join("|");
      var lineItemKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line),
        normKey(r.itemCode)
      ].join("|");
      var lineKey = [
        normKey(r.jobId),
        normKey(r.date),
        normKey(r.line)
      ].join("|");
      var labor =
        laborByJobKey.exact[exactKey] ||
        laborByJobKey.slim[slimKey] ||
        laborByJobKey.byLineItem[lineItemKey] ||
        laborByJobKey.byLine[lineKey] ||
        null;
      var rawPayableHours = safeNum(labor && labor.payable_hours);
      var payableHours = rawPayableHours >= MIN_TRUSTED_JOB_LABOR_HOURS ? rawPayableHours : 0;
      var productiveHours = payableHours > 0 ? safeNum(labor && labor.productive_hours) : 0;
      var laborCost = payableHours > 0 ? safeNum(labor && labor.labor_cost) : 0;
      var unitsProduced = safeNum(r.unitsProduced);
      var revenueMatch = typeof resolveRevenueForRow === "function" ? resolveRevenueForRow(r.itemCode, r.date) : null;
      var revenuePerCase = safeNum(revenueMatch && revenueMatch.value);
      var revenue = revenuePerCase > 0 && unitsProduced > 0 ? (unitsProduced * revenuePerCase) : 0;
      var laborMargin = revenue - laborCost;
      var laborMarginPct = revenue > 0 ? (laborMargin / revenue) : null;
      return Object.assign({}, r, {
        laborPayableHours: payableHours,
        laborProductiveHours: productiveHours,
        laborCost: laborCost,
        revenue: revenue,
        revenueCoveredUnits: revenue > 0 ? unitsProduced : 0,
        laborMargin: laborMargin,
        laborMarginPct: laborMarginPct,
        casesPerPayableHour: payableHours > 0 ? (unitsProduced / payableHours) : 0,
        laborCostPerCase: unitsProduced > 0 ? (laborCost / unitsProduced) : 0,
        hasLabor: payableHours > 0,
        hasRevenue: revenue > 0
      });
    });
  }, [filteredJobRows, laborByJobKey, resolveRevenueForRow]);

  var shiftTotals = useMemo(function() {
    var map = {};
    jobsWithLabor.forEach(function(r) {
      var shift = String(r.shift || "Unassigned");
      if (!map[shift]) map[shift] = { shift: shift, units: 0, jobs: 0, laborPayableHours: 0, laborCost: 0, laborJobs: 0 };
      map[shift].units += safeNum(r.unitsProduced);
      map[shift].jobs += 1;
      map[shift].laborPayableHours += safeNum(r.laborPayableHours);
      map[shift].laborCost += safeNum(r.laborCost);
      if (r.hasLabor) map[shift].laborJobs += 1;
    });
    return Object.values(map).sort(function(a, b) { return b.units - a.units; });
  }, [jobsWithLabor]);

  var lineLoad = useMemo(function() {
    var map = {};
    var totalUnits = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
    jobsWithLabor.forEach(function(r) {
      var line = String(r.line || "Unknown").trim() || "Unknown";
      if (!map[line]) {
        map[line] = {
          line: line,
          units: 0,
          jobs: 0,
          laborPayableHours: 0,
          laborCost: 0,
          revenue: 0,
          revenueCoveredUnits: 0,
          laborMargin: 0
        };
      }
      map[line].units += safeNum(r.unitsProduced);
      map[line].jobs += 1;
      map[line].laborPayableHours += safeNum(r.laborPayableHours);
      map[line].laborCost += safeNum(r.laborCost);
      map[line].revenue += safeNum(r.revenue);
      map[line].revenueCoveredUnits += safeNum(r.revenueCoveredUnits);
      map[line].laborMargin += safeNum(r.laborMargin);
    });
    return Object.values(map).map(function(r) {
      return Object.assign({}, r, {
        sharePct: totalUnits > 0 ? Math.round((r.units / totalUnits) * 100) : 0,
        revenueCoveragePct: r.units > 0 ? Math.round((r.revenueCoveredUnits / r.units) * 100) : 0,
        casesPerMinute: r.laborPayableHours > 0 ? (r.units / (r.laborPayableHours * 60)) : 0,
        laborCostPerCase: r.units > 0 ? (r.laborCost / r.units) : 0,
        laborMarginPct: r.revenue > 0 ? (r.laborMargin / r.revenue) : null
      });
    }).sort(function(a, b) { return b.units - a.units; });
  }, [jobsWithLabor]);

  var jobRollup = useMemo(function() {
    var map = {};
    jobsWithLabor.forEach(function(r) {
      var key = [r.jobId || "", r.workOrder || "", r.line || "", r.itemCode || ""].join("|");
      if (!map[key]) {
        map[key] = {
          key: key,
          jobId: r.jobId || "--",
          workOrder: r.workOrder || "--",
          line: r.line || "Unknown",
          itemCode: r.itemCode || "--",
          itemDesc: formatDescriptionForDisplay(r.itemDesc) || "--",
          unitsProduced: 0,
          laborPayableHours: 0,
          laborCost: 0,
          revenue: 0,
          revenueCoveredUnits: 0,
          laborMargin: 0,
          shifts: {}
        };
      }
      map[key].unitsProduced += safeNum(r.unitsProduced);
      map[key].laborPayableHours += safeNum(r.laborPayableHours);
      map[key].laborCost += safeNum(r.laborCost);
      map[key].revenue += safeNum(r.revenue);
      map[key].revenueCoveredUnits += safeNum(r.revenueCoveredUnits);
      map[key].laborMargin += safeNum(r.laborMargin);
      map[key].shifts[String(r.shift || "Unassigned")] = true;
    });
    return Object.values(map).map(function(r) {
      return Object.assign({}, r, {
        shiftCount: Object.keys(r.shifts).length,
        casesPerPayableHour: r.laborPayableHours > 0 ? (r.unitsProduced / r.laborPayableHours) : 0,
        laborCostPerCase: r.unitsProduced > 0 ? (r.laborCost / r.unitsProduced) : 0,
        revenueCoveragePct: r.unitsProduced > 0 ? Math.round((r.revenueCoveredUnits / r.unitsProduced) * 100) : 0,
        laborMarginPct: r.revenue > 0 ? (r.laborMargin / r.revenue) : null
      });
    }).sort(function(a, b) { return b.unitsProduced - a.unitsProduced; });
  }, [jobsWithLabor]);

  var totalUnitsProduced = jobsWithLabor.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
  var topLine = lineLoad[0] || null;
  var topJob = jobRollup[0] || null;
  var shift1Total = shiftTotals.find(function(r) { return r.shift === "Shift 1 (7a-3p)"; }) || null;
  var shift2Total = shiftTotals.find(function(r) { return r.shift === "Shift 2 (3p-11p)"; }) || null;
  var shift1Units = shift1Total ? shift1Total.units : 0;
  var shift2Units = shift2Total ? shift2Total.units : 0;
  var shift1Jobs = shift1Total ? shift1Total.jobs : 0;
  var shift2Jobs = shift2Total ? shift2Total.jobs : 0;
  var shift1Share = totalUnitsProduced > 0 ? Math.round((shift1Units / totalUnitsProduced) * 100) : 0;
  var shift2Share = totalUnitsProduced > 0 ? Math.round((shift2Units / totalUnitsProduced) * 100) : 0;
  var shift1AvgPerJob = shift1Jobs > 0 ? Math.round(shift1Units / shift1Jobs) : 0;
  var shift2AvgPerJob = shift2Jobs > 0 ? Math.round(shift2Units / shift2Jobs) : 0;
  var shift1Delta = shift1Units - shift2Units;
  var shift2Delta = shift2Units - shift1Units;

  var shortShift = function(shiftLabel) {
    return String(shiftLabel || "")
      .replace("Shift 1 (7a-3p)", "S1")
      .replace("Shift 2 (3p-11p)", "S2");
  };
  var formatDelta = function(value) {
    if (!value) return "even";
    return (value > 0 ? "+" : "-") + Math.abs(value).toLocaleString();
  };
  var shiftCompareText = function(selfJobs, otherJobs, delta, otherLabel, avgPerJob) {
    if (!selfJobs && !otherJobs) return "no shift data";
    if (!selfJobs) return "no jobs logged";
    if (!otherJobs) return "no " + otherLabel + " compare yet";
    return formatDelta(delta) + " vs " + otherLabel + " · " + avgPerJob.toLocaleString() + "/job";
  };
  var laborRateText = function(hours, cases, cost) {
    if (!(hours > 0) || !(cases > 0)) return "labor not matched";
    return (cases / hours).toFixed(1) + " cs/lh · " + fmtMoneyWhole(cost / cases) + "/case";
  };

  if (!prodShiftRows.length) {
    return <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 text-sm text-[rgb(var(--muted))]">
      {totalRows > 0
        ? ("Production rows loaded (" + totalRows.toLocaleString() + "), but " + (rowsWithShift || 0).toLocaleString() + " had usable shift timestamps. Check Nulogy timestamp columns.")
        : "No production data yet. Run Nulogy sync and include the Production report."}
    </div>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="text" placeholder="Search WO / SKU / job / line" value={search} onChange={function(e) { setSearch(e.target.value); }} className="h-10 w-full text-sm sm:w-72" />
        <select value={prodDate} onChange={function(e) { setProdDate(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Days</option>
          <option value="latest">Latest Day</option>
          {prodDates.map(function(d) { return <option key={d} value={d}>{d}</option>; })}
        </select>
        <select value={lineFilter} onChange={function(e) { setLineFilter(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Lines</option>
          {lineOptions.map(function(line) { return <option key={line} value={line}>{line}</option>; })}
        </select>
        <select value={shiftFilter} onChange={function(e) { setShiftFilter(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Shifts</option>
          {shiftOptions.map(function(shift) { return <option key={shift} value={shift}>{shortShift(shift)}</option>; })}
        </select>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:10, marginBottom:10 }}>
        {[
          { l:"Units", v:totalUnitsProduced.toLocaleString(), s:prodDate === "all" ? "all matching days" : (selectedProdDate || "selected day"), c:C.bright },
          { l:"Shift 1 Yield", v:shift1Units.toLocaleString(), s:"7a-3p · " + shift1Share + "% share", t:shiftCompareText(shift1Jobs, shift2Jobs, shift1Delta, "S2", shift1AvgPerJob), meta:laborRateText(safeNum(shift1Total && shift1Total.laborPayableHours), shift1Units, safeNum(shift1Total && shift1Total.laborCost)), c:C.ok },
          { l:"Shift 2 Yield", v:shift2Units.toLocaleString(), s:"3p-11p · " + shift2Share + "% share", t:shiftCompareText(shift2Jobs, shift1Jobs, shift2Delta, "S1", shift2AvgPerJob), meta:laborRateText(safeNum(shift2Total && shift2Total.laborPayableHours), shift2Units, safeNum(shift2Total && shift2Total.laborCost)), c:C.accent },
          { l:"Top Line", v:topLine ? topLine.line : "--", s:topLine ? (topLine.units.toLocaleString() + " cs · " + topLine.sharePct + "% share") : "no line data", meta:topLine ? laborRateText(topLine.laborPayableHours, topLine.units, topLine.laborCost) : "labor not matched", c:C.ok }
        ].map(function(s) {
          return <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:600 }}>{s.l}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.s}</div>
            {s.t ? <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.t}</div> : null}
            {s.meta ? <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.meta}</div> : null}
          </div>;
        })}
        <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
          <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:C.accent, lineHeight:1 }}>
            {topJob ? (topJob.itemCode || "--") : "--"}
          </div>
          <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:600 }}>Top Job</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {topJob ? (topJob.itemDesc || "--") : "no job data"}
          </div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
            {topJob ? (topJob.unitsProduced.toLocaleString() + " cs · Job " + topJob.jobId + " · " + topJob.line) : ""}
          </div>
          <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>
            {topJob ? laborRateText(topJob.laborPayableHours, topJob.unitsProduced, topJob.laborCost) : ""}
          </div>
        </div>
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3">
          <div className="mb-2 text-sm font-semibold">Line Load</div>
          <TableShell className="overflow-x-auto overflow-y-hidden">
            <table style={{ width:"100%", minWidth:980, borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:C.raised }}>
                  <th style={thS}>Line</th>
                  <th style={thS}>Share</th>
                  <th style={thS}>Units</th>
                  <th style={thS}>Revenue</th>
                  <th style={thS}>Labor Hrs</th>
                  <th style={thS}>Labor</th>
                  <th style={thS}>Labor Margin</th>
                  <th style={thS}>Margin %</th>
                  <th style={thS}>Cases/Min</th>
                </tr>
              </thead>
              <tbody>
                {lineLoad.slice(0, 6).map(function(r) {
                  return (
                    <tr key={r.line} style={{ borderBottom:"1px solid "+C.border }}>
                      <td style={tdM}>{r.line}</td>
                      <td style={tdM}>{r.sharePct}%</td>
                      <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.units.toLocaleString()}</td>
                      <td style={tdM}>
                        {r.revenue > 0 ? fmtMoneyWhole(r.revenue) : "--"}
                        {r.revenue > 0 && r.revenueCoveragePct > 0 && r.revenueCoveragePct < 100 ? (
                          <div style={{ fontSize:11, color:C.dim }}>{r.revenueCoveragePct}% cov</div>
                        ) : null}
                      </td>
                      <td style={tdM}>{r.laborPayableHours > 0 ? r.laborPayableHours.toFixed(1) : "--"}</td>
                      <td style={tdM}>{r.laborCost > 0 ? fmtMoneyWhole(r.laborCost) : "--"}</td>
                      <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.laborMargin) : "--"}</td>
                      <td style={tdM}>{r.revenue > 0 ? fmtPct(r.laborMarginPct) : "--"}</td>
                      <td style={tdM}>{r.casesPerMinute > 0 ? r.casesPerMinute.toFixed(2) : "--"}</td>
                    </tr>
                  );
                })}
                {!lineLoad.length && <tr><td colSpan={9} style={{ padding:20, textAlign:"center", color:C.dim }}>No line load for current filters.</td></tr>}
              </tbody>
            </table>
          </TableShell>
        </div>

        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3">
          <div className="mb-2 text-sm font-semibold">Top Jobs</div>
          <TableShell>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:C.raised }}>
                  <th style={thS}>Job</th>
                  <th style={thS}>WO#</th>
                  <th style={thS}>Line</th>
                  <th style={thS}>Units</th>
                  <th style={thS}>Revenue</th>
                  <th style={thS}>Labor</th>
                  <th style={thS}>Labor Margin</th>
                  <th style={thS}>Margin %</th>
                  <th style={thS}>Cases/LH</th>
                </tr>
              </thead>
              <tbody>
                {jobRollup.slice(0, 6).map(function(r) {
                  return (
                    <tr key={r.key} style={{ borderBottom:"1px solid "+C.border }}>
                      <td style={tdM}>
                        <div style={{ fontWeight:600, color:C.bright }}>{r.jobId}</div>
                        <div style={{ fontSize:11, color:C.dim }}>{r.itemCode}</div>
                      </td>
                      <td style={tdM}>{r.workOrder}</td>
                      <td style={tdM}>{r.line}</td>
                      <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.unitsProduced.toLocaleString()}</td>
                      <td style={tdM}>
                        {r.revenue > 0 ? fmtMoneyWhole(r.revenue) : "--"}
                        {r.revenue > 0 && r.revenueCoveragePct > 0 && r.revenueCoveragePct < 100 ? (
                          <div style={{ fontSize:11, color:C.dim }}>{r.revenueCoveragePct}% cov</div>
                        ) : null}
                      </td>
                      <td style={tdM}>{r.laborCost > 0 ? fmtMoneyWhole(r.laborCost) : "--"}</td>
                      <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.laborMargin) : "--"}</td>
                      <td style={tdM}>{r.revenue > 0 ? fmtPct(r.laborMarginPct) : "--"}</td>
                      <td style={tdM}>{r.casesPerPayableHour > 0 ? r.casesPerPayableHour.toFixed(1) : "--"}</td>
                    </tr>
                  );
                })}
                {!jobRollup.length && <tr><td colSpan={9} style={{ padding:20, textAlign:"center", color:C.dim }}>No jobs for current filters.</td></tr>}
              </tbody>
            </table>
          </TableShell>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Job Rows</div>
        <div className="text-xs text-[rgb(var(--muted))]">Showing {Math.min(filteredJobRows.length, 100)} of {filteredJobRows.length.toLocaleString()} rows</div>
      </div>
      <TableShell>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <th style={thS}>Shift</th>
            <th style={thS}>Job ID</th>
            <th style={thS}>WO#</th>
            <th style={thS}>Line</th>
            <th style={thS}>Item</th>
            <th style={thS}>Description</th>
            <th style={thS}>Units Produced</th>
            <th style={thS}>Revenue</th>
            <th style={thS}>Labor Hrs</th>
            <th style={thS}>Labor Cost</th>
            <th style={thS}>Labor Margin</th>
            <th style={thS}>Margin %</th>
          </tr></thead>
          <tbody>
            {jobsWithLabor.slice(0, 100).map(function(r, i) {
              return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                <td style={tdM}>{shortShift(r.shift)}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{r.jobId}</td>
                <td style={tdM}>{r.workOrder}</td>
                <td style={tdM}>{r.line}</td>
                <td style={tdM}>{r.itemCode}</td>
                <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{formatDescriptionForDisplay(r.itemDesc) || "--"}</td>
                <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.unitsProduced.toLocaleString()}</td>
                <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.revenue) : "--"}</td>
                <td style={tdM}>{r.laborPayableHours > 0 ? r.laborPayableHours.toFixed(1) : "--"}</td>
                <td style={tdM}>{r.laborCost > 0 ? fmtMoneyWhole(r.laborCost) : "--"}</td>
                <td style={tdM}>{r.revenue > 0 ? fmtMoneyWhole(r.laborMargin) : "--"}</td>
                <td style={tdM}>{r.revenue > 0 ? fmtPct(r.laborMarginPct) : "--"}</td>
              </tr>;
            })}
            {jobsWithLabor.length === 0 && (
              <tr><td colSpan={12} style={{ padding:24, textAlign:"center", color:C.dim }}>No production rows for the selected day/filters.</td></tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
