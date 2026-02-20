import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate } from "../utils";

export default function InboundCoverageView({ inboundCoverage }) {
  const { C } = useTheme();
  const { thC, tdN, tdM, inp, pill } = useStyles();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("shortQty");
  const [sortDir, setSortDir] = useState("desc");

  const rows = useMemo(() => {
    var data = inboundCoverage && inboundCoverage.rows ? inboundCoverage.rows.slice() : [];
    if (search) {
      var q = search.toLowerCase();
      data = data.filter(function(r) {
        return (
          r.sku.toLowerCase().includes(q) ||
          (r.desc || "").toLowerCase().includes(q) ||
          (r.customerLabel || "").toLowerCase().includes(q) ||
          (r.openPOs || []).join(",").toLowerCase().includes(q)
        );
      });
    }
    if (statusFilter === "at-risk") data = data.filter(function(r) { return r.riskLevel !== "low"; });
    else if (statusFilter !== "all") data = data.filter(function(r) { return r.status === statusFilter; });

    data.sort(function(a, b) {
      var cmp = 0;
      if (sortKey === "sku") cmp = a.sku.localeCompare(b.sku);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "risk") cmp = a.riskLevel.localeCompare(b.riskLevel);
      else if (sortKey === "coverage") cmp = a.scheduledCoveragePct - b.scheduledCoveragePct;
      else if (sortKey === "shortQty") cmp = a.shortQty - b.shortQty;
      else if (sortKey === "scheduledQty") cmp = a.scheduledQty - b.scheduledQty;
      else if (sortKey === "inboundQty") cmp = a.inboundQty - b.inboundQty;
      else if (sortKey === "affectedWOCount") cmp = a.affectedWOCount - b.affectedWOCount;
      else if (sortKey === "dueDate") cmp = (a.earliestDueDate || "").localeCompare(b.earliestDueDate || "");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return data;
  }, [inboundCoverage, search, statusFilter, sortKey, sortDir]);

  if (!inboundCoverage) {
    return (
      <div style={{ background:C.surface, border:"1px solid " + C.border, borderRadius:8, padding:"20px 18px" }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.bright, marginBottom:6 }}>Inbound Coverage</div>
        <div style={{ fontSize:13, color:C.dim, lineHeight:1.5 }}>
          No inbound coverage data yet. Load Critical Items + EDR data first.
        </div>
      </div>
    );
  }

  var s = inboundCoverage.summary;
  var statusBadge = function(row) {
    if (row.status === "covered") return { text:"Covered", color:C.ok, bg:C.okSoft || C.accentSoft };
    if (row.status === "partial") return { text:"Partial", color:C.warn, bg:C.warnSoft };
    if (row.status === "unscheduled") return { text:"Unscheduled", color:C.accent, bg:C.accentSoft };
    return { text:"Missing", color:C.bad, bg:C.badSoft };
  };

  var onSort = function(key) {
    if (sortKey === key) setSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortKey(key); setSortDir("desc"); }
  };

  return (
    <div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10, marginBottom:12 }}>
        {[
          { label:"Critical SKUs", value:s.totalCriticalItems, color:C.bright },
          { label:"At Risk", value:s.atRisk, color:s.atRisk > 0 ? C.bad : C.ok },
          { label:"Missing", value:s.missing, color:s.missing > 0 ? C.bad : C.dim },
          { label:"Unscheduled", value:s.unscheduled, color:s.unscheduled > 0 ? C.warn : C.dim },
          { label:"Scheduled Qty", value:Math.round(s.totalScheduledQty).toLocaleString(), color:C.accent },
          { label:"Coverage", value:(s.totalShortQty > 0 ? Math.round((s.totalScheduledQty / s.totalShortQty) * 100) : 100) + "%", color:C.ok },
        ].map(function(kpi) {
          return (
            <div key={kpi.label} style={{ background:C.surface, border:"1px solid " + C.border, borderRadius:8, padding:"10px 12px" }}>
              <div style={{ fontSize:20, fontWeight:700, color:kpi.color, lineHeight:1 }}>{kpi.value}</div>
              <div style={{ fontSize:12, color:C.dim, marginTop:4, letterSpacing:0.1 }}>{kpi.label}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input
          type="text"
          placeholder="Search SKU, customer, PO..."
          value={search}
          onChange={function(e) { setSearch(e.target.value); }}
          style={Object.assign({}, inp, { width:220 })}
        />
        {[
          { key:"all", label:"All" },
          { key:"at-risk", label:"At Risk" },
          { key:"missing", label:"Missing" },
          { key:"unscheduled", label:"Unscheduled" },
          { key:"partial", label:"Partial" },
          { key:"covered", label:"Covered" },
        ].map(function(f) {
          return (
            <button key={f.key} onClick={function() { setStatusFilter(f.key); }} style={pill(statusFilter === f.key)}>
              {f.label}
            </button>
          );
        })}
        {(search || statusFilter !== "all") && (
          <button
            onClick={function() { setSearch(""); setStatusFilter("all"); }}
            style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}
          >
            Clear
          </button>
        )}
      </div>

      <div style={{ background:C.surface, border:"1px solid " + C.border, borderRadius:8, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.raised }}>
                {[
                  { key:"sku", label:"SKU" },
                  { key:"status", label:"Status" },
                  { key:"risk", label:"Risk" },
                  { key:"shortQty", label:"Short" },
                  { key:"scheduledQty", label:"Scheduled" },
                  { key:"inboundQty", label:"Inbound" },
                  { key:"coverage", label:"Coverage" },
                  { key:"dueDate", label:"Earliest Due" },
                  { key:"affectedWOCount", label:"WOs" },
                  { key:"openPOs", label:"POs" },
                ].map(function(col) {
                  return (
                    <th key={col.key} onClick={col.key === "openPOs" ? undefined : function() { onSort(col.key); }} style={Object.assign({}, thC(sortKey === col.key), { cursor:col.key === "openPOs" ? "default" : "pointer" })}>
                      {col.label}
                      {sortKey === col.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(function(row, idx) {
                var b = statusBadge(row);
                return (
                  <tr key={row.sku + "-" + idx} style={{ borderBottom:"1px solid " + C.border }}>
                    <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{row.sku}</td>
                    <td style={tdN}>
                      <span style={{ padding:"2px 8px", borderRadius:999, fontSize:12, fontWeight:600, color:b.color, background:b.bg }}>{b.text}</span>
                    </td>
                    <td style={Object.assign({}, tdN, { color:row.riskLevel === "high" ? C.bad : row.riskLevel === "medium" ? C.warn : C.ok, fontWeight:600 })}>
                      {row.riskLevel === "high" ? "High" : row.riskLevel === "medium" ? "Medium" : "Low"}
                    </td>
                    <td style={Object.assign({}, tdM, { color:C.bad, fontWeight:600 })}>{Math.round(row.shortQty).toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color:C.accent, fontWeight:600 })}>{Math.round(row.scheduledQty).toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color:C.dim })}>{Math.round(row.inboundQty).toLocaleString()}</td>
                    <td
                      style={Object.assign({}, tdM, { fontWeight:600, color:row.scheduledCoveragePct >= 100 ? C.ok : row.scheduledCoveragePct >= 50 ? C.warn : C.bad })}
                      title={"Scheduled " + row.scheduledCoveragePct + "% / Total inbound " + row.coveragePct + "%"}
                    >
                      {row.scheduledCoveragePct}% / {row.coveragePct}%
                    </td>
                    <td style={Object.assign({}, tdM, { color:row.dueBeforeScheduled ? C.bad : C.dim })}>{fmtDate(row.earliestDueDate)}</td>
                    <td style={tdM}>{row.affectedWOCount}</td>
                    <td style={Object.assign({}, tdN, { maxWidth:210, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:C.dim })} title={(row.openPOs || []).join(", ")}>
                      {(row.openPOs || []).length ? row.openPOs.join(", ") : "--"}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding:24, textAlign:"center", color:C.dim }}>
                    No rows match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop:8, fontSize:12, color:C.dim }}>
        Horizon: next {inboundCoverage.horizonDays} days. OpenDock status considered: Scheduled only.
      </div>
    </div>
  );
}
