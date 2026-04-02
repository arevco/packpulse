#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import {
  buildProductionDrivenDailyTargets,
  eachIsoDayBetween,
  isBusinessDay,
  monthRange,
  shiftIsoDay
} from "../../src/lib/dailyForecastTargets.js";
import { safeNum } from "../../src/utils.js";

var execFile = promisify(execFileCallback);
var DEFAULT_LOOKBACK_DAYS = 210;
var DEFAULT_MIN_HISTORY_DAYS = 56;
var DEFAULT_TIMESFM_CONTEXT_DAYS = 180;
var DEFAULT_WEEKDAY_HISTORY_DAYS = 56;
var DEFAULT_TIMESFM_SCRIPT = path.resolve("scripts/forecast/timesfm_runner.py");

async function main() {
  loadLocalEnv(process.cwd());
  var args = parseArgs(process.argv.slice(2));
  if (isTruthy(args.help)) {
    process.stdout.write(buildUsage());
    return;
  }

  var endDate = sanitizeIsoDate(args.end || args["end-date"]) || shiftIsoDay(todayEtDateKey(), -1);
  var startDate = sanitizeIsoDate(args.start || args["start-date"]) || shiftIsoDay(endDate, -DEFAULT_LOOKBACK_DAYS);
  if (!startDate || !endDate || endDate < startDate) {
    throw new Error("Provide --start YYYY-MM-DD and --end YYYY-MM-DD.");
  }

  var minHistoryDays = parsePositiveInt(args["min-history-days"], DEFAULT_MIN_HISTORY_DAYS);
  var weekdayHistoryDays = parsePositiveInt(args["weekday-history-days"], DEFAULT_WEEKDAY_HISTORY_DAYS);
  var contextDays = parsePositiveInt(args["timesfm-context-days"], DEFAULT_TIMESFM_CONTEXT_DAYS);
  var outputPath = resolveOptionalPath(args.output);
  var predictionsPath = resolveOptionalPath(args["predictions-output"]);
  var datasetPath = resolveOptionalPath(args["dataset-output"]);
  var timesfmEnabled = isTruthy(args.timesfm);
  var timesfmPython = String(args["timesfm-python"] || "python3").trim() || "python3";
  var timesfmScriptPath = path.resolve(String(args["timesfm-script"] || DEFAULT_TIMESFM_SCRIPT));

  var supabase = createSupabaseAdmin();
  var history = await fetchDailyHistory(supabase, startDate, endDate);
  var evaluation = await evaluateDailyForecastModels({
    rows: history.rows,
    dataSource: history.source,
    startDate: startDate,
    endDate: endDate,
    minHistoryDays: minHistoryDays,
    weekdayHistoryDays: weekdayHistoryDays,
    includePredictions: !!predictionsPath,
    timesfm: timesfmEnabled
      ? {
          pythonPath: timesfmPython,
          scriptPath: timesfmScriptPath,
          contextDays: contextDays
        }
      : null
  });

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(evaluation, null, 2) + "\n", "utf8");
  }
  if (predictionsPath) {
    await fs.mkdir(path.dirname(predictionsPath), { recursive: true });
    await fs.writeFile(predictionsPath, toPredictionCsv(evaluation.predictions || []), "utf8");
  }
  if (datasetPath) {
    await fs.mkdir(path.dirname(datasetPath), { recursive: true });
    await fs.writeFile(datasetPath, toDatasetCsv(history.rows || []), "utf8");
  }

  process.stdout.write(JSON.stringify(stripVerboseSections(evaluation), null, 2) + "\n");
}

function buildUsage() {
  return [
    "Usage:",
    "  npm run forecast:eval -- --start 2025-10-01 --end 2026-03-31 [--output /tmp/forecast-eval.json]",
    "",
    "Options:",
    "  --start YYYY-MM-DD",
    "  --end YYYY-MM-DD",
    "  --min-history-days N",
    "  --weekday-history-days N",
    "  --predictions-output /abs/or/relative/path.csv",
    "  --dataset-output /abs/or/relative/path.csv",
    "  --timesfm",
    "  --timesfm-python /path/to/python3.11",
    "  --timesfm-script scripts/forecast/timesfm_runner.py",
    "  --timesfm-context-days N",
    "  --output /abs/or/relative/path.json",
    ""
  ].join("\n");
}

function parseArgs(argv) {
  var args = {};
  for (var i = 0; i < argv.length; i += 1) {
    var token = argv[i];
    if (!token.startsWith("--")) continue;
    var key = token.slice(2);
    var next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function isTruthy(value) {
  return /^(1|true|yes|y|on)$/i.test(String(value || "").trim());
}

function sanitizeIsoDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parsePositiveInt(value, fallback) {
  var parsed = parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveOptionalPath(value) {
  var text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function loadLocalEnv(cwd) {
  var extraFiles = String(process.env.CODEX_ENV_FILES || "")
    .split(path.delimiter)
    .map(function(value) { return value.trim(); })
    .filter(Boolean);
  var files = extraFiles.concat([".env.local", ".env"]);
  files.forEach(function(fileName) {
    var fullPath = path.isAbsolute(fileName) ? fileName : path.join(cwd, fileName);
    try {
      var text = readFileSync(fullPath, "utf8");
      text.split(/\r?\n/).forEach(function(line) {
        var trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        var match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!match) return;
        var key = match[1];
        if (process.env[key]) return;
        var envValue = String(match[2] || "").replace(/^['"]|['"]$/g, "");
        process.env[key] = envValue;
      });
    } catch (error) {
      if (error && error.code === "ENOENT") return;
      throw error;
    }
  });
}

function createSupabaseAdmin() {
  var url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  var key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function todayEtDateKey() {
  var out = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).forEach(function(part) {
    if (part.type !== "literal") out[part.type] = part.value;
  });
  if (!out.year || !out.month || !out.day) return "";
  return out.year + "-" + out.month + "-" + out.day;
}

async function fetchAllRows(supabase, options) {
  var input = options || {};
  var table = String(input.table || "").trim();
  var select = String(input.select || "*");
  var dateField = String(input.dateField || "").trim();
  var startDate = sanitizeIsoDate(input.startDate);
  var endDate = sanitizeIsoDate(input.endDate);
  var pageSize = 1000;
  var from = 0;
  var out = [];
  while (true) {
    var to = from + pageSize - 1;
    var query = supabase
      .from(table)
      .select(select)
      .gte(dateField, startDate)
      .lte(dateField, endDate)
      .order(dateField, { ascending: true })
      .range(from, to);
    var result = await query;
    if (result.error) return { error: result.error, data: out };
    var rows = Array.isArray(result.data) ? result.data : [];
    out = out.concat(rows);
    if (rows.length < pageSize) break;
    from += pageSize;
    if (from > 500000) break;
  }
  return { error: null, data: out };
}

function isMissingRelationError(name, error) {
  var msg = String((error && (error.message || error.details || error.hint)) || "").toLowerCase();
  return msg.indexOf(String(name || "").toLowerCase()) !== -1 && (
    msg.indexOf("schema cache") !== -1 ||
    msg.indexOf("could not find the table") !== -1 ||
    msg.indexOf("relation") !== -1
  );
}

async function fetchDailyHistory(supabase, startDate, endDate) {
  var metricQ = await fetchAllRows(supabase, {
    table: "ops_daily_line_metrics_mv",
    select: "date_et,shift_label,line_name,production_rows,production_jobs,production_work_orders,produced_units",
    dateField: "date_et",
    startDate: startDate,
    endDate: endDate
  });
  if (!metricQ.error) {
    return {
      source: "ops_daily_line_metrics_mv",
      rows: aggregateMetricRows(metricQ.data || [])
    };
  }
  if (!isMissingRelationError("ops_daily_line_metrics_mv", metricQ.error)) throw metricQ.error;

  var eventQ = await fetchAllRows(supabase, {
    table: "production_events",
    select: "produced_date_et,shift_label,line,job_id,work_order_code,units_produced",
    dateField: "produced_date_et",
    startDate: startDate,
    endDate: endDate
  });
  if (eventQ.error) throw eventQ.error;
  return {
    source: "production_events",
    rows: aggregateEventRows(eventQ.data || [])
  };
}

function aggregateMetricRows(rows) {
  var byDay = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var date = sanitizeIsoDate(row && row.date_et);
    if (!date) return;
    if (!byDay[date]) {
      byDay[date] = {
        date: date,
        units: 0,
        production_rows: 0,
        production_jobs: 0,
        production_work_orders: 0,
        _lines: {},
        _shifts: {}
      };
    }
    var entry = byDay[date];
    entry.units += safeNum(row && row.produced_units);
    entry.production_rows += safeNum(row && row.production_rows);
    entry.production_jobs += safeNum(row && row.production_jobs);
    entry.production_work_orders += safeNum(row && row.production_work_orders);
    var line = String(row && row.line_name || "").trim();
    var shift = String(row && row.shift_label || "").trim();
    if (line) entry._lines[line] = true;
    if (shift) entry._shifts[shift] = true;
  });
  return Object.keys(byDay).sort().map(function(day) {
    return finalizeHistoryRow(byDay[day]);
  });
}

function aggregateEventRows(rows) {
  var byDay = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var date = sanitizeIsoDate(row && row.produced_date_et);
    if (!date) return;
    if (!byDay[date]) {
      byDay[date] = {
        date: date,
        units: 0,
        production_rows: 0,
        _jobs: {},
        _workOrders: {},
        _lines: {},
        _shifts: {}
      };
    }
    var entry = byDay[date];
    entry.units += safeNum(row && row.units_produced);
    entry.production_rows += 1;
    var jobId = String(row && row.job_id || "").trim();
    var workOrder = String(row && row.work_order_code || "").trim();
    var line = String(row && row.line || "").trim();
    var shift = String(row && row.shift_label || "").trim();
    if (jobId) entry._jobs[jobId] = true;
    if (workOrder) entry._workOrders[workOrder] = true;
    if (line) entry._lines[line] = true;
    if (shift) entry._shifts[shift] = true;
  });
  return Object.keys(byDay).sort().map(function(day) {
    var entry = byDay[day];
    entry.production_jobs = Object.keys(entry._jobs).length;
    entry.production_work_orders = Object.keys(entry._workOrders).length;
    return finalizeHistoryRow(entry);
  });
}

function finalizeHistoryRow(entry) {
  var date = String(entry && entry.date || "");
  var d = new Date(date + "T00:00:00Z");
  var weekday = isNaN(d) ? -1 : d.getUTCDay();
  return {
    date: date,
    month_key: date.slice(0, 7),
    units: safeNum(entry && entry.units),
    production_rows: safeNum(entry && entry.production_rows),
    production_jobs: safeNum(entry && entry.production_jobs),
    production_work_orders: safeNum(entry && entry.production_work_orders),
    line_count: Object.keys(entry && entry._lines || {}).length,
    shift_count: Object.keys(entry && entry._shifts || {}).length,
    weekday: weekday,
    is_business_day: isBusinessDay(date)
  };
}

async function evaluateDailyForecastModels(options) {
  var input = options || {};
  var rows = Array.isArray(input.rows) ? input.rows.slice().sort(function(a, b) {
    return String(a.date || "").localeCompare(String(b.date || ""));
  }) : [];
  var rowByDate = {};
  rows.forEach(function(row) {
    rowByDate[String(row && row.date || "")] = row;
  });

  var dataStart = rows.length ? String(rows[0].date || "") : "";
  var dataEnd = rows.length ? String(rows[rows.length - 1].date || "") : "";
  var evaluationMonths = collectCompleteMonths(rows, {
    coverageStart: input.startDate,
    coverageEnd: input.endDate,
    dataStart: dataStart,
    dataEnd: dataEnd
  });
  var predictions = [];
  var notes = [
    "Scaled models use actual completed-month totals as a proxy for the monthly forecast, so they measure daily shape quality rather than monthly total accuracy.",
    "The dataset includes production_jobs and production_work_orders from production history so future TimesFM/XReg tests can add operational covariates."
  ];

  var scorecards = {
    production_history: createScorecard({
      mode: "shape_only",
      description: "Current Forecast view allocator using a flat business-day baseline with bounded weekday adjustments."
    }),
    weekday_profile: createScorecard({
      mode: "shape_only",
      description: "Recent weekday production profile scaled to the remaining month total."
    }),
    business_day_flat: createScorecard({
      mode: "shape_only",
      description: "Even spread across remaining business days."
    })
  };

  var timesfmTasks = [];
  var timesfmMetaById = {};

  evaluationMonths.forEach(function(monthKey) {
    var range = monthRange(monthKey);
    var monthDays = eachIsoDayBetween(range.start, range.end);
    var monthTotalCases = monthDays.reduce(function(sum, day) {
      return sum + safeNum(rowByDate[day] && rowByDate[day].units);
    }, 0);
    if (!(monthTotalCases > 0)) return;

    monthDays.forEach(function(cutoffDate) {
      if (cutoffDate < input.startDate || cutoffDate > input.endDate) return;
      var historyRows = rows.filter(function(row) {
        return String(row && row.date || "") < cutoffDate;
      });
      if (historyRows.length < input.minHistoryDays) return;

      var futureDays = monthDays.filter(function(day) { return day >= cutoffDate; });
      if (!futureDays.length) return;

      var actualByDay = {};
      monthDays.forEach(function(day) {
        if (day >= cutoffDate) return;
        actualByDay[day] = {
          day_key: day,
          actual_cases: safeNum(rowByDate[day] && rowByDate[day].units)
        };
      });
      var fallbackRows = monthDays.map(function(day) {
        return {
          day_key: day,
          planned_cases: 0,
          revenue: 0,
          labor_cost: 0,
          headcount_hours: 0
        };
      });
      var summary = { total_cases: monthTotalCases };

      var currentModel = buildProductionDrivenDailyTargets({
        monthKey: monthKey,
        summary: summary,
        actualByDay: actualByDay,
        historyByDay: historyRows,
        fallbackRows: fallbackRows,
        productionStatus: {
          productionDate: cutoffDate,
          inProgress: true
        }
      });
      scoreForecastWindow({
        scorecard: scorecards.production_history,
        modelKey: "production_history",
        monthKey: monthKey,
        cutoffDate: cutoffDate,
        monthEnd: range.end,
        rows: currentModel.rows,
        actualRowsByDay: rowByDate,
        predictions: input.includePredictions ? predictions : null
      });

      var weekdayRows = buildWeekdayProfileTargets({
        monthKey: monthKey,
        totalCases: monthTotalCases,
        actualByDay: actualByDay,
        historyByDay: historyRows,
        planningStart: cutoffDate,
        historyWindowDays: input.weekdayHistoryDays
      });
      scoreForecastWindow({
        scorecard: scorecards.weekday_profile,
        modelKey: "weekday_profile",
        monthKey: monthKey,
        cutoffDate: cutoffDate,
        monthEnd: range.end,
        rows: weekdayRows,
        actualRowsByDay: rowByDate,
        predictions: input.includePredictions ? predictions : null
      });

      var flatRows = buildFlatBusinessDayTargets({
        monthKey: monthKey,
        totalCases: monthTotalCases,
        actualByDay: actualByDay,
        planningStart: cutoffDate
      });
      scoreForecastWindow({
        scorecard: scorecards.business_day_flat,
        modelKey: "business_day_flat",
        monthKey: monthKey,
        cutoffDate: cutoffDate,
        monthEnd: range.end,
        rows: flatRows,
        actualRowsByDay: rowByDate,
        predictions: input.includePredictions ? predictions : null
      });

      if (input.timesfm) {
        var taskId = monthKey + "::" + cutoffDate;
        timesfmMetaById[taskId] = {
          monthKey: monthKey,
          cutoffDate: cutoffDate,
          monthEnd: range.end,
          actualRowsByDay: rowByDate
        };
        timesfmTasks.push({
          id: taskId,
          horizon: futureDays.length,
          context: buildCalendarContext(rows, cutoffDate, input.timesfm.contextDays),
          futureDays: futureDays
        });
      }
    });
  });

  var timesfmStatus = {
    enabled: !!input.timesfm,
    attempted: false,
    completed: false,
    taskCount: timesfmTasks.length,
    runner: input.timesfm ? {
      pythonPath: input.timesfm.pythonPath,
      scriptPath: input.timesfm.scriptPath
    } : null
  };

  if (input.timesfm && timesfmTasks.length) {
    scorecards.timesfm_raw = createScorecard({
      mode: "raw_total_and_shape",
      description: "Unscaled TimesFM forecast over daily production cases."
    });
    scorecards.timesfm_scaled = createScorecard({
      mode: "shape_only",
      description: "TimesFM forecast scaled to the remaining month total for shape-only comparison."
    });
    timesfmStatus.attempted = true;
    try {
      var timesfmOutput = await runTimesFmTasks({
        tasks: timesfmTasks,
        pythonPath: input.timesfm.pythonPath,
        scriptPath: input.timesfm.scriptPath
      });
      timesfmStatus.completed = true;
      timesfmStatus.model = timesfmOutput.model || "";
      timesfmStatus.pythonVersion = timesfmOutput.python_version || "";
      timesfmStatus.taskCount = Array.isArray(timesfmOutput.predictions) ? timesfmOutput.predictions.length : 0;

      (Array.isArray(timesfmOutput.predictions) ? timesfmOutput.predictions : []).forEach(function(prediction) {
        var meta = timesfmMetaById[String(prediction && prediction.id || "")];
        if (!meta) return;
        var futureDays = Array.isArray(prediction && prediction.futureDays) ? prediction.futureDays : [];
        var rawPoint = Array.isArray(prediction && prediction.point) ? prediction.point : [];
        var rawRows = futureDays.map(function(day, index) {
          return {
            day_key: day,
            planned_cases: Math.max(0, safeNum(rawPoint[index]))
          };
        });
        scoreForecastWindow({
          scorecard: scorecards.timesfm_raw,
          modelKey: "timesfm_raw",
          monthKey: meta.monthKey,
          cutoffDate: meta.cutoffDate,
          monthEnd: meta.monthEnd,
          rows: rawRows,
          actualRowsByDay: meta.actualRowsByDay,
          predictions: input.includePredictions ? predictions : null
        });

        var actualRemainingTotal = futureDays.reduce(function(sum, day) {
          return sum + safeNum(meta.actualRowsByDay[day] && meta.actualRowsByDay[day].units);
        }, 0);
        var scaledRows = scaleFutureRowsToTotal(rawRows, actualRemainingTotal);
        scoreForecastWindow({
          scorecard: scorecards.timesfm_scaled,
          modelKey: "timesfm_scaled",
          monthKey: meta.monthKey,
          cutoffDate: meta.cutoffDate,
          monthEnd: meta.monthEnd,
          rows: scaledRows,
          actualRowsByDay: meta.actualRowsByDay,
          predictions: input.includePredictions ? predictions : null
        });
      });
    } catch (error) {
      timesfmStatus.error = error && error.message ? error.message : String(error);
      notes.push("TimesFM run skipped: " + timesfmStatus.error);
    }
  } else if (input.timesfm) {
    notes.push("TimesFM was requested, but there were no eligible backtest windows after history-coverage filters.");
  }

  var finalizedModels = {};
  Object.keys(scorecards).forEach(function(key) {
    finalizedModels[key] = finalizeScorecard(scorecards[key]);
  });

  return {
    generatedAt: new Date().toISOString(),
    dataSource: input.dataSource || "unknown",
    historyRange: {
      start: dataStart,
      end: dataEnd,
      days: rows.length
    },
    evaluationConfig: {
      startDate: input.startDate,
      endDate: input.endDate,
      minHistoryDays: input.minHistoryDays,
      weekdayHistoryDays: input.weekdayHistoryDays,
      timesfmEnabled: !!input.timesfm
    },
    evaluationMonths: evaluationMonths,
    models: finalizedModels,
    timesfm: timesfmStatus,
    notes: notes,
    predictions: input.includePredictions ? predictions : []
  };
}

function collectCompleteMonths(rows, options) {
  var input = options || {};
  var coverageStart = sanitizeIsoDate(input.coverageStart);
  var coverageEnd = sanitizeIsoDate(input.coverageEnd);
  var dataStart = sanitizeIsoDate(input.dataStart);
  var dataEnd = sanitizeIsoDate(input.dataEnd);
  var firstDataMonth = dataStart.slice(0, 7);
  var lastDataMonth = dataEnd.slice(0, 7);
  var seen = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var monthKey = String(row && row.month_key || row && row.date || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthKey)) return;
    var range = monthRange(monthKey);
    if (!range.start || !range.end) return;
    if (range.start < coverageStart || range.end > coverageEnd) return;
    if (monthKey === firstDataMonth && dataStart && dataStart > range.start) return;
    if (monthKey === lastDataMonth && dataEnd && dataEnd < range.end) return;
    seen[monthKey] = true;
  });
  return Object.keys(seen).sort();
}

function createScorecard(meta) {
  return {
    meta: meta || {},
    windows: 0,
    points: 0,
    actualTotal: 0,
    predictedTotal: 0,
    absErrorTotal: 0,
    squaredErrorTotal: 0,
    windowWapeTotal: 0,
    windowMaeTotal: 0,
    nextDayActualTotal: 0,
    nextDayAbsErrorTotal: 0,
    nextThreeDayActualTotal: 0,
    nextThreeDayAbsErrorTotal: 0
  };
}

function finalizeScorecard(scorecard) {
  return {
    mode: scorecard.meta.mode || "unknown",
    description: scorecard.meta.description || "",
    windows: scorecard.windows,
    points: scorecard.points,
    actualTotal: roundMetric(scorecard.actualTotal),
    predictedTotal: roundMetric(scorecard.predictedTotal),
    bias: roundMetric(scorecard.predictedTotal - scorecard.actualTotal),
    biasPct: roundMetric(ratio(scorecard.predictedTotal - scorecard.actualTotal, scorecard.actualTotal)),
    wape: roundMetric(ratio(scorecard.absErrorTotal, scorecard.actualTotal)),
    mae: roundMetric(ratio(scorecard.absErrorTotal, scorecard.points)),
    rmse: roundMetric(Math.sqrt(ratio(scorecard.squaredErrorTotal, scorecard.points))),
    meanWindowWape: roundMetric(ratio(scorecard.windowWapeTotal, scorecard.windows)),
    meanWindowMae: roundMetric(ratio(scorecard.windowMaeTotal, scorecard.windows)),
    nextDayWape: roundMetric(ratio(scorecard.nextDayAbsErrorTotal, scorecard.nextDayActualTotal)),
    nextThreeDayWape: roundMetric(ratio(scorecard.nextThreeDayAbsErrorTotal, scorecard.nextThreeDayActualTotal))
  };
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function roundMetric(value) {
  return Math.round(safeNum(value) * 1000000) / 1000000;
}

function scoreForecastWindow(options) {
  var input = options || {};
  var scorecard = input.scorecard;
  if (!scorecard) return;
  var rows = Array.isArray(input.rows) ? input.rows : [];
  var actualRowsByDay = input.actualRowsByDay && typeof input.actualRowsByDay === "object" ? input.actualRowsByDay : {};
  var futureRows = rows
    .filter(function(row) {
      var day = String(row && row.day_key || "");
      return day >= input.cutoffDate && day <= input.monthEnd;
    })
    .sort(function(a, b) {
      return String(a.day_key || "").localeCompare(String(b.day_key || ""));
    });
  if (!futureRows.length) return;

  var windowActual = 0;
  var windowAbs = 0;
  scorecard.windows += 1;
  futureRows.forEach(function(row, index) {
    var day = String(row && row.day_key || "");
    var predicted = safeNum(row && row.planned_cases);
    var actual = safeNum(actualRowsByDay[day] && actualRowsByDay[day].units);
    var absError = Math.abs(predicted - actual);
    scorecard.points += 1;
    scorecard.actualTotal += actual;
    scorecard.predictedTotal += predicted;
    scorecard.absErrorTotal += absError;
    scorecard.squaredErrorTotal += Math.pow(predicted - actual, 2);
    windowActual += actual;
    windowAbs += absError;
    if (index === 0) {
      scorecard.nextDayActualTotal += actual;
      scorecard.nextDayAbsErrorTotal += absError;
    }
    if (index < 3) {
      scorecard.nextThreeDayActualTotal += actual;
      scorecard.nextThreeDayAbsErrorTotal += absError;
    }
    if (input.predictions) {
      input.predictions.push({
        model: input.modelKey,
        month_key: input.monthKey,
        cutoff_date: input.cutoffDate,
        day_key: day,
        horizon_day: index + 1,
        predicted_cases: roundMetric(predicted),
        actual_cases: roundMetric(actual),
        abs_error: roundMetric(absError)
      });
    }
  });
  scorecard.windowWapeTotal += ratio(windowAbs, windowActual);
  scorecard.windowMaeTotal += ratio(windowAbs, futureRows.length);
}

function buildFlatBusinessDayTargets(options) {
  var input = options || {};
  var monthKey = String(input.monthKey || "").trim();
  var planningStart = sanitizeIsoDate(input.planningStart);
  return buildScaledTargets({
    monthKey: monthKey,
    totalCases: safeNum(input.totalCases),
    actualByDay: input.actualByDay,
    planningStart: planningStart,
    weightByDayBuilder: function(futureDays) {
      var out = {};
      var weightTotal = 0;
      futureDays.forEach(function(day) {
        var weight = isBusinessDay(day) ? 1 : 0;
        out[day] = weight;
        weightTotal += weight;
      });
      if (!(weightTotal > 0)) {
        futureDays.forEach(function(day) {
          out[day] = 1;
        });
      }
      return out;
    }
  });
}

function buildWeekdayProfileTargets(options) {
  var input = options || {};
  var historyByDay = Array.isArray(input.historyByDay) ? input.historyByDay : [];
  var planningStart = sanitizeIsoDate(input.planningStart);
  var recentRows = historyByDay
    .filter(function(row) {
      return safeNum(row && row.units) > 0 && String(row && row.date || "") < planningStart;
    })
    .slice(-Math.max(7, parsePositiveInt(input.historyWindowDays, DEFAULT_WEEKDAY_HISTORY_DAYS)));

  return buildScaledTargets({
    monthKey: input.monthKey,
    totalCases: safeNum(input.totalCases),
    actualByDay: input.actualByDay,
    planningStart: planningStart,
    weightByDayBuilder: function(futureDays) {
      var weekdayUnits = {};
      recentRows.forEach(function(row) {
        var day = String(row && row.date || "");
        var d = new Date(day + "T00:00:00Z");
        if (isNaN(d)) return;
        var dow = d.getUTCDay();
        if (!weekdayUnits[dow]) weekdayUnits[dow] = [];
        weekdayUnits[dow].push(safeNum(row.units));
      });
      var overallAverage = recentRows.length
        ? recentRows.reduce(function(sum, row) { return sum + safeNum(row.units); }, 0) / recentRows.length
        : 0;
      var hasSaturdayHistory = !!(weekdayUnits[6] && weekdayUnits[6].length);
      var out = {};
      futureDays.forEach(function(day) {
        var dow = new Date(day + "T00:00:00Z").getUTCDay();
        var samples = weekdayUnits[dow] || [];
        var weekdayAverage = samples.length
          ? samples.reduce(function(sum, units) { return sum + safeNum(units); }, 0) / samples.length
          : 0;
        var weight = weekdayAverage;
        if (!(weight > 0)) {
          if (dow === 6 && hasSaturdayHistory) weight = overallAverage * 0.2;
          else if (dow === 0) weight = 0;
          else if (isBusinessDay(day)) weight = overallAverage > 0 ? overallAverage : 1;
        }
        out[day] = weight;
      });
      return out;
    }
  });
}

function buildScaledTargets(options) {
  var input = options || {};
  var monthKey = String(input.monthKey || "").trim();
  var range = monthRange(monthKey);
  var allDays = eachIsoDayBetween(range.start, range.end);
  var planningStart = sanitizeIsoDate(input.planningStart) || range.start;
  var actualByDay = input.actualByDay && typeof input.actualByDay === "object" ? input.actualByDay : {};
  var actualLockedThrough = shiftIsoDay(planningStart, -1);
  var completedActualCases = 0;
  allDays.forEach(function(day) {
    if (day > actualLockedThrough) return;
    completedActualCases += safeNum(actualByDay[day] && actualByDay[day].actual_cases);
  });
  var remainingCases = Math.max(0, safeNum(input.totalCases) - completedActualCases);
  var futureDays = allDays.filter(function(day) { return day >= planningStart; });
  var weightByDay = typeof input.weightByDayBuilder === "function"
    ? input.weightByDayBuilder(futureDays)
    : {};
  var weightTotal = futureDays.reduce(function(sum, day) {
    return sum + Math.max(0, safeNum(weightByDay[day]));
  }, 0);
  if (!(weightTotal > 0)) {
    futureDays.forEach(function(day) {
      weightByDay[day] = 1;
    });
    weightTotal = futureDays.length;
  }
  return allDays.map(function(day) {
    if (day <= actualLockedThrough) {
      return {
        day_key: day,
        planned_cases: safeNum(actualByDay[day] && actualByDay[day].actual_cases)
      };
    }
    var weight = Math.max(0, safeNum(weightByDay[day]));
    return {
      day_key: day,
      planned_cases: weightTotal > 0 ? remainingCases * (weight / weightTotal) : 0
    };
  });
}

function buildCalendarContext(rows, cutoffDate, contextDays) {
  var startDate = shiftIsoDay(cutoffDate, -Math.max(1, contextDays));
  var dateMap = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    var day = String(row && row.date || "");
    if (!day) return;
    dateMap[day] = row;
  });
  return eachIsoDayBetween(startDate, shiftIsoDay(cutoffDate, -1)).map(function(day) {
    return safeNum(dateMap[day] && dateMap[day].units);
  });
}

async function runTimesFmTasks(options) {
  var input = options || {};
  var tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "timesfm-eval-"));
  var inputPath = path.join(tempDir, "input.json");
  var outputPath = path.join(tempDir, "output.json");
  var payload = {
    tasks: (Array.isArray(input.tasks) ? input.tasks : []).map(function(task) {
      return {
        id: task.id,
        horizon: task.horizon,
        context: task.context,
        futureDays: task.futureDays
      };
    })
  };
  try {
    await fs.writeFile(inputPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await execFile(input.pythonPath, [input.scriptPath, "--input", inputPath, "--output", outputPath], {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024
    });
    var text = await fs.readFile(outputPath, "utf8");
    var data = JSON.parse(text);
    if (data && data.error) throw new Error(String(data.error));
    return data || {};
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

function scaleFutureRowsToTotal(rows, totalTarget) {
  var inputRows = Array.isArray(rows) ? rows : [];
  var total = inputRows.reduce(function(sum, row) {
    return sum + Math.max(0, safeNum(row && row.planned_cases));
  }, 0);
  if (!(total > 0)) {
    var fallbackWeights = {};
    var futureDays = inputRows.map(function(row) { return String(row && row.day_key || ""); }).filter(Boolean);
    futureDays.forEach(function(day) {
      fallbackWeights[day] = isBusinessDay(day) ? 1 : 0;
    });
    var weightTotal = futureDays.reduce(function(sum, day) {
      return sum + safeNum(fallbackWeights[day]);
    }, 0);
    if (!(weightTotal > 0)) {
      futureDays.forEach(function(day) {
        fallbackWeights[day] = 1;
      });
      weightTotal = futureDays.length;
    }
    return inputRows.map(function(row) {
      var day = String(row && row.day_key || "");
      var weight = safeNum(fallbackWeights[day]);
      return {
        day_key: day,
        planned_cases: weightTotal > 0 ? safeNum(totalTarget) * (weight / weightTotal) : 0
      };
    });
  }
  return inputRows.map(function(row) {
    return {
      day_key: String(row && row.day_key || ""),
      planned_cases: Math.max(0, safeNum(row && row.planned_cases)) * (safeNum(totalTarget) / total)
    };
  });
}

function toPredictionCsv(rows) {
  var header = [
    "model",
    "month_key",
    "cutoff_date",
    "day_key",
    "horizon_day",
    "predicted_cases",
    "actual_cases",
    "abs_error"
  ];
  var lines = [header.join(",")];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    lines.push([
      csvCell(row.model),
      csvCell(row.month_key),
      csvCell(row.cutoff_date),
      csvCell(row.day_key),
      csvCell(row.horizon_day),
      csvCell(row.predicted_cases),
      csvCell(row.actual_cases),
      csvCell(row.abs_error)
    ].join(","));
  });
  return lines.join("\n") + "\n";
}

function toDatasetCsv(rows) {
  var header = [
    "date",
    "month_key",
    "weekday",
    "is_business_day",
    "units",
    "production_rows",
    "production_jobs",
    "production_work_orders",
    "line_count",
    "shift_count"
  ];
  var lines = [header.join(",")];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    lines.push([
      csvCell(row.date),
      csvCell(row.month_key),
      csvCell(row.weekday),
      csvCell(row.is_business_day ? 1 : 0),
      csvCell(roundMetric(row.units)),
      csvCell(roundMetric(row.production_rows)),
      csvCell(roundMetric(row.production_jobs)),
      csvCell(roundMetric(row.production_work_orders)),
      csvCell(roundMetric(row.line_count)),
      csvCell(roundMetric(row.shift_count))
    ].join(","));
  });
  return lines.join("\n") + "\n";
}

function csvCell(value) {
  var text = String(value == null ? "" : value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function stripVerboseSections(evaluation) {
  if (!evaluation || typeof evaluation !== "object") return evaluation;
  return {
    generatedAt: evaluation.generatedAt,
    dataSource: evaluation.dataSource,
    historyRange: evaluation.historyRange,
    evaluationConfig: evaluation.evaluationConfig,
    evaluationMonths: evaluation.evaluationMonths,
    models: evaluation.models,
    timesfm: evaluation.timesfm,
    notes: evaluation.notes
  };
}

main().catch(function(error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
});
