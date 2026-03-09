// POST /api/nulogy/item-cost
// Body: { itemIds: [9690881, ...] }
// Pulls Cost per unit from Nulogy item information page HTML as fallback.

import Sentry from "../_sentry.js";

const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";

function toNum(value) {
  if (value == null || value === "") return 0;
  var n = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function extractCostFromHtml(html) {
  if (!html) return 0;
  // Primary hook from provided page source.
  var m = html.match(/spec-cost-per-unit-value[^>]*>\s*([^<]+)\s*</i);
  if (m && m[1]) return toNum(m[1]);

  // Label/value fallback.
  var m2 = html.match(/Cost per unit[\s\S]{0,400}?card__field-value[^>]*>\s*([^<]+)\s*</i);
  if (m2 && m2[1]) return toNum(m2[1]);
  return 0;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var user = process.env.NULOGY_USER;
  var pass = process.env.NULOGY_PASS;
  if (!user || !pass) return res.status(500).json({ error: "Nulogy credentials not configured." });

  var body = req.body || {};
  var itemIds = Array.isArray(body.itemIds) ? body.itemIds : [];
  var cleanIds = itemIds
    .map(function(v) { return String(v || "").trim(); })
    .filter(function(v) { return /^\d+$/.test(v); })
    .slice(0, 250);
  if (!cleanIds.length) return res.status(400).json({ error: "No valid itemIds provided." });

  var auth = Buffer.from(user + ":" + pass).toString("base64");
  var out = {};
  var misses = [];

  for (var i = 0; i < cleanIds.length; i++) {
    var id = cleanIds[i];
    try {
      var url = NULOGY_URL + "/items/" + id + "/item_information_section";
      var r = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": "Basic " + auth,
          "Accept": "text/html,application/xhtml+xml"
        }
      });
      if (!r.ok) {
        misses.push({ itemId: id, status: r.status });
        continue;
      }
      var html = await r.text();
      var cost = extractCostFromHtml(html);
      if (cost > 0) out[id] = cost;
      else misses.push({ itemId: id, status: 200 });
    } catch (err) {
      Sentry.captureException(err);
      misses.push({ itemId: id, status: 0 });
    }
  }

  return res.status(200).json({
    requested: cleanIds.length,
    found: Object.keys(out).length,
    costsByItemId: out,
    misses: misses.slice(0, 50)
  });
}

