import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, formatDescriptionForDisplay, normalizeStr, triggerDownload } from "../utils";
import { Card } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import TableShell from "../components/ui/table-shell";
import TabsNav from "../components/ui/tabs-nav";

function safeNum(v) {
  var n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

function buildSkuMatchKeys(value) {
  var raw = (value || "").toString().trim();
  if (!raw) return [];
  var noDecimal = raw.replace(/\.0+$/, "");
  var norm = normalizeStr(noDecimal);
  if (!norm) return [];
  var keys = [norm];
  var stripped = norm.replace(/^0+/, "");
  if (stripped && stripped !== norm) keys.push(stripped);
  return Array.from(new Set(keys));
}

function classifyMaterialType(sku, desc) {
  var skuDigits = String(sku || "").replace(/\D/g, "");
  var descNorm = normalizeStr(desc || "");
  if (skuDigits.startsWith("32") || skuDigits.startsWith("33")) return "packaging";
  if (
    descNorm.includes("carrier") ||
    descNorm.includes("carton") ||
    descNorm.includes("tray") ||
    descNorm.includes("slipsheet") ||
    descNorm.includes("slip sheet") ||
    descNorm.includes("cornerboard") ||
    descNorm.includes("corner board") ||
    descNorm.includes("shrinkwrap") ||
    descNorm.includes("shrink wrap") ||
    descNorm.includes("pallet")
  ) return "packaging";
  return "wip";
}

function coverageStatusLabel(status) {
  if (status === "missing") return "No inbound";
  if (status === "unscheduled") return "Awaiting dock";
  if (status === "partial") return "Partial";
  if (status === "covered") return "Covered";
  return status || "--";
}

function coverageTone(item, C) {
  if (item.status === "missing") return { fg: C.bad, bg: C.badSoft, bd: C.badLine };
  if (item.status === "unscheduled") return { fg: C.accent, bg: C.accentSoft, bd: C.accentLine };
  if (item.status === "partial" || item.dueBeforeScheduled) return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
  return { fg: C.ok, bg: C.okSoft, bd: C.okLine };
}

function unlockTone(status, C) {
  if (status === "unlock-by-date") return { fg: C.ok, bg: C.okSoft, bd: C.okLine };
  if (status === "inbound-no-date") return { fg: C.accent, bg: C.accentSoft, bd: C.accentLine };
  if (status === "partial") return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
  return { fg: C.bad, bg: C.badSoft, bd: C.badLine };
}

function unlockStatusLabel(status) {
  if (status === "unlock-by-date") return "Unlocks by date";
  if (status === "inbound-no-date") return "Inbound, date TBD";
  if (status === "partial") return "Partially covered";
  return "Still blocked";
}

function daysUntil(value) {
  if (!value) return 999;
  var date = new Date(String(value) + "T00:00:00");
  if (isNaN(date)) return 999;
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - today.getTime()) / 86400000);
}

function addDaysIso(value, days) {
  var date = new Date(String(value) + "T00:00:00");
  if (isNaN(date)) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uniqueBy(list, getKey) {
  var seen = {};
  return (list || []).filter(function(item) {
    var key = getKey(item);
    if (!key) return false;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function sortByDateThenText(a, b, aDate, bDate, aText, bText) {
  var dateCompare = String(aDate || "9999-12-31").localeCompare(String(bDate || "9999-12-31"));
  if (dateCompare !== 0) return dateCompare;
  return String(aText || "").localeCompare(String(bText || ""));
}

function summarizeAction(item) {
  if (!item) return "";
  if (item.dueBeforeScheduled) return "Due date lands before scheduled inbound. Resequence or expedite immediately.";
  if (item.status === "missing") return "No open Receive Orders or dock coverage found. Create or expedite inbound now.";
  if (item.status === "unscheduled") return "Receive Orders exist, but OpenDock is not scheduled yet. Confirm appointments next.";
  if (item.status === "partial") return "Inbound covers only part of the shortage. Expedite the remaining gap.";
  if (item.nextUnlockDate) return "Coverage looks healthy. Blocked work should start unlocking by " + fmtDate(item.nextUnlockDate) + ".";
  if (item.unlockDateTbdCount > 0) return "Inbound is on the way, but at least one blocking component still has no firm unlock date.";
  return "Coverage is in place. Monitor timing and receiving execution.";
}

function exportQueueCsv(rows) {
  var header = [
    "Material",
    "Description",
    "Customer",
    "Type",
    "Status",
    "Action",
    "On Hand",
    "Short Qty",
    "Receive Orders Qty",
    "OpenDock Scheduled Qty",
    "Uncovered Qty",
    "Coverage %",
    "Earliest Due",
    "Earliest Receive Order",
    "Earliest OpenDock Appointment",
    "Next Unlock",
    "Affected Work Orders",
    "POs"
  ];
  var escapeCsv = function(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  };
  var body = (rows || []).map(function(row) {
    return [
      row.sku,
      row.desc,
      row.customerLabel,
      row.materialType === "packaging" ? "Packaging" : "WIP",
      coverageStatusLabel(row.status),
      summarizeAction(row),
      Math.round(row.onHand || 0),
      Math.round(row.shortQty || 0),
      Math.round(row.inboundQty || 0),
      Math.round(row.scheduledQty || 0),
      Math.round(row.uncoveredQty || 0),
      row.scheduledCoveragePct || 0,
      row.earliestDueDate || "",
      row.earliestInboundDate || "",
      row.earliestScheduledDate || "",
      row.nextUnlockDate || "",
      row.affectedWOCount || 0,
      (row.openPOs || []).join(", ")
    ].map(escapeCsv).join(",");
  });
  triggerDownload([header.join(",")].concat(body).join("\n"), "supply_risk_queue_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8;");
}

function exportInboundCsv(loads) {
  var header = ["Available", "Receive Order", "Confirmation", "Status", "Match", "Qty", "Linked WOs", "Units Unlocked"];
  var escapeCsv = function(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  };
  var body = (loads || []).map(function(load) {
    return [
      load.availableDate || "",
      load.po || "",
      load.confirmation || "",
      load.status || "",
      load.matchLabel || "",
      Math.round(load.qty || 0),
      load.linkedWOCount || 0,
      Math.round(load.unitsUnlocked || 0)
    ].map(escapeCsv).join(",");
  });
  triggerDownload([header.join(",")].concat(body).join("\n"), "supply_risk_inbound_detail_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8;");
}

function exportUnlockCsv(rows) {
  var header = ["Available By", "Work Order", "FG SKU", "Description", "Customer", "Due", "Blocked Units", "Runnable Now", "Coverage %", "Status", "POs"];
  var escapeCsv = function(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  };
  var body = (rows || []).map(function(row) {
    return [
      row.availableBy || "",
      row.woNum || "",
      row.productSku || "",
      row.productDesc || "",
      row.customer || "",
      row.dueDate || "",
      Math.round(row.blockedUnits || 0),
      Math.round(row.runnableNow || 0),
      row.coveragePct || 0,
      unlockStatusLabel(row.status),
      (row.sourcePOs || []).join(", ")
    ].map(escapeCsv).join(",");
  });
  triggerDownload([header.join(",")].concat(body).join("\n"), "supply_risk_unlock_detail_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8;");
}

function queuePriority(item) {
  var score = 0;
  var dueDays = daysUntil(item.earliestDueDate);
  if (item.status === "missing") score += 120;
  else if (item.status === "unscheduled") score += 100;
  else if (item.status === "partial") score += 90;
  else score += 20;
  if (item.dueBeforeScheduled) score += 50;
  if (dueDays <= 0) score += 50;
  else if (dueDays <= 3) score += 35;
  else if (dueDays <= 7) score += 20;
  if ((item.riskLevel || "high") === "high") score += 20;
  else if (item.riskLevel === "medium") score += 10;
  score += Math.min(40, Math.round(safeNum(item.uncoveredQty) / 5000));
  score += Math.min(20, safeNum(item.affectedWOCount || 0) * 2);
  return score;
}

function buildQueueData(rawCriticalItems, inboundCoverage, deliveriesV2) {
  var rawItems = Array.isArray(rawCriticalItems) ? rawCriticalItems : [];
  var coverageRows = inboundCoverage && Array.isArray(inboundCoverage.rows) ? inboundCoverage.rows : [];
  var loads = deliveriesV2 && Array.isArray(deliveriesV2.loads) ? deliveriesV2.loads : [];
  var unlockTimeline = deliveriesV2 && deliveriesV2.unlockTimeline ? deliveriesV2.unlockTimeline : null;
  var unlockRows = unlockTimeline && Array.isArray(unlockTimeline.rows) ? unlockTimeline.rows : [];

  var rawBySku = {};
  rawItems.forEach(function(item) {
    buildSkuMatchKeys(item && item.sku).forEach(function(key) {
      if (!rawBySku[key]) rawBySku[key] = item;
    });
  });

  var loadMap = {};
  loads.forEach(function(load) {
    (load.materials || []).forEach(function(material) {
      buildSkuMatchKeys(material && material.materialSku).forEach(function(key) {
        if (!loadMap[key]) loadMap[key] = [];
        loadMap[key].push(load);
      });
    });
  });

  var unlockMap = {};
  unlockRows.forEach(function(row) {
    (row.components || []).forEach(function(component) {
      buildSkuMatchKeys(component && component.sku).forEach(function(key) {
        if (!unlockMap[key]) unlockMap[key] = [];
        unlockMap[key].push({ row: row, component: component });
      });
      (component.optionSkus || []).forEach(function(optionSku) {
        buildSkuMatchKeys(optionSku).forEach(function(key) {
          if (!unlockMap[key]) unlockMap[key] = [];
          unlockMap[key].push({ row: row, component: component });
        });
      });
    });
  });

  var baseRows = coverageRows.length
    ? coverageRows.map(function(row) {
      var raw = rawBySku[buildSkuMatchKeys(row.sku)[0]] || {};
      return {
        sku: row.sku || raw.sku || "",
        desc: row.desc || raw.desc || "",
        customerLabel: row.customerLabel || raw.customerLabel || "--",
        customers: raw.customers || [],
        onHand: safeNum(raw.onHand),
        shortQty: Math.max(0, safeNum(row.shortQty != null ? row.shortQty : raw.totalShort)),
        inboundQty: Math.max(0, safeNum(row.inboundQty)),
        scheduledQty: Math.max(0, safeNum(row.scheduledQty)),
        uncoveredQty: Math.max(0, safeNum(row.uncoveredQty != null ? row.uncoveredQty : row.shortQty)),
        scheduledCoveragePct: Math.max(0, safeNum(row.scheduledCoveragePct)),
        coveragePct: Math.max(0, safeNum(row.coveragePct)),
        riskLevel: row.riskLevel || "high",
        status: row.status || "missing",
        recommendedAction: row.recommendedAction || "Monitor",
        earliestDueDate: row.earliestDueDate || "",
        earliestInboundDate: row.earliestInboundDate || "",
        earliestScheduledDate: row.earliestScheduledDate || "",
        dueBeforeScheduled: !!row.dueBeforeScheduled,
        openPOs: row.openPOs || [],
        affectedWOs: raw.affectedWOs || [],
        unlockedUnits: safeNum(raw.unlockedUnits),
        isZeroStock: !!raw.isZeroStock,
        materialType: classifyMaterialType(row.sku || raw.sku, row.desc || raw.desc)
      };
    })
    : rawItems.map(function(item) {
      return {
        sku: item.sku || "",
        desc: item.desc || "",
        customerLabel: item.customerLabel || "--",
        customers: item.customers || [],
        onHand: safeNum(item.onHand),
        shortQty: Math.max(0, safeNum(item.totalShort)),
        inboundQty: 0,
        scheduledQty: 0,
        uncoveredQty: Math.max(0, safeNum(item.totalShort)),
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
        affectedWOs: item.affectedWOs || [],
        unlockedUnits: safeNum(item.unlockedUnits),
        isZeroStock: !!item.isZeroStock,
        materialType: classifyMaterialType(item.sku, item.desc)
      };
    });

  return baseRows.map(function(item) {
    var skuKeys = buildSkuMatchKeys(item.sku);
    var relatedLoads = uniqueBy(skuKeys.flatMap(function(key) { return loadMap[key] || []; }), function(load) {
      return load && load.key;
    }).map(function(load) {
      var materials = (load.materials || []).filter(function(material) {
        var materialKeys = buildSkuMatchKeys(material && material.materialSku);
        return materialKeys.some(function(key) { return skuKeys.includes(key); });
      });
      var availableDate = (materials.map(function(material) { return material.expectedDate || ""; }).filter(Boolean).sort()[0]) || load.scheduledDate || load.expectedDate || "";
      var qty = materials.reduce(function(sum, material) { return sum + safeNum(material.qty); }, 0);
      var unitsUnlocked = materials.reduce(function(sum, material) { return sum + safeNum(material.unitsUnlocked); }, 0);
      var linkedWOCount = materials.reduce(function(maxCount, material) {
        return Math.max(maxCount, safeNum(material.linkedWOCount));
      }, safeNum(load.linkedWOCount));
      return {
        key: load.key,
        availableDate: availableDate,
        scheduledDate: load.scheduledDate || "",
        expectedDate: load.expectedDate || "",
        po: load.po || "",
        confirmation: load.confirmation || "",
        status: load.status || "",
        qty: Math.round(qty || safeNum(load.totalQty)),
        unitsUnlocked: Math.round(unitsUnlocked || safeNum(load.unitsUnlocked)),
        linkedWOCount: linkedWOCount,
        matchState: load.matchState,
        matchLabel: load.matchState === "receive-order-only"
          ? "Receive Orders only"
          : load.matchState === "opendock-only"
            ? "OpenDock only"
            : "Matched",
        materialCount: materials.length
      };
    }).sort(function(a, b) {
      return sortByDateThenText(a, b, a.availableDate, b.availableDate, a.po, b.po);
    });

    var relatedUnlocks = uniqueBy(skuKeys.flatMap(function(key) { return unlockMap[key] || []; }), function(entry) {
      return entry && entry.row && entry.row.woNum;
    }).map(function(entry) {
      var row = entry.row || {};
      var component = entry.component || {};
      var sourcePOs = Array.from(new Set((component.allocations || []).map(function(allocation) { return allocation.po; }).filter(Boolean)));
      return {
        woNum: row.woNum || "",
        productSku: row.productSku || "",
        productDesc: row.productDesc || "",
        customer: row.customer || "",
        dueDate: row.dueDate || "",
        blockedUnits: Math.round(safeNum(row.blockedUnits)),
        runnableNow: Math.round(safeNum(row.runnableNow)),
        status: component.state || row.status || "still-blocked",
        availableBy: component.unlockDate || row.unlockDate || "",
        earliestInboundDate: component.firstInboundDate || row.earliestInboundDate || "",
        coveragePct: Math.round(safeNum(component.coveragePct)),
        shortQty: Math.round(safeNum(component.neededQty)),
        coveredQty: Math.round(safeNum(component.coveredQty)),
        sourcePOs: sourcePOs
      };
    }).sort(function(a, b) {
      return sortByDateThenText(a, b, a.availableBy || a.earliestInboundDate, b.availableBy || b.earliestInboundDate, a.woNum, b.woNum);
    });

    var unlockDates = relatedUnlocks.map(function(row) { return row.availableBy; }).filter(Boolean).sort();
    var nextUnlockDate = unlockDates[0] || "";
    var unlockDateTbdCount = relatedUnlocks.filter(function(row) { return row.status === "inbound-no-date"; }).length;
    var blockedWorkOrders = uniqueBy(item.affectedWOs || [], function(wo) { return wo && wo.woNum; });
    var affectedFinishedGoods = Array.from(new Set(blockedWorkOrders.map(function(wo) { return wo.productSku; }).filter(Boolean)));
    var matchedLoads = relatedLoads.filter(function(load) {
      return load.matchState !== "receive-order-only" && load.matchState !== "opendock-only";
    }).length;
    var roOnlyLoads = relatedLoads.filter(function(load) { return load.matchState === "receive-order-only"; }).length;
    var dueDays = daysUntil(item.earliestDueDate);

    return Object.assign({}, item, {
      key: skuKeys[0] || normalizeStr(item.sku),
      relatedLoads: relatedLoads,
      relatedUnlocks: relatedUnlocks,
      affectedWOCount: blockedWorkOrders.length,
      blockedFinishedGoodsCount: affectedFinishedGoods.length,
      matchedLoads: matchedLoads,
      receiveOrderOnlyLoads: roOnlyLoads,
      nextUnlockDate: nextUnlockDate,
      unlockDateTbdCount: unlockDateTbdCount,
      nextLoadDate: relatedLoads.map(function(load) { return load.availableDate; }).filter(Boolean).sort()[0] || "",
      dueDays: dueDays,
      needsAction: item.status !== "covered" || (item.riskLevel || "high") !== "low" || safeNum(item.uncoveredQty) > 0,
      priorityScore: queuePriority(item)
    });
  }).sort(function(a, b) {
    var scoreCompare = safeNum(b.priorityScore) - safeNum(a.priorityScore);
    if (scoreCompare !== 0) return scoreCompare;
    return sortByDateThenText(a, b, a.earliestDueDate, b.earliestDueDate, a.sku, b.sku);
  });
}

function StatCard({ label, value, tone, mono, hint }) {
  return (
    <Card className="px-3 py-3">
      <div className="text-xl font-bold [font-variant-numeric:tabular-nums]" style={{ color: tone, fontFamily: mono }}>{value}</div>
      <div className="mt-1 text-xs text-[rgb(var(--muted))]">{label}</div>
      {hint ? <div className="mt-1 text-[11px] text-[rgb(var(--muted))]">{hint}</div> : null}
    </Card>
  );
}

export default function SupplyRiskWorkbench({ rawCriticalItems, inboundCoverage, deliveriesV2 }) {
  const { C, mono } = useTheme();
  const { thC, tdN, tdM } = useStyles();

  const [search, setSearch] = useState("");
  const [focusMode, setFocusMode] = useState("needs-action");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const deferredSearch = useDeferredValue(search);

  var queueItems = useMemo(function() {
    return buildQueueData(rawCriticalItems, inboundCoverage, deliveriesV2);
  }, [rawCriticalItems, inboundCoverage, deliveriesV2]);

  var customerOptions = useMemo(function() {
    var seen = {};
    queueItems.forEach(function(item) {
      String(item.customerLabel || "")
        .split(",")
        .map(function(value) { return value.trim(); })
        .filter(Boolean)
        .forEach(function(value) { seen[value] = true; });
    });
    return Object.keys(seen).sort();
  }, [queueItems]);

  var filteredItems = useMemo(function() {
    var q = String(deferredSearch || "").trim().toLowerCase();
    return queueItems.filter(function(item) {
      if (customerFilter !== "all") {
        var customers = String(item.customerLabel || "").split(",").map(function(value) { return value.trim(); });
        if (!customers.includes(customerFilter)) return false;
      }

      if (focusMode === "needs-action" && !item.needsAction) return false;
      if (focusMode === "due-soon" && !(item.uncoveredQty > 0 && item.dueDays <= 7)) return false;
      if (focusMode === "awaiting-dock" && item.status !== "unscheduled") return false;
      if (focusMode === "unlocking-soon" && !(item.nextUnlockDate && item.nextUnlockDate <= addDaysIso(new Date().toISOString().slice(0, 10), 14))) return false;

      if (!q) return true;
      return (
        String(item.sku || "").toLowerCase().includes(q) ||
        String(item.desc || "").toLowerCase().includes(q) ||
        String(item.customerLabel || "").toLowerCase().includes(q) ||
        String(item.recommendedAction || "").toLowerCase().includes(q) ||
        String(item.nextUnlockDate || "").toLowerCase().includes(q) ||
        (item.openPOs || []).join(" ").toLowerCase().includes(q) ||
        (item.affectedWOs || []).some(function(wo) {
          return (
            String(wo.woNum || "").toLowerCase().includes(q) ||
            String(wo.productSku || "").toLowerCase().includes(q) ||
            String(wo.productDesc || "").toLowerCase().includes(q)
          );
        })
      );
    });
  }, [queueItems, deferredSearch, customerFilter, focusMode]);

  useEffect(function() {
    if (!filteredItems.length) {
      if (selectedKey) setSelectedKey("");
      return;
    }
    if (!filteredItems.some(function(item) { return item.key === selectedKey; })) {
      setSelectedKey(filteredItems[0].key);
    }
  }, [filteredItems, selectedKey]);

  var selectedItem = filteredItems.find(function(item) { return item.key === selectedKey; }) ||
    queueItems.find(function(item) { return item.key === selectedKey; }) ||
    filteredItems[0] ||
    null;

  var todayIso = new Date().toISOString().slice(0, 10);
  var kpis = useMemo(function() {
    var unlockRows = deliveriesV2 && deliveriesV2.unlockTimeline && Array.isArray(deliveriesV2.unlockTimeline.rows)
      ? deliveriesV2.unlockTimeline.rows
      : [];
    return {
      needsAction: queueItems.filter(function(item) { return item.needsAction; }).length,
      dueThisWeekUnits: Math.round(queueItems.filter(function(item) { return item.uncoveredQty > 0 && item.dueDays <= 7; }).reduce(function(sum, item) {
        return sum + safeNum(item.uncoveredQty);
      }, 0)),
      awaitingDock: queueItems.filter(function(item) { return item.status === "unscheduled"; }).length,
      unlocking14d: unlockRows.filter(function(row) { return row.unlockDate && row.unlockDate <= addDaysIso(todayIso, 14); }).length
    };
  }, [queueItems, deliveriesV2, todayIso]);

  var focusOptions = [
    { key: "needs-action", label: "Needs Action", count: queueItems.filter(function(item) { return item.needsAction; }).length },
    { key: "due-soon", label: "Due Soon", count: queueItems.filter(function(item) { return item.uncoveredQty > 0 && item.dueDays <= 7; }).length },
    { key: "awaiting-dock", label: "Awaiting Dock", count: queueItems.filter(function(item) { return item.status === "unscheduled"; }).length },
    { key: "unlocking-soon", label: "Unlocking Soon", count: queueItems.filter(function(item) { return item.nextUnlockDate && item.nextUnlockDate <= addDaysIso(todayIso, 14); }).length },
    { key: "all", label: "All", count: queueItems.length }
  ];

  var queueTabItems = selectedItem ? [
    { key: "overview", label: "Overview" },
    { key: "inbound", label: "Inbound", count: selectedItem.relatedLoads.length },
    { key: "unlock", label: "Unlocks", count: selectedItem.relatedUnlocks.length }
  ] : [];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Supply Risk</div>
        <div className="text-sm text-[rgb(var(--muted))]">
          One action queue for what needs attention now, with inbound and unlock context on the selected item instead of three separate reports to scan.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatCard label="Needs Action" value={kpis.needsAction.toLocaleString()} tone={C.bad} mono={mono} />
        <StatCard label="Due This Week Uncovered" value={kpis.dueThisWeekUnits.toLocaleString()} tone={C.warn} mono={mono} />
        <StatCard label="Awaiting Dock Scheduling" value={kpis.awaitingDock.toLocaleString()} tone={C.accent} mono={mono} />
        <StatCard label="Work Orders Unlocking 14d" value={kpis.unlocking14d.toLocaleString()} tone={C.ok} mono={mono} />
      </div>

      <Card className="px-4 py-3">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex flex-1 flex-wrap gap-2">
            <Input value={search} onChange={function(event) { setSearch(event.target.value); }} placeholder="Search material, customer, PO, work order, or FG SKU" className="h-10 w-full text-sm xl:w-[340px]" />
            <select value={customerFilter} onChange={function(event) { setCustomerFilter(event.target.value); }} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] xl:w-auto">
              <option value="all">All Customers</option>
              {customerOptions.map(function(customer) {
                return <option key={customer} value={customer}>{customer}</option>;
              })}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {focusOptions.map(function(option) {
              return (
                <Button key={option.key} onClick={function() { setFocusMode(option.key); }} variant={focusMode === option.key ? "active" : "outline"} size="sm">
                  {option.label}
                  <span className="ml-1 text-xs opacity-70">{option.count}</span>
                </Button>
              );
            })}
            <Button onClick={function() { exportQueueCsv(filteredItems); }} variant="outline" size="sm" disabled={!filteredItems.length}>Queue CSV</Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <div className="border-b border-[rgb(var(--border))] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Action Queue</div>
                <div className="mt-1 text-xs text-[rgb(var(--muted))]">Sorted by urgency, due risk, and uncovered quantity.</div>
              </div>
              <Badge variant="secondary">{filteredItems.length} items</Badge>
            </div>
          </div>
          <div className="max-h-[72vh] overflow-y-auto p-2">
            {!filteredItems.length ? (
              <div className="px-3 py-12 text-center text-sm text-[rgb(var(--muted))]">No materials match the current filters.</div>
            ) : filteredItems.map(function(item) {
              var tone = coverageTone(item, C);
              var isSelected = selectedItem && selectedItem.key === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={function() { setSelectedKey(item.key); setDetailTab("overview"); }}
                  className="mb-2 w-full rounded-lg border px-3 py-3 text-left transition-colors"
                  style={{
                    borderColor: isSelected ? C.accent : C.border,
                    background: isSelected ? C.accentSoft : "transparent",
                    boxShadow: isSelected ? ("inset 0 0 0 1px " + C.accentLine) : "none"
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: C.bright }}>{item.sku || "--"}</span>
                        <span style={{
                          display: "inline-block",
                          fontSize: 10,
                          padding: "2px 6px",
                          borderRadius: 999,
                          color: item.materialType === "packaging" ? C.accent : C.ok,
                          background: item.materialType === "packaging" ? C.accentSoft : C.okSoft,
                          border: "1px solid " + (item.materialType === "packaging" ? C.accentLine : C.okLine),
                          fontWeight: 600
                        }}>
                          {item.materialType === "packaging" ? "Packaging" : "WIP"}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-[rgb(var(--foreground))]">{formatDescriptionForDisplay(item.desc || "") || "--"}</div>
                      <div className="mt-1 text-xs text-[rgb(var(--muted))]">{item.customerLabel || "--"}</div>
                    </div>
                    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, color: tone.fg, background: tone.bg, border: "1px solid " + tone.bd }}>
                      {coverageStatusLabel(item.status)}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-[rgb(var(--muted))]">
                    <div>Due <span style={{ color: item.dueDays <= 7 && item.uncoveredQty > 0 ? C.bad : C.bright, fontFamily: mono }}>{fmtDate(item.earliestDueDate)}</span></div>
                    <div>Uncovered <span style={{ color: item.uncoveredQty > 0 ? C.bad : C.ok, fontFamily: mono }}>{Math.round(item.uncoveredQty || 0).toLocaleString()}</span></div>
                    <div>Next RO <span style={{ color: C.bright, fontFamily: mono }}>{fmtDate(item.earliestInboundDate)}</span></div>
                    <div>Next Unlock <span style={{ color: item.nextUnlockDate ? C.ok : C.bright, fontFamily: mono }}>{item.nextUnlockDate ? fmtDate(item.nextUnlockDate) : item.unlockDateTbdCount > 0 ? "TBD" : "--"}</span></div>
                  </div>

                  <div className="mt-3">
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 6, borderRadius: 999, background: C.border, overflow: "hidden" }}>
                        <div style={{ width: Math.max(0, Math.min(100, item.scheduledCoveragePct || 0)) + "%", height: "100%", background: (item.scheduledCoveragePct || 0) >= 100 ? C.ok : (item.scheduledCoveragePct || 0) > 0 ? C.warn : C.bad }} />
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 12, color: C.bright }}>{item.scheduledCoveragePct || 0}%</div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs" style={{ color: item.dueBeforeScheduled || item.status === "missing" ? C.bad : item.status === "unscheduled" || item.status === "partial" ? C.warn : C.dim }}>
                    {summarizeAction(item)}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="overflow-hidden">
          {!selectedItem ? (
            <div className="px-6 py-14 text-center text-sm text-[rgb(var(--muted))]">Select a material from the queue to inspect inbound coverage and unlock timing.</div>
          ) : (
            <div>
              <div className="border-b border-[rgb(var(--border))] px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: C.bright }}>{selectedItem.sku || "--"}</span>
                      <Badge variant="secondary">{selectedItem.customerLabel || "--"}</Badge>
                      <span style={{
                        display: "inline-block",
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 999,
                        color: coverageTone(selectedItem, C).fg,
                        background: coverageTone(selectedItem, C).bg,
                        border: "1px solid " + coverageTone(selectedItem, C).bd
                      }}>
                        {coverageStatusLabel(selectedItem.status)}
                      </span>
                    </div>
                    <div className="mt-2 text-base text-[rgb(var(--foreground))]">{formatDescriptionForDisplay(selectedItem.desc || "") || "--"}</div>
                    <div className="mt-2 text-sm text-[rgb(var(--muted))]">{summarizeAction(selectedItem)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 xl:w-[320px]">
                    <StatCard label="On Hand" value={Math.round(selectedItem.onHand || 0).toLocaleString()} tone={selectedItem.isZeroStock ? C.bad : C.bright} mono={mono} />
                    <StatCard label="Short" value={Math.round(selectedItem.shortQty || 0).toLocaleString()} tone={C.bad} mono={mono} />
                    <StatCard label="Receive Orders" value={Math.round(selectedItem.inboundQty || 0).toLocaleString()} tone={C.accent} mono={mono} />
                    <StatCard label="OpenDock Scheduled" value={Math.round(selectedItem.scheduledQty || 0).toLocaleString()} tone={C.ok} mono={mono} />
                  </div>
                </div>
              </div>

              <div className="px-5 pt-4">
                <TabsNav
                  items={queueTabItems}
                  activeKey={detailTab}
                  onChange={setDetailTab}
                  className="mb-0"
                />
              </div>

              <div className="px-5 pb-5 pt-4">
                {detailTab === "overview" && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                      <StatCard label="Uncovered Qty" value={Math.round(selectedItem.uncoveredQty || 0).toLocaleString()} tone={selectedItem.uncoveredQty > 0 ? C.bad : C.ok} mono={mono} />
                      <StatCard label="Coverage" value={(selectedItem.scheduledCoveragePct || 0) + "%"} tone={(selectedItem.scheduledCoveragePct || 0) >= 100 ? C.ok : (selectedItem.scheduledCoveragePct || 0) > 0 ? C.warn : C.bad} mono={mono} />
                      <StatCard label="Affected WOs" value={selectedItem.affectedWOCount.toLocaleString()} tone={C.bright} mono={mono} />
                      <StatCard label="FG SKUs Blocked" value={selectedItem.blockedFinishedGoodsCount.toLocaleString()} tone={C.accent} mono={mono} />
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
                      <Card className="px-4 py-4">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Timing and Coverage</div>
                        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                          <div style={{ color: C.dim }}>Earliest Due <div style={{ color: C.bright, fontFamily: mono, marginTop: 2 }}>{fmtDate(selectedItem.earliestDueDate)}</div></div>
                          <div style={{ color: C.dim }}>Earliest Receive Order <div style={{ color: C.bright, fontFamily: mono, marginTop: 2 }}>{fmtDate(selectedItem.earliestInboundDate)}</div></div>
                          <div style={{ color: C.dim }}>Earliest OpenDock Appointment <div style={{ color: C.bright, fontFamily: mono, marginTop: 2 }}>{fmtDate(selectedItem.earliestScheduledDate)}</div></div>
                          <div style={{ color: C.dim }}>Next Unlock Forecast <div style={{ color: selectedItem.nextUnlockDate ? C.ok : C.bright, fontFamily: mono, marginTop: 2 }}>{selectedItem.nextUnlockDate ? fmtDate(selectedItem.nextUnlockDate) : selectedItem.unlockDateTbdCount > 0 ? "TBD" : "--"}</div></div>
                        </div>
                        <div className="mt-4 text-xs text-[rgb(var(--muted))]">
                          POs: {(selectedItem.openPOs || []).length ? selectedItem.openPOs.join(", ") : "--"}
                        </div>
                      </Card>

                      <Card className="px-4 py-4">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Decision Snapshot</div>
                        <div className="mt-3 space-y-2 text-sm">
                          <div style={{ color: C.dim }}>Action</div>
                          <div style={{ color: C.bright }}>{selectedItem.recommendedAction || "Monitor"}</div>
                          <div style={{ color: C.dim, marginTop: 10 }}>Why this is surfaced</div>
                          <div style={{ color: C.bright }}>{summarizeAction(selectedItem)}</div>
                          <div style={{ color: C.dim, marginTop: 10 }}>Inbound footprint</div>
                          <div style={{ color: C.bright }}>{selectedItem.relatedLoads.length} loads · {selectedItem.matchedLoads} matched · {selectedItem.receiveOrderOnlyLoads} RO only</div>
                        </div>
                      </Card>
                    </div>

                    <TableShell>
                      <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2.5">
                        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Affected Work Orders</div>
                        <Badge variant="secondary">{selectedItem.affectedWOCount} WOs</Badge>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead><tr style={{ background: C.raised }}>
                            {["WO", "FG SKU", "Description", "Customer", "WO Remaining", "Component Needed", "Component Short", "Due"].map(function(label) {
                              return <th key={label} style={thC(false)}>{label}</th>;
                            })}
                          </tr></thead>
                          <tbody>
                            {(selectedItem.affectedWOs || []).map(function(wo) {
                              return (
                                <tr key={wo.woNum} style={{ borderBottom: "1px solid " + C.border }}>
                                  <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{wo.woNum}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bright })}>{wo.productSku || "--"}</td>
                                  <td style={tdN}>{formatDescriptionForDisplay(wo.productDesc || "") || "--"}</td>
                                  <td style={tdN}>{wo.customer || "--"}</td>
                                  <td style={tdM}>{Math.round(wo.unitsRemaining || 0).toLocaleString()}</td>
                                  <td style={tdM}>{Math.round(wo.needed || 0).toLocaleString()}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 600 })}>{Math.round(wo.short || 0).toLocaleString()}</td>
                                  <td style={tdM}>{fmtDate(wo.dueDate)}</td>
                                </tr>
                              );
                            })}
                            {!(selectedItem.affectedWOs || []).length && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.dim }}>No linked work orders for this material.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </TableShell>
                  </div>
                )}

                {detailTab === "inbound" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{selectedItem.relatedLoads.length} loads</Badge>
                      <Badge variant="secondary">{selectedItem.matchedLoads} matched</Badge>
                      <Badge variant="secondary">{selectedItem.receiveOrderOnlyLoads} RO only</Badge>
                      <div className="flex-1" />
                      <Button onClick={function() { exportInboundCsv(selectedItem.relatedLoads); }} variant="outline" size="sm" disabled={!selectedItem.relatedLoads.length}>Inbound CSV</Button>
                    </div>

                    <TableShell>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead><tr style={{ background: C.raised }}>
                            {["Available", "Receive Order", "Confirmation", "Status", "Match", "Qty", "Linked WOs", "Units Unlocked"].map(function(label) {
                              return <th key={label} style={thC(false)}>{label}</th>;
                            })}
                          </tr></thead>
                          <tbody>
                            {selectedItem.relatedLoads.map(function(load) {
                              var tone = unlockTone(load.matchState === "receive-order-only" ? "inbound-no-date" : load.matchState === "opendock-only" ? "still-blocked" : "unlock-by-date", C);
                              return (
                                <tr key={load.key} style={{ borderBottom: "1px solid " + C.border }}>
                                  <td style={tdM}>{fmtDate(load.availableDate)}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bright })}>{load.po || "--"}</td>
                                  <td style={tdN}>{load.confirmation || "--"}</td>
                                  <td style={tdN}>{load.status || "--"}</td>
                                  <td style={tdN}>
                                    <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 999, fontSize: 11, color: tone.fg, background: tone.bg, border: "1px solid " + tone.bd }}>
                                      {load.matchLabel}
                                    </span>
                                  </td>
                                  <td style={tdM}>{Math.round(load.qty || 0).toLocaleString()}</td>
                                  <td style={tdM}>{load.linkedWOCount || 0}</td>
                                  <td style={tdM}>{Math.round(load.unitsUnlocked || 0).toLocaleString()}</td>
                                </tr>
                              );
                            })}
                            {!selectedItem.relatedLoads.length && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.dim }}>No inbound loads are tied to this material right now.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </TableShell>
                  </div>
                )}

                {detailTab === "unlock" && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{selectedItem.relatedUnlocks.length} WOs</Badge>
                      <Badge variant="secondary">{selectedItem.relatedUnlocks.filter(function(row) { return !!row.availableBy; }).length} dated unlocks</Badge>
                      <Badge variant="secondary">{selectedItem.relatedUnlocks.filter(function(row) { return row.status === "inbound-no-date"; }).length} date TBD</Badge>
                      <div className="flex-1" />
                      <Button onClick={function() { exportUnlockCsv(selectedItem.relatedUnlocks); }} variant="outline" size="sm" disabled={!selectedItem.relatedUnlocks.length}>Unlock CSV</Button>
                    </div>

                    <TableShell>
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                          <thead><tr style={{ background: C.raised }}>
                            {["Available By", "WO", "FG SKU", "Customer", "Due", "Blocked Units", "Runnable Now", "Coverage", "POs", "Status"].map(function(label) {
                              return <th key={label} style={thC(false)}>{label}</th>;
                            })}
                          </tr></thead>
                          <tbody>
                            {selectedItem.relatedUnlocks.map(function(row) {
                              var tone = unlockTone(row.status, C);
                              return (
                                <tr key={row.woNum} style={{ borderBottom: "1px solid " + C.border }}>
                                  <td style={Object.assign({}, tdM, { color: row.availableBy ? C.ok : C.dim })}>{row.availableBy ? fmtDate(row.availableBy) : row.earliestInboundDate ? "TBD" : "--"}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{row.woNum || "--"}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bright })}>{row.productSku || "--"}</td>
                                  <td style={tdN}>{row.customer || "--"}</td>
                                  <td style={tdM}>{fmtDate(row.dueDate)}</td>
                                  <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 600 })}>{Math.round(row.blockedUnits || 0).toLocaleString()}</td>
                                  <td style={tdM}>{Math.round(row.runnableNow || 0).toLocaleString()}</td>
                                  <td style={tdM}>{row.coveragePct || 0}%</td>
                                  <td style={tdN}>{(row.sourcePOs || []).length ? row.sourcePOs.join(", ") : "--"}</td>
                                  <td style={tdN}>
                                    <span style={{ display: "inline-block", padding: "2px 7px", borderRadius: 999, fontSize: 11, color: tone.fg, background: tone.bg, border: "1px solid " + tone.bd }}>
                                      {unlockStatusLabel(row.status)}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                            {!selectedItem.relatedUnlocks.length && <tr><td colSpan={10} style={{ padding: 24, textAlign: "center", color: C.dim }}>No unlock forecast rows are tied to this material yet.</td></tr>}
                          </tbody>
                        </table>
                      </div>
                    </TableShell>
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
