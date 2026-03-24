import Sentry from "../_sentry.js";

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
          "Source": sourceLabel || "current_inventory"
        });
      }
    }
  });
  return out;
}

function parseLocatorRows(rows) {
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
        "Source": "item_locator"
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
        "Source": "item_locator"
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
  });
  return Object.values(grouped);
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
      "Item Code": locatorRow["Item Code"] || (currentRow && currentRow["Item Code"]) || "--",
      "Description": locatorRow["Description"] || (currentRow && currentRow["Description"]) || "--",
      "Location": locatorRow["Location"] || "",
      "Lot Code": locatorRow["Lot Code"] || (currentRow && currentRow["Lot Code"]) || "",
      "Expiry Date": locatorRow["Expiry Date"] || (currentRow && currentRow["Expiry Date"]) || "",
      "Pallet Number": locatorRow["Pallet Number"] || (currentRow && currentRow["Pallet Number"]) || "",
      "Qty On Hand": toNum(locatorRow["Qty On Hand"]) > 0
        ? toNum(locatorRow["Qty On Hand"])
        : (currentRow ? toNum(currentRow["Qty On Hand"]) : 0),
      "Inventory Status": locatorRow["Inventory Status"] || (currentRow && currentRow["Inventory Status"]) || "",
      "Customer Name": locatorRow["Customer Name"] || (currentRow && currentRow["Customer Name"]) || "",
      "Base UOM": locatorRow["Base UOM"] || (currentRow && currentRow["Base UOM"]) || "",
      "Source": currentRow ? "merged_inventory" : "item_locator"
    };
  });

  currentRows.forEach(function(row) {
    if (!usedCurrentRows.has(row)) merged.push(row);
  });

  return coalesceRows(merged);
}

async function fetchNulogyText(path, auth) {
  const response = await fetch(NULOGY_URL + path, {
    method: "GET",
    headers: {
      "Authorization": "Basic " + auth,
      "Accept": "text/csv,text/plain,text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(function() { return ""; });
    throw new Error("Nulogy fetch failed (" + response.status + "): " + String(text || "").slice(0, 180));
  }
  return {
    text: await response.text(),
    contentType: response.headers.get("content-type") || ""
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
        headers: parsed.headers || [],
        rowCount: rows.length
      });
      if (rows.length) {
        return {
          sourceKey: source.key,
          headers: parsed.headers || [],
          rows: rows,
          format: parsed.format || "",
          attempts: attempts
        };
      }
    } catch (err) {
      attempts.push({
        key: source.key,
        error: err && err.message ? err.message : "unknown"
      });
      Sentry.captureException(err);
    }
  }

  const detail = attempts.map(function(attempt) {
    return attempt.key + ":" + (attempt.error || ("0 rows (" + (attempt.format || "unknown") + ")"));
  }).join(" | ");
  throw new Error("No usable inventory source returned rows. " + detail);
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

  try {
    const inventorySeed = await fetchInventorySeed(auth);

    let itemLocatorHeaders = [];
    let itemLocatorRows = [];
    let itemLocatorError = "";
    let itemLocatorFormat = "";

    try {
      const locatorPayload = await fetchNulogyText(ITEM_LOCATOR_PATH, auth);
      const locatorParsed = parseUnknownInventoryPayload(locatorPayload.text, locatorPayload.contentType);
      itemLocatorHeaders = locatorParsed.headers || [];
      itemLocatorRows = parseLocatorRows(locatorParsed.rows);
      itemLocatorFormat = locatorParsed.format || "";
    } catch (locatorErr) {
      itemLocatorError = locatorErr && locatorErr.message ? locatorErr.message : "unknown_locator_error";
      Sentry.captureException(locatorErr);
    }

    const mergedRows = mergeInventoryRows(inventorySeed.rows, itemLocatorRows);

    return res.status(200).json({
      data: mergedRows,
      rowCount: mergedRows.length,
      columns: mergedRows.length ? Object.keys(mergedRows[0]) : [],
      diagnostics: {
        inventorySeedSource: inventorySeed.sourceKey,
        inventorySeedHeaders: inventorySeed.headers || [],
        inventorySeedRows: inventorySeed.rows.length,
        inventorySeedFormat: inventorySeed.format || "",
        inventorySeedAttempts: inventorySeed.attempts || [],
        itemLocatorHeaders: itemLocatorHeaders,
        itemLocatorRows: itemLocatorRows.length,
        itemLocatorFormat: itemLocatorFormat,
        itemLocatorError: itemLocatorError
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Rich inventory pull failed",
      details: err && err.message ? err.message : "unknown"
    });
  }
}
