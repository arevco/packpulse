import { useMemo } from "react";
import { safeNum, normalizeStr } from "../utils";

function normalizePoKey(value) {
  var s = (value || "").toString().trim();
  if (!s) return "";
  // Handle spreadsheet-style PO exports like 12345.0
  s = s.replace(/\.0+$/, "");
  // Keep only alphanumerics for safer cross-system matching.
  s = s.replace(/[^a-zA-Z0-9]/g, "");
  return normalizeStr(s);
}

function isWorkOrderClosed(wo) {
  var st = normalizeStr(wo && wo.status ? wo.status : "");
  var closedTokens = ["closed", "complete", "completed", "done", "cancelled", "canceled", "archived"];
  if (st && closedTokens.some(function(t) { return st.includes(t); })) return true;
  // Defensive fallback: if remaining is zero or less, treat as closed for shortage logic.
  return safeNum(wo && wo.unitsRemaining) <= 0;
}

function isGenericBomDescription(desc) {
  var s = (desc || "").toString().trim();
  if (!s) return true;
  return /^bom\s*\d*$/i.test(s) || /^version\s*\d*$/i.test(s) || /^v\d+$/i.test(s);
}

function descriptionScore(desc, skuRaw) {
  var s = (desc || "").toString().trim();
  if (!s) return 0;
  if (s === "--") return 0;
  if (isGenericBomDescription(s)) return 1;
  if (normalizeStr(s) === normalizeStr(skuRaw || "")) return 2;
  if (s.length < 3) return 2;
  return 10;
}

function pickBetterDescription(currentDesc, nextDesc, skuRaw) {
  var a = (currentDesc || "").toString().trim();
  var b = (nextDesc || "").toString().trim();
  if (!a) return b;
  if (!b) return a;
  var sa = descriptionScore(a, skuRaw);
  var sb = descriptionScore(b, skuRaw);
  if (sb > sa) return b;
  if (sa > sb) return a;
  return b.length > a.length ? b : a;
}

function firstValue(row, keys) {
  if (!row) return "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

export function useAnalysis({ mappingConfirmed, allUploaded, inventory, itemMaster, boms, workOrders, invMapping, bomMapping, woMapping, poData, poMapping, edrData, dockData }) {

  /* ====== ANALYSIS ENGINE ====== */
  var analysis = useMemo(() => {
    if (!mappingConfirmed || !allUploaded) return null;
    var invMap = {}; var itemMasterBySku = {};
    (itemMaster || []).forEach(function(row) {
      var skuRaw = firstValue(row, ["Item Code", "Code", "item_code", "code"]).toString().trim();
      var sku = normalizeStr(skuRaw);
      if (!sku) return;
      var masterDescRaw = firstValue(row, ["Description", "description", "Item Description", "item_description"]).toString().trim();
      if (!itemMasterBySku[sku]) itemMasterBySku[sku] = { sku:sku, skuRaw:skuRaw, desc:"" };
      itemMasterBySku[sku].desc = pickBetterDescription(itemMasterBySku[sku].desc || "", masterDescRaw, skuRaw);
      if (!itemMasterBySku[sku].skuRaw && skuRaw) itemMasterBySku[sku].skuRaw = skuRaw;
    });
    inventory.forEach(row => {
      var skuRaw = (row[invMapping.sku] || "").toString().trim();
      var sku = normalizeStr(skuRaw);
      if (!sku) return;
      var invDescRaw = invMapping.description ? (row[invMapping.description] || "").toString().trim() : "";
      invMap[sku] = (invMap[sku] || 0) + safeNum(row[invMapping.qtyOnHand]);
      if (!itemMasterBySku[sku]) itemMasterBySku[sku] = { sku:sku, skuRaw:skuRaw, desc:"" };
      itemMasterBySku[sku].desc = pickBetterDescription(itemMasterBySku[sku].desc || "", invDescRaw, skuRaw);
      if (!itemMasterBySku[sku].skuRaw && skuRaw) itemMasterBySku[sku].skuRaw = skuRaw;
    });
    // Enrich item master descriptions from Work Orders when Inventory description is blank.
    // Inventory remains primary source-of-truth; this only fills missing descriptions.
    var woCols = workOrders && workOrders.length ? Object.keys(workOrders[0]) : [];
    var woDescCol = woCols.find(function(c) { var n = normalizeStr(c); return n === "description" || n.includes("itemdescription"); });
    if (woDescCol) {
      workOrders.forEach(function(row) {
        var skuRaw = (row[woMapping.productSku] || "").toString().trim();
        var sku = normalizeStr(skuRaw);
        if (!sku) return;
        var woDescRaw = (row[woDescCol] || "").toString().trim();
        if (!woDescRaw) return;
        if (!itemMasterBySku[sku]) itemMasterBySku[sku] = { sku:sku, skuRaw:skuRaw, desc:"" };
        itemMasterBySku[sku].desc = pickBetterDescription(itemMasterBySku[sku].desc || "", woDescRaw, skuRaw);
        if (!itemMasterBySku[sku].skuRaw && skuRaw) itemMasterBySku[sku].skuRaw = skuRaw;
      });
    }
    function resolveItemDescription(skuNorm, skuRaw, fallbackDesc) {
      var masterDesc = itemMasterBySku[skuNorm] ? itemMasterBySku[skuNorm].desc : "";
      return pickBetterDescription(masterDesc || "", fallbackDesc || "", skuRaw || (itemMasterBySku[skuNorm] && itemMasterBySku[skuNorm].skuRaw) || "");
    }
    var bomMap = {}; var bomDescBySku = {};
    if (boms && boms.length) { boms.forEach(row => {
      var parentRaw = (row[bomMapping.bomId]||"").toString().trim(); var parent = normalizeStr(parentRaw); if (!parent) return;
      if (!bomMap[parent]) bomMap[parent] = { parentRaw:parentRaw, rawComponents:[] };
      var subForRaw = bomMapping.substituteFor ? (row[bomMapping.substituteFor]||"").toString().trim() : "";
      var priorityRaw = bomMapping.priority ? safeNum(row[bomMapping.priority]) : 0;
      var compSkuRaw = (row[bomMapping.componentSku]||"").toString().trim();
      var compSkuNorm = normalizeStr(compSkuRaw);
      var compDescRaw = bomMapping.description ? (row[bomMapping.description]||"").toString().trim() : "";
      if (compSkuNorm && compDescRaw) bomDescBySku[compSkuNorm] = pickBetterDescription(bomDescBySku[compSkuNorm] || "", compDescRaw, compSkuRaw);
      bomMap[parent].rawComponents.push({ sku:compSkuNorm, skuRaw:compSkuRaw, descRaw:compDescRaw, qtyPer:safeNum(row[bomMapping.qtyPer]), substituteFor:subForRaw?normalizeStr(subForRaw):"", substituteForRaw:subForRaw, priority:priorityRaw||1 });
    }); }
    Object.values(bomMap).forEach(bom => {
      var pri = bom.rawComponents.filter(c => !c.substituteFor); var subs = bom.rawComponents.filter(c => !!c.substituteFor);
      bom.groups = pri.map(p => { var gs = subs.filter(s => s.substituteFor === p.sku).sort((a,b) => a.priority - b.priority); return { primary:p, substitutes:gs, allOptions:[p,...gs] }; });
      var mapped = new Set(bom.groups.flatMap(g => g.substitutes.map(s => s.sku)));
      subs.filter(s => !mapped.has(s.sku)).forEach(s => { bom.groups.push({ primary:s, substitutes:[], allOptions:[s] }); });
    });
    var results = workOrders.map(wo => {
      var woNum = (wo[woMapping.woNumber]||"").toString().trim(); var productSku = normalizeStr(wo[woMapping.productSku]); var productSkuRaw = (wo[woMapping.productSku]||"").toString().trim();
      var qtyToProduce = safeNum(wo[woMapping.qtyToProduce]); var dueDate = woMapping.dueDate ? (wo[woMapping.dueDate]||"").toString().trim() : ""; var status = woMapping.status ? (wo[woMapping.status]||"").toString().trim() : "";
      var customer = woMapping.customer ? (wo[woMapping.customer]||"").toString().trim() : "";
      var unitsProduced = woMapping.unitsProduced ? safeNum(wo[woMapping.unitsProduced]) : 0;
      var unitsRemaining = woMapping.unitsRemaining ? safeNum(wo[woMapping.unitsRemaining]) : Math.max(0, qtyToProduce - unitsProduced);
      var unitsPerHour = woMapping.unitsPerHour ? safeNum(wo[woMapping.unitsPerHour]) : 0;
      var standardPeople = woMapping.standardPeople ? safeNum(wo[woMapping.standardPeople]) : 0;
      var plannedStart = woMapping.plannedStart ? (wo[woMapping.plannedStart]||"").toString().trim() : "";
      var plannedEnd = woMapping.plannedEnd ? (wo[woMapping.plannedEnd]||"").toString().trim() : "";
      var reference1 = woMapping.reference1 ? (wo[woMapping.reference1]||"").toString().trim() : "";
      var estHours = unitsPerHour > 0 && unitsRemaining > 0 ? Math.round(unitsRemaining / unitsPerHour * 10) / 10 : 0;
      var prodPct = qtyToProduce > 0 ? Math.round(unitsProduced / qtyToProduce * 100) : 0;
      var extra = { customer:customer, unitsProduced:unitsProduced, unitsRemaining:unitsRemaining, unitsPerHour:unitsPerHour, standardPeople:standardPeople, plannedStart:plannedStart, plannedEnd:plannedEnd, reference1:reference1, estHours:estHours, prodPct:prodPct };
      var bom = bomMap[productSku];
      if (!bom) return Object.assign({ woNum:woNum, productSkuRaw:productSkuRaw, productDesc:resolveItemDescription(productSku, productSkuRaw, ""), qtyToProduce:qtyToProduce, dueDate:dueDate, status:status, readiness:-1, runStatus:"nobom", components:[], maxRunnable:0, couldMake:0, zeroStockCount:0, normalizedSku:productSku }, extra);
      var minFill = Infinity, maxRun = Infinity, couldMk = Infinity, zeroCount = 0; var components = [];
      bom.groups.forEach(group => {
        var qp = group.primary.qtyPer; var needed = qp * qtyToProduce; if (needed <= 0) return;
        var combined = 0;
        var optDet = group.allOptions.map(opt => { var oh = invMap[opt.sku]||0; combined += oh; return { sku:opt.skuRaw, desc:resolveItemDescription(opt.sku, opt.skuRaw, bomDescBySku[opt.sku] || opt.descRaw || ""), onHand:oh, priority:opt.priority, isSub:!!opt.substituteFor, foundInInventory:invMap.hasOwnProperty(opt.sku) }; });
        var fill = (combined/needed)*100; var canMake = qp > 0 ? Math.floor(combined/qp) : Infinity; var short = Math.max(0, needed - combined);
        minFill = Math.min(minFill, fill); maxRun = Math.min(maxRun, canMake);
        if (combined === 0 && qp > 0) zeroCount++; else couldMk = Math.min(couldMk, canMake);
        components.push({ sku:group.primary.skuRaw, desc:resolveItemDescription(group.primary.sku, group.primary.skuRaw, bomDescBySku[group.primary.sku] || group.primary.descRaw || ""), qtyPer:qp, needed:needed, onHand:combined, fillRate:fill, canMake:canMake, short:short, foundInInventory:optDet.some(o => o.foundInInventory), hasSubs:group.substitutes.length>0, optionDetails:group.substitutes.length>0?optDet:null });
      });
      var readiness = minFill === Infinity ? 100 : Math.min(minFill, 100);
      var runStatus = readiness >= 100 ? "ready" : maxRun > 0 ? "partial" : "blocked";
      if (maxRun === Infinity) maxRun = qtyToProduce; if (couldMk === Infinity) couldMk = qtyToProduce;
      return Object.assign({ woNum:woNum, productSkuRaw:productSkuRaw, productDesc:resolveItemDescription(productSku, productSkuRaw, ""), qtyToProduce:qtyToProduce, dueDate:dueDate, status:status, readiness:readiness, runStatus:runStatus, components:components, maxRunnable:Math.min(maxRun, qtyToProduce), couldMake:Math.min(couldMk, qtyToProduce), zeroStockCount:zeroCount, normalizedSku:productSku }, extra);
    });
    var diag = { invCount:inventory.length, invUniqueSkus:Object.keys(invMap).length, itemMasterRows:(itemMaster||[]).length, itemMasterSkus:Object.keys(itemMasterBySku).length, invSampleQtys:Object.entries(invMap).slice(0,6).map(function(e){return{key:e[0],qty:e[1]}}), bomParentCount:Object.keys(bomMap).length, bomSampleParents:Object.keys(bomMap).slice(0,8), bomTotalLines:boms?boms.length:0, woCount:workOrders.length, woUniqueSkus:[...new Set(results.map(r=>r.normalizedSku))], woUnmatched:[...new Set(results.filter(r=>r.runStatus==="nobom").map(r=>({raw:r.productSkuRaw,norm:r.normalizedSku})))].slice(0,10), woMatchedCount:results.filter(r=>r.runStatus!=="nobom").length };

    /* ====== DATA FLAGS ====== */
    var flags = [];
    var flagId = 0;
    // 1. Inventory SKUs missing descriptions
    Object.keys(itemMasterBySku).forEach(function(sku) {
      var skuRaw = itemMasterBySku[sku].skuRaw || sku;
      var desc = (itemMasterBySku[sku].desc || "").toString().trim();
      if (!desc) flags.push({ id:flagId++, type:"missing-desc", severity:"warn", sku:skuRaw, skuNorm:sku, desc:"", source:"Inventory", detail:"SKU has no product description in inventory. Update in ERP.", affectedWOs:[] });
    });
    // 2. BOM components not found in inventory
    var seenNotInInv = new Set();
    Object.values(bomMap).forEach(bom => { bom.rawComponents.forEach(comp => {
      if (seenNotInInv.has(comp.sku)) return;
      if (!invMap.hasOwnProperty(comp.sku)) { seenNotInInv.add(comp.sku); var aws = results.filter(r => r.components.some(c => normalizeStr(c.sku) === comp.sku)).map(r => r.woNum);
        flags.push({ id:flagId++, type:"not-in-inventory", severity:"bad", sku:comp.skuRaw, skuNorm:comp.sku, desc:"", source:"BOM", detail:"Referenced in BOM but has no inventory record. Add to ERP or verify SKU.", affectedWOs:aws });
      }
    }); });
    // 3. WO product SKUs with no BOM
    var seenNoBom = new Set();
    results.forEach(r => { if (r.runStatus === "nobom" && !seenNoBom.has(r.normalizedSku)) { seenNoBom.add(r.normalizedSku); var aws = results.filter(w => w.normalizedSku === r.normalizedSku).map(w => w.woNum);
      flags.push({ id:flagId++, type:"no-bom", severity:"bad", sku:r.productSkuRaw, skuNorm:r.normalizedSku, desc:r.productDesc, source:"Work Orders", detail:"Work order product has no BOM defined. Create BOM in ERP.", affectedWOs:aws });
    } });
    // 4. FG SKUs on work orders not in inventory
    var seenFgNoInv = new Set();
    results.forEach(r => { if (!invMap.hasOwnProperty(r.normalizedSku) && !seenFgNoInv.has(r.normalizedSku)) { seenFgNoInv.add(r.normalizedSku); var aws = results.filter(w => w.normalizedSku === r.normalizedSku).map(w => w.woNum);
      flags.push({ id:flagId++, type:"fg-not-in-inventory", severity:"warn", sku:r.productSkuRaw, skuNorm:r.normalizedSku, desc:r.productDesc, source:"Work Orders", detail:"Finished good has no inventory record. Add to ERP.", affectedWOs:aws });
    } });
    // 5. BOM components with description in inventory but needed and zero stock
    var seenZero = new Set();
    results.forEach(r => { r.components.forEach(comp => { var cn = normalizeStr(comp.sku); if (comp.onHand === 0 && comp.needed > 0 && !seenZero.has(cn) && invMap.hasOwnProperty(cn)) { seenZero.add(cn); var aws = results.filter(w => w.components.some(c => normalizeStr(c.sku) === cn && c.onHand === 0 && c.needed > 0)).map(w => w.woNum);
      flags.push({ id:flagId++, type:"zero-stock", severity:"bad", sku:comp.sku, skuNorm:cn, desc:comp.desc, source:"Inventory", detail:"Component exists in inventory but has zero stock. Verify count or expedite PO.", affectedWOs:aws });
    } }); });

    return { results:results, diagnostics:diag, flags:flags };
  }, [mappingConfirmed, allUploaded, inventory, itemMaster, boms, workOrders, invMapping, bomMapping, woMapping]);

  var summary = useMemo(() => { if (!analysis) return null; var r = analysis.results; return { total:r.length, ready:r.filter(w=>w.runStatus==="ready").length, partial:r.filter(w=>w.runStatus==="partial").length, blocked:r.filter(w=>w.runStatus==="blocked").length, nobom:r.filter(w=>w.runStatus==="nobom").length }; }, [analysis]);

  var criticalItems = useMemo(() => {
    if (!analysis) return [];
    var m = {};
    analysis.results.filter(function(wo) { return !isWorkOrderClosed(wo); }).forEach(wo => { wo.components.forEach(comp => { if (comp.short <= 0) return; var k = normalizeStr(comp.sku); if (!m[k]) m[k] = { sku:comp.sku, desc:comp.desc, onHand:comp.onHand, totalShort:0, affectedWOs:[], unlockedUnits:0, isZeroStock:comp.onHand===0, customersMap:{} }; m[k].desc = pickBetterDescription(m[k].desc || "", comp.desc || "", m[k].sku); m[k].totalShort += comp.short; m[k].unlockedUnits += wo.qtyToProduce - wo.maxRunnable; m[k].affectedWOs.push({ woNum:wo.woNum, productSku:wo.productSkuRaw, customer:wo.customer||"", qtyToProduce:wo.qtyToProduce, needed:comp.needed, short:comp.short, dueDate:wo.dueDate }); if (wo.customer) m[k].customersMap[wo.customer] = true; }); });
    return Object.values(m).map(function(item) {
      var customers = Object.keys(item.customersMap || {});
      return Object.assign({}, item, { customers:customers, customerLabel:customers.length ? customers.join(", ") : "--" });
    });
  }, [analysis]);

  var woStatuses = useMemo(() => { if (!analysis) return []; return [...new Set(analysis.results.map(r => r.status).filter(Boolean))].sort(); }, [analysis]);
  var woCustomers = useMemo(() => { if (!analysis) return []; return [...new Set(analysis.results.map(r => r.customer).filter(Boolean))].sort(); }, [analysis]);

  var poCheck = useMemo(() => {
    if (!poData || !poData.length || !poMapping.material || !poMapping.qty || !analysis) return null;
    var woSkuMap = {};
    analysis.results.forEach(wo => {
      var sk = normalizeStr(wo.productSkuRaw);
      if (!woSkuMap[sk]) woSkuMap[sk] = [];
      woSkuMap[sk].push(wo);
    });
    var lines = [], matched = 0, missing = 0, qtyMismatch = 0, totalPOQty = 0, totalWOQty = 0;
    var poNum = poData[0] && poMapping.poNumber ? (poData[0][poMapping.poNumber]||"").toString().trim() : "";
    poData.forEach(row => {
      var mat = (row[poMapping.material]||"").toString().trim();
      var matNorm = normalizeStr(mat);
      if (!matNorm) return;
      var qty = safeNum(row[poMapping.qty]);
      var desc = poMapping.description ? (row[poMapping.description]||"").toString().trim() : "";
      var price = poMapping.unitPrice ? (row[poMapping.unitPrice]||"").toString().trim() : "";
      totalPOQty += qty;
      var wos = woSkuMap[matNorm] || [];
      var woTotalQty = wos.reduce((s,w) => s + w.qtyToProduce, 0);
      var woTotalProduced = wos.reduce((s,w) => s + w.unitsProduced, 0);
      totalWOQty += woTotalQty;
      var status = "missing";
      if (wos.length > 0) {
        if (Math.abs(woTotalQty - qty) <= 1) { status = "matched"; matched++; }
        else { status = "qty_mismatch"; qtyMismatch++; }
      } else { missing++; }
      lines.push({ material:mat, description:desc, poQty:qty, price:price, status:status, woCount:wos.length, woTotalQty:woTotalQty, woProduced:woTotalProduced, wos:wos, qtyDiff:woTotalQty - qty });
    });
    return { lines:lines, poNum:poNum, matched:matched, missing:missing, qtyMismatch:qtyMismatch, totalLines:lines.length, totalPOQty:totalPOQty, totalWOQty:totalWOQty };
  }, [poData, poMapping, analysis]);

  /* ====== TIMELINE ====== */
  var timelineData = useMemo(() => {
    if (!edrData || !edrData.length || !analysis) return null;
    var edrCols = Object.keys(edrData[0]);
    var findCol = cands => edrCols.find(c => cands.some(p => normalizeStr(c).includes(p)));
    var colMat = findCol(["material"]) || findCol(["sku","itemcode"]);
    var colDesc = findCol(["shorttext","matdesc","desc"]);
    var colDate = findCol(["deliverydate","delivery"]) || findCol(["reqdely"]);
    var colPO = findCol(["purchasingdocument","purchasedoc","ponumber"]);
    var colQtyOpen = findCol(["stilltobedelivered","openqty","stillto"]);
    var colQtyOrd = findCol(["orderquantity","orderqty"]);
    var colTab = "__edrTab";
    if (!colMat || !colDate) return null;
    var dockByPO = {};
    if (dockData && dockData.length) {
      var dC = Object.keys(dockData[0]); var dPO = dC.find(c=>normalizeStr(c)==="po") || dC.find(c=>normalizeStr(c).includes("po")); var dSt = dC.find(c=>normalizeStr(c)==="status"); var dDt = dC.find(c=>normalizeStr(c).includes("apptdate")); var dTm = dC.find(c=>normalizeStr(c).includes("appttime"));
      if (dPO) dockData.forEach(row => { var po = (row[dPO]||"").toString().trim(); if (!po) return; if (!dockByPO[po]) dockByPO[po] = []; dockByPO[po].push({ status:(row[dSt]||"").toString().trim(), apptDate:(row[dDt]||"").toString().trim() }); });
    }
    var deliveries = [];
    edrData.forEach(row => {
      var mat = (row[colMat]||"").toString().trim(); var desc = colDesc ? (row[colDesc]||"").toString().trim() : "";
      var rawDate = row[colDate]; var po = colPO ? (row[colPO]||"").toString().trim() : "";
      var qtyOpen = colQtyOpen ? safeNum(row[colQtyOpen]) : 0; var qtyOrd = colQtyOrd ? safeNum(row[colQtyOrd]) : 0;
      var tab = row[colTab] || "";
      if (!mat || !rawDate) return; var qty = qtyOpen > 0 ? qtyOpen : qtyOrd; if (qty <= 0) return;
      var dateObj; if (rawDate instanceof Date) dateObj = rawDate; else { dateObj = new Date(rawDate); if (isNaN(dateObj)) return; }
      var dateStr = dateObj.toISOString().slice(0,10);
      var dockAppts = dockByPO[po] || [];
      var bestDock = dockAppts.length > 0 ? dockAppts.sort((a,b) => { var o = {Completed:0,Arrived:1,Scheduled:2,Cancelled:3}; return (o[a.status]||9)-(o[b.status]||9); })[0] : null;
      deliveries.push({ sku:mat, skuNorm:normalizeStr(mat), desc:desc, date:dateStr, dateObj:dateObj, qty:qty, po:po, tab:tab, dockStatus:bestDock?bestDock.status:"", qtyOrd:qtyOrd });
    });
    if (!deliveries.length) return null;
    var compToFG = {};
    analysis.results.forEach(wo => {
      wo.components.forEach(comp => {
        var norm = normalizeStr(comp.sku); if (!compToFG[norm]) compToFG[norm] = [];
        compToFG[norm].push({ woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, needed:comp.needed, short:comp.short, qtyToProduce:wo.qtyToProduce });
        if (comp.optionDetails) comp.optionDetails.forEach(opt => { var on = normalizeStr(opt.sku); if (on !== norm) { if (!compToFG[on]) compToFG[on]=[]; compToFG[on].push({ woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, needed:comp.needed, short:comp.short, qtyToProduce:wo.qtyToProduce }); } });
      });
    });
    var byMaterial = {};
    deliveries.forEach(d => { if (!byMaterial[d.skuNorm]) byMaterial[d.skuNorm] = { sku:d.sku, desc:d.desc, deliveries:[], affectedWOs:compToFG[d.skuNorm]||[] }; byMaterial[d.skuNorm].deliveries.push(d); });
    var today = new Date().toISOString().slice(0,10);
    var allDO = deliveries.map(d => d.dateObj); var minD = new Date(Math.min(...allDO, Date.now())); var maxD = new Date(Math.max(...allDO, Date.now()));
    minD.setDate(minD.getDate()-1); maxD.setDate(maxD.getDate()+3);
    var days = []; var cursor = new Date(minD); while (cursor <= maxD) { days.push(cursor.toISOString().slice(0,10)); cursor.setDate(cursor.getDate()+1); }
    var woTimelines = analysis.results.map(wo => {
      var cd = []; wo.components.forEach(comp => { if (comp.short <= 0) return; var allS = [normalizeStr(comp.sku)]; if (comp.optionDetails) comp.optionDetails.forEach(o => allS.push(normalizeStr(o.sku)));
      [...new Set(allS)].forEach(sn => { var md = byMaterial[sn]; if (md) md.deliveries.forEach(d => { cd.push(Object.assign({}, d, { componentSku:comp.sku, short:comp.short, needed:comp.needed })); }); }); });
      var dueDateStr = ""; if (wo.dueDate) { var p = new Date(wo.dueDate); if (!isNaN(p)) dueDateStr = p.toISOString().slice(0,10); }
      var delByDate = {}; cd.forEach(d => { if (!delByDate[d.date]) delByDate[d.date] = { items:[], totalQty:0 }; delByDate[d.date].items.push(d); delByDate[d.date].totalQty += d.qty; });
      return { woNum:wo.woNum, productSku:wo.productSkuRaw, productDesc:wo.productDesc, qtyToProduce:wo.qtyToProduce, readiness:wo.readiness, runStatus:wo.runStatus, maxRunnable:wo.maxRunnable, dueDate:dueDateStr, hasDeliveries:cd.length>0, deliveries:cd, delByDate:delByDate, totalIncoming:cd.reduce((s,d)=>s+d.qty,0) };
    }).filter(w => w.hasDeliveries).sort((a,b) => (a.dueDate||"zzz").localeCompare(b.dueDate||"zzz"));
    return { days:days, today:today, woTimelines:woTimelines, deliveries:deliveries, byMaterial:byMaterial, totalDeliveries:deliveries.length, matchedToBOM:deliveries.filter(d=>(compToFG[d.skuNorm]||[]).length>0).length, withDockAppt:deliveries.filter(d=>d.dockStatus).length };
  }, [edrData, dockData, analysis]);

  /* ====== INBOUND COVERAGE (CRITICAL ITEMS) ====== */
  var inboundCoverage = useMemo(() => {
    if (!analysis || !criticalItems || !criticalItems.length) return null;
    var horizonDays = 30;
    var now = new Date();
    var horizonEnd = new Date(now.getTime() + horizonDays * 86400000);

    var edrRows = Array.isArray(edrData) ? edrData : [];
    var dockRows = Array.isArray(dockData) ? dockData : [];
    if (!edrRows.length) {
      return {
        horizonDays: horizonDays,
        summary: {
          totalCriticalItems: criticalItems.length,
          covered: 0, partial: 0, unscheduled: 0, missing: criticalItems.length,
          atRisk: criticalItems.length, dueSoon: 0,
          totalShortQty: criticalItems.reduce(function(s, i) { return s + (i.totalShort || 0); }, 0),
          totalInboundQty: 0, totalScheduledQty: 0
        },
        rows: criticalItems.map(function(item) {
          var shortQty = item.totalShort || 0;
          return {
            sku: item.sku,
            desc: item.desc || "",
            customerLabel: item.customerLabel || "--",
            shortQty: shortQty,
            affectedWOCount: item.affectedWOs ? item.affectedWOs.length : 0,
            earliestDueDate: "",
            earliestInboundDate: "",
            earliestScheduledDate: "",
            inboundQty: 0,
            scheduledQty: 0,
            unscheduledQty: 0,
            uncoveredQty: shortQty,
            coveragePct: 0,
            scheduledCoveragePct: 0,
            dueBeforeScheduled: false,
            dueWithin48h: false,
            status: "missing",
            riskLevel: "high",
            dockStatuses: [],
            openPOs: [],
            scheduledPOs: [],
            recommendedAction: "Create / Expedite PO",
          };
        })
      };
    }

    var edrCols = Object.keys(edrRows[0] || {});
    var findEdrCol = function(cands) {
      return edrCols.find(function(c) { return cands.some(function(p) { return normalizeStr(c).includes(p); }); });
    };
    var colMat = findEdrCol(["material"]) || findEdrCol(["sku", "itemcode"]);
    var colDate = findEdrCol(["deliverydate", "delivery"]) || findEdrCol(["reqdely"]);
    var colPO = findEdrCol(["purchasingdocument", "purchasedoc", "ponumber", "po"]);
    var colQtyOpen = findEdrCol(["stilltobedelivered", "openqty", "stillto"]);
    var colQtyOrd = findEdrCol(["orderquantity", "orderqty"]);
    if (!colMat || !colDate) return null;

    var dockScheduledByPO = {};
    var dockStatusesByPO = {};
    if (dockRows.length) {
      var dockCols = Object.keys(dockRows[0] || {});
      var findDockCol = function(cands) {
        return dockCols.find(function(c) { return cands.some(function(p) { return normalizeStr(c).includes(p); }); });
      };
      var dPO = findDockCol(["po", "ponumber", "reference"]);
      var dStatus = findDockCol(["status"]);
      if (dPO && dStatus) {
        dockRows.forEach(function(row) {
          var poRaw = (row[dPO] || "").toString().trim();
          var poKey = normalizePoKey(poRaw);
          if (!poKey) return;
          var status = (row[dStatus] || "").toString().trim();
          if (!status) return;
          var statusNorm = normalizeStr(status);
          if (!dockStatusesByPO[poKey]) dockStatusesByPO[poKey] = {};
          dockStatusesByPO[poKey][status] = true;
          if (statusNorm.includes("scheduled")) dockScheduledByPO[poKey] = true;
        });
      }
    }

    var inboundBySku = {};
    edrRows.forEach(function(row) {
      var skuRaw = (row[colMat] || "").toString().trim();
      var skuNorm = normalizeStr(skuRaw);
      if (!skuNorm) return;
      var rawDate = row[colDate];
      var dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (isNaN(dateObj)) return;
      if (dateObj < now || dateObj > horizonEnd) return;
      var po = colPO ? (row[colPO] || "").toString().trim() : "";
      var poKey = normalizePoKey(po);
      var qtyOpen = colQtyOpen ? safeNum(row[colQtyOpen]) : 0;
      var qtyOrd = colQtyOrd ? safeNum(row[colQtyOrd]) : 0;
      var qty = qtyOpen > 0 ? qtyOpen : qtyOrd;
      if (qty <= 0) return;
      if (!inboundBySku[skuNorm]) inboundBySku[skuNorm] = [];
      inboundBySku[skuNorm].push({
        sku: skuRaw,
        qty: qty,
        po: po,
        poKey: poKey,
        dateObj: dateObj,
        date: dateObj.toISOString().slice(0, 10),
        isScheduled: !!(poKey && dockScheduledByPO[poKey]),
      });
    });

    var rows = criticalItems.map(function(item) {
      var skuNorm = normalizeStr(item.sku);
      var inboundRows = inboundBySku[skuNorm] || [];
      var shortQty = Math.max(0, safeNum(item.totalShort || 0));
      var inboundQty = inboundRows.reduce(function(s, r) { return s + r.qty; }, 0);
      var scheduledRows = inboundRows.filter(function(r) { return r.isScheduled; });
      var scheduledQty = scheduledRows.reduce(function(s, r) { return s + r.qty; }, 0);
      var unscheduledQty = Math.max(0, inboundQty - scheduledQty);
      var uncoveredQty = Math.max(0, shortQty - scheduledQty);
      var coveragePct = shortQty > 0 ? Math.min(100, Math.round(inboundQty / shortQty * 100)) : 100;
      var scheduledCoveragePct = shortQty > 0 ? Math.min(100, Math.round(scheduledQty / shortQty * 100)) : 100;

      var earliestInboundDate = inboundRows.length
        ? inboundRows.slice().sort(function(a, b) { return a.dateObj - b.dateObj; })[0].date
        : "";
      var earliestScheduledDate = scheduledRows.length
        ? scheduledRows.slice().sort(function(a, b) { return a.dateObj - b.dateObj; })[0].date
        : "";

      var earliestDue = "";
      if (item.affectedWOs && item.affectedWOs.length) {
        var dueDates = item.affectedWOs
          .map(function(w) {
            var d = w && w.dueDate ? new Date(w.dueDate) : null;
            return d && !isNaN(d) ? d : null;
          })
          .filter(Boolean)
          .sort(function(a, b) { return a - b; });
        if (dueDates.length) earliestDue = dueDates[0].toISOString().slice(0, 10);
      }

      var dueWithin48h = false;
      var dueBeforeScheduled = false;
      if (earliestDue) {
        var dueObj = new Date(earliestDue);
        dueWithin48h = dueObj.getTime() - now.getTime() <= 48 * 3600000;
        if (earliestScheduledDate) {
          dueBeforeScheduled = dueObj < new Date(earliestScheduledDate);
        } else if (shortQty > 0) {
          dueBeforeScheduled = true;
        }
      }

      var status = "covered";
      if (scheduledQty <= 0 && inboundQty <= 0) status = "missing";
      else if (scheduledQty <= 0 && inboundQty > 0) status = "unscheduled";
      else if (scheduledQty < shortQty) status = "partial";

      var riskLevel = "low";
      if (status === "missing" || dueBeforeScheduled) riskLevel = "high";
      else if (status === "unscheduled" || status === "partial" || dueWithin48h) riskLevel = "medium";
      var recommendedAction = "Monitor";
      if (status === "missing") recommendedAction = "Create / Expedite PO";
      else if (status === "unscheduled") recommendedAction = "Schedule OpenDock";
      else if (status === "partial") recommendedAction = "Expedite Balance";
      if (dueBeforeScheduled) recommendedAction = "Resequence WO / Expedite";

      var openPOs = Array.from(new Set(inboundRows.map(function(r) { return r.po; }).filter(Boolean)));
      var scheduledPOs = Array.from(new Set(scheduledRows.map(function(r) { return r.po; }).filter(Boolean)));
      var openPOKeys = Array.from(new Set(inboundRows.map(function(r) { return r.poKey; }).filter(Boolean)));
      var dockStatuses = Array.from(
        new Set(
          openPOKeys.flatMap(function(poKey) { return Object.keys(dockStatusesByPO[poKey] || {}); })
        )
      );

      return {
        sku: item.sku,
        desc: item.desc || "",
        customerLabel: item.customerLabel || "--",
        shortQty: shortQty,
        affectedWOCount: item.affectedWOs ? item.affectedWOs.length : 0,
        earliestDueDate: earliestDue,
        earliestInboundDate: earliestInboundDate,
        earliestScheduledDate: earliestScheduledDate,
        inboundQty: inboundQty,
        scheduledQty: scheduledQty,
        unscheduledQty: unscheduledQty,
        uncoveredQty: uncoveredQty,
        coveragePct: coveragePct,
        scheduledCoveragePct: scheduledCoveragePct,
        dueBeforeScheduled: dueBeforeScheduled,
        dueWithin48h: dueWithin48h,
        status: status,
        riskLevel: riskLevel,
        dockStatuses: dockStatuses,
        openPOs: openPOs,
        scheduledPOs: scheduledPOs,
        recommendedAction: recommendedAction,
      };
    }).sort(function(a, b) {
      if (a.riskLevel !== b.riskLevel) {
        var rank = { high: 0, medium: 1, low: 2 };
        return rank[a.riskLevel] - rank[b.riskLevel];
      }
      if (a.status !== b.status) {
        var sRank = { missing: 0, unscheduled: 1, partial: 2, covered: 3 };
        return sRank[a.status] - sRank[b.status];
      }
      return b.shortQty - a.shortQty;
    });

    var summary = {
      totalCriticalItems: rows.length,
      covered: rows.filter(function(r) { return r.status === "covered"; }).length,
      partial: rows.filter(function(r) { return r.status === "partial"; }).length,
      unscheduled: rows.filter(function(r) { return r.status === "unscheduled"; }).length,
      missing: rows.filter(function(r) { return r.status === "missing"; }).length,
      atRisk: rows.filter(function(r) { return r.riskLevel !== "low"; }).length,
      dueSoon: rows.filter(function(r) { return r.dueWithin48h; }).length,
      totalShortQty: rows.reduce(function(s, r) { return s + r.shortQty; }, 0),
      totalUncoveredQty: rows.reduce(function(s, r) { return s + (r.uncoveredQty || 0); }, 0),
      totalInboundQty: rows.reduce(function(s, r) { return s + r.inboundQty; }, 0),
      totalScheduledQty: rows.reduce(function(s, r) { return s + r.scheduledQty; }, 0),
    };

    return { horizonDays: horizonDays, summary: summary, rows: rows };
  }, [analysis, criticalItems, edrData, dockData]);

  return { analysis, summary, criticalItems, woStatuses, woCustomers, poCheck, timelineData, inboundCoverage };
}
