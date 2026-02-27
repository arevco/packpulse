import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { triggerDownload, buildExportHTML } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

var FLAG_LABELS = { "missing-desc":"Missing Description", "not-in-inventory":"Not in Inventory", "no-bom":"No BOM", "fg-not-in-inventory":"FG Not in Inventory", "zero-stock":"Zero Stock" };

export default function FlagsView({ flags }) {
  const { C } = useTheme();
  const { thC, tdN, tdM } = useStyles();
  var safeFlags = Array.isArray(flags) ? flags : [];

  const [flagSearch, setFlagSearch] = useState("");
  const [flagFilterType, setFlagFilterType] = useState("all");
  const [flagFilterSeverity, setFlagFilterSeverity] = useState("all");
  const [flagSort, setFlagSort] = useState("severity");
  const [flagSortDir, setFlagSortDir] = useState("desc");

  var handleFlagSort = f => { if (flagSort === f) setFlagSortDir(d => d==="asc"?"desc":"asc"); else { setFlagSort(f); setFlagSortDir("desc"); } };

  var filteredFlags = useMemo(() => {
    var f = safeFlags.slice();
    if (flagFilterType !== "all") f = f.filter(x => x.type === flagFilterType);
    if (flagFilterSeverity !== "all") f = f.filter(x => x.severity === flagFilterSeverity);
    if (flagSearch) { var q = flagSearch.toLowerCase(); f = f.filter(x => x.sku.toLowerCase().includes(q) || (x.desc||"").toLowerCase().includes(q) || x.detail.toLowerCase().includes(q) || x.affectedWOs.some(w => w.toLowerCase().includes(q))); }
    var sevOrd = { bad:0, warn:1, info:2 };
    f.sort((a,b) => { var c = 0; if (flagSort==="severity") c = (sevOrd[a.severity]||9) - (sevOrd[b.severity]||9); else if (flagSort==="sku") c = a.sku.localeCompare(b.sku); else if (flagSort==="type") c = a.type.localeCompare(b.type); else if (flagSort==="source") c = a.source.localeCompare(b.source); else if (flagSort==="affectedWOs") c = a.affectedWOs.length - b.affectedWOs.length; return flagSortDir==="desc" ? -c : c; });
    return f;
  }, [safeFlags, flagFilterType, flagFilterSeverity, flagSearch, flagSort, flagSortDir]);

  var exportFlagsCSV = () => { if (!filteredFlags.length) return; var h = ["Severity","Type","SKU","Description","Source","Detail","Affected WOs"]; var rows = filteredFlags.map(f => [f.severity.toUpperCase(), FLAG_LABELS[f.type]||f.type, f.sku, '"'+(f.desc||"").replace(/"/g,'""')+'"', f.source, '"'+f.detail.replace(/"/g,'""')+'"', '"'+f.affectedWOs.join("; ")+'"']); triggerDownload([h.join(",")].concat(rows.map(r=>r.join(","))).join("\n"), "data_flags_"+new Date().toISOString().slice(0,10)+".csv", "text/csv"); };
  var exportFlagsPDF = () => { if (!filteredFlags.length) return; var th = ["Severity","Type","SKU","Description","Source","Detail","WOs"].map(h=>"<th>"+h+"</th>").join(""); var tb = filteredFlags.map(f => '<tr><td class="'+(f.severity==="bad"?"blocked":"partial")+'">'+f.severity.toUpperCase()+"</td><td>"+(FLAG_LABELS[f.type]||f.type)+"</td><td>"+f.sku+"</td><td>"+(f.desc||"--")+"</td><td>"+f.source+"</td><td>"+f.detail+"</td><td>"+f.affectedWOs.join(", ")+"</td></tr>").join(""); triggerDownload(buildExportHTML("Data Flags Report", th, tb), "data_flags_"+new Date().toISOString().slice(0,10)+".html", "text/html"); };

  return (<div>
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <Input type="text" placeholder="Search SKU, description, WO..." value={flagSearch} onChange={e => setFlagSearch(e.target.value)} className="h-10 w-64 text-sm" />
      <select value={flagFilterType} onChange={e => setFlagFilterType(e.target.value)} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All types</option>
        <option value="missing-desc">Missing Description</option>
        <option value="not-in-inventory">Not in Inventory</option>
        <option value="no-bom">No BOM</option>
        <option value="fg-not-in-inventory">FG Not in Inventory</option>
        <option value="zero-stock">Zero Stock</option>
      </select>
      <select value={flagFilterSeverity} onChange={e => setFlagFilterSeverity(e.target.value)} className="h-10 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All severity</option>
        <option value="bad">Error</option>
        <option value="warn">Warning</option>
      </select>
      <Badge variant="danger">{safeFlags.filter(f=>f.severity==="bad").length} errors</Badge>
      <Badge variant="warning">{safeFlags.filter(f=>f.severity==="warn").length} warnings</Badge>
      {(flagSearch || flagFilterType!=="all" || flagFilterSeverity!=="all") && <Button onClick={() => {setFlagSearch("");setFlagFilterType("all");setFlagFilterSeverity("all");}} variant="outline" size="default">Clear</Button>}
      <div style={{ flex:1 }} />
      <Button onClick={exportFlagsCSV} variant="outline" size="default">CSV</Button>
      <Button onClick={exportFlagsPDF} variant="outline" size="default">PDF</Button>
    </div>
    <TableShell>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {[{f:"sku",l:"SKU"},{f:"desc",l:"Description"},{f:"type",l:"Type"},{f:"severity",l:"Severity"},{f:"source",l:"Source"},{f:"detail",l:"Action Needed"},{f:"affectedWOs",l:"Affected WOs"}].map(col =>
              <th key={col.f} style={thC(flagSort===col.f)}>
                <SortHeaderButton onClick={() => handleFlagSort(col.f)}>
                  {col.l}{flagSort===col.f ? (flagSortDir==="asc" ? " \u2191" : " \u2193") : ""}
                </SortHeaderButton>
              </th>
            )}
          </tr></thead>
          <tbody>
            {filteredFlags.length === 0 && <tr><td colSpan={7} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No data flags found. All clear!</td></tr>}
            {filteredFlags.map(f => <tr key={f.id} style={{ borderBottom:"1px solid "+C.border }}>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{f.sku}</td>
              <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{f.desc || "--"}</td>
              <td style={Object.assign({}, tdN, { fontSize:13, whiteSpace:"nowrap" })}>{FLAG_LABELS[f.type]||f.type}</td>
              <td style={tdN}><Badge variant={f.severity==="bad"?"danger":"warning"}>{f.severity==="bad"?"ERROR":"WARN"}</Badge></td>
              <td style={Object.assign({}, tdN, { fontSize:13 })}>{f.source}</td>
              <td style={Object.assign({}, tdN, { fontSize:13, color:C.text })}>{f.detail}</td>
              <td style={Object.assign({}, tdN, { fontSize:13, color:f.affectedWOs.length?C.accent:C.dim })}>{f.affectedWOs.length ? f.affectedWOs.slice(0,3).join(", ")+(f.affectedWOs.length>3?" +"+String(f.affectedWOs.length-3)+" more":"") : "--"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </TableShell>
    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{filteredFlags.length} of {safeFlags.length} flags</div>
  </div>);
}
