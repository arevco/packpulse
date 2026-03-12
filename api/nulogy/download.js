// GET /api/nulogy/download?url=<s3Url>&type=<reportType>
// Downloads the CSV from S3, transforms column names for PackPulse, returns JSON

import Sentry from "../_sentry.js";

// Column name mappings: Nulogy API column codes → PackPulse-friendly headers
// (Nulogy may return either column codes or column labels as CSV headers)
const COLUMN_MAPS = {
  inventory: {
    // Exact column labels from live Nulogy API docs (case-sensitive)
    "Item code": "Item Code",          // Fixed field — auto-included
    "Item description": "Description",
    "Base quantity": "Qty On Hand",
    "Base unit of measure": "Base UOM",
    "Lot code": "Lot Code",
    "Expiry date": "Expiry Date",
    "Customer name": "Customer Name",
    "Item category name": "Item Category",
    "Item type": "Item Type",
    "Item class": "Item Class",
    "Item family name": "Item Family",
    "Is Finished Good": "Is Finished Good",
    "Inventory status": "Inventory Status",
    "Inventory category": "Inventory Category",
    "Item alternate code 1": "Alternate Code 1",
    "Item alternate code 2": "Alternate Code 2",
    "Pallet Number": "Pallet Number",
    "Item GTIN": "Item GTIN",
    "Item UPC": "Item UPC",
    "Case quantity": "Case Quantity",
    "Case unit of measure": "Case UOM",
    "Full Pallet quantity": "Full Pallet Qty",
    "Cost Per Unit": "Cost Per Unit",
    "Cost per unit": "Cost Per Unit",
    "Cost per base unit": "Cost Per Unit",
    "Cost Per Base Unit": "Cost Per Unit",
    "Unit Cost": "Cost Per Unit",
    "Standard Cost": "Cost Per Unit",
    "Average Cost": "Cost Per Unit",
    // Fallback: alternate casings that might appear
    "Item Code": "Item Code",
    "Item Description": "Description",
    "Base Quantity": "Qty On Hand",
    "Base Unit Of Measure": "Base UOM",
    "Lot Code": "Lot Code",
    "Expiry Date": "Expiry Date",
    "Customer Name": "Customer Name",
    // Legacy: REV Copack UI report column names (from manual CSV export)
    "Item": "Item Code",
    "Good": "Qty On Hand",
    "UOM": "Base UOM",
    "Quarantined": "Quarantined",
    "Rejected": "Rejected",
    "Unavailable": "Unavailable",
    // Fallback: raw API codes if returned as-is
    "item_code": "Item Code",
    "item_description": "Description",
    "base_quantity": "Qty On Hand",
    "base_unit_of_measure": "Base UOM",
    "lot_code": "Lot Code",
    "expiry_date": "Expiry Date",
    "inventory_status": "Inventory Status",
    "inventory_category": "Inventory Category",
    "cost_per_unit": "Cost Per Unit",
    "cost_per_base_unit": "Cost Per Unit",
    "unit_cost": "Cost Per Unit",
    "standard_cost": "Cost Per Unit",
    "average_cost": "Cost Per Unit",
    "item_category_name": "Item Category",
    "item_type": "Item Type",
    "item_family_name": "Item Family",
    "is_finished_good": "Is Finished Good",
    "customer_name": "Customer Name",
    "pallet_number": "Pallet Number"
  },
  workorders: {
    "project_code": "Work Order Code",
    "Project Code": "Work Order Code",
    "item_code": "Item Code",
    "Item Code": "Item Code",
    "item_description": "Description",
    "Item Description": "Description",
    "customer_name": "Customer Name",
    "Customer Name": "Customer Name",
    "units_expected": "Units Expected",
    "Units Expected": "Units Expected",
    "units_produced": "Units Produced",
    "Units Produced": "Units Produced",
    "units_remaining": "Units Remaining",
    "Units Remaining": "Units Remaining",
    "due_date_at": "Due Date",
    "Due Date At": "Due Date",
    "project_status": "Work Order Status",
    "Project Status": "Work Order Status",
    "standard_units_per_hour": "Standard Units Per Hour",
    "Standard Units Per Hour": "Standard Units Per Hour",
    "standard_people": "Standard People",
    "Standard People": "Standard People",
    "planned_start_at": "Planned Start",
    "Planned Start": "Planned Start",
    "planned_end_at": "Planned End",
    "Planned End": "Planned End",
    "reference_1": "Reference 1",
    "Reference 1": "Reference 1",
    "purchase_order_number": "Purchase Order Number",
    "Purchase Order Number": "Purchase Order Number",
    "bom_version_name": "BOM Version",
    "Bom Version Name": "BOM Version",
    "project_id": "Project ID",
    "Project ID": "Project ID",
    "performance": "Performance",
    "Performance": "Performance",
    "unit_of_measure": "Unit of Measure",
    "Unit Of Measure": "Unit of Measure"
  },
  itemmaster: {
    "id": "Item ID",
    "ID": "Item ID",
    "item_id": "Item ID",
    "Item ID": "Item ID",
    "code": "Item Code",
    "Code": "Item Code",
    "description": "Description",
    "Description": "Description",
    "cost_per_unit": "Cost Per Unit",
    "Cost Per Unit": "Cost Per Unit",
    "unit_cost": "Cost Per Unit",
    "Unit Cost": "Cost Per Unit",
    "standard_cost": "Cost Per Unit",
    "Standard Cost": "Cost Per Unit",
    "cost_per_base_unit": "Cost Per Unit",
    "Cost Per Base Unit": "Cost Per Unit",
    "is_subcomponent": "Is Subcomponent",
    "Is Subcomponent": "Is Subcomponent",
    "is_finished_good": "Is Finished Good",
    "Is Finished Good": "Is Finished Good",
    "item_type": "Item Type",
    "Item Type": "Item Type",
    "item_category": "Item Category",
    "Item Category": "Item Category",
    "inactive": "Inactive",
    "Inactive": "Inactive",
    "customer": "Customer",
    "Customer": "Customer"
  },
  bom: {
    "finished_good_code": "Finished Good Code",
    "Finished Good Code": "Finished Good Code",
    "subcomponent_code": "Subcomponent Code",
    "Subcomponent Code": "Subcomponent Code",
    "subcomponent_description": "Subcomponent Description",
    "Subcomponent Description": "Subcomponent Description",
    "subcomponent_name": "Subcomponent Description",
    "Subcomponent Name": "Subcomponent Description",
    "material_description": "Subcomponent Description",
    "Material Description": "Subcomponent Description",
    "subcomponent_unit_quantity": "Qty Per",
    "Subcomponent Quantity": "Qty Per",
    "subcomponent_uom": "Subcomponent UOM",
    "Subcomponent Unit Of Measure": "Subcomponent UOM",
    "substitute_for": "Substitute For",
    "Substitute For": "Substitute For",
    "priority": "Priority",
    "Priority": "Priority",
    "version_name": "Version Name",
    "Version Name": "Version Name",
    "position": "Position",
    "Position": "Position",
    "optional": "Optional",
    "Optional": "Optional",
    "release_date": "Release Date",
    "Release Date": "Release Date"
  },
  production: {
    "produced_at": "Produced At",
    "Produced At": "Produced At",
    "actual_job_start_at": "Actual Job Start",
    "Actual Job Start At": "Actual Job Start",
    "actual_job_end_at": "Actual Job End",
    "Actual Job End At": "Actual Job End",
    "job_id": "Job ID",
    "Job ID": "Job ID",
    "line": "Line",
    "Line": "Line",
    "project_code": "Work Order Code",
    "Project Code": "Work Order Code",
    "item_code": "Item Code",
    "Item Code": "Item Code",
    "item_description": "Description",
    "Item Description": "Description",
    "units_produced": "Units Produced",
    "Units Produced": "Units Produced",
    "project_status": "Work Order Status",
    "Project Status": "Work Order Status",
    "purchase_order_number": "Purchase Order Number",
    "Purchase Order Number": "Purchase Order Number"
  },
  labor: {
    "Availability": "Availability",
    "availability": "Availability",
    "Badge": "Badge",
    "badge": "Badge",
    "Badge type name": "Badge Type Name",
    "badge_type_name": "Badge Type Name",
    "Badge type prefix": "Badge Type Prefix",
    "badge_type_prefix": "Badge Type Prefix",
    "Badge type rate": "Badge Type Rate",
    "badge_type_rate": "Badge Type Rate",
    "Clock in time": "Clock In Time",
    "clock_in_time": "Clock In Time",
    "Clock out time": "Clock Out Time",
    "clock_out_time": "Clock Out Time",
    "Duration": "Duration",
    "duration": "Duration",
    "Item alternate code 1": "Item Alternate Code 1",
    "item_alternate_code_1": "Item Alternate Code 1",
    "Item alternate code 2": "Item Alternate Code 2",
    "item_alternate_code_2": "Item Alternate Code 2",
    "Item category name": "Item Category Name",
    "item_category_name": "Item Category Name",
    "Item code": "Item Code",
    "item_code": "Item Code",
    "Item Customer name": "Item Customer Name",
    "item_customer_name": "Item Customer Name",
    "Item description": "Item Description",
    "item_description": "Item Description",
    "Item family name": "Item Family Name",
    "item_family_name": "Item Family Name",
    "Item GTIN": "Item GTIN",
    "item_gtin": "Item GTIN",
    "Item type": "Item Type",
    "item_type": "Item Type",
    "Item UPC": "Item UPC",
    "item_upc": "Item UPC",
    "Job ID": "Job ID",
    "job_id": "Job ID",
    "Job reference": "Job Reference",
    "job_reference": "Job Reference",
    "Line Efficiency": "Line Efficiency",
    "line_efficiency": "Line Efficiency",
    "Line leader name": "Line Leader Name",
    "line_leader_name": "Line Leader Name",
    "Line name": "Line Name",
    "line_name": "Line Name",
    "Payable hours": "Payable Hours",
    "payable_hours": "Payable Hours",
    "Performance": "Performance",
    "performance": "Performance",
    "Productive hours": "Productive Hours",
    "productive_hours": "Productive Hours",
    "Site name": "Site Name",
    "site_name": "Site Name",
    "Work Order Code": "Work Order Code",
    "project_code": "Work Order Code",
    "work_order_code": "Work Order Code",
    "Work Order ID": "Work Order ID",
    "work_order_id": "Work Order ID",
    "Work Order reference 1": "Work Order Reference 1",
    "work_order_reference_1": "Work Order Reference 1",
    "Work Order reference 2": "Work Order Reference 2",
    "work_order_reference_2": "Work Order Reference 2",
    "Work Order reference 3": "Work Order Reference 3",
    "work_order_reference_3": "Work Order Reference 3",
    "Work Order reference 4": "Work Order Reference 4",
    "work_order_reference_4": "Work Order Reference 4",
    "Work Order reference 5": "Work Order Reference 5",
    "work_order_reference_5": "Work Order Reference 5"
  }
};

function parseCSV(text) {
  const lines = text.split("\n");
  if (lines.length < 2) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = idx < values.length ? values[idx] : "";
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function transformColumns(rows, reportType) {
  const map = COLUMN_MAPS[reportType] || {};
  if (!rows.length) return rows;
  const normalizeKey = function(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  };

  return rows.map(row => {
    const newRow = {};
    Object.entries(row).forEach(([key, val]) => {
      let newKey = map[key] || key;
      if ((reportType === "itemmaster" || reportType === "inventory") && newKey === key) {
        const nk = normalizeKey(key);
        const hasCostToken = nk.includes("cost") || nk.includes("price");
        const looksLikeUnitish =
          nk.includes("unit") ||
          nk.includes("base") ||
          nk.includes("standard") ||
          nk.includes("std") ||
          nk.includes("default") ||
          nk.includes("avg") ||
          nk.includes("average") ||
          nk === "cost" ||
          nk === "price";
        const looksLikeUnitCost =
          hasCostToken &&
          looksLikeUnitish &&
          !nk.includes("purchase") &&
          !nk.includes("total") &&
          !nk.includes("extended") &&
          !nk.includes("amount");
        if (looksLikeUnitCost) newKey = "Cost Per Unit";
      }
      newRow[newKey] = val;
    });
    return newRow;
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const downloadUrl = req.query.url;
  const reportType = req.query.type;
  const rawMode = String(req.query.raw || "") === "1";

  if (!downloadUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  if (!reportType || !COLUMN_MAPS[reportType]) {
    return res.status(400).json({ error: "Missing or invalid type parameter. Use: inventory, workorders, itemmaster, bom, production, or labor" });
  }

  try {
    // Download CSV from S3 (no auth needed for the S3 URL)
    const response = await fetch(downloadUrl);

    if (!response.ok) {
      return res.status(response.status).json({ error: `Failed to download report CSV (${response.status})` });
    }

    const csvText = await response.text();

    // Parse CSV
    const rows = parseCSV(csvText);

    // Capture original headers before transformation
    const originalHeaders = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Transform column names for PackPulse compatibility unless raw mode requested.
    const transformed = rawMode ? rows : transformColumns(rows, reportType);

    return res.status(200).json({
      data: transformed,
      rowCount: transformed.length,
      reportType,
      columns: transformed.length > 0 ? Object.keys(transformed[0]) : [],
      originalHeaders: originalHeaders
    });

  } catch (err) {
    Sentry.captureException(err);
    console.error("Nulogy download error:", err);
    return res.status(500).json({ error: `Failed to download report: ${err.message}` });
  }
}
