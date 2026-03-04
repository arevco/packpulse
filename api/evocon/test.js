const EVOCON_BASE_URL = "https://api.evocon.com/api/reports/";

function toIsoDate(value) {
  var d = new Date(value);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

function parseStationIds(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String).map(function(v) { return v.trim(); }).filter(Boolean);
  return String(input).split(",").map(function(v) { return v.trim(); }).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  var apiKey = process.env.EVOCON_API_KEY || "";
  var secretKey = process.env.EVOCON_SECRET_KEY || "";
  var stationIds = parseStationIds(process.env.EVOCON_STATION_IDS || "");
  if (!apiKey || !secretKey) {
    return res.status(500).json({
      configured: false,
      connected: false,
      message: "Evocon credentials not set. Add EVOCON_API_KEY and EVOCON_SECRET_KEY.",
    });
  }
  if (!stationIds.length) {
    return res.status(400).json({
      configured: true,
      connected: false,
      message: "Evocon station IDs missing. Set EVOCON_STATION_IDS (comma-separated).",
    });
  }

  var end = new Date();
  var start = new Date(end);
  start.setDate(end.getDate() - 1);
  var params = new URLSearchParams();
  params.set("startTime", toIsoDate(start));
  params.set("endTime", toIsoDate(end));
  stationIds.slice(0, 1).forEach(function(id) { params.append("stationId", id); });

  try {
    var auth = Buffer.from(apiKey + ":" + secretKey).toString("base64");
    var resp = await fetch(EVOCON_BASE_URL + "oee_json?" + params.toString(), {
      headers: {
        "Accept": "application/json",
        "Authorization": "Basic " + auth,
      },
    });
    var text = await resp.text();
    if (!resp.ok) {
      return res.status(resp.status).json({
        configured: true,
        connected: false,
        message: "Evocon credentials rejected or request failed.",
        details: text ? text.slice(0, 400) : ("HTTP " + resp.status),
      });
    }
    var payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (e) { payload = null; }
    var rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.data) ? payload.data : []);
    return res.status(200).json({
      configured: true,
      connected: true,
      message: "Connected to Evocon successfully.",
      sampleRows: rows.length,
      stationId: stationIds[0],
      range: { startTime: params.get("startTime"), endTime: params.get("endTime") },
    });
  } catch (err) {
    return res.status(500).json({
      configured: true,
      connected: false,
      message: "Cannot reach Evocon API.",
      details: err && err.message ? err.message : "unknown",
    });
  }
}

