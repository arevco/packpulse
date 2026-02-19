// GET /api/nulogy/download?url=<s3Url>&type=<reportType>
// Downloads the CSV from S3, transforms column names for PackPulse, returns JSON

// Column name mappings: Nulogy API column codes → PackPulse-friendly headers
// (Nulogy may return either column codes or column labels as CSV headers)
const COLUMN_MAPS = {
  inventory: {
    // REV Copack actual Nulogy column names
    "Item": "Item Code",
    "Item description": "Description",
    "Good": "Qty On Hand",
    "UOM": "Base UOM",
    "Quarantined": "Quarantined",
    "Rejected": "Rejected",
    "Unavailable": "Unavailable",
    // Nulogy code → PackPulse header
    "item_code": "Item Code",
    "Item Code": "Item Code",
    "item_description": "Description",
    "Item Description": "Description",
    "base_quantity": "Qty On Hand",
    "Base Quantity": "Qty On Hand",
    "base_unit_of_measure": "Base UOM",
    "Base Unit Of Measure": "Base UOM",
    "lot_code": "Lot Code",
    "Lot Code": "Lot Code",
    "expiry_date": "Expiry Date",
    "Expiry Date": "Expiry Date",
    "item_category_name": "Item Category",
    "Item Category Name": "Item Category",
    "item_type": "Item Type",
    "Item Type": "Item Type",
    "is_finished_good": "Is Finished Good",
    "Is Finished Good": "Is Finished Good",
    "inventory_status": "Inventory Status",
    "Inventory Status": "Inventory Status",
    "inventory_category": "Inventory Category",
    "Inventory Category": "Inventory Category",
    "item_alternate_code_1": "Alternate Code 1",
    "Item Alternate Code 1": "Alternate Code 1",
    "item_family_name": "Item Family",
    "Item Family Name": "Item Family"
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
  bom: {
    "finished_good_code": "Finished Good Code",
    "Finished Good Code": "Finished Good Code",
    "subcomponent_code": "Subcomponent Code",
    "Subcomponent Code": "Subcomponent Code",
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
    return res.status(400).json({ error: "Missing or invalid type parameter. Use: inventory, workorders, or bom" });
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
    console.error("Nulogy download error:", err);
    return res.status(500).json({ error: `Failed to download report: ${err.message}` });
  }
}
