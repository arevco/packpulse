// POST /api/nulogy/create
// Creates a Nulogy report job and returns the status URL + task ID
// Body: { reportType: "inventory" | "workorders" | "bom" }

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

const REPORT_CONFIGS = {
  inventory: {
    report: "inventory_snapshot",
    columns: [
      "item_code", "item_description", "base_quantity",
      "base_unit_of_measure", "lot_code", "expiry_date",
      "item_category_name", "item_type", "is_finished_good",
      "inventory_status", "inventory_category",
      "item_alternate_code_1", "item_family_name"
    ]
  },
  workorders: {
    report: "project_status",
    columns: [
      "project_code", "item_code", "item_description",
      "customer_name", "units_expected", "units_produced",
      "units_remaining", "due_date_at", "project_status",
      "standard_units_per_hour", "standard_people",
      "planned_start_at", "planned_end_at", "reference_1",
      "purchase_order_number", "bom_version_name",
      "project_id", "performance", "unit_of_measure"
    ],
    filters: [
      {
        column: "project_status",
        operator: "!=",
        threshold: "Cancelled"
      }
    ]
  },
  bom: {
    report: "bom",
    columns: [
      "finished_good_code", "subcomponent_code",
      "subcomponent_unit_quantity", "subcomponent_uom",
      "substitute_for", "priority", "version_name",
      "position", "optional", "release_date"
    ]
  }
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;
  const siteUuid = process.env.NULOGY_SITE_UUID;

  if (!user || !pass) {
    return res.status(500).json({ error: "Nulogy credentials not configured. Set NULOGY_USER and NULOGY_PASS in Vercel environment variables." });
  }

  const { reportType } = req.body || {};
  const config = REPORT_CONFIGS[reportType];

  if (!config) {
    return res.status(400).json({ error: `Invalid report type: ${reportType}. Use: inventory, workorders, or bom` });
  }

  // Build request body
  const body = {
    report: config.report,
    columns: config.columns,
    locale: "en_US"
  };
  if (config.filters) body.filters = config.filters;
  if (siteUuid) body.site_uuid = siteUuid;

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");

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
      return res.status(401).json({ error: "Invalid Nulogy credentials. Check NULOGY_USER and NULOGY_PASS." });
    }
    if (response.status === 403) {
      return res.status(403).json({ error: "Nulogy credentials lack permissions for this report." });
    }
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: `Nulogy API error (${response.status}): ${text}` });
    }

    // Get the status URL from Location header
    const statusUrl = response.headers.get("location") || response.headers.get("Location");
    const responseBody = await response.json().catch(() => ({}));
    const taskId = responseBody.task_id;

    if (!statusUrl && !taskId) {
      return res.status(500).json({ error: "Nulogy did not return a status URL or task ID." });
    }

    const finalStatusUrl = statusUrl || `${NULOGY_URL}/api/reports/report_runs/${taskId}`;

    return res.status(201).json({
      taskId,
      statusUrl: finalStatusUrl,
      reportType,
      nulogyReport: config.report
    });

  } catch (err) {
    console.error("Nulogy create report error:", err);
    return res.status(500).json({ error: `Failed to connect to Nulogy: ${err.message}` });
  }
}
