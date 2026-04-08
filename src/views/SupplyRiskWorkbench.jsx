import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
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

function normalizePoKey(value) {
  var s = (value || "").toString().trim();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  s = s.replace(/[^a-zA-Z0-9]/g, "");
  return normalizeStr(s);
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

function unlockStatusLabel(status) {
  if (status === "unlock-by-date") return "Unlocks by date";
  if (status === "inbound-no-date") return "Inbound, date TBD";
  if (status === "partial") return "Partially covered";
  return "Still blocked";
}

function vendorGapLabel(type) {
  if (type === "missing") return "No Receive Order";
  if (type === "partial") return "Receive Order short";
  return "Covered";
}

function displayDate(value) {
  return value ? fmtDate(value) : "--";
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

function listPreview(values, maxItems) {
  var filtered = (values || []).filter(Boolean);
  if (!filtered.length) return "--";
  if (filtered.length <= maxItems) return filtered.join(", ");
  return filtered.slice(0, maxItems).join(", ") + " +" + (filtered.length - maxItems);
}

function compactSearchText(parts) {
  return (parts || []).filter(Boolean).join(" ").toLowerCase();
}

function exportCsv(filenameBase, header, rows) {
  var escapeCsv = function(value) {
    return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  };
  var body = (rows || []).map(function(row) {
    return row.map(escapeCsv).join(",");
  });
  triggerDownload([header.join(",")].concat(body).join("\n"), filenameBase + "_" + new Date().toISOString().slice(0, 10) + ".csv", "text/csv;charset=utf-8;");
}

function exportRunNextCsv(rows) {
  exportCsv(
    "supply_risk_run_next",
    ["Available By", "Status", "Work Order", "FG SKU", "Description", "Customer", "Due", "Blocked Units", "Runnable Now", "Blocking Materials", "Receive Orders"],
    (rows || []).map(function(row) {
      return [
        row.availableBy || "",
        unlockStatusLabel(row.status),
        row.woNum || "",
        row.productSku || "",
        row.productDesc || "",
        row.customerLabel || "",
        row.dueDate || "",
        Math.round(row.blockedUnits || 0),
        Math.round(row.runnableNow || 0),
        row.blockingMaterialsText || "",
        (row.sourcePOs || []).join(", ")
      ];
    })
  );
}

function exportVendorCsv(rows) {
  exportCsv(
    "supply_risk_vendor_gaps",
    ["Material", "Description", "Customer", "Status", "Earliest Due", "Short Qty", "On Receive Orders", "Gap To Schedule", "Affected WOs", "Current Receive Orders", "Action"],
    (rows || []).map(function(row) {
      return [
        row.sku || "",
        row.desc || "",
        row.customerLabel || "",
        vendorGapLabel(row.gapType),
        row.earliestDueDate || "",
        Math.round(row.shortQty || 0),
        Math.round(row.inboundQty || 0),
        Math.round(row.roGapQty || 0),
        row.affectedWOCount || 0,
        (row.openPOs || []).join(", "),
        row.actionLabel || ""
      ];
    })
  );
}

function exportDockCsv(rows) {
  exportCsv(
    "supply_risk_dock_follow_up",
    ["Expected Date", "Receive Order", "Customer", "Materials", "Qty", "Linked WOs", "Units Unlocked", "Confirmation", "Action"],
    (rows || []).map(function(row) {
      return [
        row.expectedDate || "",
        row.po || "",
        row.customerLabel || "",
        row.materialSummary || "",
        Math.round(row.qty || 0),
        row.linkedWOCount || 0,
        Math.round(row.unitsUnlocked || 0),
        row.confirmation || "",
        row.actionLabel || ""
      ];
    })
  );
}

function buildMaterialRows(rawCriticalItems, inboundCoverage, deliveriesV2) {
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
        materials: materials
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
      dueDays: daysUntil(item.earliestDueDate),
      roGapQty: Math.max(0, safeNum(item.shortQty) - safeNum(item.inboundQty)),
      needsAction: item.status !== "covered" || safeNum(item.uncoveredQty) > 0
    });
  }).sort(function(a, b) {
    var dueCompare = sortByDateThenText(a, b, a.earliestDueDate, b.earliestDueDate, a.sku, b.sku);
    if (safeNum(a.roGapQty) !== safeNum(b.roGapQty)) return safeNum(b.roGapQty) - safeNum(a.roGapQty);
    return dueCompare;
  });
}

function buildMaterialLookup(materialRows) {
  var lookup = {};
  (materialRows || []).forEach(function(row) {
    buildSkuMatchKeys(row && row.sku).forEach(function(key) {
      if (!lookup[key]) lookup[key] = row;
    });
  });
  return lookup;
}

function buildLoadsByPo(loads) {
  var lookup = {};
  (loads || []).forEach(function(load) {
    var poKey = normalizePoKey(load && load.po);
    if (!poKey) return;
    if (!lookup[poKey]) lookup[poKey] = [];
    lookup[poKey].push(load);
  });
  return lookup;
}

function buildLoadsBySku(loads) {
  var lookup = {};
  (loads || []).forEach(function(load) {
    (load.materials || []).forEach(function(material) {
      buildSkuMatchKeys(material && material.materialSku).forEach(function(key) {
        if (!lookup[key]) lookup[key] = [];
        lookup[key].push(load);
      });
    });
  });
  return lookup;
}

function runNextActionLabel(status) {
  if (status === "unlock-by-date") return "Plan line + labor";
  if (status === "inbound-no-date") return "Confirm vendor ETA";
  if (status === "partial") return "Close remaining supply gap";
  return "Create / expedite Receive Order";
}

function buildRunNextRows(deliveriesV2, materialRows) {
  var unlockRows = deliveriesV2 && deliveriesV2.unlockTimeline && Array.isArray(deliveriesV2.unlockTimeline.rows)
    ? deliveriesV2.unlockTimeline.rows
    : [];
  var loads = deliveriesV2 && Array.isArray(deliveriesV2.loads) ? deliveriesV2.loads : [];
  var materialLookup = buildMaterialLookup(materialRows);
  var loadsByPo = buildLoadsByPo(loads);
  var loadsBySku = buildLoadsBySku(loads);

  return (unlockRows || []).map(function(row) {
    var components = (row.components || []).map(function(component) {
      var materialRow = null;
      buildSkuMatchKeys(component && component.sku).some(function(key) {
        if (materialLookup[key]) {
          materialRow = materialLookup[key];
          return true;
        }
        return false;
      });
      var sourcePOs = Array.from(new Set((component.allocations || []).map(function(allocation) { return allocation.po; }).filter(Boolean)));
      return {
        sku: component && component.sku ? component.sku : "",
        desc: component && component.desc ? component.desc : (materialRow && materialRow.desc ? materialRow.desc : ""),
        neededQty: Math.round(safeNum(component && component.neededQty)),
        coveredQty: Math.round(safeNum(component && component.coveredQty)),
        coveragePct: Math.round(safeNum(component && component.coveragePct)),
        state: component && component.state ? component.state : "still-blocked",
        unlockDate: component && component.unlockDate ? component.unlockDate : "",
        earliestInboundDate: component && component.firstInboundDate ? component.firstInboundDate : "",
        sourcePOs: sourcePOs,
        customerLabel: materialRow && materialRow.customerLabel ? materialRow.customerLabel : (row.customer || "--")
      };
    });

    var sourcePOs = Array.from(new Set(
      (row.sourcePOs || [])
        .concat(components.flatMap(function(component) { return component.sourcePOs || []; }))
        .filter(Boolean)
    ));

    var relatedLoads = uniqueBy(
      sourcePOs.flatMap(function(po) { return loadsByPo[normalizePoKey(po)] || []; })
        .concat(components.flatMap(function(component) {
          return buildSkuMatchKeys(component && component.sku).flatMap(function(key) { return loadsBySku[key] || []; });
        })),
      function(load) { return load && load.key; }
    );

    var blockingMaterials = components.map(function(component) { return component.sku; }).filter(Boolean);
    var firmAvailableBy = row.unlockDate || "";
    var softAvailableBy = row.earliestInboundDate || "";
    var availableBy = firmAvailableBy || softAvailableBy || "";

    return {
      key: "wo:" + String(row.woNum || Math.random()),
      woNum: row.woNum || "",
      productSku: row.productSku || "",
      productDesc: row.productDesc || "",
      customerLabel: row.customer || "--",
      dueDate: row.dueDate || "",
      blockedUnits: Math.round(safeNum(row.blockedUnits)),
      runnableNow: Math.round(safeNum(row.runnableNow)),
      availableBy: availableBy,
      availableByFirm: !!firmAvailableBy,
      earliestInboundDate: row.earliestInboundDate || "",
      status: row.status || "still-blocked",
      componentCount: components.length,
      coveredComponentCount: components.filter(function(component) {
        return component.state === "unlock-by-date" || component.state === "inbound-no-date";
      }).length,
      blockingMaterialsText: listPreview(blockingMaterials, 3),
      sourcePOs: sourcePOs,
      componentsDetailed: components,
      relatedLoads: relatedLoads,
      actionLabel: runNextActionLabel(row.status),
      searchText: compactSearchText([
        row.woNum,
        row.productSku,
        row.productDesc,
        row.customer,
        blockingMaterials.join(" "),
        sourcePOs.join(" "),
        unlockStatusLabel(row.status)
      ])
    };
  }).sort(function(a, b) {
    var statusRank = {
      "unlock-by-date": 0,
      "inbound-no-date": 1,
      partial: 2,
      "still-blocked": 3
    };
    if ((statusRank[a.status] || 99) !== (statusRank[b.status] || 99)) {
      return (statusRank[a.status] || 99) - (statusRank[b.status] || 99);
    }
    return sortByDateThenText(a, b, a.availableBy, b.availableBy, a.dueDate || a.woNum, b.dueDate || b.woNum);
  });
}

function buildVendorGapRows(materialRows) {
  return (materialRows || []).filter(function(row) {
    return safeNum(row.roGapQty) > 0;
  }).map(function(row) {
    var gapType = safeNum(row.inboundQty) <= 0 ? "missing" : "partial";
    return Object.assign({}, row, {
      gapType: gapType,
      actionLabel: gapType === "missing" ? "Create Receive Order" : "Add balance to Receive Order",
      searchText: compactSearchText([
        row.sku,
        row.desc,
        row.customerLabel,
        (row.openPOs || []).join(" "),
        vendorGapLabel(gapType),
        row.recommendedAction
      ])
    });
  }).sort(function(a, b) {
    if (a.gapType !== b.gapType) return a.gapType === "missing" ? -1 : 1;
    if (a.earliestDueDate !== b.earliestDueDate) {
      return String(a.earliestDueDate || "9999-12-31").localeCompare(String(b.earliestDueDate || "9999-12-31"));
    }
    return safeNum(b.roGapQty) - safeNum(a.roGapQty);
  });
}

function buildDockGapRows(deliveriesV2, materialRows) {
  var loads = deliveriesV2 && Array.isArray(deliveriesV2.loads) ? deliveriesV2.loads : [];
  var materialLookup = buildMaterialLookup(materialRows);

  return loads.filter(function(load) {
    return load && load.matchState === "receive-order-only";
  }).map(function(load) {
    var materials = (load.materials || []).map(function(material) {
      var materialRow = null;
      buildSkuMatchKeys(material && material.materialSku).some(function(key) {
        if (materialLookup[key]) {
          materialRow = materialLookup[key];
          return true;
        }
        return false;
      });
      return {
        sku: material && material.materialSku ? material.materialSku : "",
        desc: material && material.materialDesc ? material.materialDesc : (materialRow && materialRow.desc ? materialRow.desc : ""),
        qty: Math.round(safeNum(material && material.qty)),
        expectedDate: material && material.expectedDate ? material.expectedDate : (load.expectedDate || ""),
        linkedWOCount: Math.round(safeNum(material && material.linkedWOCount)),
        unitsUnlocked: Math.round(safeNum(material && material.unitsUnlocked)),
        customerLabel: materialRow && materialRow.customerLabel ? materialRow.customerLabel : "--"
      };
    });

    var customers = Array.from(new Set(materials.flatMap(function(material) {
      return String(material.customerLabel || "")
        .split(",")
        .map(function(value) { return value.trim(); })
        .filter(Boolean)
        .filter(function(value) { return value !== "--"; });
    })));

    var affectedWOs = uniqueBy(materials.flatMap(function(material) {
      var materialRow = null;
      buildSkuMatchKeys(material && material.sku).some(function(key) {
        if (materialLookup[key]) {
          materialRow = materialLookup[key];
          return true;
        }
        return false;
      });
      return materialRow && Array.isArray(materialRow.affectedWOs) ? materialRow.affectedWOs : [];
    }), function(wo) {
      return wo && wo.woNum;
    });

    return {
      key: load.key,
      po: load.po || "",
      expectedDate: load.expectedDate || materials.map(function(material) { return material.expectedDate; }).filter(Boolean).sort()[0] || "",
      confirmation: load.confirmation || "",
      customerLabel: customers.length ? customers.join(", ") : "--",
      materialSummary: listPreview(materials.map(function(material) { return material.sku; }), 3),
      materialCount: materials.length,
      qty: Math.round(safeNum(load.totalQty)),
      linkedWOCount: Math.round(safeNum(load.linkedWOCount)),
      unitsUnlocked: Math.round(safeNum(load.unitsUnlocked)),
      materialsDetailed: materials,
      affectedWOs: affectedWOs,
      actionLabel: load.confirmation ? "Book OpenDock appointment" : "Confirm load + book appointment",
      searchText: compactSearchText([
        load.po,
        load.confirmation,
        customers.join(" "),
        materials.map(function(material) { return material.sku + " " + material.desc; }).join(" ")
      ])
    };
  }).sort(function(a, b) {
    var dateCompare = String(a.expectedDate || "9999-12-31").localeCompare(String(b.expectedDate || "9999-12-31"));
    if (dateCompare !== 0) return dateCompare;
    if (safeNum(b.linkedWOCount) !== safeNum(a.linkedWOCount)) return safeNum(b.linkedWOCount) - safeNum(a.linkedWOCount);
    return safeNum(b.qty) - safeNum(a.qty);
  });
}

function boardMeta(boardKey) {
  if (boardKey === "vendor-gaps") {
    return {
      title: "Vendor Gaps",
      subtitle: "Materials still short because Receive Orders do not yet cover the gap. Export this board to vendors.",
      exportLabel: "Vendor CSV"
    };
  }
  if (boardKey === "dock-follow-up") {
    return {
      title: "Dock Follow-up",
      subtitle: "Receive Orders that exist in Nulogy but still need an OpenDock appointment. Export this board to trucking partners.",
      exportLabel: "Dock CSV"
    };
  }
  return {
    title: "Run Next",
    subtitle: "Blocked work orders sorted by when inbound should unlock them so planners can line up production and labor.",
    exportLabel: "Run Next CSV"
  };
}

function buildFocusOptions(boardKey, rows, todayIso) {
  if (boardKey === "vendor-gaps") {
    return [
      { key: "all", label: "All", count: rows.length },
      { key: "no-ro", label: "No RO", count: rows.filter(function(row) { return row.gapType === "missing"; }).length },
      { key: "partial-gap", label: "RO Short", count: rows.filter(function(row) { return row.gapType === "partial"; }).length },
      { key: "due-7d", label: "Due 7d", count: rows.filter(function(row) { return row.earliestDueDate && row.earliestDueDate <= addDaysIso(todayIso, 7); }).length }
    ];
  }
  if (boardKey === "dock-follow-up") {
    return [
      { key: "all", label: "All", count: rows.length },
      { key: "expected-7d", label: "Expected 7d", count: rows.filter(function(row) { return row.expectedDate && row.expectedDate <= addDaysIso(todayIso, 7); }).length },
      { key: "high-impact", label: "High Impact", count: rows.filter(function(row) { return safeNum(row.linkedWOCount) > 0 || safeNum(row.unitsUnlocked) > 0; }).length },
      { key: "no-confirmation", label: "No Conf.", count: rows.filter(function(row) { return !row.confirmation; }).length }
    ];
  }
  return [
    { key: "all", label: "All", count: rows.length },
    { key: "unlocking-7d", label: "Unlocking 7d", count: rows.filter(function(row) { return row.status === "unlock-by-date" && row.availableBy && row.availableBy <= addDaysIso(todayIso, 7); }).length },
    { key: "date-tbd", label: "Date TBD", count: rows.filter(function(row) { return row.status === "inbound-no-date"; }).length },
    { key: "still-blocked", label: "Still Blocked", count: rows.filter(function(row) { return row.status === "still-blocked" || row.status === "partial"; }).length }
  ];
}

function matchesFocus(boardKey, focusKey, row, todayIso) {
  if (!focusKey || focusKey === "all") return true;
  if (boardKey === "vendor-gaps") {
    if (focusKey === "no-ro") return row.gapType === "missing";
    if (focusKey === "partial-gap") return row.gapType === "partial";
    if (focusKey === "due-7d") return !!row.earliestDueDate && row.earliestDueDate <= addDaysIso(todayIso, 7);
    return true;
  }
  if (boardKey === "dock-follow-up") {
    if (focusKey === "expected-7d") return !!row.expectedDate && row.expectedDate <= addDaysIso(todayIso, 7);
    if (focusKey === "high-impact") return safeNum(row.linkedWOCount) > 0 || safeNum(row.unitsUnlocked) > 0;
    if (focusKey === "no-confirmation") return !row.confirmation;
    return true;
  }
  if (focusKey === "unlocking-7d") return row.status === "unlock-by-date" && !!row.availableBy && row.availableBy <= addDaysIso(todayIso, 7);
  if (focusKey === "date-tbd") return row.status === "inbound-no-date";
  if (focusKey === "still-blocked") return row.status === "still-blocked" || row.status === "partial";
  return true;
}

function toneForRunNext(status, C) {
  if (status === "unlock-by-date") return { fg: C.ok, bg: C.okSoft, bd: C.okLine };
  if (status === "inbound-no-date") return { fg: C.accent, bg: C.accentSoft, bd: C.accentLine };
  if (status === "partial") return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
  return { fg: C.bad, bg: C.badSoft, bd: C.badLine };
}

function toneForVendor(row, C) {
  if (row.gapType === "missing") return { fg: C.bad, bg: C.badSoft, bd: C.badLine };
  return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
}

function toneForDock(row, C) {
  if (row.expectedDate && row.expectedDate <= addDaysIso(new Date().toISOString().slice(0, 10), 7)) {
    return { fg: C.warn, bg: C.warnSoft, bd: C.warnLine };
  }
  return { fg: C.accent, bg: C.accentSoft, bd: C.accentLine };
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

function Pill({ tone, children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        color: tone.fg,
        background: tone.bg,
        border: "1px solid " + tone.bd
      }}
    >
      {children}
    </span>
  );
}

function renderAffectedWosTable(rows, C, thC, tdN, tdM) {
  return (
    <TableShell>
      <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2.5">
        <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Affected Work Orders</div>
        <Badge variant="secondary">{(rows || []).length} WOs</Badge>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.raised }}>
              {["WO", "FG SKU", "Description", "Customer", "WO Remaining", "Component Needed", "Component Short", "Due"].map(function(label) {
                return <th key={label} style={thC(false)}>{label}</th>;
              })}
            </tr>
          </thead>
          <tbody>
            {(rows || []).map(function(wo) {
              return (
                <tr key={wo.woNum} style={{ borderBottom: "1px solid " + C.border }}>
                  <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{wo.woNum || "--"}</td>
                  <td style={Object.assign({}, tdM, { color: C.bright })}>{wo.productSku || "--"}</td>
                  <td style={tdN}>{formatDescriptionForDisplay(wo.productDesc || "") || "--"}</td>
                  <td style={tdN}>{wo.customer || "--"}</td>
                  <td style={tdM}>{Math.round(wo.unitsRemaining || 0).toLocaleString()}</td>
                  <td style={tdM}>{Math.round(wo.needed || 0).toLocaleString()}</td>
                  <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 600 })}>{Math.round(wo.short || 0).toLocaleString()}</td>
                  <td style={tdM}>{displayDate(wo.dueDate)}</td>
                </tr>
              );
            })}
            {!(rows || []).length && <tr><td colSpan={8} style={{ padding: 24, textAlign: "center", color: C.dim }}>No linked work orders.</td></tr>}
          </tbody>
        </table>
      </div>
    </TableShell>
  );
}

function renderInlineExpansion(children, C) {
  return (
    <div
      className="space-y-3 px-3 py-3"
      style={{
        background: C.raised,
        boxShadow: "inset 0 1px 0 " + C.border
      }}
    >
      {children}
    </div>
  );
}

function MetricStrip({ items, mono, C }) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 divide-y xl:grid-cols-4 xl:divide-x xl:divide-y-0" style={{ borderColor: C.border }}>
        {items.map(function(item, index) {
          return (
            <div
              key={item.label}
              className="px-3 py-2.5"
            >
              <div className="text-lg font-bold [font-variant-numeric:tabular-nums]" style={{ color: item.tone, fontFamily: mono }}>{item.value}</div>
              <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{item.label}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function FactsStrip({ title, items, C, mono }) {
  return (
    <Card className="px-3 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--muted))]">{title}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-4">
        {items.map(function(item) {
          return (
            <div key={item.label}>
              <div className="text-[11px] text-[rgb(var(--muted))]">{item.label}</div>
              <div className="mt-0.5 text-sm text-[rgb(var(--foreground))]" style={item.mono ? { fontFamily: mono } : undefined}>{item.value}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function renderRunNextDetail(row, C, mono, thC, tdN, tdM) {
  return renderInlineExpansion(
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.bright }}>{row.woNum || "--"}</span>
          <Badge variant="secondary">{row.customerLabel || "--"}</Badge>
          <Pill tone={toneForRunNext(row.status, C)}>{unlockStatusLabel(row.status)}</Pill>
        </div>
        <div className="text-sm text-[rgb(var(--foreground))]">{row.productSku || "--"} · {formatDescriptionForDisplay(row.productDesc || "") || "--"}</div>
      </div>

      <MetricStrip
        C={C}
        mono={mono}
        items={[
          { label: "Available By", value: row.availableBy ? displayDate(row.availableBy) : row.status === "inbound-no-date" ? "TBD" : "--", tone: row.status === "unlock-by-date" ? C.ok : C.bright },
          { label: "Blocked Units", value: Math.round(row.blockedUnits || 0).toLocaleString(), tone: C.bad },
          { label: "Runnable Now", value: Math.round(row.runnableNow || 0).toLocaleString(), tone: C.ok },
          { label: "Receive Orders", value: (row.sourcePOs || []).length.toLocaleString(), tone: C.accent }
        ]}
      />

      <FactsStrip
        title="Planning Snapshot"
        C={C}
        mono={mono}
        items={[
          { label: "Due", value: displayDate(row.dueDate), mono: true },
          { label: "Action", value: row.actionLabel || "--" },
          { label: "Blocking Materials", value: row.blockingMaterialsText || "--" },
          { label: "Receive Orders", value: (row.sourcePOs || []).length ? row.sourcePOs.join(", ") : "--" }
        ]}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <TableShell>
          <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Blocking Materials</div>
            <Badge variant="secondary">{(row.componentsDetailed || []).length} materials</Badge>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Material", "Needed", "Covered", "Earliest RO", "Status"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {(row.componentsDetailed || []).map(function(component) {
                  return (
                    <tr key={component.sku} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>
                        <div>{component.sku || "--"}</div>
                        <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{formatDescriptionForDisplay(component.desc || "") || "--"}</div>
                      </td>
                      <td style={tdM}>{Math.round(component.neededQty || 0).toLocaleString()}</td>
                      <td style={tdM}>{Math.round(component.coveredQty || 0).toLocaleString()}</td>
                      <td style={tdM}>{displayDate(component.unlockDate || component.earliestInboundDate)}</td>
                      <td style={tdN}><Pill tone={toneForRunNext(component.state, C)}>{unlockStatusLabel(component.state)}</Pill></td>
                    </tr>
                  );
                })}
                {!(row.componentsDetailed || []).length && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.dim }}>No blocking materials found.</td></tr>}
              </tbody>
            </table>
          </div>
        </TableShell>

        <TableShell>
          <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Inbound Loads</div>
            <Badge variant="secondary">{(row.relatedLoads || []).length} loads</Badge>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Available", "RO", "Qty", "Linked WOs", "Units"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {(row.relatedLoads || []).map(function(load) {
                  return (
                    <tr key={load.key} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={tdM}>{displayDate(load.availableDate)}</td>
                      <td style={Object.assign({}, tdM, { color: C.bright })}>
                        <div>{load.po || "--"}</div>
                        <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{load.matchLabel || "--"}</div>
                      </td>
                      <td style={tdM}>{Math.round(load.qty || 0).toLocaleString()}</td>
                      <td style={tdM}>{load.linkedWOCount || 0}</td>
                      <td style={tdM}>{Math.round(load.unitsUnlocked || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
                {!(row.relatedLoads || []).length && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.dim }}>No related inbound loads found.</td></tr>}
              </tbody>
            </table>
          </div>
        </TableShell>
      </div>
    </div>,
    C
  );
}

function renderVendorDetail(row, C, mono, thC, tdN, tdM) {
  return renderInlineExpansion(
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.bright }}>{row.sku || "--"}</span>
          <Badge variant="secondary">{row.customerLabel || "--"}</Badge>
          <Pill tone={toneForVendor(row, C)}>{vendorGapLabel(row.gapType)}</Pill>
        </div>
        <div className="text-sm text-[rgb(var(--foreground))]">{formatDescriptionForDisplay(row.desc || "") || "--"}</div>
      </div>

      <MetricStrip
        C={C}
        mono={mono}
        items={[
          { label: "Gap To Schedule", value: Math.round(row.roGapQty || 0).toLocaleString(), tone: C.bad },
          { label: "Short Qty", value: Math.round(row.shortQty || 0).toLocaleString(), tone: C.warn },
          { label: "On Receive Orders", value: Math.round(row.inboundQty || 0).toLocaleString(), tone: C.accent },
          { label: "Affected WOs", value: (row.affectedWOCount || 0).toLocaleString(), tone: C.bright }
        ]}
      />

      <FactsStrip
        title="Vendor Follow-up Snapshot"
        C={C}
        mono={mono}
        items={[
          { label: "Earliest Due", value: displayDate(row.earliestDueDate), mono: true },
          { label: "Action", value: row.actionLabel || "--" },
          { label: "Current Receive Orders", value: (row.openPOs || []).length ? row.openPOs.join(", ") : "--" },
          { label: "OpenDock Scheduled", value: Math.round(row.scheduledQty || 0).toLocaleString(), mono: true }
        ]}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        {renderAffectedWosTable(row.affectedWOs || [], C, thC, tdN, tdM)}

        <TableShell>
          <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Current Inbound</div>
            <Badge variant="secondary">{(row.relatedLoads || []).length} loads</Badge>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Available", "RO", "Qty", "Linked WOs", "Units"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {(row.relatedLoads || []).map(function(load) {
                  return (
                    <tr key={load.key} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={tdM}>{displayDate(load.availableDate)}</td>
                      <td style={Object.assign({}, tdM, { color: C.bright })}>
                        <div>{load.po || "--"}</div>
                        <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{load.matchLabel || "--"}</div>
                      </td>
                      <td style={tdM}>{Math.round(load.qty || 0).toLocaleString()}</td>
                      <td style={tdM}>{load.linkedWOCount || 0}</td>
                      <td style={tdM}>{Math.round(load.unitsUnlocked || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
                {!(row.relatedLoads || []).length && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.dim }}>No current inbound lines for this material.</td></tr>}
              </tbody>
            </table>
          </div>
        </TableShell>
      </div>
    </div>,
    C
  );
}

function renderDockDetail(row, C, mono, thC, tdN, tdM) {
  return renderInlineExpansion(
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span style={{ fontFamily: mono, fontSize: 15, fontWeight: 700, color: C.bright }}>{row.po || "--"}</span>
          <Badge variant="secondary">{row.customerLabel || "--"}</Badge>
          <Pill tone={toneForDock(row, C)}>Needs OpenDock appointment</Pill>
        </div>
        <div className="text-sm text-[rgb(var(--foreground))]">{row.materialSummary || "--"}</div>
      </div>

      <MetricStrip
        C={C}
        mono={mono}
        items={[
          { label: "Expected Date", value: displayDate(row.expectedDate), tone: C.accent },
          { label: "Load Qty", value: Math.round(row.qty || 0).toLocaleString(), tone: C.bright },
          { label: "Linked WOs", value: (row.linkedWOCount || 0).toLocaleString(), tone: C.warn },
          { label: "Units Unlocked", value: Math.round(row.unitsUnlocked || 0).toLocaleString(), tone: C.ok }
        ]}
      />

      <FactsStrip
        title="Dock Follow-up Snapshot"
        C={C}
        mono={mono}
        items={[
          { label: "Expected Date", value: displayDate(row.expectedDate), mono: true },
          { label: "Action", value: row.actionLabel || "--" },
          { label: "Confirmation", value: row.confirmation || "--" },
          { label: "Customer Scope", value: row.customerLabel || "--" }
        ]}
      />

      <div className="grid gap-3 xl:grid-cols-2">
        <TableShell>
          <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-3 py-2">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">Materials On This Load</div>
            <Badge variant="secondary">{(row.materialsDetailed || []).length} materials</Badge>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Material", "Qty", "Expected", "Linked WOs", "Units"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {(row.materialsDetailed || []).map(function(material) {
                  return (
                    <tr key={material.sku} style={{ borderBottom: "1px solid " + C.border }}>
                      <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>
                        <div>{material.sku || "--"}</div>
                        <div className="mt-0.5 text-[11px] text-[rgb(var(--muted))]">{formatDescriptionForDisplay(material.desc || "") || "--"}</div>
                      </td>
                      <td style={tdM}>{Math.round(material.qty || 0).toLocaleString()}</td>
                      <td style={tdM}>{displayDate(material.expectedDate)}</td>
                      <td style={tdM}>{material.linkedWOCount || 0}</td>
                      <td style={tdM}>{Math.round(material.unitsUnlocked || 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
                {!(row.materialsDetailed || []).length && <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: C.dim }}>No material detail on this load.</td></tr>}
              </tbody>
            </table>
          </div>
        </TableShell>

        {renderAffectedWosTable(row.affectedWOs || [], C, thC, tdN, tdM)}
      </div>
    </div>,
    C
  );
}

export default function SupplyRiskWorkbench({ rawCriticalItems, inboundCoverage, deliveriesV2 }) {
  const { C, mono } = useTheme();
  const { thC, tdN, tdM } = useStyles();

  const [boardKey, setBoardKey] = useState("run-next");
  const [search, setSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [focusKey, setFocusKey] = useState("all");
  const [selectedKey, setSelectedKey] = useState("");
  const deferredSearch = useDeferredValue(search);
  var todayIso = new Date().toISOString().slice(0, 10);

  var materialRows = useMemo(function() {
    return buildMaterialRows(rawCriticalItems, inboundCoverage, deliveriesV2);
  }, [rawCriticalItems, inboundCoverage, deliveriesV2]);

  var runNextRows = useMemo(function() {
    return buildRunNextRows(deliveriesV2, materialRows);
  }, [deliveriesV2, materialRows]);

  var vendorGapRows = useMemo(function() {
    return buildVendorGapRows(materialRows);
  }, [materialRows]);

  var dockGapRows = useMemo(function() {
    return buildDockGapRows(deliveriesV2, materialRows);
  }, [deliveriesV2, materialRows]);

  var boardRows = boardKey === "vendor-gaps"
    ? vendorGapRows
    : boardKey === "dock-follow-up"
      ? dockGapRows
      : runNextRows;

  var customerOptions = useMemo(function() {
    var seen = {};
    boardRows.forEach(function(row) {
      String(row.customerLabel || "")
        .split(",")
        .map(function(value) { return value.trim(); })
        .filter(Boolean)
        .filter(function(value) { return value !== "--"; })
        .forEach(function(value) { seen[value] = true; });
    });
    return Object.keys(seen).sort();
  }, [boardRows]);

  var focusOptions = useMemo(function() {
    return buildFocusOptions(boardKey, boardRows, todayIso);
  }, [boardKey, boardRows, todayIso]);

  var filteredRows = useMemo(function() {
    var q = String(deferredSearch || "").trim().toLowerCase();
    return boardRows.filter(function(row) {
      if (customerFilter !== "all") {
        var customers = String(row.customerLabel || "").split(",").map(function(value) { return value.trim(); });
        if (!customers.includes(customerFilter)) return false;
      }
      if (!matchesFocus(boardKey, focusKey, row, todayIso)) return false;
      if (!q) return true;
      return String(row.searchText || "").includes(q);
    });
  }, [boardRows, deferredSearch, customerFilter, focusKey, boardKey, todayIso]);

  useEffect(function() {
    setFocusKey("all");
    setSelectedKey("");
  }, [boardKey]);

  useEffect(function() {
    if (!filteredRows.length) {
      if (selectedKey) setSelectedKey("");
      return;
    }
    if (selectedKey && !filteredRows.some(function(row) { return row.key === selectedKey; })) {
      setSelectedKey("");
    }
  }, [filteredRows, selectedKey]);

  var summary = useMemo(function() {
    var unlock7dRows = runNextRows.filter(function(row) {
      return row.status === "unlock-by-date" && row.availableBy && row.availableBy <= addDaysIso(todayIso, 7);
    });
    var vendorGapUnits = vendorGapRows.reduce(function(sum, row) { return sum + safeNum(row.roGapQty); }, 0);
    var dockGapQty = dockGapRows.reduce(function(sum, row) { return sum + safeNum(row.qty); }, 0);
    var blockedUnits = runNextRows.reduce(function(sum, row) { return sum + safeNum(row.blockedUnits); }, 0);
    return {
      unlock7dCount: unlock7dRows.length,
      unlock7dUnits: Math.round(unlock7dRows.reduce(function(sum, row) { return sum + safeNum(row.blockedUnits); }, 0)),
      vendorGapCount: vendorGapRows.length,
      vendorGapUnits: Math.round(vendorGapUnits),
      dockGapCount: dockGapRows.length,
      dockGapQty: Math.round(dockGapQty),
      blockedUnits: Math.round(blockedUnits)
    };
  }, [runNextRows, vendorGapRows, dockGapRows, todayIso]);

  var tabs = [
    { key: "run-next", label: "Run Next", count: runNextRows.length },
    { key: "vendor-gaps", label: "Vendor Gaps", count: vendorGapRows.length },
    { key: "dock-follow-up", label: "Dock Follow-up", count: dockGapRows.length }
  ];
  var meta = boardMeta(boardKey);

  var handleExport = function() {
    if (boardKey === "vendor-gaps") exportVendorCsv(filteredRows);
    else if (boardKey === "dock-follow-up") exportDockCsv(filteredRows);
    else exportRunNextCsv(filteredRows);
  };

  var toggleSelectedKey = function(key) {
    setSelectedKey(function(current) {
      return current === key ? "" : key;
    });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-lg font-semibold text-[rgb(var(--foreground))]">Supply Risk</div>
        <div className="text-sm text-[rgb(var(--muted))]">
          One spreadsheet-style workbench for three operator jobs: what we can run next, what vendors still need to schedule, and what trucking still needs on OpenDock.
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatCard label="Run Next 7d" value={summary.unlock7dCount.toLocaleString()} tone={C.ok} mono={mono} hint={summary.unlock7dUnits.toLocaleString() + " blocked units"} />
        <StatCard label="Vendor Gaps" value={summary.vendorGapCount.toLocaleString()} tone={C.bad} mono={mono} hint={summary.vendorGapUnits.toLocaleString() + " units not on RO"} />
        <StatCard label="Dock Follow-up" value={summary.dockGapCount.toLocaleString()} tone={C.accent} mono={mono} hint={summary.dockGapQty.toLocaleString() + " units awaiting appt"} />
        <StatCard label="Blocked Units" value={summary.blockedUnits.toLocaleString()} tone={C.warn} mono={mono} hint="Across blocked work orders" />
      </div>

      <Card className="px-4 py-3">
        <TabsNav items={tabs} activeKey={boardKey} onChange={setBoardKey} className="mb-3" />
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{meta.title}</div>
            <div className="text-xs text-[rgb(var(--muted))]">{meta.subtitle}</div>
          </div>
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
            <Input
              value={search}
              onChange={function(event) { setSearch(event.target.value); }}
              placeholder="Search material, receive order, work order, FG SKU, or customer"
              className="h-10 w-full text-sm xl:w-[340px]"
            />
            <select
              value={customerFilter}
              onChange={function(event) { setCustomerFilter(event.target.value); }}
              className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] xl:w-auto"
            >
              <option value="all">All Customers</option>
              {customerOptions.map(function(customer) {
                return <option key={customer} value={customer}>{customer}</option>;
              })}
            </select>
            <Button onClick={handleExport} variant="outline" size="sm" disabled={!filteredRows.length}>
              {meta.exportLabel}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {focusOptions.map(function(option) {
            return (
              <Button key={option.key} onClick={function() { setFocusKey(option.key); }} variant={focusKey === option.key ? "active" : "outline"} size="sm">
                {option.label}
                <span className="ml-1 text-xs opacity-70">{option.count}</span>
              </Button>
            );
          })}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-2 border-b border-[rgb(var(--border))] px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-[rgb(var(--foreground))]">{meta.title} Board</div>
            <div className="mt-1 text-xs text-[rgb(var(--muted))]">Click any row to expand the full context inline without leaving the board.</div>
          </div>
          <Badge variant="secondary">{filteredRows.length} rows</Badge>
        </div>
        <div style={{ overflowX: "auto" }}>
          {boardKey === "run-next" && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Available", "WO", "FG SKU", "Customer", "Due", "Blocked Units", "Runnable Now", "Blocking Materials", "Receive Orders", "Status"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {!filteredRows.length && <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: C.dim }}>No work orders match the current filters.</td></tr>}
                {filteredRows.map(function(row) {
                  var isSelected = selectedKey === row.key;
                  var tone = toneForRunNext(row.status, C);
                  return (
                    <Fragment key={row.key}>
                      <tr
                        onClick={function() { toggleSelectedKey(row.key); }}
                        style={{
                          borderBottom: isSelected ? "none" : "1px solid " + C.border,
                          background: isSelected ? C.accentSoft : "transparent",
                          cursor: "pointer"
                        }}
                      >
                        <td style={Object.assign({}, tdM, { color: row.status === "unlock-by-date" ? C.ok : C.bright })}>
                          <div className="flex items-center gap-2">
                            <span style={{ color: C.dim }}>{isSelected ? "▾" : "▸"}</span>
                            <span>{row.availableBy ? displayDate(row.availableBy) : row.status === "inbound-no-date" ? "TBD" : "--"}</span>
                          </div>
                        </td>
                        <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{row.woNum || "--"}</td>
                        <td style={Object.assign({}, tdM, { color: C.bright })}>{row.productSku || "--"}</td>
                        <td style={tdN}>{row.customerLabel || "--"}</td>
                        <td style={tdM}>{displayDate(row.dueDate)}</td>
                        <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 600 })}>{Math.round(row.blockedUnits || 0).toLocaleString()}</td>
                        <td style={tdM}>{Math.round(row.runnableNow || 0).toLocaleString()}</td>
                        <td style={tdN}>{row.blockingMaterialsText || "--"}</td>
                        <td style={tdN}>{listPreview(row.sourcePOs || [], 2)}</td>
                        <td style={tdN}><Pill tone={tone}>{unlockStatusLabel(row.status)}</Pill></td>
                      </tr>
                      {isSelected && (
                        <tr style={{ borderBottom: "1px solid " + C.border }}>
                          <td colSpan={10} style={{ padding: 0 }}>
                            {renderRunNextDetail(row, C, mono, thC, tdN, tdM)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {boardKey === "vendor-gaps" && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Material", "Description", "Customer", "Due", "Short", "On RO", "Gap To Schedule", "Affected WOs", "Current Receive Orders", "Action"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {!filteredRows.length && <tr><td colSpan={10} style={{ padding: 28, textAlign: "center", color: C.dim }}>No vendor gaps match the current filters.</td></tr>}
                {filteredRows.map(function(row) {
                  var isSelected = selectedKey === row.key;
                  var tone = toneForVendor(row, C);
                  return (
                    <Fragment key={row.key}>
                      <tr
                        onClick={function() { toggleSelectedKey(row.key); }}
                        style={{
                          borderBottom: isSelected ? "none" : "1px solid " + C.border,
                          background: isSelected ? C.accentSoft : "transparent",
                          cursor: "pointer"
                        }}
                      >
                        <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>
                          <div className="flex items-center gap-2">
                            <span style={{ color: C.dim }}>{isSelected ? "▾" : "▸"}</span>
                            <span>{row.sku || "--"}</span>
                          </div>
                        </td>
                        <td style={tdN}>{formatDescriptionForDisplay(row.desc || "") || "--"}</td>
                        <td style={tdN}>{row.customerLabel || "--"}</td>
                        <td style={tdM}>{displayDate(row.earliestDueDate)}</td>
                        <td style={tdM}>{Math.round(row.shortQty || 0).toLocaleString()}</td>
                        <td style={tdM}>{Math.round(row.inboundQty || 0).toLocaleString()}</td>
                        <td style={Object.assign({}, tdM, { color: C.bad, fontWeight: 600 })}>{Math.round(row.roGapQty || 0).toLocaleString()}</td>
                        <td style={tdM}>{row.affectedWOCount || 0}</td>
                        <td style={tdN}>{listPreview(row.openPOs || [], 2)}</td>
                        <td style={tdN}>
                          <div className="flex flex-wrap items-center gap-2">
                            <Pill tone={tone}>{vendorGapLabel(row.gapType)}</Pill>
                            <span>{row.actionLabel}</span>
                          </div>
                        </td>
                      </tr>
                      {isSelected && (
                        <tr style={{ borderBottom: "1px solid " + C.border }}>
                          <td colSpan={10} style={{ padding: 0 }}>
                            {renderVendorDetail(row, C, mono, thC, tdN, tdM)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}

          {boardKey === "dock-follow-up" && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: C.raised }}>
                  {["Expected", "Receive Order", "Customer", "Materials", "Qty", "Linked WOs", "Units Unlocked", "Confirmation", "Action"].map(function(label) {
                    return <th key={label} style={thC(false)}>{label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {!filteredRows.length && <tr><td colSpan={9} style={{ padding: 28, textAlign: "center", color: C.dim }}>No dock follow-up loads match the current filters.</td></tr>}
                {filteredRows.map(function(row) {
                  var isSelected = selectedKey === row.key;
                  var tone = toneForDock(row, C);
                  return (
                    <Fragment key={row.key}>
                      <tr
                        onClick={function() { toggleSelectedKey(row.key); }}
                        style={{
                          borderBottom: isSelected ? "none" : "1px solid " + C.border,
                          background: isSelected ? C.accentSoft : "transparent",
                          cursor: "pointer"
                        }}
                      >
                        <td style={tdM}>
                          <div className="flex items-center gap-2">
                            <span style={{ color: C.dim }}>{isSelected ? "▾" : "▸"}</span>
                            <span>{displayDate(row.expectedDate)}</span>
                          </div>
                        </td>
                        <td style={Object.assign({}, tdM, { color: C.bright, fontWeight: 600 })}>{row.po || "--"}</td>
                        <td style={tdN}>{row.customerLabel || "--"}</td>
                        <td style={tdN}>{row.materialSummary || "--"}</td>
                        <td style={tdM}>{Math.round(row.qty || 0).toLocaleString()}</td>
                        <td style={tdM}>{row.linkedWOCount || 0}</td>
                        <td style={tdM}>{Math.round(row.unitsUnlocked || 0).toLocaleString()}</td>
                        <td style={tdN}>{row.confirmation || "--"}</td>
                        <td style={tdN}><Pill tone={tone}>{row.actionLabel}</Pill></td>
                      </tr>
                      {isSelected && (
                        <tr style={{ borderBottom: "1px solid " + C.border }}>
                          <td colSpan={9} style={{ padding: 0 }}>
                            {renderDockDetail(row, C, mono, thC, tdN, tdM)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
