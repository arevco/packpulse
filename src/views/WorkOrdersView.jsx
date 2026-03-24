import { useState, useMemo, useEffect } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, normalizeStr, formatDescriptionForDisplay, detectPackType, safeNum } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { MonthPicker } from "../components/ui/month-picker";
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

export default function WorkOrdersView({ analysis, woStatuses, woCustomers, recommendations, dispatchQueue, inboundCoverage, initialFilters, onPermalinkChange }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, thDS, tdDN, tdDM, truncate } = useStyles();
  var initial = initialFilters || {};

  const [searchTerm, setSearchTerm] = useState(String(initial.q || ""));
  const [filterStatus, setFilterStatus] = useState(String(initial.runStatus || "all"));
  const [filterWoStatus, setFilterWoStatus] = useState(String(initial.woStatus || "Booked"));
  const [filterCustomer, setFilterCustomer] = useState(String(initial.customer || "all"));
  const [filterDueMonth, setFilterDueMonth] = useState(String(initial.month || "all"));
  const [filterPackType, setFilterPackType] = useState(String(initial.packType || "all"));
  const [filterShared, setFilterShared] = useState(!!initial.shared);
  const [filterRunNext, setFilterRunNext] = useState(!!initial.runNext);
  const [filterBatchable, setFilterBatchable] = useState(!!initial.batchable);
  const [runNextLimit, setRunNextLimit] = useState(String(initial.runNextLimit || "12"));
  const [sortField, setSortField] = useState(String(initial.sortField || "readiness"));
  const [sortDir, setSortDir] = useState(String(initial.sortDir || "desc"));
  const [expandedWOs, setExpandedWOs] = useState({});

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
      month: filterDueMonth,
      packType: filterPackType,
      shared: !!filterShared,
      runNext: !!filterRunNext,
      batchable: !!filterBatchable,
      runNextLimit: runNextLimit,
      sortField: sortField,
      sortDir: sortDir
    });
  }, [onPermalinkChange, searchTerm, filterStatus, filterWoStatus, filterCustomer, filterDueMonth, filterPackType, filterShared, filterRunNext, filterBatchable, runNextLimit, sortField, sortDir]);

  var handleSort = f => { if (sortField === f) setSortDir(d => d==="asc"?"desc":"asc"); else { setSortField(f); setSortDir("desc"); } };
  var woCommitKey = function(wo) { return [wo.woNum || "", wo.productSkuRaw || "", wo.dueDate || ""].join("|"); };

  var statusLooksClosed = function(status) {
    var s = normalizeStr(status || "");
    if (!s) return false;
    return s.includes("close") || s.includes("complete") || s.includes("cancel") || s.includes("archive") || s.includes("done");
  };
  var parseDueDateTs = function(v) {
    var d = parseDateValue(v);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
  };
  var dueMonthKey = function(v) {
    var d = parseDateValue(v);
    if (!d) return "";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
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
    if (!analysis) return {};
    var results = analysis.results || [];
    var activeWOs = results.filter(function(wo) {
      if (wo.runStatus === "nobom") return false;
      if (statusLooksClosed(wo.status)) return false;
      return true;
    }).slice().sort(function(a, b) {
      var dt = parseDueDateTs(a.dueDate) - parseDueDateTs(b.dueDate);
      if (dt !== 0) return dt;
      return (a.woNum || "").localeCompare(b.woNum || "");
    });

    var remainingBySku = {};
    activeWOs.forEach(function(wo) {
      (wo.components || []).forEach(function(comp) {
        var seen = {};
        var optList = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
        optList.forEach(function(opt) {
          var k = normalizeStr(opt.sku || "");
          if (!k || seen[k]) return;
          seen[k] = true;
          var onHand = Number(opt.onHand || 0);
          if (!Object.prototype.hasOwnProperty.call(remainingBySku, k) || onHand > remainingBySku[k]) remainingBySku[k] = onHand;
        });
      });
    });
    var initialBySku = Object.assign({}, remainingBySku);
    var usageByPrimary = {};
    activeWOs.forEach(function(wo) {
      var seen = {};
      (wo.components || []).forEach(function(comp) {
        var pk = normalizeStr(comp.sku || "");
        if (!pk || seen[pk]) return;
        seen[pk] = true;
        usageByPrimary[pk] = (usageByPrimary[pk] || 0) + 1;
      });
    });

    var map = {};
    activeWOs.forEach(function(wo) {
      var committed = Number.POSITIVE_INFINITY;
      var sharedDetails = [];
      var componentPressure = {};
      var compList = wo.components || [];
      if (!compList.length) committed = 0;
      compList.forEach(function(comp) {
        var qtyPer = Number(comp.qtyPer || 0);
        if (!(qtyPer > 0)) return;
        var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
        var options = optionRows.map(function(opt) {
          var key = normalizeStr(opt.sku || "");
          return { key:key, sku:opt.sku || "", isSub:!!opt.isSub };
        }).filter(function(opt) { return !!opt.key; });
        var optionCountWithStock = options.filter(function(opt) { return (remainingBySku[opt.key] || 0) > 0; }).length;
        var available = options.reduce(function(sum, opt) { return sum + (remainingBySku[opt.key] || 0); }, 0);
        var isolatedAvailable = options.reduce(function(sum, opt) { return sum + (initialBySku[opt.key] || 0); }, 0);
        var consumedBefore = Math.max(0, isolatedAvailable - available);
        var makeUnits = Math.floor(available / qtyPer);
        var isolatedMakeUnits = Math.floor(isolatedAvailable / qtyPer);
        var compKey = normalizeStr(comp.sku || "");
        if (compKey) {
          componentPressure[compKey] = {
            usedByWOs: usageByPrimary[compKey] || 1,
            qtyPer: qtyPer,
            availableAtTurn: available,
            isolatedAvailable: isolatedAvailable,
            consumedBefore: consumedBefore,
            turnMakeUnits: makeUnits,
            isolatedMakeUnits: isolatedMakeUnits,
            reducedUnits: Math.max(0, isolatedMakeUnits - makeUnits)
          };
        }
        committed = Math.min(committed, makeUnits);
        if (optionCountWithStock > 1) sharedDetails.push(comp.sku);
      });
      if (!isFinite(committed)) committed = 0;
      committed = Math.max(0, Math.min(committed, Number(wo.qtyToProduce || 0)));

      // Reserve inventory for this WO using same priority order.
      compList.forEach(function(comp) {
        var qtyPer = Number(comp.qtyPer || 0);
        if (!(qtyPer > 0)) return;
        var need = committed * qtyPer;
        if (need <= 0) return;
        var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails.slice() : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
        optionRows.sort(function(a, b) {
          if (!!a.isSub !== !!b.isSub) return a.isSub ? 1 : -1;
          return Number(b.onHand || 0) - Number(a.onHand || 0);
        });
        var remainingNeed = need;
        optionRows.forEach(function(opt) {
          if (remainingNeed <= 0) return;
          var key = normalizeStr(opt.sku || "");
          if (!key) return;
          var avail = remainingBySku[key] || 0;
          if (avail <= 0) return;
          var take = Math.min(avail, remainingNeed);
          remainingBySku[key] = avail - take;
          remainingNeed -= take;
        });
      });

      var localCanMake = Number(wo.maxRunnable || 0);
      var gap = Math.max(0, localCanMake - committed);
      map[woCommitKey(wo)] = {
        committedCanMake: committed,
        commitmentGap: gap,
        sharedConstraint: gap > 0,
        sharedComponents: Array.from(new Set(sharedDetails)).slice(0, 3),
        componentPressure: componentPressure
      };
    });
    return map;
  }, [analysis]);

  var commitmentSummary = useMemo(function() {
    if (!analysis) return null;
    var rows = analysis.results || [];
    var atRisk = 0;
    var reducedUnits = 0;
    rows.forEach(function(wo) {
      var c = commitmentMap[woCommitKey(wo)];
      if (!c) return;
      if (c.commitmentGap > 0) {
        atRisk += 1;
        reducedUnits += c.commitmentGap;
      }
    });
    return { atRisk:atRisk, reducedUnits:reducedUnits };
  }, [analysis, commitmentMap]);

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

  var batchScopeResults = useMemo(function() {
    if (!analysis) return [];
    var r = analysis.results.slice();
    if (filterStatus !== "all") r = r.filter(function(w) { return w.runStatus === filterStatus; });
    if (filterCustomer !== "all") r = r.filter(function(w) { return w.customer === filterCustomer; });
    if (filterDueMonth !== "all") r = r.filter(function(w) { return dueMonthKey(w.dueDate) === filterDueMonth; });
    if (filterShared) r = r.filter(function(w) { return hasSharedComponent(w); });
    if (filterRunNext) r = r.filter(function(w) { return !!runNextWoSet[String(w.woNum || "")]; });
    if (filterWoStatus !== "all") r = r.filter(function(w) { return w.status === filterWoStatus; });
    if (filterPackType !== "all") r = r.filter(function(w) { return detectPackType(w.productDesc || w.productSkuRaw || "", w.productSkuRaw || w.productSku || "") === filterPackType; });
    return r;
  }, [analysis, filterStatus, filterCustomer, filterDueMonth, filterShared, filterRunNext, filterWoStatus, filterPackType, sharedComponentUsage, runNextWoSet]);

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

  var filteredResults = useMemo(() => {
    if (!analysis) return []; var r = analysis.results.slice();
    if (filterStatus !== "all") r = r.filter(w => w.runStatus === filterStatus);
    if (filterCustomer !== "all") r = r.filter(w => w.customer === filterCustomer);
    if (filterDueMonth !== "all") r = r.filter(function(w) { return dueMonthKey(w.dueDate) === filterDueMonth; });
    if (filterShared) r = r.filter(function(w) { return hasSharedComponent(w); });
    if (filterRunNext) r = r.filter(function(w) { return !!runNextWoSet[String(w.woNum || "")]; });
    if (searchTerm) {
      var qRaw = String(searchTerm || "").toLowerCase().trim();
      var qNorm = normalizeSearchValue(qRaw);
      var qSku = normalizeSkuSearchValue(qRaw);
      r = r.filter(function(w) { return matchesWorkOrderSearch(w, qRaw, qNorm, qSku); });
    }
    if (filterWoStatus !== "all") r = r.filter(w => w.status === filterWoStatus);
    if (filterPackType !== "all") r = r.filter(function(w) { return detectPackType(w.productDesc || w.productSkuRaw || "", w.productSkuRaw || w.productSku || "") === filterPackType; });
    if (filterBatchable) r = r.filter(function(w) { return !!batchOpportunityMap[woCommitKey(w)]; });
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
      else if (sortField==="maxRunnable") c=a.maxRunnable-b.maxRunnable;
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
      else if (sortField==="readiness") c=a.readiness-b.readiness;
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
  }, [analysis, filterStatus, filterWoStatus, filterCustomer, filterDueMonth, filterPackType, filterShared, filterRunNext, filterBatchable, searchTerm, sortField, sortDir, commitmentMap, sharedComponentUsage, runNextWoSet, runNextMetaMap, batchOpportunityMap]);

  var woStatusBreakdown = useMemo(function() {
    if (!analysis) return [];
    var r = analysis.results.slice();
    if (filterStatus !== "all") r = r.filter(function(w) { return w.runStatus === filterStatus; });
    if (filterCustomer !== "all") r = r.filter(function(w) { return w.customer === filterCustomer; });
    if (filterDueMonth !== "all") r = r.filter(function(w) { return dueMonthKey(w.dueDate) === filterDueMonth; });
    if (filterShared) r = r.filter(function(w) { return hasSharedComponent(w); });
    if (filterRunNext) r = r.filter(function(w) { return !!runNextWoSet[String(w.woNum || "")]; });
    if (searchTerm) {
      var qRaw = String(searchTerm || "").toLowerCase().trim();
      var qNorm = normalizeSearchValue(qRaw);
      var qSku = normalizeSkuSearchValue(qRaw);
      r = r.filter(function(w) { return matchesWorkOrderSearch(w, qRaw, qNorm, qSku); });
    }
    if (filterPackType !== "all") r = r.filter(function(w) { return detectPackType(w.productDesc || w.productSkuRaw || "", w.productSkuRaw || w.productSku || "") === filterPackType; });
    if (filterBatchable) r = r.filter(function(w) { return !!batchOpportunityMap[woCommitKey(w)]; });
    var map = {};
    r.forEach(function(w) {
      var key = String(w.status || "--").trim() || "--";
      if (!map[key]) map[key] = { status:key, woCount:0, qtyUnits:0 };
      map[key].woCount += 1;
      map[key].qtyUnits += Number(w.qtyToProduce || 0);
    });
    return Object.values(map).sort(function(a, b) { return b.qtyUnits - a.qtyUnits; });
  }, [analysis, filterStatus, filterCustomer, filterDueMonth, filterPackType, filterShared, filterRunNext, filterBatchable, searchTerm, commitmentMap, sharedComponentUsage, runNextWoSet, batchOpportunityMap]);

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
    if (filterDueMonth !== "all") parts.push("Due month: " + filterDueMonth);
    if (filterPackType !== "all") parts.push("Pack: " + filterPackType);
    if (filterWoStatus !== "all") parts.push("WO status: " + filterWoStatus);
    if (filterStatus !== "all") parts.push("Run status: " + filterStatus);
    if (filterRunNext) parts.push("Run Next");
    if (filterBatchable) parts.push("Batch");
    if (filterShared) parts.push("Shared");
    return parts.length ? parts.join(" • ") : "All work orders in current view";
  }, [searchTerm, filterCustomer, filterDueMonth, filterPackType, filterWoStatus, filterStatus, filterRunNext, filterBatchable, filterShared]);

  var exportWorkOrderRows = useMemo(function() {
    return filteredResults.map(function(wo) {
      var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0 };
      var batchMeta = batchOpportunityMap[woCommitKey(wo)] || null;
      var runMeta = runNextMetaMap[String(wo.woNum || "")] || null;
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
        readinessPct: wo.readiness < 0 ? null : Math.round(Number(wo.readiness || 0)),
        makeUnits: Number(wo.maxRunnable || 0),
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
          readinessPct: wo.readiness < 0 ? null : Math.round(Number(wo.readiness || 0)),
          makeUnits: Number(wo.maxRunnable || 0),
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
      "Order Qty","Produced","Remaining","Ready %","Make","Net","Gap","Est Hrs","Batch Count","Run Next Rank","Run Next Score",
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
        row.readinessPct == null ? "N/A" : row.readinessPct,
        row.makeUnits,
        row.netUnits,
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
        "<td>" + escapeHtml(row.readinessPct == null ? "N/A" : (row.readinessPct + "%")) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.makeUnits)) + "</td>" +
        "<td>" + escapeHtml(fmtNum(row.netUnits)) + "</td>" +
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
      "<th>WO#</th><th>FG SKU</th><th>Customer</th><th>Due</th><th>Remaining</th><th>Ready</th><th>Make</th><th>Net</th><th>Gap</th><th>Est Hrs</th>",
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

  var SortTh = function(props) {
    return (
      <th style={Object.assign({}, thC(sortField===props.field), props.style||{})}>
        <SortHeaderButton onClick={() => handleSort(props.field)} className={props.alignRight ? "text-right" : "text-left"}>
          {props.children}{sortField===props.field ? (sortDir==="asc" ? " \u2191" : " \u2193") : ""}
        </SortHeaderButton>
      </th>
    );
  };

  var renderWORows = () => {
    if (filteredResults.length === 0) return <tr><td colSpan={19} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No work orders match filters.</td></tr>;
    var out = [];
    filteredResults.forEach((wo, idx) => {
      var rowKey = wo.woNum + "|" + idx;
      var isX = !!expandedWOs[rowKey];
      var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0, sharedConstraint:false };
      var batchMeta = batchOpportunityMap[woCommitKey(wo)] || null;
      var runMeta = runNextMetaMap[String(wo.woNum || "")] || null;
      var rs = runStatusMeta(wo.runStatus);
      var skuType = detectPackType(wo.productDesc || wo.productSkuRaw || "", wo.productSkuRaw || wo.productSku || "");
      out.push(
        <tr key={"r"+idx} onClick={function() {
          setExpandedWOs(function(prev) {
            var next = Object.assign({}, prev);
            if (next[rowKey]) delete next[rowKey];
            else next[rowKey] = true;
            return next;
          });
        }} style={{ cursor:"pointer", borderBottom:"1px solid "+C.border, background:isX?C.raised:"transparent" }}
          onMouseEnter={e => { if (!isX) e.currentTarget.style.background = C.hover; }} onMouseLeave={e => { if (!isX) e.currentTarget.style.background = isX ? C.raised : "transparent"; }}>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:C.bright })}>{wo.woNum}</td>
          <td style={tdM}>{wo.productSkuRaw}</td>
          <td style={Object.assign({}, tdN, { whiteSpace:"nowrap" })}>
            {batchMeta ? (
              <Badge
                variant="info"
                title={"Batch opportunity across " + batchMeta.batchCount + " open work orders for item " + (wo.productSkuRaw || wo.productSku || "--") + " \u2022 Remaining " + fmtNum(batchMeta.totalRemainingUnits) + " \u2022 WO order: " + batchMeta.woNums.join(", ")}
              >
                {"x" + batchMeta.batchCount}
              </Badge>
            ) : (
              <span style={{ color:C.dim }}>--</span>
            )}
          </td>
          <td style={Object.assign({}, tdN, { whiteSpace:"nowrap" })}><Badge variant="secondary">{skuType}</Badge></td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(220))}>{formatDescriptionForDisplay(wo.productDesc) || "--"}</td>
          <td style={Object.assign({}, tdN, { color:C.dim }, truncate(140))}>{wo.customer || "--"}</td>
          <td style={Object.assign({}, tdN, { whiteSpace:"nowrap" })}>
            <Badge title={wo.runStatus || ""} variant={rs.variant} className="mr-1 min-w-[34px] justify-center px-1.5 py-0.5 text-[11px] font-bold">{rs.label}</Badge>
            <Badge title={wo.status || ""} variant="secondary" className="min-w-[34px] justify-center px-1.5 py-0.5 text-[11px] font-bold">{shortWoStatus(wo.status)}</Badge>
          </td>
          <td style={Object.assign({}, tdM, { color:C.text })}>{fmtDate(wo.dueDate)}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.qtyToProduce.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { color:wo.unitsProduced>0?C.ok:C.dim })}>{wo.unitsProduced>0?wo.unitsProduced.toLocaleString():"--"}</td>
          <td style={Object.assign({}, tdM, { color:C.bright })}>{wo.unitsRemaining.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.prodPct>=100?C.ok:wo.prodPct>=50?C.warn:wo.prodPct>0?C.accent:C.dim })}>{wo.prodPct > 0 ? wo.prodPct+"%" : "--"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.readiness>=100?C.ok:wo.readiness>=70?C.warn:C.bad })}>{wo.readiness < 0 ? <span style={{color:C.dim}}>--</span> : Math.round(wo.readiness)+"%"}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:wo.runStatus==="ready"?C.ok:wo.runStatus==="nobom"?C.dim:wo.maxRunnable>0?C.warn:C.bad })}>{wo.runStatus==="nobom" ? "--" : wo.maxRunnable.toLocaleString()}</td>
          <td style={Object.assign({}, tdM, { fontWeight:600, color:commitment.committedCanMake>0?C.accent:C.dim })}>
            {wo.runStatus==="nobom" ? "--" : commitment.committedCanMake.toLocaleString()}
          </td>
          <td style={Object.assign({}, tdN, { whiteSpace:"nowrap" })}>
            {(commitment.commitmentGap > 0) ? (
              <Badge title={"Shared material demand across active work orders. Order: earliest due date, then WO #. Make: " + wo.maxRunnable.toLocaleString() + " | Net: " + commitment.committedCanMake.toLocaleString() + " | Gap: " + commitment.commitmentGap.toLocaleString()} variant="danger">Shared</Badge>
            ) : (
              <span style={{ color:C.dim }}>--</span>
            )}
          </td>
          <td style={Object.assign({}, tdM, { color:wo.estHours>0?C.bright:C.dim })}>{wo.estHours > 0 ? wo.estHours+"h" : "--"}</td>
          <td style={Object.assign({}, tdN, { color:runMeta ? C.bright : C.dim, whiteSpace:"nowrap" })}>
            {runMeta ? (
              <span title={(runMeta.action || "Run Next") + (runMeta.why ? " • " + runMeta.why : "")} style={{ color:C.accent, fontWeight:700 }}>#{runMeta.rank}</span>
            ) : "--"}
          </td>
          <td style={Object.assign({}, tdM, { color:runMeta ? C.bright : C.dim, fontFamily:mono, fontWeight:runMeta ? 700 : 500 })}>
            {runMeta ? runMeta.score : "--"}
          </td>
        </tr>
      );
      if (isX) {
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
                {["Component","Description","Qty/Unit","Needed","On Hand","Short","Fill %"].map(h => <th key={h} style={thDS}>{h}</th>)}
              </tr></thead>
              <tbody>
                {wo.components.slice().sort(function(a, b) {
                  return String(a.sku || "").localeCompare(String(b.sku || ""), undefined, { numeric:true, sensitivity:"base" });
                }).map((comp, ci) => {
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
                          {comp.optionDetails.map((opt, oi) => <span key={oi} style={{ fontSize:12, fontFamily:mono, color:C.dim }}>
                            <span style={{ color:opt.isSub?C.accent:C.ok, fontWeight:600, marginRight:2 }}>{opt.isSub ? "ALT" : "PRI"}</span>{opt.sku} = {opt.onHand.toLocaleString()}
                          </span>)}
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
        out.push(
          <tr key={"d"+idx}><td colSpan={19} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            {details}
          </td></tr>
        );
      }
    });
    return out;
  };

  var handleOverviewCustomerSelect = function(customerName) {
    setFilterCustomer(customerName || "all");
    setFilterStatus("all");
    setFilterWoStatus("all");
    setFilterPackType("all");
    setFilterDueMonth("all");
    setFilterShared(false);
    setFilterRunNext(false);
    setFilterBatchable(false);
    setSearchTerm("");
    setTimeout(function() {
      var el = document.getElementById("workorders-table");
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior:"smooth", block:"start" });
    }, 0);
  };

  return (<div>
    <div style={{ marginBottom:18 }}>
      <div style={{ fontSize:14, fontWeight:600, color:C.bright, marginBottom:10 }}>Overview Snapshot</div>
      <OverviewView analysis={analysis} woStatuses={woStatuses} onSelectCustomer={handleOverviewCustomerSelect} />
    </div>
    <div id="workorders-table">
    <div className="mb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
      <Input type="text" placeholder="Search WO / SKU / customer" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-10 w-72 shrink-0 text-sm" />
      <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All Customers</option>
        {woCustomers.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <MonthPicker
        value={filterDueMonth === "all" ? "" : filterDueMonth}
        onChange={function(nextMonth) { setFilterDueMonth(nextMonth || "all"); }}
        placeholder="Due month"
        className="w-40 shrink-0"
      />
      {filterDueMonth !== "all" && (
        <Button onClick={function() { setFilterDueMonth("all"); }} variant="outline" size="default" className="shrink-0">
          All Months
        </Button>
      )}
      <select value={filterPackType} onChange={e => setFilterPackType(e.target.value)} className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All SKU Types</option>
        {skuTypeOptions.map(function(t) { return <option key={t} value={t}>{t}</option>; })}
      </select>
      <select value={filterWoStatus} onChange={e => setFilterWoStatus(e.target.value)} className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All WO Status</option>
        {woStatuses.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select
        value={filterStatus}
        onChange={function(e) { setFilterStatus(e.target.value); }}
        className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]"
      >
        <option value="all">All Run Status</option>
        <option value="ready">Ready</option>
        <option value="partial">Partial</option>
        <option value="blocked">Blocked</option>
        <option value="nobom">No BOM</option>
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
      }} variant={filterRunNext ? "active" : "outline"} size="default" className="shrink-0">Run Next</Button>
      {filterRunNext && (
        <select value={runNextLimit} onChange={function(e) { setRunNextLimit(e.target.value); }} className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
          <option value="8">Top 8</option>
          <option value="12">Top 12</option>
          <option value="20">Top 20</option>
        </select>
      )}
      <Button onClick={function() { setFilterBatchable(function(v) { return !v; }); }} variant={filterBatchable ? "active" : "outline"} size="default" className="shrink-0" title="Show same-item work orders that can be batched to reduce changeovers">
        Batch
      </Button>
      <Button onClick={function() { setFilterShared(function(v) { return !v; }); }} variant={filterShared ? "active" : "outline"} size="default" className="shrink-0">Shared</Button>
      <Button onClick={exportCSV} variant="outline" size="default" className="shrink-0">CSV</Button>
      <Button onClick={exportPDF} variant="outline" size="default" className="shrink-0">PDF</Button>
    </div>
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
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:C.raised }}>
            <SortTh field="woNum">WO#</SortTh>
            <SortTh field="product">Product</SortTh>
            <SortTh field="batchCount"><span title="Open work orders sharing the same item">Batch</span></SortTh>
            <SortTh field="skuType">SKU Type</SortTh>
            <SortTh field="desc">Product Description</SortTh>
            <SortTh field="customer">Customer</SortTh>
            <SortTh field="status">WO Status</SortTh>
            <SortTh field="dueDate">Due</SortTh>
            <SortTh field="qty">Order Qty</SortTh>
            <SortTh field="produced">Produced</SortTh>
            <SortTh field="remaining">Remaining</SortTh>
            <SortTh field="complete">Complete</SortTh>
            <SortTh field="readiness">Ready</SortTh>
            <SortTh field="maxRunnable"><span title="Capacity if this work order runs in isolation">Make</span></SortTh>
            <SortTh field="committedCanMake"><span title="Capacity after shared-material commitments across active work orders">Net</span></SortTh>
            <SortTh field="commitmentGap"><span title="Difference between isolated make and commitment-aware net capacity">Gap</span></SortTh>
            <SortTh field="estHours">Est Hrs</SortTh>
            <SortTh field="dispatchRank"><span title="Run Next rank from dispatch scoring">Run Next</span></SortTh>
            <SortTh field="dispatchScore"><span title="Run Next weighted score (higher = stronger candidate)">Score</span></SortTh>
          </tr></thead>
          <tbody>{renderWORows()}</tbody>
        </table>
      </div>
    </TableShell>
    <div style={{ marginTop:8, fontSize:13, color:C.dim }}>{filteredResults.length} of {analysis.results.length} work orders</div>
    </div>
  </div>);
}
