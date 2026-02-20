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
    "code": "Item Code",
    "Code": "Item Code",
    "description": "Description",
    "Description": "Description",
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

  return rows.map(row => {
    const newRow = {};
    Object.entries(row).forEach(([key, val]) => {
      const newKey = map[key] || key;
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

  if (!downloadUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }
  if (!reportType || !COLUMN_MAPS[reportType]) {
    return res.status(400).json({ error: "Missing or invalid type parameter. Use: inventory, workorders, itemmaster, or bom" });
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

    // Transform column names for PackPulse compatibility
    const transformed = transformColumns(rows, reportType);

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
