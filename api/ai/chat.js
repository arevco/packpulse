import Sentry from "../_sentry.js";
import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

function toText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function toNum(value) {
  var n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function isTodayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("today") ||
    q.includes("cases produced today") ||
    q.includes("today production") ||
    q.includes("produced today")
  );
}

function isYesterdayCasesQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("how many cases") && q.includes("yesterday") ||
    q.includes("cases produced yesterday") ||
    q.includes("yesterday production") ||
    q.includes("produced yesterday")
  );
}

function isCasesProducedQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return q.includes("how many cases") || q.includes("cases produced") || q.includes("production cases");
}

function detectPeriodLabel(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return "";
  if (q.includes("today")) return "today";
  if (q.includes("yesterday")) return "yesterday";
  if (q.includes("this week") || q.includes("current week")) return "this_week";
  if (q.includes("last week") || q.includes("previous week") || q.includes("prior week")) return "last_week";
  if (q.includes("this month") || q.includes("current month")) return "this_month";
  if (q.includes("last month") || q.includes("previous month") || q.includes("prior month")) return "last_month";
  return "";
}

function ymdInEtFromDate(date) {
  var parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .forEach(function(part) {
      if (part.type !== "literal") parts[part.type] = part.value;
    });
  return parts.year && parts.month && parts.day ? (parts.year + "-" + parts.month + "-" + parts.day) : "";
}

function shiftIsoDate(dateIso, days) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfWeekIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  var dow = d.getDay();
  var delta = dow === 0 ? -6 : 1 - dow; // Monday start
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function startOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function endOfMonthIso(dateIso) {
  if (!dateIso) return "";
  var d = new Date(dateIso + "T00:00:00");
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

function isLastWeekSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var hasLastWeek = q.includes("last week") || q.includes("previous week") || q.includes("prior week");
  var hasProd = q.includes("production") || q.includes("reports") || q.includes("yield") || q.includes("cases");
  return hasLastWeek && hasProd;
}

function wantsDetailedBreakdown(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("include") ||
    q.includes("breakdown") ||
    q.includes("reasoning") ||
    q.includes("why") ||
    q.includes("sku") ||
    q.includes("yield") ||
    q.includes("utilization") ||
    q.includes("machine")
  );
}

function isChartSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  return (
    q.includes("summarize these charts") ||
    q.includes("summarise these charts") ||
    q.includes("summarize the charts") ||
    q.includes("chart summary")
  );
}

function isMarchYieldQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var mentionsYield = q.includes("daily production yield") || q.includes("daily yield") || q.includes("cases per day") || q.includes("daily production");
  var mentionsMarch = q.includes("march");
  var mentionsTarget = q.includes("hit") || q.includes("necessary") || q.includes("need") || q.includes("target");
  return mentionsYield && mentionsMarch && mentionsTarget;
}

function extractComponentLookupSku(prompt) {
  var q = toText(prompt);
  if (!q) return "";
  var m = q.match(/components?\s+(?:are\s+used\s+in|for|in)\s+([a-zA-Z0-9\-]+)/i);
  if (m && m[1]) return String(m[1]).trim();
  var m2 = q.match(/what\s+is\s+in\s+([a-zA-Z0-9\-]+)/i);
  if (m2 && m2[1]) return String(m2[1]).trim();
  return "";
}

function normalizeSku(value) {
  return String(value || "").trim().replace(/\.0+$/, "").toLowerCase();
}

function firstField(row, keys) {
  if (!row || typeof row !== "object") return "";
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== "") return row[k];
  }
  var wanted = keys.map(function(k) { return String(k).toLowerCase().replace(/[^a-z0-9]/g, ""); });
  var rowKeys = Object.keys(row);
  for (var j = 0; j < rowKeys.length; j++) {
    var rk = rowKeys[j];
    var norm = String(rk).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (wanted.indexOf(norm) !== -1) {
      var v = row[rk];
      if (v != null && v !== "") return v;
    }
  }
  return "";
}

function componentsForSkuFromPayload(payload, skuRaw) {
  var boms = payload && Array.isArray(payload.boms) ? payload.boms : [];
  if (!boms.length) return { hasBomData: false, items: [] };
  var sku = normalizeSku(skuRaw);
  var out = [];
  var seen = {};
  boms.forEach(function(row) {
    var fg = normalizeSku(firstField(row, ["Finished Good Code", "finished_good_code", "bomId", "Finished Good", "fg_code"]));
    if (!fg || fg !== sku) return;
    var comp = String(firstField(row, ["Subcomponent Code", "subcomponent_code", "componentSku", "Component", "component_code"]) || "").trim();
    if (!comp) return;
    var key = normalizeSku(comp);
    if (!key || seen[key]) return;
    seen[key] = true;
    out.push({
      component: comp,
      description: String(firstField(row, ["Subcomponent Description", "subcomponent_description", "description", "Description"]) || "").trim(),
      qtyPer: firstField(row, ["Qty Per", "subcomponent_unit_quantity", "qtyPer", "quantity_per"]),
    });
  });
  return { hasBomData: true, items: out };
}

async function loadSupabaseAiContext() {
  var supabase = getSupabaseAdmin();

  var snapshotQ = await supabase
    .from("cache_snapshot")
    .select("synced_at,updated_by,row_counts,metrics,payload")
    .eq("site_id", CACHE_SITE_ID)
    .order("synced_at", { ascending: false })
    .limit(1);
  if (snapshotQ.error) throw snapshotQ.error;
  var snapshot = Array.isArray(snapshotQ.data) && snapshotQ.data.length ? snapshotQ.data[0] : null;

  var prodQ = await supabase
    .from("production_events")
    .select("produced_date_et,units_produced,shift_label,line_name,item_code,work_order_code")
    .eq("site_id", CACHE_SITE_ID)
    .order("produced_date_et", { ascending: false })
    .limit(2000);
  var productionRows = [];
  if (!prodQ.error && Array.isArray(prodQ.data)) productionRows = prodQ.data;

  var laborQ = await supabase
    .from("ops_shift_inputs")
    .select("date_et,shift_label,line_name,total_headcount,total_hours")
    .eq("site_id", CACHE_SITE_ID)
    .order("date_et", { ascending: false })
    .limit(120);
  var laborRows = [];
  if (!laborQ.error && Array.isArray(laborQ.data)) laborRows = laborQ.data;

  var byDay = {};
  var lineTotals = {};
  var skuTotals = {};
  productionRows.forEach(function(r) {
    var date = toText(r.produced_date_et);
    var units = toNum(r.units_produced);
    if (!date || !(units > 0)) return;
    byDay[date] = (byDay[date] || 0) + units;
    var line = toText(r.line_name || "Unassigned");
    lineTotals[line] = (lineTotals[line] || 0) + units;
    var sku = toText(r.item_code || "Unknown");
    skuTotals[sku] = (skuTotals[sku] || 0) + units;
  });
  var dayPairs = Object.keys(byDay).sort().map(function(d) { return { date: d, units: byDay[d] }; });
  var latestProdDate = dayPairs.length ? dayPairs[dayPairs.length - 1].date : "";
  var latestProdUnits = latestProdDate ? byDay[latestProdDate] : 0;
  var last7 = dayPairs.slice(-7);
  var lineTop = Object.keys(lineTotals)
    .map(function(line) { return { line: line, units: lineTotals[line] }; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 5);
  var skuTop = Object.keys(skuTotals)
    .map(function(sku) { return { sku: sku, units: skuTotals[sku] }; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 8);

  function rangeTotals(start, end) {
    if (!start || !end) return { totalCases: 0, byLineTop: [], bySkuTop: [] };
    var rangeRows = productionRows.filter(function(r) {
      var d = toText(r.produced_date_et);
      return d && d >= start && d <= end;
    });
    var totalCases = 0;
    var lineMap = {};
    var skuMap = {};
    rangeRows.forEach(function(r) {
      var u = toNum(r.units_produced);
      if (!(u > 0)) return;
      totalCases += u;
      var ln = toText(r.line_name || "Unassigned");
      var sk = toText(r.item_code || "Unknown");
      lineMap[ln] = (lineMap[ln] || 0) + u;
      skuMap[sk] = (skuMap[sk] || 0) + u;
    });
    var byLineTop = Object.keys(lineMap).map(function(k) { return { line: k, units: lineMap[k] }; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 5);
    var bySkuTop = Object.keys(skuMap).map(function(k) { return { sku: k, units: skuMap[k] }; }).sort(function(a, b) { return b.units - a.units; }).slice(0, 8);
    return { totalCases: totalCases, byLineTop: byLineTop, bySkuTop: bySkuTop };
  }

  var latestLaborDate = "";
  var laborByDate = {};
  laborRows.forEach(function(r) {
    var d = toText(r.date_et);
    if (!d) return;
    laborByDate[d] = (laborByDate[d] || 0) + 1;
    if (!latestLaborDate || d > latestLaborDate) latestLaborDate = d;
  });

  return {
    siteId: CACHE_SITE_ID,
    snapshotSyncedAt: snapshot && snapshot.synced_at ? snapshot.synced_at : null,
    snapshotUpdatedBy: snapshot && snapshot.updated_by ? snapshot.updated_by : "",
    snapshotRowCounts: snapshot && snapshot.row_counts ? snapshot.row_counts : {},
    snapshotMetrics: snapshot && snapshot.metrics ? snapshot.metrics : {},
    snapshotPayload: snapshot && snapshot.payload ? snapshot.payload : null,
    production: {
      totalRows: productionRows.length,
      latestDate: latestProdDate,
      latestDateUnits: latestProdUnits,
      byDayLast7: last7,
      topLines: lineTop,
      topSkus: skuTop,
      range: rangeTotals,
    },
    labor: {
      totalRows: laborRows.length,
      latestDate: latestLaborDate,
      entriesOnLatestDate: latestLaborDate ? (laborByDate[latestLaborDate] || 0) : 0,
    },
  };
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var apiKey = process.env.OPENAI_API_KEY || "";
    var model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY is not configured" });
    }

    var body = req.body || {};
    var prompt = toText(body.prompt);
    var activeView = toText(body.activeView || "overview");
    var contextLines = Array.isArray(body.contextLines) ? body.contextLines.map(toText).filter(Boolean).slice(0, 8) : [];
    var metrics = body.metrics && typeof body.metrics === "object" ? body.metrics : {};
    var history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });
    var supabaseContext = null;
    try {
      supabaseContext = await loadSupabaseAiContext();
    } catch (_) {
      supabaseContext = null;
    }
    var lookupSku = extractComponentLookupSku(prompt);
    if (lookupSku) {
      var result = componentsForSkuFromPayload(supabaseContext && supabaseContext.snapshotPayload, lookupSku);
      if (!result.hasBomData) {
        return res.status(200).json({
          answer: "BOM data is not available in shared snapshot yet. Run Nulogy sync with BOM included, then ask again.",
          model: "deterministic",
        });
      }
      if (!result.items.length) {
        return res.status(200).json({
          answer: "No BOM components found for " + lookupSku + " in current snapshot.",
          model: "deterministic",
        });
      }
      var lines = result.items.slice(0, 25).map(function(item, idx) {
        var desc = item.description ? " - " + item.description : "";
        var qty = item.qtyPer != null && item.qtyPer !== "" ? " (qty/unit: " + item.qtyPer + ")" : "";
        return (idx + 1) + ". " + item.component + desc + qty;
      });
      return res.status(200).json({
        answer: "Components for " + lookupSku + ":\n" + lines.join("\n"),
        model: "deterministic",
      });
    }

    // Deterministic answer for high-frequency operational ask.
    if (isTodayCasesQuestion(prompt)) {
      var todayCases = toNum(metrics.productionTodayCases);
      var s1 = toNum(metrics.productionTodayShift1Cases);
      var s2 = toNum(metrics.productionTodayShift2Cases);
      var todayEt = toText(metrics.todayEt);
      return res.status(200).json({
        answer:
          "Cases produced today (" + (todayEt || "ET") + "): " + todayCases.toLocaleString() +
          ". Shift 1: " + s1.toLocaleString() +
          ", Shift 2: " + s2.toLocaleString() + "." +
          (supabaseContext && supabaseContext.production && supabaseContext.production.latestDate
            ? " Supabase latest production date: " + supabaseContext.production.latestDate + " (" + toNum(supabaseContext.production.latestDateUnits).toLocaleString() + " cases)."
            : ""),
        model: "deterministic",
      });
    }
    if (isYesterdayCasesQuestion(prompt)) {
      var todayEt = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var yesterdayEt = toText(metrics.yesterdayEt) || shiftIsoDate(todayEt, -1);
      var yCases = toNum(metrics.productionYesterdayCases);
      var yS1 = toNum(metrics.productionYesterdayShift1Cases);
      var yS2 = toNum(metrics.productionYesterdayShift2Cases);

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7)) {
        var dayRow = supabaseContext.production.byDayLast7.find(function(d) { return toText(d && d.date) === yesterdayEt; });
        if (dayRow) yCases = toNum(dayRow.units);
      }

      if (!(yCases > 0) && supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7) && supabaseContext.production.byDayLast7.length) {
        var fallback = supabaseContext.production.byDayLast7[supabaseContext.production.byDayLast7.length - 1];
        var fallbackDate = toText(fallback && fallback.date) || "--";
        var fallbackUnits = toNum(fallback && fallback.units);
        return res.status(200).json({
          answer:
            "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + "). " +
            "Latest available production day is " + fallbackDate + " with " + fallbackUnits.toLocaleString() + " cases.",
          model: "deterministic",
        });
      }

      if (!(yCases > 0)) {
        return res.status(200).json({
          answer: "No production rows are mapped for yesterday (" + (yesterdayEt || "--") + ").",
          model: "deterministic",
        });
      }

      return res.status(200).json({
        answer:
          "Cases produced yesterday (" + (yesterdayEt || "ET") + "): " + yCases.toLocaleString() +
          ". Shift 1: " + yS1.toLocaleString() +
          ", Shift 2: " + yS2.toLocaleString() + ".",
        model: "deterministic",
      });
    }
    var periodLabel = detectPeriodLabel(prompt);
    if (
      isCasesProducedQuestion(prompt) &&
      periodLabel &&
      periodLabel !== "today" &&
      periodLabel !== "yesterday" &&
      supabaseContext &&
      supabaseContext.production &&
      typeof supabaseContext.production.range === "function"
    ) {
      var anchor = toText(metrics.todayEt) || ymdInEtFromDate(new Date());
      var start = "";
      var end = "";
      var label = "";
      if (periodLabel === "this_week") {
        start = startOfWeekIso(anchor);
        end = anchor;
        label = "this week";
      } else if (periodLabel === "last_week") {
        var thisWeekStart = startOfWeekIso(anchor);
        start = shiftIsoDate(thisWeekStart, -7);
        end = shiftIsoDate(thisWeekStart, -1);
        label = "last week";
      } else if (periodLabel === "this_month") {
        start = startOfMonthIso(anchor);
        end = anchor;
        label = "this month";
      } else if (periodLabel === "last_month") {
        var thisMonthStart = startOfMonthIso(anchor);
        var lastMonthAnchor = shiftIsoDate(thisMonthStart, -1);
        start = startOfMonthIso(lastMonthAnchor);
        end = endOfMonthIso(lastMonthAnchor);
        label = "last month";
      }
      var agg = supabaseContext.production.range(start, end);
      var totalCases = toNum(agg && agg.totalCases);
      return res.status(200).json({
        answer:
          "Cases produced " + label + " (" + (start || "--") + " to " + (end || "--") + "): " +
          totalCases.toLocaleString() + ".",
        model: "deterministic",
      });
    }

    if (isLastWeekSummaryQuestion(prompt) && !wantsDetailedBreakdown(prompt)) {
      var lwTotal = toNum(metrics.lastWeekCases);
      var lwS1 = toNum(metrics.lastWeekShift1Cases);
      var lwS2 = toNum(metrics.lastWeekShift2Cases);
      var lwStart = toText(metrics.lastWeekStartEt);
      var lwEnd = toText(metrics.lastWeekEndEt);
      var twTotal = toNum(metrics.thisWeekCases);
      var delta = lwTotal ? Math.round(((twTotal - lwTotal) / lwTotal) * 100) : 0;
      return res.status(200).json({
        answer:
          "Last week production (" + (lwStart || "--") + " to " + (lwEnd || "--") + "): " + lwTotal.toLocaleString() +
          " cases. Shift 1: " + lwS1.toLocaleString() +
          ", Shift 2: " + lwS2.toLocaleString() +
          ". This week-to-date: " + twTotal.toLocaleString() + " (" + (delta >= 0 ? "+" : "") + delta + "% vs last week).",
        model: "deterministic",
      });
    }
    if (isChartSummaryQuestion(prompt)) {
      var last7 = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.byDayLast7))
        ? supabaseContext.production.byDayLast7
        : [];
      var topLines = (supabaseContext && supabaseContext.production && Array.isArray(supabaseContext.production.topLines))
        ? supabaseContext.production.topLines
        : [];
      if (!last7.length) {
        return res.status(200).json({
          answer: "I can’t summarize charts yet because recent production trend data is empty in Supabase. Run a sync and try again.",
          model: "deterministic",
        });
      }
      var total7 = last7.reduce(function(sum, d) { return sum + toNum(d.units); }, 0);
      var avg7 = Math.round(total7 / Math.max(1, last7.length));
      var sortedDays = last7.slice().sort(function(a, b) { return toNum(b.units) - toNum(a.units); });
      var best = sortedDays[0] || { date: "--", units: 0 };
      var worst = sortedDays[sortedDays.length - 1] || { date: "--", units: 0 };
      var trend = 0;
      if (last7.length >= 2) {
        var first = toNum(last7[0].units);
        var last = toNum(last7[last7.length - 1].units);
        trend = first ? Math.round(((last - first) / first) * 100) : 0;
      }
      var topLineText = topLines.length
        ? topLines.slice(0, 3).map(function(x) { return String(x.line || "--") + " (" + toNum(x.units).toLocaleString() + ")"; }).join(", ")
        : "No line breakdown available";
      return res.status(200).json({
        answer:
          "Chart summary (last 7 production days): total " + total7.toLocaleString() +
          " cases, avg " + avg7.toLocaleString() + "/day. " +
          "Peak day: " + String(best.date || "--") + " (" + toNum(best.units).toLocaleString() + "). " +
          "Low day: " + String(worst.date || "--") + " (" + toNum(worst.units).toLocaleString() + "). " +
          "Period trend: " + (trend >= 0 ? "+" : "") + trend + "%. " +
          "Top lines: " + topLineText + ".",
        model: "deterministic",
      });
    }
    if (isMarchYieldQuestion(prompt)) {
      var marchMonth = toText(metrics.marchMonth);
      var marchRemaining = toNum(metrics.marchRemainingUnits);
      var marchWOs = toNum(metrics.marchWorkOrders);
      var daysRemaining = toNum(metrics.marchBusinessDaysRemaining);
      var daysFull = toNum(metrics.marchBusinessDays);
      var targetRemain = toNum(metrics.marchDailyTargetRemaining);
      var targetFull = toNum(metrics.marchDailyTargetFullMonth);
      if (!(marchRemaining > 0) || !(daysFull > 0)) {
        return res.status(200).json({
          answer: "I can’t calculate March daily target yet because March due-volume metrics are not available in current context.",
          model: "deterministic",
        });
      }
      return res.status(200).json({
        answer:
          "March target (" + (marchMonth || "March") + "): " + marchRemaining.toLocaleString() +
          " remaining cases across " + marchWOs.toLocaleString() + " active WOs. " +
          "Required daily yield is " + targetFull.toLocaleString() + " cases/day over all March business days (" + daysFull + "). " +
          "From today forward, required pace is " + targetRemain.toLocaleString() + " cases/day over " + daysRemaining + " remaining business days.",
        model: "deterministic",
      });
    }

    var lastWeekRange = {
      start: toText(metrics.lastWeekStartEt),
      end: toText(metrics.lastWeekEndEt),
    };
    var thisWeekRange = {
      start: toText(metrics.thisWeekStartEt),
      end: toText(metrics.thisWeekEndEt),
    };
    var lastWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(lastWeekRange.start, lastWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };
    var thisWeekAgg = (supabaseContext && supabaseContext.production && typeof supabaseContext.production.range === "function")
      ? supabaseContext.production.range(thisWeekRange.start, thisWeekRange.end)
      : { totalCases: 0, byLineTop: [], bySkuTop: [] };

    if (supabaseContext && supabaseContext.production) {
      // remove function before serialization
      delete supabaseContext.production.range;
    }
    if (supabaseContext && Object.prototype.hasOwnProperty.call(supabaseContext, "snapshotPayload")) {
      delete supabaseContext.snapshotPayload;
    }

    var system = [
      "You are PackPulse AI copilot for factory operations.",
      "Be concise, practical, and action-oriented.",
      "Prioritize: what happened, why it matters, and what to do next.",
      "Use provided numeric context directly; do not invent metrics.",
      "If the user asks for a number and it is present in context, answer with the exact value first.",
      "For summary questions, include: total, trend, top SKU mix, top lines, and concrete actions.",
      "If data is missing or uncertain, say so clearly.",
      "Never claim actions were completed unless explicitly provided in context."
    ].join(" ");

    var messages = [{ role: "system", content: system }];
    messages.push({
      role: "user",
      content:
        "Context\n" +
        "- User: " + user.email + "\n" +
        "- Active view: " + activeView + "\n" +
        (contextLines.length ? "- Dashboard context:\n  - " + contextLines.join("\n  - ") + "\n" : "") +
        "- Metrics JSON: " + JSON.stringify(metrics) + "\n" +
        "- Last week aggregate JSON: " + JSON.stringify(lastWeekAgg) + "\n" +
        "- This week aggregate JSON: " + JSON.stringify(thisWeekAgg) + "\n" +
        "- Supabase context JSON: " + JSON.stringify(supabaseContext || {})
    });

    history.forEach(function(msg) {
      var role = msg && msg.role === "assistant" ? "assistant" : "user";
      var text = toText(msg && msg.text);
      if (!text) return;
      messages.push({ role: role, content: text });
    });
    messages.push({ role: "user", content: prompt });

    var openaiResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        temperature: 0.2,
        messages: messages,
      }),
    });

    var raw = await openaiResp.text();
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      parsed = null;
    }
    if (!openaiResp.ok) {
      var details = parsed && parsed.error && parsed.error.message ? parsed.error.message : raw || "OpenAI request failed";
      return res.status(openaiResp.status).json({ error: "AI request failed", details: details });
    }

    var answer =
      parsed &&
      parsed.choices &&
      parsed.choices[0] &&
      parsed.choices[0].message &&
      parsed.choices[0].message.content
        ? String(parsed.choices[0].message.content).trim()
        : "";
    if (!answer) answer = "No AI response was returned.";

    return res.status(200).json({ answer: answer, model: model });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Could not process AI request",
      details: err && err.message ? err.message : "unknown",
    });
  }
}
