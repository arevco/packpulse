import Sentry from "../_sentry.js";
import {
  CACHE_SITE_ID,
  describeError,
  formatDateEt,
  getAuthenticatedUser,
  getSupabaseAdmin,
  hasGustoConfig,
  isMissingTableError,
  parsePositiveInt,
  statusSortValue,
  summarizeError,
  withCors
} from "./_common.js";

const ALLOWED_STATUSES = {
  pending: true,
  approved: true,
  declined: true,
  consumed: true
};

function addDaysIso(isoDate, days) {
  var parts = String(isoDate || "").split("-").map(function(value) { return Number(value); });
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "";
  var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function parseStatuses(raw) {
  var input = String(raw || "").trim().toLowerCase();
  if (!input) return ["approved", "pending"];
  var out = input
    .split(",")
    .map(function(value) { return String(value || "").trim().toLowerCase(); })
    .filter(function(value) { return !!ALLOWED_STATUSES[value]; });
  return out.length ? out : ["approved", "pending"];
}

function toHours(value) {
  var n = Number.parseFloat(String(value == null ? "" : value));
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

function flattenEntries(requests) {
  var entries = [];
  (Array.isArray(requests) ? requests : []).forEach(function(request) {
    var days = request && request.days && typeof request.days === "object" && !Array.isArray(request.days) ? request.days : {};
    Object.keys(days).forEach(function(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "").trim())) return;
      entries.push({
        request_uuid: request.request_uuid,
        company_uuid: request.company_uuid,
        employee_uuid: request.employee_uuid,
        employee_name: request.employee_name,
        approver_name: request.approver_name,
        initiator_name: request.initiator_name,
        policy_type: request.policy_type,
        status: request.status,
        date: date,
        hours: toHours(days[date]),
        employee_note: request.employee_note,
        employer_note: request.employer_note
      });
    });
  });
  entries.sort(function(left, right) {
    if (left.date !== right.date) return left.date < right.date ? -1 : 1;
    var leftStatus = statusSortValue(left.status);
    var rightStatus = statusSortValue(right.status);
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;
    return String(left.employee_name || "").localeCompare(String(right.employee_name || ""));
  });
  return entries;
}

function buildSummary(requests, entries) {
  var uniqueEmployees = {};
  var pendingCount = 0;
  var approvedCount = 0;
  var declinedCount = 0;
  var consumedCount = 0;
  (Array.isArray(requests) ? requests : []).forEach(function(request) {
    if (request.employee_uuid) uniqueEmployees[request.employee_uuid] = true;
    else if (request.employee_name) uniqueEmployees[request.employee_name] = true;
    if (request.status === "pending") pendingCount += 1;
    else if (request.status === "approved") approvedCount += 1;
    else if (request.status === "declined") declinedCount += 1;
    else if (request.status === "consumed") consumedCount += 1;
  });
  var totalHours = Math.round((Array.isArray(entries) ? entries : []).reduce(function(sum, entry) {
    return sum + toHours(entry.hours);
  }, 0) * 1000) / 1000;

  return {
    requestCount: Array.isArray(requests) ? requests.length : 0,
    entryCount: Array.isArray(entries) ? entries.length : 0,
    uniqueEmployees: Object.keys(uniqueEmployees).length,
    pendingCount: pendingCount,
    approvedCount: approvedCount,
    declinedCount: declinedCount,
    consumedCount: consumedCount,
    totalHours: totalHours
  };
}

async function readLatestSyncedAt(supabase) {
  try {
    var latestQ = await supabase
      .from("gusto_time_off_requests")
      .select("synced_at")
      .eq("site_id", CACHE_SITE_ID)
      .order("synced_at", { ascending: false })
      .limit(1);
    if (!latestQ.error && Array.isArray(latestQ.data) && latestQ.data[0] && latestQ.data[0].synced_at) {
      return latestQ.data[0].synced_at;
    }
  } catch (_error) {}

  try {
    var syncQ = await supabase
      .from("sync_runs")
      .select("finished_at")
      .eq("site_id", CACHE_SITE_ID)
      .eq("source", "gusto_time_off")
      .order("finished_at", { ascending: false })
      .limit(1);
    if (!syncQ.error && Array.isArray(syncQ.data) && syncQ.data[0] && syncQ.data[0].finished_at) {
      return syncQ.data[0].finished_at;
    }
  } catch (_error2) {}

  return null;
}

export default async function handler(req, res) {
  withCors(req, res, ["GET", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var supabase = getSupabaseAdmin();
    var days = parsePositiveInt(req.query && req.query.days, 45, 1, 180);
    var statuses = parseStatuses(req.query && req.query.statuses);
    var todayEt = formatDateEt(new Date());
    var endDate = addDaysIso(todayEt, days);

    var requestQ = await supabase
      .from("gusto_time_off_requests")
      .select("request_uuid,company_uuid,employee_uuid,employee_name,approver_name,initiator_name,status,policy_uuid,policy_type,employee_note,employer_note,start_date,end_date,requested_hours,days,synced_at,last_seen_at")
      .eq("site_id", CACHE_SITE_ID)
      .in("status", statuses)
      .lte("start_date", endDate)
      .gte("end_date", todayEt)
      .order("start_date", { ascending: true })
      .order("employee_name", { ascending: true });

    if (requestQ.error) {
      if (isMissingTableError(requestQ.error, "gusto_time_off_requests")) {
        return res.status(200).json({
          setupState: "missing_table",
          syncConfigured: hasGustoConfig(),
          lastSyncedAt: null,
          window: { todayEt: todayEt, endDate: endDate, days: days, statuses: statuses },
          summary: buildSummary([], []),
          requests: [],
          entries: []
        });
      }
      throw requestQ.error;
    }

    var requests = Array.isArray(requestQ.data) ? requestQ.data : [];
    var entries = flattenEntries(requests);
    var lastSyncedAt = await readLatestSyncedAt(supabase);

    return res.status(200).json({
      setupState: "ready",
      syncConfigured: hasGustoConfig(),
      lastSyncedAt: lastSyncedAt,
      window: { todayEt: todayEt, endDate: endDate, days: days, statuses: statuses },
      summary: buildSummary(requests, entries),
      requests: requests,
      entries: entries
    });
  } catch (error) {
    Sentry.captureException(error);
    return res.status(500).json({
      error: "Gusto time off request failed",
      details: summarizeError(error, 240),
      debug: describeError(error)
    });
  }
}
