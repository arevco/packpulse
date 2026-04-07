import Sentry from "../_sentry.js";
import { parseCSV, transformColumns } from "./download.js";
import { NULOGY_URL, getNulogyCredentials, buildAuthHeader } from "./_runner.js";

const RECEIVE_ORDER_COLUMNS = [
  "actual_ship_at",
  "actual_unit_quantity",
  "carrier_name",
  "expected_delivery_at",
  "expected_ship_at",
  "expected_unit_quantity",
  "internal_notes",
  "item_alternate_code_2",
  "item_alternate_code_1",
  "item_category_name",
  "item_class",
  "item_code",
  "item_customer",
  "item_description",
  "item_family_name",
  "item_gtin",
  "item_material_cost_per_unit",
  "item_type_name",
  "item_upc",
  "purchase_price_per_unit",
  "number_of_receipts",
  "purchaser",
  "receive_order_code",
  "receive_order_customer",
  "received",
  "reference",
  "ro_date_at",
  "site_name",
  "status",
  "unit_of_measure",
  "vendor_name",
  "vendor_notes",
  "project_code"
];

const DEFAULT_RECEIVE_ORDERS_COMPLETED_REPORT_ID = String(
  process.env.NULOGY_RECEIVE_ORDERS_COMPLETED_REPORT_ID || "68542516"
).trim();

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildDefaultReceiveOrdersPath() {
  const params = new URLSearchParams();
  params.set("button", "");
  params.set("generate_flag", "true");
  params.set("filter_choice", "item_customer");
  RECEIVE_ORDER_COLUMNS.forEach(function(column, index) {
    params.set(`columns[${index}]`, column);
  });
  params.set("order_by", "receive_order_id");
  params.set("order_direction", "desc");
  if (DEFAULT_RECEIVE_ORDERS_COMPLETED_REPORT_ID) {
    params.set("completed_report_id", DEFAULT_RECEIVE_ORDERS_COMPLETED_REPORT_ID);
  }
  return "/canned_reports/receive_order?" + params.toString();
}

function getReceiveOrdersPath() {
  const configured = String(process.env.NULOGY_RECEIVE_ORDERS_PATH || "").trim();
  if (!configured) return buildDefaultReceiveOrdersPath();
  if (/^https?:\/\//i.test(configured)) {
    return configured.replace(NULOGY_URL, "");
  }
  return configured.startsWith("/") ? configured : "/" + configured;
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
    .replace(/&#x([0-9a-f]+);/gi, function(_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    })
    .replace(/&#(\d+);/g, function(_, dec) {
      return String.fromCharCode(parseInt(dec, 10));
    });
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
        const key = normalizeKey(cell);
        return key.includes("receiveorder") || key.includes("expecteddelivery") || key.includes("itemcode");
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
    return { headers, rows: dataRows };
  }).filter(Boolean);
}

function chooseBestReceiveOrdersTable(tables) {
  let best = null;
  let bestScore = -1;
  (Array.isArray(tables) ? tables : []).forEach(function(table) {
    const headers = Array.isArray(table && table.headers) ? table.headers : [];
    const score = headers.reduce(function(sum, header) {
      const key = normalizeKey(header);
      if (key.includes("receiveordercode")) sum += 8;
      if (key.includes("receiveorder")) sum += 6;
      if (key.includes("itemcode")) sum += 6;
      if (key.includes("expecteddelivery")) sum += 6;
      if (key.includes("expectedquantity")) sum += 5;
      if (key.includes("received")) sum += 4;
      if (key.includes("reference")) sum += 3;
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
  if (!prefix) return false;
  if (prefix.startsWith("<!doctype html") || prefix.startsWith("<html")) return false;
  return prefix.includes(",") && prefix.includes("\n");
}

function absolutizeUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (text.startsWith("//")) return "https:" + text;
  if (text.startsWith("/")) return NULOGY_URL + text;
  return NULOGY_URL + "/" + text.replace(/^\/+/, "");
}

function extractCsvUrl(html) {
  const text = String(html || "");
  const matches = Array.from(text.matchAll(/href\s*=\s*["']([^"']+)["']/gi));
  for (let i = 0; i < matches.length; i++) {
    const href = matches[i] && matches[i][1] ? decodeHtml(matches[i][1]) : "";
    const lowered = href.toLowerCase();
    if (lowered.includes(".csv") || lowered.includes("background-reports-")) {
      return absolutizeUrl(href);
    }
  }
  return "";
}

async function fetchText(url, authHeader) {
  const absoluteUrl = absolutizeUrl(url);
  const response = await fetch(absoluteUrl, {
    method: "GET",
    headers: {
      "Accept": "text/csv,text/plain,text/html,application/xhtml+xml",
      ...(absoluteUrl.startsWith(NULOGY_URL) ? { "Authorization": authHeader } : {})
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error("Nulogy fetch failed (" + response.status + "): " + String(text || "").slice(0, 240));
  }
  return {
    url: absoluteUrl,
    finalUrl: response.url || absoluteUrl,
    contentType: response.headers.get("content-type") || "",
    text
  };
}

function parseReceiveOrdersPayload(payload) {
  if (looksLikeCsv(payload && payload.text, payload && payload.contentType)) {
    const rows = parseCSV(String(payload && payload.text || ""));
    return {
      rows,
      format: "csv",
      csvUrl: payload && payload.finalUrl ? payload.finalUrl : payload && payload.url ? payload.url : ""
    };
  }

  const csvUrl = extractCsvUrl(payload && payload.text);
  if (csvUrl) {
    return {
      rows: [],
      format: "html_link",
      csvUrl
    };
  }

  const tables = parseHtmlTables(payload && payload.text);
  const best = chooseBestReceiveOrdersTable(tables);
  return {
    rows: best && Array.isArray(best.rows) ? best.rows : [],
    format: "html_table",
    csvUrl: "",
    headers: best && Array.isArray(best.headers) ? best.headers : []
  };
}

export async function fetchReceiveOrdersDirect() {
  let credentials;
  try {
    credentials = getNulogyCredentials();
  } catch (error) {
    return {
      ok: false,
      statusCode: 500,
      body: { error: error.message }
    };
  }

  const authHeader = buildAuthHeader(credentials.user, credentials.pass);
  const sourcePath = getReceiveOrdersPath();

  try {
    const initialPayload = await fetchText(sourcePath, authHeader);
    let parsed = parseReceiveOrdersPayload(initialPayload);
    let payloadUsed = initialPayload;

    if (parsed.csvUrl && !parsed.rows.length) {
      payloadUsed = await fetchText(parsed.csvUrl, authHeader);
      parsed = parseReceiveOrdersPayload(payloadUsed);
    }

    const rawRows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const transformed = transformColumns(rawRows, "receiveorders");
    const originalHeaders = rawRows.length ? Object.keys(rawRows[0]) : (parsed.headers || []);

    return {
      ok: true,
      statusCode: 200,
      body: {
        data: transformed,
        rowCount: transformed.length,
        reportType: "receiveorders",
        columns: transformed.length ? Object.keys(transformed[0]) : [],
        originalHeaders,
        diagnostics: {
          source: "canned_report",
          sourcePath,
          fetchedUrl: payloadUsed.url,
          finalUrl: payloadUsed.finalUrl,
          contentType: payloadUsed.contentType,
          parsedFormat: parsed.format || "",
          csvUrl: parsed.csvUrl || "",
          rawRowCount: rawRows.length
        }
      }
    };
  } catch (error) {
    Sentry.captureException(error);
    return {
      ok: false,
      statusCode: 500,
      body: {
        error: "Failed to fetch Receive Orders export: " + (error && error.message ? error.message : "unknown")
      }
    };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const result = await fetchReceiveOrdersDirect();
  return res.status(result.statusCode).json(result.body);
}
