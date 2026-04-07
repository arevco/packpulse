// POST /api/nulogy/create
// Creates a Nulogy report job with automatic column name discovery
// Body: { reportType: "inventory" | "workorders" | "bom" | "itemmaster" | "production" | "labor", syncProfile?: "full" | "recent_production" }

import Sentry from "../_sentry.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

function sanitizeIsoDate(value) {
  var text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function shiftIsoDateKey(dateKey, deltaDays) {
  var base = sanitizeIsoDate(dateKey);
  if (!base) return "";
  var d = new Date(base + "T12:00:00Z");
  if (isNaN(d)) return "";
  d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
  return d.toISOString().slice(0, 10);
}

function todayEtDateKey() {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date()).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

function formatNulogyBoundaryDateTime(dateKey) {
  var base = sanitizeIsoDate(dateKey);
  if (!base) return "";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var parts = base.split("-");
  var year = parts[0];
  var monthIndex = Number(parts[1]) - 1;
  var day = parts[2];
  if (!(monthIndex >= 0 && monthIndex < months.length)) return "";
  return year + "-" + months[monthIndex] + "-" + day + " 12:00 AM";
}

export function formatNulogyDateTime(date) {
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

function formatNulogyDate(date) {
  var d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

function missingRequiredColumns(config, columns) {
  var required = Array.isArray(config && config.requiredColumns) ? config.requiredColumns : [];
  return required.filter(function(col) {
    return columns.indexOf(col) === -1;
  });
}

export function buildProductionFilters(options) {
  var syncProfile = String(options && options.syncProfile || "full");
  var explicitStartDate = sanitizeIsoDate(options && options.startDate);
  var explicitEndDate = sanitizeIsoDate(options && options.endDate);
  if (explicitStartDate && explicitEndDate && explicitEndDate >= explicitStartDate) {
    var explicitEndExclusive = shiftIsoDateKey(explicitEndDate, 1) || explicitEndDate;
    return [
      {
        column: "produced_at",
        operator: "between",
        from_threshold: formatNulogyBoundaryDateTime(explicitStartDate),
        to_threshold: formatNulogyBoundaryDateTime(explicitEndExclusive)
      }
    ];
  }
  var shiftHours = Number(process.env.NULOGY_SHIFT_HOURS || 8);
  var shiftsPerDay = Number(process.env.NULOGY_SHIFTS_PER_DAY || 2);
  var lookbackShifts = Number(process.env.NULOGY_PRODUCTION_LOOKBACK_SHIFTS || 60);
  var fixedFromEnv = String(process.env.NULOGY_PRODUCTION_FROM_DATE || "").trim();
  var correctionDays = Number(process.env.PRODUCTION_EVENT_CORRECTION_DAYS || process.env.NULOGY_EVENT_CORRECTION_DAYS || 3);
  var explicitLookbackDays = Number(process.env.NULOGY_PRODUCTION_LOOKBACK_DAYS || 0);
  var recentProductionLookbackDays = Number(process.env.NULOGY_RECENT_PRODUCTION_LOOKBACK_DAYS || 3);
  var now = new Date();
  // Convert "shifts" to wall-clock hours using shifts/day.
  // Example: 60 shifts at 2 shifts/day => 30 calendar days => 720 hours.
  var hoursPerShiftWindow = (24 / Math.max(1, shiftsPerDay)) * Math.max(1, lookbackShifts);
  var lookbackHours = Math.max(1, shiftHours, hoursPerShiftWindow);
  if (syncProfile === "recent_production") {
    // Pull whole ET calendar days here. Rolling hour windows can truncate the
    // earliest day, and downstream correction writes replace whole date buckets.
    var recentWindowDays = Math.max(2, Math.round(recentProductionLookbackDays) + 1);
    var todayEt = todayEtDateKey();
    var recentStartDate = todayEt ? shiftIsoDateKey(todayEt, -(recentWindowDays - 1)) : "";
    var recentEndExclusive = todayEt ? shiftIsoDateKey(todayEt, 1) : "";
    if (recentStartDate && recentEndExclusive) {
      return [
        {
          column: "produced_at",
          operator: "between",
          from_threshold: formatNulogyBoundaryDateTime(recentStartDate),
          to_threshold: formatNulogyBoundaryDateTime(recentEndExclusive)
        }
      ];
    }
    lookbackHours = Math.max(shiftHours, Math.max(1, recentProductionLookbackDays) * 24);
  } else {
    if (explicitLookbackDays > 0) lookbackHours = Math.max(lookbackHours, explicitLookbackDays * 24);
    if (!(explicitLookbackDays > 0) && correctionDays > 0) lookbackHours = Math.max(lookbackHours, correctionDays * 24);
  }
  var from = new Date(now.getTime() - lookbackHours * 3600000);
  // Explicit env override still supports one-off historical backfills.
  if (fixedFromEnv && syncProfile !== "recent_production") {
    var fixedFrom = new Date(fixedFromEnv + "T00:00:00");
    if (!isNaN(fixedFrom)) from = fixedFrom;
  }
  // Date-only "between" filters can be interpreted as midnight boundaries by upstream APIs.
  // Query through tomorrow so today's intraday production is not dropped.
  var toInclusive = new Date(now);
  toInclusive.setDate(toInclusive.getDate() + 1);
  return [
    {
      // Pull on produced_at so "Today" includes in-flight production from open jobs.
      // Downstream logic still prefers actual_job_end_at when present for stable historical reporting.
      column: "produced_at",
      operator: "between",
      from_threshold: formatNulogyDateTime(from),
      to_threshold: formatNulogyDateTime(toInclusive)
    }
  ];
}

export function buildReceiveOrderFilters(options) {
  var filters = [
    {
      column: "received",
      operator: "=",
      threshold: "No"
    }
  ];
  var explicitStartDate = sanitizeIsoDate(options && options.startDate);
  var explicitEndDate = sanitizeIsoDate(options && options.endDate);
  if (explicitStartDate && explicitEndDate && explicitEndDate >= explicitStartDate) {
    var explicitEndExclusive = shiftIsoDateKey(explicitEndDate, 1) || explicitEndDate;
    filters.push({
      column: "expected_delivery_at",
      operator: "between",
      from_threshold: formatNulogyBoundaryDateTime(explicitStartDate),
      to_threshold: formatNulogyBoundaryDateTime(explicitEndExclusive)
    });
  }
  return filters;
}

// Column codes verified against actual REV Copack Nulogy instance
// CRITICAL: item_code is a FIXED FIELD on inventory_snapshot — always auto-included
// Do NOT pass it in the columns array or the API will reject the request
const REPORT_CONFIGS = {
  inventory: {
    report: "inventory_snapshot",
    requiredColumns: ["base_quantity"],
    columnSets: [
      // Try richer operational fields first. Costs are intentionally omitted because they
      // have been the most common cause of inventory column negotiation collapsing to the
      // bare minimum report payload.
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number", "location_name",
       "case_quantity", "case_unit_of_measure", "default_quantity", "default_unit_of_measure",
       "full_pallet_quantity", "full_pallet_unit_of_measure", "inventory_category",
       "item_category_name", "item_class", "item_type", "item_family_name",
       "is_finished_good", "item_alternate_code_1", "item_alternate_code_2", "item_gtin", "item_upc"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number", "storage_location_name",
       "case_quantity", "case_unit_of_measure", "default_quantity", "default_unit_of_measure",
       "full_pallet_quantity", "full_pallet_unit_of_measure", "inventory_category",
       "item_category_name", "item_class", "item_type", "item_family_name",
       "is_finished_good", "item_alternate_code_1", "item_alternate_code_2", "item_gtin", "item_upc"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number", "inventory_location",
       "case_quantity", "case_unit_of_measure", "default_quantity", "default_unit_of_measure",
       "full_pallet_quantity", "full_pallet_unit_of_measure", "inventory_category",
       "item_category_name", "item_class", "item_type", "item_family_name",
       "is_finished_good", "item_alternate_code_1", "item_alternate_code_2", "item_gtin", "item_upc"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number", "location",
       "case_quantity", "case_unit_of_measure", "default_quantity", "default_unit_of_measure",
       "full_pallet_quantity", "full_pallet_unit_of_measure", "inventory_category",
       "item_category_name", "item_class", "item_type", "item_family_name",
       "is_finished_good", "item_alternate_code_1", "item_alternate_code_2", "item_gtin", "item_upc"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number",
       "case_quantity", "case_unit_of_measure", "default_quantity", "default_unit_of_measure",
       "full_pallet_quantity", "full_pallet_unit_of_measure", "inventory_category",
       "item_category_name", "item_class", "item_type", "item_family_name",
       "is_finished_good", "item_alternate_code_1", "item_alternate_code_2", "item_gtin", "item_upc"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name", "pallet_number"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "customer_name"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date", "pallet_number"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "lot_code", "expiry_date"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status",
       "customer_name"],
      ["item_description", "base_quantity", "base_unit_of_measure", "inventory_status"],
      ["item_description", "base_quantity"],
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
      ["code", "description", "customer", "is_subcomponent", "is_finished_good", "item_type", "item_category", "inactive", "cost_per_unit", "unit_purchase_price", "upc", "gtin", "alternate_code_1", "alternate_code_2"],
      ["code", "description", "customer", "is_subcomponent", "is_finished_good", "item_type", "item_category", "inactive", "cost_per_unit"],
      // Keep a cost-bearing fallback before any no-cost fallback to avoid zero-cost UI when optional fields are unsupported.
      ["code", "description", "cost_per_unit", "inactive"],
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
  receiveorders: {
    report: "receive_order",
    requestBody: {
      filter_choice: "item_customer",
      order_by: "receive_order_id",
      order_direction: "desc"
    },
    requiredColumns: ["receive_order_code", "item_code", "expected_unit_quantity"],
    columnSets: [
      [
        "actual_ship_at", "actual_unit_quantity", "carrier_name", "expected_delivery_at", "expected_ship_at",
        "expected_unit_quantity", "internal_notes", "item_alternate_code_2", "item_alternate_code_1",
        "item_category_name", "item_class", "item_code", "item_customer", "item_description",
        "item_family_name", "item_gtin", "item_material_cost_per_unit", "item_type_name", "item_upc",
        "purchase_price_per_unit", "number_of_receipts", "purchaser", "receive_order_code",
        "receive_order_customer", "received", "reference", "ro_date_at", "site_name", "status",
        "unit_of_measure", "vendor_name", "vendor_notes", "project_code"
      ],
      [
        "actual_ship_at", "actual_unit_quantity", "expected_delivery_at", "expected_ship_at",
        "expected_unit_quantity", "item_category_name", "item_code", "item_customer",
        "item_description", "receive_order_code", "receive_order_customer", "received",
        "reference", "ro_date_at", "site_name", "status", "unit_of_measure", "vendor_name",
        "project_code"
      ],
      ["receive_order_code", "item_code", "item_customer", "item_description", "expected_unit_quantity",
       "unit_of_measure", "expected_delivery_at", "expected_ship_at", "actual_ship_at", "reference",
       "vendor_name", "received", "status", "site_name", "project_code", "ro_date_at"],
      ["receive_order_code", "item_code", "item_description", "expected_unit_quantity", "unit_of_measure",
       "expected_delivery_at", "reference", "vendor_name", "received", "status", "project_code", "ro_date_at"],
      ["receive_order_code", "item_code", "expected_unit_quantity", "unit_of_measure",
       "expected_delivery_at", "reference", "vendor_name", "received", "status", "ro_date_at"],
      ["receive_order_code", "item_code", "expected_unit_quantity", "unit_of_measure",
       "expected_delivery_at", "expected_ship_at", "actual_ship_at", "received", "status"],
      ["receive_order_code", "item_code", "expected_unit_quantity", "expected_delivery_at", "expected_ship_at", "ro_date_at"],
      ["receive_order_code", "item_code", "expected_unit_quantity"]
    ],
    filters: buildReceiveOrderFilters
  },
  production: {
    report: "production",
    requiredColumns: ["produced_at", "job_id", "units_produced"],
    columnSets: [
      ["produced_at", "actual_job_start_at", "actual_job_end_at", "job_id", "project_code", "item_code", "item_description",
       "project_id", "customer_name", "lot_code", "line", "units_produced", "project_status", "purchase_order_number", "reference_1", "unit_of_measure"],
      ["produced_at", "actual_job_start_at", "actual_job_end_at", "job_id", "project_code", "item_code",
       "project_id", "customer_name", "lot_code", "units_produced", "line", "purchase_order_number", "reference_1", "unit_of_measure"],
      ["produced_at", "job_id", "project_code", "item_code", "item_description",
       "project_id", "customer_name", "lot_code", "line", "units_produced", "project_status", "purchase_order_number", "reference_1", "unit_of_measure"],
      ["produced_at", "job_id", "project_code", "item_code",
       "project_id", "customer_name", "lot_code", "units_produced", "line", "purchase_order_number", "reference_1", "unit_of_measure"],
      ["produced_at", "job_id", "units_produced"]
    ],
    filters: buildProductionFilters
  },
  labor: {
    report: "labor",
    columnSets: [
      ["worked_date", "work_date", "shift_label", "shift",
       "clock_in_time", "clock_out_time", "clock_in_at", "clock_out_at", "clocked_in_at", "clocked_out_at", "started_at", "ended_at",
       "duration", "badge_type_name", "badge_type_prefix", "badge_type_rate",
       "job_id", "project_code", "work_order_id", "item_code", "item_description", "item_family_name",
       "line_name", "line_leader_name", "payable_hours", "productive_hours", "availability", "performance", "line_efficiency"],
      ["worked_date", "work_date", "shift_label", "shift",
       "clock_in_time", "clock_out_time", "clock_in_at", "clock_out_at", "clocked_in_at", "clocked_out_at", "started_at", "ended_at",
       "badge_type_name", "badge_type_rate", "job_id", "project_code",
       "item_code", "item_description", "line_name", "payable_hours", "productive_hours", "availability", "performance"],
      ["worked_date", "shift_label", "line_name", "job_id", "project_code", "item_code", "item_description", "badge_type_name", "badge_type_rate", "payable_hours", "productive_hours"]
    ]
  }
};

export async function createReportTask(options) {
  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;
  const siteUuid = String(options && options.siteUuid || process.env.NULOGY_SITE_UUID || "").trim();

  if (!user || !pass) {
    return { statusCode: 500, body: { error: "Nulogy credentials not configured." } };
  }

  const reportType = String(options && options.reportType || "").trim();
  const config = REPORT_CONFIGS[reportType];

  if (!config) {
    return {
      statusCode: 400,
      body: { error: `Invalid report type: ${reportType}. Use: inventory, workorders, itemmaster, bom, receiveorders, production, or labor` }
    };
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const errors = [];
  const filterOptions = Object.assign(
    {
      syncProfile: options && options.syncProfile ? options.syncProfile : "full"
    },
    options && options.filterOptions && typeof options.filterOptions === "object" ? options.filterOptions : {}
  );
  if (options && options.startDate && !filterOptions.startDate) filterOptions.startDate = options.startDate;
  if (options && options.endDate && !filterOptions.endDate) filterOptions.endDate = options.endDate;
  const hasOverrideFilters = !!(options && Object.prototype.hasOwnProperty.call(options, "filters"));
  const overrideFilters = hasOverrideFilters ? options.filters : null;

  for (let attempt = 0; attempt < config.columnSets.length; attempt++) {
    const columns = config.columnSets[attempt];

    const body = Object.assign({
      report: config.report,
      columns: columns,
      locale: "en_US"
    }, config.requestBody || {});
    if (hasOverrideFilters) {
      body.filters = overrideFilters;
    } else if (config.filters) {
      body.filters = typeof config.filters === "function" ? config.filters(filterOptions) : config.filters;
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
        return { statusCode: 401, body: { error: "Invalid Nulogy credentials." } };
      }
      if (response.status === 403) {
        return { statusCode: 403, body: { error: "Nulogy credentials lack permissions." } };
      }

      if (response.ok || response.status === 201) {
        var missingRequired = missingRequiredColumns(config, columns);
        if (missingRequired.length) {
          errors.push({
            attempt: attempt + 1,
            columns: columns,
            error: "Successful report omitted required columns: " + missingRequired.join(", ")
          });
          continue;
        }
        const statusUrl = response.headers.get("location") || response.headers.get("Location");
        const responseBody = await response.json().catch(() => ({}));
        const taskId = responseBody.task_id;
        const finalStatusUrl = statusUrl || responseBody.status_url || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

        return {
          statusCode: 201,
          body: {
            taskId,
            statusUrl: finalStatusUrl,
            reportType,
            nulogyReport: config.report,
            columnsUsed: columns,
            attempt: attempt + 1,
            totalColumns: columns.length
          }
        };
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

        if (reportType === "labor" || (Array.isArray(config.requiredColumns) && config.requiredColumns.length)) {
          var missing = parseMissingColumns(errorText);
          if (missing.length) {
            var missingLookup = {};
            missing.forEach(function(col) { missingLookup[String(col || "").trim()] = true; });
            var prunedColumns = columns.filter(function(col) {
              return !missingLookup[String(col || "").trim()];
            });
            var prunedMissingRequired = missingRequiredColumns(config, prunedColumns);
            if (prunedColumns.length > 0 && prunedColumns.length < columns.length && prunedMissingRequired.length === 0) {
              const prunedBody = Object.assign({
                report: config.report,
                columns: prunedColumns,
                locale: "en_US"
              }, config.requestBody || {});
              if (hasOverrideFilters) {
                prunedBody.filters = overrideFilters;
              } else if (config.filters) {
                prunedBody.filters = typeof config.filters === "function" ? config.filters(filterOptions) : config.filters;
              }
              if (siteUuid) prunedBody.site_uuid = siteUuid;

              const prunedRes = await fetch(`${NULOGY_URL}/api/reports/report_runs`, {
                method: "POST",
                headers: {
                  "Authorization": `Basic ${auth}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify(prunedBody)
              });

              if (prunedRes.ok || prunedRes.status === 201) {
                const statusUrl = prunedRes.headers.get("location") || prunedRes.headers.get("Location");
                const prunedResponseBody = await prunedRes.json().catch(() => ({}));
                const taskId = prunedResponseBody.task_id;
                const finalStatusUrl = statusUrl || prunedResponseBody.status_url || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

                return {
                  statusCode: 201,
                  body: {
                    taskId,
                    statusUrl: finalStatusUrl,
                    reportType,
                    nulogyReport: config.report,
                    columnsUsed: prunedColumns,
                    attempt: attempt + 1,
                    note: reportType === "labor" ? "auto-pruned unsupported labor columns" : "auto-pruned unsupported columns",
                    totalColumns: prunedColumns.length
                  }
                };
              }
            }
          }
        }

        // If error is about filters, retry without them
        if (errorText.includes("filter") && config.filters) {
          const bodyNoFilter = Object.assign({ report: config.report, columns: columns, locale: "en_US" }, config.requestBody || {});
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
            var retryMissingRequired = missingRequiredColumns(config, columns);
            if (retryMissingRequired.length) {
              errors.push({
                attempt: attempt + 1,
                columns: columns,
                error: "Successful report without filters omitted required columns: " + retryMissingRequired.join(", ")
              });
              continue;
            }
            const statusUrl = retryRes.headers.get("location") || retryRes.headers.get("Location");
            const retryBody = await retryRes.json().catch(() => ({}));
            const taskId = retryBody.task_id;
            const finalStatusUrl = statusUrl || retryBody.status_url || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

            return {
              statusCode: 201,
              body: {
                taskId,
                statusUrl: finalStatusUrl,
                reportType,
                nulogyReport: config.report,
                columnsUsed: columns,
                attempt: attempt + 1,
                note: "filters removed",
                totalColumns: columns.length
              }
            };
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

  return {
    statusCode: 400,
    body: {
      error: reportType === "production"
        ? "Could not create a production report with the minimum required production columns."
        : "Could not find valid column names for this Nulogy report.",
      reportType,
      nulogyReport: config.report,
      totalAttempts: errors.length,
      attempts: errors
    }
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const result = await createReportTask(req.body || {});
  return res.status(result.statusCode).json(result.body);
}
