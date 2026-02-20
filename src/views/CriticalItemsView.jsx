import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, buildExportHTML, normalizeStr } from "../utils";
import Dot from "../components/Dot";

export default function CriticalItemsView({ rawCriticalItems, inboundCoverage }) {
  const { C } = useTheme();
  const { thC, tdN, tdM, tdToggle, thDS, tdDN, tdDM, truncate, inp, sel, pill } = useStyles();

  const [ciMode, setCiMode] = useState("material");
  const [ciSearch, setCiSearch] = useState("");
  const [ciCustomerFilter, setCiCustomerFilter] = useState("all");
  const [ciStockFilter, setCiStockFilter] = useState("all");

  const [ciSort, setCiSort] = useState("unlockedUnits");
  const [ciSortDir, setCiSortDir] = useState("desc");

  const [covStatusFilter, setCovStatusFilter] = useState("all");
  const [covRiskFilter, setCovRiskFilter] = useState("all");
  const [covSort, setCovSort] = useState("shortQty");
  const [covSortDir, setCovSortDir] = useState("desc");

  const [expandedWO, setExpandedWO] = useState(null);
  const ITEM_TRUNCATE_LEN = 14;
  var truncateItem = function(v) {
    var s = String(v || "");
    return s.length > ITEM_TRUNCATE_LEN ? (s.slice(0, ITEM_TRUNCATE_LEN) + "...") : s;
  };

  var handleCiSort = function(f) {
    if (ciSort === f) setCiSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setCiSort(f); setCiSortDir("desc"); }
  };

  var handleCovSort = function(f) {
    if (covSort === f) setCovSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setCovSort(f); setCovSortDir("desc"); }
  };

  var customerOptions = useMemo(function() {
    var set = new Set();
    (rawCriticalItems || []).forEach(function(item) {
      (item.customers || []).forEach(function(c) { if (c) set.add(c); });
    });
    return Array.from(set).sort();
  }, [rawCriticalItems]);

  var criticalItems = useMemo(function() {
    var items = (rawCriticalItems || []).slice();
    if (ciSearch) {
      var q = ciSearch.toLowerCase();
      items = items.filter(function(i) {
        return i.sku.toLowerCase().includes(q) || (i.desc || "").toLowerCase().includes(q) || (i.customerLabel || "").toLowerCase().includes(q);
      });
    }
    if (ciCustomerFilter !== "all") {
      items = items.filter(function(i) { return (i.customers || []).includes(ciCustomerFilter); });
    }
    if (ciStockFilter !== "all") {
      items = items.filter(function(i) { return ciStockFilter === "zero" ? i.isZeroStock : !i.isZeroStock; });
    }
    items.sort(function(a, b) {
      var c = 0;
      if (ciSort === "sku") c = a.sku.localeCompare(b.sku);
      else if (ciSort === "desc") c = (a.desc || "").localeCompare(b.desc || "");
      else if (ciSort === "customer") c = (a.customerLabel || "").localeCompare(b.customerLabel || "");
      else if (ciSort === "status") c = Number(a.isZeroStock) - Number(b.isZeroStock);
      else if (ciSort === "onHand") c = a.onHand - b.onHand;
      else if (ciSort === "totalShort") c = a.totalShort - b.totalShort;
      else if (ciSort === "affectedWOs") c = a.affectedWOs.length - b.affectedWOs.length;
      else c = a.unlockedUnits - b.unlockedUnits;
      return ciSortDir === "desc" ? -c : c;
    });
    return items;
  }, [rawCriticalItems, ciSort, ciSortDir, ciSearch, ciCustomerFilter, ciStockFilter]);

  var coverageItems = useMemo(function() {
    if (!inboundCoverage || !inboundCoverage.rows) return [];
    var bySku = {};
    (rawCriticalItems || []).forEach(function(item) { bySku[normalizeStr(item.sku)] = item; });

    var items = inboundCoverage.rows.map(function(row) {
      var base = bySku[normalizeStr(row.sku)] || {};
      return Object.assign({}, row, {
        desc: row.desc || base.desc || "",
        customerLabel: row.customerLabel || base.customerLabel || "--",
        affectedWOs: base.affectedWOs || [],
        onHand: base.onHand || 0,
      });
    });

    if (ciSearch) {
      var q = ciSearch.toLowerCase();
      items = items.filter(function(r) {
        return (
          r.sku.toLowerCase().includes(q) ||
          (r.desc || "").toLowerCase().includes(q) ||
          (r.customerLabel || "").toLowerCase().includes(q) ||
          (r.openPOs || []).join(",").toLowerCase().includes(q)
        );
      });
    }

    if (covStatusFilter === "at-risk") items = items.filter(function(r) { return r.riskLevel !== "low"; });
    else if (covStatusFilter !== "all") items = items.filter(function(r) { return r.status === covStatusFilter; });
    if (covRiskFilter !== "all") items = items.filter(function(r) { return r.riskLevel === covRiskFilter; });
    if (ciCustomerFilter !== "all") {
      items = items.filter(function(i) {
        return String(i.customerLabel || "").split(",").map(function(v) { return v.trim(); }).includes(ciCustomerFilter);
      });
    }

    items.sort(function(a, b) {
      var c = 0;
      if (covSort === "sku") c = a.sku.localeCompare(b.sku);
      else if (covSort === "status") c = a.status.localeCompare(b.status);
      else if (covSort === "risk") c = a.riskLevel.localeCompare(b.riskLevel);
      else if (covSort === "shortQty") c = a.shortQty - b.shortQty;
      else if (covSort === "scheduledQty") c = a.scheduledQty - b.scheduledQty;
      else if (covSort === "inboundQty") c = a.inboundQty - b.inboundQty;
      else if (covSort === "coverage") c = a.scheduledCoveragePct - b.scheduledCoveragePct;
      else if (covSort === "dueDate") c = (a.earliestDueDate || "").localeCompare(b.earliestDueDate || "");
      return covSortDir === "desc" ? -c : c;
    });
    return items;
  }, [inboundCoverage, rawCriticalItems, ciSearch, covStatusFilter, covRiskFilter, ciCustomerFilter, covSort, covSortDir]);

  var exportCriticalCSV = function() {
    if (ciMode === "coverage") {
      var hC = ["Item Code", "Description", "Customer", "Risk", "Status", "Short Qty", "Scheduled Qty", "Inbound Qty", "Coverage %", "Earliest Due", "Earliest Scheduled", "POs"];
      var rowsC = coverageItems.map(function(i) {
        return [
          i.sku,
          '"' + (i.desc || "").replace(/"/g, '""') + '"',
          '"' + (i.customerLabel || "--").replace(/"/g, '""') + '"',
          i.riskLevel || "",
          i.status || "",
          Math.round(i.shortQty || 0),
          Math.round(i.scheduledQty || 0),
          Math.round(i.inboundQty || 0),
          (i.scheduledCoveragePct || 0) + "%",
          i.earliestDueDate || "",
          i.earliestScheduledDate || "",
          '"' + ((i.openPOs || []).join(", ")).replace(/"/g, '""') + '"',
        ];
      });
      triggerDownload([hC.join(",")].concat(rowsC.map(function(r) { return r.join(","); })).join("\n"), "inbound_coverage_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv");
      return;
    }

    var h = ["Item Code", "Description", "Customer", "Status", "On Hand", "Total Short", "WOs Affected", "Production Unlocked"];
    var rows = criticalItems.map(function(i) {
      return [i.sku, '"' + (i.desc || "").replace(/"/g, '""') + '"', '"' + (i.customerLabel || "--").replace(/"/g, '""') + '"', i.isZeroStock ? "ZERO" : "LOW", Math.round(i.onHand), Math.round(i.totalShort), i.affectedWOs.length, Math.round(i.unlockedUnits)];
    });
    triggerDownload([h.join(",")].concat(rows.map(function(r) { return r.join(","); })).join("\n"), "critical_items_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv");
  };

  var exportCriticalPDF = function() {
    var th = ["Item", "Desc", "Customer", "Status", "On Hand", "Short", "WOs", "Unlocked"].map(function(hd) { return "<th>" + hd + "</th>"; }).join("");
    var tb = criticalItems.map(function(i) {
      return "<tr><td>" + i.sku + "</td><td>" + (i.desc || "--") + "</td><td>" + (i.customerLabel || "--") + "</td><td class=\"" + (i.isZeroStock ? "zero" : "low") + "\">" + (i.isZeroStock ? "ZERO" : "LOW") + "</td><td>" + Math.round(i.onHand).toLocaleString() + "</td><td>" + Math.round(i.totalShort).toLocaleString() + "</td><td>" + i.affectedWOs.length + "</td><td>" + Math.round(i.unlockedUnits).toLocaleString() + "</td></tr>";
    }).join("");
    triggerDownload(buildExportHTML("Critical Items Report", th, tb), "critical_items_" + new Date().toISOString().slice(0, 10) + ".html", "text/html");
  };

  var renderMaterialRows = function() {
    if (criticalItems.length === 0) return <tr><td colSpan={9} style={{ padding:36, textAlign:"center", color:C.dim }}>All materials available.</td></tr>;
    var out = [];
    criticalItems.forEach(function(ci, idx) {
      var rowKey = "material-" + idx;
      var isX = expandedWO === rowKey;
      out.push(
        <tr key={"ci" + idx} onClick={function() { setExpandedWO(isX ? null : rowKey); }} style={{ cursor:"pointer", borderBottom:"1px solid " + C.border, background:isX ? C.raised : "transparent" }}
          onMouseEnter={function(e) { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={function(e) { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={tdToggle}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td title={ci.sku} style={Object.assign({}, tdM, { fontWeight:600, color:C.bright }, truncate(140))}>{truncateItem(ci.sku)}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(200))}>{ci.desc || "--"}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(220))}>{ci.customerLabel || "--"}</td>
          <td style={tdN}><Dot status={ci.isZeroStock ? "blocked" : "partial"} /></td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:ci.isZeroStock ? C.bad : C.warn })}>{Math.round(ci.onHand).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.bad })}>{Math.round(ci.totalShort).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", color:C.bright })}>{ci.affectedWOs.length}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.ok })}>{Math.round(ci.unlockedUnits).toLocaleString()}</td>
        </tr>
      );
      if (isX) {
        out.push(
          <tr key={"cd" + idx}><td colSpan={9} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:10, textTransform:"uppercase", letterSpacing:0.8 }}>Affected Work Orders</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>{["WO#", "Product", "Customer", "WO Qty", "Needed", "Short", "Due"].map(function(h) { return <th key={h} style={thDS}>{h}</th>; })}</tr></thead>
              <tbody>
                {ci.affectedWOs.map(function(wo, wi) {
                  return <tr key={wi} style={{ borderBottom:"1px solid " + C.border }}>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
                    <td style={tdDM}>{wo.productSku}</td>
                    <td style={Object.assign({}, tdDN, { color:C.dim })}>{wo.customer || "--"}</td>
                    <td style={Object.assign({}, tdDM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
                    <td style={tdDM}>{Math.round(wo.needed).toLocaleString()}</td>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bad })}>{Math.round(wo.short).toLocaleString()}</td>
                    <td style={tdDM}>{fmtDate(wo.dueDate)}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </td></tr>
        );
      }
    });
    return out;
  };

  var renderCoverageRows = function() {
    if (!coverageItems.length) return <tr><td colSpan={10} style={{ padding:36, textAlign:"center", color:C.dim }}>No inbound coverage rows match the filters.</td></tr>;
    var out = [];
    coverageItems.forEach(function(ci, idx) {
      var rowKey = "coverage-" + idx;
      var isX = expandedWO === rowKey;
      var riskColor = ci.riskLevel === "high" ? C.bad : ci.riskLevel === "medium" ? C.warn : C.ok;
      var statusText = ci.status === "missing" ? "Missing" : ci.status === "unscheduled" ? "Unscheduled" : ci.status === "partial" ? "Partial" : "Covered";
      out.push(
        <tr key={"cov" + idx} onClick={function() { setExpandedWO(isX ? null : rowKey); }} style={{ cursor:"pointer", borderBottom:"1px solid " + C.border, background:isX ? C.raised : "transparent" }}
          onMouseEnter={function(e) { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={function(e) { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={tdToggle}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td title={ci.sku} style={Object.assign({}, tdM, { fontWeight:600, color:C.bright }, truncate(140))}>{truncateItem(ci.sku)}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(220))}>{ci.customerLabel || "--"}</td>
          <td style={Object.assign({}, tdN, { color:riskColor, fontWeight:600 })}>{ci.riskLevel === "high" ? "High" : ci.riskLevel === "medium" ? "Medium" : "Low"}</td>
          <td style={Object.assign({}, tdN, { color:C.dim })}>{statusText}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.bad })}>{Math.round(ci.shortQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.accent })}>{Math.round(ci.scheduledQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", color:C.dim })}>{Math.round(ci.inboundQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:(ci.scheduledCoveragePct || 0) >= 100 ? C.ok : (ci.scheduledCoveragePct || 0) >= 50 ? C.warn : C.bad })}>
            {(ci.scheduledCoveragePct || 0)}% / {(ci.coveragePct || 0)}%
          </td>
          <td style={Object.assign({}, tdM, { color:ci.dueBeforeScheduled ? C.bad : C.dim })}>{fmtDate(ci.earliestDueDate)}</td>
        </tr>
      );
      if (isX) {
        out.push(
          <tr key={"covd" + idx}><td colSpan={10} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginTop:10, marginBottom:8, fontSize:12 }}>
              <span style={{ color:C.dim }}>Earliest Inbound: <span style={{ color:C.bright, fontFamily:"monospace" }}>{fmtDate(ci.earliestInboundDate)}</span></span>
              <span style={{ color:C.dim }}>Earliest Scheduled: <span style={{ color:C.bright, fontFamily:"monospace" }}>{fmtDate(ci.earliestScheduledDate)}</span></span>
              <span style={{ color:C.dim }}>POs: <span style={{ color:C.bright }}>{(ci.openPOs || []).length ? ci.openPOs.join(", ") : "--"}</span></span>
            </div>
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, textTransform:"uppercase", letterSpacing:0.8 }}>Affected Work Orders</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>{["WO#", "Product", "Customer", "WO Qty", "Needed", "Short", "Due"].map(function(h) { return <th key={h} style={thDS}>{h}</th>; })}</tr></thead>
              <tbody>
                {(ci.affectedWOs || []).map(function(wo, wi) {
                  return <tr key={wi} style={{ borderBottom:"1px solid " + C.border }}>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
                    <td style={tdDM}>{wo.productSku}</td>
                    <td style={Object.assign({}, tdDN, { color:C.dim })}>{wo.customer || "--"}</td>
                    <td style={Object.assign({}, tdDM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
                    <td style={tdDM}>{Math.round(wo.needed).toLocaleString()}</td>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bad })}>{Math.round(wo.short).toLocaleString()}</td>
                    <td style={tdDM}>{fmtDate(wo.dueDate)}</td>
                  </tr>;
                })}
                {(!ci.affectedWOs || !ci.affectedWOs.length) && (
                  <tr><td colSpan={7} style={{ padding:"10px 8px", color:C.dim, fontSize:12 }}>No linked work orders found.</td></tr>
                )}
              </tbody>
            </table>
          </td></tr>
        );
      }
    });
    return out;
  };

  var coverageSummary = inboundCoverage ? inboundCoverage.summary : null;
  var hasActiveFilters = !!ciSearch || ciCustomerFilter !== "all" || (ciMode === "material" ? ciStockFilter !== "all" : (covStatusFilter !== "all" || covRiskFilter !== "all"));

  return (<div>
    <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
      <button onClick={function() { setCiMode("material"); }} style={pill(ciMode === "material")}>Material Risk</button>
      <button onClick={function() { setCiMode("coverage"); }} style={pill(ciMode === "coverage")}>Inbound Coverage</button>
      <input type="text" placeholder={ciMode === "coverage" ? "Search SKU, customer, PO..." : "Search..."} value={ciSearch} onChange={function(e) { setCiSearch(e.target.value); }} style={Object.assign({}, inp, { width:220 })} />
      <select value={ciCustomerFilter} onChange={function(e) { setCiCustomerFilter(e.target.value); }} style={Object.assign({}, sel, { fontSize:13 })}>
        <option value="all">All Customers</option>
        {customerOptions.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
      </select>

      {ciMode === "material" ? (
        <>
          {[{ key:"all", label:"All Stock" }, { key:"zero", label:"Zero Stock" }, { key:"low", label:"Low Stock" }].map(function(f) {
            return <button key={f.key} onClick={function() { setCiStockFilter(f.key); }} style={pill(ciStockFilter === f.key)}>{f.label}</button>;
          })}
          <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{criticalItems.filter(function(i) { return i.isZeroStock; }).length}</span> zero | <span style={{ color:C.warn, fontWeight:600 }}>{criticalItems.filter(function(i) { return !i.isZeroStock; }).length}</span> low</span>
        </>
      ) : (
        <>
          {[{ key:"all", label:"All" }, { key:"at-risk", label:"At Risk" }, { key:"missing", label:"Missing" }, { key:"unscheduled", label:"Unscheduled" }, { key:"partial", label:"Partial" }, { key:"covered", label:"Covered" }].map(function(f) {
            return <button key={f.key} onClick={function() { setCovStatusFilter(f.key); }} style={pill(covStatusFilter === f.key)}>{f.label}</button>;
          })}
          {[{ key:"all", label:"All Risk" }, { key:"high", label:"High Risk" }, { key:"medium", label:"Medium Risk" }, { key:"low", label:"Low Risk" }].map(function(f) {
            return <button key={f.key} onClick={function() { setCovRiskFilter(f.key); }} style={pill(covRiskFilter === f.key)}>{f.label}</button>;
          })}
          {coverageSummary && <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{coverageSummary.atRisk}</span> at risk | <span style={{ color:C.ok, fontWeight:600 }}>{coverageSummary.covered}</span> covered</span>}
        </>
      )}

      <div style={{ flex:1 }} />
      {hasActiveFilters && (
        <button onClick={function() { setCiSearch(""); setCiCustomerFilter("all"); setCiStockFilter("all"); setCovStatusFilter("all"); setCovRiskFilter("all"); }} style={Object.assign({}, pill(false), { fontSize:13, color:C.bad, borderColor:C.badLine })}>Clear Filters</button>
      )}
      <button onClick={exportCriticalCSV} style={Object.assign({}, pill(false), { fontSize:13 })}>CSV</button>
      {ciMode === "material" && <button onClick={exportCriticalPDF} style={Object.assign({}, pill(false), { fontSize:13 })}>PDF</button>}
    </div>

    <div style={{ background:C.surface, border:"1px solid " + C.border, borderRadius:8, overflow:"hidden" }}>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <th style={{ width:24, padding:"0 8px", borderBottom:"1px solid " + C.border }} />
            {ciMode === "material" ? (
              [{ f:"sku", l:"Item" }, { f:"desc", l:"Description" }, { f:"customer", l:"Customer" }, { f:"status", l:"Status" }, { f:"onHand", l:"On Hand" }, { f:"totalShort", l:"Short" }, { f:"affectedWOs", l:"WOs" }, { f:"unlockedUnits", l:"Units Unlocked" }].map(function(col) {
                return <th key={col.f} onClick={function() { handleCiSort(col.f); }} style={Object.assign({}, thC(ciSort===col.f), { textAlign:col.f==="sku"||col.f==="desc"||col.f==="customer"?"left":"right" })}>{col.l}{ciSort===col.f ? (ciSortDir==="asc" ? " \u2191" : " \u2193") : ""}</th>;
              })
            ) : (
              [{ f:"sku", l:"Item" }, { f:"customer", l:"Customer" }, { f:"risk", l:"Risk" }, { f:"status", l:"Status" }, { f:"shortQty", l:"Short" }, { f:"scheduledQty", l:"Scheduled" }, { f:"inboundQty", l:"Inbound" }, { f:"coverage", l:"Coverage" }, { f:"dueDate", l:"Earliest Due" }].map(function(col) {
                return <th key={col.f} onClick={function() { handleCovSort(col.f); }} style={Object.assign({}, thC(covSort===col.f), { textAlign:col.f==="sku"||col.f==="customer"||col.f==="risk"||col.f==="status"?"left":"right" })}>{col.l}{covSort===col.f ? (covSortDir==="asc" ? " \u2191" : " \u2193") : ""}</th>;
              })
            )}
          </tr></thead>
          <tbody>{ciMode === "material" ? renderMaterialRows() : renderCoverageRows()}</tbody>
        </table>
      </div>
    </div>

    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>
      {ciMode === "material"
        ? (criticalItems.length + " critical items")
        : (coverageItems.length + " inbound coverage rows" + (inboundCoverage ? (" · horizon " + inboundCoverage.horizonDays + "d") : ""))}
    </div>
  </div>);
}
