import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, formatDescriptionForDisplay, normalizeStr } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

export default function OverviewView({ analysis, woStatuses, onSelectCustomer }) {
  const { C, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();

  const [ovSearch, setOvSearch] = useState("");
  const [ovWoStatus, setOvWoStatus] = useState("Booked");
  const [ovCustomer, setOvCustomer] = useState("all");
  const [ovDateFrom, setOvDateFrom] = useState("");
  const [ovDateTo, setOvDateTo] = useState("");
  const [custSortField, setCustSortField] = useState("remaining");
  const [custSortDir, setCustSortDir] = useState("desc");
  const [lateSortField, setLateSortField] = useState("daysLate");
  const [lateSortDir, setLateSortDir] = useState("desc");

  var statusLooksClosed = function(status) {
    var s = normalizeStr(status || "");
    if (!s) return false;
    return s.includes("close") || s.includes("complete") || s.includes("cancel") || s.includes("archive") || s.includes("done");
  };
  var parseDueDateTs = function(v) {
    if (!v) return Number.POSITIVE_INFINITY;
    var d = new Date(v);
    return isNaN(d) ? Number.POSITIVE_INFINITY : d.getTime();
  };

  var overview = useMemo(() => {
    if (!analysis) return null;
    var r = analysis.results.slice();
    if (ovSearch) {
      var q = ovSearch.toLowerCase();
      r = r.filter(function(w) {
        return (
          (w.woNum || "").toLowerCase().includes(q) ||
          (w.productSkuRaw || "").toLowerCase().includes(q) ||
          (w.productDesc || "").toLowerCase().includes(q) ||
          (w.customer || "").toLowerCase().includes(q)
        );
      });
    }
    // WO status filter
    if (ovWoStatus !== "all") r = r.filter(w => w.status === ovWoStatus);
    // Customer filter
    if (ovCustomer !== "all") r = r.filter(function(w) { return (w.customer || "Unassigned") === ovCustomer; });
    // Date range filter on due date
    if (ovDateFrom) { var from = new Date(ovDateFrom); from.setHours(0,0,0,0); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d >= from; }); }
    if (ovDateTo) { var to = new Date(ovDateTo); to.setHours(23,59,59,999); r = r.filter(w => { if (!w.dueDate) return false; var d = new Date(w.dueDate); return !isNaN(d) && d <= to; }); }
    var activeWOs = r.filter(function(wo) {
      if (wo.runStatus === "nobom") return false;
      if (statusLooksClosed(wo.status)) return false;
      return true;
    }).slice().sort(function(a, b) {
      var dt = parseDueDateTs(a.dueDate) - parseDueDateTs(b.dueDate);
      if (dt !== 0) return dt;
      return (a.woNum || "").localeCompare(b.woNum || "");
    });
    var remainingBySku = {};
    var woKey = function(wo) { return [wo.woNum || "", wo.productSkuRaw || "", wo.dueDate || ""].join("|"); };
    activeWOs.forEach(function(wo) {
      (wo.components || []).forEach(function(comp) {
        var seen = {};
        var optList = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0 }];
        optList.forEach(function(opt) {
          var k = normalizeStr(opt.sku || "");
          if (!k || seen[k]) return;
          seen[k] = true;
          var onHand = Number(opt.onHand || 0);
          if (!Object.prototype.hasOwnProperty.call(remainingBySku, k) || onHand > remainingBySku[k]) remainingBySku[k] = onHand;
        });
      });
    });
    var netMakeByWo = {};
    activeWOs.forEach(function(wo) {
      var committed = Number.POSITIVE_INFINITY;
      (wo.components || []).forEach(function(comp) {
        var qtyPer = Number(comp.qtyPer || 0);
        if (!(qtyPer > 0)) return;
        var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0 }];
        var options = optionRows.map(function(opt) { return { key:normalizeStr(opt.sku || ""), sku:opt.sku || "" }; }).filter(function(opt) { return !!opt.key; });
        var available = options.reduce(function(sum, opt) { return sum + (remainingBySku[opt.key] || 0); }, 0);
        committed = Math.min(committed, Math.floor(available / qtyPer));
      });
      if (!isFinite(committed)) committed = 0;
      committed = Math.max(0, Math.min(committed, Number(wo.qtyToProduce || 0)));
      netMakeByWo[woKey(wo)] = committed;
      (wo.components || []).forEach(function(comp) {
        var qtyPer = Number(comp.qtyPer || 0);
        if (!(qtyPer > 0)) return;
        var need = committed * qtyPer;
        if (need <= 0) return;
        var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails.slice() : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
        optionRows.sort(function(a, b) {
          if (!!a.isSub !== !!b.isSub) return a.isSub ? 1 : -1;
          return Number(b.onHand || 0) - Number(a.onHand || 0);
        });
        var remainNeed = need;
        optionRows.forEach(function(opt) {
          if (remainNeed <= 0) return;
          var key = normalizeStr(opt.sku || "");
          if (!key) return;
          var avail = remainingBySku[key] || 0;
          if (avail <= 0) return;
          var take = Math.min(avail, remainNeed);
          remainingBySku[key] = avail - take;
          remainNeed -= take;
        });
      });
    });

    var today = new Date(); today.setHours(0,0,0,0);
    var totalOrderQty = 0, totalProduced = 0, totalRemaining = 0, totalNetMake = 0, totalEstHours = 0, woCount = r.length;
    var lateWOs = [], byCustomer = {}, noDueDate = 0;
    r.forEach(wo => {
      totalOrderQty += wo.qtyToProduce;
      totalProduced += wo.unitsProduced;
      totalRemaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") totalNetMake += (netMakeByWo[woKey(wo)] || 0);
      totalEstHours += wo.estHours || 0;
      if (wo.dueDate) {
        var dd = new Date(wo.dueDate);
        if (!isNaN(dd) && dd < today && wo.unitsRemaining > 0 && !statusLooksClosed(wo.status)) {
          var daysLate = Math.floor((today - dd) / 86400000);
          lateWOs.push(Object.assign({}, wo, { daysLate:daysLate, netCanMake:netMakeByWo[woKey(wo)] || 0 }));
        }
      } else { noDueDate++; }
      var cust = wo.customer || "Unassigned";
      if (!byCustomer[cust]) byCustomer[cust] = { orderQty:0, produced:0, remaining:0, netMake:0, count:0, late:0 };
      byCustomer[cust].orderQty += wo.qtyToProduce;
      byCustomer[cust].produced += wo.unitsProduced;
      byCustomer[cust].remaining += wo.unitsRemaining;
      if (wo.runStatus !== "nobom") byCustomer[cust].netMake += (netMakeByWo[woKey(wo)] || 0);
      byCustomer[cust].count++;
    });
    lateWOs.sort((a,b) => b.daysLate - a.daysLate);
    lateWOs.forEach(w => { var cust = w.customer || "Unassigned"; if (byCustomer[cust]) byCustomer[cust].late++; });
    var completionPct = totalOrderQty > 0 ? Math.round(totalProduced / totalOrderQty * 100) : 0;
    var custArr = Object.entries(byCustomer).map(([name, d]) => Object.assign({ name:name }, d)).sort((a,b) => b.remaining - a.remaining);
    return { totalOrderQty:totalOrderQty, totalProduced:totalProduced, totalRemaining:totalRemaining, totalNetMake:totalNetMake, totalEstHours:Math.round(totalEstHours*10)/10, completionPct:completionPct, lateWOs:lateWOs, byCustomer:custArr, woCount:woCount, noDueDate:noDueDate };
  }, [analysis, ovSearch, ovWoStatus, ovCustomer, ovDateFrom, ovDateTo]);

  var customerOptions = useMemo(function() {
    if (!analysis || !analysis.results) return [];
    var set = new Set();
    analysis.results.forEach(function(w) { set.add(w.customer || "Unassigned"); });
    return Array.from(set).sort();
  }, [analysis]);

  if (!overview) return null;


  var onCustSort = function(field) {
    if (custSortField === field) setCustSortDir(custSortDir === "asc" ? "desc" : "asc");
    else { setCustSortField(field); setCustSortDir(field === "name" ? "asc" : "desc"); }
  };
  var onLateSort = function(field) {
    if (lateSortField === field) setLateSortDir(lateSortDir === "asc" ? "desc" : "asc");
    else { setLateSortField(field); setLateSortDir(field === "woNum" || field === "productSkuRaw" || field === "customer" || field === "dueDate" ? "asc" : "desc"); }
  };

  var sortedByCustomer = overview.byCustomer.slice().sort(function(a, b) {
    var c = 0;
    if (custSortField === "name") c = (a.name || "").localeCompare(b.name || "");
    else if (custSortField === "count") c = (a.count || 0) - (b.count || 0);
    else if (custSortField === "orderQty") c = (a.orderQty || 0) - (b.orderQty || 0);
    else if (custSortField === "produced") c = (a.produced || 0) - (b.produced || 0);
    else if (custSortField === "remaining") c = (a.remaining || 0) - (b.remaining || 0);
    else if (custSortField === "netMake") c = (a.netMake || 0) - (b.netMake || 0);
    else if (custSortField === "complete") {
      var ap = a.orderQty > 0 ? Math.round(a.produced / a.orderQty * 100) : 0;
      var bp = b.orderQty > 0 ? Math.round(b.produced / b.orderQty * 100) : 0;
      c = ap - bp;
    } else if (custSortField === "late") c = (a.late || 0) - (b.late || 0);
    return custSortDir === "desc" ? -c : c;
  });

  var sortedLateWOs = overview.lateWOs.slice().sort(function(a, b) {
    var c = 0;
    if (lateSortField === "daysLate") c = (a.daysLate || 0) - (b.daysLate || 0);
    else if (lateSortField === "woNum") c = (a.woNum || "").localeCompare(b.woNum || "");
    else if (lateSortField === "productSkuRaw") c = (a.productSkuRaw || "").localeCompare(b.productSkuRaw || "");
    else if (lateSortField === "productDesc") c = (a.productDesc || "").localeCompare(b.productDesc || "");
    else if (lateSortField === "customer") c = (a.customer || "").localeCompare(b.customer || "");
    else if (lateSortField === "qtyToProduce") c = (a.qtyToProduce || 0) - (b.qtyToProduce || 0);
    else if (lateSortField === "unitsRemaining") c = (a.unitsRemaining || 0) - (b.unitsRemaining || 0);
    else if (lateSortField === "prodPct") c = (a.prodPct || 0) - (b.prodPct || 0);
    else if (lateSortField === "readiness") c = (a.readiness || 0) - (b.readiness || 0);
    else if (lateSortField === "netCanMake") c = (a.netCanMake || 0) - (b.netCanMake || 0);
    else if (lateSortField === "dueDate") c = (a.dueDate || "").localeCompare(b.dueDate || "");
    return lateSortDir === "desc" ? -c : c;
  });

  return (<div>
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input type="text" placeholder="Search WO / SKU / customer" value={ovSearch} onChange={function(e) { setOvSearch(e.target.value); }} className="h-10 w-full text-sm sm:w-72" />
      <select value={ovCustomer} onChange={function(e) { setOvCustomer(e.target.value); }} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
        <option value="all">All Customers</option>
        {customerOptions.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
      </select>
      <select
        value={ovWoStatus}
        onChange={function(e) { setOvWoStatus(e.target.value); }}
        className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto"
      >
        <option value="all">All WO Status</option>
        {woStatuses.map(function(s) { return <option key={s} value={s}>{s}</option>; })}
      </select>
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>Due from</span>
      <Input type="date" value={ovDateFrom} onChange={e => setOvDateFrom(e.target.value)} className="h-10 w-full text-sm sm:w-36" />
      <span style={{ fontSize:13, color:C.dim }}>to</span>
      <Input type="date" value={ovDateTo} onChange={e => setOvDateTo(e.target.value)} className="h-10 w-full text-sm sm:w-36" />
      {(ovSearch || ovWoStatus!=="all" || ovCustomer!=="all" || ovDateFrom || ovDateTo) && <Button onClick={() => {setOvSearch("");setOvWoStatus("all");setOvCustomer("all");setOvDateFrom("");setOvDateTo("");}} variant="outline" size="default">Clear</Button>}
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>{overview.woCount} of {analysis.results.length} WOs{overview.noDueDate > 0 && ovDateFrom ? " ("+overview.noDueDate+" excluded \u2014 no due date)" : ""}</span>
    </div>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(150px, 1fr))", gap:10, marginBottom:20 }}>
      {[
        {l:"Total Order Qty", v:overview.totalOrderQty.toLocaleString(), c:C.bright},
        {l:"Produced", v:overview.totalProduced.toLocaleString(), c:C.ok},
        {l:"Remaining", v:overview.totalRemaining.toLocaleString(), c:C.warn},
        {l:"Net Make", v:overview.totalNetMake.toLocaleString(), c:C.accent},
        {l:"Completion", v:overview.completionPct+"%", c:overview.completionPct>=80?C.ok:overview.completionPct>=50?C.warn:C.bad},
        {l:"Est Hours Left", v:overview.totalEstHours+"h", c:C.bright},
        {l:"Late WOs", v:overview.lateWOs.length, c:overview.lateWOs.length>0?C.bad:C.ok}
      ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"14px 16px" }}>
        <div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
        <div style={{ fontSize:12, color:C.dim, marginTop:5, fontWeight:500, letterSpacing:0.1 }}>{s.l}</div>
      </div>)}
    </div>

    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>Work Orders by Customer</div>
      <TableShell>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {[{l:"Customer",f:"name"},{l:"WOs",f:"count"},{l:"Order Qty",f:"orderQty"},{l:"Produced",f:"produced"},{l:"Remaining",f:"remaining"},{l:"Net Make",f:"netMake"},{l:"Complete",f:"complete"},{l:"Late",f:"late"}].map(function(col) {
              var active = custSortField === col.f;
              var arrow = active ? (custSortDir === "asc" ? " \u2191" : " \u2193") : "";
              return <th key={col.f} style={Object.assign({}, thS, { color:active ? C.accent : thS.color })}><SortHeaderButton onClick={function() { onCustSort(col.f); }}>{col.l + arrow}</SortHeaderButton></th>;
            })}
          </tr></thead>
          <tbody>
            {sortedByCustomer.map((c, i) => {
              var pct = c.orderQty > 0 ? Math.round(c.produced / c.orderQty * 100) : 0;
              return <tr key={i} onClick={() => onSelectCustomer && onSelectCustomer(c.name)} style={{ borderBottom:"1px solid "+C.border, cursor:onSelectCustomer?"pointer":"default" }}
                onMouseEnter={e => { if (onSelectCustomer) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => { if (onSelectCustomer) e.currentTarget.style.background = "transparent"; }}>
                <td style={Object.assign({}, tdN, { fontWeight:600, color:C.bright })}>{c.name}</td>
                <td style={Object.assign({}, tdM, { color:C.dim })}>{c.count}</td>
                <td style={Object.assign({}, tdM, { color:C.bright })}>{c.orderQty.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.ok })}>{c.produced.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.warn })}>{c.remaining.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { color:C.accent })}>{c.netMake.toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:pct>=80?C.ok:pct>=50?C.warn:pct>0?C.accent:C.dim })}>{pct+"%"}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:c.late>0?C.bad:C.dim })}>{c.late > 0 ? c.late : "--"}</td>
              </tr>;
            })}
            {overview.byCustomer.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding:24, textAlign:"center", color:C.dim }}>
                  No customer data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>

    <div style={{ marginBottom:20 }}>
      <div style={{ fontSize:14, fontWeight:600, color:C.bad, marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:16 }}>{"\u26A0"}</span> Past Due Work Orders ({overview.lateWOs.length})
      </div>
      <TableShell className="border-[rgb(var(--danger))]/40">
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {[{l:"Days Late",f:"daysLate"},{l:"WO#",f:"woNum"},{l:"Product",f:"productSkuRaw"},{l:"Product Description",f:"productDesc"},{l:"Customer",f:"customer"},{l:"Order Qty",f:"qtyToProduce"},{l:"Remaining",f:"unitsRemaining"},{l:"Complete",f:"prodPct"},{l:"Ready",f:"readiness"},{l:"Net Make",f:"netCanMake"},{l:"Due Date",f:"dueDate"}].map(function(col) {
              var active = lateSortField === col.f;
              var arrow = active ? (lateSortDir === "asc" ? " \u2191" : " \u2193") : "";
              return <th key={col.f} style={Object.assign({}, thS, { color:active ? C.accent : thS.color })}><SortHeaderButton onClick={function() { onLateSort(col.f); }}>{col.l + arrow}</SortHeaderButton></th>;
            })}
          </tr></thead>
          <tbody>
            {sortedLateWOs.map((wo, i) => <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
              <td style={Object.assign({}, tdM, { fontWeight:700, color:C.bad })}>{wo.daysLate}d</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
              <td style={tdM}>{wo.productSkuRaw}</td>
              <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:220, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{formatDescriptionForDisplay(wo.productDesc) || "--"}</td>
              <td style={Object.assign({}, tdN, { color:C.dim })}>{wo.customer || "--"}</td>
              <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { color:C.warn })}>{wo.unitsRemaining.toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct>0?wo.prodPct+"%":"--"}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness<0?"--":Math.round(wo.readiness)+"%"}</td>
              <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:(wo.netCanMake||0)>0?C.warn:C.bad })}>{wo.runStatus==="nobom"?"--":(wo.netCanMake||0).toLocaleString()}</td>
              <td style={Object.assign({}, tdM, { color:C.bad })}>{fmtDate(wo.dueDate)}</td>
            </tr>)}
            {overview.lateWOs.length === 0 && (
              <tr>
                <td colSpan={11} style={{ padding:24, textAlign:"center", color:C.dim }}>
                  No past due work orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
    </div>
  </div>);
}
