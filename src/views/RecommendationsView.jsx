import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";

export default function RecommendationsView({ recommendations, onOpenRecommendation }) {
  const { C } = useTheme();
  const { thC, tdN, tdM, inp, pill } = useStyles();
  const [windowFilter, setWindowFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("priorityScore");
  const [sortDir, setSortDir] = useState("desc");

  var owners = useMemo(function() {
    var set = new Set((recommendations || []).map(function(r) { return r.owner; }).filter(Boolean));
    return Array.from(set).sort();
  }, [recommendations]);

  var rows = useMemo(function() {
    var list = (recommendations || []).slice();
    if (windowFilter !== "all") list = list.filter(function(r) { return r.window === windowFilter; });
    if (ownerFilter !== "all") list = list.filter(function(r) { return r.owner === ownerFilter; });
    if (search) {
      var q = search.toLowerCase();
      list = list.filter(function(r) {
        return (r.action || "").toLowerCase().includes(q) || (r.why || "").toLowerCase().includes(q) || (r.source || "").toLowerCase().includes(q);
      });
    }
    list.sort(function(a, b) {
      var c = 0;
      if (sortField === "priority") c = (a.priority || "").localeCompare(b.priority || "");
      else if (sortField === "action") c = (a.action || "").localeCompare(b.action || "");
      else if (sortField === "owner") c = (a.owner || "").localeCompare(b.owner || "");
      else if (sortField === "window") c = (a.window || "").localeCompare(b.window || "");
      else if (sortField === "impact") c = (a.impactUnits || 0) - (b.impactUnits || 0);
      else if (sortField === "confidence") c = (a.confidence || "").localeCompare(b.confidence || "");
      else c = (a.priorityScore || 0) - (b.priorityScore || 0);
      return sortDir === "desc" ? -c : c;
    });
    return list;
  }, [recommendations, windowFilter, ownerFilter, search, sortField, sortDir]);

  var onSort = function(field) {
    if (sortField === field) setSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortField(field); setSortDir("desc"); }
  };

  var priorityStyle = function(p) {
    if (p === "P1") return { color:C.bad, bg:C.badSoft };
    if (p === "P2") return { color:C.warn, bg:C.warnSoft };
    return { color:C.accent, bg:C.accentSoft };
  };
  var windowLabel = function(w) { return w === "now" ? "Now" : w === "today" ? "Today" : "This Week"; };

  return (
    <div>
      <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
        <input type="text" placeholder="Search action, reason, source..." value={search} onChange={function(e) { setSearch(e.target.value); }} style={Object.assign({}, inp, { width:240 })} />
        <select value={ownerFilter} onChange={function(e) { setOwnerFilter(e.target.value); }} style={Object.assign({}, inp, { fontSize:13 })}>
          <option value="all">All Owners</option>
          {owners.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
        </select>
        {["all", "now", "today", "week"].map(function(w) {
          return <button key={w} onClick={function() { setWindowFilter(function(curr) { return curr === w && w !== "all" ? "all" : w; }); }} style={pill(windowFilter === w)}>{w === "all" ? "All" : windowLabel(w)}</button>;
        })}
        <div style={{ flex:1 }} />
        <span style={{ fontSize:13, color:C.dim }}>{rows.length} recommendations</span>
      </div>

      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.raised }}>
                <th onClick={function() { onSort("priority"); }} style={thC(sortField==="priority")}>Priority{sortField==="priority" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th onClick={function() { onSort("action"); }} style={thC(sortField==="action")}>Action{sortField==="action" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th onClick={function() { onSort("owner"); }} style={thC(sortField==="owner")}>Owner{sortField==="owner" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th onClick={function() { onSort("window"); }} style={thC(sortField==="window")}>When{sortField==="window" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th onClick={function() { onSort("impact"); }} style={Object.assign({}, thC(sortField==="impact"), { textAlign:"right" })}>Impact{sortField==="impact" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th onClick={function() { onSort("confidence"); }} style={thC(sortField==="confidence")}>Confidence{sortField==="confidence" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</th>
                <th style={thC(false)}>Why</th>
                <th style={thC(false)}>Source</th>
                <th style={thC(false)} />
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r) {
                var p = priorityStyle(r.priority);
                return <tr key={r.id} style={{ borderBottom:"1px solid "+C.border }}>
                  <td style={tdN}><span style={{ display:"inline-block", padding:"2px 7px", borderRadius:999, fontSize:11, fontWeight:700, color:p.color, background:p.bg }}>{r.priority}</span></td>
                  <td style={Object.assign({}, tdN, { color:C.bright, fontWeight:600 })}>{r.action}</td>
                  <td style={Object.assign({}, tdN, { color:C.dim })}>{r.owner}</td>
                  <td style={Object.assign({}, tdN, { color:C.dim })}>{windowLabel(r.window)}</td>
                  <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:r.impactUnits > 0 ? C.bad : C.dim })}>{r.impactUnits > 0 ? r.impactUnits.toLocaleString() : "--"}</td>
                  <td style={Object.assign({}, tdN, { color:r.confidence === "High" ? C.ok : r.confidence === "Medium" ? C.warn : C.bad, fontWeight:600 })}>{r.confidence}</td>
                  <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:340, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{r.why}</td>
                  <td style={Object.assign({}, tdN, { color:C.dim })}>{r.source}</td>
                  <td style={tdN}>
                    <button onClick={function() { if (onOpenRecommendation) onOpenRecommendation(r); }} style={{ padding:"4px 9px", borderRadius:6, border:"1px solid "+C.border, background:"transparent", cursor:"pointer", color:C.dim, fontSize:12 }}>
                      Open
                    </button>
                  </td>
                </tr>;
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding:26, textAlign:"center", color:C.dim }}>No recommendations match current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
