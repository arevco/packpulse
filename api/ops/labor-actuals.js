import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";
import { LABOR_SHIFT_CONFIG, classifyLaborShiftFromPunchET, normalizeLaborRoleKey, pickFieldLoose } from "../_labor.js";

var ET_TIME_ZONE = "America/New_York";

function sanitizeDate(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function sanitizeMonthKey(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function normalizeShiftLabel(value) {
  var s = String(value || "").toLowerCase();
  if (!s) return "";
  if (s.indexOf("cross") !== -1) return "Cross-Shift Job";
  if (s.indexOf("unassigned") !== -1) return "Unassigned";
  if (s.indexOf("1") !== -1 || s.indexOf("1st") !== -1) return "Shift 1 (7a-3p)";
  if (s.indexOf("2") !== -1 || s.indexOf("2nd") !== -1) return "Shift 2 (3p-11p)";
  return "";
}

function isSpecificShiftLabel(value) {
  var normalized = normalizeShiftLabel(value);
  return normalized === "Shift 1 (7a-3p)" || normalized === "Shift 2 (3p-11p)";
}

function resolveExplicitShiftFromRaw(raw) {
  return normalizeShiftLabel(pickFieldLoose(raw, [
    "Shift Label",
    "shift_label",
    "Shift",
    "shift",
    "Shift Name",
    "shift_name"
  ]));
}

function monthRange(monthKey) {
  var mk = sanitizeMonthKey(monthKey);
  if (!mk) return null;
  var start = mk + "-01";
  var endDate = new Date(start + "T00:00:00Z");
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return {
    start: start,
    end: endDate.toISOString().slice(0, 10)
  };
}

function addDaysIso(dateKey, deltaDays) {
  var s = sanitizeDate(dateKey);
  if (!s) return "";
  var d = new Date(s + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function timeZoneParts(date, timeZone) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  var out = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date).forEach(function(part) {
    if (part.type !== "literal") out[part.type] = part.value;
  });
  if (!out.year || !out.month || !out.day) return null;
  return {
    year: parseInt(out.year, 10),
    month: parseInt(out.month, 10),
    day: parseInt(out.day, 10),
    hour: parseInt(out.hour || "0", 10),
    minute: parseInt(out.minute || "0", 10),
    second: parseInt(out.second || "0", 10)
  };
}

function timeZoneOffsetMillis(date, timeZone) {
  var parts = timeZoneParts(date, timeZone);
  if (!parts) return 0;
  var asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function easternWallClockToDate(dateKey, hour24, minute, second) {
  var s = sanitizeDate(dateKey);
  if (!s) return null;
  var year = parseInt(s.slice(0, 4), 10);
  var monthIndex = parseInt(s.slice(5, 7), 10) - 1;
  var day = parseInt(s.slice(8, 10), 10);
  var utcGuess = Date.UTC(year, monthIndex, day, hour24, minute || 0, second || 0);
  var offset = timeZoneOffsetMillis(new Date(utcGuess), ET_TIME_ZONE);
  var actual = utcGuess - offset;
  var resolvedOffset = timeZoneOffsetMillis(new Date(actual), ET_TIME_ZONE);
  if (resolvedOffset !== offset) actual = utcGuess - resolvedOffset;
  return new Date(actual);
}

function toEasternDateKey(value) {
  if (!value) return "";
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date)) return "";
  var parts = timeZoneParts(date, ET_TIME_ZONE);
  if (!parts) return "";
  return String(parts.year) + "-" + String(parts.month).padStart(2, "0") + "-" + String(parts.day).padStart(2, "0");
}

function parseUtcMillis(value) {
  if (!value) return 0;
  var ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function overlapMillis(startA, endA, startB, endB) {
  var start = Math.max(startA, startB);
  var end = Math.min(endA, endB);
  return end > start ? (end - start) : 0;
}

function deriveLaborStatus(finalizedRows, provisionalRows) {
  if (provisionalRows > 0 && finalizedRows > 0) return "mixed";
  if (provisionalRows > 0) return "provisional";
  if (finalizedRows > 0) return "finalized";
  return "unknown";
}

function buildAllocatedLaborSegments(row, todayEt) {
  var payableHours = toNum(row && row.payable_hours);
  var productiveHours = toNum(row && row.productive_hours);
  var startMs = parseUtcMillis(row && row.clock_in_at_utc);
  var endMs = parseUtcMillis(row && row.clock_out_at_utc);
  var workedAtMs = parseUtcMillis(row && row.worked_at_utc);
  var explicitShift = resolveExplicitShiftFromRaw(row && row.raw);
  var fallbackDate = sanitizeDate(row && row.worked_date_et);
  var fallbackShift = explicitShift || textKey(row && row.shift_label, "Unassigned");
  var fallbackFinalized = fallbackDate ? (fallbackDate < todayEt) : false;
  var hasSingleEndpoint = (startMs > 0) !== (endMs > 0);
  var hasClockEvidence = startMs > 0 || endMs > 0 || workedAtMs > 0;
  var fallbackShiftTrusted = !!explicitShift || (isSpecificShiftLabel(fallbackShift) && hasClockEvidence);

  var buildFallback = function() {
    return [Object.assign({}, row, {
      worked_date_et: fallbackDate || "",
      shift_label: fallbackShift,
      is_finalized: fallbackFinalized,
      allocation_method: "stored_bucket",
      has_trusted_shift: fallbackShiftTrusted,
      shift_match_confidence: fallbackShiftTrusted ? "trusted" : (hasSingleEndpoint ? "low" : "unknown")
    })];
  };

  var buildAssignedSegment = function(dateKey, shiftLabel, method, confidence) {
    return [Object.assign({}, row, {
      worked_date_et: dateKey || "",
      shift_label: shiftLabel || "Unassigned",
      is_finalized: !!dateKey && dateKey < todayEt,
      allocation_method: method,
      has_trusted_shift: confidence === "trusted",
      shift_match_confidence: confidence
    })];
  };

  var shiftWindowBounds = function(dateKey, shiftLabel) {
    if (shiftLabel === "Shift 1 (7a-3p)") {
      return {
        start: easternWallClockToDate(dateKey, 7, 0, 0),
        end: easternWallClockToDate(dateKey, 15, 0, 0)
      };
    }
    if (shiftLabel === "Shift 2 (3p-11p)") {
      return {
        start: easternWallClockToDate(dateKey, 15, 0, 0),
        end: easternWallClockToDate(dateKey, 23, 0, 0)
      };
    }
    return null;
  };

  if (!(startMs > 0) || !(endMs > startMs)) return buildFallback();

  var startDateEt = toEasternDateKey(new Date(startMs));
  var endDateEt = toEasternDateKey(new Date(Math.max(startMs, endMs - 1)));
  if (!startDateEt || !endDateEt) return buildFallback();

  var totalMs = endMs - startMs;
  var buildOverlapSegments = function() {
    var segments = [];
    for (var dateKey = startDateEt; dateKey && dateKey <= endDateEt; dateKey = addDaysIso(dateKey, 1)) {
      var dayStart = easternWallClockToDate(dateKey, 0, 0, 0);
      var nextDayStart = easternWallClockToDate(addDaysIso(dateKey, 1), 0, 0, 0);
      if (!dayStart || !nextDayStart || isNaN(dayStart) || isNaN(nextDayStart)) continue;
      var dayMs = overlapMillis(startMs, endMs, dayStart.getTime(), nextDayStart.getTime());
      if (!(dayMs > 0)) continue;

      var shift1Start = easternWallClockToDate(dateKey, 7, 0, 0);
      var shift1End = easternWallClockToDate(dateKey, 15, 0, 0);
      var shift2Start = easternWallClockToDate(dateKey, 15, 0, 0);
      var shift2End = easternWallClockToDate(dateKey, 23, 0, 0);
      var shift1Ms = overlapMillis(startMs, endMs, shift1Start.getTime(), shift1End.getTime());
      var shift2Ms = overlapMillis(startMs, endMs, shift2Start.getTime(), shift2End.getTime());
      var unassignedMs = Math.max(0, dayMs - shift1Ms - shift2Ms);

      [
        { shift: "Shift 1 (7a-3p)", ms: shift1Ms },
        { shift: "Shift 2 (3p-11p)", ms: shift2Ms },
        { shift: "Unassigned", ms: unassignedMs }
      ].forEach(function(bucket) {
        if (!(bucket.ms > 0)) return;
        var share = bucket.ms / totalMs;
        segments.push(Object.assign({}, row, {
          worked_date_et: dateKey,
          shift_label: bucket.shift,
          payable_hours: payableHours * share,
          productive_hours: productiveHours * share,
          is_finalized: dateKey < todayEt,
          allocation_method: "cross_shift_split",
          has_trusted_shift: bucket.shift !== "Unassigned",
          shift_match_confidence: bucket.shift === "Unassigned" ? "low" : "trusted"
        }));
      });
    }
    return segments;
  };

  if (explicitShift && startDateEt === endDateEt && isSpecificShiftLabel(explicitShift)) {
    return buildAssignedSegment(startDateEt, explicitShift, "explicit_shift", "trusted");
  }

  var punchInParts = timeZoneParts(new Date(startMs), ET_TIME_ZONE);
  var punchInShift = classifyLaborShiftFromPunchET(punchInParts);
  if (startDateEt === endDateEt && isSpecificShiftLabel(punchInShift)) {
    var overlapSegments = buildOverlapSegments();
    var otherShift = punchInShift === "Shift 1 (7a-3p)" ? "Shift 2 (3p-11p)" : "Shift 1 (7a-3p)";
    var otherWindow = shiftWindowBounds(startDateEt, otherShift);
    var spillMs = otherWindow
      ? overlapMillis(startMs, endMs, otherWindow.start.getTime(), otherWindow.end.getTime())
      : 0;
    if (spillMs > (LABOR_SHIFT_CONFIG.cross_shift_split_minutes * 60 * 1000)) return overlapSegments;
    return buildAssignedSegment(startDateEt, punchInShift, "punch_in_grace", "trusted");
  }

  var segments = [];
  for (var dateKey = startDateEt; dateKey && dateKey <= endDateEt; dateKey = addDaysIso(dateKey, 1)) {
    var dayStart = easternWallClockToDate(dateKey, 0, 0, 0);
    var nextDayStart = easternWallClockToDate(addDaysIso(dateKey, 1), 0, 0, 0);
    if (!dayStart || !nextDayStart || isNaN(dayStart) || isNaN(nextDayStart)) continue;
    var dayMs = overlapMillis(startMs, endMs, dayStart.getTime(), nextDayStart.getTime());
    if (!(dayMs > 0)) continue;

    var shift1Start = easternWallClockToDate(dateKey, 7, 0, 0);
    var shift1End = easternWallClockToDate(dateKey, 15, 0, 0);
    var shift2Start = easternWallClockToDate(dateKey, 15, 0, 0);
    var shift2End = easternWallClockToDate(dateKey, 23, 0, 0);
    var shift1Ms = overlapMillis(startMs, endMs, shift1Start.getTime(), shift1End.getTime());
    var shift2Ms = overlapMillis(startMs, endMs, shift2Start.getTime(), shift2End.getTime());
    var unassignedMs = Math.max(0, dayMs - shift1Ms - shift2Ms);

    [
      { shift: "Shift 1 (7a-3p)", ms: shift1Ms },
      { shift: "Shift 2 (3p-11p)", ms: shift2Ms },
      { shift: "Unassigned", ms: unassignedMs }
    ].forEach(function(bucket) {
      if (!(bucket.ms > 0)) return;
      var share = bucket.ms / totalMs;
      segments.push(Object.assign({}, row, {
        worked_date_et: dateKey,
        shift_label: bucket.shift,
        payable_hours: payableHours * share,
        productive_hours: productiveHours * share,
        is_finalized: dateKey < todayEt,
        allocation_method: bucket.shift === "Unassigned" ? "stored_bucket" : "cross_shift_split",
        has_trusted_shift: bucket.shift !== "Unassigned",
        shift_match_confidence: bucket.shift === "Unassigned" ? "low" : "trusted"
      }));
    });
  }

  return segments.length ? segments : buildFallback();
}

function isMissingTableError(tableName, err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf(String(tableName || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

async function fetchDailyLineMetricRows(supabase, startDate, endDate) {
  return fetchAllRows(
    supabase,
    "ops_daily_line_metrics_mv",
    "date_et,shift_label,line_name,production_rows,production_jobs,production_work_orders,produced_units,labor_rows,payable_hours,productive_hours,labor_cost",
    "date_et",
    startDate,
    endDate
  );
}

function addAggregateMetric(target, metricRow) {
  target.payable_hours += toNum(metricRow && metricRow.payable_hours);
  target.productive_hours += toNum(metricRow && metricRow.productive_hours);
  target.labor_cost += toNum(metricRow && metricRow.labor_cost);
  target.rows += toNum(metricRow && metricRow.labor_rows);
  return target;
}

function finalizeAggregateMetricRow(row, casesProduced) {
  var out = finalizeMetricRow(row, casesProduced);
  out.labor_status = "aggregate";
  out.can_direct_match_shift = false;
  out.shift_match_confidence = "aggregate";
  return out;
}

function buildSummaryPayloadFromMetricRows(metricRows, startDate, endDate, todayEt, finalizedThroughDate) {
  var summary = makeMetricRow({});
  var byDayMap = {};
  var byShiftMap = {};
  var byLineMap = {};
  var casesByDay = {};
  var casesByShift = {};
  var casesByLine = {};
  var totalProductionCases = 0;
  var totalLaborRows = 0;

  (Array.isArray(metricRows) ? metricRows : []).forEach(function(row) {
    var date = textKey(row && row.date_et);
    if (!dateInRange(date, startDate, endDate)) return;
    var shift = textKey(row && row.shift_label, "Unassigned");
    var line = textKey(row && row.line_name, "Unknown");
    var producedUnits = toNum(row && row.produced_units);
    var shiftKey = date + "|" + shift;

    totalProductionCases += producedUnits;
    totalLaborRows += toNum(row && row.labor_rows);

    addAggregateMetric(summary, row);

    if (!byDayMap[date]) byDayMap[date] = makeMetricRow({ date_et: date });
    addAggregateMetric(byDayMap[date], row);
    casesByDay[date] = (casesByDay[date] || 0) + producedUnits;

    if (!byShiftMap[shiftKey]) byShiftMap[shiftKey] = makeMetricRow({ date_et: date, shift_label: shift });
    addAggregateMetric(byShiftMap[shiftKey], row);
    casesByShift[shiftKey] = (casesByShift[shiftKey] || 0) + producedUnits;

    if (!byLineMap[line]) byLineMap[line] = makeMetricRow({ line_name: line });
    addAggregateMetric(byLineMap[line], row);
    casesByLine[line] = (casesByLine[line] || 0) + producedUnits;
  });

  var byDay = Object.keys(byDayMap).map(function(key) {
    return finalizeAggregateMetricRow(byDayMap[key], toNum(casesByDay[key]));
  }).sort(function(a, b) { return String(b.date_et || "").localeCompare(String(a.date_et || "")); });

  var byShift = Object.keys(byShiftMap).map(function(key) {
    return finalizeAggregateMetricRow(byShiftMap[key], toNum(casesByShift[key]));
  }).sort(function(a, b) {
    if (a.date_et !== b.date_et) return String(b.date_et || "").localeCompare(String(a.date_et || ""));
    return String(a.shift_label || "").localeCompare(String(b.shift_label || ""));
  });

  var byLine = Object.keys(byLineMap).map(function(key) {
    return finalizeAggregateMetricRow(byLineMap[key], toNum(casesByLine[key]));
  }).sort(function(a, b) { return b.labor_cost - a.labor_cost; });

  var summaryFinal = finalizeAggregateMetricRow(summary, totalProductionCases);
  summaryFinal.total_production_cases = totalProductionCases;
  summaryFinal.matched_cases = null;
  summaryFinal.coverage_pct = null;
  summaryFinal.unique_job_count = null;
  summaryFinal.unique_work_order_count = null;
  summaryFinal.inferred_job_timing_rows = 0;
  summaryFinal.cross_shift_job_rows = 0;
  summaryFinal.duplicate_match_suppressed_rows = 0;
  summaryFinal.labor_query_mode = "ops_daily_line_metrics_mv_summary";
  summaryFinal.labor_rows_fetched = Array.isArray(metricRows) ? metricRows.length : 0;
  summaryFinal.labor_rows_in_range = totalLaborRows;
  summaryFinal.labor_segments_in_range = totalLaborRows;
  summaryFinal.days_with_labor = byDay.length;
  summaryFinal.latest_date = byDay.length ? byDay[0].date_et : null;
  summaryFinal.today_et = todayEt;
  summaryFinal.finalized_through_date = finalizedThroughDate || null;
  summaryFinal.has_provisional_labor = null;

  return {
    status: "ok",
    productionStatus: "ops_daily_line_metrics_mv",
    summaryOnly: true,
    querySource: "ops_daily_line_metrics_mv",
    range: { start: startDate, end: endDate },
    summary: summaryFinal,
    byDay: byDay,
    byShift: byShift,
    byLine: byLine,
    byRole: [],
    byWorkOrder: [],
    byJob: []
  };
}

async function fetchAllRows(supabase, tableName, columns, dateCol, startDate, endDate) {
  var out = [];
  var pageSize = 1000;
  var from = 0;
  while (true) {
    var to = from + pageSize - 1;
    var q = supabase
      .from(tableName)
      .select(columns)
      .eq("site_id", CACHE_SITE_ID)
      .order(dateCol, { ascending: false })
      .range(from, to);
    if (startDate) q = q.gte(dateCol, startDate);
    if (endDate) q = q.lte(dateCol, endDate);
    var resp = await q;
    if (resp.error) return { error: resp.error, data: out };
    var rows = Array.isArray(resp.data) ? resp.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 100000) break;
  }
  return { error: null, data: out };
}

function dateInRange(dateKey, startDate, endDate) {
  var date = sanitizeDate(dateKey);
  if (!date) return false;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function avgPct(sum, weight) {
  return weight > 0 ? (sum / weight) : 0;
}

function makeMetricRow(base) {
  return Object.assign({
    payable_hours: 0,
    productive_hours: 0,
    labor_cost: 0,
    rows: 0,
    finalized_rows: 0,
    provisional_rows: 0,
    trusted_shift_rows: 0,
    low_confidence_shift_rows: 0,
    availability_sum: 0,
    availability_weight: 0,
    performance_sum: 0,
    performance_weight: 0,
    line_efficiency_sum: 0,
    line_efficiency_weight: 0
  }, base || {});
}

function addWeightedPct(target, hours, availability, performance, lineEfficiency) {
  var weight = hours > 0 ? hours : 1;
  if (availability > 0) {
    target.availability_sum += availability * weight;
    target.availability_weight += weight;
  }
  if (performance > 0) {
    target.performance_sum += performance * weight;
    target.performance_weight += weight;
  }
  if (lineEfficiency > 0) {
    target.line_efficiency_sum += lineEfficiency * weight;
    target.line_efficiency_weight += weight;
  }
}

function addLaborToRow(target, laborRow) {
  var payable = toNum(laborRow.payable_hours);
  var productive = toNum(laborRow.productive_hours);
  var hourlyRate = toNum(laborRow.hourly_rate);
  var laborCost = payable * hourlyRate;
  target.payable_hours += payable;
  target.productive_hours += productive;
  target.labor_cost += laborCost;
  target.rows += 1;
  if (laborRow && laborRow.has_trusted_shift) target.trusted_shift_rows += 1;
  else if (isSpecificShiftLabel(laborRow && laborRow.shift_label)) target.low_confidence_shift_rows += 1;
  if (laborRow && laborRow.is_finalized) target.finalized_rows += 1;
  else target.provisional_rows += 1;
  addWeightedPct(target, payable || productive || 0, toNum(laborRow.availability_pct), toNum(laborRow.performance_pct), toNum(laborRow.line_efficiency_pct));
  return laborCost;
}

function finalizeMetricRow(row, casesProduced) {
  var cases = toNum(casesProduced);
  var out = Object.assign({}, row, {
    cases_produced: cases,
    cases_per_payable_hour: row.payable_hours > 0 ? (cases / row.payable_hours) : 0,
    cases_per_productive_hour: row.productive_hours > 0 ? (cases / row.productive_hours) : 0,
    labor_cost_per_case: cases > 0 ? (row.labor_cost / cases) : 0,
    availability_pct: avgPct(row.availability_sum, row.availability_weight),
    performance_pct: avgPct(row.performance_sum, row.performance_weight),
    line_efficiency_pct: avgPct(row.line_efficiency_sum, row.line_efficiency_weight),
    labor_status: deriveLaborStatus(toNum(row.finalized_rows), toNum(row.provisional_rows)),
    can_direct_match_shift: toNum(row.trusted_shift_rows) > 0,
    shift_match_confidence: toNum(row.trusted_shift_rows) > 0 ? "trusted" : (toNum(row.low_confidence_shift_rows) > 0 ? "low" : "aggregate")
  });
  delete out.availability_sum;
  delete out.availability_weight;
  delete out.performance_sum;
  delete out.performance_weight;
  delete out.line_efficiency_sum;
  delete out.line_efficiency_weight;
  return out;
}

function textKey(value, fallback) {
  var s = String(value || "").trim();
  return s || fallback || "";
}

function getTimingBucket(map, key) {
  if (!key) return null;
  if (!map[key]) {
    map[key] = {
      dateWeights: {},
      shiftWeights: {}
    };
  }
  return map[key];
}

function addTimingWeight(bucket, date, shift, units) {
  if (!bucket || !date) return;
  var weight = units > 0 ? units : 1;
  bucket.dateWeights[date] = (bucket.dateWeights[date] || 0) + weight;
  if (shift) bucket.shiftWeights[shift] = (bucket.shiftWeights[shift] || 0) + weight;
}

function pickDominantKey(weightMap) {
  var keys = Object.keys(weightMap || {});
  if (!keys.length) return "";
  return keys.sort(function(a, b) {
    var diff = (weightMap[b] || 0) - (weightMap[a] || 0);
    if (diff) return diff;
    return String(a).localeCompare(String(b));
  })[0] || "";
}

function finalizeTimingBucket(bucket) {
  if (!bucket) return null;
  var date = pickDominantKey(bucket.dateWeights);
  var shiftKeys = Object.keys(bucket.shiftWeights || {});
  var shift = "";
  if (shiftKeys.length === 1) shift = shiftKeys[0];
  else if (shiftKeys.length > 1) shift = "Cross-Shift Job";
  return date ? { date: date, shift: shift || "Unassigned" } : null;
}

function resolveProductionMatch(row, casesByJob, casesByJobDateLineItem, casesByJobDateLine, casesByWoDateLine, casesByItemDateShiftLine) {
  var jobId = textKey(row.job_id);
  var date = textKey(row.date_et);
  var shift = textKey(row.shift_label, "Unassigned");
  var line = textKey(row.line_name, "Unknown");
  var wo = textKey(row.work_order_code);
  var item = textKey(row.item_code);
  var resolutionKey = "";
  var cases = 0;
  if (jobId) {
    resolutionKey = [jobId, date, shift, wo, line, item].join("|");
    cases = toNum(casesByJob[resolutionKey]);
  }
  if (!(cases > 0) && jobId) {
    resolutionKey = [jobId, date, line, item].join("|");
    cases = toNum(casesByJobDateLineItem[resolutionKey]);
  }
  if (!(cases > 0) && jobId) {
    resolutionKey = [jobId, date, line].join("|");
    cases = toNum(casesByJobDateLine[resolutionKey]);
  }
  if (!(cases > 0) && wo) {
    resolutionKey = wo + "|" + date + "|" + line;
    cases = toNum(casesByWoDateLine[resolutionKey]);
  }
  if (!(cases > 0) && item) {
    resolutionKey = item + "|" + date + "|" + shift + "|" + line;
    cases = toNum(casesByItemDateShiftLine[resolutionKey]);
  }
  return {
    resolutionKey: resolutionKey,
    cases: cases
  };
}

function shouldPreferMatchCandidate(nextCandidate, currentCandidate) {
  if (!currentCandidate) return true;
  var nextHours = toNum(nextCandidate && nextCandidate.row && nextCandidate.row.payable_hours);
  var currentHours = toNum(currentCandidate && currentCandidate.row && currentCandidate.row.payable_hours);
  if (nextHours !== currentHours) return nextHours > currentHours;
  var nextCost = toNum(nextCandidate && nextCandidate.row && nextCandidate.row.labor_cost);
  var currentCost = toNum(currentCandidate && currentCandidate.row && currentCandidate.row.labor_cost);
  if (nextCost !== currentCost) return nextCost > currentCost;
  return String(nextCandidate && nextCandidate.jobKey || "").localeCompare(String(currentCandidate && currentCandidate.jobKey || "")) < 0;
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var startDate = sanitizeDate(req.query && req.query.start);
    var endDate = sanitizeDate(req.query && req.query.end);
    var monthKey = sanitizeMonthKey(req.query && req.query.monthKey);
    var summaryOnly = /^(1|true|yes)$/i.test(String((req.query && req.query.summary) || "").trim());
    if (!startDate || !endDate) {
      var mr = monthRange(monthKey);
      if (mr) {
        startDate = mr.start;
        endDate = mr.end;
      }
    }
    if (!startDate || !endDate) {
      return res.status(400).json({ error: "Missing start/end or monthKey" });
    }
    if (endDate < startDate) {
      var tmp = startDate;
      startDate = endDate;
      endDate = tmp;
    }

    var supabase = getSupabaseAdmin();
    var todayEt = toEasternDateKey(new Date());
    var finalizedThroughDate = addDaysIso(todayEt, -1);
    if (summaryOnly) {
      var metricQ = await fetchDailyLineMetricRows(supabase, startDate, endDate);
      if (!metricQ.error) {
        return res.status(200).json(buildSummaryPayloadFromMetricRows(metricQ.data, startDate, endDate, todayEt, finalizedThroughDate));
      }
      if (!isMissingTableError("ops_daily_line_metrics_mv", metricQ.error)) {
        throw metricQ.error;
      }
    }
    var laborColumns = "worked_date_et,worked_at_utc,clock_in_at_utc,clock_out_at_utc,source_snapshot_at,shift_label,line_name,job_id,work_order_code,work_order_id,item_code,item_description,item_family_name,role_name,role_key,payable_hours,productive_hours,hourly_rate,availability_pct,performance_pct,line_efficiency_pct,raw";
    var laborLegacyColumns = "worked_date_et,source_snapshot_at,shift_label,line_name,job_id,work_order_code,work_order_id,item_code,item_description,item_family_name,role_name,role_key,payable_hours,productive_hours,hourly_rate,availability_pct,performance_pct,line_efficiency_pct";
    var laborQueryMode = "worked_date";
    var laborQ = await fetchAllRows(
      supabase,
      "labor_events",
      laborColumns,
      "worked_date_et",
      addDaysIso(startDate, -1),
      endDate
    );
    if (laborQ.error && !isMissingTableError("labor_events", laborQ.error)) {
      laborQ = await fetchAllRows(
        supabase,
        "labor_events",
        laborLegacyColumns,
        "worked_date_et",
        addDaysIso(startDate, -1),
        endDate
      );
    }
    if (laborQ.error) {
      if (isMissingTableError("labor_events", laborQ.error)) {
        return res.status(200).json({
          status: "missing_labor_events_table",
          range: { start: startDate, end: endDate },
          summary: {},
          byDay: [],
          byShift: [],
          byLine: [],
          byRole: [],
          byWorkOrder: [],
          byJob: []
        });
      }
      throw laborQ.error;
    }
    var fetchedLaborRows = Array.isArray(laborQ.data) ? laborQ.data : [];
    if (!fetchedLaborRows.length) {
      laborQueryMode = "all_rows_fallback";
      var laborAllQ = await fetchAllRows(
        supabase,
        "labor_events",
        laborColumns,
        "source_snapshot_at",
        "",
        ""
      );
      if (laborAllQ.error && !isMissingTableError("labor_events", laborAllQ.error)) {
        laborAllQ = await fetchAllRows(
          supabase,
          "labor_events",
          laborLegacyColumns,
          "source_snapshot_at",
          "",
          ""
        );
      }
      if (laborAllQ.error) {
        throw laborAllQ.error;
      }
      fetchedLaborRows = Array.isArray(laborAllQ.data) ? laborAllQ.data : [];
    }
    var rawLaborRowsInRange = 0;
    var laborRows = [];
    fetchedLaborRows.forEach(function(row) {
      var segments = buildAllocatedLaborSegments(row, todayEt).filter(function(segment) {
        return dateInRange(segment && segment.worked_date_et, startDate, endDate);
      });
      if (segments.length) rawLaborRowsInRange += 1;
      Array.prototype.push.apply(laborRows, segments);
    });

    var prodQ = await fetchAllRows(
      supabase,
      "production_events",
      "produced_date_et,shift_label,line,job_id,work_order_code,item_code,units_produced",
      "produced_date_et",
      startDate,
      endDate
    );
    var productionRows = [];
    var productionStatus = "ok";
    if (prodQ.error) {
      if (isMissingTableError("production_events", prodQ.error)) productionStatus = "missing_production_events_table";
      else throw prodQ.error;
    } else {
      productionRows = Array.isArray(prodQ.data) ? prodQ.data : [];
    }

    var totalProductionCases = productionRows.reduce(function(sum, r) {
      return sum + toNum(r.units_produced);
    }, 0);

    var casesByShift = {};
    var casesByLine = {};
    var casesByWo = {};
    var casesByJob = {};
    var casesByJobDateLineItem = {};
    var casesByJobDateLine = {};
    var casesByWoDateLine = {};
    var casesByItemDateShiftLine = {};
    var jobTimingByJob = {};
    var jobTimingByJobLine = {};
    productionRows.forEach(function(r) {
      var date = textKey(r.produced_date_et);
      var shift = textKey(r.shift_label, "Unassigned");
      var line = textKey(r.line, "Unknown");
      var wo = textKey(r.work_order_code);
      var job = textKey(r.job_id);
      var item = textKey(r.item_code);
      var units = toNum(r.units_produced);
      if (!(units > 0) || !date) return;
      casesByShift[date + "|" + shift] = (casesByShift[date + "|" + shift] || 0) + units;
      casesByLine[line] = (casesByLine[line] || 0) + units;
      if (wo) casesByWo[wo] = (casesByWo[wo] || 0) + units;
      if (wo) casesByWoDateLine[wo + "|" + date + "|" + line] = (casesByWoDateLine[wo + "|" + date + "|" + line] || 0) + units;
      if (item) casesByItemDateShiftLine[item + "|" + date + "|" + shift + "|" + line] = (casesByItemDateShiftLine[item + "|" + date + "|" + shift + "|" + line] || 0) + units;
      if (job) {
        addTimingWeight(getTimingBucket(jobTimingByJob, job), date, shift, units);
        addTimingWeight(getTimingBucket(jobTimingByJobLine, job + "|" + line), date, shift, units);
        var jobKey = [job, date, shift, wo, line, item].join("|");
        casesByJob[jobKey] = (casesByJob[jobKey] || 0) + units;
        casesByJobDateLine[job + "|" + date + "|" + line] = (casesByJobDateLine[job + "|" + date + "|" + line] || 0) + units;
        if (item) {
          var jobLineItemKey = [job, date, line, item].join("|");
          casesByJobDateLineItem[jobLineItemKey] = (casesByJobDateLineItem[jobLineItemKey] || 0) + units;
        }
      }
    });

    var summary = makeMetricRow({
      unique_jobs: {},
      unique_work_orders: {}
    });
    var byDayMap = {};
    var byShiftMap = {};
    var byLineMap = {};
    var byRoleMap = {};
    var byWoMap = {};
    var byJobMap = {};
    var inferredTimingRows = 0;
    var crossShiftTimingRows = 0;
    var laborSegmentsInRange = 0;

    laborRows.forEach(function(r) {
      var jobId = textKey(r.job_id);
      var line = textKey(r.line_name, "Unknown");
      var timing = finalizeTimingBucket(jobTimingByJobLine[jobId + "|" + line]) || finalizeTimingBucket(jobTimingByJob[jobId]);
      var storedDate = textKey(r.worked_date_et);
      var date = textKey(storedDate || (timing && timing.date));
      if (!date) {
        var fallbackDate = textKey(r.source_snapshot_at).slice(0, 10);
        if (sanitizeDate(fallbackDate)) date = fallbackDate;
      }
      if (!dateInRange(date, startDate, endDate)) return;
      laborSegmentsInRange += 1;
      var storedShift = textKey(r.shift_label);
      var shift = textKey(
        (storedShift && storedShift !== "Unassigned")
          ? storedShift
          : ((timing && timing.shift) || storedShift),
        "Unassigned"
      );
      if (!storedDate && timing && timing.date) inferredTimingRows += 1;
      if ((!storedShift || storedShift === "Unassigned") && timing && timing.shift === "Cross-Shift Job") {
        crossShiftTimingRows += 1;
      }
      var roleKey = textKey(r.role_key || normalizeLaborRoleKey(r.role_name), "other");
      var roleName = textKey(r.role_name, roleKey);
      var workOrderCode = textKey(r.work_order_code);
      var itemCode = textKey(r.item_code);
      var itemDescription = textKey(r.item_description, itemCode || "--");
      var shiftKey = date + "|" + shift;
      var woKey = workOrderCode || ("unassigned|" + date + "|" + line + "|" + itemCode);
      var jobKey = [jobId || "unknown", date, shift, line, workOrderCode, itemCode].join("|");

      addLaborToRow(summary, r);
      if (jobId) summary.unique_jobs[jobId] = true;
      if (workOrderCode) summary.unique_work_orders[workOrderCode] = true;

      if (!byDayMap[date]) byDayMap[date] = makeMetricRow({ date_et: date });
      addLaborToRow(byDayMap[date], r);

      if (!byShiftMap[shiftKey]) byShiftMap[shiftKey] = makeMetricRow({ date_et: date, shift_label: shift });
      addLaborToRow(byShiftMap[shiftKey], r);

      if (!byLineMap[line]) byLineMap[line] = makeMetricRow({ line_name: line });
      addLaborToRow(byLineMap[line], r);

      if (!byRoleMap[roleKey]) byRoleMap[roleKey] = makeMetricRow({ role_key: roleKey, role_name: roleName });
      addLaborToRow(byRoleMap[roleKey], r);

      if (!byWoMap[woKey]) byWoMap[woKey] = makeMetricRow({
        work_order_code: workOrderCode || null,
        line_name: line,
        item_code: itemCode || null,
        item_description: itemDescription || null
      });
      addLaborToRow(byWoMap[woKey], r);

      if (!byJobMap[jobKey]) byJobMap[jobKey] = makeMetricRow({
        date_et: date,
        shift_label: shift,
        line_name: line,
        job_id: jobId || null,
        work_order_code: workOrderCode || null,
        item_code: itemCode || null,
        item_description: itemDescription || null
      });
      addLaborToRow(byJobMap[jobKey], r);
    });

    var matchedCaseKeys = {};
    var casesByResolvedShift = {};
    var casesByResolvedDay = {};
    var duplicateMatchSuppressedRows = 0;
    var jobCandidates = Object.keys(byJobMap).map(function(key) {
      var row = byJobMap[key];
      var resolved = resolveProductionMatch(
        row,
        casesByJob,
        casesByJobDateLineItem,
        casesByJobDateLine,
        casesByWoDateLine,
        casesByItemDateShiftLine
      );
      return {
        jobKey: key,
        row: row,
        resolutionKey: resolved.resolutionKey,
        cases: resolved.cases
      };
    });
    var bestClaimByResolution = {};
    jobCandidates.forEach(function(candidate) {
      if (!(candidate.cases > 0) || !candidate.resolutionKey) return;
      if (shouldPreferMatchCandidate(candidate, bestClaimByResolution[candidate.resolutionKey])) {
        bestClaimByResolution[candidate.resolutionKey] = candidate;
      }
    });
    var byJob = jobCandidates.map(function(candidate) {
      var assignedCases = 0;
      if (candidate.cases > 0 && candidate.resolutionKey) {
        if (bestClaimByResolution[candidate.resolutionKey] === candidate) {
          assignedCases = candidate.cases;
          matchedCaseKeys[candidate.resolutionKey] = candidate.cases;
        } else {
          duplicateMatchSuppressedRows += 1;
        }
      }
      var finalized = finalizeMetricRow(candidate.row, assignedCases);
      var dayKey = textKey(finalized.date_et);
      var shiftBucketKey = dayKey + "|" + textKey(finalized.shift_label, "Unassigned");
      if (dayKey && assignedCases > 0) {
        casesByResolvedDay[dayKey] = (casesByResolvedDay[dayKey] || 0) + assignedCases;
        casesByResolvedShift[shiftBucketKey] = (casesByResolvedShift[shiftBucketKey] || 0) + assignedCases;
      }
      return finalized;
    }).sort(function(a, b) { return b.labor_cost - a.labor_cost; });

    var byShift = Object.keys(byShiftMap).map(function(key) {
      return finalizeMetricRow(byShiftMap[key], toNum(casesByResolvedShift[key]));
    }).sort(function(a, b) {
      if (a.date_et !== b.date_et) return String(b.date_et || "").localeCompare(String(a.date_et || ""));
      return String(a.shift_label || "").localeCompare(String(b.shift_label || ""));
    });

    var byLine = Object.keys(byLineMap).map(function(key) {
      return finalizeMetricRow(byLineMap[key], toNum(casesByLine[key]));
    }).sort(function(a, b) { return b.labor_cost - a.labor_cost; });

    var byWorkOrder = Object.keys(byWoMap).map(function(key) {
      var row = byWoMap[key];
      var cases = toNum(casesByWo[textKey(row.work_order_code)]);
      return finalizeMetricRow(row, cases);
    }).sort(function(a, b) { return b.labor_cost - a.labor_cost; });

    var byRole = Object.keys(byRoleMap).map(function(key) {
      return finalizeMetricRow(byRoleMap[key], 0);
    }).sort(function(a, b) { return b.labor_cost - a.labor_cost; });

    var byDay = Object.keys(byDayMap).map(function(key) {
      return finalizeMetricRow(byDayMap[key], toNum(casesByResolvedDay[key]));
    }).sort(function(a, b) { return String(b.date_et || "").localeCompare(String(a.date_et || "")); });

    var matchedCases = Object.keys(matchedCaseKeys).reduce(function(sum, key) {
      return sum + toNum(matchedCaseKeys[key]);
    }, 0);

    var summaryFinal = finalizeMetricRow(summary, matchedCases);
    summaryFinal.total_production_cases = totalProductionCases;
    summaryFinal.matched_cases = matchedCases;
    summaryFinal.coverage_pct = totalProductionCases > 0 ? (matchedCases / totalProductionCases) : 0;
    summaryFinal.unique_job_count = Object.keys(summary.unique_jobs || {}).length;
    summaryFinal.unique_work_order_count = Object.keys(summary.unique_work_orders || {}).length;
    summaryFinal.inferred_job_timing_rows = inferredTimingRows;
    summaryFinal.cross_shift_job_rows = crossShiftTimingRows;
    summaryFinal.duplicate_match_suppressed_rows = duplicateMatchSuppressedRows;
    summaryFinal.labor_query_mode = laborQueryMode;
    summaryFinal.labor_rows_fetched = fetchedLaborRows.length;
    summaryFinal.labor_rows_in_range = rawLaborRowsInRange;
    summaryFinal.labor_segments_in_range = laborSegmentsInRange;
    summaryFinal.days_with_labor = byDay.length;
    summaryFinal.latest_date = byDay.length ? byDay[0].date_et : null;
    summaryFinal.today_et = todayEt;
    summaryFinal.finalized_through_date = finalizedThroughDate || null;
    summaryFinal.has_provisional_labor = summaryFinal.labor_status !== "finalized";
    delete summaryFinal.unique_jobs;
    delete summaryFinal.unique_work_orders;
    delete summaryFinal.availability_sum;
    delete summaryFinal.availability_weight;
    delete summaryFinal.performance_sum;
    delete summaryFinal.performance_weight;
    delete summaryFinal.line_efficiency_sum;
    delete summaryFinal.line_efficiency_weight;

    var responseBody = {
      status: "ok",
      productionStatus: productionStatus,
      range: { start: startDate, end: endDate },
      summary: summaryFinal,
      byDay: byDay,
      byShift: byShift,
      byLine: byLine,
      byRole: byRole,
      byWorkOrder: byWorkOrder,
      byJob: byJob.slice(0, 500)
    };
    if (summaryOnly) {
      responseBody.summaryOnly = true;
      responseBody.querySource = "labor_events_summary_fallback";
      responseBody.byRole = [];
      responseBody.byWorkOrder = [];
      responseBody.byJob = [];
    }
    return res.status(200).json(responseBody);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Labor actuals request failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
