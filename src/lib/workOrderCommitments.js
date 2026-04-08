import { normalizeStr, safeNum } from "../utils";

function parseCommitmentDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  var raw = String(value).trim();
  if (!raw) return null;
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

function parseDueDateTs(value) {
  var parsed = parseCommitmentDateValue(value);
  return parsed ? parsed.getTime() : Number.POSITIVE_INFINITY;
}

export function buildWorkOrderCommitKey(wo) {
  return [wo && wo.woNum || "", wo && (wo.productSkuRaw || wo.productSku) || "", wo && wo.dueDate || ""].join("|");
}

export function statusLooksClosed(status) {
  var normalized = normalizeStr(status || "");
  if (!normalized) return false;
  return normalized.includes("close") || normalized.includes("complete") || normalized.includes("cancel") || normalized.includes("archive") || normalized.includes("done");
}

export function buildWorkOrderCommitmentMap(results) {
  var activeWOs = (results || []).filter(function(wo) {
    if (!wo || wo.runStatus === "nobom") return false;
    return !statusLooksClosed(wo.status);
  }).slice().sort(function(a, b) {
    var dueDelta = parseDueDateTs(a && a.dueDate) - parseDueDateTs(b && b.dueDate);
    if (dueDelta !== 0) return dueDelta;
    return String(a && a.woNum || "").localeCompare(String(b && b.woNum || ""), undefined, { numeric:true, sensitivity:"base" });
  });

  var remainingBySku = {};
  activeWOs.forEach(function(wo) {
    (wo.components || []).forEach(function(comp) {
      var seen = {};
      var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
      optionRows.forEach(function(opt) {
        var key = normalizeStr(opt.sku || "");
        if (!key || seen[key]) return;
        seen[key] = true;
        var onHand = safeNum(opt.onHand || 0);
        if (!Object.prototype.hasOwnProperty.call(remainingBySku, key) || onHand > remainingBySku[key]) remainingBySku[key] = onHand;
      });
    });
  });

  var initialBySku = Object.assign({}, remainingBySku);
  var usageByPrimary = {};
  activeWOs.forEach(function(wo) {
    var seen = {};
    (wo.components || []).forEach(function(comp) {
      var key = normalizeStr(comp.sku || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      usageByPrimary[key] = (usageByPrimary[key] || 0) + 1;
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
      var qtyPer = safeNum(comp.qtyPer || 0);
      if (!(qtyPer > 0)) return;
      var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
      var options = optionRows.map(function(opt) {
        var key = normalizeStr(opt.sku || "");
        return { key:key, sku:opt.sku || "", isSub:!!opt.isSub };
      }).filter(function(opt) { return !!opt.key; });

      var available = options.reduce(function(sum, opt) { return sum + safeNum(remainingBySku[opt.key] || 0); }, 0);
      var isolatedAvailable = options.reduce(function(sum, opt) { return sum + safeNum(initialBySku[opt.key] || 0); }, 0);
      var consumedBefore = Math.max(0, isolatedAvailable - available);
      var makeUnits = Math.floor(available / qtyPer);
      var isolatedMakeUnits = Math.floor(isolatedAvailable / qtyPer);
      var compKey = normalizeStr(comp.sku || "");
      var isSharedAcrossWOs = !!(compKey && (usageByPrimary[compKey] || 0) > 1);

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
      if (isSharedAcrossWOs) sharedDetails.push(comp.sku || compKey);
    });

    if (!isFinite(committed)) committed = 0;
    committed = Math.max(0, Math.min(committed, safeNum(wo.unitsRemaining || 0)));

    compList.forEach(function(comp) {
      var qtyPer = safeNum(comp.qtyPer || 0);
      if (!(qtyPer > 0)) return;
      var need = committed * qtyPer;
      if (need <= 0) return;

      var optionRows = comp.optionDetails && comp.optionDetails.length ? comp.optionDetails.slice() : [{ sku:comp.sku, onHand:comp.onHand || 0, isSub:false }];
      optionRows.sort(function(a, b) {
        if (!!a.isSub !== !!b.isSub) return a.isSub ? 1 : -1;
        return safeNum(b.onHand || 0) - safeNum(a.onHand || 0);
      });

      var remainingNeed = need;
      optionRows.forEach(function(opt) {
        if (remainingNeed <= 0) return;
        var key = normalizeStr(opt.sku || "");
        if (!key) return;
        var available = safeNum(remainingBySku[key] || 0);
        if (available <= 0) return;
        var take = Math.min(available, remainingNeed);
        remainingBySku[key] = available - take;
        remainingNeed -= take;
      });
    });

    var localCanMake = safeNum(wo.maxRunnable || 0);
    var gap = Math.max(0, localCanMake - committed);
    map[buildWorkOrderCommitKey(wo)] = {
      committedCanMake: committed,
      commitmentGap: gap,
      sharedConstraint: gap > 0 || sharedDetails.length > 0,
      sharedComponents: Array.from(new Set(sharedDetails)).slice(0, 3),
      componentPressure: componentPressure
    };
  });

  return map;
}
