import { useState, useMemo, useEffect } from "react";
import { useTheme } from "../theme";
import { useStyles } from "../hooks/useStyles";
import { fmtDate, triggerDownload, buildExportHTML, normalizeStr, formatDescriptionForDisplay, detectPackType, safeNum } from "../utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import TableShell from "../components/ui/table-shell";
import SortHeaderButton from "../components/ui/sort-header-button";

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

export default function WorkOrdersView({ analysis, woStatuses, woCustomers, recommendations, dispatchQueue, prefilterCustomer, prefilterNonce }) {
  const { C, sans, mono } = useTheme();
  const { thC, tdN, tdM, thDS, tdDN, tdDM, truncate } = useStyles();

  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterWoStatus, setFilterWoStatus] = useState("Booked");
  const [filterCustomer, setFilterCustomer] = useState("all");
  const [filterDueMonth, setFilterDueMonth] = useState("all");
  const [filterPackType, setFilterPackType] = useState("all");
  const [filterShared, setFilterShared] = useState(false);
  const [filterRunNext, setFilterRunNext] = useState(false);
  const [runNextLimit, setRunNextLimit] = useState("12");
  const [sortField, setSortField] = useState("readiness");
  const [sortDir, setSortDir] = useState("desc");
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

  useEffect(() => {
    if (!prefilterCustomer) return;
    setFilterCustomer(prefilterCustomer);
    setFilterStatus("all");
    setFilterWoStatus("all");
    setFilterPackType("all");
    setFilterShared(false);
    setFilterRunNext(false);
    setSearchTerm("");
  }, [prefilterCustomer, prefilterNonce]);

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
    r.sort((a,b) => {
      var c = 0;
      if (sortField==="woNum") c=a.woNum.localeCompare(b.woNum);
      else if (sortField==="product") c=a.productSkuRaw.localeCompare(b.productSkuRaw);
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
  }, [analysis, filterStatus, filterWoStatus, filterCustomer, filterDueMonth, filterPackType, filterShared, filterRunNext, searchTerm, sortField, sortDir, commitmentMap, sharedComponentUsage, runNextWoSet, runNextMetaMap]);

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
    var map = {};
    r.forEach(function(w) {
      var key = String(w.status || "--").trim() || "--";
      if (!map[key]) map[key] = { status:key, woCount:0, qtyUnits:0 };
      map[key].woCount += 1;
      map[key].qtyUnits += Number(w.qtyToProduce || 0);
    });
    return Object.values(map).sort(function(a, b) { return b.qtyUnits - a.qtyUnits; });
  }, [analysis, filterStatus, filterCustomer, filterDueMonth, filterPackType, filterShared, filterRunNext, searchTerm, commitmentMap, sharedComponentUsage, runNextWoSet]);

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

  var exportCSV = () => { if (!analysis) return; var h = ["Work Order","Product SKU","Description","Customer","WO Status","Due Date","Planned Start","Planned End","Order Qty","Produced","Remaining","Complete %","Ready %","Can Make","Est Hours","Run Status","Reference"]; var rows = analysis.results.map(w => [w.woNum, w.productSkuRaw, '"'+(w.productDesc||"").replace(/"/g,'""')+'"', '"'+(w.customer||"")+'"', w.status||"", w.dueDate||"", w.plannedStart||"", w.plannedEnd||"", w.qtyToProduce, w.unitsProduced, w.unitsRemaining, w.prodPct, w.readiness<0?"N/A":Math.round(w.readiness), w.maxRunnable, w.estHours||"", w.runStatus, '"'+(w.reference1||"").replace(/"/g,'""')+'"']); triggerDownload([h.join(",")].concat(rows.map(r => r.join(","))).join("\n"), "packpulse_" + new Date().toISOString().slice(0,10) + ".csv", "text/csv"); };
  var exportPDF = () => { if (!analysis) return; var th = ["WO#","Product","Customer","Qty","Produced","Remaining","Complete","Ready","Est Hrs","Status","Due"].map(h => "<th>"+h+"</th>").join(""); var tb = analysis.results.map(w => "<tr><td>"+w.woNum+"</td><td>"+w.productSkuRaw+"</td><td>"+(w.customer||"--")+"</td><td>"+w.qtyToProduce.toLocaleString()+"</td><td>"+w.unitsProduced.toLocaleString()+"</td><td>"+w.unitsRemaining.toLocaleString()+"</td><td>"+w.prodPct+"%</td><td>"+(w.readiness<0?"N/A":Math.round(w.readiness)+"%")+'</td><td>'+(w.estHours||"--")+'</td><td class="'+w.runStatus+'">'+w.runStatus+"</td><td>"+fmtDate(w.dueDate)+"</td></tr>").join(""); triggerDownload(buildExportHTML("PackPulse Report", th, tb), "packpulse_" + new Date().toISOString().slice(0,10) + ".html", "text/html"); };

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
    if (filteredResults.length === 0) return <tr><td colSpan={18} style={{ padding:36, textAlign:"center", color:C.dim, fontSize:14 }}>No work orders match filters.</td></tr>;
    var out = [];
    filteredResults.forEach((wo, idx) => {
      var rowKey = wo.woNum + "|" + idx;
      var isX = !!expandedWOs[rowKey];
      var commitment = commitmentMap[woCommitKey(wo)] || { committedCanMake:0, commitmentGap:0, sharedConstraint:false };
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
          <tr key={"d"+idx}><td colSpan={18} style={{ padding:"0 12px 14px 36px", background:C.raised }}>
            {details}
          </td></tr>
        );
      }
    });
    return out;
  };

  return (<div>
    <div className="mb-3 flex items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-1">
      <Input type="text" placeholder="Search WO / SKU / customer" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="h-10 w-72 shrink-0 text-sm" />
      <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)} className="h-10 shrink-0 rounded-md border border-[rgb(var(--border))] bg-white px-3 text-sm text-[rgb(var(--foreground))]">
        <option value="all">All Customers</option>
        {woCustomers.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <Input
        type="month"
        value={filterDueMonth === "all" ? "" : filterDueMonth}
        onChange={function(e) { setFilterDueMonth(e.target.value || "all"); }}
        className="h-10 w-40 shrink-0 text-sm"
        title="Filter by due month (any month, including months not present in current data)."
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
  </div>);
}
