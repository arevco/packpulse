import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { normalizeStr } from "../utils";
import { Button } from "../components/ui/button";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

export default function OverviewView({ analysis, onSelectCustomer }) {
  const { C, mono } = useTheme();
  const { thS, tdN, tdM } = useStyles();
  var compactTh = Object.assign({}, thS, { padding:"7px 10px", fontSize:11 });
  var compactTdN = Object.assign({}, tdN, { padding:"8px 10px", fontSize:12, lineHeight:1.15 });
  var compactTdM = Object.assign({}, tdM, { padding:"8px 10px", fontSize:12, lineHeight:1.15 });

  const [custSortField, setCustSortField] = useState("remaining");
  const [custSortDir, setCustSortDir] = useState("desc");
  const [showByCustomer, setShowByCustomer] = useState(true);

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
  }, [analysis]);

  if (!overview) return null;


  var onCustSort = function(field) {
    if (custSortField === field) setCustSortDir(custSortDir === "asc" ? "desc" : "asc");
    else { setCustSortField(field); setCustSortDir(field === "name" ? "asc" : "desc"); }
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

  return (<div style={{ display:"flex", flexDirection:"column", gap:12 }}>
    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(136px, 1fr))", gap:8 }}>
      {[
        {l:"Order Qty", v:overview.totalOrderQty.toLocaleString(), c:C.bright},
        {l:"Produced", v:overview.totalProduced.toLocaleString(), c:C.ok},
        {l:"Remaining", v:overview.totalRemaining.toLocaleString(), c:C.warn},
        {l:"Net", v:overview.totalNetMake.toLocaleString(), c:C.accent},
        {l:"Complete", v:overview.completionPct+"%", c:overview.completionPct>=80?C.ok:overview.completionPct>=50?C.warn:C.bad},
        {l:"Est Hrs", v:overview.totalEstHours+"h", c:C.bright},
        {l:"Late", v:overview.lateWOs.length, c:overview.lateWOs.length>0?C.bad:C.ok}
      ].map(s => <div key={s.l} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"10px 12px" }}>
        <div style={{ fontSize:20, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div>
        <div style={{ fontSize:11, color:C.dim, marginTop:4, fontWeight:500, letterSpacing:0.08 }}>{s.l}</div>
      </div>)}
    </div>

    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-start", gap:8, marginBottom:8 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.bright }}>Work Orders by Customer</div>
        <Button onClick={function() { setShowByCustomer(function(v) { return !v; }); }} variant="outline" size="sm" className="gap-1.5">
          {showByCustomer ? "Hide" : "Show"}
        </Button>
      </div>
      {showByCustomer ? (
      <TableShell>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {[{l:"Customer",f:"name"},{l:"WOs",f:"count"},{l:"Order",f:"orderQty"},{l:"Prod",f:"produced"},{l:"Rem",f:"remaining"},{l:"Net",f:"netMake"},{l:"%",f:"complete"},{l:"Late",f:"late"}].map(function(col) {
              var active = custSortField === col.f;
              var arrow = active ? (custSortDir === "asc" ? " \u2191" : " \u2193") : "";
              return <th key={col.f} style={Object.assign({}, compactTh, { color:active ? C.accent : compactTh.color })}><SortHeaderButton onClick={function() { onCustSort(col.f); }}>{col.l + arrow}</SortHeaderButton></th>;
            })}
          </tr></thead>
          <tbody>
            {sortedByCustomer.map((c, i) => {
              var pct = c.orderQty > 0 ? Math.round(c.produced / c.orderQty * 100) : 0;
              return <tr key={i} onClick={() => onSelectCustomer && onSelectCustomer(c.name)} style={{ borderBottom:"1px solid "+C.border, cursor:onSelectCustomer?"pointer":"default" }}
                onMouseEnter={e => { if (onSelectCustomer) e.currentTarget.style.background = C.hover; }}
                onMouseLeave={e => { if (onSelectCustomer) e.currentTarget.style.background = "transparent"; }}>
                <td style={Object.assign({}, compactTdN, { fontWeight:600, color:C.bright })}>{c.name}</td>
                <td style={Object.assign({}, compactTdM, { color:C.dim })}>{c.count}</td>
                <td style={Object.assign({}, compactTdM, { color:C.bright })}>{c.orderQty.toLocaleString()}</td>
                <td style={Object.assign({}, compactTdM, { color:C.ok })}>{c.produced.toLocaleString()}</td>
                <td style={Object.assign({}, compactTdM, { color:C.warn })}>{c.remaining.toLocaleString()}</td>
                <td style={Object.assign({}, compactTdM, { color:C.accent })}>{c.netMake.toLocaleString()}</td>
                <td style={Object.assign({}, compactTdM, { fontWeight:600, color:pct>=80?C.ok:pct>=50?C.warn:pct>0?C.accent:C.dim })}>{pct+"%"}</td>
                <td style={Object.assign({}, compactTdM, { fontWeight:600, color:c.late>0?C.bad:C.dim })}>{c.late > 0 ? c.late : "--"}</td>
              </tr>;
            })}
            {overview.byCustomer.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding:18, textAlign:"center", color:C.dim, fontSize:12 }}>
                  No customer data available.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableShell>
      ) : null}
    </div>
  </div>);
}
