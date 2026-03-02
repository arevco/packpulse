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

  var prodShiftRows = productionSegments && Array.isArray(productionSegments.shiftRows) ? productionSegments.shiftRows : [];
  var prodJobRows = productionSegments && Array.isArray(productionSegments.jobRows) ? productionSegments.jobRows : [];
  var prodDates = Array.from(new Set(prodShiftRows.map(function(r) { return r.date; }))).sort().reverse();
  var selectedProdDate = prodDate === "latest" ? (prodDates[0] || "") : prodDate;
  var selectedShiftRows = selectedProdDate ? prodShiftRows.filter(function(r) { return r.date === selectedProdDate; }) : [];
  var selectedJobRows = selectedProdDate ? prodJobRows.filter(function(r) { return r.date === selectedProdDate; }) : [];
  var filteredJobRows = useMemo(function() {
    if (!search) return selectedJobRows;
    var q = search.toLowerCase();
    return selectedJobRows.filter(function(r) {
      return (
        (r.jobId || "").toLowerCase().includes(q) ||
        (r.workOrder || "").toLowerCase().includes(q) ||
        (r.itemCode || "").toLowerCase().includes(q) ||
        (r.itemDesc || "").toLowerCase().includes(q) ||
        (r.line || "").toLowerCase().includes(q)
      );
    });
  }, [search, selectedJobRows]);
  var shift1 = selectedShiftRows.find(function(r) { return r.shift === "Shift 1 (7a-3p)"; }) || null;
  var shift2 = selectedShiftRows.find(function(r) { return r.shift === "Shift 2 (3p-11p)"; }) || null;
  var dayUnitsProduced = selectedShiftRows.reduce(function(sum, r) { return sum + safeNum(r.unitsProduced); }, 0);
  var dayJobs = selectedShiftRows.reduce(function(sum, r) { return sum + safeNum(r.jobs); }, 0);

  if (!prodShiftRows.length) {
    return <div className="rounded-md border border-[rgb(var(--border))] bg-[rgb(var(--surface))] p-4 text-sm text-[rgb(var(--muted))]">No production data yet. Run Nulogy sync and include the Production report.</div>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input type="text" placeholder="Search job, WO, item, line..." value={search} onChange={function(e) { setSearch(e.target.value); }} className="h-10 w-full text-sm sm:w-72" />
        <select value={prodDate} onChange={function(e) { setProdDate(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="latest">Latest Day</option>
          {prodDates.map(function(d) { return <option key={d} value={d}>{d}</option>; })}
        </select>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(160px, 1fr))", gap:10, marginBottom:12 }}>
        {[
          { l:"Shift 1 (7a-3p)", v:shift1 ? shift1.unitsProduced.toLocaleString() : "0", c:C.ok },
          { l:"Shift 2 (3p-11p)", v:shift2 ? shift2.unitsProduced.toLocaleString() : "0", c:C.accent },
          { l:"Day Total", v:dayUnitsProduced.toLocaleString(), c:C.bright },
          { l:"Jobs", v:dayJobs.toLocaleString(), c:C.dim }
        ].map(function(s) {
          return <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
            <div style={{ fontSize:12, color:C.dim, marginTop:6, fontWeight:500 }}>{s.l}</div>
          </div>;
        })}
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
                <td style={tdM}>{r.shift.replace("Shift 1 (7a-3p)", "S1").replace("Shift 2 (3p-11p)", "S2")}</td>
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
