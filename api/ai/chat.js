import Sentry from "../_sentry.js";
import { classifyShiftET, pickFieldLoose, toEasternParts, toIso } from "../_labor.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function toNum(value) {
  var n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isTodayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("today") ||
    q.includes("cases produced today") ||
    q.includes("today production") ||
    q.includes("produced today")
  );
}

function isYesterdayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("yesterday") ||
    q.includes("cases produced yesterday") ||
    q.includes("yesterday production") ||
    q.includes("produced yesterday")
  );
}

function isCasesProducedQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("how many cases") || q.includes("cases produced") || q.includes("production cases");
}

function isAverageDailyQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (q.includes("average") || q.includes("avg")) && (q.includes("daily") || q.includes("per day")) && (q.includes("production") || q.includes("yield") || q.includes("cases"));
}

function isTopLineQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("top line") || q.includes("best line") || q.includes("which line produced") || q.includes("line produced most");
}

function isTopSkuQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("top sku") || q.includes("top skus") || q.includes("top item") || q.includes("sku mix") || q.includes("item mix");
}

function isShiftSplitQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("shift split") || q.includes("shift breakdown") || q.includes("which shift") || q.includes("shift 1 vs shift 2");
}

function isPeriodComparisonQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("compare this week vs last week") ||
    q.includes("this week vs last week") ||
    q.includes("week over week") ||
    q.includes("compare this month vs last month") ||
    q.includes("this month vs last month") ||
    q.includes("month over month")
  );
}

function isRevenueQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("revenue") ||
    q.includes("sales value") ||
    q.includes("dollar value") ||
    q.includes("dollars produced") ||
    q.includes("value produced")
  ) && !q.includes("missing revenue") && !q.includes("pricing coverage");
}

function isMissingRevenueQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("missing revenue") ||
    q.includes("missing pricing") ||
    q.includes("unpriced sku") ||
    q.includes("pricing coverage") ||
    q.includes("which skus are missing revenue")
  );
}

function isLaborQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("labor cost") ||
    q.includes("labour cost") ||
    q.includes("labor hours") ||
    q.includes("labour hours") ||
    q.includes("cases per labor hour") ||
    q.includes("cases per labour hour") ||
    q.includes("labor productivity") ||
    q.includes("labor efficiency")
  );
}

function isBatchOpportunityQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("batch") ||
    q.includes("same item") ||
    q.includes("changeover") ||
    q.includes("batching opportunity")
  );
}

function needsProductionDetailPrompt(prompt) {
  return isTopSkuQuestion(prompt) || isRevenueQuestion(prompt) || isMissingRevenueQuestion(prompt);
}

function detectPeriodLabel(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return "";
  if (q.includes("today")) return "today";
  if (q.includes("yesterday")) return "yesterday";
  if (q.includes("this week") || q.includes("current week")) return "this_week";
  if (q.includes("last week") || q.includes("previous week") || q.includes("prior week")) return "last_week";
  if (q.includes("this month") || q.includes("current month")) return "this_month";
  if (q.includes("last month") || q.includes("previous month") || q.includes("prior month")) return "last_month";
  return "";
}

function ymdInEtFromDate(date) {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .forEach(function(part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
  return parts.year && parts.month && parts.day ? (parts.year + "-" + parts.month + "-" + parts.day) : "";
}

function shiftIsoDate(dateIso, days) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  var dow = d.getDay();
  var delta = dow === 0 ? -6 : 1 - dow; // Monday start
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function startOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function endOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function resolvePeriodRange(periodLabel, anchorDateIso) {
  var anchor = anchorDateIso || ymdInEtFromDate(new Date());
  var start = "";
  var end = "";
  var label = "";
  if (periodLabel === "today") {
    start = anchor;
    end = anchor;
    label = "today";
  } else if (periodLabel === "yesterday") {
    start = shiftIsoDate(anchor, -1);
    end = start;
    label = "yesterday";
  } else if (periodLabel === "this_week") {
    start = startOfWeekIso(anchor);
    end = anchor;
    label = "this week";
  } else if (periodLabel === "last_week") {
    var thisWeekStart = startOfWeekIso(anchor);
    start = shiftIsoDate(thisWeekStart, -7);
    end = shiftIsoDate(thisWeekStart, -1);
    label = "last week";
  } else if (periodLabel === "this_month") {
    start = startOfMonthIso(anchor);
    end = anchor;
    label = "this month";
  } else if (periodLabel === "last_month") {
    var thisMonthStart = startOfMonthIso(anchor);
    var lastMonthAnchor = shiftIsoDate(thisMonthStart, -1);
    start = startOfMonthIso(lastMonthAnchor);
    end = endOfMonthIso(lastMonthAnchor);
    label = "last month";
  } else {
    start = shiftIsoDate(anchor, -6);
    end = anchor;
    label = "last 7 days";
  }
  return { start: start, end: end, label: label };
}

function isLastWeekSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var hasLastWeek = q.includes("last week") || q.includes("previous week") || q.includes("prior week");
  var hasProd = q.includes("production") || q.includes("reports") || q.includes("yield") || q.includes("cases");
  return hasLastWeek && hasProd;
}

function wantsDetailedBreakdown(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("include") ||
    q.includes("breakdown") ||
    q.includes("reasoning") ||
    q.includes("why") ||
    q.includes("sku") ||
    q.includes("yield") ||
    q.includes("utilization") ||
    q.includes("machine")
  );
}

function isChartSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("summarize these charts") ||
    q.includes("summarise these charts") ||
    q.includes("summarize the charts") ||
    q.includes("chart summary")
  );
}

function isMarchYieldQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var mentionsYield = q.includes("daily production yield") || q.includes("daily yield") || q.includes("cases per day") || q.includes("daily production");
  var mentionsMarch = q.includes("march");
  var mentionsTarget = q.includes("hit") || q.includes("necessary") || q.includes("need") || q.includes("target");
  return mentionsYield && mentionsMarch && mentionsTarget;
}

function extractComponentLookupSku(prompt) {
  var q = toText(prompt);
  if (!q) return "";
  var m = q.match(/components?\s+(?:are\s+used\s+in|for|in)\s+([a-zA-Z0-9\-]+)/i);
  if (m && m[1]) return String(m[1]).trim();
  var m2 = q.match(/what\s+is\s+in\s+([a-zA-Z0-9\-]+)/i);
  if (m2 && m2[1]) return String(m2[1]).trim();
  return "";
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/\.0+$/, "").toLowerCase();
}

function parseDateIso(value) {
  if (!value) return "";
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function statusLooksClosed(status) {
  var s = toText(status).toLowerCase();
  return !!s && (
    s.includes("close") ||
    s.includes("complete") ||
    s.includes("cancel") ||
    s.includes("archive") ||
    s.includes("done")
  );
}

function pickItemMasterValue(row) {
  return toNum(firstField(row, [
    "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ]));
}

function sourceNote(label, detail) {
  var cleanLabel = toText(label);
  var cleanDetail = toText(detail);
  if (!cleanLabel && !cleanDetail) return "";
  if (cleanLabel && cleanDetail) return " Source: " + cleanLabel + " through " + cleanDetail + ".";
  return " Source: " + (cleanLabel || cleanDetail) + ".";
}

function firstField(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== "") return row[k];
  }
  var wanted = keys.map(function(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); });
  var rowKeys = Object.keys(row);
  for (var j = 0; j < rowKeys.length; j++) {
    var rk = rowKeys[j];
    var norm = String(rk).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (wanted.indexOf(norm) !== -1) {
      var v = row[rk];
      if (v != null && v !== "") return v;
    }
  }
  return "";
}

function componentsForSkuFromPayload(payload, skuRaw) {
  var boms = payload && Array.isArray(payload.boms) ? payload.boms : [];
  if (!boms.length) return { hasBomData: false, items: [] };
  var sku = normalizeSku(skuRaw);
  var out = [];
  var seen = {};
  boms.forEach(function(row) {
    var fg = normalizeSku(firstField(row, ["Finished Good Code", "finished_good_code", "bomId", "Finished Good", "fg_code"]));
    if (!fg || fg !== sku) return;
    var comp = String(firstField(row, ["Subcomponent Code", "subcomponent_code", "componentSku", "Component", "component_code"]) || "").trim();
    if (!comp) return;
    var key = normalizeSku(comp);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({
      component: comp,
      description: String(firstField(row, ["Subcomponent Description", "subcomponent_description", "description", "Description"]) || "").trim(),
      qtyPer: firstField(row, ["Qty Per", "subcomponent_unit_quantity", "qtyPer", "quantity_per"]),
    });
  });
  return { hasBomData: true, items: out };
}

function buildBatchOpportunitiesFromSnapshot(payload) {
  var workOrders = payload && Array.isArray(payload.workOrders) ? payload.workOrders : [];
  var groups = {};
  workOrders.forEach(function(row) {
    var skuRaw = toText(firstField(row, [
      "Item Code", "item_code", "Product SKU", "productSku", "productSkuRaw", "SKU", "sku"
    ]));
    var skuKey = normalizeSku(skuRaw);
    if (!skuKey) return;
    var status = toText(firstField(row, [
      "Work Order Status", "status", "project_status"
    ]));
    if (statusLooksClosed(status)) return;
    var remaining = toNum(firstField(row, [
      "Units Remaining", "units_remaining", "Remaining Units", "remaining_units"
    ]));
    if (!(remaining > 0)) {
      var expected = toNum(firstField(row, [
        "Units Expected", "units_expected", "Order Qty", "qtyToProduce", "Quantity", "quantity"
      ]));
      var produced = toNum(firstField(row, [
        "Units Produced", "units_produced", "Produced", "unitsProduced"
      ]));
      remaining = Math.max(0, expected - produced);
    }
    if (!(remaining > 0)) return;
    var woNum = toText(firstField(row, [
      "Work Order Code", "project_code", "Project Code", "Work Order", "wo_num"
    ]));
    var dueDate = parseDateIso(firstField(row, ["Due Date", "due_date_at", "dueDate"]));
    if (!groups[skuKey]) {
      groups[skuKey] = {
        sku: skuRaw || "--",
        batchCount: 0,
        totalRemainingUnits: 0,
        woNums: [],
        dueStart: "",
        dueEnd: ""
      };
    }
    groups[skuKey].batchCount += 1;
    groups[skuKey].totalRemainingUnits += remaining;
    if (woNum) groups[skuKey].woNums.push(woNum);
    if (dueDate && (!groups[skuKey].dueStart || dueDate < groups[skuKey].dueStart)) groups[skuKey].dueStart = dueDate;
    if (dueDate && (!groups[skuKey].dueEnd || dueDate > groups[skuKey].dueEnd)) groups[skuKey].dueEnd = dueDate;
  });
  return Object.keys(groups)
    .map(function(key) { return groups[key]; })
    .filter(function(group) { return group.batchCount > 1; })
    .sort(function(a, b) {
      if (b.batchCount !== a.batchCount) return b.batchCount - a.batchCount;
      return b.totalRemainingUnits - a.totalRemainingUnits;
    });
}

function errorMessage(error) {
  return String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
}

function isMissingSupabaseRelationError(name, error) {
  var msg = errorMessage(error);
  return msg.indexOf(String(name || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1 ||
    msg.indexOf("does not exist") !== -1
  );
}

async function fetchAllRowsByDateWindow(supabase, options) {
  var table = toText(options && options.table);
  var columns = toText(options && options.columns) || "*";
  var dateColumn = toText(options && options.dateColumn);
  var siteId = toText(options && options.siteId) || CACHE_SITE_ID;
  var startDate = toText(options && options.startDate);
  var endDate = toText(options && options.endDate);
  var pageSize = Math.max(1, Number(options && options.pageSize) || 1000);
  var maxRows = Math.max(pageSize, Number(options && options.maxRows) || 50000);
  var out = [];
  var from = 0;

  while (true) {
    var to = from + pageSize - 1;
    var q = supabase
      .from(table)
      .select(columns)
      .eq("site_id", siteId)
      .order(dateColumn, { ascending: false })
      .range(from, to);
    if (startDate) q = q.gte(dateColumn, startDate);
    if (endDate) q = q.lte(dateColumn, endDate);
    var resp = await q;
    if (resp.error) return { error: resp.error, data: out };
    var rows = Array.isArray(resp.data) ? resp.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize || out.length >= maxRows) break;
    from += pageSize;
    if (from > maxRows) break;
  }

  return { error: null, data: out.slice(0, maxRows) };
}

function snapshotDatasetState(snapshotPayload, snapshotRowCounts, key) {
  var rows = snapshotPayload && Array.isArray(snapshotPayload[key]) ? snapshotPayload[key] : [];
  var payloadMeta = snapshotPayload && snapshotPayload.meta && typeof snapshotPayload.meta === "object"
    ? snapshotPayload.meta
    : {};
  var dropped = Array.isArray(payloadMeta.cacheDroppedDatasets) && payloadMeta.cacheDroppedDatasets.indexOf(key) !== -1;
  var totalRows = Math.max(0, Number(snapshotRowCounts && snapshotRowCounts[key]) || 0);
  var truncated = !dropped && totalRows > 0 && rows.length > 0 && rows.length < totalRows;
  return {
    rows: rows,
    totalRows: totalRows,
    dropped: dropped,
    truncated: truncated,
    complete: !dropped && (!totalRows || rows.length >= totalRows)
  };
}

function buildProductionDetailRowsFromSnapshot(snapshotPayload, startDate, endDate, fallbackValue) {
  var rows = snapshotPayload && Array.isArray(snapshotPayload.productionData) ? snapshotPayload.productionData : [];
  var out = [];

  rows.forEach(function(row) {
    var units = toNum(firstField(row, [
      "Units Produced", "units_produced", "unitsProduced", "Produced Units", "Quantity Produced", "Qty Produced"
    ]));
    if (!(units > 0)) return;

    var producedRaw = pickFieldLoose(row, [
      "Produced date", "producedAt",
      "Produced At", "produced_at",
      "Actual Job End", "actual_job_end_at"
    ]);
    var producedIso = toIso(producedRaw);
    var eastern = toEasternParts(producedIso || producedRaw || fallbackValue);
    var dateKey = eastern && eastern.dateKey ? eastern.dateKey : parseDateIso(producedRaw || fallbackValue);
    if (!dateKey || (startDate && dateKey < startDate) || (endDate && dateKey > endDate)) return;

    out.push({
      produced_date_et: dateKey,
      shift_label: eastern ? classifyShiftET(eastern) : (toText(firstField(row, ["Shift", "shift_label", "shift"])) || "Unassigned"),
      line: toText(firstField(row, ["Line", "line", "line_name", "Line Name"])) || "Unknown",
      job_id: toText(firstField(row, ["Job ID", "job_id", "Job"])) || null,
      work_order_code: toText(firstField(row, ["Work Order Code", "project_code", "Project Code"])) || null,
      item_code: toText(firstField(row, ["Item Code", "item_code", "SKU", "sku", "Product SKU"])) || null,
      units_produced: units,
    });
  });

  return out;
}

function buildProductionSummary(metricRows, detailRows, resolveRevenuePerCase, detailSource) {
  var rows = Array.isArray(metricRows) ? metricRows : [];
  var detail = Array.isArray(detailRows) ? detailRows : [];
  var byDay = {};
  var lineTotals = {};
  var totalRows = 0;

  rows.forEach(function(row) {
    var date = toText(row && row.date_et);
    var units = toNum(row && row.produced_units);
    var rowCount = toNum(row && row.production_rows);
    if (!date || (!(units > 0) && !(rowCount > 0))) return;
    totalRows += rowCount;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += rowCount;
    var line = toText(row && row.line_name) || "Unknown";
    if (!lineTotals[line]) lineTotals[line] = { line: line, units: 0, rows: 0 };
    lineTotals[line].units += units;
    lineTotals[line].rows += rowCount;
  });

  var dayPairs = Object.keys(byDay).sort().map(function(date) {
    return byDay[date];
  });
  var latestProdDate = dayPairs.length ? dayPairs[dayPairs.length - 1].date : "";
  var latestProdUnits = latestProdDate ? toNum(byDay[latestProdDate] && byDay[latestProdDate].units) : 0;
  var last7 = dayPairs.slice(-7);
  var lineTop = Object.keys(lineTotals)
    .map(function(line) { return lineTotals[line]; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 5);
  var skuTotals = {};
  detail.forEach(function(row) {
    var sku = toText(row && row.item_code) || "Unknown";
    var units = toNum(row && row.units_produced);
    if (!(units > 0)) return;
    skuTotals[sku] = (skuTotals[sku] || 0) + units;
  });
  var skuTop = Object.keys(skuTotals)
    .map(function(sku) { return { sku: sku, units: skuTotals[sku] }; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 8);

  function rangeTotals(start, end) {
    if (!start || !end) {
      return {
        totalCases: 0,
        totalRevenue: 0,
        revenueCoveredUnits: 0,
        byLineTop: [],
        bySkuTop: [],
        byShift: [],
        missingRevenueSkus: [],
        productionDays: 0,
        rows: 0,
        hasSkuDetail: false
      };
    }

    var rangeRows = rows.filter(function(row) {
      var date = toText(row && row.date_et);
      return date && date >= start && date <= end;
    });
    var totalCases = 0;
    var lineMap = {};
    var shiftMap = {};
    var dayMap = {};
    var totalRowCount = 0;

    rangeRows.forEach(function(row) {
      var units = toNum(row && row.produced_units);
      var rowCount = toNum(row && row.production_rows);
      var date = toText(row && row.date_et);
      var line = toText(row && row.line_name) || "Unknown";
      var shift = toText(row && row.shift_label) || "Unassigned";
      totalCases += units;
      totalRowCount += rowCount;
      if (!lineMap[line]) lineMap[line] = { line: line, units: 0, rows: 0 };
      lineMap[line].units += units;
      lineMap[line].rows += rowCount;
      shiftMap[shift] = (shiftMap[shift] || 0) + units;
      if (date) dayMap[date] = true;
    });

    var detailRangeRows = detail.filter(function(row) {
      var date = toText(row && row.produced_date_et);
      return date && date >= start && date <= end;
    });
    var totalRevenue = 0;
    var revenueCoveredUnits = 0;
    var skuMap = {};
    var missingRevenueSkus = {};

    detailRangeRows.forEach(function(row) {
      var units = toNum(row && row.units_produced);
      if (!(units > 0)) return;
      var date = toText(row && row.produced_date_et);
      var sku = toText(row && row.item_code) || "Unknown";
      var revenue = resolveRevenuePerCase(sku, date);
      var revenueValue = toNum(revenue && revenue.value) * units;
      if (!skuMap[sku]) skuMap[sku] = { sku: sku, units: 0, revenue: 0 };
      skuMap[sku].units += units;
      skuMap[sku].revenue += revenueValue;
      if (revenueValue > 0) {
        totalRevenue += revenueValue;
        revenueCoveredUnits += units;
      } else {
        missingRevenueSkus[sku] = (missingRevenueSkus[sku] || 0) + units;
      }
    });

    return {
      totalCases: totalCases,
      totalRevenue: totalRevenue,
      revenueCoveredUnits: revenueCoveredUnits,
      byLineTop: Object.keys(lineMap).map(function(key) { return lineMap[key]; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 5),
      bySkuTop: Object.keys(skuMap).map(function(key) { return skuMap[key]; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 8),
      byShift: Object.keys(shiftMap).map(function(key) { return { shift: key, units: shiftMap[key] }; }).sort(function(a, b) { return b.units - a.units; }),
      missingRevenueSkus: Object.keys(missingRevenueSkus).map(function(key) {
        return { sku: key, units: missingRevenueSkus[key] };
      }).sort(function(a, b) { return b.units - a.units; }).slice(0, 10),
      productionDays: Object.keys(dayMap).length,
      rows: totalRowCount,
      hasSkuDetail: detailRangeRows.length > 0
    };
  }

  return {
    totalRows: totalRows,
    latestDate: latestProdDate,
    latestDateUnits: latestProdUnits,
    byDayLast7: last7,
    topLines: lineTop,
    topSkus: skuTop,
    summarySource: "ops_daily_line_metrics_mv",
    detailSource: detailSource || "",
    range: rangeTotals,
  };
}

function buildLaborSummary(metricRows) {
  var rows = Array.isArray(metricRows) ? metricRows : [];
  var laborByDate = {};
  var totalRows = 0;
  var latestLaborDate = "";

  rows.forEach(function(row) {
    var date = toText(row && row.date_et);
    var laborRows = toNum(row && row.labor_rows);
    if (!date || !(laborRows > 0)) return;
    totalRows += laborRows;
    laborByDate[date] = (laborByDate[date] || 0) + laborRows;
    if (!latestLaborDate || date > latestLaborDate) latestLaborDate = date;
  });

  function laborRange(start, end) {
    if (!start || !end) return { payableHours: 0, productiveHours: 0, laborCost: 0, rows: 0, byLineTop: [] };
    var payableHours = 0;
    var productiveHours = 0;
    var laborCost = 0;
    var rowCount = 0;
    var byLine = {};

    rows.forEach(function(row) {
      var date = toText(row && row.date_et);
      if (!date || date < start || date > end) return;
      var payable = toNum(row && row.payable_hours);
      var productive = toNum(row && row.productive_hours);
      var cost = toNum(row && row.labor_cost);
      var laborRows = toNum(row && row.labor_rows);
      var line = toText(row && row.line_name) || "Unknown";
      payableHours += payable;
      productiveHours += productive;
      laborCost += cost;
      rowCount += laborRows;
      if (!byLine[line]) byLine[line] = { line: line, payableHours: 0, productiveHours: 0, laborCost: 0 };
      byLine[line].payableHours += payable;
      byLine[line].productiveHours += productive;
      byLine[line].laborCost += cost;
    });

    return {
      payableHours: payableHours,
      productiveHours: productiveHours,
      laborCost: laborCost,
      rows: rowCount,
      byLineTop: Object.keys(byLine).map(function(key) { return byLine[key]; }).sort(function(a, b) { return b.laborCost - a.laborCost; }).slice(0, 5)
    };
  }

  return {
    totalRows: totalRows,
    latestDate: latestLaborDate,
    entriesOnLatestDate: latestLaborDate ? (laborByDate[latestLaborDate] || 0) : 0,
    summarySource: "ops_daily_line_metrics_mv",
    range: laborRange,
  };
}

async function loadSupabaseAiContext(options) {
  var summaryStart = toText(options && options.summaryStart);
  var summaryEnd = toText(options && options.summaryEnd);
  var includeProductionDetail = !!(options && options.includeProductionDetail);
  var detailStart = toText(options && options.detailStart);
  var detailEnd = toText(options && options.detailEnd);
  var supabase = getSupabaseAdmin();

  var detailPromise = (includeProductionDetail && detailStart && detailEnd)
    ? fetchAllRowsByDateWindow(supabase, {
      table: "production_events",
      columns: "produced_date_et,shift_label,line,job_id,work_order_code,item_code,units_produced",
      dateColumn: "produced_date_et",
      startDate: detailStart,
      endDate: detailEnd,
      maxRows: 25000
    })
    : Promise.resolve({ error: null, data: [] });

  var responses = await Promise.all([
    supabase
      .from("cache_snapshots")
      .select("synced_at,updated_by,row_counts,payload")
      .eq("site_id", CACHE_SITE_ID)
      .maybeSingle(),
    fetchAllRowsByDateWindow(supabase, {
      table: "ops_daily_line_metrics_mv",
      columns: "date_et,shift_label,line_name,production_rows,produced_units,labor_rows,payable_hours,productive_hours,labor_cost",
      dateColumn: "date_et",
      startDate: summaryStart,
      endDate: summaryEnd,
      maxRows: 50000
    }),
    supabase
      .from("ops_sku_targets")
      .select("item_code,revenue_per_case,active_from,active_to,updated_at")
      .eq("site_id", CACHE_SITE_ID)
      .order("updated_at", { ascending: false })
      .limit(5000),
    detailPromise
  ]);

  var snapshotQ = responses[0];
  var metricQ = responses[1];
  var pricingQ = responses[2];
  var detailQ = responses[3];

  if (snapshotQ.error && !isMissingSupabaseRelationError("cache_snapshots", snapshotQ.error)) throw snapshotQ.error;
  if (metricQ.error && !isMissingSupabaseRelationError("ops_daily_line_metrics_mv", metricQ.error)) throw metricQ.error;
  if (pricingQ.error && !isMissingSupabaseRelationError("ops_sku_targets", pricingQ.error)) throw pricingQ.error;
  if (detailQ.error && !isMissingSupabaseRelationError("production_events", detailQ.error)) throw detailQ.error;

  var snapshot = !snapshotQ.error && snapshotQ.data ? snapshotQ.data : null;
  var snapshotPayload = snapshot && snapshot.payload ? snapshot.payload : null;
  var snapshotRowCounts = snapshot && snapshot.row_counts ? snapshot.row_counts : {};
  var metricRows = !metricQ.error && Array.isArray(metricQ.data) ? metricQ.data : [];
  var pricingRows = !pricingQ.error && Array.isArray(pricingQ.data) ? pricingQ.data : [];

  var itemMasterRows = snapshotPayload && Array.isArray(snapshotPayload.itemMaster) ? snapshotPayload.itemMaster : [];
  var itemMasterBySku = {};
  itemMasterRows.forEach(function(row) {
    var sku = normalizeSku(firstField(row, ["Item Code", "item_code", "SKU", "sku", "Product SKU"]));
    if (!sku) return;
    var value = pickItemMasterValue(row);
    if (!(value > 0)) return;
    if (!itemMasterBySku[sku] || value > itemMasterBySku[sku]) itemMasterBySku[sku] = value;
  });

  var pricingBySku = {};
  pricingRows.forEach(function(row) {
    var sku = normalizeSku(row && row.item_code);
    if (!sku || !(toNum(row && row.revenue_per_case) > 0)) return;
    if (!pricingBySku[sku]) pricingBySku[sku] = [];
    pricingBySku[sku].push({
      revenue_per_case: toNum(row && row.revenue_per_case),
      active_from: parseDateIso(row && row.active_from) || "1900-01-01",
      active_to: parseDateIso(row && row.active_to) || "9999-12-31"
    });
  });

  function resolveRevenuePerCase(itemCode, dateIso) {
    var sku = normalizeSku(itemCode);
    if (!sku) return { value: 0, source: "missing" };
    var dateKey = toText(dateIso) || "1900-01-01";
    var rows = pricingBySku[sku] || [];
    var best = 0;
    rows.forEach(function(row) {
      var from = toText(row.active_from) || "1900-01-01";
      var to = toText(row.active_to) || "9999-12-31";
      if (dateKey < from || dateKey > to) return;
      if (toNum(row.revenue_per_case) > best) best = toNum(row.revenue_per_case);
    });
    if (best > 0) return { value: best, source: "ops_sku_targets" };
    if (toNum(itemMasterBySku[sku]) > 0) return { value: toNum(itemMasterBySku[sku]), source: "item_master_cost_per_unit" };
    return { value: 0, source: "missing" };
  }

  var productionDetailRows = [];
  var productionDetailSource = "";
  if (includeProductionDetail && detailStart && detailEnd) {
    var productionDataState = snapshotDatasetState(snapshotPayload, snapshotRowCounts, "productionData");
    if (productionDataState.complete && productionDataState.rows.length) {
      productionDetailRows = buildProductionDetailRowsFromSnapshot(snapshotPayload, detailStart, detailEnd, snapshot && snapshot.synced_at);
      productionDetailSource = "cache snapshot productionData";
    } else if (!detailQ.error && Array.isArray(detailQ.data) && detailQ.data.length) {
      productionDetailRows = detailQ.data;
      productionDetailSource = "production_events";
    }
  }

  var production = buildProductionSummary(metricRows, productionDetailRows, resolveRevenuePerCase, productionDetailSource);
  var labor = buildLaborSummary(metricRows);

  return {
    siteId: CACHE_SITE_ID,
    snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
    snapshotUpdatedBy: snapshot && snapshot.updated_by ? snapshot.updated_by : "",
    snapshotRowCounts: snapshotRowCounts,
    snapshotMetrics: snapshotPayload && snapshotPayload.meta && typeof snapshotPayload.meta === "object" ? snapshotPayload.meta : {},
    snapshotPayload: snapshotPayload,
    production: production,
    labor: labor,
    revenue: {
      pricingRows: pricingRows.length,
      itemMasterFallbackSkus: Object.keys(itemMasterBySku).length,
    },
    workOrders: {
      batchOpportunities: buildBatchOpportunitiesFromSnapshot(snapshotPayload),
    },
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = req.body || {};
    var prompt = toText(body.prompt);
    var activeView = toText(body.activeView || "overview");
    var contextLines = Array.isArray(body.contextLines) ? body.contextLines.map(toText).filter(Boolean).slice(0, 8) : [];
    var metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {};
    var history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });
    var anchorDateEt = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
    var defaultOpsPeriod = resolvePeriodRange(detectPeriodLabel(prompt) || "today", anchorDateEt);
    var supabaseContext = null;
    try {
      supabaseContext = await loadSupabaseAiContext({
        summaryStart: shiftIsoDate(anchorDateEt, -120),
        summaryEnd: anchorDateEt,
        includeProductionDetail: needsProductionDetailPrompt(prompt),
        detailStart: defaultOpsPeriod.start,
        detailEnd: defaultOpsPeriod.end,
      });
    } catch (_) {
      supabaseContext = null;
    }
    var lookupSku = extractComponentLookupSku(prompt);
    if (lookupSku) {
      var result = componentsForSkuFromPayload(supabaseContext && supabaseContext.snapshotPayload, lookupSku);
      if (!result.hasBomData) {
        return res.status(200).json({
          answer: "BOM data is not available in shared snapshot yet. Run Nulogy sync with BOM included, then ask again.",
          model: "deterministic",
        });
      }
      if (!result.items.length) {
        return res.status(200).json({
          answer: "No BOM components found for " + lookupSku + " in current snapshot.",
          model: "deterministic",
        });
      }
      var lines = result.items.slice(0, 25).map(function(item, idx) {
        var desc = item.description ? " - " + item.description : "";
        var qty = item.qtyPer != null && item.qtyPer !== "" ? " (qty/unit: " + item.qtyPer + ")" : "";
        return (idx + 1) + ". " + item.component + desc + qty;
      });
      return res.status(200).json({
        answer: "Components for " + lookupSku + ":\n" + lines.join("\n"),
        model: "deterministic",
      });
    }

    var defaultProdAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(defaultOpsPeriod.start, defaultOpsPeriod.end)
      : null;
    var defaultLaborAgg = (supabaseContext && supabaseContext.labor && typeof supabaseContext.labor.range === "function")
      ? supabaseContext.labor.range(defaultOpsPeriod.start, defaultOpsPeriod.end)
      : null;

    // Deterministic answer for high-frequency operational ask.
    if (isTodayCasesQuestion(prompt)) {
      var todayCases = toNum(metrics.productionTodayCases);
      var s1 = toNum(metrics.productionTodayShift1Cases);
      var s2 = toNum(metrics.productionTodayShift2Cases);
      var todayEt = toText(metrics.todayEt);
      return res.status(200).json({
        answer:
          "Cases produced today (" + (todayEt || "ET") + "): " + todayCases.toLocaleString() +
          ". Shift 1: " + s1.toLocaleString() +
          ", Shift 2: " + s2.toLocaleString() + "." +
          (supabaseContext && supabaseContext.production && supabaseContext.production.latestDate
            ? " Latest production date: " + supabaseContext.production.latestDate + " (" + toNum(supabaseContext.production.latestDateUnits).toLocaleString() + " cases)." +
              sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", supabaseContext.production.latestDate)
            : ""),
        model: "deterministic",
      });
    }
    if (isYesterdayCasesQuestion(prompt)) {
      var todayEt = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var yesterdayEt = toText(metrics.yesterdayEt) || shiftIsoDate(todayEt, -1);
      var yCases = toNum(metrics.productionYesterdayCases);
      var yS1 = toNum(metrics.productionYesterdayShift1Cases);
      var yS2 = toNum(metrics.productionYesterdayShift2Cases);

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7)) {
        var dayRow = supabaseContext.production.byDayLast7.find(function(d) { return toText(d && d.date) === yesterdayEt; });
        if (dayRow) yCases = toNum(dayRow.units);
      }

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7) && supabaseContext.production.byDayLast7.length) {
        var fallback = supabaseContext.production.byDayLast7[supabaseContext.production.byDayLast7.length - 1];
        var fallbackDate = toText(fallback && fallback.date) || "--";
        var fallbackUnits = toNum(fallback && fallback.units);
        return res.status(200).json({
          answer:
            "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + "). " +
            "Latest available production day is " + fallbackDate + " with " + fallbackUnits.toLocaleString() + " cases.",
          model: "deterministic",
        });
      }

      if (!(yCases > 0)) {
        return res.status(200).json({
          answer: "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + ").",
          model: "deterministic",
        });
      }

      return res.status(200).json({
        answer:
          "Cases produced yesterday (" + (yesterdayEt || "ET") + "): " + yCases.toLocaleString() +
          ". Shift 1: " + yS1.toLocaleString() +
          ", Shift 2: " + yS2.toLocaleString() + "." +
          sourceNote((supabaseContext && supabaseContext.production && supabaseContext.production.summarySource) || "ops_daily_line_metrics_mv", yesterdayEt),
        model: "deterministic",
      });
    }
    if (
      (isAverageDailyQuestion(prompt) || isTopLineQuestion(prompt) || isTopSkuQuestion(prompt) || isShiftSplitQuestion(prompt)) &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchorDate = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var periodForOps = resolvePeriodRange(detectPeriodLabel(prompt), anchorDate);
      var opsAgg = supabaseContext.production.range(periodForOps.start, periodForOps.end);
      if (!(toNum(opsAgg && opsAgg.totalCases) > 0)) {
        return res.status(200).json({
          answer: "No production rows found for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + ").",
          model: "deterministic",
        });
      }

      if (isAverageDailyQuestion(prompt)) {
        var days = Math.max(1, toNum(opsAgg.productionDays));
        var avgDaily = Math.round(toNum(opsAgg.totalCases) / days);
        return res.status(200).json({
          answer:
            "Average daily production for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            avgDaily.toLocaleString() + " cases/day across " + days + " production day" + (days === 1 ? "" : "s") + "." +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isTopLineQuestion(prompt)) {
        var topLine = opsAgg.byLineTop && opsAgg.byLineTop.length ? opsAgg.byLineTop[0] : null;
        if (!topLine) {
          return res.status(200).json({ answer: "No line totals found for " + periodForOps.label + ".", model: "deterministic" });
        }
        return res.status(200).json({
          answer:
            "Top line for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            String(topLine.line || "--") + " with " + toNum(topLine.units).toLocaleString() + " cases." +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isTopSkuQuestion(prompt)) {
        if (!opsAgg.hasSkuDetail) {
          return res.status(200).json({
            answer:
              "Detailed SKU-level production data is unavailable for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + ").",
            model: "deterministic",
          });
        }
        var skuList = (opsAgg.bySkuTop || []).slice(0, 5).map(function(x, idx) {
          return (idx + 1) + ". " + String(x.sku || "--") + " - " + toNum(x.units).toLocaleString() + " cases";
        });
        return res.status(200).json({
          answer:
            "Top SKU mix for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "):\n" +
            (skuList.length ? skuList.join("\n") : "No SKU totals found.") +
            sourceNote(supabaseContext.production.detailSource || "production_events", periodForOps.end),
          model: "deterministic",
        });
      }
      if (isShiftSplitQuestion(prompt)) {
        var shiftList = (opsAgg.byShift || []).map(function(x) {
          return String(x.shift || "Unassigned") + ": " + toNum(x.units).toLocaleString();
        });
        var topShift = opsAgg.byShift && opsAgg.byShift.length ? opsAgg.byShift[0] : null;
        return res.status(200).json({
          answer:
            "Shift split for " + periodForOps.label + " (" + periodForOps.start + " to " + periodForOps.end + "): " +
            (shiftList.length ? shiftList.join(" | ") : "No shift totals found.") +
            (topShift ? ". Highest output: " + String(topShift.shift || "--") + "." : "") +
            sourceNote(supabaseContext.production.summarySource || "ops_daily_line_metrics_mv", periodForOps.end),
          model: "deterministic",
        });
      }
    }
    if (isRevenueQuestion(prompt) && defaultProdAgg) {
      if (!defaultProdAgg.hasSkuDetail) {
        return res.status(200).json({
          answer:
            "Detailed SKU-level production data is unavailable for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "), so revenue cannot be calculated yet.",
          model: "deterministic",
        });
      }
      var revenueTotal = toNum(defaultProdAgg.totalRevenue);
      var revenueCases = toNum(defaultProdAgg.totalCases);
      var coveredUnits = toNum(defaultProdAgg.revenueCoveredUnits);
      var coveragePct = revenueCases > 0 ? Math.round((coveredUnits / revenueCases) * 100) : 0;
      var missingCount = Array.isArray(defaultProdAgg.missingRevenueSkus) ? defaultProdAgg.missingRevenueSkus.length : 0;
      var topMissing = missingCount
        ? defaultProdAgg.missingRevenueSkus.slice(0, 3).map(function(x) { return String(x.sku || "--") + " (" + toNum(x.units).toLocaleString() + ")"; }).join(", ")
        : "";
      return res.status(200).json({
        answer:
          "Revenue for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "): $" +
          Math.round(revenueTotal).toLocaleString() + " across " + revenueCases.toLocaleString() + " cases. " +
          "Coverage: " + coveragePct + "% of produced units." +
          (missingCount ? " Missing revenue on " + missingCount + " SKU" + (missingCount === 1 ? "" : "s") + (topMissing ? ": " + topMissing + "." : ".") : "") +
          sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isMissingRevenueQuestion(prompt) && defaultProdAgg) {
      if (!defaultProdAgg.hasSkuDetail) {
        return res.status(200).json({
          answer:
            "Detailed SKU-level production data is unavailable for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "), so pricing coverage cannot be verified yet.",
          model: "deterministic",
        });
      }
      var missingSkuRows = Array.isArray(defaultProdAgg.missingRevenueSkus) ? defaultProdAgg.missingRevenueSkus : [];
      if (!missingSkuRows.length) {
        return res.status(200).json({
          answer:
            "All produced SKUs for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + ") have revenue coverage." +
            sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
          model: "deterministic",
        });
      }
      var missingSkuText = missingSkuRows.slice(0, 8).map(function(x, idx) {
        return (idx + 1) + ". " + String(x.sku || "--") + " - " + toNum(x.units).toLocaleString() + " cases";
      }).join("\n");
      return res.status(200).json({
        answer:
          "SKUs missing revenue coverage for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "):\n" +
          missingSkuText +
          sourceNote(((supabaseContext && supabaseContext.production && supabaseContext.production.detailSource) || "production_events") + " + ops_sku_targets + item master cost", defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isLaborQuestion(prompt) && defaultProdAgg && defaultLaborAgg) {
      var payableHours = toNum(defaultLaborAgg.payableHours);
      var productiveHours = toNum(defaultLaborAgg.productiveHours);
      var laborCost = toNum(defaultLaborAgg.laborCost);
      var prodCases = toNum(defaultProdAgg.totalCases);
      var casesPerPayable = payableHours > 0 ? Math.round((prodCases / payableHours) * 10) / 10 : 0;
      var casesPerProductive = productiveHours > 0 ? Math.round((prodCases / productiveHours) * 10) / 10 : 0;
      var laborCostPerCase = prodCases > 0 ? Math.round((laborCost / prodCases) * 100) / 100 : 0;
      return res.status(200).json({
        answer:
          "Labor actuals for " + defaultOpsPeriod.label + " (" + defaultOpsPeriod.start + " to " + defaultOpsPeriod.end + "): " +
          payableHours.toFixed(1) + " payable hrs, " + productiveHours.toFixed(1) + " productive hrs, $" + Math.round(laborCost).toLocaleString() + " labor cost. " +
          "Productivity: " + casesPerPayable.toLocaleString() + " cases/payable hr, " +
          casesPerProductive.toLocaleString() + " cases/productive hr. " +
          "Labor cost per case: $" + laborCostPerCase.toFixed(2) + "." +
          sourceNote(((supabaseContext && supabaseContext.labor && supabaseContext.labor.summarySource) || "ops_daily_line_metrics_mv") + " + " + (((supabaseContext && supabaseContext.production && supabaseContext.production.summarySource) || "ops_daily_line_metrics_mv")), defaultOpsPeriod.end),
        model: "deterministic",
      });
    }
    if (isBatchOpportunityQuestion(prompt) && supabaseContext && supabaseContext.workOrders) {
      var batchList = Array.isArray(supabaseContext.workOrders.batchOpportunities) ? supabaseContext.workOrders.batchOpportunities : [];
      if (!batchList.length) {
        return res.status(200).json({
          answer:
            "No same-item batching opportunities were found in the current open work orders snapshot." +
            sourceNote("cache snapshot workOrders", supabaseContext.snapshotSyncedAt),
          model: "deterministic",
        });
      }
      var batchLines = batchList.slice(0, 6).map(function(group, idx) {
        var dueWindow = group.dueStart && group.dueEnd ? (" due " + group.dueStart + " to " + group.dueEnd) : "";
        return (idx + 1) + ". " + group.sku + " - " + group.batchCount + " WOs, " +
          Math.round(toNum(group.totalRemainingUnits)).toLocaleString() + " remaining cases" + dueWindow;
      });
      return res.status(200).json({
        answer:
          "Top batching opportunities from current open work orders:\n" +
          batchLines.join("\n") +
          sourceNote("cache snapshot workOrders", supabaseContext.snapshotSyncedAt),
        model: "deterministic",
      });
    }
    if (
      isPeriodComparisonQuestion(prompt) &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchorCmp = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var qLower = toText(prompt).toLowerCase();
      var periodA = qLower.includes("month") ? resolvePeriodRange("this_month", anchorCmp) : resolvePeriodRange("this_week", anchorCmp);
      var periodB = qLower.includes("month") ? resolvePeriodRange("last_month", anchorCmp) : resolvePeriodRange("last_week", anchorCmp);
      var aggA = supabaseContext.production.range(periodA.start, periodA.end);
      var aggB = supabaseContext.production.range(periodB.start, periodB.end);
      var aTotal = toNum(aggA && aggA.totalCases);
      var bTotal = toNum(aggB && aggB.totalCases);
      var pct = bTotal ? Math.round(((aTotal - bTotal) / bTotal) * 100) : 0;
      return res.status(200).json({
        answer:
          periodA.label + ": " + aTotal.toLocaleString() + " cases (" + periodA.start + " to " + periodA.end + "). " +
          periodB.label + ": " + bTotal.toLocaleString() + " cases (" + periodB.start + " to " + periodB.end + "). " +
          "Change: " + (pct >= 0 ? "+" : "") + pct + "%.",
        model: "deterministic",
      });
    }

    var periodLabel = detectPeriodLabel(prompt);
    if (
      isCasesProducedQuestion(prompt) &&
      periodLabel &&
      periodLabel !== "today" &&
      periodLabel !== "yesterday" &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchor = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var periodCases = resolvePeriodRange(periodLabel, anchor);
      var agg = supabaseContext.production.range(periodCases.start, periodCases.end);
      var totalCases = toNum(agg && agg.totalCases);
      return res.status(200).json({
        answer:
          "Cases produced " + periodCases.label + " (" + (periodCases.start || "--") + " to " + (periodCases.end || "--") + "): " +
          totalCases.toLocaleString() + ".",
        model: "deterministic",
      });
    }

    if (isLastWeekSummaryQuestion(prompt) && !wantsDetailedBreakdown(prompt)) {
      var lwTotal = toNum(metrics.lastWeekCases);
      var lwS1 = toNum(metrics.lastWeekShift1Cases);
      var lwS2 = toNum(metrics.lastWeekShift2Cases);
      var lwStart = toText(metrics.lastWeekStartEt);
      var lwEnd = toText(metrics.lastWeekEndEt);
      var twTotal = toNum(metrics.thisWeekCases);
      var delta = lwTotal ? Math.round(((twTotal - lwTotal) / lwTotal) * 100) : 0;
      return res.status(200).json({
        answer:
          "Last week production (" + (lwStart || "--") + " to " + (lwEnd || "--") + "): " + lwTotal.toLocaleString() +
          " cases. Shift 1: " + lwS1.toLocaleString() +
          ", Shift 2: " + lwS2.toLocaleString() +
          ". This week-to-date: " + twTotal.toLocaleString() + " (" + (delta >= 0 ? "+" : "") + delta + "% vs last week).",
        model: "deterministic",
      });
    }
    if (isChartSummaryQuestion(prompt)) {
      var last7 = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7))
        ? supabaseContext.production.byDayLast7
        : [];
      var topLines = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.topLines))
        ? supabaseContext.production.topLines
        : [];
      if (!last7.length) {
        return res.status(200).json({
          answer: "I can’t summarize charts yet because recent production trend data is empty in Supabase. Run a sync and try again.",
          model: "deterministic",
        });
      }
      var total7 = last7.reduce(function(sum, d) { return sum + toNum(d.units); }, 0);
      var avg7 = Math.round(total7 / Math.max(1, last7.length));
      var sortedDays = last7.slice().sort(function(a, b) { return toNum(b.units) - toNum(a.units); });
      var best = sortedDays[0] || { date: "--", units: 0 };
      var worst = sortedDays[sortedDays.length - 1] || { date: "--", units: 0 };
      var trend = 0;
      if (last7.length >= 2) {
        var first = toNum(last7[0].units);
        var last = toNum(last7[last7.length - 1].units);
        trend = first ? Math.round(((last - first) / first) * 100) : 0;
      }
      var topLineText = topLines.length
        ? topLines.slice(0, 3).map(function(x) { return String(x.line || "--") + " (" + toNum(x.units).toLocaleString() + ")"; }).join(", ")
        : "No line breakdown available";
      return res.status(200).json({
        answer:
          "Chart summary (last 7 production days): total " + total7.toLocaleString() +
          " cases, avg " + avg7.toLocaleString() + "/day. " +
          "Peak day: " + String(best.date || "--") + " (" + toNum(best.units).toLocaleString() + "). " +
          "Low day: " + String(worst.date || "--") + " (" + toNum(worst.units).toLocaleString() + "). " +
          "Period trend: " + (trend >= 0 ? "+" : "") + trend + "%. " +
          "Top lines: " + topLineText + ".",
        model: "deterministic",
      });
    }
    if (isMarchYieldQuestion(prompt)) {
      var marchMonth = toText(metrics.marchMonth);
      var marchRemaining = toNum(metrics.marchRemainingUnits);
      var marchWOs = toNum(metrics.marchWorkOrders);
      var daysRemaining = toNum(metrics.marchBusinessDaysRemaining);
      var daysFull = toNum(metrics.marchBusinessDays);
      var targetRemain = toNum(metrics.marchDailyTargetRemaining);
      var targetFull = toNum(metrics.marchDailyTargetFullMonth);
      if (!(marchRemaining > 0) || !(daysFull > 0)) {
        return res.status(200).json({
          answer: "I can’t calculate March daily target yet because March due-volume metrics are not available in current context.",
          model: "deterministic",
        });
      }
      return res.status(200).json({
        answer:
          "March target (" + (marchMonth || "March") + "): " + marchRemaining.toLocaleString() +
          " remaining cases across " + marchWOs.toLocaleString() + " active WOs. " +
          "Required daily yield is " + targetFull.toLocaleString() + " cases/day over all March business days (" + daysFull + "). " +
          "From today forward, required pace is " + targetRemain.toLocaleString() + " cases/day over " + daysRemaining + " remaining business days.",
        model: "deterministic",
      });
    }

    var lastWeekRange = {
      start: toText(metrics.lastWeekStartEt),
      end: toText(metrics.lastWeekEndEt),
    };
    var thisWeekRange = {
      start: toText(metrics.thisWeekStartEt),
      end: toText(metrics.thisWeekEndEt),
    };
    var lastWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(lastWeekRange.start, lastWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };
    var thisWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(thisWeekRange.start, thisWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };

    if (supabaseContext && supabaseContext.production) {
      // remove function before serialization
      delete supabaseContext.production.range;
    }
    if (supabaseContext && supabaseContext.labor) {
      delete supabaseContext.labor.range;
    }
    if (supabaseContext && Object.prototype.hasOwnProperty.call(supabaseContext, "snapshotPayload")) {
      delete supabaseContext.snapshotPayload;
    }

    var apiKey = process.env.OPENAI_API_KEY || "";
    var model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    }

    var system = [
      "You are PackPulse AI copilot for factory operations.",
      "Be concise, practical, and action-oriented.",
      "Prioritize: what happened, why it matters, and what to do next.",
      "Use provided numeric context directly; do not invent metrics.",
      "If the user asks for a number and it is present in context, answer with the exact value first.",
      "For summary questions, include: total, trend, top SKU mix, top lines, and concrete actions.",
      "If data is missing or uncertain, say so clearly.",
      "Never claim actions were completed unless explicitly provided in context."
    ].join(" ");

    var messages = [{ role: "system", content: system }];
    messages.push({
      role: "user",
      content:
        "Context\n" +
        "- User: " + user.email + "\n" +
        "- Active view: " + activeView + "\n" +
        (contextLines.length ? "- Dashboard context:\n  - " + contextLines.join("\n  - ") + "\n" : "") +
        "- Metrics JSON: " + JSON.stringify(metrics) + "\n" +
        "- Last week aggregate JSON: " + JSON.stringify(lastWeekAgg) + "\n" +
        "- This week aggregate JSON: " + JSON.stringify(thisWeekAgg) + "\n" +
        "- Supabase context JSON: " + JSON.stringify(supabaseContext || {})
    });

    history.forEach(function(msg) {
      var role = msg && msg.role === "assistant" ? "assistant" : "user";
      var text = toText(msg && msg.text);
      if (!text) return;
      messages.push({ role: role, content: text });
    });
    messages.push({ role: "user", content: prompt });

    var openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        messages: messages,
      }),
    });

    var raw = await openaiResp.text();
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
    if (!openaiResp.ok) {
      var details = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw || "OpenAI request failed";
      return res.status(openaiResp.status).json({ error: "AI request failed", details: details });
    }

    var answer =
      parsed &&
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content
        ? String(parsed.choices[0].message.content).trim()
        : "";
    if (!answer) answer = "No AI response was returned.";

    return res.status(200).json({ answer: answer, model: model });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Could not process AI request",
      details: err && err.message ? err.message : "unknown",
    });
  }
}
