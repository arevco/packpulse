import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, formatDescriptionForDisplay, triggerDownload } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import TableShell from "../components/ui/table-shell";

function statusLabel(status) {
  if (status === "unlock-by-date") return "Unlocks by date";
  if (status === "inbound-no-date") return "Inbound, date TBD";
  if (status === "partial") return "Partially covered";
  return "Still blocked";
}

function statusTone(status, C) {
  if (status === "unlock-by-date") return { fg: C.ok, bg: C.okSoft, bd: C.okLine };
  if (status === "inbound-no-date") return { fg: C.accent, bg: C.accentSoft, bd: C.accentLine };
  if (status === "partial") return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
  return { fg: C.bad, bg: C.badSoft, bd: C.badLine };
}

function componentSummary(component) {
  var timing = component.unlockDate ? fmtDate(component.unlockDate) : component.firstInboundDate ? ("Starts " + fmtDate(component.firstInboundDate)) : "No inbound";
  return (component.sku || "--") + " " + (component.coveragePct || 0) + "% " + timing;
}

export default function UnlockTimelineView({ deliveriesV2 }) {
  const { C, mono } = useTheme();
  const { thC, tdN, tdM } = useStyles();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expanded, setExpanded] = useState("");

  var unlockTimeline = deliveriesV2 && deliveriesV2.unlockTimeline ? deliveriesV2.unlockTimeline : null;
  var rows = unlockTimeline && Array.isArray(unlockTimeline.rows) ? unlockTimeline.rows : [];
  var summary = unlockTimeline && unlockTimeline.summary ? unlockTimeline.summary : null;
  var dateBuckets = unlockTimeline && Array.isArray(unlockTimeline.dateBuckets) ? unlockTimeline.dateBuckets : [];

  var filteredRows = useMemo(function() {
    var nextRows = rows.slice();
    if (statusFilter !== "all") nextRows = nextRows.filter(function(row) { return row.status === statusFilter; });
    if (search) {
      var q = search.toLowerCase();
      nextRows = nextRows.filter(function(row) {
        return (
          String(row.woNum || "").toLowerCase().includes(q) ||
          String(row.productSku || "").toLowerCase().includes(q) ||
          String(row.productDesc || "").toLowerCase().includes(q) ||
          String(row.customer || "").toLowerCase().includes(q) ||
          (row.sourcePOs || []).join(" ").toLowerCase().includes(q) ||
          (row.components || []).some(function(component) {
            return (
              String(component.sku || "").toLowerCase().includes(q) ||
              String(component.desc || "").toLowerCase().includes(q) ||
              (component.allocations || []).some(function(allocation) {
                return String(allocation.po || "").toLowerCase().includes(q);
              })
            );
          })
        );
      });
    }
    return nextRows;
  }, [rows, statusFilter, search]);

  var exportCSV = function() {
    var escapeCsv = function(value) {
      return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
    };
    var header = [
      "Available By",
      "Work Order",
      "FG SKU",
      "Description",
      "Customer",
      "Due",
      "Runnable Now",
      "Blocked Units",
      "Status",
      "Covered Components",
      "Component Detail",
      "Source POs"
    ];
    var body = filteredRows.map(function(row) {
      var componentDetail = (row.components || []).map(function(component) {
        var poList = Array.from(new Set((component.allocations || []).map(function(allocation) { return allocation.po; }).filter(Boolean))).join(" / ");
        return [
          component.sku || "--",
          formatDescriptionForDisplay(component.desc || ""),
          "short " + Math.round(component.neededQty || 0),
          (component.coveragePct || 0) + "%",
          component.unlockDate ? fmtDate(component.unlockDate) : component.firstInboundDate ? ("starts " + fmtDate(component.firstInboundDate)) : "none",
          poList
        ].filter(Boolean).join(" | ");
      }).join("; ");
      return [
        row.unlockDate || "",
        row.woNum || "",
        row.productSku || "",
        row.productDesc || "",
        row.customer || "",
        row.dueDate || "",
        Math.round(row.runnableNow || 0),
        Math.round(row.blockedUnits || 0),
        statusLabel(row.status),
        (row.fullyCoveredComponents || 0) + "/" + (row.componentCount || 0),
        componentDetail,
        (row.sourcePOs || []).join(", ")
      ].map(escapeCsv).join(",");
    });
    triggerDownload([header.join(",")].concat(body).join("\n"), "supply_risk_unlock_timeline_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8;");
  };

  if (!unlockTimeline) {
    return (
      <Card className="px-[18px] py-5">
        <div style={{ fontSize: 16, fontWeight: 700, color: C.bright, marginBottom: 6 }}>Unlock Timeline</div>
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
          No unlock forecast is available yet. Load work orders, Receive Orders, and inventory to see when blocked work may become runnable.
        </div>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: C.ok, fontFamily: mono }}>{summary ? summary.unlocking7d.toLocaleString() : "0"}</div><div className="text-xs text-[rgb(var(--muted))]">Unlocking 7d</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: C.accent, fontFamily: mono }}>{summary ? summary.unlocking14d.toLocaleString() : "0"}</div><div className="text-xs text-[rgb(var(--muted))]">Unlocking 14d</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: C.warn, fontFamily: mono }}>{summary ? Math.round(summary.unitsUnlocking14d || 0).toLocaleString() : "0"}</div><div className="text-xs text-[rgb(var(--muted))]">Units Unlocking 14d</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: C.accent, fontFamily: mono }}>{summary ? summary.inboundNoDate.toLocaleString() : "0"}</div><div className="text-xs text-[rgb(var(--muted))]">Inbound, Date TBD</div></Card>
        <Card className="px-3 py-2.5"><div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: C.bad, fontFamily: mono }}>{summary ? summary.stillBlocked.toLocaleString() : "0"}</div><div className="text-xs text-[rgb(var(--muted))]">Still Blocked</div></Card>
      </div>

      {!!dateBuckets.length && (
        <div className="mb-3 flex flex-wrap gap-2">
          {dateBuckets.slice(0, 6).map(function(bucket) {
            return (
              <div key={bucket.date} style={{ border: "1px solid " + C.border, background: C.surface, borderRadius: 10, padding: "8px 10px", minWidth: 120 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.bright }}>{fmtDate(bucket.date)}</div>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{bucket.workOrders} WOs · {bucket.skuCount} SKUs</div>
                <div style={{ fontSize: 11, color: C.dim }}>{Math.round(bucket.units || 0).toLocaleString()} units</div>
              </div>
            );
          })}
        </div>
      )}

      <TableShell>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2.5">
          <div style={{ fontSize: 14, fontWeight: 700, color: C.bright, marginRight: 8 }}>Unlock Timeline</div>
          <Input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search WO / FG SKU / material / PO" className="h-10 w-full text-sm sm:w-72" />
          <select value={statusFilter} onChange={function(e) { setStatusFilter(e.target.value); }} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
            <option value="all">All Outcomes</option>
            <option value="unlock-by-date">Unlocks by date</option>
            <option value="inbound-no-date">Inbound, date TBD</option>
            <option value="partial">Partially covered</option>
            <option value="still-blocked">Still blocked</option>
          </select>
          <Badge variant="secondary">{filteredRows.length} WOs</Badge>
          <div className="flex-1" />
          <Button onClick={exportCSV} variant="outline" size="default" disabled={!filteredRows.length}>CSV</Button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: C.raised }}>
              {["Available By", "WO", "FG SKU", "Customer", "Runnable Now", "Blocked", "Due", "Status", "Driver Materials"].map(function(label) {
                return <th key={label} style={thC(false)}>{label}</th>;
              })}
            </tr></thead>
            <tbody>
              {filteredRows.map(function(row) {
                var isOpen = expanded === row.woNum;
                var tone = statusTone(row.status, C);
                return [
                  <tr key={row.woNum + "-main"} style={{ borderBottom: "1px solid " + C.border, background: isOpen ? C.raised : "transparent", cursor: "pointer" }} onClick={function() { setExpanded(isOpen ? "" : row.woNum); }}>
                    <td style={Object.assign({}, tdM, { color: row.unlockDate ? C.bright : C.dim, fontWeight: 600 })}>{row.unlockDate ? fmtDate(row.unlockDate) : (row.earliestInboundDate ? ("TBD") : "--")}</td>
                    <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{row.woNum || "--"}</td>
                    <td style={Object.assign({}, tdN, { maxWidth: 160 })}>
                      <div style={{ fontFamily: mono, color: C.bright }}>{row.productSku || "--"}</div>
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{formatDescriptionForDisplay(row.productDesc || "") || "--"}</div>
                    </td>
                    <td style={Object.assign({}, tdN, { color: C.dim })}>{row.customer || "--"}</td>
                    <td style={tdM}>{Math.round(row.runnableNow || 0).toLocaleString()}</td>
                    <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 700 })}>{Math.round(row.blockedUnits || 0).toLocaleString()}</td>
                    <td style={tdM}>{fmtDate(row.dueDate)}</td>
                    <td style={tdN}>
                      <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 999, fontSize: 11, color: tone.fg, background: tone.bg, border: "1px solid " + tone.bd }}>
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td style={Object.assign({}, tdN, { maxWidth: 260, color: C.dim })}>
                      {(row.components || []).slice(0, 2).map(componentSummary).join(" · ") || "--"}
                      {(row.components || []).length > 2 ? " +" + ((row.components || []).length - 2) : ""}
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={row.woNum + "-detail"}>
                      <td colSpan={9} style={{ padding: "10px 12px", borderBottom: "1px solid " + C.border, background: C.surface }}>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10, fontSize: 12, color: C.dim }}>
                          <span>FG SKU: <span style={{ color: C.bright, fontFamily: mono }}>{row.productSku || "--"}</span></span>
                          <span>Blocked Units: <span style={{ color: C.bad, fontFamily: mono }}>{Math.round(row.blockedUnits || 0).toLocaleString()}</span></span>
                          <span>Runnable Now: <span style={{ color: C.bright, fontFamily: mono }}>{Math.round(row.runnableNow || 0).toLocaleString()}</span></span>
                          <span>Covered Components: <span style={{ color: C.bright, fontFamily: mono }}>{row.fullyCoveredComponents || 0}/{row.componentCount || 0}</span></span>
                          <span>POs: <span style={{ color: C.bright }}>{(row.sourcePOs || []).length ? row.sourcePOs.join(", ") : "--"}</span></span>
                        </div>

                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead><tr>
                            {["Material", "Description", "Short Qty", "Covered", "Available By", "POs"].map(function(label) {
                              return <th key={label} style={{ padding: "6px 8px", textAlign: "left", fontSize: 11, color: C.dim, borderBottom: "1px solid " + C.border }}>{label}</th>;
                            })}
                          </tr></thead>
                          <tbody>
                            {(row.components || []).map(function(component) {
                              var poList = Array.from(new Set((component.allocations || []).map(function(allocation) { return allocation.po; }).filter(Boolean)));
                              return (
                                <tr key={row.woNum + "-" + component.sku} style={{ borderBottom: "1px solid " + C.border }}>
                                  <td style={{ padding: "6px 8px", fontFamily: mono, fontSize: 12, color: C.bright }}>{component.sku || "--"}</td>
                                  <td style={{ padding: "6px 8px", fontSize: 12, color: C.dim }}>{formatDescriptionForDisplay(component.desc || "") || "--"}</td>
                                  <td style={{ padding: "6px 8px", fontSize: 12, color: C.dim }}>{Math.round(component.neededQty || 0).toLocaleString()}</td>
                                  <td style={{ padding: "6px 8px", fontSize: 12, color: component.coveragePct >= 100 ? C.ok : component.coveragePct > 0 ? C.warn : C.bad }}>{component.coveragePct || 0}%</td>
                                  <td style={{ padding: "6px 8px", fontSize: 12, color: C.dim }}>
                                    {component.unlockDate ? fmtDate(component.unlockDate) : component.firstInboundDate ? "TBD" : "--"}
                                  </td>
                                  <td style={{ padding: "6px 8px", fontSize: 12, color: C.dim }}>{poList.length ? poList.join(", ") : "--"}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ) : null
                ];
              })}
              {!filteredRows.length && <tr><td colSpan={9} style={{ padding: 24, textAlign: "center", color: C.dim }}>No work orders match the current unlock filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </TableShell>

      <div style={{ marginTop: 8, fontSize: 12, color: C.dim }}>
        Forecast logic: blocked work orders are allocated Receive Orders in due-date order by shortage component. If matched OpenDock dates exist, the later of expected delivery and dock schedule is used as the unlock date.
      </div>
    </div>
  );
}
