// GET /api/nulogy/itemmaster-full
// Runs a full Item Master export from Nulogy and returns CSV as a downloadable file.

import Sentry from "../_sentry.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 90;

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function defaultFileName() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return "nulogy_item_master_full_" + y + "-" + m + "-" + day + ".csv";
}

async function createReportRun(auth, siteUuid, columnsMaybe) {
  var body = {
    report: "item_master",
    locale: "en_US"
  };
  // Some tenants may support "all/default fields" when columns are omitted.
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = process.env.NULOGY_USER;
    var pass = process.env.NULOGY_PASS;
    var siteUuid = process.env.NULOGY_SITE_UUID;
    if (!user || !pass) return res.status(500).json({ error: "Nulogy credentials not configured." });

    var auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");

    // Attempt order:
    // 1) Omit columns to request the default/full dataset supported by tenant.
    // 2) Fallback to broad explicit columns list.
    var columnSets = [
      null,
      [
        "id", "item_id", "code", "description", "customer", "customer_name",
        "is_subcomponent", "is_finished_good", "item_type", "item_category",
        "item_family_name", "inactive", "cost_per_unit", "cost_per_base_unit",
        "unit_cost", "standard_cost", "average_cost", "unit_purchase_price",
        "upc", "gtin", "alternate_code_1", "alternate_code_2"
      ],
      ["code", "description", "cost_per_unit", "unit_cost", "standard_cost", "inactive"]
    ];

    var createAttempts = [];
    var statusUrl = "";
    for (var i = 0; i < columnSets.length; i++) {
      var cols = columnSets[i];
      var created = await createReportRun(auth, siteUuid, cols);
      createAttempts.push({
        attempt: i + 1,
        status: created.status,
        usedColumns: cols && cols.length ? cols : "(omitted)",
        error: created.ok ? "" : created.text.slice(0, 300)
      });
      if (!created.ok) continue;
      var loc = created.headers.get("location") || created.headers.get("Location");
      var taskId = created.payload && created.payload.task_id ? created.payload.task_id : "";
      statusUrl = loc || (taskId ? (NULOGY_URL + "/api/reports/report_runs/" + taskId) : "");
      if (statusUrl) break;
    }

    if (!statusUrl) {
      return res.status(400).json({
        error: "Could not start item_master report.",
        attempts: createAttempts
      });
    }

    var completed = await pollToCompleted(auth, statusUrl);
    if (!completed.ok) {
      return res.status(502).json({
        error: completed.error,
        statusUrl: statusUrl,
        attempts: createAttempts
      });
    }

    var csvRes = await fetch(completed.downloadUrl, { headers: { "Authorization": auth } });
    var csv = await csvRes.text();
    if (!csvRes.ok) {
      return res.status(502).json({ error: "Failed to download CSV: " + csv.slice(0, 300) });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="' + defaultFileName() + '"');
    return res.status(200).send(csv);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: err && err.message ? err.message : "Unexpected error" });
  }
}

