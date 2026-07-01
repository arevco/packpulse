import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toDateEt, toNum, withCors } from "./_common.js";
import { classifyShiftET, toEasternParts, toIso } from "../_labor.js";

var ET_TIME_ZONE = "America/New_York";
var MAX_PRODUCTION_WINDOW_MINUTES = 960;

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i++) {
    var target = String(keys[i]).toLowerCase();
    for (var j = 0; j < rowKeys.length; j++) {
      var rk = rowKeys[j];
      if (String(rk).toLowerCase() === target) return row[rk];
    }
  }
  var wanted = {};
  keys.forEach(function(k) {
    wanted[String(k || "").replace(/[^a-z0-9]/gi, "").toLowerCase()] = true;
  });
  for (var x = 0; x < rowKeys.length; x++) {
    var rowKey = rowKeys[x];
    var normalized = String(rowKey || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (wanted[normalized]) return row[rowKey];
  }
  return "";
}

function resolveProductionTiming(row) {
  var producedRaw = pickFieldLoose(row && row.raw, [
    "Produced date", "producedAt",
    "Produced At", "produced_at",
    "Actual Job End", "actual_job_end_at"
  ]);
  var producedIso = toIso(producedRaw);
  var eastern = toEasternParts(producedIso || producedRaw);
  return {
    date: eastern && eastern.dateKey ? eastern.dateKey : String(row && row.produced_date_et || ""),
    shift: eastern ? classifyShiftET(eastern) : String(row && row.shift_label || "Unassigned")
  };
}

function sanitizeIsoDate(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
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
  var match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  var year = parseInt(match[1], 10);
  var monthIndex = parseInt(match[2], 10) - 1;
  var day = parseInt(match[3], 10);
  var utcGuess = Date.UTC(year, monthIndex, day, hour24, minute || 0, second || 0);
  var offset = timeZoneOffsetMillis(new Date(utcGuess), ET_TIME_ZONE);
  var actual = utcGuess - offset;
  var resolvedOffset = timeZoneOffsetMillis(new Date(actual), ET_TIME_ZONE);
  if (resolvedOffset !== offset) actual = utcGuess - resolvedOffset;
  return new Date(actual);
}

function elapsedMinutesBetween(startUtc, endUtc) {
  var start = startUtc ? new Date(startUtc) : null;
  var end = endUtc ? new Date(endUtc) : null;
  if (!start || !end || isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function clampProductionMinutes(minutes) {
  var value = toNum(minutes);
  if (!(value > 0)) return 0;
  return Math.min(MAX_PRODUCTION_WINDOW_MINUTES, value);
}

function productionShiftWindowRange(dateKey, shiftLabel) {
  if (shiftLabel === "Shift 1 (7a-3p)") {
    return {
      start: easternWallClockToDate(dateKey, 7, 0, 0),
      end: easternWallClockToDate(dateKey, 15, 6, 0)
    };
  }
  if (shiftLabel === "Shift 2 (3p-11p)") {
    return {
      start: easternWallClockToDate(dateKey, 15, 6, 0),
      end: easternWallClockToDate(dateKey, 24, 0, 0)
    };
  }
  return null;
}

function actualWindowMinutesForShiftBucket(dateKey, shiftLabel, startUtc, endUtc) {
  var range = productionShiftWindowRange(dateKey, shiftLabel);
  var start = startUtc ? new Date(startUtc) : null;
  var end = endUtc ? new Date(endUtc) : null;
  if (!range || !range.start || !range.end || !start || !end || isNaN(start) || isNaN(end) || end <= start) return 0;
  var overlapStart = Math.max(start.getTime(), range.start.getTime());
  var overlapEnd = Math.min(end.getTime(), range.end.getTime());
  if (!(overlapEnd > overlapStart)) return 0;
  return clampProductionMinutes(Math.round((overlapEnd - overlapStart) / 60000));
}

function measureProductionWindow(startUtc, endUtc, firstProducedAtUtc, lastProducedAtUtc) {
  var actualElapsedMinutes = clampProductionMinutes(elapsedMinutesBetween(startUtc, endUtc));
  var observedElapsedMinutes = clampProductionMinutes(elapsedMinutesBetween(firstProducedAtUtc, lastProducedAtUtc));
  var hasActualWindow = actualElapsedMinutes > 0;
  var hasObservedSpan = !hasActualWindow && observedElapsedMinutes > 0;
  return {
    actualElapsedMinutes: actualElapsedMinutes,
    observedElapsedMinutes: observedElapsedMinutes,
    productionMinutes: hasActualWindow
      ? actualElapsedMinutes
      : (hasObservedSpan ? observedElapsedMinutes : 0),
    hasActualWindow: hasActualWindow,
    hasObservedSpan: hasObservedSpan,
    spanSource: hasActualWindow ? "actual_job_window" : (hasObservedSpan ? "observed_fg_output_span" : "unavailable")
  };
}

function productionJobKey(row) {
  var date = String(row && row.produced_date_et || "");
  var jobId = String(row && row.job_id || "").trim();
  var workOrder = String(row && row.work_order_code || "").trim();
  var line = String(row && row.line || "Unknown").trim() || "Unknown";
  var itemCode = String(row && row.item_code || "").trim();
  return [date, jobId, workOrder, line, itemCode].join("|");
}

function buildProductionSegmentsFromRowsLite(rowsLite) {
  var rows = Array.isArray(rowsLite) ? rowsLite : [];
  var byShiftDay = {};
  var byJob = {};
  var productionRunsByKey = {};
  var knownLinesByBaseJobKey = {};
  var totalRows = rows.length;
  var rowsWithShift = 0;

  rows.forEach(function(r) {
    var date = String(r && r.produced_date_et || "");
    var shift = String(r && r.shift_label || "Unassigned");
    var units = toNum(r && r.units_produced);
    if (!(units > 0) || !date) return;
    var jobId = String(r && r.job_id || "").trim() || "Unknown Job";
    var workOrder = String(r && r.work_order_code || "").trim();
    var itemCode = String(r && r.item_code || "").trim();
    var line = String(r && r.line || "Unknown").trim() || "Unknown";
    if (!line || line === "Unknown") return;
    var baseJobKey = [date, shift, jobId, workOrder, itemCode].join("|");
    if (!knownLinesByBaseJobKey[baseJobKey]) knownLinesByBaseJobKey[baseJobKey] = {};
    knownLinesByBaseJobKey[baseJobKey][line] = (knownLinesByBaseJobKey[baseJobKey][line] || 0) + units;
  });

  rows.forEach(function(r) {
    var date = String(r && r.produced_date_et || "");
    var shift = String(r && r.shift_label || "Unassigned");
    var units = toNum(r && r.units_produced);
    if (!(units > 0) || !date) return;
    rowsWithShift += 1;

    var shiftKey = date + "|" + shift;
    if (!byShiftDay[shiftKey]) byShiftDay[shiftKey] = { date: date, shift: shift, unitsProduced: 0, jobs: 0 };
    byShiftDay[shiftKey].unitsProduced += units;
    byShiftDay[shiftKey].jobs += 1;

    var jobId = String(r && r.job_id || "").trim() || "Unknown Job";
    var workOrder = String(r && r.work_order_code || "").trim();
    var itemCode = String(r && r.item_code || "").trim();
    var itemDesc = String(r && r.item_desc || "").trim();
    var rawLine = String(r && r.line || "Unknown").trim() || "Unknown";
    var baseJobKey = [date, shift, jobId, workOrder, itemCode].join("|");
    var knownLineMap = knownLinesByBaseJobKey[baseJobKey] || null;
    var knownLines = knownLineMap ? Object.keys(knownLineMap) : [];
    var line = rawLine;
    if ((!line || line === "Unknown") && knownLines.length === 1) {
      line = knownLines[0];
    }
    var producedAtUtc = String(r && r.produced_at_utc || "").trim();
    var jobStartAtUtc = String(r && r.job_start_at_utc || "").trim();
    var jobEndAtUtc = String(r && (r.job_end_at_utc || r.produced_at_utc) || "").trim();
    var runKey = productionJobKey({
      produced_date_et: date,
      job_id: jobId,
      work_order_code: workOrder,
      line: line,
      item_code: itemCode
    });
    if (!productionRunsByKey[runKey]) {
      productionRunsByKey[runKey] = {
        key: runKey,
        jobStartAtUtc: "",
        jobEndAtUtc: "",
        firstProducedAtUtc: "",
        lastProducedAtUtc: ""
      };
    }
    if (jobStartAtUtc && (!productionRunsByKey[runKey].jobStartAtUtc || jobStartAtUtc < productionRunsByKey[runKey].jobStartAtUtc)) {
      productionRunsByKey[runKey].jobStartAtUtc = jobStartAtUtc;
    }
    if (jobEndAtUtc && (!productionRunsByKey[runKey].jobEndAtUtc || jobEndAtUtc > productionRunsByKey[runKey].jobEndAtUtc)) {
      productionRunsByKey[runKey].jobEndAtUtc = jobEndAtUtc;
    }
    if (producedAtUtc && (!productionRunsByKey[runKey].firstProducedAtUtc || producedAtUtc < productionRunsByKey[runKey].firstProducedAtUtc)) {
      productionRunsByKey[runKey].firstProducedAtUtc = producedAtUtc;
    }
    if (producedAtUtc && (!productionRunsByKey[runKey].lastProducedAtUtc || producedAtUtc > productionRunsByKey[runKey].lastProducedAtUtc)) {
      productionRunsByKey[runKey].lastProducedAtUtc = producedAtUtc;
    }

    var jobKey = [date, shift, jobId, workOrder, line, itemCode].join("|");
    if (!byJob[jobKey]) {
      byJob[jobKey] = {
        date: date,
        shift: shift,
        jobId: jobId,
        workOrder: workOrder || "--",
        line: line,
        itemCode: itemCode || "--",
        itemDesc: itemDesc || "--",
        unitsProduced: 0,
        firstProducedAtUtc: "",
        lastProducedAtUtc: "",
        productionRunKey: runKey
      };
    }
    byJob[jobKey].unitsProduced += units;
    if (producedAtUtc && (!byJob[jobKey].firstProducedAtUtc || producedAtUtc < byJob[jobKey].firstProducedAtUtc)) byJob[jobKey].firstProducedAtUtc = producedAtUtc;
    if (producedAtUtc && (!byJob[jobKey].lastProducedAtUtc || producedAtUtc > byJob[jobKey].lastProducedAtUtc)) byJob[jobKey].lastProducedAtUtc = producedAtUtc;
    if ((!byJob[jobKey].itemDesc || byJob[jobKey].itemDesc === "--") && itemDesc) byJob[jobKey].itemDesc = itemDesc;
    if ((!byJob[jobKey].line || byJob[jobKey].line === "Unknown") && line) byJob[jobKey].line = line;
  });

  Object.keys(productionRunsByKey).forEach(function(key) {
    var run = productionRunsByKey[key];
    var measured = measureProductionWindow(run.jobStartAtUtc, run.jobEndAtUtc, run.firstProducedAtUtc, run.lastProducedAtUtc);
    productionRunsByKey[key] = Object.assign({}, run, measured);
  });

  return {
    shiftRows: Object.values(byShiftDay).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return String(a.shift || "").localeCompare(String(b.shift || ""));
    }),
    jobRows: Object.values(byJob).map(function(row) {
      var productionRun = productionRunsByKey[row.productionRunKey] || null;
      var actualBucketMinutes = productionRun && productionRun.hasActualWindow
        ? (
          row.shift === "Unassigned"
            ? toNum(productionRun.productionMinutes)
            : actualWindowMinutesForShiftBucket(row.date, row.shift, productionRun.jobStartAtUtc, productionRun.jobEndAtUtc)
        )
        : 0;
      var observedBucketMinutes = clampProductionMinutes(elapsedMinutesBetween(row.firstProducedAtUtc, row.lastProducedAtUtc));
      var hasActualBucketWindow = actualBucketMinutes > 0;
      var hasObservedBucketSpan = !hasActualBucketWindow && observedBucketMinutes > 0;
      var productionMinutes = hasActualBucketWindow
        ? actualBucketMinutes
        : (hasObservedBucketSpan ? observedBucketMinutes : 0);
      return Object.assign({}, row, {
        jobStartAtUtc: productionRun && productionRun.jobStartAtUtc ? productionRun.jobStartAtUtc : null,
        jobEndAtUtc: productionRun && productionRun.jobEndAtUtc ? productionRun.jobEndAtUtc : null,
        firstProducedAtUtc: row.firstProducedAtUtc || null,
        lastProducedAtUtc: row.lastProducedAtUtc || null,
        productionMinutes: productionMinutes,
        casesPerProductionMinute: productionMinutes > 0 ? (toNum(row.unitsProduced) / productionMinutes) : 0,
        productionMinutesSource: hasActualBucketWindow ? "actual_job_window" : (hasObservedBucketSpan ? "observed_fg_output_span" : "unavailable"),
        hasActualWindow: hasActualBucketWindow,
        hasObservedSpan: hasObservedBucketSpan
      });
    }).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return toNum(b.unitsProduced) - toNum(a.unitsProduced);
    }),
    totalRows: totalRows,
    rowsWithShift: rowsWithShift
  };
}

function resolveJobWindow(row) {
  var startRaw = pickFieldLoose(row && row.raw, [
    "Actual Job Start", "actual_job_start_at",
    "Actual Job Start At", "actualJobStartAt"
  ]);
  var endRaw = pickFieldLoose(row && row.raw, [
    "Actual Job End", "actual_job_end_at",
    "Actual Job End At", "actualJobEndAt",
    "Produced At", "produced_at"
  ]) || row && row.produced_at_utc;
  return {
    startAtUtc: toIso(startRaw),
    endAtUtc: toIso(endRaw)
  };
}

function isMissingDailyMetricsViewError(error) {
  var msg = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
  return msg.indexOf("ops_daily_line_metrics_mv") !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

async function fetchAllProductionRows(supabase, siteId, fromDate, toDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = supabase
      .from("production_events")
      .select("event_key,produced_at_utc,produced_date_et,shift_label,job_id,item_code,units_produced,line,work_order_code,raw")
      .eq("site_id", siteId)
      .gte("produced_date_et", fromDate)
      .order("produced_date_et", { ascending: false })
      .range(from, to);
    if (toDate) query = query.lte("produced_date_et", toDate);
    var q = await query;
    if (q.error) return { error: q.error, data: out };
    var rows = Array.isArray(q.data) ? q.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return { error: null, data: out };
}

async function fetchDailyMetricRows(supabase, siteId, fromDate, toDate) {
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = supabase
      .from("ops_daily_line_metrics_mv")
      .select("date_et,shift_label,line_name,produced_units,production_rows")
      .eq("site_id", siteId)
      .gte("date_et", fromDate)
      .order("date_et", { ascending: false })
      .range(from, to);
    if (toDate) query = query.lte("date_et", toDate);
    var q = await query;
    if (q.error) return { error: q.error, data: out };
    var rows = Array.isArray(q.data) ? q.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 200000) break;
  }
  return { error: null, data: out };
}

function buildSummaryPayloadFromMetricRows(rows, querySource) {
  var byDay = {};
  var byShift = {};
  var byLine = {};
  var byDateLine = {};
  var totalRows = 0;

  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var date = String(row && row.date_et || "");
    var shift = String(row && row.shift_label || "Unassigned");
    var line = String(row && row.line_name || "Unknown");
    var units = toNum(row && row.produced_units);
    var rowCount = toNum(row && row.production_rows);
    if (!date || !(units > 0)) return;

    totalRows += rowCount;
    if (!byDay[date]) byDay[date] = { date: date, units: 0, rows: 0 };
    byDay[date].units += units;
    byDay[date].rows += rowCount;

    var shiftKey = date + "|" + shift;
    if (!byShift[shiftKey]) byShift[shiftKey] = { date: date, shift: shift, units: 0, rows: 0 };
    byShift[shiftKey].units += units;
    byShift[shiftKey].rows += rowCount;

    if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
    byLine[line].units += units;
    byLine[line].rows += rowCount;

    if (!byDateLine[date]) byDateLine[date] = {};
    if (!byDateLine[date][line]) byDateLine[date][line] = { line: line, units: 0, rows: 0 };
    byDateLine[date][line].units += units;
    byDateLine[date][line].rows += rowCount;
  });

  var latestDate = Object.keys(byDateLine).sort().pop() || null;
  return {
    querySource: querySource || "ops_daily_line_metrics_mv",
    summaryOnly: true,
    totalRows: totalRows,
    rowsLite: [],
    byDay: Object.values(byDay).sort(function(a, b) { return String(b.date || "").localeCompare(String(a.date || "")); }),
    byShift: Object.values(byShift).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return String(a.shift || "").localeCompare(String(b.shift || ""));
    }),
    byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
    latestDate: latestDate,
    latestByLine: latestDate ? Object.values(byDateLine[latestDate]).sort(function(a, b) { return b.units - a.units; }) : []
  };
}

function buildDetailedPayloadFromRows(rows, querySource) {
  var bySku = {};
  var byLine = {};
  var byDate = {};
  var byDaySku = {};
  var byShift = {};
  var rowsLite = [];

  (Array.isArray(rows) ? rows : []).forEach(function(r) {
    const timing = resolveProductionTiming(r);
    const sku = String(r.item_code || "UNKNOWN");
    const units = toNum(r.units_produced);
    const line = String(r.line || "Unknown");
    const dateKey = String(timing.date || r.produced_date_et || "");
    if (!bySku[sku]) bySku[sku] = { item_code: sku, units: 0, rows: 0 };
    bySku[sku].units += units;
    bySku[sku].rows += 1;
    if (!byLine[line]) byLine[line] = { line: line, units: 0, rows: 0 };
    byLine[line].units += units;
    byLine[line].rows += 1;
    if (dateKey) {
      var shiftKey = dateKey + "|" + String(timing.shift || r.shift_label || "Unassigned");
      if (!byShift[shiftKey]) {
        byShift[shiftKey] = {
          date: dateKey,
          shift: String(timing.shift || r.shift_label || "Unassigned"),
          units: 0,
          rows: 0
        };
      }
      byShift[shiftKey].units += units;
      byShift[shiftKey].rows += 1;
      if (!byDate[dateKey]) byDate[dateKey] = {};
      if (!byDate[dateKey][line]) byDate[dateKey][line] = { line: line, units: 0, rows: 0 };
      byDate[dateKey][line].units += units;
      byDate[dateKey][line].rows += 1;
      if (!byDaySku[dateKey]) byDaySku[dateKey] = {};
      if (!byDaySku[dateKey][sku]) byDaySku[dateKey][sku] = { day_key: dateKey, item_code: sku, units: 0 };
      byDaySku[dateKey][sku].units += units;
    }
    var window = resolveJobWindow(r);
    var itemDesc = pickFieldLoose(r.raw, ["item_description", "Item Description", "Description", "description"]);
    rowsLite.push({
      produced_at_utc: r.produced_at_utc || null,
      produced_date_et: timing.date || r.produced_date_et || null,
      shift_label: timing.shift || r.shift_label || null,
      job_id: r.job_id || null,
      item_code: r.item_code || null,
      item_desc: itemDesc ? String(itemDesc) : null,
      units_produced: units,
      line: r.line || null,
      work_order_code: r.work_order_code || null,
      job_start_at_utc: window.startAtUtc || null,
      job_end_at_utc: window.endAtUtc || null
    });
  });

  const latestDate = Object.keys(byDate).sort().pop() || null;
  const latestByLine = latestDate ? Object.values(byDate[latestDate]).sort(function(a, b) { return b.units - a.units; }) : [];
  var productionSegments = buildProductionSegmentsFromRowsLite(rowsLite);

  return {
    querySource: querySource || "production_events",
    summaryOnly: false,
    totalRows: rows.length,
    rowsLite: rowsLite,
    byDay: Object.keys(byDate).sort().reverse().map(function(dateKey) {
      var lineMap = byDate[dateKey] || {};
      var totals = Object.values(lineMap).reduce(function(acc, row) {
        acc.units += toNum(row.units);
        acc.rows += toNum(row.rows);
        return acc;
      }, { date: dateKey, units: 0, rows: 0 });
      return totals;
    }),
    byShift: Object.values(byShift).sort(function(a, b) {
      if (a.date !== b.date) return String(b.date || "").localeCompare(String(a.date || ""));
      return String(a.shift || "").localeCompare(String(b.shift || ""));
    }),
    bySku: Object.values(bySku).sort(function(a, b) { return b.units - a.units; }).slice(0, 200),
    byLine: Object.values(byLine).sort(function(a, b) { return b.units - a.units; }),
    latestDate: latestDate,
    latestByLine: latestByLine,
    productionSegments: productionSegments,
    byDaySku: Object.keys(byDaySku).sort().reduce(function(out, dayKey) {
      return out.concat(Object.values(byDaySku[dayKey]).sort(function(a, b) {
        return b.units - a.units;
      }));
    }, [])
  };
}


export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();
    const summaryOnly = /^(1|true|yes)$/i.test(String((req.query && req.query.summary) || "").trim());

    const hasRange = !!(sanitizeIsoDate(req.query.start) && sanitizeIsoDate(req.query.end));
    const days = hasRange ? 0 : Math.max(1, Math.min(120, Number(req.query.days || 30)));
    const fromDate = hasRange ? sanitizeIsoDate(req.query.start) : toDateEt(days);
    const toDate = hasRange ? sanitizeIsoDate(req.query.end) : "";
    if (!fromDate || (hasRange && (!toDate || toDate < fromDate))) {
      return res.status(400).json({ error: "Invalid start/end date range" });
    }

    if (summaryOnly) {
      const summaryQ = await fetchDailyMetricRows(supabase, CACHE_SITE_ID, fromDate, toDate);
      if (!summaryQ.error) {
        const summaryPayload = buildSummaryPayloadFromMetricRows(summaryQ.data || [], "ops_daily_line_metrics_mv");
        return res.status(200).json(Object.assign({
          days: days,
          fromDate: fromDate,
          toDate: toDate || null
        }, summaryPayload));
      }
      if (!isMissingDailyMetricsViewError(summaryQ.error)) throw summaryQ.error;
    }

    const q = await fetchAllProductionRows(supabase, CACHE_SITE_ID, fromDate, toDate);
    if (q.error) throw q.error;
    const rows = Array.isArray(q.data) ? q.data : [];
    const payload = summaryOnly
      ? buildSummaryPayloadFromMetricRows(rows.map(function(r) {
          var timing = resolveProductionTiming(r);
          return {
            date_et: String(timing.date || r.produced_date_et || ""),
            shift_label: String(timing.shift || r.shift_label || "Unassigned"),
            line_name: String(r.line || "Unknown"),
            produced_units: toNum(r.units_produced),
            production_rows: 1
          };
        }), "production_events_fallback")
      : buildDetailedPayloadFromRows(rows, "production_events");

    return res.status(200).json(Object.assign({
      days: days,
      fromDate: fromDate,
      toDate: toDate || null
    }, payload));
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops production breakdown failed", details: err && err.message ? err.message : "unknown" });
  }
}
