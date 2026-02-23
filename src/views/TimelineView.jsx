import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { formatDescriptionForDisplay } from "../utils";

export default function TimelineView({ timelineData, deliveriesV2 }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, inp, sel, pill } = useStyles();

  const [matSort, setMatSort] = useState("affectedWOs");
  const [matSortDir, setMatSortDir] = useState("desc");
  const [matFilterTab, setMatFilterTab] = useState("all");
  const [matFilterDock, setMatFilterDock] = useState("all");
  const [matFilterWO, setMatFilterWO] = useState("all");
  const [matSearch, setMatSearch] = useState("");
  const [tlSearch, setTlSearch] = useState("");
  const [tlRiskFilter, setTlRiskFilter] = useState("all");
  const [tlSort, setTlSort] = useState("atRisk");
  const [tlSortDir, setTlSortDir] = useState("desc");
  const [windowDays, setWindowDays] = useState(14);
  const [pqSearch, setPqSearch] = useState("");
  const [pqAtRiskOnly, setPqAtRiskOnly] = useState(false);

  if (!timelineData) {
    return (
      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"20px 18px" }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.bright, marginBottom:6 }}>Deliveries</div>
        <div style={{ fontSize:13, color:C.dim, lineHeight:1.5 }}>
          No delivery data loaded yet. Upload EDR and/or OpenDock data to enable the delivery timeline and inbound material analysis.
        </div>
      </div>
    );
  }

  var windowOptions = [
    { key:1, label:"Today" },
    { key:7, label:"7d" },
    { key:14, label:"14d" },
    { key:30, label:"30d" }
  ];
  var todayStr = timelineData.today;
  var windowEndDate = useMemo(function() {
    var d = new Date(todayStr + "T00:00:00");
    d.setDate(d.getDate() + Math.max(0, windowDays - 1));
    return d;
  }, [todayStr, windowDays]);
  var windowEndStr = useMemo(function() {
    return windowEndDate.toISOString().slice(0, 10);
  }, [windowEndDate]);
  var visibleDays = useMemo(function() {
    return (timelineData.days || []).filter(function(day) { return day >= todayStr && day <= windowEndStr; });
  }, [timelineData, todayStr, windowEndStr]);
  var windowDeliveries = useMemo(function() {
    return (timelineData.deliveries || []).filter(function(d) { return d.date >= todayStr && d.date <= windowEndStr; });
  }, [timelineData, todayStr, windowEndStr]);
  var riskSummary = useMemo(function() {
    var dueBeforeInbound = 0;
    var unscheduled = 0;
    var noInbound = 0;
    var dockConflict = 0;
    (timelineData.woTimelines || []).forEach(function(wo) {
      var wd = (wo.deliveries || []).filter(function(d) { return d.date >= todayStr && d.date <= windowEndStr; });
      var dueObj = wo.dueDate ? new Date(wo.dueDate + "T00:00:00") : null;
      var dueInWindow = !!(dueObj && !isNaN(dueObj) && dueObj <= windowEndDate);
      if (dueInWindow && wd.length === 0) noInbound++;
      if (dueInWindow && wd.length > 0) {
        var firstInbound = wd.slice().sort(function(a, b) { return a.date.localeCompare(b.date); })[0];
        if (wo.dueDate && firstInbound && firstInbound.date > wo.dueDate) dueBeforeInbound++;
      }
      if (wd.some(function(d) {
        var s = (d.dockStatus || "").toLowerCase();
        return !s || (s !== "scheduled" && s !== "completed" && s !== "arrived");
      })) unscheduled++;
      if (wd.some(function(d) { return (d.dockStatus || "").toLowerCase().includes("cancel"); })) dockConflict++;
    });
    return {
      dueBeforeInbound: dueBeforeInbound,
      unscheduled: unscheduled,
      noInbound: noInbound,
      dockConflict: dockConflict
    };
  }, [timelineData, todayStr, windowEndStr, windowEndDate]);
  var windowBoard = useMemo(function() {
    var matched = windowDeliveries.filter(function(d) { return !!d.isMatched; }).length;
    var atRisk = windowDeliveries.filter(function(d) { return !!d.isAtRisk; }).length;
    var unitsUnlocked = windowDeliveries.reduce(function(sum, d) {
      if (!d.isAtRisk) return sum;
      var links = (timelineData.byMaterial[d.skuNorm] && timelineData.byMaterial[d.skuNorm].affectedWOs) ? timelineData.byMaterial[d.skuNorm].affectedWOs : [];
      var shortUnits = links.reduce(function(s, w) { return s + Math.max(0, (w.short || 0)); }, 0);
      return sum + Math.min(d.qty || 0, shortUnits);
    }, 0);
    return {
      openDockInboundAppts: windowDeliveries.filter(function(d) { return !!d.dockStatus; }).length,
      edrLoads: windowDeliveries.length,
      matched: matched,
      unmatched: Math.max(0, windowDeliveries.length - matched),
      atRisk: atRisk,
      unitsUnlocked: Math.round(unitsUnlocked)
    };
  }, [windowDeliveries, timelineData]);
  var reconciliation = {
    edrTotal: windowBoard.edrLoads,
    matched: windowBoard.matched,
    unmatched: windowBoard.unmatched,
    materialColumn: (deliveriesV2 && deliveriesV2.reconciliation && deliveriesV2.reconciliation.materialColumn) || "",
    exactSkuMatched: (deliveriesV2 && deliveriesV2.reconciliation && deliveriesV2.reconciliation.exactSkuMatched) || 0,
    leadingZeroMatched: (deliveriesV2 && deliveriesV2.reconciliation && deliveriesV2.reconciliation.leadingZeroMatched) || 0,
    unmatchedSkuRows: (deliveriesV2 && deliveriesV2.reconciliation && deliveriesV2.reconciliation.unmatchedSkuRows) || 0
  };
  var fmtDateShort = function(v) {
    if (!v) return "--";
    var d = new Date(String(v) + "T12:00:00");
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString("en-US", { month:"numeric", day:"numeric" });
  };
  var exceptions = deliveriesV2 && deliveriesV2.exceptions ? deliveriesV2.exceptions : {
    edrWithoutOpenDock: 0,
    openDockWithoutEdr: 0,
    lateForDueWos: 0,
    cancelledAtRisk: 0
  };
  var priorityQueueRows = useMemo(function() {
    var src = deliveriesV2 && deliveriesV2.priorityQueue ? deliveriesV2.priorityQueue.slice() : [];
    var rows = src.filter(function(r) { return r.etaDate >= todayStr && r.etaDate <= windowEndStr; });
    if (pqAtRiskOnly) rows = rows.filter(function(r) { return !!r.isAtRisk; });
    if (pqSearch) {
      var q = pqSearch.toLowerCase();
      rows = rows.filter(function(r) {
        return (
          (r.materialSku || "").toLowerCase().includes(q) ||
          (r.materialDesc || "").toLowerCase().includes(q) ||
          (r.po || "").toLowerCase().includes(q) ||
          (r.recommendedAction || "").toLowerCase().includes(q)
        );
      });
    }
    rows.sort(function(a, b) {
      if (!!a.isAtRisk !== !!b.isAtRisk) return a.isAtRisk ? -1 : 1;
      if ((a.unitsUnlocked || 0) !== (b.unitsUnlocked || 0)) return (b.unitsUnlocked || 0) - (a.unitsUnlocked || 0);
      return String(a.etaDate || "").localeCompare(String(b.etaDate || ""));
    });
    return rows;
  }, [deliveriesV2, todayStr, windowEndStr, pqAtRiskOnly, pqSearch]);

  var timelineRows = useMemo(function() {
    var grouped = {};
    windowDeliveries.forEach(function(d) {
      if (!grouped[d.skuNorm]) grouped[d.skuNorm] = { skuNorm:d.skuNorm, sku:d.sku, desc:d.desc || "", deliveries:[] };
      grouped[d.skuNorm].deliveries.push(d);
    });
    return Object.values(grouped).map(function(g) {
      var byDate = {};
      g.deliveries.forEach(function(d) {
        if (!byDate[d.date]) byDate[d.date] = { items:[], totalQty:0 };
        byDate[d.date].items.push(d);
        byDate[d.date].totalQty += d.qty;
      });
      var linkedWOs = (timelineData.byMaterial[g.skuNorm] && timelineData.byMaterial[g.skuNorm].affectedWOs) ? timelineData.byMaterial[g.skuNorm].affectedWOs : [];
      var atRiskWONums = Array.from(new Set(linkedWOs.filter(function(w) { return (w.short || 0) > 0; }).map(function(w) { return w.woNum; })));
      var atRisk = atRiskWONums.length > 0;
      var dockStatuses = Array.from(new Set(g.deliveries.map(function(d) { return d.dockStatus || ""; }).filter(Boolean)));
      var topDock = dockStatuses.includes("Scheduled") ? "Scheduled" : dockStatuses.includes("Completed") ? "Completed" : dockStatuses.includes("Arrived") ? "Arrived" : dockStatuses.includes("Cancelled") ? "Cancelled" : "";
      return {
        sku:g.sku,
        desc:g.desc,
        delByDate:byDate,
        totalIncoming:g.deliveries.reduce(function(s, d) { return s + d.qty; }, 0),
        deliveryCount:g.deliveries.length,
        atRisk:atRisk,
        atRiskWONums:atRiskWONums,
        topDock:topDock
      };
    });
  }, [windowDeliveries, timelineData]);

  var filteredTimelineRows = useMemo(function() {
    var rows = timelineRows.slice();
    if (tlSearch) {
      var q = tlSearch.toLowerCase();
      rows = rows.filter(function(r) {
        return (
          (r.sku || "").toLowerCase().includes(q) ||
          (r.desc || "").toLowerCase().includes(q) ||
          (r.atRiskWONums || []).some(function(wo) { return (wo || "").toLowerCase().includes(q); })
        );
      });
    }
    if (tlRiskFilter === "atrisk") rows = rows.filter(function(r) { return r.atRisk; });
    rows.sort(function(a, b) {
      var c = 0;
      if (tlSort === "material") c = (a.sku || "").localeCompare(b.sku || "");
      else if (tlSort === "dock") c = (a.topDock || "").localeCompare(b.topDock || "");
      else if (tlSort === "deliveries") c = (a.deliveryCount || 0) - (b.deliveryCount || 0);
      else if (tlSort === "incoming") c = (a.totalIncoming || 0) - (b.totalIncoming || 0);
      else c = (a.atRisk ? 1 : 0) - (b.atRisk ? 1 : 0);
      return tlSortDir === "desc" ? -c : c;
    });
    return rows;
  }, [timelineRows, tlSearch, tlRiskFilter, tlSort, tlSortDir]);

  var timelineHasFilters = !!tlSearch || tlRiskFilter !== "all";

  return (<div>
    <div style={{ display:"flex", gap:6, marginBottom:10, flexWrap:"wrap", alignItems:"center" }}>
      <span style={{ fontSize:12, color:C.dim, marginRight:4 }}>Window</span>
      {windowOptions.map(function(opt) {
        return <button key={opt.key} onClick={function() { setWindowDays(opt.key); }} style={pill(windowDays===opt.key)}>{opt.label}</button>;
      })}
    </div>
    <div style={{ display:"flex", gap:20, marginBottom:8, flexWrap:"wrap" }}>
      {[{l:"OpenDock Inbound",v:windowBoard.openDockInboundAppts,c:C.accent},{l:"EDR Inbounds",v:windowBoard.edrLoads,c:C.bright},{l:"OD + EDR Match",v:windowBoard.matched,c:C.ok},{l:"At Risk WO",v:windowBoard.atRisk,c:C.warn},{l:"Units Unlocked",v:windowBoard.unitsUnlocked.toLocaleString(),c:C.accent}].map((s,i) =>
        <div key={i}><div style={{ fontSize:24, fontWeight:700, fontFamily:mono, color:s.c, lineHeight:1 }}>{s.v}</div><div style={{ fontSize:13, color:C.dim, marginTop:3, letterSpacing:0.1 }}>{s.l}</div></div>
      )}
    </div>
    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
      {[
        { label:"Due Before Inbound", value:riskSummary.dueBeforeInbound, tone:riskSummary.dueBeforeInbound>0?"bad":"dim" },
        { label:"Unscheduled PO", value:riskSummary.unscheduled, tone:riskSummary.unscheduled>0?"warn":"dim" },
        { label:"No Inbound", value:riskSummary.noInbound, tone:riskSummary.noInbound>0?"bad":"dim" },
        { label:"Dock Conflict", value:riskSummary.dockConflict, tone:riskSummary.dockConflict>0?"warn":"dim" }
      ].map(function(r) {
        var color = r.tone==="bad" ? C.bad : r.tone==="warn" ? C.warn : C.dim;
        var bg = r.tone==="bad" ? C.badSoft : r.tone==="warn" ? C.warnSoft : C.raised;
        return <span key={r.label} style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:12, fontWeight:600, color:color, background:bg, border:"1px solid "+C.border, borderRadius:999, padding:"3px 9px" }}>
          <span style={{ fontFamily:mono }}>{r.value}</span>{r.label}
        </span>;
      })}
    </div>
    <div style={{ fontSize:12, color:C.dim, marginBottom:16 }}>
      Reconciliation ({windowDays === 1 ? "today" : (windowDays + "d")}): EDR {reconciliation.edrTotal} = matched {reconciliation.matched} + unmatched {reconciliation.unmatched}.
    </div>
    <div style={{ display:"flex", gap:6, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
      <span style={{ fontSize:12, color:C.dim }}>Match diagnostics</span>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:C.dim, background:C.raised, border:"1px solid "+C.border, borderRadius:999, padding:"3px 8px" }}>
        Material col: <span style={{ fontFamily:mono, color:C.bright }}>{reconciliation.materialColumn || "--"}</span>
      </span>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:C.ok, background:C.okSoft, border:"1px solid "+C.okLine, borderRadius:999, padding:"3px 8px" }}>
        Exact: <span style={{ fontFamily:mono }}>{reconciliation.exactSkuMatched}</span>
      </span>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:C.accent, background:C.accentSoft, border:"1px solid "+C.accentLine, borderRadius:999, padding:"3px 8px" }}>
        Zero-trim: <span style={{ fontFamily:mono }}>{reconciliation.leadingZeroMatched}</span>
      </span>
      <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:12, color:C.bad, background:C.badSoft, border:"1px solid "+C.badLine, borderRadius:999, padding:"3px 8px" }}>
        Unmatched: <span style={{ fontFamily:mono }}>{reconciliation.unmatchedSkuRows}</span>
      </span>
    </div>
    <div style={{ marginBottom:16, background:C.surface, border:"1px solid "+C.border, borderRadius:8, padding:"10px 12px" }}>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
        {[{l:"EDR w/o OpenDock",v:exceptions.edrWithoutOpenDock},{l:"OpenDock w/o EDR",v:exceptions.openDockWithoutEdr},{l:"Late vs WO Due",v:exceptions.lateForDueWos},{l:"Cancelled At-Risk",v:exceptions.cancelledAtRisk}].map(function(x) {
          var hot = x.v > 0;
          return <span key={x.l} style={{ display:"inline-flex", alignItems:"center", gap:5, border:"1px solid "+C.border, borderRadius:999, padding:"3px 9px", fontSize:12, fontWeight:600, color:hot?C.bad:C.dim, background:hot?C.badSoft:C.raised }}>
            <span style={{ fontFamily:mono }}>{x.v}</span>{x.l}
          </span>;
        })}
      </div>
    </div>
    <div style={{ marginBottom:16, background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden" }}>
      <div style={{ padding:"10px 12px", borderBottom:"1px solid "+C.border, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
        <div style={{ fontSize:14, fontWeight:700, color:C.bright, marginRight:8 }}>Inbound Priority Queue</div>
        <input value={pqSearch} onChange={function(e) { setPqSearch(e.target.value); }} placeholder="Search PO, material..." style={Object.assign({}, inp, { width:190, fontSize:13 })} />
        <button onClick={function() { setPqAtRiskOnly(function(v) { return !v; }); }} style={pill(pqAtRiskOnly)}>{pqAtRiskOnly ? "At-Risk Only" : "All Loads"}</button>
        <span style={{ fontSize:12, color:C.dim }}>{priorityQueueRows.length} loads</span>
      </div>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            {["Scheduled Date","Expected Date","PO","Material","Qty","OD + EDR Match","At Risk WO","Linked WOs","Units Unlocked"].map(function(h) { return <th key={h} style={thC(false)}>{h}</th>; })}
          </tr></thead>
          <tbody>
            {priorityQueueRows.slice(0, 25).map(function(r, i) {
              return <tr key={i} style={{ borderBottom:"1px solid "+C.border }}>
                <td style={tdM}>{fmtDateShort(r.scheduledDate)}</td>
                <td style={tdM}>{fmtDateShort(r.etaDate)}</td>
                <td style={Object.assign({}, tdN, { maxWidth:120, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{r.po || "--"}</td>
                <td style={Object.assign({}, tdN, { maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{r.materialSku} {r.materialDesc ? ("| " + formatDescriptionForDisplay(r.materialDesc)) : ""}</td>
                <td style={Object.assign({}, tdM, { color:C.bright })}>{Math.round(r.qty || 0).toLocaleString()}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600 })}>
                  <span style={{ display:"inline-block", padding:"2px 7px", borderRadius:999, fontSize:11, color:r.isMatched ? C.ok : C.bad, background:r.isMatched ? C.okSoft : C.badSoft }}>
                    {r.isMatched ? "Matched" : "No Match"}
                  </span>
                </td>
                <td style={Object.assign({}, tdM, { fontWeight:600 })}>
                  <span style={{ display:"inline-block", padding:"2px 7px", borderRadius:999, fontSize:11, color:r.isAtRisk ? C.warn : C.dim, background:r.isAtRisk ? C.warnSoft : C.raised }}>
                    {r.isAtRisk ? "Yes" : "No"}
                  </span>
                </td>
                <td style={tdM}>{r.linkedWOCount || 0}</td>
                <td style={Object.assign({}, tdM, { color:(r.unitsUnlocked || 0) > 0 ? C.accent : C.dim, fontWeight:600 })}>{Math.round(r.unitsUnlocked || 0).toLocaleString()}</td>
              </tr>;
            })}
            {priorityQueueRows.length === 0 && <tr><td colSpan={9} style={{ padding:18, color:C.dim, textAlign:"center" }}>No loads match current queue filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:8, overflow:"hidden", marginBottom:16 }}>
      <div style={{ padding:"12px 16px", borderBottom:"1px solid "+C.border }}>
        <div style={{ fontSize:15, fontWeight:600, color:C.bright }}>Delivery Timeline</div>
        <div style={{ marginTop:10, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
          <input value={tlSearch} onChange={function(e) { setTlSearch(e.target.value); }} placeholder="Search material, desc, WO..." style={Object.assign({}, inp, { width:220, fontSize:13 })} />
          {[{key:"all",label:"All"},{key:"atrisk",label:"At-Risk"}].map(function(s) {
            return <button key={s.key} onClick={function() { setTlRiskFilter(function(curr) { return curr === s.key && s.key !== "all" ? "all" : s.key; }); }} style={pill(tlRiskFilter===s.key)}>{s.label}</button>;
          })}
          <select value={tlSort} onChange={function(e) { setTlSort(e.target.value); }} style={Object.assign({}, sel, { fontSize:13 })}>
            <option value="atRisk">Sort: At-Risk</option>
            <option value="incoming">Sort: Incoming Qty</option>
            <option value="deliveries">Sort: Deliveries</option>
            <option value="dock">Sort: Dock Status</option>
            <option value="material">Sort: Material</option>
          </select>
          <button onClick={function() { setTlSortDir(function(d) { return d === "asc" ? "desc" : "asc"; }); }} style={Object.assign({}, pill(false), { fontSize:12 })}>
            {tlSortDir === "asc" ? "Asc" : "Desc"}
          </button>
          {timelineHasFilters && <button onClick={function() { setTlSearch(""); setTlRiskFilter("all"); }} style={Object.assign({}, pill(false), { fontSize:12, color:C.bad, borderColor:C.badLine })}>Clear</button>}
          <span style={{ fontSize:12, color:C.dim, marginLeft:4 }}>{filteredTimelineRows.length} of {timelineRows.length} materials</span>
        </div>
      </div>
      <div style={{ overflowX:"auto" }}>
        <div style={{ minWidth:Math.max(800, visibleDays.length*40 + 340), display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", position:"sticky", top:0, zIndex:2, background:C.raised }}>
            <div style={{ minWidth:320, padding:"6px 12px", fontSize:13, fontWeight:600, fontFamily:sans, letterSpacing:0.1, color:C.dim, borderBottom:"1px solid "+C.border, flexShrink:0 }}>Inbound Material</div>
            <div style={{ display:"flex", flex:1 }}>
              {visibleDays.map(day => {
                var dt = new Date(day + "T12:00:00"); var isT = day === timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6;
                return <div key={day} style={{ minWidth:40, flex:"0 0 40px", textAlign:"center", padding:"3px 0", borderBottom:"1px solid "+(isT?C.accent:C.border), background:isT?C.accentSoft:isW?C.raised:"transparent" }}>
                  <div style={{ fontSize:12, fontFamily:sans, fontWeight:600, color:isT?C.accent:C.dim }}>{"SMTWTFS"[dt.getDay()]}</div>
                  <div style={{ fontSize:12, fontFamily:mono, fontWeight:isT?700:400, color:isT?C.accent:C.bright }}>{dt.getDate()}</div>
                  {(dt.getDate()===1||day===visibleDays[0]) && <div style={{ fontSize:12, color:C.dim }}>{dt.toLocaleDateString("en-US",{month:"short"})}</div>}
                </div>;
              })}
            </div>
          </div>
          {filteredTimelineRows.map((row, wI) => {
            var sc = row.atRisk ? C.warn : C.ok;
            return <div key={wI} style={{ display:"flex", borderBottom:"1px solid "+C.border, minHeight:46 }}>
              <div style={{ minWidth:320, padding:"6px 12px", display:"flex", flexDirection:"column", justifyContent:"center", flexShrink:0, borderRight:"1px solid "+C.border }}>
                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                  <span style={{ fontSize:13, fontWeight:600, fontFamily:mono, color:C.bright }}>{row.sku}</span>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:sc }} />
                  {row.atRisk && <span style={{ fontSize:11, fontWeight:700, color:C.warn, background:C.warnSoft, borderRadius:999, padding:"2px 6px" }}>At-Risk</span>}
                </div>
                <div style={{ fontSize:12, color:C.dim, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:290 }}>{formatDescriptionForDisplay(row.desc)||"--"}</div>
                <div style={{ fontSize:13, color:C.dim, fontFamily:mono, marginTop:1 }}>
                  {"Deliveries " + row.deliveryCount.toLocaleString() + " | +" + row.totalIncoming.toLocaleString() + " incoming" + (row.atRiskWONums.length ? (" | WOs " + row.atRiskWONums.slice(0,3).join(", ")) : "")}
                </div>
              </div>
              <div style={{ display:"flex", flex:1 }}>
                {visibleDays.map(day => {
                  var dt = new Date(day+"T12:00:00"); var isT = day===timelineData.today; var isW = dt.getDay()===0||dt.getDay()===6;
                  var dd = row.delByDate[day]; var badge = null;
                  if (dd) { var sts = dd.items.map(d=>d.dockStatus).filter(Boolean); var bg = sts.includes("Completed")?C.ok:sts.includes("Scheduled")?C.accent:sts.includes("Cancelled")?C.bad:C.dim; var ic = sts.includes("Completed")?"\u2713":sts.includes("Scheduled")?"\u25C9":sts.includes("Cancelled")?"\u2717":"\u25CF"; badge = { bg:bg, ic:ic }; }
                  return <div key={day} style={{ minWidth:40, flex:"0 0 40px", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:1, background:isT?C.accentSoft:isW?C.raised:"transparent", borderLeft:isT?"2px solid "+C.accent:"none" }}>
                    {dd && <div title={dd.items.map(d => d.sku+": "+d.qty.toLocaleString()+" ("+(d.dockStatus||"pending")+")").join("\n")} style={{ fontSize:14, fontFamily:mono, fontWeight:700, color:"#fff", background:badge?badge.bg:C.dim, borderRadius:3, padding:"2px 4px", lineHeight:1.3, textAlign:"center", minWidth:30, cursor:"default" }}>
                      {dd.totalQty >= 1000 ? (dd.totalQty/1000).toFixed(1)+"k" : dd.totalQty}
                    </div>}
                  </div>;
                })}
              </div>
            </div>;
          })}
          {filteredTimelineRows.length === 0 && (
            <div style={{ padding:"16px 12px", color:C.dim, fontSize:13 }}>
              {windowDeliveries.length > 0 ? "No inbound materials match the current Deliveries filters." : "No deliveries are available in the selected window."}
            </div>
          )}
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
      var byMaterialWindow = {};
      windowDeliveries.forEach(function(d) {
        var ref = timelineData.byMaterial[d.skuNorm] || { sku:d.sku, desc:d.desc, affectedWOs:[] };
        if (!byMaterialWindow[d.skuNorm]) byMaterialWindow[d.skuNorm] = { sku:ref.sku || d.sku, desc:ref.desc || d.desc, deliveries:[], affectedWOs:ref.affectedWOs || [] };
        byMaterialWindow[d.skuNorm].deliveries.push(d);
      });
      var matRows = Object.entries(byMaterialWindow).map(function(entry) {
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
      var cols = [{k:"material",l:"Material"},{k:"description",l:"Description"},{k:"tab",l:"Tab"},{k:"dockStatus",l:"Dock Status"},{k:"deliveries",l:"Deliveries"},{k:"openQty",l:"Open Qty"},{k:"affectedWOs",l:"WOs"}];
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
                <td style={Object.assign({}, tdN, { color:C.dim, maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" })}>{formatDescriptionForDisplay(r.desc)||"--"}</td>
                <td style={tdN}><span style={{ fontSize:12, fontWeight:500, padding:"1px 7px", borderRadius:10, color:r.tab==="FG"?C.accent:C.warn, background:r.tab==="FG"?C.accentSoft:C.warnSoft }}>{r.tab||"--"}</span></td>
                <td style={Object.assign({}, tdN, { fontSize:13, color:r.dockSummary?C.bright:C.dim })}>{r.dockSummary||"--"}</td>
                <td style={Object.assign({}, tdM, { color:C.bright })}>{r.delCount}</td>
                <td style={Object.assign({}, tdM, { fontWeight:600, color:C.ok })}>{r.totalOpen.toLocaleString()}</td>
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
