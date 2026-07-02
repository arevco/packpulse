import { CACHE_SITE_ID, getAuthenticatedUser, getSupabaseAdmin, withCors } from "../ops/_common.js";

const DEFAULT_GUSTO_API_BASE_URL = "https://api.gusto.com";
const DEFAULT_GUSTO_API_VERSION = "2026-06-15";
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_LOOKAHEAD_DAYS = 90;
const FETCH_TIMEOUT_MS = 15 * 1000;
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 350;
const RETRYABLE_FETCH_STATUSES = {
  408: true,
  425: true,
  429: true,
  500: true,
  502: true,
  503: true,
  504: true
};

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal === "undefined" || !AbortSignal || typeof AbortSignal.timeout !== "function") {
    return undefined;
  }
  return AbortSignal.timeout(timeoutMs);
}

function normalizeBaseUrl(value) {
  var raw = String(value || "").trim();
  if (!raw) return DEFAULT_GUSTO_API_BASE_URL;
  return raw.replace(/\/+$/, "");
}

function parseCompanyUuids(raw) {
  return String(raw || "")
    .split(",")
    .map(function(value) { return String(value || "").trim(); })
    .filter(Boolean);
}

export function readGustoEnv() {
  var accessToken = String(process.env.GUSTO_ACCESS_TOKEN || "").trim();
  var companyUuids = parseCompanyUuids(process.env.GUSTO_COMPANY_UUIDS || process.env.GUSTO_COMPANY_UUID || "");
  var baseUrl = normalizeBaseUrl(process.env.GUSTO_API_BASE_URL || DEFAULT_GUSTO_API_BASE_URL);
  var apiVersion = String(process.env.GUSTO_API_VERSION || DEFAULT_GUSTO_API_VERSION).trim() || DEFAULT_GUSTO_API_VERSION;
  var missing = [];
  if (!accessToken) missing.push("GUSTO_ACCESS_TOKEN");
  if (!companyUuids.length) missing.push("GUSTO_COMPANY_UUID or GUSTO_COMPANY_UUIDS");
  return {
    accessToken: accessToken,
    companyUuids: companyUuids,
    baseUrl: baseUrl,
    apiVersion: apiVersion,
    missing: missing
  };
}

export function hasGustoConfig() {
  return readGustoEnv().missing.length === 0;
}

export function getGustoConfig() {
  var env = readGustoEnv();
  if (env.missing.length) {
    throw new Error("Missing Gusto configuration: " + env.missing.join(", "));
  }
  return env;
}

export function parsePositiveInt(value, fallbackValue, minValue, maxValue) {
  var fallback = Number(fallbackValue || 0);
  var min = Number(minValue || 0);
  var max = Number(maxValue || 0);
  var n = Number(value);
  if (!Number.isFinite(n)) n = fallback;
  n = Math.round(n);
  if (Number.isFinite(min)) n = Math.max(min, n);
  if (Number.isFinite(max) && max > 0) n = Math.min(max, n);
  return n;
}

export function describeError(error) {
  return String(
    (error && (error.message || error.details || error.hint || error.error_description || error.code)) ||
    error ||
    ""
  ).trim();
}

export function summarizeError(error, maxLen) {
  var limit = Math.max(40, Number(maxLen || 180));
  var message = describeError(error).replace(/\s+/g, " ").trim();
  if (!message) return "unknown";
  return message.length > limit ? message.slice(0, limit - 3) + "..." : message;
}

export function isMissingTableError(error, tableName) {
  var msg = describeError(error).toLowerCase();
  var name = String(tableName || "").trim().toLowerCase();
  if (!msg || !name) return false;
  return msg.includes(name) && (
    msg.includes("schema cache") ||
    msg.includes("relation") ||
    msg.includes("does not exist") ||
    msg.includes("could not find the table")
  );
}

export function formatDateEt(value) {
  var date = value instanceof Date ? value : new Date(value);
  if (isNaN(date)) return "";
  var parts = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).forEach(function(part) {
    if (part.type !== "literal") parts[part.type] = part.value;
  });
  if (!parts.year || !parts.month || !parts.day) return "";
  return parts.year + "-" + parts.month + "-" + parts.day;
}

export function addDaysIso(isoDate, days) {
  var base = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return "";
  var parts = base.split("-").map(function(value) { return Number(value); });
  var next = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  next.setUTCDate(next.getUTCDate() + Number(days || 0));
  return next.toISOString().slice(0, 10);
}

export function buildSyncWindow(query, body) {
  var lookbackDays = parsePositiveInt(
    (query && query.lookbackDays) || (body && body.lookbackDays) || process.env.GUSTO_TIME_OFF_LOOKBACK_DAYS,
    DEFAULT_LOOKBACK_DAYS,
    0,
    120
  );
  var lookaheadDays = parsePositiveInt(
    (query && query.lookaheadDays) || (body && body.lookaheadDays) || process.env.GUSTO_TIME_OFF_LOOKAHEAD_DAYS,
    DEFAULT_LOOKAHEAD_DAYS,
    1,
    365
  );
  var todayEt = formatDateEt(new Date());
  return {
    lookbackDays: lookbackDays,
    lookaheadDays: lookaheadDays,
    startDate: addDaysIso(todayEt, -lookbackDays),
    endDate: addDaysIso(todayEt, lookaheadDays),
    todayEt: todayEt
  };
}

function isRetryableFetchError(error) {
  var statusCode = Number(error && error.statusCode);
  if (Number.isFinite(statusCode) && RETRYABLE_FETCH_STATUSES[statusCode]) return true;
  var causeCode = String((error && error.cause && error.cause.code) || "").toUpperCase();
  if (
    causeCode === "ECONNRESET" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "EAI_AGAIN" ||
    causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
    causeCode === "UND_ERR_HEADERS_TIMEOUT" ||
    causeCode === "UND_ERR_SOCKET"
  ) {
    return true;
  }
  var message = String((error && error.message) || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("terminated") ||
    message.includes("other side closed") ||
    message.includes("econnreset")
  );
}

function buildUrl(baseUrl, path, query) {
  var url = new URL(path, baseUrl + "/");
  var params = query && typeof query === "object" ? query : {};
  Object.keys(params).forEach(function(key) {
    var value = params[key];
    if (value == null || value === "") return;
    url.searchParams.set(key, String(value));
  });
  return url.toString();
}

export async function gustoFetchJson(path, options) {
  var opts = options && typeof options === "object" ? options : {};
  var config = opts.config || getGustoConfig();
  var method = String(opts.method || "GET").toUpperCase();
  var timeoutMs = parsePositiveInt(opts.timeoutMs, FETCH_TIMEOUT_MS, 1000, 60000);
  var url = buildUrl(config.baseUrl, path, opts.query || {});
  var lastError = null;

  for (var attempt = 1; attempt <= FETCH_RETRY_ATTEMPTS; attempt += 1) {
    try {
      var response = await fetch(url, {
        method: method,
        headers: Object.assign({
          "Accept": "application/json",
          "Authorization": "Bearer " + config.accessToken,
          "X-Gusto-API-Version": config.apiVersion
        }, opts.body ? { "Content-Type": "application/json" } : {}, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: createTimeoutSignal(timeoutMs)
      });
      var text = await response.text();
      var body = parseJsonSafe(text);
      if (!response.ok) {
        var error = new Error("Gusto request failed (" + response.status + "): " + summarizeError(text || response.statusText || "unknown", 220));
        error.statusCode = response.status;
        error.responseText = text;
        error.responseBody = body;
        throw error;
      }
      return {
        data: body,
        headers: response.headers,
        attempts: attempt
      };
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRY_ATTEMPTS && isRetryableFetchError(error)) {
        await sleep(FETCH_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      error.attempts = attempt;
      throw error;
    }
  }

  throw lastError || new Error("Unknown Gusto request failure.");
}

function toHours(value) {
  var n = Number.parseFloat(String(value == null ? "" : value));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function sortedDayEntries(days) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return [];
  return Object.keys(days)
    .filter(function(key) { return /^\d{4}-\d{2}-\d{2}$/.test(String(key || "").trim()); })
    .sort()
    .map(function(date) {
      return {
        date: date,
        hours: toHours(days[date])
      };
    });
}

export function normalizeTimeOffRequest(record, companyUuid, syncedAtIso) {
  var source = record && typeof record === "object" ? record : {};
  var dayEntries = sortedDayEntries(source.days || {});
  var startDate = dayEntries.length ? dayEntries[0].date : null;
  var endDate = dayEntries.length ? dayEntries[dayEntries.length - 1].date : null;
  var requestedHours = Math.round(dayEntries.reduce(function(sum, entry) {
    return sum + toHours(entry.hours);
  }, 0) * 1000) / 1000;

  return {
    site_id: CACHE_SITE_ID,
    request_uuid: String(source.uuid || "").trim(),
    company_uuid: String(companyUuid || "").trim(),
    employee_uuid: String(source.employee && source.employee.uuid || "").trim(),
    employee_name: String(source.employee && source.employee.full_name || "").trim(),
    approver_uuid: String(source.approver && source.approver.uuid || "").trim() || null,
    approver_name: String(source.approver && source.approver.full_name || "").trim() || null,
    initiator_uuid: String(source.initiator && source.initiator.uuid || "").trim() || null,
    initiator_name: String(source.initiator && source.initiator.full_name || "").trim() || null,
    status: String(source.status || "").trim().toLowerCase() || "pending",
    policy_uuid: String(source.policy_uuid || "").trim() || null,
    policy_type: String(source.policy_type || source.request_type || "").trim().toLowerCase() || null,
    employee_note: String(source.employee_note || "").trim() || null,
    employer_note: String(source.employer_note || "").trim() || null,
    start_date: startDate,
    end_date: endDate,
    requested_hours: requestedHours,
    days: source.days && typeof source.days === "object" && !Array.isArray(source.days) ? source.days : {},
    raw: source,
    synced_at: syncedAtIso,
    last_seen_at: syncedAtIso
  };
}

export function readJsonBody(req) {
  if (!req || req.body == null) return {};
  if (typeof req.body === "string") return parseJsonSafe(req.body) || {};
  if (typeof req.body === "object") return req.body;
  return {};
}

export function statusSortValue(status) {
  var value = String(status || "").toLowerCase();
  if (value === "approved") return 1;
  if (value === "pending") return 2;
  if (value === "declined") return 3;
  if (value === "consumed") return 4;
  return 9;
}

export {
  CACHE_SITE_ID,
  getAuthenticatedUser,
  getSupabaseAdmin,
  withCors
};
