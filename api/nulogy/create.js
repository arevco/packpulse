// POST /api/nulogy/create
// Creates a Nulogy report job with automatic column name discovery
// Body: { reportType: "inventory" | "workorders" | "bom" }

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

// Strategy: try column codes first, then column labels, then minimal set
const REPORT_CONFIGS = {
  inventory: {
    report: "inventory_snapshot",
    columnSets: [
      // Attempt 1: REV Copack actual Nulogy column names
      ["Item", "Item description", "UOM", "Good", "Quarantined", "Rejected", "Unavailable"],
      // Attempt 2: Column codes from API docs
      ["item_code", "item_description", "base_quantity", "base_unit_of_measure",
       "lot_code", "expiry_date", "item_category_name", "item_type",
       "inventory_status", "inventory_category", "item_family_name"],
      // Attempt 3: Column labels (Title Case)
      ["Item Code", "Item Description", "Base Quantity", "Base Unit Of Measure",
       "Lot Code", "Expiry Date", "Item Category Name", "Item Type",
       "Inventory Status", "Inventory Category", "Item Family Name"],
      // Attempt 4: Minimal set with codes
      ["item_code", "item_description", "base_quantity"],
      // Attempt 5: Minimal set with labels
      ["Item Code", "Item Description", "Base Quantity"],
      // Attempt 6: Try common alternative names
      ["material", "description", "quantity"],
      ["Material", "Description", "Quantity"],
      ["sku", "description", "qty_on_hand"],
      ["SKU", "Description", "Qty On Hand"]
    ]
  },
  workorders: {
    report: "project_status",
    columnSets: [
      // Attempt 1: Column codes
      ["project_code", "item_code", "item_description", "customer_name",
       "units_expected", "units_produced", "units_remaining", "due_date_at",
       "project_status", "standard_units_per_hour", "standard_people",
       "planned_start_at", "planned_end_at", "reference_1",
       "purchase_order_number"],
      // Attempt 2: Column labels
      ["Project Code", "Item Code", "Item Description", "Customer Name",
       "Units Expected", "Units Produced", "Units Remaining", "Due Date At",
       "Project Status", "Standard Units Per Hour", "Standard People",
       "Planned Start At", "Planned End At", "Reference 1",
       "Purchase Order Number"],
      // Attempt 3: Minimal codes
      ["project_code", "item_code", "units_expected", "project_status"],
      // Attempt 4: Minimal labels
      ["Project Code", "Item Code", "Units Expected", "Project Status"]
    ],
    filters: [
      {
        column: "project_status",
        operator: "!=",
        threshold: "Cancelled"
      }
    ],
    filtersAlt: [
      {
        column: "Project Status",
        operator: "!=",
        threshold: "Cancelled"
      }
    ]
  },
  bom: {
    report: "bom",
    columnSets: [
      // Attempt 1: Column codes
      ["finished_good_code", "subcomponent_code", "subcomponent_unit_quantity",
       "subcomponent_uom", "substitute_for", "priority", "version_name"],
      // Attempt 2: Column labels
      ["Finished Good Code", "Subcomponent Code", "Subcomponent Quantity",
       "Subcomponent Unit Of Measure", "Substitute For", "Priority", "Version Name"],
      // Attempt 3: Minimal codes
      ["finished_good_code", "subcomponent_code", "subcomponent_unit_quantity"],
      // Attempt 4: Minimal labels
      ["Finished Good Code", "Subcomponent Code", "Subcomponent Quantity"]
    ]
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
    return res.status(400).json({ error: `Invalid report type: ${reportType}. Use: inventory, workorders, or bom` });
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const errors = [];

  // Try each column set until one works
  for (let attempt = 0; attempt < config.columnSets.length; attempt++) {
    const columns = config.columnSets[attempt];

    // Use alternate filters for label-based attempts (odd indexes)
    const useAltFilters = attempt % 2 === 1;
    const filters = useAltFilters && config.filtersAlt ? config.filtersAlt : config.filters;

    const body = {
      report: config.report,
      columns: columns,
      locale: "en_US"
    };
    if (filters) body.filters = filters;
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
        // Success! Get the status URL
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
          attempt: attempt + 1
        });
      }

      // 400 = bad request, likely column names wrong — try next set
      if (response.status === 400) {
        const text = await response.text();
        errors.push({ attempt: attempt + 1, columns: columns.slice(0, 3).join(", ") + "...", error: text });

        // If the error mentions filters (not columns), try without filters
        if (text.includes("filter") && filters) {
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
              note: "filters removed"
            });
          }
        }

        continue; // Try next column set
      }

      // Other error
      const text = await response.text();
      return res.status(response.status).json({ error: `Nulogy error (${response.status}): ${text}` });

    } catch (err) {
      errors.push({ attempt: attempt + 1, error: err.message });
      continue;
    }
  }

  // All attempts failed
  return res.status(400).json({
    error: "Could not find valid column names for this Nulogy report. Your instance may use custom column names.",
    reportType,
    nulogyReport: config.report,
    attempts: errors
  });
}
