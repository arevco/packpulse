import { useState, useMemo } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, buildExportHTML, normalizeStr, formatDescriptionForDisplay } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

function statusLabel(s) {
  if (s === "missing") return "No Inbound Found";
  if (s === "unscheduled") return "Inbound Found, Not Scheduled";
  if (s === "partial") return "Partially Covered";
  if (s === "covered") return "Fully Covered";
  return s || "--";
}

export default function CriticalItemsView({ rawCriticalItems, inboundCoverage }) {
  const { C, mono } = useTheme();
  const { thC, tdN, tdM, tdToggle, thDS, tdDN, tdDM, truncate } = useStyles();

  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortField, setSortField] = useState("uncoveredQty");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);

  const ITEM_TRUNCATE_LEN = 14;
  var truncateItem = function(v) {
    var s = String(v || "");
    return s.length > ITEM_TRUNCATE_LEN ? (s.slice(0, ITEM_TRUNCATE_LEN) + "...") : s;
  };

  var customerOptions = useMemo(function() {
    var set = new Set();
    (rawCriticalItems || []).forEach(function(item) {
      (item.customers || []).forEach(function(c) { if (c) set.add(c); });
    });
    return Array.from(set).sort();
  }, [rawCriticalItems]);

  var consolidatedItems = useMemo(function() {
    var baseBySku = {};
    (rawCriticalItems || []).forEach(function(item) {
      var key = normalizeStr(item.sku);
      baseBySku[key] = {
        sku: item.sku,
        desc: item.desc || "",
        customerLabel: item.customerLabel || "--",
        customers: item.customers || [],
        onHand: item.onHand || 0,
        shortQty: Math.max(0, item.totalShort || 0),
        affectedWOs: item.affectedWOs || [],
        unlockedUnits: item.unlockedUnits || 0,
        isZeroStock: !!item.isZeroStock
      };
    });

    var rows = (inboundCoverage && inboundCoverage.rows && inboundCoverage.rows.length)
      ? inboundCoverage.rows.map(function(row) {
        var key = normalizeStr(row.sku);
        var base = baseBySku[key] || {
          sku: row.sku,
          desc: row.desc || "",
          customerLabel: row.customerLabel || "--",
          customers: String(row.customerLabel || "").split(",").map(function(v) { return v.trim(); }).filter(Boolean),
          onHand: 0,
          shortQty: Math.max(0, row.shortQty || 0),
          affectedWOs: [],
          unlockedUnits: 0,
          isZeroStock: false
        };
        return {
          sku: row.sku || base.sku,
          desc: row.desc || base.desc || "",
          customerLabel: row.customerLabel || base.customerLabel || "--",
          customers: base.customers || [],
          onHand: base.onHand || 0,
          shortQty: Math.max(0, row.shortQty || base.shortQty || 0),
          scheduledQty: Math.max(0, row.scheduledQty || 0),
          inboundQty: Math.max(0, row.inboundQty || 0),
          uncoveredQty: Math.max(0, row.uncoveredQty != null ? row.uncoveredQty : (row.shortQty || 0) - (row.scheduledQty || 0)),
          scheduledCoveragePct: Math.max(0, row.scheduledCoveragePct || 0),
          coveragePct: Math.max(0, row.coveragePct || 0),
          riskLevel: row.riskLevel || "high",
          status: row.status || "missing",
          recommendedAction: row.recommendedAction || "Monitor",
          earliestDueDate: row.earliestDueDate || "",
          earliestInboundDate: row.earliestInboundDate || "",
          earliestScheduledDate: row.earliestScheduledDate || "",
          dueBeforeScheduled: !!row.dueBeforeScheduled,
          openPOs: row.openPOs || [],
          affectedWOs: base.affectedWOs || [],
          unlockedUnits: base.unlockedUnits || 0,
          isZeroStock: !!base.isZeroStock
        };
      })
      : Object.values(baseBySku).map(function(base) {
        return {
          sku: base.sku,
          desc: base.desc,
          customerLabel: base.customerLabel,
          customers: base.customers,
          onHand: base.onHand,
          shortQty: base.shortQty,
          scheduledQty: 0,
          inboundQty: 0,
          uncoveredQty: base.shortQty,
          scheduledCoveragePct: 0,
          coveragePct: 0,
          riskLevel: "high",
          status: "missing",
          recommendedAction: "Create / Expedite PO",
          earliestDueDate: "",
          earliestInboundDate: "",
          earliestScheduledDate: "",
          dueBeforeScheduled: false,
          openPOs: [],
          affectedWOs: base.affectedWOs,
          unlockedUnits: base.unlockedUnits,
          isZeroStock: base.isZeroStock
        };
      });

    if (search) {
      var q = search.toLowerCase();
      rows = rows.filter(function(r) {
        return (
          (r.sku || "").toLowerCase().includes(q) ||
          (r.desc || "").toLowerCase().includes(q) ||
          (r.customerLabel || "").toLowerCase().includes(q) ||
          (r.recommendedAction || "").toLowerCase().includes(q) ||
          (r.openPOs || []).join(",").toLowerCase().includes(q)
        );
      });
    }
    if (customerFilter !== "all") {
      rows = rows.filter(function(r) {
        return String(r.customerLabel || "").split(",").map(function(v) { return v.trim(); }).includes(customerFilter);
      });
    }
    if (statusFilter !== "all") rows = rows.filter(function(r) { return r.status === statusFilter; });

    rows.sort(function(a, b) {
      var c = 0;
      if (sortField === "sku") c = (a.sku || "").localeCompare(b.sku || "");
      else if (sortField === "desc") c = (a.desc || "").localeCompare(b.desc || "");
      else if (sortField === "customer") c = (a.customerLabel || "").localeCompare(b.customerLabel || "");
      else if (sortField === "onHand") c = (a.onHand || 0) - (b.onHand || 0);
      else if (sortField === "shortQty") c = (a.shortQty || 0) - (b.shortQty || 0);
      else if (sortField === "scheduledQty") c = (a.scheduledQty || 0) - (b.scheduledQty || 0);
      else if (sortField === "uncoveredQty") c = (a.uncoveredQty || 0) - (b.uncoveredQty || 0);
      else if (sortField === "coverage") c = (a.scheduledCoveragePct || 0) - (b.scheduledCoveragePct || 0);
      else if (sortField === "risk") c = (a.riskLevel || "").localeCompare(b.riskLevel || "");
      else if (sortField === "action") c = (a.recommendedAction || "").localeCompare(b.recommendedAction || "");
      else if (sortField === "dueDate") c = (a.earliestDueDate || "").localeCompare(b.earliestDueDate || "");
      return sortDir === "desc" ? -c : c;
    });
    return rows;
  }, [rawCriticalItems, inboundCoverage, search, customerFilter, statusFilter, sortField, sortDir]);

  var handleSort = function(field) {
    if (sortField === field) setSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortField(field); setSortDir("desc"); }
  };

  var hasActiveFilters = !!search || customerFilter !== "all" || statusFilter !== "all";

  var exportCSV = function() {
    var h = ["Item Code", "Description", "Customer", "On Hand", "Short Qty", "Scheduled Qty", "Uncovered Qty", "Inbound Qty", "Coverage %", "Risk", "Action", "Earliest Due", "POs"];
    var rows = consolidatedItems.map(function(i) {
      return [
        i.sku,
        '"' + (i.desc || "").replace(/"/g, '""') + '"',
        '"' + (i.customerLabel || "--").replace(/"/g, '""') + '"',
        Math.round(i.onHand || 0),
        Math.round(i.shortQty || 0),
        Math.round(i.scheduledQty || 0),
        Math.round(i.uncoveredQty || 0),
        Math.round(i.inboundQty || 0),
        (i.scheduledCoveragePct || 0) + "%",
        i.riskLevel || "",
        '"' + (i.recommendedAction || "").replace(/"/g, '""') + '"',
        i.earliestDueDate || "",
        '"' + ((i.openPOs || []).join(", ")).replace(/"/g, '""') + '"'
      ];
    });
    triggerDownload([h.join(",")].concat(rows.map(function(r) { return r.join(","); })).join("\n"), "critical_materials_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv");
  };

  var exportPDF = function() {
    var th = ["Item", "Desc", "Customer", "Short", "Scheduled", "Uncovered", "Coverage", "Risk", "Action", "Due"].map(function(hd) { return "<th>" + hd + "</th>"; }).join("");
    var tb = consolidatedItems.map(function(i) {
      return "<tr><td>" + i.sku + "</td><td>" + (i.desc || "--") + "</td><td>" + (i.customerLabel || "--") + "</td><td>" + Math.round(i.shortQty || 0).toLocaleString() + "</td><td>" + Math.round(i.scheduledQty || 0).toLocaleString() + "</td><td>" + Math.round(i.uncoveredQty || 0).toLocaleString() + "</td><td>" + (i.scheduledCoveragePct || 0) + "%</td><td>" + (i.riskLevel || "") + "</td><td>" + (i.recommendedAction || "") + "</td><td>" + fmtDate(i.earliestDueDate) + "</td></tr>";
    }).join("");
    triggerDownload(buildExportHTML("Critical Materials Report", th, tb), "critical_materials_" + new Date().toISOString().slice(0, 10) + ".html", "text/html");
  };

  var riskColor = function(level) {
    if (level === "high") return C.bad;
    if (level === "medium") return C.warn;
    return C.ok;
  };

  var renderRows = function() {
    if (!consolidatedItems.length) return <tr><td colSpan={12} style={{ padding:36, textAlign:"center", color:C.dim }}>No critical materials match current filters.</td></tr>;
    var out = [];
    consolidatedItems.forEach(function(ci, idx) {
      var rowKey = "cm-" + idx;
      var isX = expanded === rowKey;
      out.push(
        <tr key={rowKey} onClick={function() { setExpanded(isX ? null : rowKey); }} style={{ cursor:"pointer", borderBottom:"1px solid " + C.border, background:isX ? C.raised : "transparent" }}
          onMouseEnter={function(e) { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={function(e) { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={tdToggle}>{isX ? "\u25BE" : "\u25B8"}</td>
          <td title={ci.sku} style={Object.assign({}, tdM, { fontWeight:600, color:C.bright }, truncate(140))}>{truncateItem(ci.sku)}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(220))}>{formatDescriptionForDisplay(ci.desc) || "--"}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(220))}>{ci.customerLabel || "--"}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:ci.isZeroStock ? C.bad : C.warn })}>{Math.round(ci.onHand || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:C.bad })}>{Math.round(ci.shortQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", color:C.accent })}>{Math.round(ci.scheduledQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:700, color:(ci.uncoveredQty || 0) > 0 ? C.bad : C.ok })}>{Math.round(ci.uncoveredQty || 0).toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { textAlign:"right", fontWeight:600, color:(ci.scheduledCoveragePct || 0) >= 100 ? C.ok : (ci.scheduledCoveragePct || 0) >= 50 ? C.warn : C.bad })}>{(ci.scheduledCoveragePct || 0)}%</td>
          <td style={Object.assign({}, tdN, { color:riskColor(ci.riskLevel), fontWeight:600 })}>{ci.riskLevel === "high" ? "High" : ci.riskLevel === "medium" ? "Medium" : "Low"}</td>
          <td style={Object.assign({}, tdN, { color:(ci.status === "covered" ? C.ok : ci.status === "partial" ? C.warn : C.bad), fontWeight:600 }, truncate(170))}>
            <div>{ci.recommendedAction || "Monitor"}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{statusLabel(ci.status)}</div>
          </td>
          <td style={Object.assign({}, tdM, { color:ci.dueBeforeScheduled ? C.bad : C.dim })}>{fmtDate(ci.earliestDueDate)}</td>
        </tr>
      );
      if (isX) {
        out.push(
          <tr key={rowKey + "-detail"}><td colSpan={12} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            <div style={{ display:"flex", gap:14, flexWrap:"wrap", marginTop:10, marginBottom:8, fontSize:12 }}>
              <span style={{ color:C.dim }}>Inbound Source: <span style={{ color:C.bright, fontFamily:mono }}>EDR {Math.round(ci.inboundQty || 0).toLocaleString()} | OpenDock Scheduled {Math.round(ci.scheduledQty || 0).toLocaleString()}</span></span>
              <span style={{ color:C.dim }}>Earliest Inbound: <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(ci.earliestInboundDate)}</span></span>
              <span style={{ color:C.dim }}>Earliest Scheduled: <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(ci.earliestScheduledDate)}</span></span>
              <span style={{ color:C.dim }}>POs: <span style={{ color:C.bright }}>{(ci.openPOs || []).length ? ci.openPOs.join(", ") : "--"}</span></span>
              <span style={{ color:C.dim }}>Unlocked Units: <span style={{ color:C.bright }}>{Math.round(ci.unlockedUnits || 0).toLocaleString()}</span></span>
            </div>
            <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, letterSpacing:0.1 }}>Affected Work Orders</div>
            <table style={{ width:"100%", borderCollapse:"collapse" }}>
              <thead><tr>{["WO#", "Product", "Customer", "WO Qty", "Needed", "Short", "Due"].map(function(h) { return <th key={h} style={thDS}>{h}</th>; })}</tr></thead>
              <tbody>
                {(ci.affectedWOs || []).map(function(wo, wi) {
                  return <tr key={wi} style={{ borderBottom:"1px solid " + C.border }}>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
                    <td style={tdDM}>{wo.productSku}</td>
                    <td style={Object.assign({}, tdDN, { color:C.dim })}>{wo.customer || "--"}</td>
                    <td style={Object.assign({}, tdDM, { color:C.bright })}>{(wo.qtyToProduce || 0).toLocaleString()}</td>
                    <td style={tdDM}>{Math.round(wo.needed || 0).toLocaleString()}</td>
                    <td style={Object.assign({}, tdDM, { fontWeight:600, color:C.bad })}>{Math.round(wo.short || 0).toLocaleString()}</td>
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

  var summary = useMemo(function() {
    var atRisk = consolidatedItems.filter(function(r) { return r.riskLevel !== "low"; }).length;
    var uncovered = consolidatedItems.reduce(function(s, r) { return s + (r.uncoveredQty || 0); }, 0);
    return { atRisk:atRisk, uncovered:uncovered, total:consolidatedItems.length };
  }, [consolidatedItems]);

  return (<div>
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <Input type="text" placeholder="Search SKU, customer, PO, action..." value={search} onChange={function(e) { setSearch(e.target.value); }} className="h-10 w-full text-sm sm:w-72" />
      <select value={customerFilter} onChange={function(e) { setCustomerFilter(e.target.value); }} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
        <option value="all">All Customers</option>
        {customerOptions.map(function(c) { return <option key={c} value={c}>{c}</option>; })}
      </select>
      {[{ key:"all", label:"All" }, { key:"missing", label:"No Inbound Found" }, { key:"unscheduled", label:"Inbound Not Scheduled" }, { key:"partial", label:"Partially Covered" }].map(function(f) {
        return <Button key={f.key} onClick={function() { setStatusFilter(function(curr) { return curr === f.key && f.key !== "all" ? "all" : f.key; }); }} variant={statusFilter === f.key ? "active" : "outline"} size="default">{f.label}</Button>;
      })}
      <span style={{ fontSize:13, color:C.dim }}><span style={{ color:C.bad, fontWeight:600 }}>{summary.atRisk}</span> at risk | <span style={{ color:C.bad, fontWeight:600 }}>{Math.round(summary.uncovered).toLocaleString()}</span> uncovered units</span>
      <div style={{ flex:1 }} />
      {hasActiveFilters && (
        <Button onClick={function() { setSearch(""); setCustomerFilter("all"); setStatusFilter("all"); }} variant="outline" size="default">Clear Filters</Button>
      )}
      <Button onClick={exportCSV} variant="outline" size="default">CSV</Button>
      <Button onClick={exportPDF} variant="outline" size="default">PDF</Button>
    </div>

    <TableShell>
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <th style={{ width:24, padding:"0 8px", borderBottom:"1px solid " + C.border }} />
            {[{ f:"sku", l:"Item" }, { f:"desc", l:"Description" }, { f:"customer", l:"Customer" }, { f:"onHand", l:"On Hand" }, { f:"shortQty", l:"Short" }, { f:"scheduledQty", l:"Scheduled" }, { f:"uncoveredQty", l:"Uncovered" }, { f:"coverage", l:"Coverage" }, { f:"risk", l:"Risk" }, { f:"action", l:"Action" }, { f:"dueDate", l:"Earliest Due" }].map(function(col) {
              return <th key={col.f} style={Object.assign({}, thC(sortField===col.f), { textAlign:col.f==="sku"||col.f==="desc"||col.f==="customer"||col.f==="risk"||col.f==="action"?"left":"right" })}><SortHeaderButton onClick={function() { handleSort(col.f); }} className={col.f==="sku"||col.f==="desc"||col.f==="customer"||col.f==="risk"||col.f==="action"?"text-left":"text-right"}>{col.l}{sortField===col.f ? (sortDir==="asc" ? " \u2191" : " \u2193") : ""}</SortHeaderButton></th>;
            })}
          </tr></thead>
          <tbody>{renderRows()}</tbody>
        </table>
      </div>
    </TableShell>

    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>
      {summary.total + " critical materials" + (inboundCoverage ? (" · horizon " + inboundCoverage.horizonDays + "d") : "")}
    </div>
    <div style={{ marginTop:6, fontSize:12, color:C.dim }}>
      Status guide: <strong>No Inbound Found</strong> = no EDR qty and no OpenDock scheduled qty. <strong>Inbound Not Scheduled</strong> = inbound exists but none is scheduled in OpenDock.
    </div>
  </div>);
}
