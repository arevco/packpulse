import { useState, useMemo, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, normalizeStr, formatDescriptionForDisplay, detectPackType, safeNum } from "../utils";
import { buildWorkOrderCommitKey, buildWorkOrderCommitmentMap, statusLooksClosed } from "../lib/workOrderCommitments.js";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { DatePicker } from "../components/ui/date-picker";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";
import OverviewView from "./OverviewView";

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

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function csvCell(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function isWithinDueDateRange(value, start, end) {
  if (!start && !end) return true;
  var dueDate = parseDateValue(value);
  if (!dueDate) return false;
  if (start) {
    var startDate = parseDateValue(start);
    if (startDate) {
      startDate.setHours(0, 0, 0, 0);
      if (dueDate < startDate) return false;
    }
  }
  if (end) {
    var endDate = parseDateValue(end);
    if (endDate) {
      endDate.setHours(23, 59, 59, 999);
      if (dueDate > endDate) return false;
    }
  }
  return true;
}

var WORK_ORDER_VIRTUAL_THRESHOLD = 80;
var WORK_ORDER_VIRTUAL_MAX_HEIGHT = "min(72vh, 960px)";
var WORK_ORDER_GRID_TEMPLATE = "92px 120px 72px 92px 220px 140px 120px 96px 96px 96px 100px 88px 88px 88px 84px 88px 88px 88px";
var WORK_ORDER_TABLE_MIN_WIDTH = "1856px";
var WORK_ORDER_COLUMNS = [
  { field: "woNum", label: "WO#" },
  { field: "product", label: "Product" },
  { field: "batchCount", label: "Batch", title: "Open work orders sharing the same item" },
  { field: "skuType", label: "SKU Type" },
  { field: "desc", label: "Product Description" },
  { field: "customer", label: "Customer" },
  { field: "status", label: "WO Status" },
  { field: "dueDate", label: "Due" },
  { field: "qty", label: "Order Qty" },
  { field: "produced", label: "Produced" },
  { field: "remaining", label: "Remaining" },
  { field: "complete", label: "Complete" },
  { field: "committedCanMake", label: "Net", title: "Capacity after shared-material commitments across active work orders" },
  { field: "readiness", label: "Ready", title: "Net capacity as a percent of remaining units" },
  { field: "commitmentGap", label: "Gap", title: "Difference between isolated make and commitment-aware net capacity" },
  { field: "estHours", label: "Est Hrs" },
  { field: "dispatchRank", label: "Run Next", title: "Run Next rank from dispatch scoring" },
  { field: "dispatchScore", label: "Score", title: "Run Next weighted score (higher = stronger candidate)" }
];

export default function WorkOrdersView({ analysis, woStatuses, woCustomers, recommendations, dispatchQueue, inboundCoverage, initialFilters, onPermalinkChange }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, thDS, tdDN, tdDM, truncate } = useStyles();
  var initial = initialFilters || {};

  const [searchTerm, setSearchTerm] = useState(String(initial.q || ""));
  const [filterStatus, setFilterStatus] = useState(String(initial.runStatus || "all"));
  const [filterWoStatus, setFilterWoStatus] = useState(String(initial.woStatus || "Booked"));
  const [filterCustomer, setFilterCustomer] = useState(String(initial.customer || "all"));
  const [filterDateFrom, setFilterDateFrom] = useState(String(initial.start || ""));
  const [filterDateTo, setFilterDateTo] = useState(String(initial.end || ""));
  const [filterPackType, setFilterPackType] = useState(String(initial.packType || "all"));
  const [filterPastDue, setFilterPastDue] = useState(!!initial.pastDue);
  const [filterShared, setFilterShared] = useState(!!initial.shared);
  const [filterRunNext, setFilterRunNext] = useState(!!initial.runNext);
  const [filterBatchable, setFilterBatchable] = useState(!!initial.batchable);
  const [runNextLimit, setRunNextLimit] = useState(String(initial.runNextLimit || "12"));
  const [sortField, setSortField] = useState(initial.sortField === "maxRunnable" ? "committedCanMake" : String(initial.sortField || "readiness"));
  const [sortDir, setSortDir] = useState(String(initial.sortDir || "desc"));
  const [expandedWOs, setExpandedWOs] = useState({});
  const workOrdersScrollRef = useRef(null);

  var runStatusMeta = function(s) {
    if (s === "ready") return { label:"RDY", variant:"success" };
    if (s === "partial") return { label:"PRT", variant:"warning" };
    if (s === "nobom") return { label:"BOM", variant:"info" };
    return { label:"BLK", variant:"danger" };
  };
  var normalizeSearchValue = function(v) {
    return normalizeStr(String(v || "")).replace(/[^a-z0-9]/g, "");
  };
  var fmtNum = function(v) {
    var n = safeNum(v);
    if (!isFinite(n)) return "--";
    return n.toLocaleString();
  };
  var fmtQty = function(v) {
    var n = Number(v || 0);
    if (!isFinite(n)) return "--";
    return Math.round(n).toLocaleString();
  };
  var normalizeSkuSearchValue = function(v) {
    var s = normalizeSearchValue(v);
    return s.replace(/^0+(?=\d)/, "");
  };
  var buildSkuLookupKeys = function(v) {
    var raw = String(v || "").trim();
    var keys = [raw.toLowerCase(), normalizeSearchValue(raw), normalizeSkuSearchValue(raw)].filter(Boolean);
    return Array.from(new Set(keys));
  };
  var matchesWorkOrderSearch = function(wo, qRaw, qNorm, qSku) {
    var textFields = [
      wo.woNum,
      wo.productSkuRaw,
      wo.productSku,
      wo.productDesc,
      wo.customer,
      wo.reference1,
      wo.status
    ];
    var textMatch = textFields.some(function(v) {
      var raw = String(v || "").toLowerCase();
      if (raw.includes(qRaw)) return true;
      var norm = normalizeSearchValue(v);
      return !!qNorm && norm.includes(qNorm);
    });
    if (textMatch) return true;
    var woSkuRaw = normalizeSkuSearchValue(wo.productSkuRaw);
    if (qSku && woSkuRaw && woSkuRaw.includes(qSku)) return true;
    return (wo.components || []).some(function(comp) {
      var compSku = normalizeSkuSearchValue(comp.sku);
      if (qSku && compSku && compSku.includes(qSku)) return true;
      if (String(comp.sku || "").toLowerCase().includes(qRaw)) return true;
      if (normalizeSearchValue(comp.desc).includes(qNorm)) return true;
      return (comp.optionDetails || []).some(function(opt) {
        var optSku = normalizeSkuSearchValue(opt.sku);
        if (qSku && optSku && optSku.includes(qSku)) return true;
        if (String(opt.sku || "").toLowerCase().includes(qRaw)) return true;
        return normalizeSearchValue(opt.desc).includes(qNorm);
      });
    });
  };
  var shortWoStatus = function(status) {
    var raw = String(status || "").trim();
    if (!raw) return "--";
    var norm = normalizeStr(raw);
    if (norm.includes("book")) return "BKD";
    if (norm.includes("sched")) return "SCH";
    if (norm.includes("release")) return "REL";
    if (norm.includes("complete")) return "CMP";
    if (norm.includes("close")) return "CLS";
    if (norm.includes("cancel")) return "CXL";
    return raw.length > 4 ? raw.slice(0, 4).toUpperCase() : raw.toUpperCase();
  };

  useEffect(function() {
    if (!onPermalinkChange) return;
    onPermalinkChange({
      q: searchTerm || "",
      runStatus: filterStatus,
      woStatus: filterWoStatus,
      customer: filterCustomer,
      start: filterDateFrom || "",
      end: filterDateTo || "",
      packType: filterPackType,
      pastDue: !!filterPastDue,
      shared: !!filterShared,
      runNext: !!filterRunNext,
      batchable: !!filterBatchable,
      runNextLimit: runNextLimit,
      sortField: sortField,
      sortDir: sortDir
    });
  }, [onPermalinkChange, searchTerm, filterStatus, filterWoStatus, filterCustomer, filterDateFrom, filterDateTo, filterPackType, filterPastDue, filterShared, filterRunNext, filterBatchable, runNextLimit, sortField, sortDir]);

  var handleSort = f => { if (sortField === f) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortField(f); setSortDir("desc"); } };
  var woCommitKey = buildWorkOrderCommitKey;
  var getWorkOrderRowKey = function(wo, idx) {
    var key = woCommitKey(wo);
    return key || [wo && wo.woNum ? wo.woNum : "", idx].join("|");
  };
  var toggleExpandedWorkOrder = function(rowKey) {
    setExpandedWOs(function(prev) {
      var next = Object.assign({}, prev);
      if (next[rowKey]) delete next[rowKey];
      else next[rowKey] = true;
      return next;
    });
  };

  var parseDueDateTs = function(v) {
    var d = parseDateValue(v);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
  };
  var isPastDueWorkOrder = function(wo) {
    if (!wo) return false;
    if (statusLooksClosed(wo.status)) return false;
    if (Number(wo.unitsRemaining || 0) <= 0) return false;
    var dueDate = parseDateValue(wo.dueDate);
    if (!dueDate) return false;
    dueDate.setHours(0, 0, 0, 0);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return dueDate.getTime() < today.getTime();
  };
  var batchOpportunityKey = function(wo) {
    if (!wo) return "";
    var rawSku = String(wo.productSkuRaw || wo.productSku || "").trim();
    if (!rawSku) return "";
    return normalizeSkuSearchValue(rawSku) || normalizeSearchValue(rawSku);
  };
  var isBatchOpportunityEligible = function(wo) {
    if (!wo) return false;
    if (statusLooksClosed(wo.status)) return false;
    return Number(wo.unitsRemaining || 0) > 0 && !!batchOpportunityKey(wo);
  };

  var commitmentMap = useMemo(() => {
    return buildWorkOrderCommitmentMap(analysis && analysis.results ? analysis.results : []);
  }, [analysis]);

  var getNetReadyPct = function(wo, commitment) {
    if (!wo || wo.runStatus === "nobom" || safeNum(wo.readiness) < 0) return null;
    var remaining = safeNum(wo.unitsRemaining);
    if (remaining <= 0) return 100;
    var netUnits = safeNum(commitment && commitment.committedCanMake);
    return Math.max(0, Math.min(100, Math.round(netUnits / remaining * 100)));
  };

  var sharedComponentUsage = useMemo(function() {
    if (!analysis) return {};
    var usage = {};
    (analysis.results || []).forEach(function(wo) {
      if (wo.runStatus === "nobom") return;
      if (statusLooksClosed(wo.status)) return;
      var seen = {};
      (wo.components || []).forEach(function(comp) {
        var key = normalizeStr(comp.sku || "");
        if (!key || seen[key]) return;
        seen[key] = true;
        usage[key] = (usage[key] || 0) + 1;
      });
    });
    return usage;
  }, [analysis]);

  var skuTypeOptions = useMemo(function() {
    if (!analysis) return [];
    var set = {};
    (analysis.results || []).forEach(function(wo) {
      var t = detectPackType(wo.productDesc || wo.productSkuRaw || "", wo.productSkuRaw || wo.productSku || "");
      if (t) set[t] = true;
    });
    return Object.keys(set).sort(function(a, b) {
      var an = parseInt(String(a || "").replace(/\D/g, ""), 10);
      var bn = parseInt(String(b || "").replace(/\D/g, ""), 10);
      var aNum = isNaN(an) ? Number.POSITIVE_INFINITY : an;
      var bNum = isNaN(bn) ? Number.POSITIVE_INFINITY : bn;
      if (aNum !== bNum) return aNum - bNum;
      return String(a || "").localeCompare(String(b || ""));
    });
  }, [analysis]);

  var runNextSelection = useMemo(function() {
    var dispatchRows = (dispatchQueue || []).filter(function(r) {
      return !!r && !!r.woNum;
    }).slice().sort(function(a, b) {
      var aNet = Number(a && a.netUnits || 0);
      var bNet = Number(b && b.netUnits || 0);
      var aRunnable = aNet > 0;
      var bRunnable = bNet > 0;
      if (aRunnable !== bRunnable) return bRunnable ? 1 : -1;
      if (bNet !== aNet) return bNet - aNet;
      return Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    });
    var target = parseInt(runNextLimit, 10) || 12;
    var isRunnable = function(r) { return r.action !== "Hold / Replenish"; };
    var selected = [];
    var seen = {};
    dispatchRows.forEach(function(r) {
      if (selected.length >= target) return;
      var k = String(r.woNum || "");
      if (!k || seen[k] || !isRunnable(r)) return;
      seen[k] = true;
      selected.push(r);
    });
    if (selected.length < target) {
      dispatchRows.forEach(function(r) {
        if (selected.length >= target) return;
        var k = String(r.woNum || "");
        if (!k || seen[k]) return;
        seen[k] = true;
        selected.push(r);
      });
    }
    var set = {};
    var map = {};
    selected.forEach(function(r, idx) {
      var k = String(r.woNum);
      set[k] = true;
      map[k] = {
        rank: idx + 1,
        score: Number(r.priorityScore || 0),
        action: r.action || "",
        why: r.why || ""
      };
    });
    return { set:set, map:map };
  }, [dispatchQueue, runNextLimit]);
  var runNextWoSet = runNextSelection.set;
  var runNextMetaMap = runNextSelection.map;

  var hasSharedComponent = function(wo) {
    return (wo.components || []).some(function(comp) {
      var key = normalizeStr(comp.sku || "");
      return !!key && (sharedComponentUsage[key] || 0) > 1;
    });
  };

  var searchQuery = useMemo(function() {
    var qRaw = String(searchTerm || "").toLowerCase().trim();
    return {
      active: !!qRaw,
      qRaw: qRaw,
      qNorm: normalizeSearchValue(qRaw),
      qSku: normalizeSkuSearchValue(qRaw)
    };
  }, [searchTerm]);

  var matchesScopedFilters = function(wo, options) {
    var opts = options || {};
    if (filterCustomer !== "all" && wo.customer !== filterCustomer) return false;
    if (!isWithinDueDateRange(wo.dueDate, filterDateFrom, filterDateTo)) return false;
    if (searchQuery.active && !matchesWorkOrderSearch(wo, searchQuery.qRaw, searchQuery.qNorm, searchQuery.qSku)) return false;
    if (filterPastDue && !isPastDueWorkOrder(wo)) return false;
    if (opts.includeWoStatus !== false && filterWoStatus !== "all" && wo.status !== filterWoStatus) return false;
    if (filterStatus !== "all" && wo.runStatus !== filterStatus) return false;
    if (filterShared && !hasSharedComponent(wo)) return false;
    if (filterRunNext && !runNextWoSet[String(wo.woNum || "")]) return false;
    if (filterPackType !== "all" && detectPackType(wo.productDesc || wo.productSkuRaw || "", wo.productSkuRaw || wo.productSku || "") !== filterPackType) return false;
    return true;
  };

  var batchScopeResults = useMemo(function() {
    if (!analysis) return [];
    return (analysis.results || []).filter(function(wo) { return matchesScopedFilters(wo); });
  }, [analysis, filterCustomer, filterDateFrom, filterDateTo, filterPackType, filterPastDue, filterShared, filterRunNext, filterStatus, filterWoStatus, runNextWoSet, searchQuery, sharedComponentUsage]);

  var batchOpportunityGroups = useMemo(function() {
    var grouped = {};
    batchScopeResults.forEach(function(wo) {
      if (!isBatchOpportunityEligible(wo)) return;
      var key = batchOpportunityKey(wo);
      if (!key) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(wo);
    });
    return Object.keys(grouped).map(function(key) {
      var rows = grouped[key].slice().sort(function(a, b) {
        var dt = parseDueDateTs(a.dueDate) - parseDueDateTs(b.dueDate);
        if (dt !== 0) return dt;
        return String(a.woNum || "").localeCompare(String(b.woNum || ""), undefined, { numeric:true, sensitivity:"base" });
      });
      return {
        key: key,
        itemLabel: rows[0] ? (rows[0].productSkuRaw || rows[0].productSku || "--") : "--",
        batchCount: rows.length,
        totalRemainingUnits: rows.reduce(function(sum, row) { return sum + Number(row.unitsRemaining || 0); }, 0),
        dueStart: rows[0] ? rows[0].dueDate : "",
        dueEnd: rows[rows.length - 1] ? rows[rows.length - 1].dueDate : "",
        woNums: rows.map(function(row) { return String(row.woNum || "").trim(); }).filter(Boolean),
        rows: rows
      };
    }).filter(function(group) {
      return group.batchCount > 1;
    }).sort(function(a, b) {
      if (b.batchCount !== a.batchCount) return b.batchCount - a.batchCount;
      return b.totalRemainingUnits - a.totalRemainingUnits;
    });
  }, [batchScopeResults]);

  var batchOpportunityMap = useMemo(function() {
    var map = {};
    batchOpportunityGroups.forEach(function(group) {
      group.rows.forEach(function(wo, idx) {
        map[woCommitKey(wo)] = {
          batchCount: group.batchCount,
          totalRemainingUnits: group.totalRemainingUnits,
          dueStart: group.dueStart,
          dueEnd: group.dueEnd,
          woNums: group.woNums,
          sequenceIndex: idx + 1
        };
      });
    });
    return map;
  }, [batchOpportunityGroups]);

  var pageScopeResults = useMemo(function() {
    return batchScopeResults.filter(function(wo) {
      return !filterBatchable || !!batchOpportunityMap[woCommitKey(wo)];
    });
  }, [batchScopeResults, filterBatchable, batchOpportunityMap]);

  var filteredAnalysis = useMemo(function() {
    if (!analysis) return null;
    return Object.assign({}, analysis, { results:pageScopeResults.slice() });
  }, [analysis, pageScopeResults]);

  var filteredResults = useMemo(() => {
    var r = pageScopeResults.slice();
    r.sort((a,b) => {
      var c = 0;
      if (sortField==="woNum") c=a.woNum.localeCompare(b.woNum);
      else if (sortField==="product") c=a.productSkuRaw.localeCompare(b.productSkuRaw);
      else if (sortField==="batchCount") {
        var ab = batchOpportunityMap[woCommitKey(a)] ? batchOpportunityMap[woCommitKey(a)].batchCount : 0;
        var bb = batchOpportunityMap[woCommitKey(b)] ? batchOpportunityMap[woCommitKey(b)].batchCount : 0;
        c = ab - bb;
        if (c === 0) {
          var au = batchOpportunityMap[woCommitKey(a)] ? batchOpportunityMap[woCommitKey(a)].totalRemainingUnits : 0;
          var bu = batchOpportunityMap[woCommitKey(b)] ? batchOpportunityMap[woCommitKey(b)].totalRemainingUnits : 0;
          c = au - bu;
        }
      }
      else if (sortField==="desc") c=(a.productDesc||"").localeCompare(b.productDesc||"");
      else if (sortField==="skuType") {
        var at = detectPackType(a.productDesc || a.productSkuRaw || "", a.productSkuRaw || a.productSku || "");
        var bt = detectPackType(b.productDesc || b.productSkuRaw || "", b.productSkuRaw || b.productSku || "");
        c = at.localeCompare(bt, undefined, { numeric:true, sensitivity:"base" });
      }
      else if (sortField==="customer") c=(a.customer||"").localeCompare(b.customer||"");
      else if (sortField==="qty") c=a.qtyToProduce-b.qtyToProduce;
      else if (sortField==="produced") c=a.unitsProduced-b.unitsProduced;
      else if (sortField==="remaining") c=a.unitsRemaining-b.unitsRemaining;
      else if (sortField==="complete") c=a.prodPct-b.prodPct;
      else if (sortField==="committedCanMake") {
        var ac = commitmentMap[woCommitKey(a)] ? commitmentMap[woCommitKey(a)].committedCanMake : 0;
        var bc = commitmentMap[woCommitKey(b)] ? commitmentMap[woCommitKey(b)].committedCanMake : 0;
        c = ac - bc;
      }
      else if (sortField==="commitmentGap") {
        var ag = commitmentMap[woCommitKey(a)] ? commitmentMap[woCommitKey(a)].commitmentGap : 0;
        var bg = commitmentMap[woCommitKey(b)] ? commitmentMap[woCommitKey(b)].commitmentGap : 0;
        c = ag - bg;
      }
      else if (sortField==="readiness") {
        var arPct = getNetReadyPct(a, commitmentMap[woCommitKey(a)]);
        var brPct = getNetReadyPct(b, commitmentMap[woCommitKey(b)]);
        c = (arPct == null ? -1 : arPct) - (brPct == null ? -1 : brPct);
      }
      else if (sortField==="estHours") c=a.estHours-b.estHours;
      else if (sortField==="dispatchRank") {
        var ar = runNextMetaMap[String(a.woNum || "")] ? runNextMetaMap[String(a.woNum || "")].rank : Number.POSITIVE_INFINITY;
        var br = runNextMetaMap[String(b.woNum || "")] ? runNextMetaMap[String(b.woNum || "")].rank : Number.POSITIVE_INFINITY;
        c = ar - br;
      } else if (sortField==="dispatchScore") {
        var as = runNextMetaMap[String(a.woNum || "")] ? runNextMetaMap[String(a.woNum || "")].score : 0;
        var bs = runNextMetaMap[String(b.woNum || "")] ? runNextMetaMap[String(b.woNum || "")].score : 0;
        c = as - bs;
      }
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
      } else if (sortField==="status") {
        c = (a.status||"").localeCompare(b.status||"");
        if (c === 0) {
          // Deterministic secondary sort so repeated clicks always visibly re-order.
          var aDue = parseDateValue(a.dueDate);
          var bDue = parseDateValue(b.dueDate);
          var aDueMissing = !aDue;
          var bDueMissing = !bDue;
          if (aDueMissing && !bDueMissing) c = 1;
          else if (!aDueMissing && bDueMissing) c = -1;
          else if (!aDueMissing && !bDueMissing) c = aDue.getTime() - bDue.getTime();
          if (c === 0) c = (a.woNum || "").localeCompare(b.woNum || "");
        }
      }
      return sortDir==="desc"?-c:c;
    });
    return r;
  }, [pageScopeResults, sortField, sortDir, commitmentMap, runNextMetaMap, batchOpportunityMap]);
  var enableVirtualRows = filteredResults.length >= WORK_ORDER_VIRTUAL_THRESHOLD;
  var workOrderRowVirtualizer = useVirtualizer({
    count: enableVirtualRows ? filteredResults.length : 0,
    getScrollElement: function() {
      return workOrdersScrollRef.current;
    },
    estimateSize: function(index) {
      var row = filteredResults[index];
      var rowKey = getWorkOrderRowKey(row, index);
      return expandedWOs[rowKey] ? 360 : 52;
    },
    overscan: 8,
    getItemKey: function(index) {
      return getWorkOrderRowKey(filteredResults[index], index);
    }
  });

  useEffect(function() {
    if (!enableVirtualRows) return;
    workOrderRowVirtualizer.measure();
  }, [enableVirtualRows, expandedWOs, filteredResults.length, workOrderRowVirtualizer]);

  var commitmentSummary = useMemo(function() {
    if (!analysis) return null;
    var atRisk = 0;
    var reducedUnits = 0;
    pageScopeResults.forEach(function(wo) {
      var c = commitmentMap[woCommitKey(wo)];
      if (!c) return;
      if (c.commitmentGap > 0) {
        atRisk += 1;
        reducedUnits += c.commitmentGap;
      }
    });
    return { atRisk:atRisk, reducedUnits:reducedUnits };
  }, [analysis, pageScopeResults, commitmentMap]);

  var woStatusBreakdown = useMemo(function() {
    if (!analysis) return [];
    var r = (analysis.results || []).filter(function(wo) {
      return matchesScopedFilters(wo, { includeWoStatus:false });
    });
    if (filterBatchable) r = r.filter(function(wo) { return !!batchOpportunityMap[woCommitKey(wo)]; });
    var map = {};
    r.forEach(function(w) {
      var key = String(w.status || "--").trim() || "--";
      if (!map[key]) map[key] = { status:key, woCount:0, qtyUnits:0 };
      map[key].woCount += 1;
      map[key].qtyUnits += Number(w.qtyToProduce || 0);
    });
    return Object.values(map).sort(function(a, b) { return b.qtyUnits - a.qtyUnits; });
  }, [analysis, filterBatchable, filterCustomer, filterDateFrom, filterDateTo, filterPackType, filterPastDue, filterShared, filterRunNext, filterStatus, searchQuery, sharedComponentUsage, runNextWoSet, batchOpportunityMap]);

  var packMixBreakdown = useMemo(function() {
    var byType = {};
    filteredResults.forEach(function(w) {
      var t = detectPackType(w.productDesc || w.productSkuRaw || "", w.productSkuRaw || w.productSku || "");
      if (!byType[t]) byType[t] = { packType:t, woCount:0, remainingUnits:0, orderUnits:0 };
      byType[t].woCount += 1;
      byType[t].remainingUnits += Number(w.unitsRemaining || 0);
      byType[t].orderUnits += Number(w.qtyToProduce || 0);
    });
    return Object.values(byType).sort(function(a, b) {
      var an = parseInt(String(a.packType || "").replace(/\D/g, ""), 10);
      var bn = parseInt(String(b.packType || "").replace(/\D/g, ""), 10);
      var aNum = isNaN(an) ? Number.POSITIVE_INFINITY : an;
      var bNum = isNaN(bn) ? Number.POSITIVE_INFINITY : bn;
      if (aNum !== bNum) return aNum - bNum;
      return b.remainingUnits - a.remainingUnits;
    });
  }, [filteredResults]);
  var packMixTotalRemaining = useMemo(function() {
    return packMixBreakdown.reduce(function(sum, row) { return sum + Number(row.remainingUnits || 0); }, 0);
  }, [packMixBreakdown]);

  var inboundCoverageMap = useMemo(function() {
    var map = {};
    var rows = inboundCoverage && Array.isArray(inboundCoverage.rows) ? inboundCoverage.rows : [];
    rows.forEach(function(row) {
      buildSkuLookupKeys(row && row.sku).forEach(function(key) {
        if (key && !map[key]) map[key] = row;
      });
    });
    return map;
  }, [inboundCoverage]);
  var inboundCoverageForSku = function(sku) {
    var keys = buildSkuLookupKeys(sku);
    for (var i = 0; i < keys.length; i++) {
      if (inboundCoverageMap[keys[i]]) return inboundCoverageMap[keys[i]];
    }
    return null;
  };

  var exportScopeLabel = useMemo(function() {
    var parts = [];
    if (searchTerm) parts.push('Search: "' + searchTerm + '"');
    if (filterCustomer !== "all") parts.push("Customer: " + filterCustomer);
    if (filterDateFrom || filterDateTo) parts.push("Due: " + (filterDateFrom || "Any") + " to " + (filterDateTo || "Any"));
    if (filterPackType !== "all") parts.push("Pack: " + filterPackType);
    if (filterWoStatus !== "all") parts.push("WO status: " + filterWoStatus);
    if (filterPastDue) parts.push("Past Due");
    if (filterStatus !== "all") parts.push("Run status: " + filterStatus);
    if (filterRunNext) parts.push("Run Next");
    if (filterBatchable) parts.push("Batch");
    if (filterShared) parts.push("Shared");
    return parts.length ? parts.join(" • ") : "All work orders in current view";
  }, [searchTerm, filterCustomer, filterDateFrom, filterDateTo, filterPackType, filterWoStatus, filterPastDue, filterStatus, filterRunNext, filterBatchable, filterShared]);

  var exportWorkOrderRows = useMemo(function() {
    return filteredResults.map(function(wo) {
      var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0 };
      var batchMeta = batchOpportunityMap[woCommitKey(wo)] || null;
      var runMeta = runNextMetaMap[String(wo.woNum || "")] || null;
      var readyPct = getNetReadyPct(wo, commitment);
      return {
        woNum: wo.woNum || "",
        productSku: wo.productSkuRaw || wo.productSku || "",
        description: formatDescriptionForDisplay(wo.productDesc) || "",
        customer: wo.customer || "",
        woStatus: wo.status || "",
        runStatus: wo.runStatus || "",
        dueDate: wo.dueDate || "",
        plannedStart: wo.plannedStart || "",
        plannedEnd: wo.plannedEnd || "",
        orderQty: Number(wo.qtyToProduce || 0),
        produced: Number(wo.unitsProduced || 0),
        remaining: Number(wo.unitsRemaining || 0),
        completePct: Number(wo.prodPct || 0),
        readinessPct: readyPct,
        netUnits: Number(commitment.committedCanMake || 0),
        gapUnits: Number(commitment.commitmentGap || 0),
        estHours: Number(wo.estHours || 0),
        reference: wo.reference1 || "",
        batchCount: batchMeta ? Number(batchMeta.batchCount || 0) : 0,
        runNextRank: runMeta ? Number(runMeta.rank || 0) : null,
        runNextScore: runMeta ? Number(runMeta.score || 0) : null
      };
    });
  }, [filteredResults, commitmentMap, batchOpportunityMap, runNextMetaMap]);

  var exportShortageRows = useMemo(function() {
    var rows = [];
    filteredResults.forEach(function(wo) {
      var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0, componentPressure:{} };
      var readyPct = getNetReadyPct(wo, commitment);
      var shortageComponents = (wo.components || []).filter(function(comp) { return Number(comp.short || 0) > 0; });
      shortageComponents.forEach(function(comp) {
        var compKey = normalizeStr(comp.sku || "");
        var compPressure = commitment.componentPressure ? commitment.componentPressure[compKey] : null;
        var coverage = inboundCoverageForSku(comp.sku);
        var altOptions = (comp.optionDetails || []).map(function(opt) {
          return (opt.isSub ? "ALT " : "PRI ") + String(opt.sku || "") + " (" + fmtQty(opt.onHand || 0) + ")";
        }).join(" | ");
        rows.push({
          woNum: wo.woNum || "",
          productSku: wo.productSkuRaw || wo.productSku || "",
          description: formatDescriptionForDisplay(wo.productDesc) || "",
          customer: wo.customer || "",
          woStatus: wo.status || "",
          runStatus: wo.runStatus || "",
          dueDate: wo.dueDate || "",
          plannedStart: wo.plannedStart || "",
          plannedEnd: wo.plannedEnd || "",
          orderQty: Number(wo.qtyToProduce || 0),
          produced: Number(wo.unitsProduced || 0),
          remaining: Number(wo.unitsRemaining || 0),
          readinessPct: readyPct,
          netUnits: Number(commitment.committedCanMake || 0),
          gapUnits: Number(commitment.commitmentGap || 0),
          estHours: Number(wo.estHours || 0),
          componentSku: comp.sku || "",
          componentDesc: formatDescriptionForDisplay(comp.desc) || "",
          qtyPer: Number(comp.qtyPer || 0),
          needed: Number(comp.needed || 0),
          onHand: Number(comp.onHand || 0),
          shortQty: Number(comp.short || 0),
          fillPct: Math.round(Math.min(Number(comp.fillRate || 0), 100)),
          sharedComponent: (sharedComponentUsage[compKey] || 0) > 1 ? "Yes" : "No",
          sharedWoCount: Number(sharedComponentUsage[compKey] || 0),
          allocatedBefore: compPressure ? Number(compPressure.consumedBefore || 0) : 0,
          availableAtTurn: compPressure ? Number(compPressure.availableAtTurn || 0) : Number(comp.onHand || 0),
          turnMakeUnits: compPressure ? Number(compPressure.turnMakeUnits || 0) : 0,
          altOptions: altOptions,
          vendorInboundAskQty: Number(comp.short || 0),
          inboundQty: coverage ? Number(coverage.inboundQty || 0) : 0,
          scheduledQty: coverage ? Number(coverage.scheduledQty || 0) : 0,
          unscheduledQty: coverage ? Number(coverage.unscheduledQty || 0) : 0,
          uncoveredQty: coverage ? Number(coverage.uncoveredQty || 0) : Number(comp.short || 0),
          coveragePct: coverage ? Number(coverage.coveragePct || 0) : 0,
          scheduledCoveragePct: coverage ? Number(coverage.scheduledCoveragePct || 0) : 0,
          inboundStatus: coverage ? String(coverage.status || "") : "missing",
          recommendedAction: coverage ? String(coverage.recommendedAction || "") : "Create / Expedite PO",
          earliestInboundDate: coverage ? String(coverage.earliestInboundDate || "") : "",
          earliestScheduledDate: coverage ? String(coverage.earliestScheduledDate || "") : "",
          openPOs: coverage && Array.isArray(coverage.openPOs) ? coverage.openPOs.join(", ") : "",
          scheduledPOs: coverage && Array.isArray(coverage.scheduledPOs) ? coverage.scheduledPOs.join(", ") : "",
          dockStatuses: coverage && Array.isArray(coverage.dockStatuses) ? coverage.dockStatuses.join(", ") : ""
        });
      });
    });
    return rows;
  }, [filteredResults, commitmentMap, sharedComponentUsage, inboundCoverageMap]);

  var exportShortageSummary = useMemo(function() {
    var grouped = {};
    exportShortageRows.forEach(function(row) {
      var key = normalizeStr(row.componentSku || "");
      if (!key) return;
      if (!grouped[key]) {
        grouped[key] = {
          componentSku: row.componentSku,
          componentDesc: row.componentDesc,
          totalShortQty: 0,
          maxOnHand: 0,
          earliestDueDate: row.dueDate || "",
          customers: {},
          woNums: {},
          altOptions: {},
          sharedWoCount: row.sharedWoCount || 0
        };
      }
      var agg = grouped[key];
      agg.totalShortQty += Number(row.shortQty || 0);
      agg.maxOnHand = Math.max(agg.maxOnHand, Number(row.onHand || 0));
      if (row.dueDate) {
        var currentDue = parseDateValue(agg.earliestDueDate);
        var nextDue = parseDateValue(row.dueDate);
        if (!currentDue || (nextDue && nextDue.getTime() < currentDue.getTime())) agg.earliestDueDate = row.dueDate;
      }
      if (row.customer) agg.customers[row.customer] = true;
      if (row.woNum) agg.woNums[row.woNum] = true;
      if (row.altOptions) agg.altOptions[row.altOptions] = true;
      agg.sharedWoCount = Math.max(agg.sharedWoCount, Number(row.sharedWoCount || 0));
    });
    return Object.values(grouped).map(function(row) {
      return {
        componentSku: row.componentSku,
        componentDesc: row.componentDesc,
        totalShortQty: row.totalShortQty,
        maxOnHand: row.maxOnHand,
        earliestDueDate: row.earliestDueDate,
        customerList: Object.keys(row.customers).sort(),
        woList: Object.keys(row.woNums).sort(function(a, b) { return a.localeCompare(b, undefined, { numeric:true, sensitivity:"base" }); }),
        altOptions: Object.keys(row.altOptions),
        sharedWoCount: row.sharedWoCount,
        inboundQty: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).inboundQty || 0)) || 0,
        scheduledQty: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).scheduledQty || 0)) || 0,
        unscheduledQty: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).unscheduledQty || 0)) || 0,
        uncoveredQty: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).uncoveredQty || 0)) || row.totalShortQty,
        coveragePct: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).coveragePct || 0)) || 0,
        scheduledCoveragePct: (inboundCoverageForSku(row.componentSku) && Number(inboundCoverageForSku(row.componentSku).scheduledCoveragePct || 0)) || 0,
        inboundStatus: (inboundCoverageForSku(row.componentSku) && String(inboundCoverageForSku(row.componentSku).status || "")) || "missing",
        recommendedAction: (inboundCoverageForSku(row.componentSku) && String(inboundCoverageForSku(row.componentSku).recommendedAction || "")) || "Create / Expedite PO",
        earliestInboundDate: (inboundCoverageForSku(row.componentSku) && String(inboundCoverageForSku(row.componentSku).earliestInboundDate || "")) || "",
        earliestScheduledDate: (inboundCoverageForSku(row.componentSku) && String(inboundCoverageForSku(row.componentSku).earliestScheduledDate || "")) || "",
        openPOs: (inboundCoverageForSku(row.componentSku) && Array.isArray(inboundCoverageForSku(row.componentSku).openPOs) ? inboundCoverageForSku(row.componentSku).openPOs : []),
        scheduledPOs: (inboundCoverageForSku(row.componentSku) && Array.isArray(inboundCoverageForSku(row.componentSku).scheduledPOs) ? inboundCoverageForSku(row.componentSku).scheduledPOs : [])
      };
    }).sort(function(a, b) {
      if (b.totalShortQty !== a.totalShortQty) return b.totalShortQty - a.totalShortQty;
      return String(a.componentSku || "").localeCompare(String(b.componentSku || ""), undefined, { numeric:true, sensitivity:"base" });
    });
  }, [exportShortageRows, inboundCoverageMap]);

  var exportCSV = () => {
    if (!analysis || !filteredResults.length) return;
    var headers = [
      "WO#","FG SKU","FG Description","Customer","WO Status","Run Status","Due Date","Planned Start","Planned End",
      "Order Qty","Produced","Remaining","Net","Ready %","Gap","Est Hrs","Batch Count","Run Next Rank","Run Next Score",
      "Component SKU","Component Description","Qty/Unit","Needed","On Hand","Short","Fill %","Shared Component","Shared WO Count",
      "Allocated Before This WO","Available At Turn","Turn Make Units","Alt Options","Vendor Inbound Ask Qty",
      "EDR Inbound Qty","OpenDock Scheduled Qty","Unscheduled Qty","Uncovered Qty","Inbound Coverage %","Scheduled Coverage %",
      "Inbound Status","Recommended Action","Earliest Inbound Date","Earliest Scheduled Date","Open POs","Scheduled POs","Dock Statuses"
    ];
    var detailRows = exportShortageRows.length ? exportShortageRows : exportWorkOrderRows.map(function(row) {
      return Object.assign({}, row, {
        componentSku: "",
        componentDesc: "",
        qtyPer: "",
        needed: "",
        onHand: "",
        shortQty: "",
        fillPct: "",
        sharedComponent: "",
        sharedWoCount: "",
        allocatedBefore: "",
        availableAtTurn: "",
        turnMakeUnits: "",
        altOptions: "",
        vendorInboundAskQty: "",
        inboundQty: "",
        scheduledQty: "",
        unscheduledQty: "",
        uncoveredQty: "",
        coveragePct: "",
        scheduledCoveragePct: "",
        inboundStatus: "",
        recommendedAction: "",
        earliestInboundDate: "",
        earliestScheduledDate: "",
        openPOs: "",
        scheduledPOs: "",
        dockStatuses: ""
      });
    });
    var csvRows = detailRows.map(function(row) {
      return [
        row.woNum,
        row.productSku,
        row.description,
        row.customer,
        row.woStatus,
        row.runStatus,
        row.dueDate,
        row.plannedStart,
        row.plannedEnd,
        row.orderQty,
        row.produced,
        row.remaining,
        row.netUnits,
        row.readinessPct == null ? "N/A" : row.readinessPct,
        row.gapUnits,
        row.estHours || "",
        row.batchCount || "",
        row.runNextRank || "",
        row.runNextScore || "",
        row.componentSku,
        row.componentDesc,
        row.qtyPer,
        row.needed,
        row.onHand,
        row.shortQty,
        row.fillPct,
        row.sharedComponent,
        row.sharedWoCount,
        row.allocatedBefore,
        row.availableAtTurn,
        row.turnMakeUnits,
        row.altOptions,
        row.vendorInboundAskQty,
        row.inboundQty,
        row.scheduledQty,
        row.unscheduledQty,
        row.uncoveredQty,
        row.coveragePct,
        row.scheduledCoveragePct,
        row.inboundStatus,
        row.recommendedAction,
        row.earliestInboundDate,
        row.earliestScheduledDate,
        row.openPOs,
        row.scheduledPOs,
        row.dockStatuses
      ].map(csvCell).join(",");
    });
    triggerDownload(
      [headers.map(csvCell).join(",")].concat(csvRows).join("\n"),
      "packpulse_work_orders_vendor_export_" + new Date().toISOString().slice(0, 10) + ".csv",
      "text/csv"
    );
  };
  var exportPDF = () => {
    if (!analysis || !filteredResults.length) return;
    var totalShortQty = exportShortageSummary.reduce(function(sum, row) { return sum + Number(row.totalShortQty || 0); }, 0);
    var totalInboundQty = exportShortageSummary.reduce(function(sum, row) { return sum + Number(row.inboundQty || 0); }, 0);
    var totalScheduledQty = exportShortageSummary.reduce(function(sum, row) { return sum + Number(row.scheduledQty || 0); }, 0);
    var affectedWOs = {};
    exportShortageRows.forEach(function(row) { if (row.woNum) affectedWOs[row.woNum] = true; });
    var summaryCards = [
      { label: "Scope", value: fmtNum(filteredResults.length) + " WOs" },
      { label: "Shortage Lines", value: fmtNum(exportShortageRows.length) },
      { label: "Short Components", value: fmtNum(exportShortageSummary.length) },
      { label: "Total Short Qty", value: fmtNum(totalShortQty) },
      { label: "Affected WOs", value: fmtNum(Object.keys(affectedWOs).length) },
      { label: "EDR Inbound Qty", value: fmtNum(totalInboundQty) },
      { label: "OpenDock Scheduled", value: fmtNum(totalScheduledQty) }
    ].map(function(card) {
      return '<div class="stat"><div class="stat-label">' + escapeHtml(card.label) + '</div><div class="stat-value">' + escapeHtml(card.value) + '</div></div>';
    }).join("");
    var workOrderRowsHtml = exportWorkOrderRows.map(function(row) {
      return "<tr>" +
        "<td>" + escapeHtml(row.woNum) + "</td>" +
        "<td>" + escapeHtml(row.productSku) + "</td>" +
        "<td>" + escapeHtml(row.customer || "--") + "</td>" +
        "<td>" + escapeHtml(fmtDate(row.dueDate)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.remaining)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.netUnits)) + "</td>" +
        "<td>" + escapeHtml(row.readinessPct == null ? "N/A" : (row.readinessPct + "%")) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.gapUnits)) + "</td>" +
        "<td>" + escapeHtml(row.estHours > 0 ? (row.estHours + "h") : "--") + "</td>" +
        "</tr>";
    }).join("");
    var shortageSummaryHtml = exportShortageSummary.length ? exportShortageSummary.map(function(row) {
      return "<tr>" +
        "<td>" + escapeHtml(row.componentSku) + "</td>" +
        "<td>" + escapeHtml(row.componentDesc || "--") + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.totalShortQty)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.maxOnHand)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.inboundQty)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.scheduledQty)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.uncoveredQty)) + "</td>" +
        "<td>" + escapeHtml(fmtDate(row.earliestDueDate)) + "</td>" +
        "<td>" + escapeHtml(fmtDate(row.earliestScheduledDate)) + "</td>" +
        "<td>" + escapeHtml(row.inboundStatus || "--") + "</td>" +
        "<td>" + escapeHtml(row.recommendedAction || "--") + "</td>" +
        "<td>" + escapeHtml(row.customerList.join(", ") || "--") + "</td>" +
        "<td>" + escapeHtml(row.woList.join(", ") || "--") + "</td>" +
        "<td>" + escapeHtml(row.openPOs.join(", ") || "--") + "</td>" +
        "<td>" + escapeHtml(row.scheduledPOs.join(", ") || "--") + "</td>" +
        "<td>" + escapeHtml(row.altOptions.join(" | ") || "--") + "</td>" +
        "</tr>";
    }).join("") : '<tr><td colspan="14">No component shortages in current scope.</td></tr>';
    var shortageDetailHtml = exportShortageRows.length ? exportShortageRows.map(function(row) {
      return "<tr>" +
        "<td>" + escapeHtml(row.woNum) + "</td>" +
        "<td>" + escapeHtml(row.productSku) + "</td>" +
        "<td>" + escapeHtml(row.componentSku) + "</td>" +
        "<td>" + escapeHtml(row.componentDesc || "--") + "</td>" +
        "<td>" + escapeHtml(fmtDate(row.dueDate)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.remaining)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.needed)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.onHand)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.shortQty)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.inboundQty)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.scheduledQty)) + "</td>" +
        "<td>" + escapeHtml(fmtDate(row.earliestScheduledDate)) + "</td>" +
        "<td>" + escapeHtml(row.inboundStatus || "--") + "</td>" +
        "<td>" + escapeHtml(row.altOptions || "--") + "</td>" +
        "</tr>";
    }).join("") : '<tr><td colspan="13">No component shortages in current scope.</td></tr>';
    var html = [
      "<!DOCTYPE html>",
      "<html><head><title>PackPulse Work Orders Vendor Packet</title><style>",
      "body{font-family:Arial,sans-serif;margin:24px;color:#1f2937}",
      "h1{font-size:22px;margin:0 0 6px} h2{font-size:16px;margin:28px 0 8px}",
      ".sub{color:#6b7280;font-size:12px;margin-bottom:14px}",
      ".stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0 18px}",
      ".stat{border:1px solid #d1d5db;border-radius:10px;padding:10px 12px;min-width:120px;background:#f9fafb}",
      ".stat-label{font-size:11px;text-transform:uppercase;color:#6b7280;margin-bottom:4px}",
      ".stat-value{font-size:20px;font-weight:700;color:#111827}",
      ".scope{margin:10px 0 16px;padding:10px 12px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px;color:#1d4ed8;font-size:12px}",
      "table{width:100%;border-collapse:collapse;margin-top:10px;font-size:11px}",
      "th{background:#f3f4f6;padding:8px;text-align:left;border-bottom:2px solid #d1d5db;font-size:10px;text-transform:uppercase;letter-spacing:.04em}",
      "td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}",
      ".note{font-size:12px;color:#6b7280;margin-top:6px}",
      "@media print{body{margin:12px}.stat{break-inside:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}}",
      "</style></head><body>",
      "<h1>PackPulse Work Orders Vendor Packet</h1>",
      '<div class="sub">Generated ' + escapeHtml(new Date().toLocaleString()) + "</div>",
      '<div class="scope"><strong>Current scope:</strong> ' + escapeHtml(exportScopeLabel) + "</div>",
      '<div class="stats">' + summaryCards + "</div>",
      "<h2>Work Orders In Scope</h2>",
      '<div class="note">This section follows the current filters in the Work Orders view.</div>',
      "<table><thead><tr>",
      "<th>WO#</th><th>FG SKU</th><th>Customer</th><th>Due</th><th>Remaining</th><th>Net</th><th>Ready</th><th>Gap</th><th>Est Hrs</th>",
      "</tr></thead><tbody>",
      workOrderRowsHtml,
      "</tbody></table>",
      "<h2>Component Shortage Summary</h2>",
      '<div class="note">Use this table with vendors to prioritize inbound scheduling by total shortage, EDR inbound quantity, OpenDock scheduled quantity, earliest due date, and affected work orders.</div>',
      "<table><thead><tr>",
      "<th>Component SKU</th><th>Description</th><th>Total Short</th><th>On Hand</th><th>EDR Inbound</th><th>OpenDock Scheduled</th><th>Uncovered</th><th>Earliest Due</th><th>Earliest Scheduled</th><th>Status</th><th>Action</th><th>Customers</th><th>Open POs</th><th>Scheduled POs</th><th>Alternates / Options</th>",
      "</tr></thead><tbody>",
      shortageSummaryHtml,
      "</tbody></table>",
      "<h2>WO-Level Shortage Detail</h2>",
      '<div class="note">Each row shows the specific WO / component shortage plus the current EDR / OpenDock coverage state.</div>',
      "<table><thead><tr>",
      "<th>WO#</th><th>FG SKU</th><th>Component SKU</th><th>Component Description</th><th>Due</th><th>Remaining</th><th>Needed</th><th>On Hand</th><th>Short</th><th>EDR Inbound</th><th>OpenDock Scheduled</th><th>Earliest Scheduled</th><th>Status</th><th>Alternates / Options</th>",
      "</tr></thead><tbody>",
      shortageDetailHtml,
      "</tbody></table>",
      "</body></html>"
    ].join("");
    triggerDownload(
      html,
      "packpulse_work_orders_vendor_packet_" + new Date().toISOString().slice(0, 10) + ".html",
      "text/html"
    );
  };

  var renderSortLabel = function(column) {
    var label = column.title ? <span title={column.title}>{column.label}</span> : column.label;
    return (
      <SortHeaderButton onClick={function() { handleSort(column.field); }} className="text-left">
        {label}{sortField===column.field ? (sortDir==="asc" ? " \u2191" : " \u2193") : ""}
      </SortHeaderButton>
    );
  };

  var SortTh = function(props) {
    return (
      <th style={Object.assign({}, thC(sortField===props.column.field), props.style||{})}>
        {renderSortLabel(props.column)}
      </th>
    );
  };

  var renderWOExpandedDetails = function(wo, commitment, batchMeta, runMeta) {
    var details = [];
    if (runMeta) details.push(
      <div key="dispatch" style={{ fontSize:13, color:C.dim, marginBottom:8 }}>
        <span style={{ fontWeight:700, color:C.accent }}>Run Next #{runMeta.rank}</span>{" \u2022 "}
        <span style={{ fontFamily:mono, color:C.bright }}>Score {runMeta.score}</span>{" \u2022 "}
        <span style={{ color:C.bright }}>{runMeta.action || "Run Next"}</span>
        {runMeta.why ? <span>{" \u2022 " + runMeta.why.replace(/^WO\s+\S+\s+\u2022\s*/i, "")}</span> : null}
      </div>
    );
    if (batchMeta) details.push(
      <div key="batch" style={{ fontSize:13, color:C.dim, marginBottom:8 }}>
        <span style={{ fontWeight:700, color:C.accent }}>Batch opportunity x{batchMeta.batchCount}</span>
        {" \u2022 "}Same item queued on <span style={{ color:C.bright }}>{batchMeta.woNums.join(", ")}</span>
        {" \u2022 "}Remaining <span style={{ color:C.bright, fontFamily:mono }}>{fmtNum(batchMeta.totalRemainingUnits)}</span>
        {" \u2022 "}Due window <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(batchMeta.dueStart)}</span> to <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(batchMeta.dueEnd)}</span>
      </div>
    );
    if (wo.reference1) details.push(<div key="ref" style={{ fontSize:13, color:C.text, marginBottom:8 }}><span style={{ fontSize:12, fontWeight:600, color:C.dim, letterSpacing:0.1, marginRight:6 }}>Notes</span>{wo.reference1}</div>);
    if (wo.plannedStart || wo.plannedEnd) details.push(
      <div key="sched" style={{ fontSize:13, color:C.dim, marginBottom:8, display:"flex", gap:16, flexWrap:"wrap" }}>
        <span>Start: <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(wo.plannedStart)}</span></span>
        <span>End: <span style={{ color:C.bright, fontFamily:mono }}>{fmtDate(wo.plannedEnd)}</span></span>
      </div>
    );
    if (wo.unitsPerHour > 0 || wo.standardPeople > 0) details.push(<div key="ops" style={{ fontSize:13, color:C.dim, marginBottom:8, display:"flex", gap:16 }}>
      {wo.unitsPerHour > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.unitsPerHour}</span> units/hr</span>}
      {wo.standardPeople > 0 && <span><span style={{ fontWeight:600, color:C.bright }}>{wo.standardPeople}</span> crew</span>}
      {wo.prodPct > 0 && <span><span style={{ fontWeight:600, color:wo.prodPct>=100?C.ok:C.accent }}>{wo.prodPct}%</span> complete</span>}
    </div>);
    if (wo.components.length > 0) details.push(
      <div key="bom">
        <div style={{ fontSize:12, fontWeight:600, color:C.accent, marginBottom:6, marginTop:4, letterSpacing:0.1 }}>BOM - {wo.components.length} components</div>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr>
            {["Component","Description","Qty/Unit","Needed","On Hand","Short","Fill %"].map(function(h) { return <th key={h} style={thDS}>{h}</th>; })}
          </tr></thead>
          <tbody>
            {wo.components.slice().sort(function(a, b) {
              return String(a.sku || "").localeCompare(String(b.sku || ""), undefined, { numeric:true, sensitivity:"base" });
            }).map(function(comp, ci) {
              var rows = [];
              var compPressure = commitment.componentPressure ? commitment.componentPressure[normalizeStr(comp.sku || "")] : null;
              var hasCompPressure = !!(compPressure && compPressure.usedByWOs > 1);
              var isNetLimiter = !!(hasCompPressure && compPressure.turnMakeUnits === commitment.committedCanMake && commitment.commitmentGap > 0);
              rows.push(
                <tr key={"c"+ci} style={{ borderBottom:comp.hasSubs?"none":"1px solid "+C.border }}>
                  <td style={Object.assign({}, tdDM, { color:C.bright })}>
                    {comp.sku}
                    {comp.hasSubs && <span style={{ fontSize:13, color:C.accent, marginLeft:3 }}>+alt</span>}
                    {(sharedComponentUsage[normalizeStr(comp.sku || "")] || 0) > 1 && (
                      <Badge title={"Shared component: used in " + sharedComponentUsage[normalizeStr(comp.sku || "")] + " active work orders"} variant="danger" className="ml-1.5 px-1.5 py-0 text-[10px]">
                        Shared
                      </Badge>
                    )}
                    {hasCompPressure && (
                      <div style={{ marginTop:4, fontSize:11, color:C.dim }}>
                        Shared by <span style={{ color:C.bright, fontWeight:700 }}>{compPressure.usedByWOs}</span> WOs
                        {" \u2022 "}Allocated before this WO: <span style={{ color:C.bright, fontFamily:mono }}>{fmtQty(compPressure.consumedBefore)}</span>
                        {" \u2022 "}Available now: <span style={{ color:C.bright, fontFamily:mono }}>{fmtQty(compPressure.availableAtTurn)}</span>
                        {" \u2022 "}Supports up to <span style={{ color:C.bright, fontFamily:mono }}>{fmtQty(compPressure.turnMakeUnits)}</span> WO units
                        {isNetLimiter && (
                          <Badge variant="danger" className="ml-1.5 px-1.5 py-0 text-[10px]">Net limiter</Badge>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={Object.assign({}, tdDN, { color:C.dim }, truncate(150))}>{formatDescriptionForDisplay(comp.desc) || "--"}</td>
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
                      {comp.optionDetails.map(function(opt, oi) { return <span key={oi} style={{ fontSize:12, fontFamily:mono, color:C.dim }}>
                        <span style={{ color:opt.isSub?C.accent:C.ok, fontWeight:600, marginRight:2 }}>{opt.isSub ? "ALT" : "PRI"}</span>{opt.sku} = {opt.onHand.toLocaleString()}
                      </span>; })}
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
    return details;
  };

  var buildWorkOrderViewModel = function(wo, idx) {
    var rowKey = getWorkOrderRowKey(wo, idx);
    var isExpanded = !!expandedWOs[rowKey];
    var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0, sharedConstraint:false };
    var batchMeta = batchOpportunityMap[woCommitKey(wo)] || null;
    var runMeta = runNextMetaMap[String(wo.woNum || "")] || null;
    var rs = runStatusMeta(wo.runStatus);
    var skuType = detectPackType(wo.productDesc || wo.productSkuRaw || "", wo.productSkuRaw || wo.productSku || "");
    var readyPct = getNetReadyPct(wo, commitment);
    return {
      rowKey: rowKey,
      isExpanded: isExpanded,
      detailContent: isExpanded ? renderWOExpandedDetails(wo, commitment, batchMeta, runMeta) : null,
      summaryCells: [
        { key:"woNum", style:Object.assign({}, tdM, { fontWeight:600, color:C.bright }), content:wo.woNum },
        { key:"product", style:tdM, content:wo.productSkuRaw },
        { key:"batchCount", style:Object.assign({}, tdN, { whiteSpace:"nowrap" }), content:batchMeta ? (
          <Badge
            variant="info"
            title={"Batch opportunity across " + batchMeta.batchCount + " open work orders for item " + (wo.productSkuRaw || wo.productSku || "--") + " \u2022 Remaining " + fmtNum(batchMeta.totalRemainingUnits) + " \u2022 WO order: " + batchMeta.woNums.join(", ")}
          >
            {"x" + batchMeta.batchCount}
          </Badge>
        ) : <span style={{ color:C.dim }}>--</span> },
        { key:"skuType", style:Object.assign({}, tdN, { whiteSpace:"nowrap" }), content:<Badge variant="secondary">{skuType}</Badge> },
        { key:"desc", style:Object.assign({}, tdN, { color:C.dim }, truncate(220)), content:formatDescriptionForDisplay(wo.productDesc) || "--" },
        { key:"customer", style:Object.assign({}, tdN, { color:C.dim }, truncate(140)), content:wo.customer || "--" },
        { key:"status", style:Object.assign({}, tdN, { whiteSpace:"nowrap" }), content:<><Badge title={wo.runStatus || ""} variant={rs.variant} className="mr-1 min-w-[34px] justify-center px-1.5 py-0.5 text-[11px] font-bold">{rs.label}</Badge><Badge title={wo.status || ""} variant="secondary" className="min-w-[34px] justify-center px-1.5 py-0.5 text-[11px] font-bold">{shortWoStatus(wo.status)}</Badge></> },
        { key:"dueDate", style:Object.assign({}, tdM, { color:C.text }), content:fmtDate(wo.dueDate) },
        { key:"qty", style:Object.assign({}, tdM, { color:C.bright }), content:wo.qtyToProduce.toLocaleString() },
        { key:"produced", style:Object.assign({}, tdM, { color:wo.unitsProduced>0?C.ok:C.dim }), content:wo.unitsProduced>0?wo.unitsProduced.toLocaleString():"--" },
        { key:"remaining", style:Object.assign({}, tdM, { color:C.bright }), content:wo.unitsRemaining.toLocaleString() },
        { key:"complete", style:Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>=50?C.warn:wo.prodPct>0?C.accent:C.dim }), content:wo.prodPct > 0 ? wo.prodPct+"%" : "--" },
        { key:"committedCanMake", style:Object.assign({}, tdM, { fontWeight:600, color:commitment.committedCanMake>0?C.accent:C.dim }), content:wo.runStatus==="nobom" ? "--" : commitment.committedCanMake.toLocaleString() },
        { key:"readiness", style:Object.assign({}, tdM, { fontWeight:600, color:readyPct == null ? C.dim : readyPct>=100?C.ok:readyPct>=70?C.warn:C.bad }), content:readyPct == null ? <span style={{color:C.dim}}>--</span> : readyPct+"%" },
        { key:"commitmentGap", style:Object.assign({}, tdN, { whiteSpace:"nowrap" }), content:commitment.sharedConstraint ? (
          <Badge title={"Shared material demand across active work orders. Order: earliest due date, then WO #. Net: " + commitment.committedCanMake.toLocaleString() + " | Ready: " + (readyPct == null ? "--" : readyPct + "%") + " | Gap: " + commitment.commitmentGap.toLocaleString()} variant={commitment.commitmentGap > 0 ? "danger" : "warning"}>Shared</Badge>
        ) : <span style={{ color:C.dim }}>--</span> },
        { key:"estHours", style:Object.assign({}, tdM, { color:wo.estHours>0?C.bright:C.dim }), content:wo.estHours > 0 ? wo.estHours+"h" : "--" },
        { key:"dispatchRank", style:Object.assign({}, tdN, { color:runMeta ? C.bright : C.dim, whiteSpace:"nowrap" }), content:runMeta ? <span title={(runMeta.action || "Run Next") + (runMeta.why ? " • " + runMeta.why : "")} style={{ color:C.accent, fontWeight:700 }}>#{runMeta.rank}</span> : "--" },
        { key:"dispatchScore", style:Object.assign({}, tdM, { color:runMeta ? C.bright : C.dim, fontFamily:mono, fontWeight:runMeta ? 700 : 500 }), content:runMeta ? runMeta.score : "--" }
      ]
    };
  };

  var renderWOTableRows = function() {
    if (filteredResults.length === 0) return <tr><td colSpan={WORK_ORDER_COLUMNS.length} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No work orders match filters.</td></tr>;
    var out = [];
    filteredResults.forEach(function(wo, idx) {
      var rowModel = buildWorkOrderViewModel(wo, idx);
      out.push(
        <tr
          key={"r"+rowModel.rowKey}
          onClick={function() { toggleExpandedWorkOrder(rowModel.rowKey); }}
          style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:rowModel.isExpanded?C.raised:"transparent" }}
          onMouseEnter={function(e) { if (!rowModel.isExpanded) e.currentTarget.style.background = C.hover; }}
          onMouseLeave={function(e) { if (!rowModel.isExpanded) e.currentTarget.style.background = "transparent"; }}
        >
          {rowModel.summaryCells.map(function(cell) { return <td key={cell.key} style={cell.style}>{cell.content}</td>; })}
        </tr>
      );
      if (rowModel.isExpanded) {
        out.push(
          <tr key={"d"+rowModel.rowKey}><td colSpan={WORK_ORDER_COLUMNS.length} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            {rowModel.detailContent}
          </td></tr>
        );
      }
    });
    return out;
  };

  var renderVirtualWorkOrders = function() {
    return (
      <div style={{ overflowX:"auto" }}>
        <div style={{ minWidth:WORK_ORDER_TABLE_MIN_WIDTH }}>
          <div role="table" aria-label="Work Orders detail">
            <div role="rowgroup">
              <div role="row" style={{ display:"grid", gridTemplateColumns:WORK_ORDER_GRID_TEMPLATE, background:C.raised, borderBottom:"1px solid "+C.border }}>
                {WORK_ORDER_COLUMNS.map(function(column) {
                  return (
                    <div key={column.field} role="columnheader" style={Object.assign({}, thC(sortField===column.field), { minWidth:0, display:"flex", alignItems:"center" })}>
                      {renderSortLabel(column)}
                    </div>
                  );
                })}
              </div>
            </div>
            <div ref={workOrdersScrollRef} style={{ maxHeight:WORK_ORDER_VIRTUAL_MAX_HEIGHT, overflowY:"auto", position:"relative" }}>
              <div style={{ height:workOrderRowVirtualizer.getTotalSize(), position:"relative" }}>
                {workOrderRowVirtualizer.getVirtualItems().map(function(virtualRow) {
                  var rowModel = buildWorkOrderViewModel(filteredResults[virtualRow.index], virtualRow.index);
                  return (
                    <div
                      key={virtualRow.key}
                      ref={workOrderRowVirtualizer.measureElement}
                      data-index={virtualRow.index}
                      style={{ position:"absolute", top:0, left:0, width:"100%", transform:"translateY(" + virtualRow.start + "px)" }}
                    >
                      <div
                        role="row"
                        onClick={function() { toggleExpandedWorkOrder(rowModel.rowKey); }}
                        style={{ cursor:"pointer", display:"grid", gridTemplateColumns:WORK_ORDER_GRID_TEMPLATE, background:rowModel.isExpanded?C.raised:"transparent", borderBottom:"1px solid "+C.border }}
                        onMouseEnter={function(e) { if (!rowModel.isExpanded) e.currentTarget.style.background = C.hover; }}
                        onMouseLeave={function(e) { if (!rowModel.isExpanded) e.currentTarget.style.background = "transparent"; }}
                      >
                        {rowModel.summaryCells.map(function(cell) {
                          return (
                            <div key={cell.key} role="cell" style={Object.assign({}, cell.style, { minWidth:0, display:"flex", alignItems:"center" })}>
                              {cell.content}
                            </div>
                          );
                        })}
                      </div>
                      {rowModel.isExpanded ? (
                        <div style={{ padding:"0 12px 14px 36px", background:C.raised, borderBottom:"1px solid "+C.border }}>
                          {rowModel.detailContent}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  var handleOverviewCustomerSelect = function(customerName) {
    setFilterCustomer(customerName || "all");
    setTimeout(function() {
      var el = document.getElementById("workorders-table");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  };

  var hasActiveFilters = !!(
    searchTerm ||
    filterCustomer !== "all" ||
    filterWoStatus !== "Booked" ||
    filterDateFrom ||
    filterDateTo ||
    filterStatus !== "all" ||
    filterPackType !== "all" ||
    filterPastDue ||
    filterShared ||
    filterRunNext ||
    filterBatchable
  );

  var clearAllFilters = function() {
    setSearchTerm("");
    setFilterCustomer("all");
    setFilterWoStatus("Booked");
    setFilterDateFrom("");
    setFilterDateTo("");
    setFilterStatus("all");
    setFilterPackType("all");
    setFilterPastDue(false);
    setFilterShared(false);
    setFilterRunNext(false);
    setFilterBatchable(false);
    setRunNextLimit("12");
  };

  var scopeCountLabel = analysis ? (filteredResults.length + " of " + analysis.results.length + " WOs") : "0 WOs";

  return (<div>
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Input type="text" placeholder="Search WO / SKU / customer" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-10 w-full text-sm sm:w-72" />
      <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
        <option value="all">All Customers</option>
        {woCustomers.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={filterWoStatus} onChange={e => setFilterWoStatus(e.target.value)} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
        <option value="all">All WO Status</option>
        {woStatuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>Due from</span>
      <DatePicker value={filterDateFrom} onChange={setFilterDateFrom} placeholder="Start date" className="w-full sm:w-36" />
      <span style={{ fontSize:13, color:C.dim }}>to</span>
      <DatePicker value={filterDateTo} onChange={setFilterDateTo} placeholder="End date" className="w-full sm:w-36" />
      {hasActiveFilters && <Button onClick={clearAllFilters} variant="outline" size="default">Clear</Button>}
      <span style={{ fontSize:13, color:C.dim, marginLeft:4 }}>{scopeCountLabel}</span>
    </div>

    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select
        value={filterStatus}
        onChange={function(e) { setFilterStatus(e.target.value); }}
        className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto"
      >
        <option value="all">All Run Status</option>
        <option value="ready">Ready</option>
        <option value="partial">Partial</option>
        <option value="blocked">Blocked</option>
        <option value="nobom">No BOM</option>
      </select>
      <select value={filterPackType} onChange={e => setFilterPackType(e.target.value)} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
        <option value="all">All SKU Types</option>
        {skuTypeOptions.map(function(t) { return <option key={t} value={t}>{t}</option>; })}
      </select>
      <Button onClick={function() {
        setFilterRunNext(function(v) {
          var next = !v;
          if (next) {
            setFilterWoStatus("all");
            setSortField("dispatchScore");
            setSortDir("desc");
          }
          return next;
        });
      }} variant={filterRunNext ? "active" : "outline"} size="default">Run Next</Button>
      {filterRunNext && (
        <select value={runNextLimit} onChange={function(e) { setRunNextLimit(e.target.value); }} className="h-10 w-full rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))] sm:w-auto">
          <option value="8">Top 8</option>
          <option value="12">Top 12</option>
          <option value="20">Top 20</option>
        </select>
      )}
      <Button onClick={function() { setFilterBatchable(function(v) { return !v; }); }} variant={filterBatchable ? "active" : "outline"} size="default" title="Show same-item work orders that can be batched to reduce changeovers">
        Batch
      </Button>
      <Button onClick={function() { setFilterShared(function(v) { return !v; }); }} variant={filterShared ? "active" : "outline"} size="default">Shared</Button>
      <Button onClick={function() { setFilterPastDue(function(v) { return !v; }); }} variant={filterPastDue ? "active" : "outline"} size="default">Past Due</Button>
      <Button onClick={exportCSV} variant="outline" size="default">CSV</Button>
      <Button onClick={exportPDF} variant="outline" size="default">PDF</Button>
    </div>

    <div style={{ marginBottom:18 }}>
      <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>Work Order Snapshot</div>
      <OverviewView analysis={filteredAnalysis || analysis} onSelectCustomer={handleOverviewCustomerSelect} />
    </div>
    <div id="workorders-table">
    <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>Work Orders Detail</div>
    {commitmentSummary && (
      <div style={{ marginBottom:10, display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <span style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"4px 10px", borderRadius:999, border:"1px solid "+C.border, background:C.surface, fontSize:13, color:C.dim }}>
            <span style={{ fontWeight:700 }}>Gap</span>
            <span style={{ color:C.bad, fontWeight:700 }}>{commitmentSummary.atRisk} WOs</span>
            <span style={{ color:C.bad, fontWeight:700 }}>{fmtNum(commitmentSummary.reducedUnits)} units</span>
          </span>
          {batchOpportunityGroups.length > 0 && (
            <span style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"4px 10px", borderRadius:999, border:"1px solid "+(filterBatchable ? C.accentLine : C.border), background:filterBatchable ? C.accentSoft : C.surface, fontSize:13, color:filterBatchable ? C.accent : C.dim }}>
              <span style={{ fontWeight:700 }}>Batch</span>
              <span style={{ color:filterBatchable ? C.accent : C.bright, fontWeight:700 }}>{batchOpportunityGroups.length} item groups</span>
              <span style={{ color:filterBatchable ? C.accent : C.text, fontWeight:700 }}>
                {fmtNum(batchOpportunityGroups.reduce(function(sum, group) { return sum + group.batchCount; }, 0))} WOs
              </span>
            </span>
          )}
          {woStatusBreakdown.length > 0 && (
            <>
              <span style={{ fontSize:12, color:C.dim, fontWeight:700, letterSpacing:0.2 }}>WO Status Qty</span>
              {woStatusBreakdown.map(function(row) {
                var active = filterWoStatus !== "all" && filterWoStatus === row.status;
                return (
                  <span key={row.status} style={{ display:"inline-flex", alignItems:"center", gap:6, padding:"3px 9px", borderRadius:999, border:"1px solid "+(active ? C.accentLine : C.border), background:active ? C.accentSoft : C.surface, fontSize:12, color:active ? C.accent : C.dim }}>
                    <span style={{ fontWeight:700 }}>{row.status}</span>
                    <span style={{ color:active ? C.accent : C.text }}>{row.woCount}</span>
                    <span style={{ opacity:0.65 }}>/</span>
                    <span style={{ color:active ? C.accent : C.text }}>{fmtNum(row.qtyUnits)}</span>
                  </span>
                );
              })}
            </>
          )}
        </div>

        {packMixBreakdown.length > 0 && (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center" }}>
            <Button onClick={function() { setFilterPackType("all"); }} variant={filterPackType === "all" ? "active" : "outline"} size="sm" className="rounded-full">
              <span style={{ color:C.bright, fontWeight:700 }}>All Packs</span>
              <span style={{ color:C.text }}>{fmtNum(packMixTotalRemaining)}</span>
              <span style={{ color:C.dim }}>(100%)</span>
            </Button>
            {packMixBreakdown.map(function(row) {
              var activePack = filterPackType === row.packType;
              var pct = packMixTotalRemaining > 0 ? (Number(row.remainingUnits || 0) / packMixTotalRemaining) * 100 : 0;
              return (
                <Button key={row.packType} onClick={function() { setFilterPackType(function(curr) { return curr === row.packType ? "all" : row.packType; }); }} variant={activePack ? "active" : "outline"} size="sm" className="rounded-full">
                  <span style={{ color:C.bright, fontWeight:700 }}>{row.packType}</span>
                  <span style={{ color:C.text }}>{fmtNum(row.remainingUnits)}</span>
                  <span style={{ color:C.dim }}>({Math.round(pct)}%)</span>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    )}
    <TableShell>
      {enableVirtualRows ? (
        renderVirtualWorkOrders()
      ) : (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr style={{ background:C.raised }}>
              {WORK_ORDER_COLUMNS.map(function(column) {
                return <SortTh key={column.field} column={column} />;
              })}
            </tr></thead>
            <tbody>{renderWOTableRows()}</tbody>
          </table>
        </div>
      )}
    </TableShell>
    </div>
  </div>);
}
