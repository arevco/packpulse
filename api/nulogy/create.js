// POST /api/nulogy/create
// Creates a Nulogy report job with automatic column name discovery
// Body: { reportType: "inventory" | "workorders" | "bom" | "itemmaster" | "production" }

import Sentry from "../_sentry.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

function formatNulogyDateTime(date) {
  var d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var year = d.getFullYear();
  var month = months[d.getMonth()];
  var day = String(d.getDate()).padStart(2, "0");
  var hour24 = d.getHours();
  var minute = String(d.getMinutes()).padStart(2, "0");
  var ampm = hour24 >= 12 ? "PM" : "AM";
  var hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${year}-${month}-${day} ${hour12}:${minute} ${ampm}`;
}

function buildProductionFilters() {
  var shiftHours = Number(process.env.NULOGY_SHIFT_HOURS || 8);
  var lookbackShifts = Number(process.env.NULOGY_PRODUCTION_LOOKBACK_SHIFTS || 60);
  var now = new Date();
  var from = new Date(now.getTime() - Math.max(1, shiftHours) * Math.max(1, lookbackShifts) * 3600000);
  return [
    {
      column: "produced_at",
      operator: "between",
      from_threshold: formatNulogyDateTime(from),
      to_threshold: formatNulogyDateTime(now)
    }
  ];
}

// Column codes verified against actual REV Copack Nulogy instance
// CRITICAL: item_code is a FIXED FIELD on inventory_snapshot — always auto-included
// Do NOT pass it in the columns array or the API will reject the request
const REPORT_CONFIGS = {
  inventory: {
    report: "inventory_snapshot",
    columnSets: [
      // Attempt 1: Full data fields (item_code is auto-included as fixed field)
      ["item_description", "base_quantity", "base_unit_of_measure",
       "inventory_status", "lot_code", "expiry_date", "customer_name",
       "item_category_name", "item_type", "item_family_name", "is_finished_good",
       "pallet_number"],
      // Attempt 2: Core fields only
      ["item_description", "base_quantity", "base_unit_of_measure",
       "inventory_status"],
      // Attempt 3: Minimum with description
      ["item_description", "base_quantity"],
      // Attempt 4: Absolute minimum
      ["base_quantity"]
    ]
  },
  workorders: {
    report: "project_status",
    columnSets: [
      ["project_code", "item_code", "item_description", "customer_name",
       "units_expected", "units_produced", "units_remaining", "due_date_at",
       "project_status", "standard_units_per_hour", "standard_people",
       "planned_start_at", "planned_end_at", "reference_1",
       "purchase_order_number"],
      ["project_code", "item_code", "item_description", "customer_name",
       "units_expected", "units_produced", "units_remaining", "due_date_at",
       "project_status"],
      ["project_code", "item_code", "units_expected", "project_status"]
    ],
    filters: [
      {
        column: "project_status",
        operator: "!=",
        threshold: "Cancelled"
      }
    ]
  },
  itemmaster: {
    report: "item_master",
    columnSets: [
      ["code", "description", "is_subcomponent", "is_finished_good", "item_type", "item_category", "inactive", "customer"],
      ["code", "description", "is_subcomponent", "is_finished_good", "inactive"],
      ["code", "description", "inactive"],
      ["code", "description"],
      ["code"]
    ]
  },
  bom: {
    report: "bom",
    columnSets: [
      ["finished_good_code", "subcomponent_code", "subcomponent_description",
       "subcomponent_unit_quantity", "subcomponent_uom", "substitute_for", "priority", "version_name"],
      ["finished_good_code", "subcomponent_code", "subcomponent_name",
       "subcomponent_unit_quantity", "subcomponent_uom", "substitute_for", "priority"],
      ["finished_good_code", "subcomponent_code", "material_description",
       "subcomponent_unit_quantity", "substitute_for", "priority"],
      ["finished_good_code", "subcomponent_code", "subcomponent_unit_quantity",
       "subcomponent_uom", "substitute_for", "priority"],
      ["finished_good_code", "subcomponent_code", "subcomponent_unit_quantity",
       "substitute_for", "priority", "version_name"],
      ["finished_good_code", "subcomponent_code", "subcomponent_unit_quantity"]
    ]
  },
  production: {
    report: "production",
    columnSets: [
      ["produced_at", "job_id", "project_code", "item_code", "item_description",
       "line", "units_produced", "project_status", "purchase_order_number"],
      ["produced_at", "job_id", "project_code", "item_code", "units_produced", "line"],
      ["produced_at", "job_id", "units_produced"]
    ],
    filters: buildProductionFilters
  }
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;
  const siteUuid = process.env.NULOGY_SITE_UUID;

  if (!user || !pass) {
    return res.status(500).json({ error: "Nulogy credentials not configured." });
  }

  const { reportType } = req.body || {};
  const config = REPORT_CONFIGS[reportType];

  if (!config) {
    return res.status(400).json({ error: `Invalid report type: ${reportType}. Use: inventory, workorders, itemmaster, bom, or production` });
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const errors = [];

  for (let attempt = 0; attempt < config.columnSets.length; attempt++) {
    const columns = config.columnSets[attempt];

    const body = {
      report: config.report,
      columns: columns,
      locale: "en_US"
    };
    if (config.filters) {
      body.filters = typeof config.filters === "function" ? config.filters() : config.filters;
    }
    if (siteUuid) body.site_uuid = siteUuid;

    try {
      const response = await fetch(`${NULOGY_URL}/api/reports/report_runs`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${auth}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (response.status === 401) {
        return res.status(401).json({ error: "Invalid Nulogy credentials." });
      }
      if (response.status === 403) {
        return res.status(403).json({ error: "Nulogy credentials lack permissions." });
      }

      if (response.ok || response.status === 201) {
        const statusUrl = response.headers.get("location") || response.headers.get("Location");
        const responseBody = await response.json().catch(() => ({}));
        const taskId = responseBody.task_id;
        const finalStatusUrl = statusUrl || responseBody.status_url || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

        return res.status(201).json({
          taskId,
          statusUrl: finalStatusUrl,
          reportType,
          nulogyReport: config.report,
          columnsUsed: columns,
          attempt: attempt + 1,
          totalColumns: columns.length
        });
      }

      // 400 = bad request
      if (response.status === 400) {
        let errorText = "";
        try { errorText = await response.text(); } catch(e) { errorText = "Could not read error"; }
        errors.push({
          attempt: attempt + 1,
          columns: columns,
          status: response.status,
          nulogyError: errorText
        });

        // If error is about filters, retry without them
        if (errorText.includes("filter") && config.filters) {
          const bodyNoFilter = { report: config.report, columns: columns, locale: "en_US" };
          if (siteUuid) bodyNoFilter.site_uuid = siteUuid;

          const retryRes = await fetch(`${NULOGY_URL}/api/reports/report_runs`, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${auth}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(bodyNoFilter)
          });

          if (retryRes.ok || retryRes.status === 201) {
            const statusUrl = retryRes.headers.get("location") || retryRes.headers.get("Location");
            const retryBody = await retryRes.json().catch(() => ({}));
            const taskId = retryBody.task_id;
            const finalStatusUrl = statusUrl || retryBody.status_url || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

            return res.status(201).json({
              taskId,
              statusUrl: finalStatusUrl,
              reportType,
              nulogyReport: config.report,
              columnsUsed: columns,
              attempt: attempt + 1,
              note: "filters removed",
              totalColumns: columns.length
            });
          }
        }

        continue;
      }

      const text = await response.text();
      errors.push({ attempt: attempt + 1, status: response.status, nulogyError: text });
      continue;

    } catch (err) {
      Sentry.captureException(err);
      errors.push({ attempt: attempt + 1, error: err.message });
      continue;
    }
  }

  return res.status(400).json({
    error: "Could not find valid column names for this Nulogy report.",
    reportType,
    nulogyReport: config.report,
    totalAttempts: errors.length,
    attempts: errors
  });
}
