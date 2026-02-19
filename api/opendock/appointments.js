function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function extractBearerToken(value) {
  if (!value) return "";
  var s = String(value).trim();
  if (!s) return "";
  if (/^bearer\s+/i.test(s)) return s.replace(/^bearer\s+/i, "").trim();
  return s;
}

function looksLikeJwt(value) {
  if (!value || typeof value !== "string") return false;
  // Loose check: JWT usually has 3 dot-separated base64url sections.
  return value.split(".").length === 3;
}

function findTokenDeep(obj, depth) {
  if (!obj || depth > 4) return "";
  if (typeof obj === "string") {
    var maybe = extractBearerToken(obj);
    return looksLikeJwt(maybe) ? maybe : "";
  }
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      var fromArr = findTokenDeep(obj[i], depth + 1);
      if (fromArr) return fromArr;
    }
    return "";
  }
  if (typeof obj !== "object") return "";

  var commonKeys = [
    "token",
    "jwt",
    "accessToken",
    "access_token",
    "idToken",
    "id_token",
    "authToken",
    "authorization",
  ];
  for (var k = 0; k < commonKeys.length; k++) {
    var key = commonKeys[k];
    if (obj[key]) {
      var maybe = extractBearerToken(obj[key]);
      if (looksLikeJwt(maybe) || maybe.length > 20) return maybe;
    }
  }

  var nestedKeys = ["data", "result", "payload", "user", "session"];
  for (var j = 0; j < nestedKeys.length; j++) {
    var nested = obj[nestedKeys[j]];
    if (nested) {
      var fromNested = findTokenDeep(nested, depth + 1);
      if (fromNested) return fromNested;
    }
  }

  // Last resort: scan object string values for JWT-like strings.
  var values = Object.values(obj);
  for (var v = 0; v < values.length; v++) {
    var fromVal = findTokenDeep(values[v], depth + 1);
    if (fromVal) return fromVal;
  }

  return "";
}

function pickArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function fmtDateParts(isoLike) {
  if (!isoLike) return { date: "", time: "" };
  var dt = new Date(isoLike);
  if (isNaN(dt)) return { date: "", time: "" };
  var date = dt.toISOString().slice(0, 10);
  var time = dt.toISOString().slice(11, 16);
  return { date: date, time: time };
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return 0;
  var n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function calcDurationMinutes(startIso, endIso) {
  if (!startIso || !endIso) return "";
  var s = new Date(startIso).getTime();
  var e = new Date(endIso).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return "";
  return Math.round((e - s) / 60000);
}

function normalizeAppointmentRow(appt) {
  var start = appt && appt.start ? appt.start : "";
  var end = appt && appt.end ? appt.end : "";
  var parts = fmtDateParts(start);
  var customFields = appt && appt.customFields && typeof appt.customFields === "object" ? appt.customFields : {};

  var row = {
    PO: appt && appt.refNumber ? String(appt.refNumber) : "",
    Status: appt && appt.status ? String(appt.status) : "",
    "Appt Date": parts.date,
    "Appt Time": parts.time,
    Carrier: appt && appt.carrier && appt.carrier.name ? String(appt.carrier.name) : "",
    "Load Type": appt && appt.loadType && appt.loadType.name ? String(appt.loadType.name) : "",
    Dock: appt && appt.dock && appt.dock.name ? String(appt.dock.name) : "",
    "Reference / PO Number": appt && appt.refNumber ? String(appt.refNumber) : "",
    Start: start,
    End: end,
    "Duration (min)": calcDurationMinutes(start, end),
  };

  Object.keys(customFields).forEach(function (k) {
    row["CF " + k] = customFields[k] == null ? "" : String(customFields[k]);
  });

  return row;
}

function withinWindow(startIso, fromMs, toMs) {
  if (!startIso) return false;
  var t = new Date(startIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= fromMs && t <= toMs;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  var email = process.env.OPENDOCK_EMAIL;
  var password = process.env.OPENDOCK_PASSWORD;
  var warehouseId = process.env.OPENDOCK_WAREHOUSE_ID || "";
  var baseUrl = (process.env.OPENDOCK_BASE_URL || "https://neutron.opendock.com").replace(/\/+$/, "");
  var daysPast = Math.max(0, toNumber(req.query.daysPast || 7));
  var daysFuture = Math.max(0, toNumber(req.query.daysFuture || 14));

  if (!email || !password) {
    return res.status(500).json({
      error: "Missing OpenDock credentials. Set OPENDOCK_EMAIL and OPENDOCK_PASSWORD in Vercel environment variables.",
    });
  }

  var now = Date.now();
  var fromMs = now - daysPast * 24 * 60 * 60 * 1000;
  var toMs = now + daysFuture * 24 * 60 * 60 * 1000;

  try {
    var loginResp = await fetch(baseUrl + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password }),
    });
    var loginText = await loginResp.text();
    var loginBody = parseJsonSafe(loginText);

    if (!loginResp.ok) {
      return res.status(502).json({
        error: "OpenDock login failed.",
        details: loginBody || loginText || "Unknown auth error",
      });
    }

    var token = findTokenDeep(loginBody, 0);
    if (!token) {
      token =
        extractBearerToken(loginResp.headers.get("authorization")) ||
        extractBearerToken(loginResp.headers.get("x-access-token")) ||
        extractBearerToken(loginResp.headers.get("set-authorization"));
    }
    if (!token && typeof loginText === "string") {
      // Fallback for non-JSON bodies that are raw token strings.
      var raw = extractBearerToken(loginText);
      if (looksLikeJwt(raw) || raw.length > 20) token = raw;
    }
    if (!token) {
      return res.status(502).json({
        error: "OpenDock auth response did not include a token.",
        loginResponseKeys: loginBody && typeof loginBody === "object" ? Object.keys(loginBody) : [],
      });
    }

    var apptResp = await fetch(baseUrl + "/appointment", {
      method: "GET",
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/json",
      },
    });
    var apptText = await apptResp.text();
    var apptBody = parseJsonSafe(apptText);

    if (!apptResp.ok) {
      return res.status(502).json({
        error: "OpenDock appointment fetch failed.",
        details: apptBody || apptText || "Unknown appointment error",
      });
    }

    var rawRows = pickArray(apptBody);
    var filtered = rawRows.filter(function (appt) {
      if (!appt || typeof appt !== "object") return false;
      if (warehouseId) {
        var apptWarehouse = appt.warehouse && appt.warehouse.id ? String(appt.warehouse.id) : "";
        if (apptWarehouse && apptWarehouse !== warehouseId) return false;
      }
      return withinWindow(appt.start, fromMs, toMs);
    });

    filtered.sort(function (a, b) {
      return new Date(a.start).getTime() - new Date(b.start).getTime();
    });

    var rows = filtered.map(normalizeAppointmentRow);

    return res.status(200).json({
      rows: rows,
      totalFetched: rawRows.length,
      totalReturned: rows.length,
      windowDays: { past: daysPast, future: daysFuture },
      warehouseFilter: warehouseId || "none",
      message: "Loaded " + rows.length + " OpenDock appointments",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Unexpected OpenDock proxy error.",
      details: err && err.message ? err.message : String(err),
    });
  }
}
