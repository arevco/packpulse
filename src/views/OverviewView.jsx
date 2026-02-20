import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate } from "../utils";

export default function OverviewView({ analysis, woStatuses }) {
  const { C, sans, mono } = useTheme();
  const { thS, tdN, tdM, inp, pill } = useStyles();

  const [ovWoStatus, setOvWoStatus] = useState("all");
  const [ovDateFrom, setOvDateFrom] = useState("");
  const [ovDateTo, setOvDateTo] = useState("");
  const [lateCollapsed, setLateCollapsed] = useState(false);

  var overview = useMemo(() => {
    if (!analysis) return null;
    var r = analysis.results.slice();
    // WO status filter
    if (ovWoStatus !== "all") r = r.filter(w => w.status === ovWoStatus);
    // Date range filter on due date
    if (ovDateFrom) { var from = new Date(ovDateFrom); from.setHours(0,0,0,0); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d >= from; }); }
    if (ovDateTo) { var to = new Date(ovDateTo); to.setHours(23,59,59,999); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d <= to; }); }
    var today = new Date(); today.setHours(0,0,0,0);
    var totalOrderQty = 0, totalProduced = 0, totalRemaining = 0, totalCanMake = 0, totalEstHours = 0, woCount = r.length;
    var lateWOs = [], byCustomer = {}, noDueDate = 0;
    r.forEach(wo => {
      totalOrderQty += wo.qtyToProduce;
      totalProduced += wo.unitsProduced;
      totalRemaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") totalCanMake += wo.maxRunnable;
      totalEstHours += wo.estHours || 0;
      if (wo.dueDate) {
        var dd = new Date(wo.dueDate);
        if (!isNaN(dd) && dd < today && wo.unitsRemaining > 0) {
          var daysLate = Math.floor((today - dd) / 86400000);
          lateWOs.push(Object.assign({}, wo, { daysLate:daysLate }));
        }
      } else { noDueDate++; }
      var cust = wo.customer || "Unassigned";
      if (!byCustomer[cust]) byCustomer[cust] = { orderQty:0, produced:0, remaining:0, canMake:0, count:0, late:0 };
      byCustomer[cust].orderQty += wo.qtyToProduce;
      byCustomer[cust].produced += wo.unitsProduced;
      byCustomer[cust].remaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") byCustomer[cust].canMake += wo.maxRunnable;
      byCustomer[cust].count++;
    });
    lateWOs.sort((a,b) => b.daysLate - a.daysLate);
    lateWOs.forEach(w => { var cust = w.customer || "Unassigned"; if (byCustomer[cust]) byCustomer[cust].late++; });
    var completionPct = totalOrderQty > 0 ? Math.round(totalProduced / totalOrderQty * 100) : 0;
    var custArr = Object.entries(byCustomer).map(([name, d]) => Object.assign({ name:name }, d)).sort((a,b) => b.remaining - a.remaining);
    return { totalOrderQty:totalOrderQty, totalProduced:totalProduced, totalRemaining:totalRemaining, totalCanMake:totalCanMake, totalEstHours:Math.round(totalEstHours*10)/10, completionPct:completionPct, lateWOs:lateWOs, byCustomer:custArr, woCount:woCount, noDueDate:noDueDate };
  }, [analysis, ovWoStatus, ovDateFrom, ovDateTo]);

  if (!overview) return null;

  return (<div>
    <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center" }}>
      {["all"].concat(woStatuses).map(f => <button key={f} onClick={() => setOvWoStatus(f)} style={pill(ovWoStatus===f)}>{f==="all"?"All WO Status":f}</button>)}
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>Due from</span>
      <input type="date" value={ovDateFrom} onChange={e => setOvDateFrom(e.target.value)} style={Object.assign({}, inp, { width:140 })} />
      <span style={{ fontSize:13, color:C.dim }}>to</span>
      <input type="date" value={ovDateTo} onChange={e => setOvDateTo(e.target.value)} style={Object.assign({}, inp, { width:140 })} />
      {(ovWoStatus!=="all" || ovDateFrom || ovDateTo) && <button onClick={() => {setOvWoStatus("all");setOvDateFrom("");setOvDateTo("");}} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>{overview.woCount} of {analysis.results.length} WOs{overview.noDueDate > 0 && ovDateFrom ? " ("+overview.noDueDate+" excluded \u2014 no due date)" : ""}</span>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10, marginBottom:20 }}>
      {[
        {l:"Total Order Qty", v:overview.totalOrderQty.toLocaleString(), c:C.bright},
        {l:"Produced", v:overview.totalProduced.toLocaleString(), c:C.ok},
        {l:"Remaining", v:overview.totalRemaining.toLocaleString(), c:C.warn},
        {l:"Can Make", v:overview.totalCanMake.toLocaleString(), c:C.accent},
        {l:"Completion", v:overview.completionPct+"%", c:overview.completionPct>=80?C.ok:overview.completionPct>=50?C.warn:C.bad},
        {l:"Est Hours Left", v:overview.totalEstHours+"h", c:C.bright},
        {l:"Late WOs", v:overview.lateWOs.length, c:overview.lateWOs.length>0?C.bad:C.ok}
      ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px" }}>
        <div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
        <div style={{ fontSize:12, color:C.dim, marginTop:5, fontWeight:500, textTransform:"uppercase", letterSpacing:0.5 }}>{s.l}</div>
      </div>)}
    </div>

    {overview.byCustomer.length > 0 && (<div style={{ marginBottom:20 }}>
      <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>By Customer</div>
      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {["Customer","WOs","Order Qty","Produced","Remaining","Can Make","Complete","Late"].map(h =>
              <th key={h} style={thS}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {overview.byCustomer.map((c, i) => {
              var pct = c.orderQty > 0 ? Math.round(c.produced / c.orderQty * 100) : 0;
              return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                <td style={Object.assign({}, tdN, { fontWeight:600, color:C.bright })}>{c.name}</td>
                <td style={Object.assign({}, tdM, { color:C.dim })}>{c.count}</td>
                <td style={Object.assign({}, tdM, { color:C.bright })}>{c.orderQty.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.ok })}>{c.produced.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.warn })}>{c.remaining.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.accent })}>{c.canMake.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:pct>=80?C.ok:pct>=50?C.warn:pct>0?C.accent:C.dim })}>{pct+"%"}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:c.late>0?C.bad:C.dim })}>{c.late > 0 ? c.late : "--"}</td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>)}

    {overview.lateWOs.length > 0 && (<div style={{ marginBottom:20 }}>
      <div onClick={() => setLateCollapsed(!lateCollapsed)} style={{ fontSize:14, fontWeight:600, color:C.bad, marginBottom:lateCollapsed?0:10, display:"flex", alignItems:"center", gap:8, cursor:"pointer", userSelect:"none" }}>
        <span style={{ fontSize:13, color:C.dim }}>{lateCollapsed ? "\u25B8" : "\u25BE"}</span>
        <span style={{ fontSize:16 }}>{"\u26A0"}</span> Past Due Work Orders ({overview.lateWOs.length})
      </div>
      {!lateCollapsed && <div style={{ background:C.surface, border:"1px solid "+C.badLine, borderRadius:8, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {["Days Late","WO#","Product","Customer","Order Qty","Remaining","Complete","Ready","Can Make","Due Date"].map(h =>
              <th key={h} style={thS}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {overview.lateWOs.map((wo, i) => <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
              <td style={Object.assign({}, tdM, { fontWeight:700, color:C.bad })}>{wo.daysLate}d</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
              <td style={tdM}>{wo.productSkuRaw}</td>
              <td style={Object.assign({}, tdN, { color:C.dim })}>{wo.customer || "--"}</td>
              <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { color:C.warn })}>{wo.unitsRemaining.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct>0?wo.prodPct+"%":"--"}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness<0?"--":Math.round(wo.readiness)+"%"}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:wo.maxRunnable>0?C.warn:C.bad })}>{wo.runStatus==="nobom"?"--":wo.maxRunnable.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { color:C.bad })}>{fmtDate(wo.dueDate)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    </div>)}
  </div>);
}
