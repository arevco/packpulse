import Sentry from "../_sentry.js";
import { executeReportRun } from "./_runner.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const INVENTORY_SNAPSHOT_PATH = process.env.NULOGY_INVENTORY_SNAPSHOT_PATH || "";
const CURRENT_INVENTORY_PATH = process.env.NULOGY_CURRENT_INVENTORY_PATH ||
  "/inventory_reports/current_inventory?button=&show=true&reports_current_inventory_parameters%5Bcustomer%5D=all&reports_current_inventory_parameters%5Blocation_type%5D=all&reports_current_inventory_parameters%5Buom_context%5D=base&reports_current_inventory_parameters%5Bshow_lot_codes_and_expiry_dates%5D=0&reports_current_inventory_parameters%5Bshow_lot_codes_and_expiry_dates%5D=1&reports_current_inventory_parameters%5Bshow_safety_stock%5D=0&reports_current_inventory_parameters%5Bgroup_inventory_statuses_by_category%5D=0&reports_current_inventory_parameters%5Bon_shipment%5D=0&reports_current_inventory_parameters%5Bon_shipment%5D=1&reports_current_inventory_parameters%5Bitem_type%5D=all&reports_current_inventory_parameters%5Bitem_category%5D=all&reports_current_inventory_parameters%5Bitem_family%5D=all&reports_current_inventory_parameters%5Bsku_code%5D=&is_subcomponent=all&part_of_finished_good_code=&is_finished_good=all&contains_subcomponent_code=";
const ITEM_LOCATOR_PATH = process.env.NULOGY_ITEM_LOCATOR_PATH ||
  "/item_locator/locate_items?button=&location_name=&location_type=all&pallet_number=&in_transit=none&inventory_status_id=&inventory_hold=none&inventory_hold_for_project=&inventory_hold_for_ship_order=&inventory_hold_for_shipment=&inventory_hold_for_move=&project_id=&project_code=&sku_category_name=&item_class_name=&sku_type_name=&sort_by=location_name&sort_direction=ASC&customer_name=&sku_code=&lot_code=&expiry_date=&item_family_name=&vendor_name=";

const INVENTORY_SNAPSHOT_COLUMNS = [
  "base_quantity",
  "base_unit_of_measure",
  "case_quantity",
  "case_unit_of_measure",
  "customer_name",
  "default_quantity",
  "default_unit_of_measure",
  "expiry_date",
  "full_pallet_unit_of_measure",
  "full_pallet_quantity",
  "inventory_status",
  "inventory_category",
  "is_finished_good",
  "item_alternate_code_1",
  "item_alternate_code_2",
  "item_category_name",
  "item_class",
  "item_description",
  "item_family_name",
  "item_type",
  "item_gtin",
  "item_upc",
  "lot_code",
  "pallet_number"
];
const PALLET_AGING_COLUMNS = [
  "base_quantity",
  "base_unit_of_measure",
  "customer_name",
  "expiry_date",
  "inventory_category",
  "inventory_status",
  "item_code",
  "item_description",
  "location",
  "lot_code",
  "pallet_number",
  "site_name"
];

const RETRYABLE_FETCH_STATUSES = {
  408: true,
  425: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true
};
const RETRYABLE_XML_ERROR_CODES = {
  InternalError: true,
  RequestTimeout: true,
  ServiceUnavailable: true,
  SlowDown: true
};
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 750;

function formatNulogyUiDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const year = d.getFullYear();
  const month = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, "0");
  const hour24 = d.getHours();
  const minute = String(d.getMinutes()).padStart(2, "0");
  const ampm = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${year}-${month}-${day} ${hour12}:${minute} ${ampm}`;
}

function buildInventorySnapshotPath() {
  if (INVENTORY_SNAPSHOT_PATH) return INVENTORY_SNAPSHOT_PATH;
  const params = new URLSearchParams();
  params.set("button", "");
  params.set("generate_flag", "true");
  params.set("query[1][snapshot_at][operator]", "==");
  params.set("query[1][snapshot_at][threshold]", formatNulogyUiDateTime(new Date()));
  params.set("filter_choice", "customer_name");
  INVENTORY_SNAPSHOT_COLUMNS.forEach(function(column, index) {
    params.set(`columns[${index}]`, column);
  });
  params.set("order_by", "item_code");
  params.set("order_direction", "desc");
  return "/canned_reports/inventory_snapshot?" + params.toString();
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (i + 1 < line.length && line[i + 1] === "\"") {
          current += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === "\"") {
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

function parseCSV(text) {
  const lines = String(text || "").split(/\r?\n/);
  if (!lines.length) return [];
  const headers = parseCSVLine(lines[0] || "");
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach(function(header, index) {
      row[header] = index < values.length ? values[index] : "";
    });
    rows.push(row);
  }
  return rows;
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function toNum(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function compactInventoryRows(rows) {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const sku = String(pickLooseValue(row, ["Item Code", "item_code", "Item", "item", "SKU", "sku"]) || "").trim();
    const description = String(pickLooseValue(row, ["Description", "Item Description", "item_description"]) || "").trim();
    const status = String(pickLooseValue(row, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
    const baseUom = String(pickLooseValue(row, ["Base UOM", "Base unit of measure", "base_unit_of_measure", "UOM", "uom"]) || "").trim();
    const qty = toNum(pickLooseValue(row, ["Qty On Hand", "qty_on_hand", "Base quantity", "base_quantity", "Quantity", "quantity", "Available", "available"]));
    const customerName = String(pickLooseValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
    const source = String(pickLooseValue(row, ["Source", "source"]) || "").trim();
    if (!sku && !description && !(qty > 0) && !status && !customerName) return;

    const key = [
      normalizeKey(sku),
      normalizeKey(status),
      normalizeKey(baseUom),
      normalizeKey(customerName)
    ].join("|");
    if (!grouped[key]) {
      grouped[key] = {
        "Item Code": sku || "--",
        "Description": description || "--",
        "Qty On Hand": 0,
        "Inventory Status": status || "",
        "Customer Name": customerName || "",
        "Base UOM": baseUom || "",
        "Source": source || "compact_inventory"
      };
    }
    grouped[key]["Qty On Hand"] += qty;
    if ((!grouped[key]["Description"] || grouped[key]["Description"] === "--") && description) {
      grouped[key]["Description"] = description;
    }
    if (!grouped[key]["Source"] && source) grouped[key]["Source"] = source;
    if (grouped[key]["Source"] && source && grouped[key]["Source"] !== source) {
      grouped[key]["Source"] = "report_compact_inventory";
    }
  });
  return Object.values(grouped);
}

function firstDefinedValue(values, fallback) {
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value != null && value !== "") return value;
  }
  return fallback;
}

function readInventoryExtras(row) {
  return {
    "Inventory Category": String(pickLooseValue(row, ["Inventory category", "inventory_category"]) || "").trim(),
    "Item Category": String(pickLooseValue(row, ["Item category name", "item_category_name", "Item Category", "item_category"]) || "").trim(),
    "Item Class": String(pickLooseValue(row, ["Item class", "item_class"]) || "").trim(),
    "Item Family": String(pickLooseValue(row, ["Item family name", "item_family_name"]) || "").trim(),
    "Item GTIN": String(pickLooseValue(row, ["Item GTIN", "item_gtin"]) || "").trim(),
    "Item Type": String(pickLooseValue(row, ["Item type", "item_type", "Item type name", "item_type_name"]) || "").trim(),
    "Item UPC": String(pickLooseValue(row, ["Item UPC", "item_upc"]) || "").trim(),
    "Item Alternate Code 1": String(pickLooseValue(row, ["Item alternate code 1", "item_alternate_code_1"]) || "").trim(),
    "Item Alternate Code 2": String(pickLooseValue(row, ["Item alternate code 2", "item_alternate_code_2"]) || "").trim(),
    "Case Quantity": String(pickLooseValue(row, ["Case Quantity", "case_quantity"]) || "").trim(),
    "Case UOM": String(pickLooseValue(row, ["Case Unit Of Measure", "Case unit of measure", "case_unit_of_measure", "cases_unit_of_measure"]) || "").trim(),
    "Default Quantity": String(pickLooseValue(row, ["Default quantity", "default_quantity"]) || "").trim(),
    "Default UOM": String(pickLooseValue(row, ["Default unit of measure", "default_unit_of_measure"]) || "").trim(),
    "Full Pallet Quantity": String(pickLooseValue(row, ["Full Pallet Quantity", "Full Pallet quantity", "full_pallet_quantity"]) || "").trim(),
    "Full Pallet UOM": String(pickLooseValue(row, ["Full Pallet Unit Of Measure", "Full Pallet unit of measure", "full_pallet_unit_of_measure", "full_pallets_unit_of_measure"]) || "").trim(),
    "Site Name": String(pickLooseValue(row, ["Site Name", "site_name"]) || "").trim(),
    "Stored Since": String(pickLooseValue(row, ["Stored since", "stored_since"]) || "").trim(),
    "Zone": String(pickLooseValue(row, ["Zone", "warehouse_zone"]) || "").trim(),
    "Inventory Value": String(pickLooseValue(row, ["Inventory value", "inventory_value"]) || "").trim(),
    "Material Cost Per Unit": String(pickLooseValue(row, ["Material cost per unit", "material_cost_per_unit"]) || "").trim(),
    "Item Weight Per Case": String(pickLooseValue(row, ["Item weight per case", "item_weight_per_case"]) || "").trim(),
    "Item Weight Per Pallet": String(pickLooseValue(row, ["Item weight per pallet", "item_weight_per_pallet"]) || "").trim()
  };
}

function pickLooseValue(row, keys) {
  if (!row || typeof row !== "object") return "";
  const rowKeys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const wanted = normalizeKey(keys[i]);
    for (let j = 0; j < rowKeys.length; j++) {
      if (normalizeKey(rowKeys[j]) === wanted) return row[rowKeys[j]];
    }
  }
  return "";
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); })
    .replace(/&#(\d+);/g, function(_, dec) { return String.fromCharCode(parseInt(dec, 10)); });
}

function stripTags(html) {
  return decodeHtml(String(html || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlTables(html) {
  const tables = String(html || "").match(/<table[\s\S]*?<\/table>/gi) || [];
  return tables.map(function(tableHtml) {
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    const rows = rowMatches.map(function(rowHtml) {
      const cellMatches = rowHtml.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      return cellMatches.map(function(cellHtml) {
        return stripTags(cellHtml);
      });
    }).filter(function(cells) {
      return cells.some(Boolean);
    });
    if (!rows.length) return null;
    let headerIndex = rows.findIndex(function(cells) {
      return cells.some(function(cell) {
        const n = normalizeKey(cell);
        return n.includes("location") || n.includes("pallet") || n.includes("lot") || n.includes("sku") || n.includes("item");
      });
    });
    if (headerIndex < 0) headerIndex = 0;
    const headers = rows[headerIndex];
    const dataRows = rows.slice(headerIndex + 1).map(function(cells) {
      const row = {};
      headers.forEach(function(header, index) {
        row[header || ("Column " + (index + 1))] = index < cells.length ? cells[index] : "";
      });
      return row;
    }).filter(function(row) {
      return Object.values(row).some(Boolean);
    });
    return { headers: headers, rows: dataRows };
  }).filter(Boolean);
}

function chooseBestHtmlTable(tables) {
  let best = null;
  let bestScore = -1;
  tables.forEach(function(table) {
    const headers = Array.isArray(table && table.headers) ? table.headers : [];
    const score = headers.reduce(function(sum, header) {
      const n = normalizeKey(header);
      if (n.includes("location")) sum += 5;
      if (n.includes("pallet")) sum += 5;
      if (n.includes("lot")) sum += 4;
      if (n.includes("expiry") || n.includes("expiration")) sum += 4;
      if (n.includes("item") || n.includes("sku")) sum += 3;
      if (n.includes("quantity") || n === "qty") sum += 2;
      return sum;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = table;
    }
  });
  return best;
}

function looksLikeCsv(text, contentType) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("csv")) return true;
  const prefix = String(text || "").trim().slice(0, 200).toLowerCase();
  if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html")) return false;
  return prefix.includes(",") && prefix.includes("\n");
}

function parseCurrentInventoryRows(rows, sourceLabel) {
  const out = [];
  const statusBuckets = [
    { label: "Good", keys: ["Good", "good"] },
    { label: "Quarantined", keys: ["Quarantined", "quarantined"] },
    { label: "Rejected", keys: ["Rejected", "rejected"] },
    { label: "Unavailable", keys: ["Unavailable", "unavailable"] }
  ];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const sku = String(pickLooseValue(row, ["Item Code", "item_code", "Item", "item", "SKU", "sku"]) || "").trim();
    const description = String(pickLooseValue(row, ["Description", "Item Description", "item_description"]) || "").trim();
    const lotCode = String(pickLooseValue(row, ["Lot Code", "lot_code", "Lot", "lot"]) || "").trim();
    const expiryDate = String(pickLooseValue(row, ["Expiry Date", "expiry_date", "Expiration Date", "expiration_date"]) || "").trim();
    const baseUom = String(pickLooseValue(row, ["Base UOM", "Base unit of measure", "UOM", "uom"]) || "").trim();
    const customerName = String(pickLooseValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
    const palletNumber = String(pickLooseValue(row, ["Pallet Number", "pallet_number", "Pallet", "pallet"]) || "").trim();
    const extras = readInventoryExtras(row);
    let pushed = false;
    statusBuckets.forEach(function(bucket) {
      const qty = toNum(pickLooseValue(row, bucket.keys));
      if (!(qty > 0)) return;
      out.push({
        "Item Code": sku || "--",
        "Description": description || "--",
        "Location": "",
        "Lot Code": lotCode || "",
        "Expiry Date": expiryDate || "",
        "Pallet Number": palletNumber || "",
        "Qty On Hand": qty,
        "Inventory Status": bucket.label,
        "Customer Name": customerName || "",
        "Base UOM": baseUom || "",
        ...extras,
        "Source": sourceLabel || "current_inventory"
      });
      pushed = true;
    });
    if (!pushed) {
      const qty = toNum(pickLooseValue(row, ["Qty On Hand", "Base quantity", "base_quantity", "Quantity", "quantity"]));
      const status = String(pickLooseValue(row, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
      if (qty > 0 || sku || lotCode || expiryDate) {
        out.push({
          "Item Code": sku || "--",
          "Description": description || "--",
          "Location": "",
          "Lot Code": lotCode || "",
          "Expiry Date": expiryDate || "",
          "Pallet Number": palletNumber || "",
          "Qty On Hand": qty,
          "Inventory Status": status || "",
          "Customer Name": customerName || "",
          "Base UOM": baseUom || "",
          ...extras,
          "Source": sourceLabel || "current_inventory"
        });
      }
    }
  });
  return out;
}

function parseLocatorRows(rows, sourceLabel) {
  const out = [];
  const statusBuckets = [
    { label: "Good", keys: ["Good", "good"] },
    { label: "Quarantined", keys: ["Quarantined", "quarantined"] },
    { label: "Rejected", keys: ["Rejected", "rejected"] },
    { label: "Unavailable", keys: ["Unavailable", "unavailable"] }
  ];
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const sku = String(pickLooseValue(row, ["Item Code", "item_code", "Item", "item", "SKU", "sku", "SKU Code", "sku_code"]) || "").trim();
    const description = String(pickLooseValue(row, ["Description", "Item Description", "item_description"]) || "").trim();
    const location = String(pickLooseValue(row, ["Location", "location", "Location Name", "location_name"]) || "").trim();
    const lotCode = String(pickLooseValue(row, ["Lot Code", "lot_code", "Lot", "lot"]) || "").trim();
    const expiryDate = String(pickLooseValue(row, ["Expiry Date", "expiry_date", "Expiration Date", "expiration_date"]) || "").trim();
    const palletNumber = String(pickLooseValue(row, ["Pallet Number", "pallet_number", "Pallet", "pallet"]) || "").trim();
    const baseUom = String(pickLooseValue(row, ["Base UOM", "Base unit of measure", "UOM", "uom"]) || "").trim();
    const singularStatus = String(pickLooseValue(row, ["Inventory Status", "inventory_status", "Status", "status"]) || "").trim();
    const singularQty = toNum(pickLooseValue(row, ["Qty On Hand", "Base quantity", "base_quantity", "Quantity", "quantity", "Qty", "qty", "Available", "available"]));
    const customerName = String(pickLooseValue(row, ["Customer Name", "customer_name", "Customer", "customer"]) || "").trim();
    const extras = readInventoryExtras(row);

    let pushed = false;
    statusBuckets.forEach(function(bucket) {
      const qty = toNum(pickLooseValue(row, bucket.keys));
      if (!(qty > 0)) return;
      out.push({
        "Item Code": sku || "--",
        "Description": description || "--",
        "Location": location || "",
        "Lot Code": lotCode || "",
        "Expiry Date": expiryDate || "",
        "Pallet Number": palletNumber || "",
        "Qty On Hand": qty,
        "Inventory Status": bucket.label,
        "Customer Name": customerName || "",
        "Base UOM": baseUom || "",
        ...extras,
        "Source": sourceLabel || "item_locator"
      });
      pushed = true;
    });

    if (!pushed && (sku || location || lotCode || palletNumber || singularQty > 0)) {
      out.push({
        "Item Code": sku || "--",
        "Description": description || "--",
        "Location": location || "",
        "Lot Code": lotCode || "",
        "Expiry Date": expiryDate || "",
        "Pallet Number": palletNumber || "",
        "Qty On Hand": singularQty,
        "Inventory Status": singularStatus || "",
        "Customer Name": customerName || "",
        "Base UOM": baseUom || "",
        ...extras,
        "Source": sourceLabel || "item_locator"
      });
    }
  });
  return out;
}

function buildKey(row, fields) {
  const parts = fields.map(function(field) {
    return normalizeKey(row && row[field]);
  });
  return parts.join("|");
}

function hasMeaningfulKey(key) {
  return String(key || "").replace(/\|/g, "").length > 0;
}

function indexRows(rows, fields) {
  const indexed = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row) {
    const key = buildKey(row, fields);
    if (!hasMeaningfulKey(key)) return;
    if (!indexed[key]) indexed[key] = [];
    indexed[key].push(row);
  });
  return indexed;
}

function findIndexedMatch(indexes, locatorRow, usedRows) {
  const strategies = [
    ["Item Code", "Lot Code", "Expiry Date", "Inventory Status"],
    ["Item Code", "Lot Code", "Expiry Date", "Pallet Number"],
    ["Item Code", "Pallet Number"],
    ["Item Code", "Lot Code", "Expiry Date"],
    ["Item Code", "Lot Code"]
  ];
  for (let i = 0; i < strategies.length; i++) {
    const fields = strategies[i];
    const key = buildKey(locatorRow, fields);
    if (!hasMeaningfulKey(key)) continue;
    const candidates = indexes[i][key] || [];
    const currentRow = candidates.find(function(candidate) {
      return !usedRows.has(candidate);
    });
    if (currentRow) return currentRow;
  }
  return null;
}

function coalesceRows(rows) {
  const grouped = {};
  (Array.isArray(rows) ? rows : []).forEach(function(row, index) {
    const key = [
      normalizeKey(row["Item Code"]),
      normalizeKey(row["Location"]),
      normalizeKey(row["Lot Code"]),
      normalizeKey(row["Expiry Date"]),
      normalizeKey(row["Pallet Number"]),
      normalizeKey(row["Inventory Status"]),
      normalizeKey(row["Base UOM"])
    ].join("|") || ("row|" + index);
    if (!grouped[key]) {
      grouped[key] = Object.assign({}, row);
      grouped[key]["Qty On Hand"] = toNum(row["Qty On Hand"]);
      return;
    }
    grouped[key]["Qty On Hand"] = toNum(grouped[key]["Qty On Hand"]) + toNum(row["Qty On Hand"]);
    if (!grouped[key]["Description"] && row["Description"]) grouped[key]["Description"] = row["Description"];
    if (!grouped[key]["Source"] && row["Source"]) grouped[key]["Source"] = row["Source"];
    if (!grouped[key]["Customer Name"] && row["Customer Name"]) grouped[key]["Customer Name"] = row["Customer Name"];
    if (!grouped[key]["Pallet Number"] && row["Pallet Number"]) grouped[key]["Pallet Number"] = row["Pallet Number"];
    if (!grouped[key]["Location"] && row["Location"]) grouped[key]["Location"] = row["Location"];
    if (!grouped[key]["Lot Code"] && row["Lot Code"]) grouped[key]["Lot Code"] = row["Lot Code"];
    if (!grouped[key]["Expiry Date"] && row["Expiry Date"]) grouped[key]["Expiry Date"] = row["Expiry Date"];
    if (!grouped[key]["Inventory Category"] && row["Inventory Category"]) grouped[key]["Inventory Category"] = row["Inventory Category"];
    if (!grouped[key]["Item Category"] && row["Item Category"]) grouped[key]["Item Category"] = row["Item Category"];
    if (!grouped[key]["Item Class"] && row["Item Class"]) grouped[key]["Item Class"] = row["Item Class"];
    if (!grouped[key]["Item Family"] && row["Item Family"]) grouped[key]["Item Family"] = row["Item Family"];
    if (!grouped[key]["Item GTIN"] && row["Item GTIN"]) grouped[key]["Item GTIN"] = row["Item GTIN"];
    if (!grouped[key]["Item Type"] && row["Item Type"]) grouped[key]["Item Type"] = row["Item Type"];
    if (!grouped[key]["Item UPC"] && row["Item UPC"]) grouped[key]["Item UPC"] = row["Item UPC"];
    if (!grouped[key]["Item Alternate Code 1"] && row["Item Alternate Code 1"]) grouped[key]["Item Alternate Code 1"] = row["Item Alternate Code 1"];
    if (!grouped[key]["Item Alternate Code 2"] && row["Item Alternate Code 2"]) grouped[key]["Item Alternate Code 2"] = row["Item Alternate Code 2"];
    if (!grouped[key]["Case Quantity"] && row["Case Quantity"]) grouped[key]["Case Quantity"] = row["Case Quantity"];
    if (!grouped[key]["Case UOM"] && row["Case UOM"]) grouped[key]["Case UOM"] = row["Case UOM"];
    if (!grouped[key]["Default Quantity"] && row["Default Quantity"]) grouped[key]["Default Quantity"] = row["Default Quantity"];
    if (!grouped[key]["Default UOM"] && row["Default UOM"]) grouped[key]["Default UOM"] = row["Default UOM"];
    if (!grouped[key]["Full Pallet Quantity"] && row["Full Pallet Quantity"]) grouped[key]["Full Pallet Quantity"] = row["Full Pallet Quantity"];
    if (!grouped[key]["Full Pallet UOM"] && row["Full Pallet UOM"]) grouped[key]["Full Pallet UOM"] = row["Full Pallet UOM"];
    if (!grouped[key]["Site Name"] && row["Site Name"]) grouped[key]["Site Name"] = row["Site Name"];
    if (!grouped[key]["Stored Since"] && row["Stored Since"]) grouped[key]["Stored Since"] = row["Stored Since"];
    if (!grouped[key]["Zone"] && row["Zone"]) grouped[key]["Zone"] = row["Zone"];
    if (!grouped[key]["Inventory Value"] && row["Inventory Value"]) grouped[key]["Inventory Value"] = row["Inventory Value"];
    if (!grouped[key]["Material Cost Per Unit"] && row["Material Cost Per Unit"]) grouped[key]["Material Cost Per Unit"] = row["Material Cost Per Unit"];
    if (!grouped[key]["Item Weight Per Case"] && row["Item Weight Per Case"]) grouped[key]["Item Weight Per Case"] = row["Item Weight Per Case"];
    if (!grouped[key]["Item Weight Per Pallet"] && row["Item Weight Per Pallet"]) grouped[key]["Item Weight Per Pallet"] = row["Item Weight Per Pallet"];
  });
  return Object.values(grouped);
}

function mergePreferred(locatorRow, currentRow, key, fallback) {
  return firstDefinedValue([
    locatorRow && locatorRow[key],
    currentRow && currentRow[key]
  ], fallback == null ? "" : fallback);
}

function mergeInventoryRows(currentRows, locatorRows) {
  if (!locatorRows.length) return coalesceRows(currentRows);
  if (!currentRows.length) return coalesceRows(locatorRows);

  const currentIndexes = [
    indexRows(currentRows, ["Item Code", "Lot Code", "Expiry Date", "Inventory Status"]),
    indexRows(currentRows, ["Item Code", "Lot Code", "Expiry Date", "Pallet Number"]),
    indexRows(currentRows, ["Item Code", "Pallet Number"]),
    indexRows(currentRows, ["Item Code", "Lot Code", "Expiry Date"]),
    indexRows(currentRows, ["Item Code", "Lot Code"])
  ];
  const usedCurrentRows = new Set();
  const merged = locatorRows.map(function(locatorRow) {
    const currentRow = findIndexedMatch(currentIndexes, locatorRow, usedCurrentRows);
    if (currentRow) usedCurrentRows.add(currentRow);

    return {
      "Item Code": mergePreferred(locatorRow, currentRow, "Item Code", "--"),
      "Description": mergePreferred(locatorRow, currentRow, "Description", "--"),
      "Location": mergePreferred(locatorRow, currentRow, "Location", ""),
      "Lot Code": mergePreferred(locatorRow, currentRow, "Lot Code", ""),
      "Expiry Date": mergePreferred(locatorRow, currentRow, "Expiry Date", ""),
      "Pallet Number": mergePreferred(locatorRow, currentRow, "Pallet Number", ""),
      "Qty On Hand": toNum(locatorRow["Qty On Hand"]) > 0
        ? toNum(locatorRow["Qty On Hand"])
        : (currentRow ? toNum(currentRow["Qty On Hand"]) : 0),
      "Inventory Status": mergePreferred(locatorRow, currentRow, "Inventory Status", ""),
      "Customer Name": mergePreferred(locatorRow, currentRow, "Customer Name", ""),
      "Base UOM": mergePreferred(locatorRow, currentRow, "Base UOM", ""),
      "Inventory Category": mergePreferred(locatorRow, currentRow, "Inventory Category", ""),
      "Item Category": mergePreferred(locatorRow, currentRow, "Item Category", ""),
      "Item Class": mergePreferred(locatorRow, currentRow, "Item Class", ""),
      "Item Family": mergePreferred(locatorRow, currentRow, "Item Family", ""),
      "Item GTIN": mergePreferred(locatorRow, currentRow, "Item GTIN", ""),
      "Item Type": mergePreferred(locatorRow, currentRow, "Item Type", ""),
      "Item UPC": mergePreferred(locatorRow, currentRow, "Item UPC", ""),
      "Item Alternate Code 1": mergePreferred(locatorRow, currentRow, "Item Alternate Code 1", ""),
      "Item Alternate Code 2": mergePreferred(locatorRow, currentRow, "Item Alternate Code 2", ""),
      "Case Quantity": mergePreferred(locatorRow, currentRow, "Case Quantity", ""),
      "Case UOM": mergePreferred(locatorRow, currentRow, "Case UOM", ""),
      "Default Quantity": mergePreferred(locatorRow, currentRow, "Default Quantity", ""),
      "Default UOM": mergePreferred(locatorRow, currentRow, "Default UOM", ""),
      "Full Pallet Quantity": mergePreferred(locatorRow, currentRow, "Full Pallet Quantity", ""),
      "Full Pallet UOM": mergePreferred(locatorRow, currentRow, "Full Pallet UOM", ""),
      "Site Name": mergePreferred(locatorRow, currentRow, "Site Name", ""),
      "Stored Since": mergePreferred(locatorRow, currentRow, "Stored Since", ""),
      "Zone": mergePreferred(locatorRow, currentRow, "Zone", ""),
      "Inventory Value": mergePreferred(locatorRow, currentRow, "Inventory Value", ""),
      "Material Cost Per Unit": mergePreferred(locatorRow, currentRow, "Material Cost Per Unit", ""),
      "Item Weight Per Case": mergePreferred(locatorRow, currentRow, "Item Weight Per Case", ""),
      "Item Weight Per Pallet": mergePreferred(locatorRow, currentRow, "Item Weight Per Pallet", ""),
      "Source": currentRow
        ? (String(locatorRow["Source"] || "") === "pallet_aging" ? "report_enriched_inventory" : "merged_inventory")
        : (locatorRow["Source"] || "item_locator")
    };
  });

  currentRows.forEach(function(row) {
    if (!usedCurrentRows.has(row)) merged.push(row);
  });

  return coalesceRows(merged);
}

async function fetchNulogyText(path, auth) {
  const response = await fetchTextWithRetries(NULOGY_URL + path, {
    method: "GET",
    headers: {
      "Authorization": "Basic " + auth,
      "Accept": "text/csv,text/plain,text/html,application/xhtml+xml"
    }
  }, "Nulogy fetch failed");
  return {
    text: response.text,
    contentType: response.contentType || ""
  };
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function summarizeErrorText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function extractXmlErrorCode(text) {
  const match = String(text || "").match(/<Code>([^<]+)<\/Code>/i);
  return match ? String(match[1] || "").trim() : "";
}

function hasXmlErrorPayload(text, contentType) {
  const raw = String(text || "").trim();
  const normalizedType = String(contentType || "").toLowerCase();
  if (!raw) return false;
  if (normalizedType.indexOf("xml") === -1 && raw.indexOf("<?xml") !== 0) return false;
  return raw.indexOf("<Error>") !== -1 && !!extractXmlErrorCode(raw);
}

function isRetryableXmlError(text, contentType) {
  if (!hasXmlErrorPayload(text, contentType)) return false;
  return !!RETRYABLE_XML_ERROR_CODES[extractXmlErrorCode(text)];
}

function isRetryableFetchError(error) {
  const causeCode = String(error && error.cause && error.cause.code || "").toUpperCase();
  if (
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  const message = String(error && error.message || "").toLowerCase();
  return (
    message.indexOf("fetch failed") !== -1 ||
    message.indexOf("socket") !== -1 ||
    message.indexOf("timeout") !== -1 ||
    message.indexOf("econnreset") !== -1
  );
}

async function fetchTextWithRetries(url, options, errorLabel) {
  let lastError = null;

  for (let attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, options);
      const text = await response.text().catch(function() { return ""; });
      const contentType = response.headers.get("content-type") || "";
      const xmlErrorPayload = hasXmlErrorPayload(text, contentType);
      const retryableXmlError = isRetryableXmlError(text, contentType);

      if (!response.ok || xmlErrorPayload) {
        const prefix = attempt > 1 ? (errorLabel + " after " + attempt + " attempts") : errorLabel;
        const error = new Error(prefix + " (" + response.status + "): " + summarizeErrorText(text));
        error.statusCode = response.status;
        error.retryable = !!RETRYABLE_FETCH_STATUSES[response.status] || retryableXmlError;
        error.responseText = summarizeErrorText(text);
        error.contentType = contentType;
        lastError = error;
        if (error.retryable && attempt < FETCH_RETRY_ATTEMPTS) {
          await sleep(FETCH_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }
        throw error;
      }

      return {
        text: text,
        contentType: contentType
      };
    } catch (error) {
      lastError = error;
      const retryable = typeof (error && error.retryable) === "boolean"
        ? error.retryable
        : isRetryableFetchError(error);
      if (retryable && attempt < FETCH_RETRY_ATTEMPTS) {
        await sleep(FETCH_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error(errorLabel + " failed.");
}

function summarizeReportFailure(result, report) {
  const body = result && result.body ? result.body : {};
  const messages = Array.isArray(body.failureMessages) ? body.failureMessages.filter(Boolean) : [];
  if (messages.length) return messages.join(" | ");
  if (body.error) return String(body.error);
  return "Failed to run " + report + ".";
}

async function fetchReportCsv(report, columns) {
  const executed = await executeReportRun({
    report: report,
    columns: columns,
    waitForCompletion: true,
    pollIntervalMs: 2500,
    maxPolls: 60
  });
  if (!executed.ok) {
    throw new Error(summarizeReportFailure(executed, report));
  }
  const body = executed.body || {};
  if (!body.downloadUrl) {
    throw new Error("Completed " + report + " run did not return a download URL.");
  }
  const downloadResult = await fetchTextWithRetries(body.downloadUrl, {
    method: "GET",
    headers: {
      "Accept": "text/csv,text/plain,application/xml,text/xml"
    }
  }, "Failed to download " + report + " CSV");
  const csvText = downloadResult.text;
  const parsedRows = parseCSV(csvText);
  return {
    report: report,
    rows: parsedRows,
    headers: parsedRows.length ? Object.keys(parsedRows[0]) : [],
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    statusHistory: Array.isArray(body.statusHistory) ? body.statusHistory : []
  };
}

async function fetchReportInventoryData() {
  const attempts = [];
  let snapshotRows = [];
  let snapshotHeaders = [];
  let palletRows = [];
  let palletHeaders = [];

  try {
    const inventorySnapshot = await fetchReportCsv("inventory_snapshot", INVENTORY_SNAPSHOT_COLUMNS);
    snapshotHeaders = inventorySnapshot.headers || [];
    snapshotRows = parseCurrentInventoryRows(inventorySnapshot.rows, "inventory_snapshot_report");
    attempts.push({
      key: "inventory_snapshot_report",
      format: "csv",
      headers: snapshotHeaders,
      rowCount: snapshotRows.length,
      warnings: inventorySnapshot.warnings || []
    });
  } catch (error) {
    attempts.push({
      key: "inventory_snapshot_report",
      error: error && error.message ? error.message : "unknown"
    });
  }

  try {
    const palletAging = await fetchReportCsv("pallet_aging", PALLET_AGING_COLUMNS);
    palletHeaders = palletAging.headers || [];
    palletRows = parseLocatorRows(palletAging.rows, "pallet_aging");
    attempts.push({
      key: "pallet_aging_report",
      format: "csv",
      headers: palletHeaders,
      rowCount: palletRows.length,
      warnings: palletAging.warnings || []
    });
  } catch (error) {
    attempts.push({
      key: "pallet_aging_report",
      error: error && error.message ? error.message : "unknown"
    });
  }

  const mergedRows = snapshotRows.length && palletRows.length
    ? mergeInventoryRows(snapshotRows, palletRows)
    : (palletRows.length ? coalesceRows(palletRows) : coalesceRows(snapshotRows));

  if (!mergedRows.length) {
    const detail = attempts.map(function(attempt) {
      return attempt.key + ":" + (attempt.error || ("0 rows (" + (attempt.format || "unknown") + ")"));
    }).join(" | ");
    const error = new Error("No usable report-backed inventory source returned rows. " + detail);
    error.attempts = attempts;
    throw error;
  }

  return {
    data: mergedRows,
    attempts: attempts,
    inventorySeedSource: snapshotRows.length ? "inventory_snapshot_report" : (palletRows.length ? "pallet_aging_report" : ""),
    inventorySeedHeaders: snapshotHeaders,
    inventorySeedRows: snapshotRows.length,
    itemLocatorHeaders: palletHeaders,
    itemLocatorRows: palletRows.length
  };
}

async function fetchInventorySeed(auth) {
  const attempts = [];
  const sources = [
    { key: "inventory_snapshot", label: "inventory snapshot", path: buildInventorySnapshotPath() },
    { key: "current_inventory", label: "current inventory", path: CURRENT_INVENTORY_PATH }
  ];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    try {
      const payload = await fetchNulogyText(source.path, auth);
      const parsed = parseUnknownInventoryPayload(payload.text, payload.contentType);
      const rows = parseCurrentInventoryRows(parsed.rows, source.key);
      attempts.push({
        key: source.key,
        format: parsed.format || "",
        contentType: payload.contentType || "",
        headers: parsed.headers || [],
        rowCount: rows.length
      });
      if (rows.length) {
        return {
          sourceKey: source.key,
          headers: parsed.headers || [],
          rows: rows,
          format: parsed.format || "",
          contentType: payload.contentType || "",
          attempts: attempts
        };
      }
    } catch (err) {
      attempts.push({
        key: source.key,
        error: err && err.message ? err.message : "unknown"
      });
    }
  }

  const detail = attempts.map(function(attempt) {
    return attempt.key + ":" + (attempt.error || ("0 rows (" + (attempt.format || "unknown") + ")"));
  }).join(" | ");
  const error = new Error("No usable inventory source returned rows. " + detail);
  error.attempts = attempts;
  throw error;
}

function parseUnknownInventoryPayload(text, contentType) {
  if (looksLikeCsv(text, contentType)) {
    const rows = parseCSV(text);
    return {
      headers: rows.length ? Object.keys(rows[0]) : [],
      rows: rows,
      format: "csv"
    };
  }
  const tables = parseHtmlTables(text);
  const best = chooseBestHtmlTable(tables);
  return {
    headers: best && Array.isArray(best.headers) ? best.headers : [],
    rows: best && Array.isArray(best.rows) ? best.rows : [],
    format: "html"
  };
}

function isTruthyQueryValue(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = process.env.NULOGY_USER;
  const pass = process.env.NULOGY_PASS;
  if (!user || !pass) {
    return res.status(500).json({ error: "Nulogy credentials not configured." });
  }

  const auth = Buffer.from(user + ":" + pass).toString("base64");
  const mode = String((req.query && req.query.mode) || "detail").toLowerCase() === "compact" ? "compact" : "detail";
  const includeDetail = isTruthyQueryValue(req.query && req.query.includeDetail);

  try {
    try {
      const reportData = await fetchReportInventoryData();
      const outputRows = mode === "compact" ? compactInventoryRows(reportData.data) : reportData.data;
      const body = {
        data: outputRows,
        rowCount: outputRows.length,
        columns: outputRows.length ? Object.keys(outputRows[0]) : [],
        diagnostics: {
          mode: mode,
          sourceRowCount: reportData.data.length,
          inventorySeedSource: reportData.inventorySeedSource,
          inventorySeedHeaders: reportData.inventorySeedHeaders || [],
          inventorySeedRows: reportData.inventorySeedRows || 0,
          inventorySeedFormat: "csv",
          inventorySeedContentType: "text/csv",
          inventorySeedAttempts: (reportData.attempts || []).map(function(attempt) {
            return {
              key: attempt.key,
              format: attempt.format,
              headers: attempt.headers,
              rowCount: attempt.rowCount,
              error: attempt.error,
              warnings: attempt.warnings
            };
          }),
          itemLocatorHeaders: reportData.itemLocatorHeaders || [],
          itemLocatorRows: reportData.itemLocatorRows || 0,
          itemLocatorFormat: "csv",
          itemLocatorError: ""
        }
      };
      if (includeDetail && mode === "compact") {
        body.detailData = reportData.data;
        body.detailRowCount = reportData.data.length;
      }
      return res.status(200).json(body);
    } catch (reportErr) {
      Sentry.captureException(reportErr);
    }

    const inventorySeed = await fetchInventorySeed(auth);

    let itemLocatorHeaders = [];
    let itemLocatorRows = [];
    let itemLocatorError = "";
    let itemLocatorFormat = "";

    try {
      const locatorPayload = await fetchNulogyText(ITEM_LOCATOR_PATH, auth);
      const locatorParsed = parseUnknownInventoryPayload(locatorPayload.text, locatorPayload.contentType);
      itemLocatorHeaders = locatorParsed.headers || [];
      itemLocatorRows = parseLocatorRows(locatorParsed.rows, "item_locator");
      itemLocatorFormat = locatorParsed.format || "";
    } catch (locatorErr) {
      itemLocatorError = locatorErr && locatorErr.message ? locatorErr.message : "unknown_locator_error";
      Sentry.captureException(locatorErr);
    }

    const mergedRows = mergeInventoryRows(inventorySeed.rows, itemLocatorRows);
    const outputRows = mode === "compact" ? compactInventoryRows(mergedRows) : mergedRows;

    const body = {
      data: outputRows,
      rowCount: outputRows.length,
      columns: outputRows.length ? Object.keys(outputRows[0]) : [],
      diagnostics: {
        mode: mode,
        sourceRowCount: mergedRows.length,
        inventorySeedSource: inventorySeed.sourceKey,
        inventorySeedHeaders: inventorySeed.headers || [],
        inventorySeedRows: inventorySeed.rows.length,
        inventorySeedFormat: inventorySeed.format || "",
        inventorySeedContentType: inventorySeed.contentType || "",
        inventorySeedAttempts: (inventorySeed.attempts || []).map(function(attempt) {
          return {
            key: attempt.key,
            format: attempt.format,
            contentType: attempt.contentType,
            headers: attempt.headers,
            rowCount: attempt.rowCount,
            error: attempt.error
          };
        }),
        itemLocatorHeaders: itemLocatorHeaders,
        itemLocatorRows: itemLocatorRows.length,
        itemLocatorFormat: itemLocatorFormat,
        itemLocatorError: itemLocatorError
      }
    };
    if (includeDetail && mode === "compact") {
      body.detailData = mergedRows;
      body.detailRowCount = mergedRows.length;
    }
    return res.status(200).json(body);
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Rich inventory pull failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
