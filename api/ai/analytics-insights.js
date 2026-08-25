import Sentry from "../_sentry.js";
import { getAuthenticatedUser, withCors } from "../ops/_common.js";

var INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    primaryDriver: { type: "string" },
    watchItem: { type: "string" },
    recommendedAction: { type: "string" }
  },
  required: ["headline", "summary", "primaryDriver", "watchItem", "recommendedAction"]
};

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 500);
}

function number(value) {
  var out = Number(value || 0);
  return Number.isFinite(out) ? Math.round(out * 100) / 100 : 0;
}

function cleanMetric(metric) {
  return {
    label: text(metric && metric.label, 80),
    current: number(metric && metric.current),
    prior: number(metric && metric.prior),
    changePct: metric && metric.changePct != null ? number(metric.changePct) : null,
    unit: text(metric && metric.unit, 32),
    goodWhenDown: !!(metric && metric.goodWhenDown)
  };
}

function cleanLine(line) {
  return {
    line: text(line && line.line, 80),
    casesPerDay: number(line && line.casesPerDay),
    outputChangePct: line && line.outputChangePct != null ? number(line.outputChangePct) : null,
    casesPerPayableHour: number(line && line.casesPerPayableHour),
    crew: line && line.crew != null ? number(line.crew) : null,
    laborCostPerCase: number(line && line.laborCostPerCase),
    laborMarginPct: line && line.laborMarginPct != null ? number(line.laborMarginPct) : null,
    volumeSharePct: number(line && line.volumeSharePct),
    priceCoveragePct: number(line && line.priceCoveragePct)
  };
}

function extractOutputText(body) {
  if (body && body.output_text) return text(body.output_text, 6000);
  var found = "";
  (Array.isArray(body && body.output) ? body.output : []).some(function(item) {
    return (Array.isArray(item && item.content) ? item.content : []).some(function(part) {
      if (part && part.type === "output_text" && part.text) { found = text(part.text, 6000); return true; }
      return false;
    });
  });
  return found;
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  var user = getAuthenticatedUser(req);
  if (!user || !user.email) return res.status(401).json({ error: "Unauthorized" });

  var apiKey = text(process.env.OPENAI_API_KEY, 500);
  if (!apiKey) return res.status(503).json({ error: "OpenAI is not configured", fallback: true });

  try {
    var body = req.body && typeof req.body === "object" ? req.body : {};
    var factPack = {
      currentPeriod: { start: text(body.currentPeriod && body.currentPeriod.start, 10), end: text(body.currentPeriod && body.currentPeriod.end, 10), productionDays: number(body.currentPeriod && body.currentPeriod.productionDays), jobs: number(body.currentPeriod && body.currentPeriod.jobs) },
      comparisonPeriod: { start: text(body.comparisonPeriod && body.comparisonPeriod.start, 10), end: text(body.comparisonPeriod && body.comparisonPeriod.end, 10), productionDays: number(body.comparisonPeriod && body.comparisonPeriod.productionDays), jobs: number(body.comparisonPeriod && body.comparisonPeriod.jobs) },
      metrics: (Array.isArray(body.metrics) ? body.metrics : []).slice(0, 10).map(cleanMetric),
      lines: (Array.isArray(body.lines) ? body.lines : []).slice(0, 10).map(cleanLine),
      dataQuality: {
        pricingCoveragePct: number(body.dataQuality && body.dataQuality.pricingCoveragePct),
        hasLabor: !!(body.dataQuality && body.dataQuality.hasLabor),
        hasOee: !!(body.dataQuality && body.dataQuality.hasOee)
      }
    };
    if (!factPack.metrics.length) return res.status(400).json({ error: "Analytics facts are required" });

    var instructions = [
      "You are a plant operations analyst writing a highly scannable executive readout.",
      "Use only the supplied PackPulse facts. Do not calculate or invent values.",
      "Do not include any digits or numeric values in your prose; the interface displays verified evidence separately.",
      "Lead with the conclusion, identify one primary operational driver, identify one material watch item, and give one practical investigation or action.",
      "Treat revenue and margin cautiously when pricing coverage is incomplete. Never describe labor margin as full gross margin.",
      "Treat OEE as unavailable when hasOee is false.",
      "Keep every field to one short sentence. Use plain language suitable for a morning plant meeting. Avoid jargon, hedging, and generic advice."
    ].join(" ");
    var model = text(process.env.OPENAI_ANALYTICS_MODEL || process.env.OPENAI_MODEL, 100) || "gpt-5-mini";
    var response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        store: false,
        instructions: instructions,
        input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(factPack) }] }],
        text: { format: { type: "json_schema", name: "plant_analytics_readout", strict: true, schema: INSIGHT_SCHEMA } }
      })
    });
    var responseBody = await response.json().catch(function() { return {}; });
    if (!response.ok) {
      var detail = text(responseBody && responseBody.error && responseBody.error.message, 500) || "OpenAI insight generation failed";
      return res.status(response.status).json({ error: detail, fallback: true });
    }
    var outputText = extractOutputText(responseBody);
    if (!outputText) return res.status(502).json({ error: "OpenAI returned no insight text", fallback: true });
    var insights = JSON.parse(outputText);
    return res.status(200).json({ ok: true, insights: insights, model: model, source: "OpenAI narrative over PackPulse facts" });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({ error: error && error.message ? error.message : "Analytics insight generation failed", fallback: true });
  }
}
