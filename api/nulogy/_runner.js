import Sentry from "../_sentry.js";

export const NULOGY_URL = process.env.NULOGY_URL || "https://app.nulogy.net";
const DEFAULT_LOCALE = "en_US";
const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_MAX_POLLS = 12;
const MAX_POLL_INTERVAL_MS = 10000;
const MAX_MAX_POLLS = 90;
const DEFAULT_FULL_HISTORY_FROM = "2000-01-01T00:00:00";

export function withNulogyCors(res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function getNulogyCredentials() {
  var user = process.env.NULOGY_USER;
  var pass = process.env.NULOGY_PASS;
  var siteUuid = process.env.NULOGY_SITE_UUID || "";
  if (!user || !pass) {
    throw new Error("Nulogy credentials not configured.");
  }
  return {
    user,
    pass,
    siteUuid
  };
}

export function buildAuthHeader(user, pass) {
  return "Basic " + Buffer.from(String(user || "") + ":" + String(pass || "")).toString("base64");
}

export function isSafeStatusUrl(url) {
  var value = String(url || "").trim();
  return value.indexOf(NULOGY_URL + "/api/reports/report_runs/") === 0;
}

export function normalizeRunReportRequest(input, defaults) {
  var body = input && typeof input === "object" ? input : {};
  var warnings = [];
  var report = normalizeReportCode(body.report);
  var columns = normalizeColumns(body.columns);
  var filters = normalizeFilters(body.filters);
  var sortBy = normalizeSortBy(body.sort_by, warnings);
  var locale = normalizeLocale(body.locale || (defaults && defaults.locale) || DEFAULT_LOCALE);
  var siteUuid = normalizeOptionalString(body.site_uuid || body.siteUuid || (defaults && defaults.siteUuid) || "");
  var waitForCompletion = body.waitForCompletion !== false;
  var pollIntervalMs = clampNumber(body.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 250, MAX_POLL_INTERVAL_MS);
  var maxPolls = clampNumber(body.maxPolls, DEFAULT_MAX_POLLS, 1, MAX_MAX_POLLS);
  filters = applyDefaultReportFilters(report, filters, warnings);

  var requestBody = {
    report: report,
    locale: locale
  };
  if (columns.length) requestBody.columns = columns;
  if (filters.length) requestBody.filters = filters;
  if (sortBy.length) requestBody.sort_by = sortBy;
  if (siteUuid) requestBody.site_uuid = siteUuid;

  return {
    report: report,
    columns: columns,
    filters: filters,
    sortBy: sortBy,
    locale: locale,
    siteUuid: siteUuid,
    waitForCompletion: waitForCompletion,
    pollIntervalMs: pollIntervalMs,
    maxPolls: maxPolls,
    requestBody: requestBody,
    warnings: warnings
  };
}

export async function createReportRun(requestBody, authHeader) {
  var response = await fetch(NULOGY_URL + "/api/reports/report_runs", {
    method: "POST",
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  var text = await response.text();
  return {
    ok: response.ok || response.status === 201,
    status: response.status,
    headers: response.headers,
    text: text,
    payload: safeJson(text)
  };
}

export async function pollReportRun(statusUrl, authHeader, options) {
  if (!isSafeStatusUrl(statusUrl)) {
    return { ok: false, error: "Unsafe or invalid Nulogy status URL.", statusHistory: [] };
  }

  var intervalMs = clampNumber(options && options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 250, MAX_POLL_INTERVAL_MS);
  var maxPolls = clampNumber(options && options.maxPolls, DEFAULT_MAX_POLLS, 1, MAX_MAX_POLLS);
  var statusHistory = [];

  for (var attempt = 1; attempt <= maxPolls; attempt++) {
    await sleep(intervalMs);
    var response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        "Authorization": authHeader
      }
    });
    var text = await response.text();
    var payload = safeJson(text);
    statusHistory.push({
      attempt: attempt,
      statusCode: response.status,
      status: payload.status || ""
    });

    if (!response.ok) {
      return {
        ok: false,
        error: "Nulogy status error (" + response.status + "): " + text.slice(0, 400),
        statusHistory: statusHistory
      };
    }

    if (payload.status === "COMPLETED") {
      return {
        ok: true,
        completed: true,
        statusHistory: statusHistory,
        downloadUrl: payload.download_url || payload.url || null,
        payload: payload
      };
    }
    if (payload.status === "FAILED" || payload.status === "ERROR") {
      return {
        ok: false,
        error: "Nulogy report failed: " + text.slice(0, 400),
        statusHistory: statusHistory,
        payload: payload
      };
    }
  }

  return {
    ok: true,
    completed: false,
    statusHistory: statusHistory
  };
}

export async function executeReportRun(input) {
  var credentials;
  try {
    credentials = getNulogyCredentials();
  } catch (error) {
    return {
      ok: false,
      statusCode: 500,
      body: { error: error.message }
    };
  }

  var normalized;
  try {
    normalized = normalizeRunReportRequest(input, { siteUuid: credentials.siteUuid });
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      body: { error: error.message }
    };
  }

  var authHeader = buildAuthHeader(credentials.user, credentials.pass);

  try {
    var created = await createReportRun(normalized.requestBody, authHeader);
    if (created.status === 401) {
      return {
        ok: false,
        statusCode: 401,
        body: { error: "Invalid Nulogy credentials." }
      };
    }
    if (created.status === 403) {
      return {
        ok: false,
        statusCode: 403,
        body: { error: "Nulogy credentials lack permissions." }
      };
    }
    if (!created.ok) {
      var createFailure = classifyNulogyFailure(created.text);
      return {
        ok: false,
        statusCode: createFailure.blocked ? 409 : (created.status || 502),
        body: Object.assign({
          error: "Failed to create Nulogy report run.",
          report: normalized.report,
          requestBody: normalized.requestBody,
          nulogyResponse: created.text.slice(0, 1000)
        }, createFailure)
      };
    }

    var statusUrl = created.headers.get("location") ||
      created.headers.get("Location") ||
      created.payload.status_url ||
      (created.payload.task_id ? (NULOGY_URL + "/api/reports/report_runs/" + created.payload.task_id) : "");

    if (!statusUrl || !isSafeStatusUrl(statusUrl)) {
      return {
        ok: false,
        statusCode: 502,
        body: {
          error: "Nulogy create response omitted a safe status URL.",
          report: normalized.report,
          requestBody: normalized.requestBody
        }
      };
    }

    var baseBody = {
      ok: true,
      report: normalized.report,
      requestBody: normalized.requestBody,
      columnsRequested: normalized.columns,
      filtersApplied: normalized.filters,
      sortByApplied: normalized.sortBy,
      locale: normalized.locale,
      warnings: normalized.warnings,
      taskId: created.payload.task_id || null,
      statusUrl: statusUrl
    };

    if (!normalized.waitForCompletion) {
      return {
        ok: true,
        statusCode: 201,
        body: Object.assign({}, baseBody, {
          created: true,
          completed: false
        })
      };
    }

    var polled = await pollReportRun(statusUrl, authHeader, normalized);
    if (!polled.ok) {
      var pollFailure = classifyNulogyFailure(polled.error || "");
      return {
        ok: false,
        statusCode: pollFailure.blocked ? 409 : 502,
        body: Object.assign({}, baseBody, pollFailure, {
          error: polled.error,
          statusHistory: polled.statusHistory || []
        })
      };
    }

    if (!polled.completed) {
      return {
        ok: true,
        statusCode: 202,
        body: Object.assign({}, baseBody, {
          created: true,
          completed: false,
          pending: true,
          statusHistory: polled.statusHistory || []
        })
      };
    }

    return {
      ok: true,
      statusCode: 200,
      body: Object.assign({}, baseBody, {
        created: true,
        completed: true,
        pending: false,
        statusHistory: polled.statusHistory || [],
        downloadUrl: polled.downloadUrl || null
      })
    };
  } catch (error) {
    Sentry.captureException(error);
    return {
      ok: false,
      statusCode: 500,
      body: { error: "Failed to run Nulogy report: " + error.message }
    };
  }
}

function normalizeReportCode(value) {
  var report = normalizeOptionalString(value);
  if (!report) throw new Error("Missing report code.");
  if (!/^[a-z0-9_]+$/i.test(report)) {
    throw new Error("Invalid report code. Use letters, numbers, and underscores only.");
  }
  return report;
}

function normalizeColumns(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("columns must be an array of field names.");
  var seen = {};
  return value
    .map(function(entry) { return normalizeOptionalString(entry); })
    .filter(function(entry) {
      if (!entry) return false;
      if (seen[entry]) return false;
      seen[entry] = true;
      return true;
    });
}

function normalizeFilters(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error("filters must be an array.");
  return value.map(function(filter, index) {
    if (!filter || typeof filter !== "object") {
      throw new Error("filters[" + index + "] must be an object.");
    }
    var column = normalizeOptionalString(filter.column);
    var operator = normalizeOptionalString(filter.operator);
    if (!column || !operator) {
      throw new Error("filters[" + index + "] requires column and operator.");
    }
    var next = { column: column, operator: operator };
    if (operator === "between") {
      if (filter.from_threshold == null || filter.to_threshold == null) {
        throw new Error("filters[" + index + "] with operator between requires from_threshold and to_threshold.");
      }
      next.from_threshold = filter.from_threshold;
      next.to_threshold = filter.to_threshold;
      return next;
    }
    if (operator !== "today" && operator !== "yesterday" && operator !== "tomorrow") {
      if (filter.threshold == null) {
        throw new Error("filters[" + index + "] requires threshold.");
      }
      next.threshold = filter.threshold;
    }
    return next;
  });
}

function normalizeSortBy(value, warnings) {
  if (value == null) return [];
  var items = Array.isArray(value) ? value.slice(0) : [value];
  if (!items.length) return [];
  if (items.length > 1) {
    warnings.push("Nulogy accepts only one sort_by column; only the first sort will be used.");
  }
  var first = items[0];
  if (!first || typeof first !== "object") {
    throw new Error("sort_by must be an object or array of objects.");
  }
  var column = normalizeOptionalString(first.column);
  var direction = normalizeOptionalString(first.direction || "asc").toLowerCase();
  if (!column) throw new Error("sort_by requires a column.");
  if (direction !== "asc" && direction !== "desc") {
    throw new Error("sort_by direction must be asc or desc.");
  }
  return [{ column: column, direction: direction }];
}

function normalizeLocale(value) {
  var locale = normalizeOptionalString(value || DEFAULT_LOCALE);
  if (!locale) return DEFAULT_LOCALE;
  return locale;
}

function normalizeOptionalString(value) {
  return String(value == null ? "" : value).trim();
}

function applyDefaultReportFilters(report, filters, warnings) {
  var existing = Array.isArray(filters) ? filters.slice() : [];
  if (report === "consumption_by_lot" && !hasAnyFilter(existing, ["consumed_at", "consumed_date", "finished_good_pallet", "subcomponent_consumption_pallet"])) {
    warnings.push("Auto-applied consumption_by_lot consumed_at filter window because Nulogy requires one.");
    return existing.concat([buildRecentDateTimeWindow("consumed_at", Number(process.env.NULOGY_CONSUMPTION_BY_LOT_LOOKBACK_DAYS || 31))]);
  }
  if (report === "weekly_consumption" && !hasAnyFilter(existing, ["consumed_at", "consumed_date"])) {
    warnings.push("Auto-applied weekly_consumption consumed_at filter window because Nulogy requires one.");
    return existing.concat([buildRecentDateTimeWindow("consumed_at", Number(process.env.NULOGY_WEEKLY_CONSUMPTION_LOOKBACK_DAYS || 10))]);
  }
  if (report === "weekly_inventory_adjustment_summary" && !hasAnyFilter(existing, ["created_at"])) {
    warnings.push("Auto-applied weekly_inventory_adjustment_summary created_at filter window because Nulogy requires one.");
    return existing.concat([buildRecentDateTimeWindow("created_at", Number(process.env.NULOGY_WEEKLY_INVENTORY_ADJUSTMENT_LOOKBACK_DAYS || 10))]);
  }
  if (report === "pallet_storage" && !hasAnyFilter(existing, ["stored_since"])) {
    warnings.push("Auto-applied pallet_storage stored_since filter window because Nulogy fails without it.");
    return existing.concat([buildFullHistoryDateTimeWindow("stored_since", process.env.NULOGY_PALLET_STORAGE_FROM_DATE || DEFAULT_FULL_HISTORY_FROM)]);
  }
  return existing;
}

function hasAnyFilter(filters, columns) {
  var lookup = {};
  columns.forEach(function(column) {
    lookup[String(column || "").trim()] = true;
  });
  return (filters || []).some(function(filter) {
    return !!lookup[String(filter && filter.column || "").trim()];
  });
}

function buildRecentDateTimeWindow(column, lookbackDays) {
  var end = new Date();
  end.setDate(end.getDate() + 1);
  var start = new Date(end.getTime() - Math.max(1, lookbackDays) * 24 * 60 * 60 * 1000);
  return {
    column: column,
    operator: "between",
    from_threshold: formatNulogyDateTime(start),
    to_threshold: formatNulogyDateTime(end)
  };
}

function buildFullHistoryDateTimeWindow(column, fromValue) {
  var start = new Date(fromValue || DEFAULT_FULL_HISTORY_FROM);
  if (isNaN(start)) start = new Date(DEFAULT_FULL_HISTORY_FROM);
  var end = new Date();
  end.setDate(end.getDate() + 1);
  return {
    column: column,
    operator: "between",
    from_threshold: formatNulogyDateTime(start),
    to_threshold: formatNulogyDateTime(end)
  };
}

function formatNulogyDateTime(date) {
  var d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return "";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var year = d.getFullYear();
  var month = months[d.getMonth()];
  var day = String(d.getDate()).padStart(2, "0");
  var hour24 = d.getHours();
  var minute = String(d.getMinutes()).padStart(2, "0");
  var ampm = hour24 >= 12 ? "PM" : "AM";
  var hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return year + "-" + month + "-" + day + " " + hour12 + ":" + minute + " " + ampm;
}

function classifyNulogyFailure(text) {
  var messages = extractFailureMessages(text);
  var joined = messages.join(" ").toLowerCase();
  var details = {};
  if (!messages.length) return details;
  details.failureMessages = messages;
  if (joined.indexOf("custom units of measure enabled") >= 0) {
    details.blocked = true;
    details.blockedReason = "account_feature_disabled";
  }
  if (joined.indexOf("must be added") >= 0 || joined.indexOf("your search must include") >= 0) {
    details.requiresFilters = true;
  }
  return details;
}

function extractFailureMessages(text) {
  var value = String(text || "").trim();
  if (!value) return [];
  try {
    var parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String);
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.errors)) return parsed.errors.map(String);
      if (Array.isArray(parsed.failureMessages)) return parsed.failureMessages.map(String);
      if (typeof parsed.error === "string") return [parsed.error];
      if (typeof parsed.nulogyResponse === "string") return extractFailureMessages(parsed.nulogyResponse);
    }
  } catch (error) {
    // Ignore JSON parsing failure and fall back to regex extraction below.
  }
  var quoted = value.match(/"([^"]+)"/g);
  if (quoted && quoted.length) {
    return quoted.map(function(entry) { return entry.slice(1, -1); });
  }
  return [value];
}

function clampNumber(value, fallback, min, max) {
  var numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
}

function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}
