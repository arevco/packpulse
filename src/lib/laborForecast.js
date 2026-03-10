import { detectPackType, normalizeStr, safeNum } from "../utils.js";

function pickValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = String(keys[i] || "").toLowerCase();
    for (var j = 0; j < rowKeys.length; j++) {
      var key = rowKeys[j];
      if (String(key).toLowerCase() === target) return row[key];
    }
  }
  for (var x = 0; x < keys.length; x++) {
    var normTarget = normalizeStr(keys[x]);
    for (var y = 0; y < rowKeys.length; y++) {
      var rowKey = rowKeys[y];
      if (normalizeStr(rowKey) === normTarget) return row[rowKey];
    }
  }
  return "";
}

function toIsoDay(value) {
  if (!value) return "";
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function inMonth(isoDay, monthKey) {
  if (!monthKey) return true;
  return String(isoDay || "").slice(0, 7) === String(monthKey);
}

function statusLooksClosed(status) {
  var s = normalizeStr(status || "");
  if (!s) return false;
  return s.indexOf("close") !== -1 || s.indexOf("complete") !== -1 || s.indexOf("cancel") !== -1 || s.indexOf("archive") !== -1 || s.indexOf("done") !== -1;
}

function statusLooksBooked(status) {
  var s = normalizeStr(status || "");
  if (!s) return false;
  return s.indexOf("book") !== -1;
}

function getWoDateIso(wo) {
  var due = pickValue(wo, ["Due Date", "due_date_at", "due_date", "dueDate"]);
  var start = pickValue(wo, ["Planned Start", "planned_start_at", "planned_start", "plannedStart"]);
  var end = pickValue(wo, ["Planned End", "planned_end_at", "planned_end", "plannedEnd"]);
  // Align month bucketing with Work Orders view behavior: use due date first.
  return toIsoDay(due) || toIsoDay(start) || toIsoDay(end) || "";
}

function eachDayInclusive(startIso, endIso) {
  var out = [];
  if (!startIso || !endIso) return out;
  var s = new Date(startIso + "T00:00:00Z");
  var e = new Date(endIso + "T00:00:00Z");
  if (isNaN(s) || isNaN(e) || e < s) return out;
  for (var d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function parseOverridesBySkuLine(overrides, monthKey) {
  var map = {};
  (Array.isArray(overrides) ? overrides : []).forEach(function(o) {
    if (!o || typeof o !== "object") return;
    var mk = String(o.month_key || "");
    if (monthKey && mk && mk !== monthKey) return;
    var sku = String(o.sku || "").trim();
    var line = String(o.line_name || "").trim();
    if (!sku) return;
    var key = normalizeStr(sku) + "::" + normalizeStr(line);
    map[key] = o;
  });
  return map;
}

function resolveRevenuePerCase(sku, woDateIso, pricingRows, itemMasterCostMap) {
  var skuNorm = normalizeStr(sku);
  var best = 0;
  (Array.isArray(pricingRows) ? pricingRows : []).forEach(function(p) {
    var pSku = String(p.sku || p.item_code || p.code || "").trim();
    if (!pSku || normalizeStr(pSku) !== skuNorm) return;
    var start = String(p.effective_start || p.active_from || "1900-01-01");
    var end = String(p.effective_end || p.active_to || "9999-12-31");
    var t = woDateIso || "9999-01-01";
    if (t < start || t > end) return;
    var rev = safeNum(p.revenue_per_case);
    if (rev > 0) best = rev;
  });
  if (best > 0) return { value: best, source: "pricing" };
  var im = safeNum(itemMasterCostMap[skuNorm]);
  if (im > 0) return { value: im, source: "item_master_cost_per_unit" };
  return { value: 0, source: "missing" };
}

function buildItemMasterCostMap(itemMasterRows) {
  var out = {};
  (Array.isArray(itemMasterRows) ? itemMasterRows : []).forEach(function(row) {
    var sku = String(pickValue(row, ["Item Code", "Code", "item_code", "code"])).trim();
    if (!sku) return;
    var skuNorm = normalizeStr(sku);
    var cost = safeNum(
      pickValue(row, [
        "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
        "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
      ])
    );
    if (!(cost > 0)) return;
    out[skuNorm] = cost;
  });
  return out;
}

function resolveCasesPerMin(wo, override) {
  var ov = override ? safeNum(override.override_cases_per_min) : 0;
  if (ov > 0) return { value: ov, source: "override" };
  var unitsPerHour = safeNum(
    pickValue(wo, [
      "Standard Units Per Hour", "standard_units_per_hour", "units_per_hour",
      "Units Per Hour", "rate_per_hour", "Rate Per Hour"
    ])
  );
  if (unitsPerHour > 0) return { value: unitsPerHour / 60, source: "work_order" };
  return { value: 0, source: "missing" };
}

function resolveLineName(wo) {
  return String(pickValue(wo, ["Line", "line", "Line Name", "line_name"])).trim() || "Unassigned";
}

function resolvePackType(wo, override) {
  var direct = String((override && (override.override_pack_type || override.pack_type)) || "").trim();
  if (direct) return direct;
  var fromWo = String(pickValue(wo, ["Pack Type", "pack_type", "Item Type", "item_type"])).trim();
  if (fromWo) return fromWo;
  var desc = String(pickValue(wo, ["Description", "description", "Item Description", "item_description"])).trim();
  var sku = String(pickValue(wo, ["Item Code", "item_code", "Code", "code"])).trim();
  return detectPackType(desc || sku, sku);
}

function normalizeTemplateRows(templateRows) {
  return (Array.isArray(templateRows) ? templateRows : [])
    .map(function(t) {
      return {
        sku: String(t.sku || t.item_code || "").trim(),
        product_family: String(t.product_family || t.item_family || t.sku_type || "").trim(),
        pack_type: String(t.pack_type || t.product_type || "").trim(),
        line_name: String(t.line_name || "").trim(),
        role: String(t.role || "").trim().toLowerCase(),
        headcount_assumed: safeNum(t.headcount_assumed),
        hourly_rate: safeNum(t.hourly_rate)
      };
    })
    .filter(function(t) { return t.role && t.hourly_rate > 0; });
}

function pickTemplateForSkuLine(templates, sku, lineName, packType, productFamily) {
  var skuNorm = normalizeStr(sku);
  var lineNorm = normalizeStr(lineName);
  var packNorm = normalizeStr(packType);
  var familyNorm = normalizeStr(productFamily);
  var exact = templates.filter(function(t) {
    return normalizeStr(t.sku) === skuNorm && normalizeStr(t.line_name) === lineNorm;
  });
  if (exact.length) return exact;
  var skuPackLine = templates.filter(function(t) {
    return normalizeStr(t.sku) === skuNorm &&
      (!packNorm || !normalizeStr(t.pack_type) || normalizeStr(t.pack_type) === packNorm) &&
      (!lineNorm || !normalizeStr(t.line_name) || normalizeStr(t.line_name) === lineNorm);
  });
  if (skuPackLine.length) return skuPackLine;
  var skuOnly = templates.filter(function(t) { return normalizeStr(t.sku) === skuNorm; });
  if (skuOnly.length) return skuOnly;
  var familyLine = templates.filter(function(t) {
    return (
      (familyNorm && normalizeStr(t.product_family) === familyNorm) ||
      (packNorm && normalizeStr(t.pack_type) === packNorm)
    ) && normalizeStr(t.line_name) === lineNorm;
  });
  if (familyLine.length) return familyLine;
  var familyOnly = templates.filter(function(t) {
    return (familyNorm && normalizeStr(t.product_family) === familyNorm) ||
      (packNorm && normalizeStr(t.pack_type) === packNorm);
  });
  if (familyOnly.length) return familyOnly;
  var lineOnly = templates.filter(function(t) {
    return !String(t.sku || "").trim() &&
      !String(t.product_family || "").trim() &&
      !String(t.pack_type || "").trim() &&
      normalizeStr(t.line_name) === lineNorm;
  });
  if (lineOnly.length) return lineOnly;
  var global = templates.filter(function(t) { return !String(t.sku || "").trim(); });
  return global;
}

function withOverrideTemplateRows(baseRows, override) {
  if (!override || typeof override !== "object") return baseRows;
  var hc = override.override_headcount_by_role || {};
  var hr = override.override_hourly_rate_by_role || {};
  return baseRows.map(function(r) {
    var role = String(r.role || "").toLowerCase();
    var roleHc = safeNum(hc[role]);
    var roleHr = safeNum(hr[role]);
    return Object.assign({}, r, {
      headcount_assumed: roleHc > 0 ? roleHc : r.headcount_assumed,
      hourly_rate: roleHr > 0 ? roleHr : r.hourly_rate
    });
  });
}

function sumRoleHourlyCost(templateRows) {
  return (Array.isArray(templateRows) ? templateRows : []).reduce(function(sum, r) {
    return sum + safeNum(r.headcount_assumed) * safeNum(r.hourly_rate);
  }, 0);
}

function sumRoleHeadcount(templateRows) {
  return (Array.isArray(templateRows) ? templateRows : []).reduce(function(sum, r) {
    return sum + safeNum(r.headcount_assumed);
  }, 0);
}

function addToBucket(map, key, value) {
  if (!map[key]) map[key] = 0;
  map[key] += safeNum(value);
}

export function runLaborForecast(input) {
  var payload = input || {};
  var monthKey = String(payload.monthKey || payload.month || "").trim();
  var workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
  var itemMaster = Array.isArray(payload.itemMaster) ? payload.itemMaster : [];
  var pricing = Array.isArray(payload.pricing) ? payload.pricing : [];
  var templateRows = normalizeTemplateRows(payload.laborTemplates);
  var overridesMap = parseOverridesBySkuLine(payload.overrides, monthKey);
  var globalAssumptions = payload.globalAssumptions || {};
  var overheadGlobal = safeNum(globalAssumptions.overhead_global);
  var cogsNonLabor = safeNum(globalAssumptions.cogs_non_labor);
  var equipmentRental = safeNum(globalAssumptions.equipment_rental);

  var itemMasterCostMap = buildItemMasterCostMap(itemMaster);
  var flags = [];
  var rows = [];
  var daily = {};
  var scopedTotalCases = 0;
  var excludedMissingThroughputCases = 0;
  var excludedMissingTemplateCases = 0;
  var excludedMissingThroughputWos = 0;
  var excludedMissingTemplateWos = 0;

  for (var i = 0; i < workOrders.length; i++) {
    var wo = workOrders[i] || {};
    var woCode = String(pickValue(wo, ["Work Order Code", "project_code", "Project Code", "wo_number", "wo"])).trim() || ("row-" + i);
    var sku = String(pickValue(wo, ["Item Code", "item_code", "Code", "code"])).trim();
    var lineName = resolveLineName(wo);
    var dateIso = getWoDateIso(wo);
    var woMonth = String(dateIso || "").slice(0, 7);
    var status = String(pickValue(wo, ["Work Order Status", "project_status", "status"])).trim();
    var isClosed = statusLooksClosed(status);
    var unitsExpected = safeNum(pickValue(wo, ["Units Expected", "units_expected", "Order Qty", "qtyToProduce", "quantity"]));
    var unitsProduced = safeNum(pickValue(wo, ["Units Produced", "units_produced", "produced"]));
    var explicitRemaining = safeNum(pickValue(wo, ["Units Remaining", "units_remaining", "remaining"]));
    var remainingCases = explicitRemaining > 0 ? explicitRemaining : Math.max(0, unitsExpected - unitsProduced);
    var isPriorOpenRollover = !!(monthKey && woMonth && woMonth < monthKey && statusLooksBooked(status) && remainingCases > 0);
    var isCurrentMonth = !!(monthKey && woMonth === monthKey);
    if (monthKey && !isCurrentMonth && !isPriorOpenRollover) continue;

    // Monthly case scope:
    // - Current-month WOs: use total planned/expected cases
    // - Prior open WOs rolling in: use remaining cases only
    var plannedCases = unitsExpected;
    if (monthKey && isPriorOpenRollover) plannedCases = remainingCases;
    if (!(plannedCases > 0) && monthKey && isCurrentMonth && remainingCases > 0) plannedCases = remainingCases;
    if (!(plannedCases > 0)) continue;
    scopedTotalCases += plannedCases;

    var overrideKey = normalizeStr(sku) + "::" + normalizeStr(lineName);
    var override = overridesMap[overrideKey] || overridesMap[normalizeStr(sku) + "::"];
    var packType = resolvePackType(wo, override);
    var productFamily = String(pickValue(wo, ["Product Family", "product_family", "Item Family", "item_family"])).trim();
    if (override && override.override_line_name) lineName = String(override.override_line_name || lineName).trim() || lineName;
    var throughput = resolveCasesPerMin(wo, override);
    if (!(throughput.value > 0)) {
      excludedMissingThroughputCases += plannedCases;
      excludedMissingThroughputWos += 1;
      flags.push({
        type: "missing_throughput",
        woCode: woCode,
        sku: sku,
        message: "Work order is missing throughput (cases/min). Update Nulogy."
      });
      continue;
    }

    var templates = pickTemplateForSkuLine(templateRows, sku, lineName, packType, productFamily);
    if (!templates.length) {
      excludedMissingTemplateCases += plannedCases;
      excludedMissingTemplateWos += 1;
      flags.push({
        type: "missing_labor_template",
        woCode: woCode,
        sku: sku,
        message: "No labor template found for SKU/line."
      });
      continue;
    }
    var effectiveTemplate = withOverrideTemplateRows(templates, override);
    var lineHourlyLaborCost = sumRoleHourlyCost(effectiveTemplate);
    var lineHeadcount = sumRoleHeadcount(effectiveTemplate);
    var productionHours = plannedCases / (throughput.value * 60);
    var runLaborCost = lineHourlyLaborCost * productionHours;
    var headcountHours = lineHeadcount * productionHours;

    var rev = resolveRevenuePerCase(sku, dateIso, pricing, itemMasterCostMap);
    if (!(rev.value > 0)) {
      flags.push({
        type: "missing_revenue",
        woCode: woCode,
        sku: sku,
        message: "No revenue per case found for SKU."
      });
    }
    var revenue = plannedCases * rev.value;
    var grossProfit = revenue - runLaborCost;

    var row = {
      month_key: monthKey || (dateIso ? String(dateIso).slice(0, 7) : ""),
      day_key: dateIso || (monthKey ? monthKey + "-01" : ""),
      wo_code: woCode,
      sku: sku || "--",
      pack_type: packType || "",
      line_name: lineName,
      wo_status: status || "",
      rollover_source: isPriorOpenRollover ? "prior_open_balance" : "none",
      planned_cases: plannedCases,
      cases_per_min: throughput.value,
      throughput_source: throughput.source,
      production_hours: productionHours,
      line_hourly_labor_cost: lineHourlyLaborCost,
      line_run_labor_cost: runLaborCost,
      headcount_hours: headcountHours,
      revenue_per_case: rev.value,
      revenue_source: rev.source,
      revenue: revenue,
      gross_profit: grossProfit,
      gross_margin_pct: revenue > 0 ? (grossProfit / revenue) : 0
    };
    rows.push(row);

    var startIso = isPriorOpenRollover ? "" : toIsoDay(pickValue(wo, ["Planned Start", "planned_start_at", "planned_start", "plannedStart"]));
    var endIso = isPriorOpenRollover ? "" : toIsoDay(pickValue(wo, ["Planned End", "planned_end_at", "planned_end", "plannedEnd"]));
    var dailyDays = eachDayInclusive(startIso, endIso);
    if (!dailyDays.length) dailyDays = [dateIso || (monthKey ? (monthKey + "-01") : "")].filter(Boolean);
    var perDayCases = plannedCases / Math.max(1, dailyDays.length);
    var perDayRevenue = revenue / Math.max(1, dailyDays.length);
    var perDayLabor = runLaborCost / Math.max(1, dailyDays.length);
    var perDayHours = productionHours / Math.max(1, dailyDays.length);
    var perDayHeadcountHours = headcountHours / Math.max(1, dailyDays.length);
    dailyDays.forEach(function(day) {
      if (!daily[day]) {
        daily[day] = {
          day_key: day,
          planned_cases: 0,
          revenue: 0,
          labor_cost: 0,
          production_hours: 0,
          headcount_hours: 0
        };
      }
      daily[day].planned_cases += perDayCases;
      daily[day].revenue += perDayRevenue;
      daily[day].labor_cost += perDayLabor;
      daily[day].production_hours += perDayHours;
      daily[day].headcount_hours += perDayHeadcountHours;
    });
  }

  var skuAgg = {};
  rows.forEach(function(r) {
    var k = normalizeStr(r.sku);
    if (!skuAgg[k]) {
      skuAgg[k] = {
        sku: r.sku,
        planned_cases: 0,
        revenue: 0,
        labor_cost: 0,
        production_hours: 0,
        headcount_hours: 0
      };
    }
    addToBucket(skuAgg[k], "planned_cases", r.planned_cases);
    addToBucket(skuAgg[k], "revenue", r.revenue);
    addToBucket(skuAgg[k], "labor_cost", r.line_run_labor_cost);
    addToBucket(skuAgg[k], "production_hours", r.production_hours);
    addToBucket(skuAgg[k], "headcount_hours", r.headcount_hours);
  });

  var bySku = Object.keys(skuAgg).map(function(k) {
    var s = skuAgg[k];
    var grossProfit = s.revenue - s.labor_cost;
    return Object.assign({}, s, {
      labor_cost_per_case: s.planned_cases > 0 ? s.labor_cost / s.planned_cases : 0,
      labor_pct_sales: s.revenue > 0 ? s.labor_cost / s.revenue : 0,
      gross_profit: grossProfit,
      gross_margin_pct: s.revenue > 0 ? grossProfit / s.revenue : 0
    });
  }).sort(function(a, b) { return b.planned_cases - a.planned_cases; });

  var totals = rows.reduce(function(acc, r) {
    acc.total_cases += safeNum(r.planned_cases);
    acc.total_revenue += safeNum(r.revenue);
    acc.total_labor_cost += safeNum(r.line_run_labor_cost);
    acc.total_prod_hours += safeNum(r.production_hours);
    acc.total_headcount_hours += safeNum(r.headcount_hours);
    return acc;
  }, {
    total_cases: 0,
    total_revenue: 0,
    total_labor_cost: 0,
    total_prod_hours: 0,
    total_headcount_hours: 0
  });
  var rolloverRows = rows.filter(function(r) { return r.rollover_source && r.rollover_source !== "none"; });
  var rolloverCases = rolloverRows.reduce(function(sum, r) { return sum + safeNum(r.planned_cases); }, 0);

  var grossProfitAfterProdLabor = totals.total_revenue - totals.total_labor_cost;
  var grossProfitAfterCogs = grossProfitAfterProdLabor - cogsNonLabor - equipmentRental;
  var netOperatingIncome = grossProfitAfterCogs - overheadGlobal;
  var grossMargin = totals.total_revenue - totals.total_labor_cost - cogsNonLabor;

  var summary = {
    month_key: monthKey,
    total_cases: totals.total_cases,
    scoped_total_cases: scopedTotalCases,
    excluded_cases_total: Math.max(0, scopedTotalCases - totals.total_cases),
    excluded_missing_throughput_cases: excludedMissingThroughputCases,
    excluded_missing_labor_template_cases: excludedMissingTemplateCases,
    total_revenue: totals.total_revenue,
    total_labor_cost: totals.total_labor_cost,
    labor_cost_per_case: totals.total_cases > 0 ? totals.total_labor_cost / totals.total_cases : 0,
    labor_pct_sales: totals.total_revenue > 0 ? totals.total_labor_cost / totals.total_revenue : 0,
    gross_margin: grossMargin,
    gross_margin_pct: totals.total_revenue > 0 ? grossMargin / totals.total_revenue : 0,
    gross_profit_after_prod_labor: grossProfitAfterProdLabor,
    gross_profit_after_cogs: grossProfitAfterCogs,
    net_operating_income: netOperatingIncome,
    overhead_global: overheadGlobal,
    cogs_non_labor: cogsNonLabor,
    equipment_rental: equipmentRental,
    total_prod_hours: totals.total_prod_hours,
    total_headcount_hours: totals.total_headcount_hours,
    rollover_wo_count: rolloverRows.length,
    rollover_cases: rolloverCases,
    missing_throughput_wo_count: flags.filter(function(f) { return f.type === "missing_throughput"; }).length,
    missing_labor_template_wo_count: flags.filter(function(f) { return f.type === "missing_labor_template"; }).length,
    missing_revenue_wo_count: flags.filter(function(f) { return f.type === "missing_revenue"; }).length,
    excluded_missing_throughput_wo_count: excludedMissingThroughputWos,
    excluded_missing_labor_template_wo_count: excludedMissingTemplateWos
  };

  var dailyRows = Object.keys(daily).sort().map(function(day) {
    var d = daily[day];
    var gp = d.revenue - d.labor_cost;
    return {
      day_key: day,
      planned_cases: d.planned_cases,
      revenue: d.revenue,
      labor_cost: d.labor_cost,
      labor_cost_per_case: d.planned_cases > 0 ? d.labor_cost / d.planned_cases : 0,
      labor_pct_sales: d.revenue > 0 ? d.labor_cost / d.revenue : 0,
      gross_profit: gp,
      gross_margin_pct: d.revenue > 0 ? gp / d.revenue : 0,
      production_hours: d.production_hours,
      headcount_hours: d.headcount_hours
    };
  });

  return {
    monthKey: monthKey,
    summary: summary,
    bySku: bySku,
    byWorkOrder: rows,
    daily: dailyRows,
    flags: flags
  };
}
