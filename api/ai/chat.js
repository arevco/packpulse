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

function isLastWeekSummaryQuestion(prompt) {
  var q = toText(prompt).toLowerCase();
  if (!q) return false;
  var hasLastWeek = q.includes("last week") || q.includes("previous week") || q.includes("prior week");
  var hasProd = q.includes("production") || q.includes("reports") || q.includes("yield") || q.includes("cases");
  return hasLastWeek && hasProd;
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
  productionRows.forEach(function(r) {
    var date = toText(r.produced_date_et);
    var units = toNum(r.units_produced);
    if (!date || !(units > 0)) return;
    byDay[date] = (byDay[date] || 0) + units;
    var line = toText(r.line_name || "Unassigned");
    lineTotals[line] = (lineTotals[line] || 0) + units;
  });
  var dayPairs = Object.keys(byDay).sort().map(function(d) { return { date: d, units: byDay[d] }; });
  var latestProdDate = dayPairs.length ? dayPairs[dayPairs.length - 1].date : "";
  var latestProdUnits = latestProdDate ? byDay[latestProdDate] : 0;
  var last7 = dayPairs.slice(-7);
  var lineTop = Object.keys(lineTotals)
    .map(function(line) { return { line: line, units: lineTotals[line] }; })
    .sort(function(a, b) { return b.units - a.units; })
    .slice(0, 5);

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
    production: {
      totalRows: productionRows.length,
      latestDate: latestProdDate,
      latestDateUnits: latestProdUnits,
      byDayLast7: last7,
      topLines: lineTop,
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
    if (isLastWeekSummaryQuestion(prompt)) {
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

    var system = [
      "You are PackPulse AI copilot for factory operations.",
      "Be concise, practical, and action-oriented.",
      "Prioritize: what happened, why it matters, and what to do next.",
      "Use provided numeric context directly; do not invent metrics.",
      "If the user asks for a number and it is present in context, answer with the exact value first.",
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
