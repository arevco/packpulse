// GET /api/nulogy/labor-full
// Tries likely Nulogy labor report names/column sets and returns either a CSV
// download or JSON diagnostics with headers + sample rows.

import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "../ops/_common.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 90;
const STATUS_WINDOW_POLLS = 3;

function sleep(ms) {
  return new Promise(function(resolve) { return setTimeout(resolve, ms); });
}

function defaultFileName() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return "nulogy_labor_report_" + y + "-" + m + "-" + day + ".csv";
}

function getReportCandidates(req) {
  var explicit = String(req.query.report || process.env.NULOGY_LABOR_REPORT_NAME || "").trim();
  if (explicit) return [explicit];
  return [
    "labor_report",
    "labor",
    "job_labor",
    "labor_by_job",
    "labour_report",
    "labour"
  ];
}

function getColumnSets() {
  return [
    [],
    [
      "availability", "badge_code", "badge_type_name", "badge_type_prefix", "badge_type_rate",
      "clock_in_time", "clock_out_time", "duration",
      "item_alternate_code_1", "item_alternate_code_2", "item_category_name",
      "item_code", "item_customer_name", "item_description", "item_family_name",
      "item_gtin", "item_type", "item_upc",
      "job_id", "job_reference", "line_efficiency", "line_leader_name", "line_name",
      "payable_hours", "performance", "productive_hours", "site_name",
      "project_code", "work_order_id",
      "work_order_reference_1", "work_order_reference_2", "work_order_reference_3",
      "work_order_reference_4", "work_order_reference_5"
    ],
    [
      "clock_in_time", "clock_out_time", "badge_code", "badge_type_name", "badge_type_rate",
      "job_id", "line_name", "payable_hours", "productive_hours", "performance",
      "line_efficiency", "project_code", "item_code", "item_description"
    ],
    [
      "line_name", "job_id", "project_code", "item_code", "item_description",
      "badge_code", "badge_type_name", "badge_type_rate", "payable_hours", "productive_hours"
    ]
  ];
}

async function createReportRun(auth, siteUuid, reportName, columnsMaybe) {
  var body = {
    report: reportName,
    locale: "en_US"
  };
  if (Array.isArray(columnsMaybe) && columnsMaybe.length) body.columns = columnsMaybe;
  if (siteUuid) body.site_uuid = siteUuid;

  var res = await fetch(NULOGY_URL + "/api/reports/report_runs", {
    method: "POST",
    headers: {
      "Authorization": auth,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  var text = await res.text();
  var payload = {};
  try { payload = JSON.parse(text); } catch (e) { payload = { raw: text }; }
  return { ok: res.ok || res.status === 201, status: res.status, payload: payload, text: text, headers: res.headers };
}

function parseMissingColumns(errorText) {
  var text = String(errorText || "");
  var m = text.match(/The following columns do not exist:\s*([^.\]]+)/i);
  if (!m || !m[1]) return [];
  return m[1]
    .split(",")
    .map(function(s) { return s.replace(/[\[\]"]/g, "").trim(); })
    .filter(Boolean);
}

async function pollToCompleted(auth, statusUrl) {
  for (var i = 0; i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL_MS);
    var res = await fetch(statusUrl, { headers: { "Authorization": auth } });
    var text = await res.text();
    var payload = {};
    try { payload = JSON.parse(text); } catch (e) { payload = {}; }
    if (!res.ok) {
      return { ok: false, error: "Status poll failed (" + res.status + "): " + text.slice(0, 300) };
    }
    if (payload.status === "COMPLETED" && payload.download_url) {
      return { ok: true, downloadUrl: payload.download_url, payload: payload };
    }
    if (payload.status === "FAILED" || payload.status === "ERROR") {
      return { ok: false, error: "Nulogy report failed: " + text.slice(0, 300) };
    }
  }
  return { ok: false, error: "Timed out waiting for Nulogy report completion." };
}

async function pollForWindow(auth, statusUrl, maxPolls) {
  for (var i = 0; i < Math.max(1, maxPolls || 1); i++) {
    await sleep(POLL_INTERVAL_MS);
    var res = await fetch(statusUrl, { headers: { "Authorization": auth } });
    var text = await res.text();
    var payload = {};
    try { payload = JSON.parse(text); } catch (e) { payload = {}; }
    if (!res.ok) {
      return { ok: false, error: "Status poll failed (" + res.status + "): " + text.slice(0, 300) };
    }
    if (payload.status === "COMPLETED" && payload.download_url) {
      return { ok: true, status: "COMPLETED", downloadUrl: payload.download_url, payload: payload };
    }
    if (payload.status === "FAILED" || payload.status === "ERROR") {
      return { ok: false, error: "Nulogy report failed: " + text.slice(0, 300), status: payload.status };
    }
    if (i === maxPolls - 1) {
      return { ok: true, status: payload.status || "PENDING", payload: payload };
    }
  }
  return { ok: true, status: "PENDING", payload: {} };
}

function parseCSV(text) {
  var lines = String(text || "").split("\n");
  if (lines.length < 2) return [];
  var headers = parseCSVLine(lines[0]);
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var values = parseCSVLine(line);
    var row = {};
    headers.forEach(function(h, idx) {
      row[h] = idx < values.length ? values[idx] : "";
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  var result = [];
  var current = "";
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function isSafeNulogyUrl(url) {
  var value = String(url || "").trim();
  if (!value) return false;
  return value.indexOf(NULOGY_URL + "/") === 0;
}

function getOrigin(req) {
  var proto = req.headers["x-forwarded-proto"] || "https";
  var host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return proto + "://" + host;
}

function buildSelfUrl(req, params) {
  var usp = new URLSearchParams();
  Object.keys(params || {}).forEach(function(key) {
    var value = params[key];
    if (value == null || value === "") return;
    usp.set(key, String(value));
  });
  return getOrigin(req) + "/api/nulogy/labor-full" + (usp.toString() ? ("?" + usp.toString()) : "");
}

async function downloadLaborResult(auth, downloadUrl, req, reportName, columnsUsed, createAttempts) {
  if (!isSafeNulogyUrl(downloadUrl)) {
    return {
      statusCode: 400,
      body: { error: "Unsafe or invalid Nulogy download URL." }
    };
  }
  var csvRes = await fetch(downloadUrl, { headers: { "Authorization": auth } });
  var csv = await csvRes.text();
  if (!csvRes.ok) {
    return {
      statusCode: 502,
      body: { error: "Failed to download CSV: " + csv.slice(0, 300) }
    };
  }

  var format = String(req.query.format || "").trim().toLowerCase();
  if (format === "csv" || String(req.query.download || "") === "1") {
    return {
      statusCode: 200,
      csv: csv
    };
  }

  var rows = parseCSV(csv);
  return {
    statusCode: 200,
    body: {
      ok: true,
      stage: "completed",
      report: reportName || "",
      columnsUsed: columnsUsed || [],
      rowCount: rows.length,
      columns: rows.length ? Object.keys(rows[0]) : [],
      sampleRows: rows.slice(0, 10),
      downloadUrl: buildSelfUrl(req, {
        mode: "download",
        downloadUrl: downloadUrl,
        report: reportName || "",
        columnsUsed: Array.isArray(columnsUsed) && columnsUsed.length ? JSON.stringify(columnsUsed) : ""
      }),
      attempts: createAttempts || []
    }
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var nulogyUser = process.env.NULOGY_USER;
    var pass = process.env.NULOGY_PASS;
    var siteUuid = process.env.NULOGY_SITE_UUID;
    if (!nulogyUser || !pass) return res.status(500).json({ error: "Nulogy credentials not configured." });

    var auth = "Basic " + Buffer.from(nulogyUser + ":" + pass).toString("base64");
    var mode = String(req.query.mode || "").trim().toLowerCase();
    var existingStatusUrl = String(req.query.statusUrl || "").trim();
    var existingDownloadUrl = String(req.query.downloadUrl || "").trim();
    var existingReport = String(req.query.report || "").trim();
    var existingColumnsUsed = [];
    if (req.query.columnsUsed) {
      try { existingColumnsUsed = JSON.parse(String(req.query.columnsUsed)); } catch (e) { existingColumnsUsed = []; }
    }

    if (mode === "download" || existingDownloadUrl) {
      var dl = await downloadLaborResult(auth, existingDownloadUrl, req, existingReport, existingColumnsUsed, []);
      if (dl.csv != null) {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="' + defaultFileName() + '"');
        return res.status(dl.statusCode).send(dl.csv);
      }
      return res.status(dl.statusCode).json(dl.body);
    }

    if (mode === "status" || existingStatusUrl) {
      if (!isSafeNulogyUrl(existingStatusUrl)) {
        return res.status(400).json({ error: "Unsafe or invalid Nulogy status URL." });
      }
      var statusResult = await pollForWindow(auth, existingStatusUrl, STATUS_WINDOW_POLLS);
      if (!statusResult.ok) {
        return res.status(502).json({
          error: statusResult.error,
          report: existingReport || "",
          columnsUsed: existingColumnsUsed
        });
      }
      if (statusResult.status === "COMPLETED" && statusResult.downloadUrl) {
        var complete = await downloadLaborResult(auth, statusResult.downloadUrl, req, existingReport, existingColumnsUsed, []);
        if (complete.csv != null) {
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", 'attachment; filename="' + defaultFileName() + '"');
          return res.status(complete.statusCode).send(complete.csv);
        }
        return res.status(complete.statusCode).json(complete.body);
      }
      return res.status(202).json({
        ok: true,
        stage: "pending",
        report: existingReport || "",
        columnsUsed: existingColumnsUsed,
        status: statusResult.status || "PENDING",
        statusUrl: buildSelfUrl(req, {
          mode: "status",
          statusUrl: existingStatusUrl,
          report: existingReport || "",
          columnsUsed: Array.isArray(existingColumnsUsed) && existingColumnsUsed.length ? JSON.stringify(existingColumnsUsed) : ""
        }),
        note: "Nulogy labor report is still generating. Poll the status URL again."
      });
    }

    var reportCandidates = getReportCandidates(req);
    var columnSets = getColumnSets();
    var createAttempts = [];
    var started = null;

    for (var r = 0; r < reportCandidates.length && !started; r++) {
      var reportName = reportCandidates[r];
      for (var i = 0; i < columnSets.length && !started; i++) {
        var cols = columnSets[i];
        var created = await createReportRun(auth, siteUuid, reportName, cols);
        createAttempts.push({
          report: reportName,
          attempt: i + 1,
          status: created.status,
          usedColumns: Array.isArray(cols) && cols.length ? cols : "(omitted)",
          error: created.ok ? "" : created.text.slice(0, 300)
        });

        if (!created.ok) {
          if (created.status === 400 && Array.isArray(cols) && cols.length) {
            var missing = parseMissingColumns(created.text);
            if (missing.length) {
              var reduced = cols.filter(function(c) { return missing.indexOf(c) === -1; });
              if (reduced.length && reduced.length < cols.length) {
                var createdReduced = await createReportRun(auth, siteUuid, reportName, reduced);
                createAttempts.push({
                  report: reportName,
                  attempt: i + 1,
                  status: createdReduced.status,
                  usedColumns: reduced,
                  error: createdReduced.ok ? "" : createdReduced.text.slice(0, 300),
                  note: "auto-pruned unsupported columns"
                });
                if (createdReduced.ok) {
                  var locReduced = createdReduced.headers.get("location") || createdReduced.headers.get("Location");
                  var taskIdReduced = createdReduced.payload && createdReduced.payload.task_id ? createdReduced.payload.task_id : "";
                  started = {
                    report: reportName,
                    columnsUsed: reduced,
                    statusUrl: locReduced || (taskIdReduced ? (NULOGY_URL + "/api/reports/report_runs/" + taskIdReduced) : "")
                  };
                }
              }
            }
          }
          continue;
        }

        var loc = created.headers.get("location") || created.headers.get("Location");
        var taskId = created.payload && created.payload.task_id ? created.payload.task_id : "";
        started = {
          report: reportName,
          columnsUsed: cols,
          statusUrl: loc || (taskId ? (NULOGY_URL + "/api/reports/report_runs/" + taskId) : "")
        };
      }
    }

    if (!started || !started.statusUrl) {
      return res.status(400).json({
        error: "Could not start a Nulogy labor report.",
        reportCandidates: reportCandidates,
        attempts: createAttempts
      });
    }

    return res.status(202).json({
      ok: true,
      stage: "started",
      report: started.report,
      columnsUsed: started.columnsUsed,
      statusUrl: buildSelfUrl(req, {
        mode: "status",
        statusUrl: started.statusUrl,
        report: started.report,
        columnsUsed: Array.isArray(started.columnsUsed) && started.columnsUsed.length ? JSON.stringify(started.columnsUsed) : ""
      }),
      attempts: createAttempts,
      note: "Nulogy labor report started. Poll the returned statusUrl to continue."
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: err && err.message ? err.message : "Unexpected error" });
  }
}
