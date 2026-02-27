import { useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { formatDescriptionForDisplay } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Card } from "../components/ui/card";
import TableShell from "../components/ui/table-shell";

function fmtDateShort(v) {
  if (!v) return "--";
  var d = new Date(String(v) + "T12:00:00");
  if (isNaN(d)) return String(v);
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

export default function TimelineView({ timelineData, deliveriesV2 }) {
  const { C, mono } = useTheme();
  const { thC, tdN, tdM } = useStyles();
  const styles = {
    emptyTitle: { fontSize: 16, fontWeight: 700, color: C.bright, marginBottom: 6 },
    emptyBody: { fontSize: 13, color: C.dim, lineHeight: 1.5 },
    staleBanner: { marginBottom: 12, fontSize: 12, color: C.warn, background: C.warnSoft, border: "1px solid " + C.warnLine, borderRadius: 8, padding: "8px 10px" },
    statsWrap: { display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap" },
    statValue: function(color) { return { fontSize: 24, fontWeight: 700, fontFamily: mono, color: color, lineHeight: 1 }; },
    statLabel: { fontSize: 13, color: C.dim, marginTop: 3 },
    sectionTitle: { fontSize: 14, fontWeight: 700, color: C.bright, marginRight: 8 },
    tableWrap: { overflowX: "auto" },
    table: { width: "100%", borderCollapse: "collapse" },
    tableHeadRow: { background: C.raised },
    row: function(isOpen) { return { borderBottom: "1px solid " + C.border, background: isOpen ? C.raised : "transparent", cursor: "pointer" }; },
    badge: function(style) { return { display: "inline-block", padding: "2px 7px", borderRadius: 999, fontSize: 11, color: style.color, background: style.bg, border: "1px solid " + style.bd }; },
    detailCell: { padding: "10px 12px", borderBottom: "1px solid " + C.border, background: C.surface },
    detailText: { fontSize: 12, color: C.dim },
    detailTitle: { fontSize: 12, fontWeight: 700, color: C.dim, marginBottom: 6 },
    miniTableHead: { padding: "6px 8px", textAlign: "left", fontSize: 11, color: C.dim, borderBottom: "1px solid " + C.border },
    miniTableRow: { borderBottom: "1px solid " + C.border },
    miniCellSku: { padding: "6px 8px", fontFamily: mono, fontSize: 12, color: C.bright },
    miniCellDim: { padding: "6px 8px", fontSize: 12, color: C.dim },
    miniCellBright: { padding: "6px 8px", fontSize: 12, color: C.bright },
    miniBadge: function(style) { return { display: "inline-block", padding: "1px 6px", borderRadius: 999, fontSize: 10, color: style.color, background: style.bg, border: "1px solid " + style.bd }; },
    noRowsCell: { padding: 24, textAlign: "center", color: C.dim },
  };
  var toneChipStyle = function(tone) {
    return {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      fontWeight: 600,
      color: tone.fg,
      background: tone.bg,
      border: "1px solid " + tone.bd,
      borderRadius: 999,
      padding: "4px 10px",
    };
  };

  const [windowDays, setWindowDays] = useState(14);
  const [search, setSearch] = useState("");
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [expanded, setExpanded] = useState("");

  var windowOptions = [
    { key: 1, label: "Today" },
    { key: 7, label: "7d" },
    { key: 14, label: "14d" },
    { key: 30, label: "30d" },
  ];

  if (!timelineData || !deliveriesV2) {
    return (
      <Card className="px-[18px] py-5">
        <div style={styles.emptyTitle}>Deliveries</div>
        <div style={styles.emptyBody}>
          No delivery data loaded yet. Sync OpenDock to see scheduled inbounds.
        </div>
      </Card>
    );
  }

  var freshness = deliveriesV2.freshness || { edr: { level: "missing", ageDays: null }, openDock: { level: "missing", ageDays: null }, confidence: { score: 0, label: "Low" } };
  var summary = deliveriesV2.summary || { openDockScheduled: 0, materialResolved: 0, materialUnknown: 0, atRiskWOsWaiting: 0, unitsPotentiallyUnlocked: 0 };
  var loads = deliveriesV2.loads || [];
  var today = timelineData.today || new Date().toISOString().slice(0, 10);
  var endDate = new Date(today + "T00:00:00");
  endDate.setDate(endDate.getDate() + Math.max(0, windowDays - 1));
  var endDateStr = endDate.toISOString().slice(0, 10);
  var isEdrStale = freshness.edr.level === "stale" || freshness.edr.level === "missing";

  var toneByLevel = function(level) {
    if (level === "fresh") return { fg: C.ok, bg: C.okSoft, bd: C.okLine, label: "Fresh" };
    if (level === "aging") return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine, label: "Aging" };
    if (level === "stale") return { fg: C.bad, bg: C.badSoft, bd: C.badLine, label: "Stale" };
    return { fg: C.dim, bg: C.raised, bd: C.border, label: "Missing" };
  };
  var dockTone = toneByLevel(freshness.openDock.level);
  var edrTone = toneByLevel(freshness.edr.level);

  var filteredLoads = useMemo(function() {
    var rows = loads.filter(function(l) {
      var d = l.scheduledDate || l.expectedDate || "";
      return d >= today && d <= endDateStr;
    });
    if (atRiskOnly) rows = rows.filter(function(r) { return (r.linkedWOCount || 0) > 0; });
    if (search) {
      var q = search.toLowerCase();
      rows = rows.filter(function(r) {
        return (
          (r.po || "").toLowerCase().includes(q) ||
          (r.confirmation || "").toLowerCase().includes(q) ||
          (r.status || "").toLowerCase().includes(q) ||
          (r.materials || []).some(function(m) {
            return (
              (m.materialSku || "").toLowerCase().includes(q) ||
              (m.materialDesc || "").toLowerCase().includes(q)
            );
          })
        );
      });
    }
    return rows;
  }, [loads, today, endDateStr, atRiskOnly, search]);

  var matchLabel = function(state) {
    if (state === "matched-fresh") return "Matched (fresh EDR)";
    if (state === "matched-aging") return "Matched (aging EDR)";
    if (state === "matched-stale") return "Matched (stale EDR)";
    return "OpenDock only";
  };

  var matchStyle = function(state) {
    if (state === "matched-fresh") return { color: C.ok, bg: C.okSoft, bd: C.okLine };
    if (state === "matched-aging" || state === "matched-stale") return { color: C.warn, bg: C.warnSoft, bd: C.warnLine };
    return { color: C.dim, bg: C.raised, bd: C.border };
  };

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-[rgb(var(--muted))]">Window</span>
        {windowOptions.map(function(opt) {
          return <Button key={opt.key} onClick={function() { setWindowDays(opt.key); }} variant={windowDays === opt.key ? "active" : "outline"} size="default">{opt.label}</Button>;
        })}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <span style={toneChipStyle(dockTone)}>
          OpenDock {dockTone.label}
          <span className="font-mono">{freshness.openDock.ageDays == null ? "--" : (freshness.openDock.ageDays + "d")}</span>
        </span>
        <span style={toneChipStyle(edrTone)}>
          EDR {edrTone.label}
          <span className="font-mono">{freshness.edr.ageDays == null ? "--" : (freshness.edr.ageDays + "d")}</span>
        </span>
        <span style={toneChipStyle({ fg: C.accent, bg: C.accentSoft, bd: C.accentLine })}>
          Coverage Confidence <span className="font-mono">{freshness.confidence.label} ({freshness.confidence.score})</span>
        </span>
      </div>

      {isEdrStale && <div style={styles.staleBanner}>
        EDR is stale. This board prioritizes OpenDock schedule truth; material impact details may be limited.
      </div>}

      <div style={styles.statsWrap}>
        {[{ l: "Scheduled Loads", v: summary.openDockScheduled, c: C.accent }, { l: "Material Resolved", v: summary.materialResolved, c: C.ok }, { l: "Material Unknown", v: summary.materialUnknown, c: C.warn }, { l: "At-Risk WOs Waiting", v: summary.atRiskWOsWaiting, c: C.bad }, { l: "Potential Units Unlocked", v: (summary.unitsPotentiallyUnlocked || 0).toLocaleString(), c: C.bright }].map(function(s, i) {
          return <div key={i}><div style={styles.statValue(s.c)}>{s.v}</div><div style={styles.statLabel}>{s.l}</div></div>;
        })}
      </div>

      <TableShell>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2.5">
          <div style={styles.sectionTitle}>Loads (OpenDock-first)</div>
          <Input value={search} onChange={function(e) { setSearch(e.target.value); }} placeholder="Search PO, confirmation, material..." className="h-10 w-72 text-sm" />
          <Button onClick={function() { setAtRiskOnly(function(v) { return !v; }); }} variant={atRiskOnly ? "active" : "outline"} size="default">{atRiskOnly ? "At-Risk WO" : "All Loads"}</Button>
          <Badge variant="secondary">{filteredLoads.length} loads</Badge>
        </div>

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr style={styles.tableHeadRow}>
              {["", "Scheduled", "Expected", "PO", "Confirmation", "Status", "Materials", "Qty", "Linked WOs", "Units Unlocked", "Match"].map(function(h) { return <th key={h} style={thC(false)}>{h}</th>; })}
            </tr></thead>
            <tbody>
              {filteredLoads.map(function(r, i) {
                var isOpen = expanded === r.key;
                var mStyle = matchStyle(r.matchState);
                var materials = Array.isArray(r.materials) ? r.materials : [];
                return [
                  <tr key={(r.key || i) + "-main"} style={styles.row(isOpen)} onClick={function() { setExpanded(isOpen ? "" : r.key); }}>
                    <td style={tdM}>{isOpen ? "▾" : "▸"}</td>
                    <td style={tdM}>{fmtDateShort(r.scheduledDate)}</td>
                    <td style={tdM}>{fmtDateShort(r.expectedDate)}</td>
                    <td style={Object.assign({}, tdN, { maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{r.po || "--"}</td>
                    <td style={Object.assign({}, tdN, { maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{r.confirmation || "--"}</td>
                    <td style={tdN}>{r.status || "--"}</td>
                    <td style={tdM}>{r.materialLineCount || 0}</td>
                    <td style={tdM}>{Math.round(r.totalQty || 0).toLocaleString()}</td>
                    <td style={tdM}>{r.linkedWOCount || 0}</td>
                    <td style={Object.assign({}, tdM, { color: (r.unitsUnlocked || 0) > 0 ? C.accent : C.dim, fontWeight: 600 })}>{Math.round(r.unitsUnlocked || 0).toLocaleString()}</td>
                    <td style={tdN}>
                      <span style={styles.badge(mStyle)}>
                        {matchLabel(r.matchState)}
                      </span>
                    </td>
                  </tr>,
                  isOpen ? <tr key={(r.key || i) + "-detail"}>
                    <td colSpan={11} style={styles.detailCell}>
                      {isEdrStale ? (
                        <div style={styles.detailText}>
                          Material details unavailable due to stale/missing EDR. Use PO and Confirmation to reconcile in OpenDock.
                        </div>
                      ) : (
                        <div>
                          <div style={styles.detailTitle}>Material Lines</div>
                          <table style={styles.table}>
                            <thead><tr>
                              {["Material", "Description", "Expected", "Qty", "Linked WOs", "Units Unlocked", "Match"].map(function(h) {
                                return <th key={h} style={styles.miniTableHead}>{h}</th>;
                              })}
                            </tr></thead>
                            <tbody>
                              {materials.length ? materials.map(function(m, mi) {
                                var ms = matchStyle(m.matchState);
                                return <tr key={mi} style={styles.miniTableRow}>
                                  <td style={styles.miniCellSku}>{m.materialSku || "Unknown"}</td>
                                  <td style={styles.miniCellDim}>{formatDescriptionForDisplay(m.materialDesc) || "--"}</td>
                                  <td style={styles.miniCellDim}>{fmtDateShort(m.expectedDate)}</td>
                                  <td style={styles.miniCellBright}>{Math.round(m.qty || 0).toLocaleString()}</td>
                                  <td style={styles.miniCellDim}>{m.linkedWOCount || 0}</td>
                                  <td style={styles.miniCellDim}>{Math.round(m.unitsUnlocked || 0).toLocaleString()}</td>
                                  <td style={styles.miniCellDim}>
                                    <span style={styles.miniBadge(ms)}>
                                      {matchLabel(m.matchState)}
                                    </span>
                                  </td>
                                </tr>;
                              }) : <tr><td colSpan={7} style={styles.miniCellDim}>No material lines for this load.</td></tr>}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr> : null
                ];
              })}
              {!filteredLoads.length && <tr><td colSpan={11} style={styles.noRowsCell}>No loads match current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </TableShell>
    </div>
  );
}
