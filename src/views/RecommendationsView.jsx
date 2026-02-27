import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

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
    if (p === "P1") return "danger";
    if (p === "P2") return "warning";
    return "info";
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

      <TableShell>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead>
              <tr style={{ background:C.raised }}>
                <th style={thC(sortField==="priority")}><SortHeaderButton onClick={function() { onSort("priority"); }}>Priority{sortField==="priority" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={thC(sortField==="action")}><SortHeaderButton onClick={function() { onSort("action"); }}>Action{sortField==="action" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={thC(sortField==="owner")}><SortHeaderButton onClick={function() { onSort("owner"); }}>Owner{sortField==="owner" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={thC(sortField==="window")}><SortHeaderButton onClick={function() { onSort("window"); }}>When{sortField==="window" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={Object.assign({}, thC(sortField==="impact"), { textAlign:"right" })}><SortHeaderButton onClick={function() { onSort("impact"); }} className="text-right">Impact{sortField==="impact" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={thC(sortField==="confidence")}><SortHeaderButton onClick={function() { onSort("confidence"); }}>Confidence{sortField==="confidence" ? (sortDir==="asc" ? " ↑" : " ↓") : ""}</SortHeaderButton></th>
                <th style={thC(false)}>Why</th>
                <th style={thC(false)}>Source</th>
                <th style={thC(false)} />
              </tr>
            </thead>
            <tbody>
              {rows.map(function(r) {
                return <tr key={r.id} style={{ borderBottom:"1px solid "+C.border }}>
                  <td style={tdN}><Badge variant={priorityStyle(r.priority)}>{r.priority}</Badge></td>
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
      </TableShell>
    </div>
  );
}
