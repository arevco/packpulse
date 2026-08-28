import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "../ops/_common.js";
import { key, text } from "./_service.js";

function pick(row, names) {
  var rowKeys = Object.keys(row || {});
  for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
    var wanted = key(names[nameIndex]);
    for (var keyIndex = 0; keyIndex < rowKeys.length; keyIndex++) {
      if (key(rowKeys[keyIndex]) === wanted) return row[rowKeys[keyIndex]];
    }
  }
  return "";
}

function normalizedRow(row, source, sourceRank) {
  var customer = text(pick(row, [
    "Customer Name", "customer_name", "Customer", "Item Customer", "item_customer",
    "Item Customer Name", "item_customer_name", "Work Order Customer", "project_customer_name"
  ]), 240);
  var sku = text(pick(row, ["Item Code", "item_code", "Code", "code", "SKU", "Product SKU", "product_sku"]), 160);
  var description = text(pick(row, [
    "Item Description", "item_description", "Description", "description",
    "Product Description", "product_description", "Project Description", "project_description"
  ]), 500);
  var rawPrice = pick(row, [
    "Purchase Price Per Unit", "purchase_price_per_unit", "Price Per Unit", "price_per_unit",
    "Unit Price", "unit_price", "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ]);
  var price = toNum(String(rawPrice == null ? "" : rawPrice).replace(/[$,]/g, ""));
  return { customer: customer, sku: sku, description: description, price: price > 0 ? price : null, source: source, sourceRank: sourceRank };
}

function buildRows(payload) {
  var sources = [
    { name: "Item Master", rank: 3, rows: Array.isArray(payload.itemMaster) ? payload.itemMaster : [] },
    { name: "Inventory", rank: 2, rows: Array.isArray(payload.inventory) ? payload.inventory : [] },
    { name: "Work Orders", rank: 1, rows: Array.isArray(payload.workOrders) ? payload.workOrders : [] }
  ];
  var rowsByKey = {};
  sources.forEach(function(source) {
    source.rows.forEach(function(raw) {
      var row = normalizedRow(raw, source.name, source.rank);
      if (!row.sku) return;
      var rowKey = key(row.customer) + "|" + key(row.sku);
      var current = rowsByKey[rowKey];
      if (!current) {
        rowsByKey[rowKey] = row;
        return;
      }
      var replace = (!current.price && row.price) || (Boolean(current.price) === Boolean(row.price) && row.sourceRank > current.sourceRank);
      if (replace) rowsByKey[rowKey] = Object.assign({}, row, { description: row.description || current.description, customer: row.customer || current.customer });
      else {
        if (!current.description && row.description) current.description = row.description;
        if (!current.customer && row.customer) current.customer = row.customer;
      }
    });
  });
  return Object.keys(rowsByKey).map(function(rowKey) {
    var row = rowsByKey[rowKey];
    return { id: rowKey, customer: row.customer, sku: row.sku, description: row.description, price: row.price, source: row.source };
  });
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var result = await getSupabaseAdmin().from("cache_snapshots").select("payload,synced_at").eq("site_id", CACHE_SITE_ID).maybeSingle();
    if (result.error) throw result.error;
    var payload = result.data && result.data.payload && typeof result.data.payload === "object" ? result.data.payload : {};
    var search = text(req.query && req.query.q, 160).toLowerCase();
    var sort = text(req.query && req.query.sort, 40) || "customer";
    var direction = text(req.query && req.query.direction, 4).toLowerCase() === "desc" ? -1 : 1;
    var page = Math.max(1, Number(req.query && req.query.page) || 1);
    var pageSize = Math.min(100, Math.max(10, Number(req.query && req.query.pageSize) || 50));
    var rows = buildRows(payload).filter(function(row) {
      if (!search) return true;
      return [row.customer, row.sku, row.description].some(function(value) { return String(value || "").toLowerCase().indexOf(search) !== -1; });
    });
    var allowedSorts = { customer: true, sku: true, description: true, price: true };
    if (!allowedSorts[sort]) sort = "customer";
    rows.sort(function(left, right) {
      if (sort === "price") return ((left.price == null ? -1 : left.price) - (right.price == null ? -1 : right.price)) * direction;
      var compared = String(left[sort] || "").localeCompare(String(right[sort] || ""), undefined, { sensitivity: "base", numeric: true });
      return compared * direction || String(left.sku || "").localeCompare(String(right.sku || ""), undefined, { numeric: true });
    });
    var total = rows.length;
    var offset = (page - 1) * pageSize;
    return res.status(200).json({ rows: rows.slice(offset, offset + pageSize), total: total, page: page, pageSize: pageSize, syncedAt: result.data && result.data.synced_at || null });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Could not load pricing" });
  }
}
