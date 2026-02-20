import { useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";

export default function TimelineView({ timelineData }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, inp, sel, pill } = useStyles();

  const [matSort, setMatSort] = useState("affectedWOs");
  const [matSortDir, setMatSortDir] = useState("desc");
  const [matFilterTab, setMatFilterTab] = useState("all");
  const [matFilterDock, setMatFilterDock] = useState("all");
  const [matFilterWO, setMatFilterWO] = useState("all");
  const [matSearch, setMatSearch] = useState("");

  if (!timelineData) return null;

  return (<div>
    <div style={{ display:"flex", gap:20, marginBottom:16 }}>
      {[{l:"Inbound",v:timelineData.totalDeliveries,c:C.accent},{l:"BOM Matched",v:timelineData.matchedToBOM,c:C.ok},{l:"Dock Appts",v:timelineData.withDockAppt,c:C.bright},{l:"WOs Waiting",v:timelineData.woTimelines.length,c:C.warn}].map((s,i) =>
        <div key={i}><div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div><div style={{ fontSize:13, color:C.dim, marginTop:3, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div></div>
      )}
    </div>
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
      <div style={{ padding:"12px 16px", borderBottom:"1px solid "+C.border }}>
        <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Delivery Timeline</div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <div style={{ minWidth:Math.max(800, timelineData.days.length*40 + 340), display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", position:"sticky", top:0, zIndex:2, background:C.raised }}>
            <div style={{ minWidth:320, padding:"6px 12px", fontSize:13, fontWeight:600, fontFamily:sans, textTransform:"uppercase", letterSpacing:0.6, color:C.dim, borderBottom:"1px solid "+C.border, flexShrink:0 }}>Work Order</div>
            <div style={{ display:"flex", flex:1 }}>
              {timelineData.days.map(day => {
                var dt = new Date(day + "T12:00:00"); var isT = day === timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6;
                return <div key={day} style={{ minWidth:40, flex:"0 0 40px", textAlign:"center", padding:"3px 0", borderBottom:"1px solid "+(isT?C.accent:C.border), background:isT?C.accentSoft:isW?C.raised:"transparent" }}>
                  <div style={{ fontSize:12, fontFamily:sans, fontWeight:600, color:isT?C.accent:C.dim }}>{"SMTWTFS"[dt.getDay()]}</div>
                  <div style={{ fontSize:12, fontFamily:mono, fontWeight:isT?700:400, color:isT?C.accent:C.bright }}>{dt.getDate()}</div>
                  {(dt.getDate()===1||day===timelineData.days[0]) && <div style={{ fontSize:12, color:C.dim }}>{dt.toLocaleDateString("en-US",{month:"short"})}</div>}
                </div>;
              })}
            </div>
          </div>
          {timelineData.woTimelines.map((wo, wI) => {
            var sc = wo.runStatus==="ready"?C.ok:wo.runStatus==="partial"?C.warn:wo.runStatus==="nobom"?C.accent:C.bad;
            return <div key={wI} style={{ display:"flex", borderBottom:"1px solid "+C.border, minHeight:46 }}>
              <div style={{ minWidth:320, padding:"6px 12px", display:"flex", flexDirection:"column", justifyContent:"center", flexShrink:0, borderRight:"1px solid "+C.border }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ fontSize:13, fontWeight:600, fontFamily:mono, color:C.bright }}>{wo.woNum}</span>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:sc }} />
                </div>
                <div style={{ fontSize:12, color:C.dim, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:290 }}>{wo.productSku} | {wo.productDesc||""}</div>
                <div style={{ fontSize:13, color:C.dim, fontFamily:mono, marginTop:1 }}>{"Need "+wo.qtyToProduce.toLocaleString()+" | Can make "+wo.maxRunnable.toLocaleString()+" | +"+wo.totalIncoming.toLocaleString()+" incoming"}</div>
              </div>
              <div style={{ display:"flex", flex:1 }}>
                {timelineData.days.map(day => {
                  var dt = new Date(day+"T12:00:00"); var isT = day===timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6; var isDue = day===wo.dueDate;
                  var dd = wo.delByDate[day]; var badge = null;
                  if (dd) { var sts = dd.items.map(d=>d.dockStatus).filter(Boolean); var bg = sts.includes("Completed")?C.ok:sts.includes("Scheduled")?C.accent:sts.includes("Cancelled")?C.bad:C.dim; var ic = sts.includes("Completed")?"\u2713":sts.includes("Scheduled")?"\u25C9":sts.includes("Cancelled")?"\u2717":"\u25CF"; badge = { bg:bg, ic:ic }; }
                  return <div key={day} style={{ minWidth:40, flex:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1, background:isDue?C.badSoft:isT?C.accentSoft:isW?C.raised:"transparent", borderLeft:isDue?"2px solid "+C.bad:isT?"2px solid "+C.accent:"none" }}>
                    {dd && <div title={dd.items.map(d => d.sku+": "+d.qty.toLocaleString()+" ("+(d.dockStatus||"pending")+")").join("\n")} style={{ fontSize:14, fontFamily:mono, fontWeight:700, color:"#fff", background:badge?badge.bg:C.dim, borderRadius:3, padding:"2px 4px", lineHeight:1.3, textAlign:"center", minWidth:30, cursor:"default" }}>
                      {dd.totalQty >= 1000 ? (dd.totalQty/1000).toFixed(1)+"k" : dd.totalQty}
                    </div>}
                    {isDue && <div style={{ fontSize:12, fontWeight:700, color:C.bad }}>DUE</div>}
                  </div>;
                })}
              </div>
            </div>;
          })}
        </div>
      </div>
      <div style={{ padding:"8px 16px", borderTop:"1px solid "+C.border, display:"flex", gap:14, flexWrap:"wrap" }}>
        {[{bg:C.dim,l:"Pending"},{bg:C.accent,l:"Scheduled"},{bg:C.ok,l:"Received"},{bg:C.bad,l:"Cancelled"}].map((x,i) =>
          <span key={i} style={{ fontSize:12, color:C.dim, display:"flex", alignItems:"center", gap:3 }}><span style={{ width:7, height:7, borderRadius:2, background:x.bg }} />{x.l}</span>
        )}
      </div>
    </div>

    {/* Material Summary */}
    {(function() {
      var matRows = Object.entries(timelineData.byMaterial).map(function(entry) {
        var sn = entry[0]; var item = entry[1];
        var dels = item.deliveries; var totalOpen = dels.reduce(function(s,d){return s+d.qty},0); var tab = dels[0] ? dels[0].tab : "";
        var ds = {}; dels.forEach(function(d) { if (d.dockStatus) ds[d.dockStatus] = (ds[d.dockStatus]||0)+1; });
        var dockSummary = Object.entries(ds).map(function(e){return e[1]+" "+e[0]}).join(", ");
        var pd = dels.some(function(d){return d.dockStatus==="Completed"})?"Completed":dels.some(function(d){return d.dockStatus==="Scheduled"})?"Scheduled":dels.some(function(d){return d.dockStatus==="Cancelled"})?"Cancelled":"None";
        var uWOs = Array.from(new Set(item.affectedWOs.map(function(w){return w.woNum})));
        return { sn:sn, sku:item.sku, desc:item.desc, tab:tab, delCount:dels.length, totalOpen:totalOpen, dockSummary:dockSummary, pd:pd, uWOs:uWOs, woC:uWOs.length };
      });
      var f = matRows.slice();
      if (matSearch) { var q = matSearch.toLowerCase(); f = f.filter(function(r) { return r.sku.toLowerCase().includes(q) || (r.desc||"").toLowerCase().includes(q) || r.uWOs.some(function(w){return w.toLowerCase().includes(q)}); }); }
      if (matFilterTab !== "all") f = f.filter(function(r){return r.tab===matFilterTab});
      if (matFilterDock !== "all") { if (matFilterDock==="none") f=f.filter(function(r){return r.pd==="None"}); else f=f.filter(function(r){return r.pd===matFilterDock}); }
      if (matFilterWO !== "all") { if (matFilterWO==="matched") f=f.filter(function(r){return r.woC>0}); else f=f.filter(function(r){return r.woC===0}); }
      f.sort(function(a,b) { var c=0; if(matSort==="material")c=a.sku.localeCompare(b.sku); else if(matSort==="description")c=(a.desc||"").localeCompare(b.desc||""); else if(matSort==="tab")c=a.tab.localeCompare(b.tab); else if(matSort==="deliveries")c=a.delCount-b.delCount; else if(matSort==="openQty")c=a.totalOpen-b.totalOpen; else if(matSort==="dockStatus")c=a.pd.localeCompare(b.pd); else if(matSort==="affectedWOs")c=a.woC-b.woC; return matSortDir==="desc"?-c:c; });
      var hMS = function(col) { if (matSort===col) setMatSortDir(function(d){return d==="asc"?"desc":"asc"}); else { setMatSort(col); setMatSortDir("desc"); } };
      var cols = [{k:"material",l:"Material"},{k:"description",l:"Description"},{k:"tab",l:"Tab"},{k:"deliveries",l:"Deliveries"},{k:"openQty",l:"Open Qty"},{k:"dockStatus",l:"Dock"},{k:"affectedWOs",l:"WOs"}];
      var hasF = matSearch || matFilterTab!=="all" || matFilterDock!=="all" || matFilterWO!=="all";
      return <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
        <div style={{ padding:"12px 16px", borderBottom:"1px solid "+C.border, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Inbound Materials</div>
            <div style={{ fontSize:13, color:C.dim, marginTop:1 }}>{f.length} of {matRows.length} materials</div>
          </div>
          <div style={{ display:"flex", gap:5, flexWrap:"wrap", alignItems:"center" }}>
            <input value={matSearch} onChange={function(e){setMatSearch(e.target.value)}} placeholder="Search..." style={Object.assign({}, inp, { width:130, fontSize:13 })} />
            <select value={matFilterTab} onChange={function(e){setMatFilterTab(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All tabs</option><option value="FG">FG</option><option value="RM">RM</option></select>
            <select value={matFilterDock} onChange={function(e){setMatFilterDock(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All dock</option><option value="Completed">Completed</option><option value="Scheduled">Scheduled</option><option value="Cancelled">Cancelled</option><option value="none">No appt</option></select>
            <select value={matFilterWO} onChange={function(e){setMatFilterWO(e.target.value)}} style={Object.assign({}, sel, { fontSize:13 })}><option value="all">All WO</option><option value="matched">Has WO</option><option value="unmatched">No WO</option></select>
            {hasF && <button onClick={function(){setMatSearch("");setMatFilterTab("all");setMatFilterDock("all");setMatFilterWO("all");}} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
          </div>
        </div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr style={{ background:C.raised }}>
              {cols.map(function(col) { return <th key={col.k} onClick={function(){hMS(col.k)}} style={thC(matSort===col.k)}>{col.l}{matSort===col.k?(matSortDir==="asc"?" \u2191":" \u2193"):""}</th>; })}
            </tr></thead>
            <tbody>
              {f.map(function(r,i) { return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{r.sku}</td>
                <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{r.desc||"--"}</td>
                <td style={tdN}><span style={{ fontSize:12, fontWeight:500, padding:"1px 7px", borderRadius:10, color:r.tab==="FG"?C.accent:C.warn, background:r.tab==="FG"?C.accentSoft:C.warnSoft }}>{r.tab||"--"}</span></td>
                <td style={Object.assign({}, tdM, { color:C.bright })}>{r.delCount}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:C.ok })}>{r.totalOpen.toLocaleString()}</td>
                <td style={Object.assign({}, tdN, { fontSize:13, color:r.dockSummary?C.bright:C.dim })}>{r.dockSummary||"--"}</td>
                <td style={Object.assign({}, tdN, { fontSize:13, color:r.woC?C.accent:C.dim })}>{r.woC ? r.uWOs.join(", ") : "--"}</td>
              </tr>; })}
              {f.length===0 && <tr><td colSpan={7} style={{ padding:24, textAlign:"center", color:C.dim }}>No materials match filters</td></tr>}
            </tbody>
          </table>
        </div>
      </div>;
    })()}
  </div>);
}
