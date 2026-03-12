import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { safeNum, formatDescriptionForDisplay } from "../utils";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";

export default function ProductionView({ productionSegments }) {
  const { C, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();

  const [prodDate, setProdDate] = useState("latest");
  const [search, setSearch] = useState("");
  const [lineFilter, setLineFilter] = useState("all");
  const [shiftFilter, setShiftFilter] = useState("all");

  var prodShiftRows = productionSegments && Array.isArray(productionSegments.shiftRows) ? productionSegments.shiftRows : [];
  var prodJobRows = productionSegments && Array.isArray(productionSegments.jobRows) ? productionSegments.jobRows : [];
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

  var shiftTotals = useMemo(function() {
    var map = {};
    filteredJobRows.forEach(function(r) {
      var shift = String(r.shift || "Unassigned");
      if (!map[shift]) map[shift] = { shift: shift, units: 0, jobs: 0 };
      map[shift].units += safeNum(r.unitsProduced);
      map[shift].jobs += 1;
    });
    return Object.values(map).sort(function(a, b) { return b.units - a.units; });
  }, [filteredJobRows]);

  var lineLoad = useMemo(function() {
    var map = {};
    var totalUnits = filteredJobRows.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
    filteredJobRows.forEach(function(r) {
      var line = String(r.line || "Unknown").trim() || "Unknown";
      if (!map[line]) map[line] = { line: line, units: 0, jobs: 0 };
      map[line].units += safeNum(r.unitsProduced);
      map[line].jobs += 1;
    });
    return Object.values(map).map(function(r) {
      return Object.assign({}, r, {
        sharePct: totalUnits > 0 ? Math.round((r.units / totalUnits) * 100) : 0
      });
    }).sort(function(a, b) { return b.units - a.units; });
  }, [filteredJobRows]);

  var jobRollup = useMemo(function() {
    var map = {};
    filteredJobRows.forEach(function(r) {
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
          shifts: {}
        };
      }
      map[key].unitsProduced += safeNum(r.unitsProduced);
      map[key].shifts[String(r.shift || "Unassigned")] = true;
    });
    return Object.values(map).map(function(r) {
      return Object.assign({}, r, {
        shiftCount: Object.keys(r.shifts).length
      });
    }).sort(function(a, b) { return b.unitsProduced - a.unitsProduced; });
  }, [filteredJobRows]);

  var totalUnitsProduced = filteredJobRows.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
  var totalJobRowsVisible = filteredJobRows.length;
  var topLine = lineLoad[0] || null;
  var topJob = jobRollup[0] || null;
  var topShift = shiftTotals[0] || null;

  var shortShift = function(shiftLabel) {
    return String(shiftLabel || "")
      .replace("Shift 1 (7a-3p)", "S1")
      .replace("Shift 2 (3p-11p)", "S2");
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

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10, marginBottom:10 }}>
        {[
          { l:"Units", v:totalUnitsProduced.toLocaleString(), s:prodDate === "all" ? "all matching days" : (selectedProdDate || "selected day"), c:C.bright },
          { l:"Job Rows", v:totalJobRowsVisible.toLocaleString(), s:"matching rows", c:C.dim },
          { l:"Top Line", v:topLine ? topLine.line : "--", s:topLine ? (topLine.units.toLocaleString() + " cs · " + topLine.sharePct + "% share") : "no line data", c:C.ok },
          { l:"Top Job", v:topJob ? topJob.jobId : "--", s:topJob ? (topJob.unitsProduced.toLocaleString() + " cs on " + topJob.line) : "no job data", c:C.accent }
        ].map(function(s) {
          return <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:600 }}>{s.l}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:4 }}>{s.s}</div>
          </div>;
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[rgb(var(--muted))]">
        {shiftTotals.map(function(r) {
          return (
            <span key={r.shift} className="inline-flex items-center gap-1 rounded-full border border-[rgb(var(--border))] px-2 py-1">
              <span className="font-semibold">{shortShift(r.shift)}</span>
              <span>{r.units.toLocaleString()} cs</span>
            </span>
          );
        })}
        {topShift ? <span>Shift leader: <span className="font-semibold">{shortShift(topShift.shift)}</span></span> : null}
      </div>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--surface))] px-3 py-3">
          <div className="mb-2 text-sm font-semibold">Line Load</div>
          <TableShell>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ background:C.raised }}>
                  <th style={thS}>Line</th>
                  <th style={thS}>Jobs</th>
                  <th style={thS}>Share</th>
                  <th style={thS}>Units</th>
                </tr>
              </thead>
              <tbody>
                {lineLoad.slice(0, 6).map(function(r) {
                  return (
                    <tr key={r.line} style={{ borderBottom:"1px solid "+C.border }}>
                      <td style={tdM}>{r.line}</td>
                      <td style={tdM}>{r.jobs.toLocaleString()}</td>
                      <td style={tdM}>{r.sharePct}%</td>
                      <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.units.toLocaleString()}</td>
                    </tr>
                  );
                })}
                {!lineLoad.length && <tr><td colSpan={4} style={{ padding:20, textAlign:"center", color:C.dim }}>No line load for current filters.</td></tr>}
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
                    </tr>
                  );
                })}
                {!jobRollup.length && <tr><td colSpan={4} style={{ padding:20, textAlign:"center", color:C.dim }}>No jobs for current filters.</td></tr>}
              </tbody>
            </table>
          </TableShell>
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Job Rows</div>
        <div className="text-xs text-[rgb(var(--muted))]">Top {Math.min(filteredJobRows.length, 100)} of {filteredJobRows.length.toLocaleString()} matching rows</div>
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
          </tr></thead>
          <tbody>
            {filteredJobRows.slice(0, 100).map(function(r, i) {
              return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                <td style={tdM}>{shortShift(r.shift)}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{r.jobId}</td>
                <td style={tdM}>{r.workOrder}</td>
                <td style={tdM}>{r.line}</td>
                <td style={tdM}>{r.itemCode}</td>
                <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{formatDescriptionForDisplay(r.itemDesc) || "--"}</td>
                <td style={Object.assign({}, tdM, { fontWeight:700, color:C.ok })}>{r.unitsProduced.toLocaleString()}</td>
              </tr>;
            })}
            {filteredJobRows.length === 0 && (
              <tr><td colSpan={7} style={{ padding:24, textAlign:"center", color:C.dim }}>No production rows for the selected day/filters.</td></tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>
  );
}
