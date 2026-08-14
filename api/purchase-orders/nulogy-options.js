import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";
import { key, text } from "./_service.js";

function pick(row, names) {
  var keys = Object.keys(row || {});
  for (var i = 0; i < names.length; i++) {
    var wanted = key(names[i]);
    for (var j = 0; j < keys.length; j++) {
      if (key(keys[j]) === wanted) return row[keys[j]];
    }
  }
  return "";
}

function uniqueStrings(values) {
  var seen = {};
  return values.filter(function(value) {
    var normalized = key(value);
    if (!normalized || seen[normalized]) return false;
    seen[normalized] = true;
    return true;
  }).sort(function(a, b) { return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }); });
}

export default async function handler(req, res) {
  if (withCors(req, res, "GET,OPTIONS")) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    var user = await getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    var supabase = getSupabaseAdmin();
    var result = await supabase.from("cache_snapshots").select("payload,synced_at").eq("site_id", CACHE_SITE_ID).maybeSingle();
    if (result.error) throw result.error;
    var payload = result.data && result.data.payload && typeof result.data.payload === "object" ? result.data.payload : {};
    var inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
    var itemMaster = Array.isArray(payload.itemMaster) ? payload.itemMaster : [];
    var workOrders = Array.isArray(payload.workOrders) ? payload.workOrders : [];
    var allRows = itemMaster.concat(inventory, workOrders);
    var customers = uniqueStrings(allRows.map(function(row) {
      return text(pick(row, ["Customer Name", "customer_name", "Customer", "Item Customer", "item_customer", "Item Customer Name", "item_customer_name", "Work Order Customer", "project_customer_name"]), 240);
    }));
    var itemMap = {};
    itemMaster.concat(inventory).forEach(function(row) {
      var sku = text(pick(row, ["Item Code", "item_code", "Code", "code", "SKU", "Product SKU", "product_sku"]), 160);
      if (!sku || itemMap[key(sku)]) return;
      itemMap[key(sku)] = {
        sku: sku,
        description: text(pick(row, ["Item Description", "item_description", "Description", "description", "Product Description", "product_description"]), 500),
        customer: text(pick(row, ["Customer Name", "customer_name", "Customer", "Item Customer Name", "item_customer_name"]), 240)
      };
    });
    var items = Object.keys(itemMap).map(function(itemKey) { return itemMap[itemKey]; }).sort(function(a, b) { return a.sku.localeCompare(b.sku, undefined, { numeric: true }); });
    return res.status(200).json({ customers: customers, items: items, syncedAt: result.data && result.data.synced_at || null });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Could not load Nulogy options" });
  }
}
