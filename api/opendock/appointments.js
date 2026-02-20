import Sentry from "../_sentry.js";

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

var TARGET_TIMEZONE = "America/Chicago";

var authCache = {
  token: "",
  expiresAt: 0,
};

var AUTH_CACHE_MS = 45 * 60 * 1000;

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
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

function getNestedValue(obj, path) {
  var cur = obj;
  for (var i = 0; i < path.length; i++) {
    if (!cur || typeof cur !== "object") return "";
    cur = cur[path[i]];
  }
  return cur == null ? "" : cur;
}

function asCleanString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function pickName(value, preferredKeys) {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value !== "object") return "";
  for (var i = 0; i < preferredKeys.length; i++) {
    var picked = asCleanString(value[preferredKeys[i]]);
    if (picked) return picked;
  }
  return "";
}

function findStringDeepByKeys(obj, keys, depth) {
  if (!obj || depth > 5) return "";
  if (Array.isArray(obj)) {
    for (var i = 0; i < obj.length; i++) {
      var fromArr = findStringDeepByKeys(obj[i], keys, depth + 1);
      if (fromArr) return fromArr;
    }
    return "";
  }
  if (typeof obj !== "object") return "";

  var objectKeys = Object.keys(obj);
  for (var k = 0; k < objectKeys.length; k++) {
    var currentKey = objectKeys[k];
    var keyNorm = String(currentKey).toLowerCase();
    var isTarget = keys.some(function (t) {
      return keyNorm === t || keyNorm === t + "name" || keyNorm.includes(t);
    });
    if (isTarget) {
      var v = obj[currentKey];
      var direct = asCleanString(v);
      if (direct) return direct;
      var named = pickName(v, ["name", "label", "title", "value"]);
      if (named) return named;
    }
  }

  for (var j = 0; j < objectKeys.length; j++) {
    var nested = obj[objectKeys[j]];
    if (nested && typeof nested === "object") {
      var fromNested = findStringDeepByKeys(nested, keys, depth + 1);
      if (fromNested) return fromNested;
    }
  }
  return "";
}

function cleanCustomFieldKey(rawKey) {
  var key = String(rawKey || "");
  // Strip type prefixes like str/int/doc/dropdown/email/phone/multidoc
  key = key.replace(/^(str|int|doc|dropdown|email|phone|multidoc)+/i, "");
  key = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
  return key || String(rawKey || "");
}

function flattenCustomFieldValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map(function (item) {
        return flattenCustomFieldValue(item);
      })
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    var common = asCleanString(value.value) || asCleanString(value.name) || asCleanString(value.label) || asCleanString(value.id);
    if (common) return common;
    // Fallback: readable key=value pairs instead of [object Object]
    return Object.keys(value)
      .map(function (k) {
        var v = flattenCustomFieldValue(value[k]);
        return v ? k + ": " + v : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function flattenCustomFields(customFields) {
  if (!customFields || typeof customFields !== "object") return {};
  var out = {};
  Object.keys(customFields).forEach(function (k) {
    if (/^\d+$/.test(String(k))) return;
    var header = cleanCustomFieldKey(k);
    if (!header || /^\d+$/.test(header)) return;
    var value = flattenCustomFieldValue(customFields[k]);
    if (!value) return;
    out[header] = value;
  });
  return out;
}

function toTzParts(date, timeZone) {
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  var map = {};
  fmt.formatToParts(date).forEach(function (p) {
    if (p.type !== "literal") map[p.type] = p.value;
  });
  return map;
}

function getOffsetForTimeZone(date, timeZone) {
  var tzn = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date).find(function (p) {
    return p.type === "timeZoneName";
  });
  var raw = tzn && tzn.value ? tzn.value : "GMT+00:00";
  var normalized = raw.replace("GMT", "");
  if (/^[+-]\d{2}:\d{2}$/.test(normalized)) return normalized;
  return "+00:00";
}

function toCentralDateTime(isoLike) {
  if (!isoLike) return { date: "", time: "", iso: "" };
  var dt = new Date(isoLike);
  if (isNaN(dt)) return { date: "", time: "", iso: "" };
  var p = toTzParts(dt, TARGET_TIMEZONE);
  var offset = getOffsetForTimeZone(dt, TARGET_TIMEZONE);
  var date = p.year + "-" + p.month + "-" + p.day;
  var time = p.hour + ":" + p.minute;
  var iso = date + "T" + time + ":" + p.second + offset;
  return { date: date, time: time, iso: iso };
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

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDisplayName(name, fallback) {
  var n = asCleanString(name).trim();
  if (!n) return fallback || "";
  if (n.toLowerCase() === "false" || n.toLowerCase() === "true") return fallback || "";
  return n;
}

function resolveDockName(appt, dockNameById) {
  var rawDockValue =
    pickName(appt ? appt.dock : null, ["name", "label", "dockName", "id"]) ||
    asCleanString(getNestedValue(appt, ["dockName"])) ||
    asCleanString(getNestedValue(appt, ["dock", "id"])) ||
    findStringDeepByKeys(appt, ["dock", "door"], 0);
  var cleaned = normalizeDisplayName(rawDockValue, "");
  if (!cleaned) return "";
  if (isUuidLike(cleaned) && dockNameById[cleaned]) return dockNameById[cleaned];
  return isUuidLike(cleaned) ? "" : cleaned;
}

function resolveLoadTypeName(appt, loadTypeNameById) {
  var rawLoadType =
    pickName(appt ? appt.loadType : null, ["name", "label", "type", "id"]) ||
    asCleanString(getNestedValue(appt, ["loadTypeName"])) ||
    asCleanString(getNestedValue(appt, ["loadType", "id"])) ||
    findStringDeepByKeys(appt, ["loadtype", "load_type", "type"], 0);
  var cleaned = normalizeDisplayName(rawLoadType, "");
  if (!cleaned) return "";
  if (isUuidLike(cleaned) && loadTypeNameById[cleaned]) return loadTypeNameById[cleaned];
  return isUuidLike(cleaned) ? "" : cleaned;
}

function resolveCarrierName(appt) {
  var rawCarrier =
    pickName(appt ? appt.carrier : null, ["name", "carrierName", "label"]) ||
    asCleanString(getNestedValue(appt, ["carrierName"])) ||
    asCleanString(getNestedValue(appt, ["carrier", "name"])) ||
    findStringDeepByKeys(appt, ["carrier"], 0);
  return normalizeDisplayName(rawCarrier, "");
}

function normalizeAppointmentRow(appt, dockNameById, loadTypeNameById) {
  var start = appt && appt.start ? appt.start : "";
  var end = appt && appt.end ? appt.end : "";
  var startLocal = toCentralDateTime(start);
  var endLocal = toCentralDateTime(end);
  var customFields = appt && appt.customFields && typeof appt.customFields === "object" ? appt.customFields : {};
  var carrier = resolveCarrierName(appt);
  var loadType = resolveLoadTypeName(appt, loadTypeNameById || {});
  var dock = resolveDockName(appt, dockNameById || {});

  var row = {
    PO: appt && appt.refNumber ? String(appt.refNumber) : "",
    Status: appt && appt.status ? String(appt.status) : "",
    "Appt Date": startLocal.date,
    "Appt Time": startLocal.time,
    Carrier: carrier,
    "Load Type": loadType,
    Dock: dock,
    "Reference / PO Number": appt && appt.refNumber ? String(appt.refNumber) : "",
    Start: startLocal.iso,
    End: endLocal.iso,
    "Duration (min)": calcDurationMinutes(start, end),
  };

  var flattened = flattenCustomFields(customFields);
  Object.keys(flattened).forEach(function (k) {
    row[k] = flattened[k];
  });

  return row;
}

function withinWindow(startIso, fromMs, toMs) {
  if (!startIso) return false;
  var t = new Date(startIso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= fromMs && t <= toMs;
}

async function fetchLookupMap(baseUrl, token, endpoint, idFieldCandidates, nameFieldCandidates) {
  try {
    var resp = await fetch(baseUrl + endpoint, {
      method: "GET",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
    });
    if (!resp.ok) return {};
    var text = await resp.text();
    var body = parseJsonSafe(text);
    var rows = pickArray(body);
    var map = {};
    rows.forEach(function (row) {
      if (!row || typeof row !== "object") return;
      var id = "";
      for (var i = 0; i < idFieldCandidates.length; i++) {
        var maybeId = asCleanString(row[idFieldCandidates[i]]);
        if (maybeId) {
          id = maybeId;
          break;
        }
      }
      var name = "";
      for (var j = 0; j < nameFieldCandidates.length; j++) {
        var maybeName = asCleanString(row[nameFieldCandidates[j]]);
        if (maybeName) {
          name = maybeName;
          break;
        }
      }
      if (id && name) map[id] = name;
    });
    return map;
  } catch (_) {
    return {};
  }
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
    var token = "";
    if (authCache.token && authCache.expiresAt > Date.now()) {
      token = authCache.token;
    } else {
      var loginResp = null;
      var loginText = "";
      var loginBody = null;
      var attempt = 0;
      var maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        loginResp = await fetch(baseUrl + "/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email, password: password }),
        });
        loginText = await loginResp.text();
        loginBody = parseJsonSafe(loginText);
        if (loginResp.ok) break;
        if (loginResp.status === 429 && attempt < maxAttempts) {
          await sleep(500 * attempt);
          continue;
        }
        if (loginResp.status === 429) {
          return res.status(429).json({
            error: "OpenDock rate limit reached. Please wait 1-2 minutes and try again.",
            details: loginBody || loginText || "Too Many Requests",
          });
        }
        return res.status(502).json({
          error: "OpenDock login failed.",
          details: loginBody || loginText || "Unknown auth error",
        });
      }

      token = findTokenDeep(loginBody, 0);
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
      authCache.token = token;
      authCache.expiresAt = Date.now() + AUTH_CACHE_MS;
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

    var dockNameById = await fetchLookupMap(baseUrl, token, "/dock", ["id", "dockId", "uuid"], ["name", "dockName", "label"]);
    var loadTypeNameById = await fetchLookupMap(baseUrl, token, "/loadtype", ["id", "loadTypeId", "uuid"], ["name", "label", "type"]);
    var rows = filtered.map(function (appt) {
      return normalizeAppointmentRow(appt, dockNameById, loadTypeNameById);
    });

    return res.status(200).json({
      rows: rows,
      totalFetched: rawRows.length,
      totalReturned: rows.length,
      windowDays: { past: daysPast, future: daysFuture },
      warehouseFilter: warehouseId || "none",
      message: "Loaded " + rows.length + " OpenDock appointments",
    });
  } catch (err) {
    Sentry.captureException(err);
    return res.status(500).json({
      error: "Unexpected OpenDock proxy error.",
      details: err && err.message ? err.message : String(err),
    });
  }
}
