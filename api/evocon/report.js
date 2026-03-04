import Sentry from "../_sentry.js";

const EVOCON_BASE_URL = "https://api.evocon.com/api/reports/";
const ALLOWED_ENDPOINTS = {
  oee_json: true,
  losses_json: true,
  clientmetrics_json: true,
};

function toIsoDate(value) {
  if (!value) return "";
  var d = new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function defaultRange() {
  var end = new Date();
  var start = new Date(end);
  start.setDate(end.getDate() - 7);
  return {
    startTime: toIsoDate(start),
    endTime: toIsoDate(end),
  };
}

function parseStationIds(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map(function(v) { return v.trim(); }).filter(Boolean);
  return String(input)
    .split(",")
    .map(function(v) { return v.trim(); })
    .filter(Boolean);
}

function normalizeRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && typeof payload === "object") return [payload];
  return [];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.EVOCON_API_KEY || "";
  var secretKey = process.env.EVOCON_SECRET_KEY || "";
  if (!apiKey || !secretKey) {
    return res.status(500).json({
      error: "Missing Evocon credentials. Set EVOCON_API_KEY and EVOCON_SECRET_KEY in Vercel environment variables.",
    });
  }

  try {
    var range = defaultRange();
    var endpoint = String(req.query.endpoint || "oee_json").trim().toLowerCase();
    if (!ALLOWED_ENDPOINTS[endpoint]) {
      return res.status(400).json({ error: "Invalid endpoint. Allowed: oee_json, losses_json, clientmetrics_json" });
    }

    var startTime = toIsoDate(req.query.startTime) || range.startTime;
    var endTime = toIsoDate(req.query.endTime) || range.endTime;
    var stationIds = parseStationIds(req.query.stationIds || process.env.EVOCON_STATION_IDS || "");
    if (!stationIds.length) {
      return res.status(400).json({
        error: "No station IDs provided. Add stationIds query param or set EVOCON_STATION_IDS.",
      });
    }

    var params = new URLSearchParams();
    params.set("startTime", startTime);
    params.set("endTime", endTime);
    stationIds.forEach(function(id) { params.append("stationId", id); });

    var auth = Buffer.from(apiKey + ":" + secretKey).toString("base64");
    var url = EVOCON_BASE_URL + endpoint + "?" + params.toString();
    var resp = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Authorization": "Basic " + auth,
      },
    });

    var rawText = await resp.text();
    var body = null;
    try { body = rawText ? JSON.parse(rawText) : null; } catch (e) { body = null; }

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "Evocon request failed.",
        endpoint: endpoint,
        startTime: startTime,
        endTime: endTime,
        stationIds: stationIds,
        details: body || rawText || ("HTTP " + resp.status),
      });
    }

    var rows = normalizeRows(body);
    return res.status(200).json({
      ok: true,
      endpoint: endpoint,
      startTime: startTime,
      endTime: endTime,
      stationIds: stationIds,
      rowCount: rows.length,
      rows: rows,
      raw: body,
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Unexpected Evocon proxy error.",
      details: err && err.message ? err.message : "unknown",
    });
  }
}

