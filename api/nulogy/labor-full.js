// GET /api/nulogy/labor-full
// Tries likely Nulogy labor report names/column sets and returns either a CSV
// download or JSON diagnostics with headers + sample rows.

import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "../ops/_common.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 90;

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
      "date", "date_at", "shift", "shift_label", "line", "line_name",
      "job_id", "project_code", "item_code", "item_description",
      "role", "role_name", "user_name", "employee_name",
      "hours_worked", "hours_run", "labor_hours", "labor_minutes",
      "labor_count", "operator_count", "fork_count", "qa_count", "maint_count", "recycling_count"
    ],
    [
      "date", "shift", "line", "job_id", "project_code", "item_code", "role", "hours_worked"
    ],
    [
      "date", "line", "shift", "labor_count"
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

    var completed = await pollToCompleted(auth, started.statusUrl);
    if (!completed.ok) {
      return res.status(502).json({
        error: completed.error,
        report: started.report,
        columnsUsed: started.columnsUsed,
        statusUrl: started.statusUrl,
        attempts: createAttempts
      });
    }

    var csvRes = await fetch(completed.downloadUrl, { headers: { "Authorization": auth } });
    var csv = await csvRes.text();
    if (!csvRes.ok) {
      return res.status(502).json({ error: "Failed to download CSV: " + csv.slice(0, 300) });
    }

    var format = String(req.query.format || "").trim().toLowerCase();
    if (format === "csv" || String(req.query.download || "") === "1") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="' + defaultFileName() + '"');
      return res.status(200).send(csv);
    }

    var rows = parseCSV(csv);
    return res.status(200).json({
      ok: true,
      report: started.report,
      columnsUsed: started.columnsUsed,
      rowCount: rows.length,
      columns: rows.length ? Object.keys(rows[0]) : [],
      sampleRows: rows.slice(0, 10),
      attempts: createAttempts
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: err && err.message ? err.message : "Unexpected error" });
  }
}
