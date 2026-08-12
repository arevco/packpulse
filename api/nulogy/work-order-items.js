import Sentry from "../_sentry.js";
import { getAuthenticatedUser } from "../_session.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const itemCache = new Map();

function cleanWorkOrder(input) {
  var workOrderId = String(input && input.workOrderId || "").trim();
  var sku = String(input && input.sku || "").trim();
  return /^\d+$/.test(workOrderId) ? { workOrderId: workOrderId, sku: sku.slice(0, 160) } : null;
}

function extractItem(html) {
  var matches = Array.from(String(html || "").matchAll(/\/items\/(\d+)\/item_information_section/gi));
  if (!matches.length) return null;
  return { itemId: matches[0][1], itemUrl: NULOGY_URL + "/items/" + matches[0][1] + "/item_information_section" };
}

async function resolveItem(auth, workOrder) {
  var cached = itemCache.get(workOrder.workOrderId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.value;
  var response = await fetch(NULOGY_URL + "/work_orders/" + workOrder.workOrderId, {
    headers: { Authorization: auth, Accept: "text/html,application/xhtml+xml" }
  });
  if (!response.ok) return null;
  var item = extractItem(await response.text());
  var value = item ? Object.assign({ workOrderId: workOrder.workOrderId, sku: workOrder.sku }, item) : null;
  itemCache.set(workOrder.workOrderId, { cachedAt: Date.now(), value: value });
  return value;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    if (!getAuthenticatedUser(req)) return res.status(401).json({ error: "Unauthorized" });
    var user = process.env.NULOGY_USER;
    var pass = process.env.NULOGY_PASS;
    if (!user || !pass) return res.status(500).json({ error: "Nulogy credentials not configured." });
    var seen = {};
    var requested = (Array.isArray(req.body && req.body.workOrders) ? req.body.workOrders : []).map(cleanWorkOrder).filter(function(row) {
      if (!row || seen[row.workOrderId]) return false;
      seen[row.workOrderId] = true;
      return true;
    }).slice(0, 100);
    var auth = "Basic " + Buffer.from(user + ":" + pass).toString("base64");
    var items = [];
    for (var offset = 0; offset < requested.length; offset += 6) {
      var batch = await Promise.all(requested.slice(offset, offset + 6).map(function(row) { return resolveItem(auth, row); }));
      items = items.concat(batch.filter(Boolean));
    }
    return res.status(200).json({ items: items, requested: requested.length, resolved: items.length });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error.message || "Could not resolve Nulogy item links." });
  }
}
