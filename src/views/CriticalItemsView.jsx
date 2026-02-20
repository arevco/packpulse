import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, buildExportHTML, normalizeStr } from "../utils";
import Dot from "../components/Dot";

export default function CriticalItemsView({ rawCriticalItems }) {
  const { C, sans, mono } = useTheme();
  const { thC, thS, tdN, tdM, inp, pill } = useStyles();

  const [ciSearch, setCiSearch] = useState("");
  const [ciSort, setCiSort] = useState("unlockedUnits");
  const [ciSortDir, setCiSortDir] = useState("desc");
  const [expandedWO, setExpandedWO] = useState(null);

  var handleCiSort = f => { if (ciSort === f) setCiSortDir(d => d==="asc"?"desc":"asc"); else { setCiSort(f); setCiSortDir("desc"); } };

  var criticalItems = useMemo(() => {
    var items = rawCriticalItems.slice();
    if (ciSearch) { var q = ciSearch.toLowerCase(); items = items.filter(i => i.sku.toLowerCase().includes(q) || (i.desc||"").toLowerCase().includes(q)); }
    items.sort((a,b) => { var c = 0; if (ciSort==="sku") c = a.sku.localeCompare(b.sku); else if (ciSort==="desc") c = (a.desc||"").localeCompare(b.desc||""); else if (ciSort==="customer") c = (a.customerLabel||"").localeCompare(b.customerLabel||""); else if (ciSort==="status") c = Number(a.isZeroStock) - Number(b.isZeroStock); else if (ciSort==="onHand") c = a.onHand - b.onHand; else if (ciSort==="totalShort") c = a.totalShort - b.totalShort; else if (ciSort==="affectedWOs") c = a.affectedWOs.length - b.affectedWOs.length; else c = a.unlockedUnits - b.unlockedUnits; return ciSortDir==="desc" ? -c : c; });
    return items;
  }, [rawCriticalItems, ciSort, ciSortDir, ciSearch]);

  var exportCriticalCSV = () => { var h = ["Item Code","Description","Customer","Status","On Hand","Total Short","WOs Affected","Production Unlocked"]; var rows = criticalItems.map(i => [i.sku, '"'+(i.desc||"").replace(/"/g,'""')+'"', '"'+(i.customerLabel||"--").replace(/"/g,'""')+'"', i.isZeroStock?"ZERO":"LOW", Math.round(i.onHand), Math.round(i.totalShort), i.affectedWOs.length, Math.round(i.unlockedUnits)]); triggerDownload([h.join(",")].concat(rows.map(r=>r.join(","))).join("\n"), "critical_items_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv"); };
  var exportCriticalPDF = () => { var th = ["Item","Desc","Customer","Status","On Hand","Short","WOs","Unlocked"].map(h=>"<th>"+h+"</th>").join(""); var tb = criticalItems.map(i => "<tr><td>"+i.sku+"</td><td>"+(i.desc||"--")+"</td><td>"+(i.customerLabel||"--")+"</td><td class=\""+(i.isZeroStock?"zero":"low")+"\">"+(i.isZeroStock?"ZERO":"LOW")+"</td><td>"+Math.round(i.onHand).toLocaleString()+"</td><td>"+Math.round(i.totalShort).toLocaleString()+"</td><td>"+i.affectedWOs.length+"</td><td>"+Math.round(i.unlockedUnits).toLocaleString()+"</td></tr>").join(""); triggerDownload(buildExportHTML("Critical Items Report", th, tb), "critical_items_" + new Date().toISOString().slice(0,10) + ".html", "text/html"); };

  var renderCIRows = () => {
    if (criticalItems.length === 0) return <tr><td colSpan={9} style={{ padding:36, textAlign:"center", color:C.dim }}>All materials available.</td></tr>;
    var out = [];
    criticalItems.forEach((ci, idx) => {
      var isX = expandedWO === "ci-" + idx;
      out.push(
        <tr key={"ci"+idx} onClick={() => setExpandedWO(isX ? null : "ci-" + idx)} style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:isX?C.raised:"transparent" }}
          onMouseEnter={e => { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={e => { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={{ padding:"9px 6px", textAlign:"center", fontSize:13, color:C.dim }}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{ci.sku}</td>
          <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{ci.desc || "--"}</td>
          <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{ci.customerLabel || "--"}</td>
          <td style={tdN}><Dot status={ci.isZeroStock ? "blocked" : "partial"} /></td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:ci.isZeroStock?C.bad:C.warn })}>{Math.round(ci.onHand).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.bad })}>{Math.round(ci.totalShort).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", color:C.bright })}>{ci.affectedWOs.length}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.ok })}>{Math.round(ci.unlockedUnits).toLocaleString()}</td>
        </tr>
      );
      if (isX) {
        out.push(
          <tr key={"cd"+idx}><td colSpan={9} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:10, textTransform:"uppercase", letterSpacing:0.8 }}>Affected Work Orders</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                {["WO#","Product","Customer","WO Qty","Needed","Short","Due"].map(h => <th key={h} style={{ padding:"7px 10px", fontSize:13, fontWeight:600, fontFamily:sans, textTransform:"uppercase", letterSpacing:0.6, color:C.dim, textAlign:"left", borderBottom:"1px solid "+C.border }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {ci.affectedWOs.map((wo, wi) => <tr key={wi} style={{ borderBottom:"1px solid "+C.border }}>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:C.bright }}>{wo.woNum}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{wo.productSku}</td>
                  <td style={{ padding:"7px 10px", fontFamily:sans, fontSize:13, color:C.dim }}>{wo.customer || "--"}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.bright }}>{wo.qtyToProduce.toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{Math.round(wo.needed).toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, fontWeight:600, color:C.bad }}>{Math.round(wo.short).toLocaleString()}</td>
                  <td style={{ padding:"7px 10px", fontFamily:mono, fontSize:13, color:C.text }}>{fmtDate(wo.dueDate)}</td>
                </tr>)}
              </tbody>
            </table>
          </td></tr>
        );
      }
    });
    return out;
  };

  return (<div>
    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
      <input type="text" placeholder="Search..." value={ciSearch} onChange={e => setCiSearch(e.target.value)} style={Object.assign({}, inp, { width:200 })} />
      <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{criticalItems.filter(i=>i.isZeroStock).length}</span> zero | <span style={{ color:C.warn, fontWeight:600 }}>{criticalItems.filter(i=>!i.isZeroStock).length}</span> low</span>
      <div style={{ flex:1 }} />
      <button onClick={exportCriticalCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
      <button onClick={exportCriticalPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>
    </div>
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <th style={{ width:24, padding:"9px 6px", borderBottom:"1px solid "+C.border }} />
            {[{f:"sku",l:"Item"},{f:"desc",l:"Description"},{f:"customer",l:"Customer"},{f:"status",l:"Status"},{f:"onHand",l:"On Hand"},{f:"totalShort",l:"Short"},{f:"affectedWOs",l:"WOs"},{f:"unlockedUnits",l:"Units Unlocked"}].map(col =>
              <th key={col.f} onClick={() => handleCiSort(col.f)} style={Object.assign({}, thC(ciSort===col.f), { textAlign:col.f==="sku"||col.f==="desc"||col.f==="customer"?"left":"right" })}>
                {col.l}{ciSort===col.f ? (ciSortDir==="asc" ? " \u2191" : " \u2193") : ""}
              </th>
            )}
          </tr></thead>
          <tbody>{renderCIRows()}</tbody>
        </table>
      </div>
    </div>
    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{criticalItems.length} critical items</div>
  </div>);
}
