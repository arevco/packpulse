import { useState, useMemo, useEffect } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, buildExportHTML, normalizeStr } from "../utils";
import Dot from "../components/Dot";

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  var raw = String(value).trim();
  if (!raw) return null;

  // Handles M/D/YYYY and MM/DD/YYYY explicitly to avoid lexicographic ordering bugs.
  var mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (mdy) {
    var mm = parseInt(mdy[1], 10);
    var dd = parseInt(mdy[2], 10);
    var yy = parseInt(mdy[3], 10);
    if (yy < 100) yy += 2000;
    var parsedMdy = new Date(yy, mm - 1, dd);
    return isNaN(parsedMdy) ? null : parsedMdy;
  }

  var parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed;
}

export default function WorkOrdersView({ analysis, woStatuses, woCustomers, prefilterCustomer, prefilterNonce }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, tdToggle, thDS, tdDN, tdDM, truncate, inp, sel, pill } = useStyles();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWoStatus, setFilterWoStatus] = useState("Booked");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [sortField, setSortField] = useState("readiness");
  const [sortDir, setSortDir] = useState("desc");
  const [expandedWO, setExpandedWO] = useState(null);

  useEffect(() => {
    if (!prefilterCustomer) return;
    setFilterCustomer(prefilterCustomer);
    setFilterStatus("all");
    setFilterWoStatus("all");
    setSearchTerm("");
  }, [prefilterCustomer, prefilterNonce]);

  var handleSort = f => { if (sortField === f) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortField(f); setSortDir("desc"); } };

  var filteredResults = useMemo(() => {
    if (!analysis) return []; var r = analysis.results.slice();
    if (filterStatus !== "all") r = r.filter(w => w.runStatus === filterStatus);
    if (filterWoStatus !== "all") r = r.filter(w => w.status === filterWoStatus);
    if (filterCustomer !== "all") r = r.filter(w => w.customer === filterCustomer);
    if (searchTerm) { var q = searchTerm.toLowerCase(); r = r.filter(w => w.woNum.toLowerCase().includes(q) || w.productSkuRaw.toLowerCase().includes(q) || (w.productDesc||"").toLowerCase().includes(q) || (w.customer||"").toLowerCase().includes(q) || (w.reference1||"").toLowerCase().includes(q)); }
    r.sort((a,b) => {
      var c = 0;
      if (sortField==="woNum") c=a.woNum.localeCompare(b.woNum);
      else if (sortField==="product") c=a.productSkuRaw.localeCompare(b.productSkuRaw);
      else if (sortField==="customer") c=(a.customer||"").localeCompare(b.customer||"");
      else if (sortField==="qty") c=a.qtyToProduce-b.qtyToProduce;
      else if (sortField==="produced") c=a.unitsProduced-b.unitsProduced;
      else if (sortField==="remaining") c=a.unitsRemaining-b.unitsRemaining;
      else if (sortField==="complete") c=a.prodPct-b.prodPct;
      else if (sortField==="maxRunnable") c=a.maxRunnable-b.maxRunnable;
      else if (sortField==="readiness") c=a.readiness-b.readiness;
      else if (sortField==="estHours") c=a.estHours-b.estHours;
      else if (sortField==="dueDate" || sortField==="plannedStart" || sortField==="plannedEnd") {
        var aDate = parseDateValue(sortField==="dueDate" ? a.dueDate : sortField==="plannedStart" ? a.plannedStart : a.plannedEnd);
        var bDate = parseDateValue(sortField==="dueDate" ? b.dueDate : sortField==="plannedStart" ? b.plannedStart : b.plannedEnd);
        var aMissing = !aDate;
        var bMissing = !bDate;
        // Keep missing/invalid dates at the bottom regardless of sort direction.
        if (aMissing && !bMissing) return 1;
        if (!aMissing && bMissing) return -1;
        if (aMissing && bMissing) return 0;
        c = aDate.getTime() - bDate.getTime();
        return sortDir==="desc" ? -c : c;
      } else if (sortField==="status") c=(a.status||"").localeCompare(b.status||"");
      return sortDir==="desc"?-c:c;
    });
    return r;
  }, [analysis, filterStatus, filterWoStatus, filterCustomer, searchTerm, sortField, sortDir]);

  var exportCSV = () => { if (!analysis) return; var h = ["Work Order","Product SKU","Description","Customer","WO Status","Due Date","Planned Start","Planned End","Order Qty","Produced","Remaining","Complete %","Ready %","Can Make","Est Hours","Run Status","Reference"]; var rows = analysis.results.map(w => [w.woNum, w.productSkuRaw, '"'+(w.productDesc||"").replace(/"/g,'""')+'"', '"'+(w.customer||"")+'"', w.status||"", w.dueDate||"", w.plannedStart||"", w.plannedEnd||"", w.qtyToProduce, w.unitsProduced, w.unitsRemaining, w.prodPct, w.readiness<0?"N/A":Math.round(w.readiness), w.maxRunnable, w.estHours||"", w.runStatus, '"'+(w.reference1||"").replace(/"/g,'""')+'"']); triggerDownload([h.join(",")].concat(rows.map(r => r.join(","))).join("\n"), "packpulse_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv"); };
  var exportPDF = () => { if (!analysis) return; var th = ["WO#","Product","Customer","Qty","Produced","Remaining","Complete","Ready","Est Hrs","Status","Due"].map(h => "<th>"+h+"</th>").join(""); var tb = analysis.results.map(w => "<tr><td>"+w.woNum+"</td><td>"+w.productSkuRaw+"</td><td>"+(w.customer||"--")+"</td><td>"+w.qtyToProduce.toLocaleString()+"</td><td>"+w.unitsProduced.toLocaleString()+"</td><td>"+w.unitsRemaining.toLocaleString()+"</td><td>"+w.prodPct+"%</td><td>"+(w.readiness<0?"N/A":Math.round(w.readiness)+"%")+'</td><td>'+(w.estHours||"--")+'</td><td class="'+w.runStatus+'">'+w.runStatus+"</td><td>"+fmtDate(w.dueDate)+"</td></tr>").join(""); triggerDownload(buildExportHTML("PackPulse Report", th, tb), "packpulse_" + new Date().toISOString().slice(0,10) + ".html", "text/html"); };

  var SortTh = function(props) { return <th onClick={() => handleSort(props.field)} style={Object.assign({}, thC(sortField===props.field), props.style||{})}>{props.children}{sortField===props.field ? (sortDir==="asc" ? " \u2191" : " \u2193") : ""}</th>; };

  var renderWORows = () => {
    if (filteredResults.length === 0) return <tr><td colSpan={16} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No work orders match filters.</td></tr>;
    var out = [];
    filteredResults.forEach((wo, idx) => {
      var isX = expandedWO === wo.woNum + idx;
      out.push(
        <tr key={"r"+idx} onClick={() => setExpandedWO(isX ? null : wo.woNum + idx)} style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:isX?C.raised:"transparent" }}
          onMouseEnter={e => { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={e => { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={tdToggle}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
          <td style={tdM}>{wo.productSkuRaw}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(140))}>{wo.customer || "--"}</td>
          <td style={tdN}><Dot status={wo.runStatus} />{wo.status ? <span style={{ marginLeft:6, fontSize:12, color:C.dim }}>{wo.status}</span> : ""}</td>
          <td style={Object.assign({}, tdM, { color:C.text })}>{fmtDate(wo.dueDate)}</td>
          <td style={Object.assign({}, tdM, { color:C.dim, fontSize:12 })}>{fmtDate(wo.plannedStart)}</td>
          <td style={Object.assign({}, tdM, { color:C.dim, fontSize:12 })}>{fmtDate(wo.plannedEnd)}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { color:wo.unitsProduced>0?C.ok:C.dim })}>{wo.unitsProduced>0?wo.unitsProduced.toLocaleString():"--"}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.unitsRemaining.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>=50?C.warn:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct > 0 ? wo.prodPct+"%" : "--"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness < 0 ? <span style={{color:C.dim}}>--</span> : Math.round(wo.readiness)+"%"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:wo.runStatus==="nobom"?C.dim:wo.maxRunnable>0?C.warn:C.bad })}>{wo.runStatus==="nobom" ? "--" : wo.maxRunnable.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { color:wo.estHours>0?C.bright:C.dim })}>{wo.estHours > 0 ? wo.estHours+"h" : "--"}</td>
        </tr>
      );
      if (isX) {
        var details = [];
        if (wo.reference1) details.push(<div key="ref" style={{ fontSize:13, color:C.text, marginBottom:8 }}><span style={{ fontSize:12, fontWeight:600, color:C.dim, textTransform:"uppercase", letterSpacing:0.6, marginRight:6 }}>Notes</span>{wo.reference1}</div>);
        if (wo.unitsPerHour > 0 || wo.standardPeople > 0) details.push(<div key="ops" style={{ fontSize:13, color:C.dim, marginBottom:8, display:"flex", gap:16 }}>
          {wo.unitsPerHour > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.unitsPerHour}</span> units/hr</span>}
          {wo.standardPeople > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.standardPeople}</span> crew</span>}
          {wo.prodPct > 0 && <span><span style={{ fontWeight:600, color:wo.prodPct>=100?C.ok:C.accent }}>{wo.prodPct}%</span> complete</span>}
        </div>);
        if (wo.components.length > 0) details.push(
          <div key="bom">
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:4, textTransform:"uppercase", letterSpacing:0.8 }}>BOM - {wo.components.length} components</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>
                {["Component","Description","Qty/Unit","Needed","On Hand","Short","Fill %"].map(h => <th key={h} style={thDS}>{h}</th>)}
              </tr></thead>
              <tbody>
                {wo.components.map((comp, ci) => {
                  var rows = [];
                  rows.push(
                    <tr key={"c"+ci} style={{ borderBottom:comp.hasSubs?"none":"1px solid "+C.border }}>
                      <td style={Object.assign({}, tdDM, { color:C.bright })}>{comp.sku}{comp.hasSubs && <span style={{ fontSize:13, color:C.accent, marginLeft:3 }}>+alt</span>}</td>
                      <td style={Object.assign({}, tdDN, { color:C.dim }, truncate(150))}>{comp.desc || "--"}</td>
                      <td style={tdDM}>{comp.qtyPer}</td>
                      <td style={Object.assign({}, tdDM, { color:C.bright })}>{comp.needed.toLocaleString()}</td>
                      <td style={Object.assign({}, tdDM, { fontWeight:600, color:comp.onHand>=comp.needed?C.ok:C.bad })}>{comp.onHand.toLocaleString()}</td>
                      <td style={Object.assign({}, tdDM, { fontWeight:600, color:comp.short>0?C.bad:C.dim })}>{comp.short > 0 ? comp.short.toLocaleString() : "--"}</td>
                      <td style={Object.assign({}, tdDM, { fontWeight:500, color:comp.fillRate>=100?C.ok:comp.fillRate>=70?C.warn:C.bad })}>{Math.round(Math.min(comp.fillRate, 100))+"%"}</td>
                    </tr>
                  );
                  if (comp.hasSubs && comp.optionDetails) {
                    rows.push(
                      <tr key={"s"+ci}><td colSpan={7} style={{ padding:"0 8px 6px 20px", borderBottom:"1px solid "+C.border }}>
                        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
                          {comp.optionDetails.map((opt, oi) => <span key={oi} style={{ fontSize:12, fontFamily:mono, color:C.dim }}>
                            <span style={{ color:opt.isSub?C.accent:C.ok, fontWeight:600, marginRight:2 }}>{opt.isSub ? "ALT" : "PRI"}</span>{opt.sku} = {opt.onHand.toLocaleString()}
                          </span>)}
                        </div>
                      </td></tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        );
        out.push(
          <tr key={"d"+idx}><td colSpan={16} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            {details}
          </td></tr>
        );
      }
    });
    return out;
  };

  return (<div>
    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
      <input type="text" placeholder="Search WO, SKU, customer, notes..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} style={Object.assign({}, inp, { width:220 })} />
      {["all","ready","partial","blocked","nobom"].map(f => <button key={f} onClick={() => setFilterStatus(f)} style={pill(filterStatus===f)}>{f==="all"?"All":f==="ready"?"Ready":f==="partial"?"Partial":f==="blocked"?"Blocked":"No BOM"}</button>)}
      <select value={filterWoStatus} onChange={e => setFilterWoStatus(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
        <option value="all">All WO Status</option>
        {woStatuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} style={Object.assign({}, sel, { fontSize:13 })}>
        <option value="all">All Customers</option>
        {woCustomers.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <div style={{ flex:1 }} />
      <button onClick={exportCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
      <button onClick={exportPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>
    </div>
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <th style={{ width:24, padding:"0 8px", borderBottom:"1px solid "+C.border }} />
            <SortTh field="woNum">WO#</SortTh>
            <SortTh field="product">Product</SortTh>
            <SortTh field="customer">Customer</SortTh>
            <SortTh field="status">WO Status</SortTh>
            <SortTh field="dueDate">Due</SortTh>
            <SortTh field="plannedStart">Start</SortTh>
            <SortTh field="plannedEnd">End</SortTh>
            <SortTh field="qty">Order Qty</SortTh>
            <SortTh field="produced">Produced</SortTh>
            <SortTh field="remaining">Remaining</SortTh>
            <SortTh field="complete">Complete</SortTh>
            <SortTh field="readiness">Ready</SortTh>
            <SortTh field="maxRunnable">Can Make</SortTh>
            <SortTh field="estHours">Est Hrs</SortTh>
          </tr></thead>
          <tbody>{renderWORows()}</tbody>
        </table>
      </div>
    </div>
    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{filteredResults.length} of {analysis.results.length} work orders</div>
  </div>);
}
