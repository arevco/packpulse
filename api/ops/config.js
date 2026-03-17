import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, toNum, withCors } from "./_common.js";

const DEFAULT_RATES = [
  { role: "labor", hourly_rate: 20.17, markup_pct: 0 },
  { role: "operator", hourly_rate: 27.22, markup_pct: 0 },
  { role: "fork", hourly_rate: 27.73, markup_pct: 0 },
  { role: "qa", hourly_rate: 22.20, markup_pct: 0 },
  { role: "maint", hourly_rate: 37.06, markup_pct: 0 },
  { role: "recycling", hourly_rate: 20.17, markup_pct: 0 }
];

function clampMonthKey(v) {
  var s = String(v || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : "";
}

function toDateIso(value) {
  var d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function normalizeLooseKey(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function pickFieldLoose(row, keys) {
  if (!row || typeof row !== "object") return "";
  var rowKeys = Object.keys(row);
  for (var i = 0; i < keys.length; i += 1) {
    var target = String(keys[i] || "").toLowerCase();
    for (var j = 0; j < rowKeys.length; j += 1) {
      var rowKey = rowKeys[j];
      if (String(rowKey || "").toLowerCase() === target) return row[rowKey];
    }
  }
  var wanted = {};
  keys.forEach(function(key) {
    wanted[normalizeLooseKey(key)] = true;
  });
  for (var x = 0; x < rowKeys.length; x += 1) {
    var looseKey = rowKeys[x];
    if (wanted[normalizeLooseKey(looseKey)]) return row[looseKey];
  }
  return "";
}

function normalizeSku(value) {
  return normalizeLooseKey(String(value || "").trim());
}

function pickItemMasterCostValue(row) {
  if (!row || typeof row !== "object") return 0;
  var keys = [
    "Cost Per Unit", "cost_per_unit", "Unit Cost", "unit_cost",
    "Standard Cost", "standard_cost", "Cost Per Base Unit", "cost_per_base_unit"
  ];
  for (var i = 0; i < keys.length; i += 1) {
    var value = pickFieldLoose(row, [keys[i]]);
    if (value != null && value !== "") {
      var numeric = toNum(value);
      if (numeric > 0) return numeric;
    }
  }
  var rowKeys = Object.keys(row);
  for (var j = 0; j < rowKeys.length; j += 1) {
    var rowKey = rowKeys[j];
    var normalized = normalizeLooseKey(rowKey || "");
    var hasCostToken = normalized.includes("cost") || normalized.includes("price");
    var looksUnitish =
      normalized.includes("unit") ||
      normalized.includes("base") ||
      normalized.includes("standard") ||
      normalized.includes("average") ||
      normalized.includes("avg") ||
      normalized === "cost" ||
      normalized === "price";
    if (hasCostToken && looksUnitish && !normalized.includes("total") && !normalized.includes("extended") && !normalized.includes("amount")) {
      var inferred = toNum(row[rowKey]);
      if (inferred > 0) return inferred;
    }
  }
  return 0;
}

function buildItemMasterCostBySku(payload) {
  var itemMasterRows = payload && Array.isArray(payload.itemMaster) ? payload.itemMaster : [];
  var map = {};
  itemMasterRows.forEach(function(row) {
    var sku = normalizeSku(pickFieldLoose(row, ["Item Code", "item_code", "Code", "code"]));
    if (!sku) return;
    var value = pickItemMasterCostValue(row);
    if (!(value > 0)) return;
    if (!map[sku] || value > map[sku]) map[sku] = value;
  });
  return map;
}

function buildHeadcountDefaults(rows) {
  var list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { defaults: {}, rowsUsed: 0 };
  var sums = { labor: 0, fork: 0, qa: 0, maint: 0, recycling: 0 };
  var count = 0;
  list.forEach(function(r) {
    if (!r || typeof r !== "object") return;
    sums.labor += toNum(r.labor_count);
    sums.fork += toNum(r.fork_count);
    sums.qa += toNum(r.qa_count);
    sums.maint += toNum(r.maint_count);
    sums.recycling += toNum(r.recycling_count);
    count += 1;
  });
  if (!count) return { defaults: {}, rowsUsed: 0 };
  var defaults = {
    labor: Math.round((sums.labor / count) * 10) / 10,
    fork: Math.round((sums.fork / count) * 10) / 10,
    qa: Math.round((sums.qa / count) * 10) / 10,
    maint: Math.round((sums.maint / count) * 10) / 10,
    recycling: Math.round((sums.recycling / count) * 10) / 10
  };
  return { defaults: defaults, rowsUsed: count };
}

function buildLineHeadcountDefaults(rows) {
  var out = {};
  (Array.isArray(rows) ? rows : []).forEach(function(r) {
    var line = String(r && r.line_name || "").trim();
    if (!line) return;
    if (!out[line]) {
      out[line] = {
        labor_sum: 0, fork_sum: 0, qa_sum: 0, maint_sum: 0, recycling_sum: 0, count: 0
      };
    }
    out[line].labor_sum += toNum(r.labor_count);
    out[line].fork_sum += toNum(r.fork_count);
    out[line].qa_sum += toNum(r.qa_count);
    out[line].maint_sum += toNum(r.maint_count);
    out[line].recycling_sum += toNum(r.recycling_count);
    out[line].count += 1;
  });
  var result = {};
  Object.keys(out).forEach(function(line) {
    var r = out[line];
    var c = Math.max(1, r.count);
    result[line] = {
      labor: Math.round((r.labor_sum / c) * 10) / 10,
      fork: Math.round((r.fork_sum / c) * 10) / 10,
      qa: Math.round((r.qa_sum / c) * 10) / 10,
      maint: Math.round((r.maint_sum / c) * 10) / 10,
      recycling: Math.round((r.recycling_sum / c) * 10) / 10
    };
  });
  return result;
}

function mergeWithDefaultRates(rates) {
  var out = Array.isArray(rates) ? rates.slice() : [];
  var seen = {};
  out.forEach(function(r) {
    var role = String(r && r.role || "").trim().toLowerCase();
    if (!role) return;
    seen[role] = true;
  });
  DEFAULT_RATES.forEach(function(d) {
    var role = String(d.role || "").trim().toLowerCase();
    if (!role || seen[role]) return;
    out.push({
      role: role,
      hourly_rate: d.hourly_rate,
      markup_pct: d.markup_pct,
      effective_from: "2000-01-01",
      effective_to: null
    });
  });
  return out;
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const supabase = getSupabaseAdmin();

    if (req.method === "GET") {
      var monthKey = clampMonthKey(req.query && req.query.monthKey);
      const ratesQ = await supabase
        .from("ops_rates")
        .select("role,hourly_rate,markup_pct,effective_from,effective_to,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .order("effective_from", { ascending: false });
      if (ratesQ.error) throw ratesQ.error;

      const targetsQ = await supabase
        .from("ops_sku_targets")
        .select("item_code,customer,revenue_per_case,target_cases_per_hour,active_from,active_to,updated_at")
        .eq("site_id", CACHE_SITE_ID)
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (targetsQ.error) throw targetsQ.error;

      var shiftRows = [];
      var shiftSource = "none";
      var shiftFrom = "";
      var shiftTo = "";
      try {
        if (monthKey) {
          shiftFrom = monthKey + "-01";
          var dt = new Date(shiftFrom + "T00:00:00Z");
          dt.setUTCMonth(dt.getUTCMonth() + 1);
          dt.setUTCDate(0);
          shiftTo = toDateIso(dt);
          var monthQ = await supabase
            .from("ops_shift_inputs")
            .select("line_name,labor_count,fork_count,qa_count,maint_count,recycling_count")
            .eq("site_id", CACHE_SITE_ID)
            .gte("date_et", shiftFrom)
            .lte("date_et", shiftTo)
            .limit(10000);
          if (monthQ.error) throw monthQ.error;
          shiftRows = Array.isArray(monthQ.data) ? monthQ.data : [];
          shiftSource = "month";
        } else {
          var trailingFrom = toDateIso(new Date(Date.now() - (90 * 86400000)));
          var trailingQ = await supabase
            .from("ops_shift_inputs")
            .select("line_name,labor_count,fork_count,qa_count,maint_count,recycling_count")
            .eq("site_id", CACHE_SITE_ID)
            .gte("date_et", trailingFrom)
            .order("date_et", { ascending: false })
            .limit(10000);
          if (trailingQ.error) throw trailingQ.error;
          shiftRows = Array.isArray(trailingQ.data) ? trailingQ.data : [];
          shiftSource = "trailing_90d";
          shiftFrom = trailingFrom;
          shiftTo = toDateIso(new Date());
        }
      } catch (shiftErr) {
        var msg = String(shiftErr && shiftErr.message || "");
        if (!msg.includes("ops_shift_inputs") || !msg.includes("schema cache")) throw shiftErr;
        shiftRows = [];
        shiftSource = "missing_table";
      }
      var hc = buildHeadcountDefaults(shiftRows);
      var lineHc = buildLineHeadcountDefaults(shiftRows);

      let rates = Array.isArray(ratesQ.data) ? ratesQ.data : [];
      if (!rates.length) rates = DEFAULT_RATES.map(function(r) { return Object.assign({ effective_from: "2000-01-01", effective_to: null }, r); });
      rates = mergeWithDefaultRates(rates);

      var itemMasterCostBySku = {};
      try {
        var snapshotQ = await supabase
          .from("cache_snapshots")
          .select("payload")
          .eq("site_id", CACHE_SITE_ID)
          .maybeSingle();
        if (!snapshotQ.error && snapshotQ.data && snapshotQ.data.payload && typeof snapshotQ.data.payload === "object") {
          itemMasterCostBySku = buildItemMasterCostBySku(snapshotQ.data.payload);
        }
      } catch (snapshotErr) {
        var snapshotMsg = String(snapshotErr && snapshotErr.message || "");
        if (!snapshotMsg.includes("cache_snapshots")) throw snapshotErr;
      }

      return res.status(200).json({
        rates: rates,
        skuTargets: Array.isArray(targetsQ.data) ? targetsQ.data : [],
        itemMasterCostBySku: itemMasterCostBySku,
        headcountDefaults: hc.defaults,
        lineHeadcountDefaults: lineHc,
        headcountDefaultsMeta: {
          source: shiftSource,
          rowsUsed: hc.rowsUsed,
          from: shiftFrom || null,
          to: shiftTo || null
        }
      });
    }

    const rates = Array.isArray(req.body && req.body.rates) ? req.body.rates : [];
    const skuTargets = Array.isArray(req.body && req.body.skuTargets) ? req.body.skuTargets : [];

    if (rates.length) {
      const rows = rates.map(function(r) {
        return {
          site_id: CACHE_SITE_ID,
          role: String(r.role || "").trim().toLowerCase(),
          effective_from: r.effective_from || "2000-01-01",
          effective_to: r.effective_to || null,
          hourly_rate: toNum(r.hourly_rate),
          markup_pct: toNum(r.markup_pct),
          updated_by: user.email
        };
      }).filter(function(r) { return r.role; });

      if (rows.length) {
        const up = await supabase.from("ops_rates").upsert(rows, { onConflict: "site_id,role,effective_from" });
        if (up.error) throw up.error;
      }
    }

    if (skuTargets.length) {
      const rows = skuTargets.map(function(t) {
        return {
          site_id: CACHE_SITE_ID,
          item_code: String(t.item_code || "").trim(),
          customer: t.customer ? String(t.customer).trim() : null,
          active_from: t.active_from || "2000-01-01",
          active_to: t.active_to || null,
          revenue_per_case: toNum(t.revenue_per_case),
          target_cases_per_hour: toNum(t.target_cases_per_hour),
          updated_by: user.email
        };
      }).filter(function(t) { return t.item_code; });

      if (rows.length) {
        const up = await supabase.from("ops_sku_targets").upsert(rows, { onConflict: "site_id,item_code,active_from" });
        if (up.error) throw up.error;
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({ error: "Ops config request failed", details: err && err.message ? err.message : "unknown" });
  }
}
