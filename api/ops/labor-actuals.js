import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";
import { normalizeLaborRoleKey } from "../_labor.js";

function sanitizeDate(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function sanitizeMonthKey(value) {
  var s = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
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

function isMissingTableError(tableName, err) {
  var msg = String((err && (err.message || err.details || err.hint)) || "").toLowerCase();
  return msg.indexOf(String(tableName || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
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
    var laborQueryMode = "worked_date";
    var laborQ = await fetchAllRows(
      supabase,
      "labor_events",
      "worked_date_et,source_snapshot_at,shift_label,line_name,job_id,work_order_code,work_order_id,item_code,item_description,item_family_name,role_name,role_key,payable_hours,productive_hours,hourly_rate,availability_pct,performance_pct,line_efficiency_pct",
      "worked_date_et",
      startDate,
      endDate
    );
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
    var laborRows = Array.isArray(laborQ.data) ? laborQ.data : [];
    if (!laborRows.length) {
      laborQueryMode = "all_rows_fallback";
      var laborAllQ = await fetchAllRows(
        supabase,
        "labor_events",
        "worked_date_et,source_snapshot_at,shift_label,line_name,job_id,work_order_code,work_order_id,item_code,item_description,item_family_name,role_name,role_key,payable_hours,productive_hours,hourly_rate,availability_pct,performance_pct,line_efficiency_pct",
        "source_snapshot_at",
        "",
        ""
      );
      if (laborAllQ.error) {
        throw laborAllQ.error;
      }
      laborRows = Array.isArray(laborAllQ.data) ? laborAllQ.data : [];
    }

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
    var laborRowsInRange = 0;

    laborRows.forEach(function(r) {
      var jobId = textKey(r.job_id);
      var line = textKey(r.line_name, "Unknown");
      var timing = finalizeTimingBucket(jobTimingByJobLine[jobId + "|" + line]) || finalizeTimingBucket(jobTimingByJob[jobId]);
      var date = textKey((timing && timing.date) || r.worked_date_et);
      if (!date) {
        var fallbackDate = textKey(r.source_snapshot_at).slice(0, 10);
        if (sanitizeDate(fallbackDate)) date = fallbackDate;
      }
      if (!dateInRange(date, startDate, endDate)) return;
      laborRowsInRange += 1;
      var shift = textKey((timing && timing.shift) || r.shift_label, "Unassigned");
      if (timing && timing.date && timing.date !== textKey(r.worked_date_et)) inferredTimingRows += 1;
      if (timing && timing.shift === "Cross-Shift Job") crossShiftTimingRows += 1;
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
    var byJob = Object.keys(byJobMap).map(function(key) {
      var row = byJobMap[key];
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
      if (cases > 0 && resolutionKey) matchedCaseKeys[resolutionKey] = cases;
      var finalized = finalizeMetricRow(row, cases);
      var dayKey = textKey(finalized.date_et);
      var shiftBucketKey = dayKey + "|" + textKey(finalized.shift_label, "Unassigned");
      if (dayKey && cases > 0) {
        casesByResolvedDay[dayKey] = (casesByResolvedDay[dayKey] || 0) + cases;
        casesByResolvedShift[shiftBucketKey] = (casesByResolvedShift[shiftBucketKey] || 0) + cases;
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
    summaryFinal.labor_query_mode = laborQueryMode;
    summaryFinal.labor_rows_fetched = laborRows.length;
    summaryFinal.labor_rows_in_range = laborRowsInRange;
    summaryFinal.days_with_labor = byDay.length;
    summaryFinal.latest_date = byDay.length ? byDay[0].date_et : null;
    delete summaryFinal.unique_jobs;
    delete summaryFinal.unique_work_orders;
    delete summaryFinal.availability_sum;
    delete summaryFinal.availability_weight;
    delete summaryFinal.performance_sum;
    delete summaryFinal.performance_weight;
    delete summaryFinal.line_efficiency_sum;
    delete summaryFinal.line_efficiency_weight;

    return res.status(200).json({
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
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Labor actuals request failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
