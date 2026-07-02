import Sentry from "../_sentry.js";
import {
  CACHE_SITE_ID,
  buildSyncWindow,
  describeError,
  getAuthenticatedUser,
  getGustoConfig,
  getSupabaseAdmin,
  gustoFetchJson,
  isMissingTableError,
  normalizeTimeOffRequest,
  readJsonBody,
  summarizeError,
  withCors
} from "./_common.js";

async function deleteStaleRequests(supabase, companyUuid, syncWindow, seenRequestUuids) {
  var existingQ = await supabase
    .from("gusto_time_off_requests")
    .select("request_uuid")
    .eq("site_id", CACHE_SITE_ID)
    .eq("company_uuid", companyUuid)
    .lte("start_date", syncWindow.endDate)
    .gte("end_date", syncWindow.startDate);
  if (existingQ.error) throw existingQ.error;

  var existing = Array.isArray(existingQ.data) ? existingQ.data : [];
  var seen = {};
  (Array.isArray(seenRequestUuids) ? seenRequestUuids : []).forEach(function(value) {
    seen[String(value || "").trim()] = true;
  });
  var stale = existing
    .map(function(row) { return String(row && row.request_uuid || "").trim(); })
    .filter(Boolean)
    .filter(function(requestUuid) { return !seen[requestUuid]; });

  for (var i = 0; i < stale.length; i += 100) {
    var chunked = stale.slice(i, i + 100);
    var deleteQ = await supabase
      .from("gusto_time_off_requests")
      .delete()
      .eq("site_id", CACHE_SITE_ID)
      .eq("company_uuid", companyUuid)
      .in("request_uuid", chunked);
    if (deleteQ.error) throw deleteQ.error;
  }

  return stale.length;
}

async function fetchCompanyTimeOff(companyUuid, syncWindow, config, syncedAtIso) {
  var response = await gustoFetchJson("/v1/companies/" + encodeURIComponent(companyUuid) + "/time_off_requests", {
    config: config,
    query: {
      start_date: syncWindow.startDate,
      end_date: syncWindow.endDate
    }
  });

  if (!Array.isArray(response.data)) {
    throw new Error("Unexpected Gusto time off response for company " + companyUuid + ".");
  }

  var normalized = response.data
    .map(function(record) {
      return normalizeTimeOffRequest(record, companyUuid, syncedAtIso);
    })
    .filter(function(record) {
      return !!record.request_uuid && !!record.start_date && !!record.end_date && !!record.employee_name;
    });

  return {
    companyUuid: companyUuid,
    requests: normalized,
    attempts: response.attempts
  };
}

async function recordSyncRun(supabase, payload) {
  try {
    var insertQ = await supabase.from("sync_runs").insert(payload);
    if (insertQ.error && !isMissingTableError(insertQ.error, "sync_runs")) throw insertQ.error;
  } catch (_error) {}
}

export default async function handler(req, res) {
  withCors(req, res, ["POST", "OPTIONS"]);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  var startedAtIso = new Date().toISOString();

  try {
    var user = getAuthenticatedUser(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });

    var body = readJsonBody(req);
    var supabase = getSupabaseAdmin();
    var config = null;
    try {
      config = getGustoConfig();
    } catch (error) {
      return res.status(400).json({
        ok: false,
        error: "Missing Gusto configuration",
        details: describeError(error)
      });
    }
    var syncWindow = buildSyncWindow(req.query || {}, body || {});
    var syncedAtIso = new Date().toISOString();

    var settled = await Promise.allSettled(
      config.companyUuids.map(function(companyUuid) {
        return fetchCompanyTimeOff(companyUuid, syncWindow, config, syncedAtIso);
      })
    );

    var companyResults = [];
    var failures = [];
    var totalSynced = 0;
    var totalDeleted = 0;

    for (var i = 0; i < settled.length; i += 1) {
      var companyUuid = config.companyUuids[i];
      var result = settled[i];

      if (result.status !== "fulfilled") {
        failures.push({
          companyUuid: companyUuid,
          error: summarizeError(result.reason, 220)
        });
        companyResults.push({
          companyUuid: companyUuid,
          syncedRequests: 0,
          deletedRequests: 0,
          status: "error",
          error: summarizeError(result.reason, 220)
        });
        continue;
      }

      var records = result.value.requests;
      if (records.length) {
        var upsertQ = await supabase
          .from("gusto_time_off_requests")
          .upsert(records, { onConflict: "site_id,request_uuid" });
        if (upsertQ.error) throw upsertQ.error;
      }

      var deletedCount = await deleteStaleRequests(
        supabase,
        companyUuid,
        syncWindow,
        records.map(function(record) { return record.request_uuid; })
      );

      totalSynced += records.length;
      totalDeleted += deletedCount;
      companyResults.push({
        companyUuid: companyUuid,
        syncedRequests: records.length,
        deletedRequests: deletedCount,
        status: "ok",
        attempts: result.value.attempts
      });
    }

    var status = failures.length ? (failures.length === config.companyUuids.length ? "error" : "partial") : "ok";

    await recordSyncRun(supabase, {
      site_id: CACHE_SITE_ID,
      source: "gusto_time_off",
      status: status,
      row_counts: {
        companies: config.companyUuids.length,
        synced_requests: totalSynced,
        deleted_requests: totalDeleted
      },
      details: {
        company_results: companyResults,
        failures: failures,
        start_date: syncWindow.startDate,
        end_date: syncWindow.endDate,
        lookback_days: syncWindow.lookbackDays,
        lookahead_days: syncWindow.lookaheadDays,
        api_base_url: config.baseUrl,
        api_version: config.apiVersion
      },
      started_at: startedAtIso,
      finished_at: new Date().toISOString(),
      updated_by: user.email || user.userId || "unknown"
    });

    if (status === "error") {
      return res.status(502).json({
        ok: false,
        status: status,
        error: "All Gusto company syncs failed.",
        failures: failures,
        companyResults: companyResults
      });
    }

    return res.status(200).json({
      ok: true,
      status: status,
      syncedAt: syncedAtIso,
      window: syncWindow,
      companyResults: companyResults,
      failures: failures,
      summary: {
        companies: config.companyUuids.length,
        syncedRequests: totalSynced,
        deletedRequests: totalDeleted
      }
    });
  } catch (error) {
    Sentry.captureException(error);
    if (isMissingTableError(error, "gusto_time_off_requests")) {
      return res.status(409).json({
        ok: false,
        error: "Missing Supabase setup",
        details: "Run docs/supabase-gusto-time-off.sql before syncing Gusto PTO."
      });
    }
    return res.status(500).json({
      ok: false,
      error: "Gusto PTO sync failed",
      details: summarizeError(error, 240),
      debug: describeError(error)
    });
  }
}
