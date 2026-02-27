import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";

export default function RecommendationsView({ recommendations, onOpenRecommendation }) {
  const { C } = useTheme();
  const { thC, tdN, tdM } = useStyles();
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
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Input type="text" placeholder="Search action, reason, source..." value={search} onChange={function(e) { setSearch(e.target.value); }} className="h-10 w-72 text-sm" />
        <select value={ownerFilter} onChange={function(e) { setOwnerFilter(e.target.value); }} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="all">All Owners</option>
          {owners.map(function(o) { return <option key={o} value={o}>{o}</option>; })}
        </select>
        {["all", "now", "today", "week"].map(function(w) {
          return <Button key={w} onClick={function() { setWindowFilter(function(curr) { return curr === w && w !== "all" ? "all" : w; }); }} variant={windowFilter === w ? "active" : "outline"} size="default">{w === "all" ? "All" : windowLabel(w)}</Button>;
        })}
        <div style={{ flex:1 }} />
        <Badge variant="secondary">{rows.length} recommendations</Badge>
      </div>

      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.raised }}>
                <th style={thC(sortField==="priority")}><button onClick={function() { onSort("priority"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>Priority{sortField==="priority" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
                <th style={thC(sortField==="action")}><button onClick={function() { onSort("action"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>Action{sortField==="action" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
                <th style={thC(sortField==="owner")}><button onClick={function() { onSort("owner"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>Owner{sortField==="owner" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
                <th style={thC(sortField==="window")}><button onClick={function() { onSort("window"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>When{sortField==="window" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
                <th style={Object.assign({}, thC(sortField==="impact"), { textAlign:"right" })}><button onClick={function() { onSort("impact"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>Impact{sortField==="impact" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
                <th style={thC(sortField==="confidence")}><button onClick={function() { onSort("confidence"); }} style={{ border:"none", background:"transparent", padding:0, margin:0, color:"inherit", font:"inherit", cursor:"pointer", textAlign:"inherit" }}>Confidence{sortField==="confidence" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</button></th>
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
                    <Button onClick={function() { if (onOpenRecommendation) onOpenRecommendation(r); }} variant="outline" size="sm">
                      Open
                    </Button>
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
